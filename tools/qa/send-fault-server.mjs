#!/usr/bin/env node
/**
 * Deterministic /api server for the 2.2.1 send-chain failures.
 *
 * It speaks the same envelope as `backends/http-backend.js` (and the real
 * `server.js`) but the /api/send outcome is a knob:
 *
 *   ok           200 {ok:true, threadId}
 *   image-400    400 code image_dimensions_out_of_range (Chinese sentence)
 *   english-400  400 "Invalid image: dimensions must be within 4096px and 12MP"
 *                (the 2.1.7 server still deployed on `de` speaks this shape)
 *   chinese-400  400 "当前模型不支持图片，请移除后重试"
 *   empty-400    400 "内容为空"
 *   413          413 code payload_too_large
 *   timeout      accept the request and never answer (real socket stall)
 *   reset        destroy the socket before any response (transport failure)
 *   reset-once   first send resets, every later send is 200 (retry path)
 *   401          401 code unauthorized
 *   slow-ok      200 after `delayMs`
 *
 * Every request is recorded (method, path, body bytes, clientRequestId,
 * image names/sizes) so a test can assert on the exact body the app sent.
 * Used by `test/app-send-faults.test.cjs`, and runnable standalone for QA:
 *
 *   node tools/qa/send-fault-server.mjs --port 8811 --scenario image-400
 */

import http from "node:http";

const SCENARIOS = new Set([
  "ok", "image-400", "english-400", "chinese-400", "empty-400", "413",
  "timeout", "reset", "reset-once", "401", "slow-ok",
]);

/** The documented 2.2.1 error bodies (Atlas, thread:a808b27f). */
const ERROR_BODIES = {
  "image-400": {
    error: "图片尺寸超出电脑端限制（单边 16–4096px，且总像素 ≤12MP），当前 4032×3024（12.2MP）。请压缩或裁剪后再发送。",
    code: "image_dimensions_out_of_range",
  },
  "english-400": {
    error: "Invalid image: dimensions must be within 4096px and 12MP",
    code: "invalid_image",
  },
  "chinese-400": { error: "当前模型不支持图片，请移除后重试", code: "model_no_image" },
  "empty-400": { error: "内容为空", code: "empty_message" },
  "413": { error: "发送内容超过电脑端上限，请减少图片或附件后再试。", code: "payload_too_large" },
  "401": { error: "机器访问码不正确或已更换", code: "unauthorized" },
};

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function attachmentsOf(body) {
  const list = Array.isArray(body?.images) ? body.images : [];
  return list.map((item) => ({
    name: typeof item?.name === "string" ? item.name : "",
    mimeType: typeof item?.mimeType === "string" ? item.mimeType : "",
    bytes: typeof item?.data === "string" ? Math.floor(item.data.length * 3 / 4) : 0,
  }));
}

export function createSendFaultServer(options = {}) {
  const state = {
    scenario: SCENARIOS.has(options.scenario) ? options.scenario : "ok",
    delayMs: Number(options.delayMs) || 250,
    /** Lets a test prove that a failed diagnostics upload never flips offline. */
    diagnosticsStatus: 200,
    sends: 0,
  };
  const requests = [];
  const diagnostics = [];
  const hung = new Set();
  let closed = false;

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const path = new URL(req.url, "http://127.0.0.1").pathname;
      const record = {
        at: Date.now(),
        method: req.method,
        path,
        url: req.url,
        bytes: Buffer.byteLength(raw),
        headers: { ...req.headers },
        body: null,
      };
      if (raw) {
        try { record.body = JSON.parse(raw); } catch { record.body = raw; }
      }
      requests.push(record);

      if (path === "/api/health") {
        return json(res, 200, {
          ok: true,
          version: "2.2.1-qa",
          backend: { kind: "codex", url: "http://127.0.0.1:1", profile: null },
          models: [
            { id: "gpt-5.1-codex", label: "GPT-5.1 Codex", efforts: ["low", "medium", "high"], defaultEffort: "medium", supportsImages: true },
          ],
          defaultModel: "gpt-5.1-codex",
          defaultEffort: "medium",
        });
      }

      if (path === "/api/diagnostics") {
        if (state.diagnosticsStatus === 401) {
          diagnostics.push({ at: Date.now(), bytes: record.bytes, rejected: true });
          return json(res, 401, ERROR_BODIES["401"]);
        }
        // Contract: ≤256 KiB, latest 200 records, whitelisted-by-shape only.
        if (record.bytes > 256 * 1024) {
          diagnostics.push({ at: Date.now(), bytes: record.bytes, rejected: true });
          return json(res, 413, ERROR_BODIES["413"]);
        }
        const records = Array.isArray(record.body?.records) ? record.body.records : [];
        const kept = records.slice(-200);
        diagnostics.push({
          at: Date.now(),
          bytes: record.bytes,
          machine: typeof record.body?.machine === "string" ? record.body.machine : "",
          appVersion: typeof record.body?.appVersion === "string" ? record.body.appVersion : "",
          records: kept,
          dropped: Math.max(0, records.length - kept.length),
        });
        return json(res, 200, {
          ok: true,
          stored: kept.length,
          dropped: Math.max(0, records.length - kept.length),
          file: "qa-machine-20261118.jsonl",
        });
      }

      if (path === "/api/threads") {
        return json(res, 200, { threads: [{ id: "thread-qa", title: "QA send", updatedAt: Date.now() }], total: 1 });
      }

      if (path.endsWith("/messages")) {
        return json(res, 200, { messages: [], status: { state: "ended" } });
      }

      if (path !== "/api/send") return json(res, 404, { error: "not-found" });

      // ---- /api/send: the failure matrix -------------------------------
      record.clientRequestId = typeof record.body?.clientRequestId === "string" ? record.body.clientRequestId : null;
      record.images = attachmentsOf(record.body);
      state.sends += 1;
      const scenario = state.scenario;

      if (scenario === "401") {
        return json(res, 401, ERROR_BODIES["401"]);
      }
      if (scenario === "image-400") {
        return json(res, 400, ERROR_BODIES["image-400"]);
      }
      if (scenario === "english-400") {
        return json(res, 400, ERROR_BODIES["english-400"]);
      }
      if (scenario === "chinese-400") {
        return json(res, 400, ERROR_BODIES["chinese-400"]);
      }
      if (scenario === "empty-400") {
        return json(res, 400, ERROR_BODIES["empty-400"]);
      }
      if (scenario === "413") {
        return json(res, 413, ERROR_BODIES["413"]);
      }
      if (scenario === "reset") {
        req.socket.destroy();
        return;
      }
      if (scenario === "reset-once" && state.sends === 1) {
        req.socket.destroy();
        return;
      }
      if (scenario === "timeout") {
        hung.add(res);
        return; // keep the socket open until the client times out / closes
      }
      const answer = () => {
        if (closed) return;
        json(res, 200, {
          ok: true,
          threadId: typeof record.body?.threadId === "string" && record.body.threadId ? record.body.threadId : "thread-qa",
          clientRequestId: record.clientRequestId,
          deduped: state.sends > 1 && record.clientRequestId !== null,
        });
      };
      if (scenario === "slow-ok") setTimeout(answer, state.delayMs);
      else answer();
    });
    req.on("error", () => { /* client aborted a timeout probe */ });
  });

  server.on("connection", (socket) => {
    socket.on("error", () => { /* reset probes close their own socket */ });
  });

  return {
    state,
    requests,
    diagnostics,
    get url() {
      const address = server.address();
      return `http://127.0.0.1:${address.port}`;
    },
    setScenario(next) {
      if (!SCENARIOS.has(next)) throw new Error(`unknown scenario: ${next}`);
      state.scenario = next;
      state.sends = 0;
    },
    setDiagnosticsStatus(status) {
      state.diagnosticsStatus = Number(status) || 200;
    },
    reset() {
      requests.length = 0;
      diagnostics.length = 0;
      state.sends = 0;
    },
    async listen(port = 0, host = "127.0.0.1") {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => resolve());
      });
      return this.url;
    },
    async close() {
      closed = true;
      for (const res of hung) { try { res.destroy(); } catch { /* ignore */ } }
      hung.clear();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

// ---- standalone CLI -------------------------------------------------------
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/").replace(/^\//, "")}`) {
  const flag = (name, fallback) => {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
  };
  const port = Number(flag("port", "0"));
  const scenario = flag("scenario", "ok");
  const server = createSendFaultServer({ scenario });
  await server.listen(port);
  console.log(JSON.stringify({ ok: true, url: server.url, scenario, pid: process.pid }));
  process.on("SIGINT", async () => { await server.close(); process.exit(0); });
  process.on("SIGTERM", async () => { await server.close(); process.exit(0); });
}
