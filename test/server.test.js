import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { nextMessageLimit, reconcilePendingMessages, retainedScrollTop } from "../public/history.js";

import {
  canExposeLocalFilesForMessage,
  contentDispositionForDownload,
  createRolloutParseState,
  desktopInterruptTurnRequest,
  desktopStartTurnRequest,
  desktopSteerRestoreMessage,
  enqueueSend,
  ipcVersionForMethod,
  ipcVersionForRequest,
  interruptTurnWithOwnerRecovery,
  isSubagentThread,
  isNoActiveTurnError,
  limitMessagesForClient,
  localPathCandidates,
  parseRolloutLine,
  cancelQueuedSend,
  queuedSendIdleDecision,
  queuedSendStatus,
  repairInvalidCustomToolCallIdsInText,
  requestedByteRange,
  rolloutPathForCurrentHome,
  rolloutResultFromState,
  runIdempotentSend,
  refreshCodexDesktopAfterSend,
  runSerializedThreadStart,
  sameFilePath,
  startTurnWithOwnerRecovery,
  stripHiddenMessageLocalAssets,
  threadListMetadata,
  visibleThreadRows
} from "../server.js";

function rolloutLine(timestamp, ordinal, type, payload) {
  return JSON.stringify({ timestamp, ordinal, type, payload });
}

test("thread list hides subagents but preserves a selected legacy subagent", () => {
  const rows = [
    { id: "main", source: "vscode", threadSource: "user" },
    {
      id: "sub-hidden",
      source: JSON.stringify({ subagent: { thread_spawn: { parent_thread_id: "main", depth: 1 } } }),
      threadSource: "subagent"
    },
    { id: "sub-selected", source: "vscode", threadSource: "subagent" }
  ];

  assert.equal(isSubagentThread(rows[0]), false);
  assert.equal(isSubagentThread(rows[1]), true);
  assert.deepEqual(visibleThreadRows(rows, ["sub-selected"]).map((row) => row.id), ["main", "sub-selected"]);
});

test("thread list maps Desktop pin and native or cwd project metadata", () => {
  const pinned = threadListMetadata({
    isPinned: 0,
    threadSectionId: "pinned-section",
    sectionName: "Pinned",
    projectId: "project-1",
    projectName: "Codex Pocket",
    cwd: String.raw`\\?\C:\workspace\ignored`
  });
  const cwdProject = threadListMetadata({
    cwd: String.raw`\\?\C:\Users\WIN10\Documents\ChatGPT\塔罗`
  });

  assert.equal(pinned.pinned, true);
  assert.deepEqual(pinned.project, {
    key: "project:project-1",
    id: "project-1",
    name: "Codex Pocket",
    native: true
  });
  assert.deepEqual(cwdProject.project, {
    key: "cwd:c:\\users\\win10\\documents\\chatgpt\\塔罗",
    id: null,
    name: "塔罗",
    native: false
  });
});

test("older-message pagination grows in bounded pages and preserves the viewport", () => {
  assert.equal(nextMessageLimit(80, { truncated: true, omittedMessages: 120 }), 160);
  assert.equal(nextMessageLimit(80, { hasOlderMessages: true, truncated: false, omittedMessages: 0 }), 160);
  assert.equal(nextMessageLimit(160, { hasOlderMessages: false, truncated: true, omittedMessages: 765 }), null);
  assert.equal(nextMessageLimit(960, { truncated: true, omittedMessages: 120 }), 1000);
  assert.equal(nextMessageLimit(1000, { truncated: true, omittedMessages: 120 }), null);
  assert.equal(nextMessageLimit(80, { truncated: false, omittedMessages: 0 }), null);
  assert.equal(retainedScrollTop({ scrollTop: 12, scrollHeight: 900, nextScrollHeight: 1500 }), 612);
});

test("migrated state rows use the rollout discovered in the active Codex home", () => {
  const row = {
    id: "thread-migrated",
    rolloutPath: "C:\\Users\\WIN10\\.codex\\sessions\\2026\\08\\rollout-thread-migrated.jsonl"
  };
  const current = new Map([["thread-migrated", "D:\\codex\\.codex\\sessions\\2026\\08\\rollout-thread-migrated.jsonl"]]);
  assert.equal(rolloutPathForCurrentHome(row, current), current.get(row.id));
  assert.equal(rolloutPathForCurrentHome({ ...row, id: "other" }, current), row.rolloutPath);
});

test("a real user message replaces a stale optimistic bubble with generated prompt context", () => {
  const pending = [
    {
      id: "pending-1",
      threadId: "thread-1",
      role: "user",
      sentContent: "Use skill: example.\n\n手机端消息",
      content: "Use skill: example.\n\n手机端消息",
      images: []
    }
  ];
  const messages = [{ role: "user", content: "手机端消息", images: [] }];

  assert.deepEqual(reconcilePendingMessages(pending, messages, "thread-1"), []);
});

test("one queued message can be cancelled without clearing the rest", () => {
  const threadId = `queue-test-${Date.now()}`;
  const first = enqueueSend(threadId, "first", [], { model: "gpt-5.6-sol", effort: "medium" });
  const second = enqueueSend(threadId, "second", [], { model: "gpt-5.6-sol", effort: "medium" });

  const result = cancelQueuedSend(threadId, first.queueItem.id);
  assert.equal(result.cancelled, 1);
  assert.equal(result.queueLength, 1);
  assert.deepEqual(queuedSendStatus(threadId).queuedMessages.map((item) => item.text), ["second"]);

  cancelQueuedSend(threadId);
  assert.equal(second.queueLength, 2);
});

test("a queued follow-up waits through a transient idle status before it can be sent", () => {
  const firstIdle = queuedSendIdleDecision(false, null, 10_000, 3_500);
  assert.equal(firstIdle.ready, false);
  assert.equal(firstIdle.idleSinceMs, 10_000);
  assert.equal(firstIdle.retryAfterMs, 3_500);

  const transientIdle = queuedSendIdleDecision(false, firstIdle.idleSinceMs, 13_499, 3_500);
  assert.equal(transientIdle.ready, false);
  assert.equal(transientIdle.retryAfterMs, 1);

  const stableIdle = queuedSendIdleDecision(false, firstIdle.idleSinceMs, 13_500, 3_500);
  assert.equal(stableIdle.ready, true);
  assert.equal(stableIdle.retryAfterMs, 0);

  const activeAgain = queuedSendIdleDecision(true, firstIdle.idleSinceMs, 13_500, 3_500);
  assert.deepEqual(activeAgain, { ready: false, idleSinceMs: null, retryAfterMs: null });
});

test("Desktop no-active-turn errors are recognized as an insert race", () => {
  assert.equal(isNoActiveTurnError(new Error("Cannot steer conversation thread-1 without an active turn id")), true);
  assert.equal(isNoActiveTurnError(new Error("thread-follower-steer-turn timed out")), false);
});

test("duplicate mobile send requests share one in-flight operation", async () => {
  const store = new Map();
  let calls = 0;
  const execute = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { ok: true, queueLength: 1 };
  };

  const [first, second] = await Promise.all([
    runIdempotentSend("request-1", "same-message", execute, store),
    runIdempotentSend("request-1", "same-message", execute, store)
  ]);

  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  await assert.rejects(runIdempotentSend("request-1", "different-message", execute, store), /already used/);
});

test("a successful mobile send refreshes Desktop without stealing another open conversation", async () => {
  const calls = [];
  const client = {
    async refreshRecentConversations(hostId) {
      calls.push(["refresh", hostId]);
    },
    followingConversationState(threadId) {
      return threadId === "thread-following" ? true : false;
    },
    async setActiveConversation(threadId, active, hostId) {
      calls.push(["active", threadId, active, hostId]);
    }
  };

  await refreshCodexDesktopAfterSend("thread-following", client);
  await refreshCodexDesktopAfterSend("thread-other", client);

  assert.deepEqual(calls, [
    ["refresh", "local"],
    ["active", "thread-following", true, "local"],
    ["refresh", "local"]
  ]);
});

test("new turns for one thread are serialized before the second state check", async () => {
  const store = new Map();
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = runSerializedThreadStart(
    "thread-1",
    async () => {
      events.push("first-start");
      await firstGate;
      events.push("first-end");
    },
    store
  );
  const second = runSerializedThreadStart(
    "thread-1",
    async () => {
      events.push("second-start");
    },
    store
  );

  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(events, ["first-start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first-start", "first-end", "second-start"]);
});

test("hidden tool records do not masquerade as older visible messages", () => {
  const messages = [
    { role: "user", content: "visible", lineNumber: 1 },
    ...Array.from({ length: 200 }, (_, index) => ({ role: "tool", content: `tool-${index}`, lineNumber: index + 2 }))
  ];
  const result = limitMessagesForClient(messages, {}, 80);

  assert.equal(result.messages.length, 11);
  assert.equal(result.hiddenMessages, 190);
  assert.equal(result.omittedMessages, 0);
  assert.equal(result.hasOlderMessages, false);
  assert.equal(result.truncated, false);
});

test("a completed turn cannot leave an inferred response-item turn running", () => {
  const nowMs = Date.parse("2026-08-22T02:17:52.000Z");
  const stat = { size: 5_000_000, mtimeMs: nowMs - 100 };
  const state = createRolloutParseState(stat, nowMs);
  const activeTurnId = "01a02742-94f5-7960-a3e7-91d525c6313d";

  const lines = [
    rolloutLine("2026-08-22T02:17:50.120Z", 3097, "event_msg", {
      type: "item_completed",
      turn_id: activeTurnId,
      item: { type: "UserMessage" }
    }),
    rolloutLine("2026-08-22T02:17:50.140Z", 3098, "response_item", {
      type: "reasoning",
      id: "rs_033ebc4a37a725dd016a8886090e4c87d08dad12817033dbf6",
      internal_chat_message_metadata_passthrough: {
        turn_id: "01a0254b-8cec-7817-a68a-b83be70efec4"
      }
    }),
    rolloutLine("2026-08-22T02:17:51.300Z", 3100, "event_msg", {
      type: "task_complete",
      turn_id: activeTurnId,
      error: {
        message: "Invalid input id. Expected an ID that begins with 'ctc'."
      }
    })
  ];

  for (const line of lines) parseRolloutLine(line, state);
  const result = rolloutResultFromState({
    filePath: "fixture.jsonl",
    stat,
    nowMs,
    state,
    partial: true
  });

  assert.equal(result.status.thinking, false);
  assert.equal(result.status.turnId, null);
  assert.equal(result.messages.at(-1)?.kind, "error");
  assert.match(result.messages.at(-1)?.content || "", /Expected an ID that begins with 'ctc'/);
});

test("a quiet long-running tool call remains active in a partial rollout", () => {
  const nowMs = Date.parse("2026-08-22T15:30:08.000Z");
  const stat = { size: 5_000_000, mtimeMs: nowMs - 100_000 };
  const state = createRolloutParseState(stat, nowMs);
  const activeTurnId = "01a02a13-50df-75a1-8292-ab7ccb8fc028";

  parseRolloutLine(
    rolloutLine("2026-08-22T15:25:04.156Z", 304, "event_msg", {
      type: "task_started",
      turn_id: activeTurnId,
      started_at: Date.parse("2026-08-22T15:25:04.000Z") / 1000
    }),
    state
  );
  parseRolloutLine(
    rolloutLine("2026-08-22T15:28:27.252Z", 342, "response_item", {
      type: "function_call",
      id: "fc_wait",
      internal_chat_message_metadata_passthrough: { turn_id: activeTurnId }
    }),
    state
  );

  const result = rolloutResultFromState({
    filePath: "quiet-active-turn.jsonl",
    stat,
    nowMs,
    state,
    partial: true
  });

  assert.equal(result.status.thinking, true);
  assert.equal(result.status.turnId, activeTurnId);
  assert.equal(result.status.staleTurn, false);
});

test("repairs only custom tool calls that incorrectly use an fc id", () => {
  const malformed = rolloutLine("2026-08-21T17:08:31.821Z", 3081, "response_item", {
    type: "custom_tool_call",
    id: "fc_033ebc4a37a725dd016a888609d2c487d0b28f4744284c8f5a",
    call_id: "call_27dKcJoiHBe9S75Ud9HCUTRo",
    name: "exec",
    input: "{}"
  });
  const validFunctionCall = rolloutLine("2026-08-21T17:08:32.000Z", 3082, "response_item", {
    type: "function_call",
    id: "fc_valid_function_call",
    call_id: "call_valid",
    name: "example",
    arguments: "{}"
  });

  const result = repairInvalidCustomToolCallIdsInText(`${malformed}\n${validFunctionCall}\n`);
  const repaired = result.text.trim().split("\n").map((line) => JSON.parse(line));

  assert.equal(result.replacements.length, 1);
  assert.equal(repaired[0].payload.id, "ctc_033ebc4a37a725dd016a888609d2c487d0b28f4744284c8f5a");
  assert.equal(repaired[0].payload.call_id, "call_27dKcJoiHBe9S75Ud9HCUTRo");
  assert.equal(repaired[1].payload.id, "fc_valid_function_call");
});

test("steer requests include the Desktop restore-message context", () => {
  const restoreMessage = desktopSteerRestoreMessage("insert this", "C:\\workspace", "message-id");

  assert.equal(restoreMessage.id, "message-id");
  assert.equal(restoreMessage.cwd, "C:\\workspace");
  assert.equal(restoreMessage.context.prompt, "insert this");
  assert.deepEqual(restoreMessage.context.workspaceRoots, ["C:\\workspace"]);
  assert.deepEqual(restoreMessage.context.commentAttachments, []);
});

test("start-turn requests use the current Desktop IPC v2 envelope", () => {
  const request = desktopStartTurnRequest("thread-123", "hello", []);

  assert.equal(ipcVersionForMethod(request.method), 2);
  assert.equal(request.params.conversationId, "thread-123");
  assert.equal(request.params.turnStart.request.threadId, "thread-123");
  assert.deepEqual(request.params.turnStart.request.input, [{ type: "text", text: "hello", text_elements: [] }]);
  assert.equal(request.params.turnStart.request.model, "gpt-5.6-sol");
  assert.equal(request.params.turnStart.request.effort, "medium");
  assert.deepEqual(request.params.turnStart.context.attachments, []);
  assert.equal(request.params.turnStart.context.inheritThreadSettings, false);
  assert.equal("turnStartParams" in request.params, false);
});

test("start-turn requests preserve the selected model and reasoning effort", () => {
  const request = desktopStartTurnRequest("thread-123", "hello", [], {
    model: "gpt-5.6-terra",
    effort: "xhigh"
  });

  assert.equal(request.params.turnStart.request.model, "gpt-5.6-terra");
  assert.equal(request.params.turnStart.request.effort, "xhigh");
});

test("start-turn requests preserve uploaded images as Desktop data URLs", () => {
  const image = { name: "phone.jpg", mimeType: "image/jpeg", data: "YWJjZA==" };
  const request = desktopStartTurnRequest("thread-123", "inspect this", [image]);

  assert.deepEqual(request.params.turnStart.request.input, [
    { type: "text", text: "inspect this", text_elements: [] },
    { type: "image", url: "data:image/jpeg;base64,YWJjZA==" }
  ]);
});

test("interrupt requests use Desktop v4 with a turn id and v3 without one", () => {
  const active = desktopInterruptTurnRequest("thread-123", "turn-456");
  const fallback = desktopInterruptTurnRequest("thread-123", null);

  assert.equal(ipcVersionForRequest(active.method, active.params), 4);
  assert.deepEqual(active.params, {
    conversationId: "thread-123",
    mode: "user-stop",
    expectedTurnId: "turn-456"
  });
  assert.equal(ipcVersionForRequest(fallback.method, fallback.params), 3);
  assert.deepEqual(fallback.params, {
    conversationId: "thread-123",
    mode: "user-stop"
  });
});

test("start-turn opens the task and retries once after no-client-found", async () => {
  const calls = [];
  const ipcClient = {
    async startTurn() {
      calls.push("start");
      if (calls.filter((call) => call === "start").length === 1) throw new Error("no-client-found");
      return { ok: true };
    },
    async waitForThreadOwner(threadId, options) {
      calls.push(["owner", threadId, options.timeoutMs]);
      return "owner-client";
    }
  };

  const result = await startTurnWithOwnerRecovery(ipcClient, "thread-123", "hello", [], {
    openThread: async (threadId) => calls.push(["open", threadId]),
    ownerTimeoutMs: 3210
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, ["start", ["open", "thread-123"], ["owner", "thread-123", 3210], "start"]);
});

test("interrupt opens the task, refreshes the active turn, and retries after no-client-found", async () => {
  const calls = [];
  const ipcClient = {
    async interruptTurn(threadId, expectedTurnId) {
      calls.push(["interrupt", threadId, expectedTurnId]);
      if (calls.filter(([call]) => call === "interrupt").length === 1) throw new Error("no-client-found");
      return { ok: true };
    },
    async waitForThreadOwner(threadId, options) {
      calls.push(["owner", threadId, options.timeoutMs]);
      return "owner-client";
    }
  };

  const result = await interruptTurnWithOwnerRecovery(ipcClient, "thread-123", "turn-old", {
    openThread: async (threadId) => calls.push(["open", threadId]),
    refreshExpectedTurnId: async () => "turn-current",
    ownerTimeoutMs: 4321
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [
    ["interrupt", "thread-123", "turn-old"],
    ["open", "thread-123"],
    ["owner", "thread-123", 4321],
    ["interrupt", "thread-123", "turn-current"]
  ]);
});

test("start-turn never retries an ambiguous IPC timeout", async () => {
  let startCalls = 0;
  let openCalls = 0;
  const ipcClient = {
    async startTurn() {
      startCalls += 1;
      throw new Error("thread-follower-start-turn timed out");
    }
  };

  await assert.rejects(
    startTurnWithOwnerRecovery(ipcClient, "thread-123", "hello", [], {
      openThread: async () => {
        openCalls += 1;
      }
    }),
    /timed out/
  );
  assert.equal(startCalls, 1);
  assert.equal(openCalls, 0);
});

test("main-module detection follows npm-style directory junctions", () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "codex-companion-main-"));
  const sourceRoot = fileURLToPath(new URL("..", import.meta.url));
  const linkedRoot = path.join(temporaryRoot, "codex-lan-companion");
  try {
    symlinkSync(sourceRoot, linkedRoot, "junction");
    assert.equal(sameFilePath(path.join(linkedRoot, "server.js"), path.join(sourceRoot, "server.js")), true);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("extracts Windows file references and removes line suffixes", () => {
  const paths = localPathCandidates(
    "Open [report](C:\\Users\\WIN10\\Documents\\Quarterly Report.xlsx:42) and <image path=\"C:\\Users\\WIN10\\AppData\\Local\\Temp\\preview.png\">"
  );

  assert.deepEqual(paths, [
    "C:\\Users\\WIN10\\Documents\\Quarterly Report.xlsx",
    "C:\\Users\\WIN10\\AppData\\Local\\Temp\\preview.png"
  ]);
});

test("hidden system and developer messages cannot expose local files", () => {
  assert.equal(canExposeLocalFilesForMessage({ role: "system" }), false);
  assert.equal(canExposeLocalFilesForMessage({ role: "developer" }), false);
  assert.equal(canExposeLocalFilesForMessage({ role: "user" }), true);
  assert.equal(canExposeLocalFilesForMessage({ role: "assistant" }), true);
  assert.equal(canExposeLocalFilesForMessage({ role: "tool" }), true);

  const hidden = stripHiddenMessageLocalAssets({
    role: "developer",
    content: "internal context",
    files: [{ path: "C:\\private.txt" }],
    localImages: ["C:\\private.png"]
  });
  assert.deepEqual(hidden, { role: "developer", content: "internal context" });
});

test("parses single HTTP byte ranges", () => {
  assert.deepEqual(requestedByteRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(requestedByteRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(requestedByteRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.equal(requestedByteRange("bytes=100-120", 100), null);
  assert.equal(requestedByteRange("bytes=30-20", 100), null);
});

test("download responses include ASCII and UTF-8 filename variants", () => {
  const header = contentDispositionForDownload("测试报告.xlsx");

  assert.match(header, /^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
  assert.match(header, /%E6%B5%8B%E8%AF%95%E6%8A%A5%E5%91%8A\.xlsx$/);
});
