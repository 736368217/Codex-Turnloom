import assert from "node:assert/strict";
import test from "node:test";

import {
  HttpBackendClient,
  normalizeBackendState,
  normalizeBackendStatus,
  normalizeBackendThread
} from "../backends/http-backend.js";

test("HTTP backend state aliases normalize to the Turnloom contract", () => {
  assert.equal(normalizeBackendState("running"), "running");
  assert.equal(normalizeBackendState("in_progress"), "running");
  assert.equal(normalizeBackendState("needs_input"), "waiting");
  assert.equal(normalizeBackendState("completed"), "ended");
  assert.equal(normalizeBackendState("nonsense"), "");
  assert.deepEqual(
    normalizeBackendStatus({ status: "active", turn_id: "t1", startedAtMs: 1234 }),
    {
      status: "active",
      turn_id: "t1",
      startedAtMs: 1234,
      state: "running",
      thinking: true,
      interactionRequired: false,
      turnId: "t1"
    }
  );
});

test("HTTP backend thread normalization fills frontend-facing defaults", () => {
  const thread = normalizeBackendThread({
    id: "thread-1",
    name: "Hello",
    updated_at_ms: 1000,
    project_id: "p1",
    status: { state: "waiting" }
  });
  assert.equal(thread.title, "Hello");
  assert.equal(thread.updatedAtMs, 1000);
  assert.deepEqual(thread.project, { key: "project:p1", id: "p1", name: "p1", native: true });
  assert.equal(thread.status.state, "waiting");
  assert.equal(thread.status.interactionRequired, true);
});

test("HTTP backend client follows the documented wire contract", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/threads")) {
      return new Response(JSON.stringify([{ id: "a", title: "A" }]), { status: 200 });
    }
    if (String(url).endsWith("/threads/a/messages?limit=5")) {
      return new Response(JSON.stringify({ thread: { id: "a" }, messages: [{ content: "hi" }], status: { state: "running" } }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, threadId: "a" }), { status: 200 });
  };
  const backend = new HttpBackendClient({ baseUrl: "http://backend.test/", token: "secret", fetchImpl });
  const threads = await backend.listThreads();
  assert.equal(threads[0].id, "a");
  assert.equal(calls[0].url, "http://backend.test/threads");
  assert.equal(calls[0].options.headers["x-access-token"], "secret");

  const messages = await backend.getMessages("a", { limit: 5 });
  assert.equal(messages.messages[0].content, "hi");
  assert.equal(messages.status.state, "running");

  const sent = await backend.sendMessage("a", "hello");
  assert.equal(sent.ok, true);
  assert.equal(JSON.parse(calls.at(-1).options.body).text, "hello");
});

test("HTTP backend rejects threads outside the adapter inventory", async () => {
  const fetchImpl = async (url) => new Response(JSON.stringify(
    String(url).endsWith("/threads") ? [{ id: "known" }] : { ok: true }
  ), { status: 200 });
  const backend = new HttpBackendClient({ baseUrl: "http://backend.test", fetchImpl });
  await assert.rejects(() => backend.getMessages("unknown"), (error) => error.status === 404);
});

test("HTTP backend preserves the upstream error code so a proxy hop cannot flatten 409 reasons", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    error: "Approval is missing, changed, expired, already resolved, or does not match the displayed request",
    code: "approval_request_unavailable"
  }), { status: 409 });
  const backend = new HttpBackendClient({ baseUrl: "http://backend.test", fetchImpl });
  await assert.rejects(
    () => backend.respondToApproval({ threadId: "a", requestId: "req-a", approvalKind: "command", detailsHash: "a".repeat(64), decision: "approve" }),
    (error) => error.status === 409 && error.code === "approval_request_unavailable"
  );

  const noCode = new HttpBackendClient({ baseUrl: "http://backend.test", fetchImpl: async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 }) });
  await assert.rejects(() => noCode.listThreads(), (error) => error.status === 500 && error.code === undefined);
});

test("HTTP backend rejects an incomplete approval decision locally with the same code as the server", async () => {
  const calls = [];
  const backend = new HttpBackendClient({
    baseUrl: "http://backend.test",
    fetchImpl: async (url) => { calls.push(String(url)); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
  });
  await assert.rejects(
    () => backend.respondToApproval({ threadId: "a", requestId: "req-a", approvalKind: "command", detailsHash: "not-a-hash", decision: "approve" }),
    (error) => error.status === 400 && error.code === "approval_identity_required"
  );
  assert.deepEqual(calls, [], "an unsubmittable decision must never reach the backend");
});

test("HTTP backend extended operations use the documented routes", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), method: options.method || "GET", body: options.body });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const backend = new HttpBackendClient({ baseUrl: "http://backend.test", fetchImpl });
  await backend.setPinned("a", true);
  await backend.getGoal("a");
  await backend.setGoal("a", { objective: "x" });
  await backend.clearGoal("a");
  await backend.compactThread("a");
  await backend.branchThread("a", { lastTurnId: "t" });
  await assert.rejects(() => backend.respondToApproval({ threadId: "a" }), (error) => error.status === 400);
  await backend.respondToApproval({ threadId: "a", requestId: "req-a", approvalKind: "command", detailsHash: "a".repeat(64), decision: "approve" });
  await backend.cancelQueuedSend({ threadId: "a" });
  await backend.steerQueuedSend({ threadId: "a" });
  assert.deepEqual(calls.map((call) => `${call.method} ${call.url.replace("http://backend.test", "")}`), [
    "POST /threads/a/pin",
    "GET /threads/a/goal",
    "PUT /threads/a/goal",
    "DELETE /threads/a/goal",
    "POST /threads/a/compact",
    "POST /threads/a/branch",
    "POST /approval",
    "POST /queue/cancel",
    "POST /queue/steer"
  ]);
  assert.equal(JSON.parse(calls[0].body).pinned, true);
  assert.equal(JSON.parse(calls[5].body).lastTurnId, "t");
});
