#!/usr/bin/env node
/**
 * QA pairing proxy.
 *
 * `GET /api/harnesses` (the one-code discovery endpoint) is handled by
 * server.js *after* the HTTP-backend forwarder, so with `--backend http` it
 * answers 501 "not supported by the HTTP backend" and the phone can never pair.
 * This proxy forwards everything to the real server and answers that single
 * discovery request itself, so QA can exercise the real app end-to-end against
 * the real server without touching server.js.
 *
 * Evidence for the defect: tools/qa/README.md ("已知缺陷 D1").
 */
import http from "node:http";

const LISTEN = Number(process.env.QA_PROXY_PORT || 8792);
const TARGET = process.env.QA_SERVER_URL || "http://127.0.0.1:8791";
const HOST = "127.0.0.1";
const token = process.env.QA_ACCESS_CODE || "qa-code";
const machineId = process.env.QA_MACHINE_ID || "qa-machine";
const machineName = process.env.QA_MACHINE_NAME || "QA 桌面";

const discovery = {
  ok: true,
  protocol: "codex-turnloom",
  version: 2,
  machineId,
  machineName,
  defaultHarnessId: "http",
  harnesses: [{ id: "http", name: machineName, token, kind: "http", defaultHarness: true, online: true }],
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}:${LISTEN}`);
  // A phone that drops mid-request (or a probe that closes the socket) must not
  // take the proxy down: without these guards Node exits on ECONNRESET/EPIPE.
  req.on("error", () => {});
  res.on("error", () => {});
  if (req.method === "GET" && url.pathname === "/api/harnesses") {
    const presented = req.headers["x-access-token"] || "";
    if (presented !== token) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid-machine-token", protocol: "codex-turnloom", version: 2 }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(discovery));
    return;
  }
  const upstream = new URL(`${TARGET}${url.pathname}${url.search}`);
  const headers = { ...req.headers, host: upstream.host };
  const proxied = http.request(upstream, { method: req.method, headers }, (upstreamRes) => {
    upstreamRes.on("error", () => {});
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  proxied.on("error", (error) => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
    try { res.end(JSON.stringify({ error: `proxy-upstream: ${error.message}` })); } catch { /* client gone */ }
  });
  req.pipe(proxied);
});

server.on("clientError", (error, socket) => {
  try { socket.destroy(); } catch { /* ignore */ }
  console.error(`[proxy] clientError ${error.code || error.message}`);
});
process.on("uncaughtException", (error) => {
  console.error(`[proxy] uncaught ${error?.stack || error}`);
});

server.listen(LISTEN, HOST, () => {
  console.log(`[proxy] http://${HOST}:${LISTEN} -> ${TARGET} (discovery shimmed)`);
});
