import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  adapterStatusOverrideFor,
  clearAdapterStatusOverride,
  ifNoneMatchMatches,
  normalizeStatusState,
  normalizeThreadsLimit,
  setAdapterStatusOverride,
  statusFieldsFromOverride,
  statusOverrideFromRow,
  threadsPage,
  weakEtagFor
} from "../server.js";

test("adapter status states are normalized and validated", () => {
  assert.equal(normalizeStatusState("Running"), "running");
  assert.equal(normalizeStatusState(" waiting "), "waiting");
  assert.equal(normalizeStatusState("ended"), "ended");
  assert.equal(normalizeStatusState("paused"), "");
  assert.equal(normalizeStatusState(null), "");
});

test("adapter status maps onto the thread-list status contract", () => {
  assert.deepEqual(statusFieldsFromOverride({ state: "running", turnId: "t1", startedAtMs: 1234, source: "adapter" }), {
    state: "running",
    thinking: true,
    interactionRequired: false,
    turnId: "t1",
    startedAtMs: 1234,
    statusSource: "adapter"
  });
  const waiting = statusFieldsFromOverride({ state: "waiting", turnId: null, startedAtMs: null, source: "db" });
  assert.equal(waiting.thinking, true);
  assert.equal(waiting.interactionRequired, true);
  const ended = statusFieldsFromOverride({ state: "ended", turnId: null, startedAtMs: null, source: "adapter" });
  assert.equal(ended.thinking, false);
  assert.equal(ended.interactionRequired, false);
});

test("database status overrides require a recent status timestamp", () => {
  const now = Date.now();
  const fresh = statusOverrideFromRow({
    id: "thread-1",
    statusState: "running",
    statusTurnId: "turn-1",
    statusStartedMs: now - 5000,
    statusUpdatedMs: now - 1000
  }, now);
  assert.equal(fresh.state, "running");
  assert.equal(fresh.turnId, "turn-1");
  assert.equal(fresh.source, "db");

  assert.equal(statusOverrideFromRow({
    id: "thread-1",
    statusState: "running",
    statusUpdatedMs: now - 2 * 60 * 60 * 1000
  }, now), null);
  assert.equal(statusOverrideFromRow({ id: "thread-1", statusState: "running" }, now), null);
  assert.equal(statusOverrideFromRow({ id: "thread-1", statusState: "unknown", statusUpdatedMs: now }, now), null);
});

test("adapter status overrides are stored with a TTL and cleared explicitly", () => {
  const record = setAdapterStatusOverride("thread-ttl", {
    state: "waiting",
    turnId: "turn-2",
    ttlMs: 60_000
  });
  assert.equal(record.state, "waiting");
  assert.ok(record.expiresAtMs > Date.now());
  assert.equal(adapterStatusOverrideFor("thread-ttl")?.turnId, "turn-2");
  assert.equal(clearAdapterStatusOverride("thread-ttl"), true);
  assert.equal(adapterStatusOverrideFor("thread-ttl"), null);
});

test("thread list pagination keeps cursors stable and bounded", () => {
  const threads = Array.from({ length: 5 }, (_, index) => ({ id: `t${index}` }));
  assert.deepEqual(threadsPage(threads, { limit: 2 }).threads.map((row) => row.id), ["t0", "t1"]);
  assert.equal(threadsPage(threads, { limit: 2 }).nextCursor, "2");
  assert.equal(threadsPage(threads, { limit: 2, cursor: "2" }).nextCursor, "4");
  assert.equal(threadsPage(threads, { limit: 2, cursor: "4" }).nextCursor, null);
  assert.deepEqual(threadsPage(threads, { limit: 0 }).threads.map((row) => row.id), ["t0", "t1", "t2", "t3", "t4"]);
  assert.equal(normalizeThreadsLimit("9999"), 500);
  assert.equal(normalizeThreadsLimit("0"), 0);
  assert.equal(normalizeThreadsLimit("nope"), 0);
});

test("thread list ETags are weak, stable and matched leniently", () => {
  const etag = weakEtagFor("{\"threads\":[]}");
  assert.match(etag, /^W\/"[A-Za-z0-9_-]{27}"$/);
  assert.equal(weakEtagFor("{\"threads\":[]}"), etag);
  assert.equal(ifNoneMatchMatches(etag, etag), true);
  assert.equal(ifNoneMatchMatches(`"other", ${etag}`, etag), true);
  assert.equal(ifNoneMatchMatches("*", etag), true);
  assert.equal(ifNoneMatchMatches(etag, weakEtagFor("{}")), false);
  assert.equal(ifNoneMatchMatches("", etag), false);
});

test("child processes are launched through the Windows-hidden helpers", () => {
  const source = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  const calls = [...source.matchAll(/\b(execFile|spawn)\(/g)].map((match) => match[0]);
  assert.equal(calls.length, 2);
  assert.match(source, /function execFileHidden\([^)]*\) \{[\s\S]*?windowsHide: true/);
  assert.match(source, /function spawnHidden\([^)]*\) \{[\s\S]*?windowsHide: true/);
  assert.doesNotMatch(source, /windowsHide:\s*false,/);
});
