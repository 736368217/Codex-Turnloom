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
