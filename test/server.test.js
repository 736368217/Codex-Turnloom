import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { zstdCompressSync } from "node:zlib";

import { messageScrollMode, nextMessageLimit, reconcilePendingMessages, retainedScrollTop, shouldHydrateConversationCache } from "../public/history.js";
import { isConversationCacheFresh } from "../public/conversation-cache.js";

import {
  DesktopCodexIpcClient,
  canExposeLocalFilesForMessage,
  contentDispositionForDownload,
  loginUrlFor,
  loginUrlForProfile,
  modelConfigurationFromCatalog,
  normalizeTurnSettings,
  modelSupportsImages,
  parseCodexModelConfig,
  staticSecurityHeaders,
  withAssetVersions,
  startedThreadTitle,
  rememberStartedThread,
  recentStartedThreadRows,
  authProfileFromRaw,
  statusFieldsFromOverride,
  overrideNeedsRolloutCorroboration,
  overrideLacksCorroboration,
  readPackagedAppVersion,
  threadStatusCandidates,
  readZstdRolloutLines,
  parseRollout,
  createRolloutParseState,
  contextCompactionMessage,
  planMessage,
  desktopInterruptTurnRequest,
  desktopStartTurnRequest,
  desktopSteerRestoreMessage,
  enqueueSend,
  localQueuedSendStatus,
  nativeQueuedSendStatusFromEntries,
  nativeQueueFallbackStatus,
  safeQueuedNativeAttachment,
  restoreLocalImages,
  safeThreadScratchPath,
  appendImageReceipt,
  readImageReceipts,
  ipcVersionForMethod,
  ipcVersionForRequest,
  interruptTurnAndConfirm,
  interruptTurnWithFallback,
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
  sessionIdFromRolloutName,
  rolloutResultFromState,
  runIdempotentSend,
  attemptCodexDesktopRefresh as refreshCodexDesktopAfterSend,
  createDesktopRefreshQueue,
  shouldRecordDesktopRefreshNotice,
  sanitizeThreadGoal,
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

test("active Codex catalog exposes Astra and its supported reasoning levels", () => {
  const config = parseCodexModelConfig(`
model = "gpt-6-astra"
model_catalog_json = "model-catalogs/current.json" # refreshed by Codex Desktop
model_reasoning_effort = "high" # keep the configured default

[model_providers.custom]
model = "must-not-overwrite-the-top-level-model"
  `);
  const catalog = {
    models: [
      {
        slug: "gpt-5.6-sol",
        display_name: "GPT-5.6 Sol",
        visibility: "list",
        priority: 1000,
        default_reasoning_level: "low",
        supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }]
      },
      {
        slug: "codex-auto-review",
        display_name: "Codex Auto Review",
        visibility: "list",
        priority: 1001,
        default_reasoning_level: "medium",
        supported_reasoning_levels: [{ effort: "medium" }]
      },
      {
        slug: "gpt-6-astra",
        display_name: "GPT-6 Astra",
        visibility: "list",
        priority: 1009,
        default_reasoning_level: "medium",
        supported_reasoning_levels: [
          { effort: "low" },
          { effort: "medium" },
          { effort: "high" },
          { effort: "xhigh" }
        ]
      }
    ]
  };

  const result = modelConfigurationFromCatalog(catalog, config);

  assert.equal(config.modelCatalogJson, "model-catalogs/current.json");
  assert.equal(result.defaultModel, "gpt-6-astra");
  assert.equal(result.defaultEffort, "high");
  assert.deepEqual(result.models.map((model) => model.id), ["gpt-5.6-sol", "gpt-6-astra"]);
  assert.deepEqual(result.models.at(-1).efforts, ["low", "medium", "high", "xhigh"]);
  assert.deepEqual(
    normalizeTurnSettings({ model: "gpt-6-astra", effort: "xhigh" }, result),
    { model: "gpt-6-astra", effort: "xhigh" }
  );
  assert.deepEqual(
    normalizeTurnSettings({ model: "gpt-6-astra", effort: "ultra" }, result),
    { model: "gpt-6-astra", effort: "high" }
  );
  assert.equal(modelConfigurationFromCatalog({ models: [] }, config).source, "fallback");
});

test("thread list hides subagents even when a hidden task was selected", () => {

// 真机事故：手机端把图片发给只有 text 能力的模型（cn:hy4），桥再按模型 slug
// 去修会话，最终整条会话被 No provider configured 拖垮。能力必须从 catalog
// 的 input_modalities 透出来，发送前就能拦住。
test("model capability distinguishes text-only from image-capable models", () => {
  const catalog = {
    models: [
      {
        slug: "krisphyn（model1）/cn:hy4",
        display_name: "cn:hy4",
        visibility: "list",
        input_modalities: ["text"],
        supported_reasoning_levels: [{ effort: "high" }]
      },
      {
        slug: "wb反代/hy4free",
        display_name: "hy4free",
        visibility: "list",
        input_modalities: ["text", "image"],
        supported_reasoning_levels: [{ effort: "high" }]
      }
    ]
  };
  const result = modelConfigurationFromCatalog(catalog, {});
  assert.equal(result.models.find((m) => m.id === "krisphyn（model1）/cn:hy4").supportsImages, false);
  assert.equal(result.models.find((m) => m.id === "wb反代/hy4free").supportsImages, true);
  assert.equal(modelSupportsImages("krisphyn（model1）/cn:hy4", result), false);
  assert.equal(modelSupportsImages("wb反代/hy4free", result), true);
  // 未知模型不误拦：宁可让宿主报真实错误，也不把用户挡在门外。
  assert.equal(modelSupportsImages("unknown/model", result), true);
});
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
  assert.deepEqual(visibleThreadRows(rows, ["sub-selected"]).map((row) => row.id), ["main"]);
});

test("context compaction rollout items become safe timeline notices", () => {
  const state = createRolloutParseState({ mtimeMs: Date.now(), size: 1 }, Date.now());
  parseRolloutLine(rolloutLine("2026-08-22T02:14:50.951Z", 1, "event_msg", {
    type: "item_completed",
    thread_id: "thread-1",
    turn_id: "turn-1",
    item: { type: "ContextCompaction", id: "compaction-1" }
  }), state);
  const result = rolloutResultFromState({ filePath: "", stat: { mtimeMs: Date.now(), size: 1 }, nowMs: Date.now(), state });
  assert.equal(result.messages[0].kind, "context_compaction");
  assert.match(result.messages[0].content, /压缩/);
  assert.equal(contextCompactionMessage("2026-08-22T02:14:50.951Z", { type: "message" }), null);
});

test("Desktop plan events become a compact plan notice", () => {
  const message = planMessage("2026-08-30T00:00:00.000Z", {
    type: "turn_plan_updated",
    plan: [{ status: "completed", step: "检查状态" }, { status: "inProgress", step: "修复问题" }]
  });
  assert.equal(message.kind, "plan");
  assert.match(message.content, /\[x\] 检查状态/);
  assert.match(message.content, /\[>\] 修复问题/);
});

test("thread list matches Desktop projects from unique roots and preserves explicit assignments", () => {
  const pinned = threadListMetadata({
    isPinned: 0,
    threadSectionId: "pinned-section",
    sectionName: "Pinned",
    projectId: "project-1",
    projectName: "Codex Pocket",
    cwd: String.raw`\\?\C:\workspace\ignored`
  });
  const ungrouped = threadListMetadata({
    cwd: String.raw`\\?\C:\Users\demo\Documents\workspace\sample-project\示例项目`
  }, new Map([
    ["c:\\users\\demo\\documents\\workspace\\sample-project", [
      { key: "project:sample", id: "project-sample", name: "示例项目", native: true, root: String.raw`C:\Users\demo\Documents\workspace\sample-project` }
    ]]
  ]));

  assert.equal(pinned.pinned, true);
  assert.deepEqual(pinned.project, {
    key: "project:project-1",
    id: "project-1",
    name: "Codex Pocket",
    native: true
  });
  assert.deepEqual(ungrouped.project, {
    key: "project:sample",
    id: "project-sample",
    name: "示例项目",
    native: true,
    root: String.raw`C:\Users\demo\Documents\workspace\sample-project`
  });

  const sampleProject = { key: "project:sample", id: "project-sample", name: "示例项目", native: true };
  const archiveProject = { key: "project:archive", id: "project-archive", name: "归档", native: true };
  const projectRoots = new Map([
    ["c:\\users\\demo\\documents\\workspace\\sample-project", [sampleProject]],
    ["c:\\users\\demo\\documents\\workspace\\sample-project\\archive", [archiveProject]]
  ]);
  assert.deepEqual(
    threadListMetadata({ cwd: String.raw`\\?\C:\Users\demo\Documents\workspace\sample-project\archive\2026` }, projectRoots).project,
    {
      key: "project:archive",
      id: "project-archive",
      name: "归档",
      native: true
    }
  );
  assert.equal(threadListMetadata({ cwd: String.raw`\\?\C:\Users\demo\Documents\workspace\other-project` }, projectRoots).project, null);

  const explicitlyAssignedElsewhere = threadListMetadata({
    projectId: "project-explicit",
    projectName: "明确项目",
    cwd: String.raw`\\?\C:\Users\demo\Documents\workspace\sample-project\archive\2026`
  }, projectRoots);
  assert.equal(explicitlyAssignedElsewhere.project.id, "project-explicit");

  const unresolvedExplicitProject = threadListMetadata({
    projectId: "project-missing-name",
    cwd: String.raw`\\?\C:\Users\demo\Documents\workspace\sample-project\archive\2026`
  }, projectRoots);
  assert.equal(unresolvedExplicitProject.project, null);

  const duplicateRootProjects = new Map([
    ["c:\\users\\demo\\documents\\workspace\\shared-directory", [
      { key: "project:first", id: "project-first", name: "项目一", native: true },
      { key: "project:second", id: "project-second", name: "父项目\\共享目录", native: true }
    ]]
  ]);
  assert.equal(threadListMetadata({ cwd: String.raw`\\?\C:\Users\demo\Documents\workspace\shared-directory` }, duplicateRootProjects).project, null);

  const duplicatedSameProject = new Map([["c:\\users\\demo\\documents\\workspace\\duplicate", [sampleProject, { ...sampleProject }]]]);
  assert.deepEqual(
    threadListMetadata({ cwd: String.raw`\\?\C:\Users\demo\Documents\workspace\duplicate\nested` }, duplicatedSameProject).project,
    sampleProject
  );
});

test("thread list uses Desktop global project assignments before cwd fallback", () => {
  const globalProjects = {
    byThread: new Map([[
      "thread-control",
      { key: "project:control", id: "project-control", name: "控制隔壁电脑", native: true }
    ]])
  };
  assert.deepEqual(
    threadListMetadata({ id: "thread-control", cwd: "C:\\Users\\demo\\Documents\\Codex" }, new Map(), globalProjects).project,
    globalProjects.byThread.get("thread-control")
  );
});

test("message cursor returns an earlier page without retransmitting the latest tail", () => {
  const messages = Array.from({ length: 65 }, (_, index) => ({
    id: `message-${index}`,
    role: "assistant",
    timestamp: `2026-10-02T00:00:${String(index).padStart(2, "0")}.000Z`,
    content: `message ${index}`,
    lineNumber: index + 1
  }));
  const latest = limitMessagesForClient(messages, {}, 40);
  assert.equal(latest.messages.length, 40);
  assert.equal(latest.messages[0].id, "message-25");
  assert.equal(latest.hasOlderMessages, true);
  const older = limitMessagesForClient(messages, {}, 40, latest.olderCursor);
  assert.equal(older.messages.length, 25);
  assert.equal(older.messages[0].id, "message-0");
  assert.equal(older.hasOlderMessages, false);
});

test("subagent visibility recognizes spawn edges, agent paths, and agent-created threads", () => {
  assert.equal(isSubagentThread({ hasSpawnParent: 1 }), true);
  assert.equal(isSubagentThread({ agentPath: "/root/audit" }), true);
  assert.equal(isSubagentThread({ threadSource: "agent_created_thread" }), true);
  assert.equal(isSubagentThread({ threadSource: "user", cwd: "C:\\work" }), false);
});

test("older-message pagination grows in bounded pages and preserves the viewport", () => {
  assert.equal(nextMessageLimit(40, { truncated: true, omittedMessages: 120 }), 80);
  assert.equal(nextMessageLimit(40, { hasOlderMessages: true, truncated: false, omittedMessages: 0 }), 80);
  assert.equal(nextMessageLimit(80, { hasOlderMessages: false, truncated: true, omittedMessages: 765 }), null);
  assert.equal(nextMessageLimit(960, { truncated: true, omittedMessages: 120 }), 1000);
  assert.equal(nextMessageLimit(1000, { truncated: true, omittedMessages: 120 }), null);
  assert.equal(nextMessageLimit(40, { truncated: false, omittedMessages: 0 }), null);
  assert.equal(retainedScrollTop({ scrollTop: 12, scrollHeight: 900, nextScrollHeight: 1500 }), 612);
});

test("opening a cached conversation starts at the latest messages without disrupting history reads", () => {
  assert.equal(messageScrollMode({ cacheHydration: true, wasNearBottom: false }), "latest");
  assert.equal(messageScrollMode({ force: false, wasNearBottom: true }), "latest");
  assert.equal(messageScrollMode({ force: false, wasNearBottom: false }), "keep");
  assert.equal(messageScrollMode({ preserveScrollPosition: true, cacheHydration: true, force: true, wasNearBottom: true }), "retain");
  assert.equal(shouldHydrateConversationCache({ preserveScrollPosition: true }), false);
  assert.equal(shouldHydrateConversationCache({ preserveScrollPosition: false }), true);
});

test("migrated state rows use the rollout discovered in the active Codex home", () => {
  const row = {
    id: "thread-migrated",
    rolloutPath: "C:\\Users\\demo\\.codex\\sessions\\2026\\08\\rollout-thread-migrated.jsonl"
  };
  const current = new Map([["thread-migrated", "Codex 数据目录\\.codex\\sessions\\2026\\08\\rollout-thread-migrated.jsonl"]]);
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

test("a text-only host rollout does not discard a successfully sent image", () => {
  const pending = [{
    id: "pending-image",
    threadId: "thread-image",
    role: "user",
    sentContent: "请看这张图",
    content: "请看这张图",
    images: ["data:image/jpeg;base64,AAAA"],
    deliveryStatus: "sending"
  }];
  const hostMessages = [{ role: "user", content: "请看这张图", images: [] }];
  assert.equal(reconcilePendingMessages(pending, hostMessages, "thread-image").length, 1);
  const confirmedMessages = [{ role: "user", content: "请看这张图", images: ["data:image/jpeg;base64,AAAA"] }];
  assert.deepEqual(reconcilePendingMessages(pending, confirmedMessages, "thread-image"), []);
});
test("one queued message can be cancelled without clearing the rest", async () => {
  const threadId = `queue-test-${Date.now()}`;
  const first = await enqueueSend(threadId, "first", [], { model: "gpt-5.6-sol", effort: "medium" });
  const second = await enqueueSend(threadId, "second", [], { model: "gpt-5.6-sol", effort: "medium" });

  const result = await cancelQueuedSend(threadId, first.queueItem.id);
  assert.equal(result.cancelled, 1);
  assert.equal(result.queueLength, 1);
  assert.deepEqual(localQueuedSendStatus(threadId).queuedMessages.map((item) => item.text), ["second"]);

  await cancelQueuedSend(threadId);
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
  assert.equal(isNoActiveTurnError(new Error("Cannot steer conversation thread-1 because its active turn already ended")), true);
  assert.equal(isNoActiveTurnError(new Error("thread-follower-steer-turn timed out")), false);
});

test("session rollout discovery accepts turn-suffixed rollout filenames", () => {
  assert.equal(
    sessionIdFromRolloutName("rollout-2026-09-23T17-40-06-01a0a883-2b0b-7943-9dd6-1eb94593ed3f_01a0cda2-fd13-7363-8c63-6a974ee4bc8e.jsonl"),
    "01a0a883-2b0b-7943-9dd6-1eb94593ed3f"
  );
  assert.equal(
    sessionIdFromRolloutName("rollout-2026-08-22T10-10-53-01a0273c-38f8-7ce1-8742-eed595f84ab3.jsonl"),
    "01a0273c-38f8-7ce1-8742-eed595f84ab3"
  );
});

test("conversation cache is rejected when the thread list has newer data", () => {
  assert.equal(
    isConversationCacheFresh(
      { thread: { updatedAtMs: 1000 } },
      { id: "thread-1", updatedAtMs: 2000 }
    ),
    false
  );
  assert.equal(
    isConversationCacheFresh(
      { thread: { updatedAtMs: 2000 } },
      { id: "thread-1", updatedAtMs: 2000 }
    ),
    true
  );
});

test("queued message status exposes image previews", async () => {
  const threadId = `queue-image-test-${Date.now()}`;
  await enqueueSend(threadId, "with image", [
    { name: "sample.png", mimeType: "image/png", data: "aGVsbG8=", size: 5 }
  ], { model: "gpt-6-astra", effort: "medium" });
  const item = localQueuedSendStatus(threadId).queuedMessages[0];
  assert.equal(item.imageCount, 1);
  assert.equal(item.images[0].name, "sample.png");
  await cancelQueuedSend(threadId);
});

test("PI native queue preserves authoritative order and priority", () => {
  const entries = [
    { id: "desktop-1", sessionId: "thread-1", content: "桌面先排", position: 1, createdAt: "2026-11-05T10:00:00.000Z" },
    { id: "phone-2", sessionId: "thread-1", content: "手机后排", position: 2, createdAt: "2026-11-05T10:00:01.000Z" },
    { id: "priority-3", sessionId: "thread-1", content: "插队", position: 3, priority: 1, createdAt: "2026-11-05T10:00:02.000Z" }
  ];
  const status = nativeQueuedSendStatusFromEntries("thread-1", entries);
  assert.equal(status.queueLength, 3);
  assert.deepEqual(status.queuedMessages.map((item) => item.id), ["desktop-1", "phone-2", "priority-3"]);
  assert.equal(status.queuedMessages[0].source, "pi-native");
  assert.equal(status.queuedMessages[2].priority, 1);
  assert.equal(status.queuedMessages[2].preview.includes("插队"), true);
});

test("rollout user messages preserve multiple inline images", () => {
  const state = createRolloutParseState({ size: 0, mtimeMs: Date.now() }, Date.now());
  const first = "aGVsbG8=";
  const second = "d29ybGQ=";
  parseRolloutLine(
    rolloutLine(new Date().toISOString(), 1, "event_msg", {
      type: "user_message",
      message: "two images",
      images: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: first } },
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: second } }
      ]
    }),
    state
  );
  const result = rolloutResultFromState({
    filePath: "fixture.jsonl",
    stat: { size: 1, mtimeMs: Date.now() },
    nowMs: Date.now(),
    state
  });
  const message = result.messages.find((entry) => entry.role === "user");
  assert.equal(message.images.length, 2);
  assert.equal(message.images[0], `data:image/png;base64,${first}`);
  assert.equal(message.images[1], `data:image/jpeg;base64,${second}`);
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

test("background Desktop refresh never activates or opens a conversation", async () => {
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

  await refreshCodexDesktopAfterSend("thread-following", client, { waitForPersistence: async () => true });
  await refreshCodexDesktopAfterSend("thread-other", client, { waitForPersistence: async () => true });

  assert.deepEqual(calls, [
    ["refresh", "local"],
    ["refresh", "local"]
  ]);
});

test("Desktop refresh waits for the new turn to persist before refreshing the list", async () => {
  const calls = [];
  const client = {
    async refreshRecentConversations() {
      calls.push("refresh");
      throw new Error("no-client-found");
    },
    followingConversationState() {
      return true;
    },
    async setActiveConversation() {
      calls.push("active");
    }
  };
  const result = await refreshCodexDesktopAfterSend("thread-1", client, {
    turnId: "turn-1",
    waitForPersistence: async (threadId, turnId) => {
      calls.push(["persist", threadId, turnId]);
      return true;
    }
  });
  assert.equal(result.persisted, true);
  assert.deepEqual(calls, [["persist", "thread-1", "turn-1"], "refresh", "refresh"]);
});

test("background Desktop refresh never launches a Codex deep link", async () => {
  const calls = [];
  const client = {
    async refreshRecentConversations() {
      throw new Error("no-client-found");
    }
  };

  await refreshCodexDesktopAfterSend("thread-1", client, {
    waitForPersistence: async () => true,
    openThread: async (threadId) => calls.push(["open", threadId]),
    setActiveConversation: async (threadId) => calls.push(["active", threadId])
  });

  assert.deepEqual(calls, []);
});

test("routine no-client-found refresh failures stay out of the conversation timeline", () => {
  assert.equal(shouldRecordDesktopRefreshNotice(["refresh: no-client-found", "refresh: no-client-found"]), false);
  assert.equal(shouldRecordDesktopRefreshNotice(["refresh: no-client-found", "set active: permission denied"]), true);
});

test("Desktop refresh retries after an unavailable desktop without resending a message", async () => {
  let available = false;
  let calls = 0;
  const queue = createDesktopRefreshQueue(async () => {
    calls += 1;
    if (!available) throw new Error("no-client-found");
    return { refreshed: true, persisted: true, failures: [] };
  });
  try {
    await queue.enqueue("thread-1", {}, { turnId: "turn-1" });
    assert.equal(queue.pending.size, 1);
    available = true;
    await queue.flush();
    assert.equal(calls, 2);
    assert.equal(queue.pending.size, 0);
  } finally {
    queue.close();
  }
});

test("Desktop refresh keeps a newer send queued when an older refresh finishes", async () => {
  let release;
  const queue = createDesktopRefreshQueue(() => new Promise((resolve) => { release = resolve; }));
  try {
    const first = queue.enqueue("thread-1", {}, { turnId: "old" });
    await queue.enqueue("thread-1", {}, { turnId: "new" });
    release({ refreshed: true, persisted: true, failures: [] });
    await first;
    assert.equal(queue.pending.get("thread-1").options.turnId, "new");
  } finally {
    queue.close();
  }
});

test("concurrent IPC callers share one connection attempt", async () => {
  const client = new DesktopCodexIpcClient();
  let attempts = 0;
  client.connect = async () => {
    attempts += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { resultType: "success" };
  };
  await Promise.all(Array.from({ length: 20 }, () => client.ensureReady()));
  assert.equal(attempts, 1);
  client.close();
});

test("turn dispatch allows slow Desktop responses without using the short control timeout", async () => {
  const client = new DesktopCodexIpcClient();
  const calls = [];
  client.ensureReady = async () => {};
  client.request = async (method, params, options) => {
    calls.push({ method, options });
    return { resultType: "success", result: { turn: { id: "turn-1" } } };
  };
  await client.startTurn("thread-1", "hello", [], {});
  await client.steerTurn("thread-1", "follow up", []);
  assert.equal(calls[0].options.timeoutMs, 60_000);
  assert.equal(calls[1].options.timeoutMs, 60_000);
});

test("IPC permission failure clears the failed socket and can recover after cooldown", async () => {
  const client = new DesktopCodexIpcClient();
  let destroyed = false;
  let attempts = 0;
  client.connect = async () => {
    attempts += 1;
    if (attempts > 1) return { resultType: "success" };
    client.socket = {
      writable: true,
      removeAllListeners() {},
      destroy() { destroyed = true; }
    };
    throw Object.assign(new Error("connect EPERM"), { code: "EPERM" });
  };
  await assert.rejects(client.ensureReady(), /EPERM/);
  assert.equal(destroyed, true);
  assert.equal(client.ready, null);
  assert.equal(client.socket, null);
  await assert.rejects(client.ensureReady(), /EPERM/);
  assert.equal(attempts, 1);
  client.retryConnectionAt = 0;
  await client.ensureReady();
  assert.equal(attempts, 2);
  client.close();
});

test("an IPC timeout discards the unresponsive pipe and the next request reconnects", async () => {
  const client = new DesktopCodexIpcClient();
  let destroyed = false;
  let writes = 0;
  client.socket = {
    writable: true,
    write() { writes += 1; },
    removeAllListeners() {},
    destroy() { destroyed = true; }
  };
  client.ready = Promise.resolve();
  await assert.rejects(client.request("refresh-recent-conversations-for-host", {}, { timeoutMs: 5 }), /timed out/);
  assert.equal(destroyed, true);
  assert.equal(client.socket, null);
  assert.equal(client.ready, null);
  assert.equal(client.pending.size, 0);
  let connections = 0;
  client.connect = async () => { connections += 1; };
  await client.ensureReady();
  assert.equal(connections, 1);
  assert.equal(writes, 1);
});

test("Desktop goal statuses from the goal store are normalized for mobile", () => {
  assert.deepEqual(sanitizeThreadGoal({ threadId: "thread-1", objective: "保留目标", status: "paused" }), {
    threadId: "thread-1",
    objective: "保留目标",
    status: "paused",
    createdAt: null,
    updatedAt: null
  });
  assert.equal(sanitizeThreadGoal({ objective: "受限", status: "usage_limited" }).status, "usageLimited");
  assert.equal(sanitizeThreadGoal({ objective: "预算", status: "budget_limited" }).status, "budgetLimited");
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
    model: "gpt-6-astra",
    effort: "high"
  });

  assert.equal(request.params.turnStart.request.model, "gpt-6-astra");
  assert.equal(request.params.turnStart.request.effort, "high");
});

test("mobile turns preserve models that exist only in the active Desktop catalog", async () => {
  const calls = [];
  const client = {
    async startTurn(threadId, text, images, settings, options) {
      calls.push(["start", threadId, text, settings, options || null]);
      return { result: { turn: { id: "turn-1" } } };
    }
  };

  await startTurnWithOwnerRecovery(client, "thread-1", "hello", [], {
    model: "gpt-6-astra",
    effort: "high"
  });

  assert.deepEqual(calls, [
    ["start", "thread-1", "hello", { model: "gpt-6-astra", effort: "high" }, null]
  ]);
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
  let startCalls = 0;
  const ipcClient = {
    async startTurn(threadId, text, images, settings, options) {
      startCalls += 1;
      calls.push(["start", threadId, text, options || {}]);
      if (startCalls === 1) throw new Error("no-client-found");
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
  assert.deepEqual(calls, [
    ["start", "thread-123", "hello", {}],
    ["open", "thread-123"],
    ["owner", "thread-123", 3210],
    ["start", "thread-123", "hello", { targetClientId: "owner-client" }]
  ]);
});

test("IPC requests can target the discovered Desktop owner", async () => {
  const client = new DesktopCodexIpcClient();
  let sentMessage = null;
  client.clientId = "companion-client";
  client.socket = {
    writable: true,
    write(frame) {
      const length = frame.readUInt32LE(0);
      sentMessage = JSON.parse(frame.subarray(4, 4 + length).toString("utf8"));
    },
    removeAllListeners() {},
    end() {},
    destroy() {}
  };
  const responsePromise = client.request(
    "thread-follower-start-turn",
    { conversationId: "thread-123", hostId: "local" },
    { targetClientId: "owner-client" }
  );

  assert.equal(sentMessage.sourceClientId, "companion-client");
  assert.equal(sentMessage.targetClientId, "owner-client");
  assert.equal(sentMessage.hostId, undefined);
  assert.equal(sentMessage.version, 2);
  client.handleMessage({
    type: "response",
    requestId: sentMessage.requestId,
    resultType: "success",
    method: sentMessage.method,
    result: { ok: true }
  });
  assert.equal((await responsePromise).result.ok, true);
  client.close();
});

test("remote Desktop follower requests use the routed host protocol version", async () => {
  const client = new DesktopCodexIpcClient();
  let sentMessage = null;
  client.clientId = "companion-client";
  client.socket = {
    writable: true,
    write(frame) {
      const length = frame.readUInt32LE(0);
      sentMessage = JSON.parse(frame.subarray(4, 4 + length).toString("utf8"));
    },
    removeAllListeners() {},
    end() {},
    destroy() {}
  };
  const responsePromise = client.request("thread-follower-start-turn", {
    conversationId: "thread-123",
    hostId: "remote-host"
  });

  assert.equal(sentMessage.hostId, "remote-host");
  assert.equal(sentMessage.version, 3);
  client.handleMessage({
    type: "response",
    requestId: sentMessage.requestId,
    resultType: "success",
    method: sentMessage.method,
    result: { ok: true }
  });
  assert.equal((await responsePromise).result.ok, true);
  client.close();
});

test("interrupt opens the task, refreshes the active turn, and retries after no-client-found", async () => {
  const calls = [];
  const ipcClient = {
    async interruptTurn(threadId, expectedTurnId, options) {
      calls.push(["interrupt", threadId, expectedTurnId, options || {}]);
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
    ["interrupt", "thread-123", "turn-old", {}],
    ["open", "thread-123"],
    ["owner", "thread-123", 4321],
    ["interrupt", "thread-123", "turn-current", { targetClientId: "owner-client" }]
  ]);
});

test("interrupt retries without a stale expected turn id", async () => {
  const calls = [];
  const ipcClient = {
    async interruptTurn(threadId, expectedTurnId) {
      calls.push([threadId, expectedTurnId]);
      if (calls.length === 1) throw new Error("expected turn id mismatch");
      return { ok: true };
    }
  };

  assert.deepEqual(await interruptTurnWithFallback(ipcClient, "thread-123", "turn-old"), { ok: true });
  assert.deepEqual(calls, [["thread-123", "turn-old"], ["thread-123", null]]);
});

test("interrupt retries when Desktop acknowledges without interrupting a turn", async () => {
  const calls = [];
  const ipcClient = {
    async interruptTurn(threadId, expectedTurnId) {
      calls.push([threadId, expectedTurnId]);
      if (calls.length === 1) {
        return { resultType: "success", result: { ok: true, interruptedTurnId: null } };
      }
      return { resultType: "success", result: { ok: true, interruptedTurnId: "turn-old" } };
    }
  };

  assert.deepEqual(
    await interruptTurnWithFallback(ipcClient, "thread-123", "turn-old"),
    { resultType: "success", result: { ok: true, interruptedTurnId: "turn-old" } }
  );
  assert.deepEqual(calls, [["thread-123", "turn-old"], ["thread-123", null]]);
});

test("interrupt does not report success while the original turn remains active", async () => {
  const ipcClient = {
    async interruptTurn() {
      return { resultType: "success", result: { ok: true, interruptedTurnId: null } };
    }
  };

  await assert.rejects(
    interruptTurnAndConfirm(ipcClient, "thread-123", { thinking: true, turnId: "turn-old" }, {
      readStatus: async () => ({ thinking: true, turnId: "turn-old" }),
      beforeStatusRead: () => {},
      attempts: 2,
      intervalMs: 0,
      sleepFn: async () => {}
    }),
    (error) => error?.status === 409 && /still running/i.test(error.message)
  );
});

test("interrupt succeeds after status confirms the original turn stopped", async () => {
  const statuses = [
    { thinking: true, turnId: "turn-old" },
    { thinking: false, turnId: null }
  ];
  const ipcClient = {
    async interruptTurn() {
      return { resultType: "success", result: { ok: true, interruptedTurnId: "turn-old" } };
    }
  };

  const result = await interruptTurnAndConfirm(ipcClient, "thread-123", { thinking: true, turnId: "turn-old" }, {
    readStatus: async () => statuses.shift(),
    beforeStatusRead: () => {},
    attempts: 2,
    intervalMs: 0,
    sleepFn: async () => {}
  });

  assert.equal(result.confirmed, true);
  assert.equal(result.status.thinking, false);
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
    "Open [report](C:\\Users\\demo\\Documents\\workspace\\report.xlsx:42) and <image path=\"C:\\Users\\demo\\AppData\\Local\\Temp\\preview.png\">"
  );

  assert.deepEqual(paths, [
    "C:\\Users\\demo\\Documents\\workspace\\report.xlsx",
    "C:\\Users\\demo\\AppData\\Local\\Temp\\preview.png"
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

test("static responses include baseline browser isolation headers", () => {
  assert.equal(staticSecurityHeaders["x-content-type-options"], "nosniff");
  assert.equal(staticSecurityHeaders["x-frame-options"], "DENY");
  assert.match(staticSecurityHeaders["content-security-policy"], /frame-ancestors 'none'/);
  assert.equal(staticSecurityHeaders["referrer-policy"], "strict-origin-when-cross-origin");
});

test("login QR URLs keep access codes in the fragment", () => {
  const url = new URL(loginUrlFor("https://office.example.com/"));
  assert.equal(url.search, "");
  assert.match(url.hash, /^#login=/);
});

test("profile login URLs use the short-lived session exchange route", () => {
  const url = new URL(loginUrlForProfile("https://office.example.com/", { id: "p1" }));
  assert.equal(url.pathname, "/login");
  assert.equal(url.searchParams.get("device"), "p1");
  assert.ok(url.searchParams.get("token"));
  assert.equal(url.hash, "");
});

test("mobile composer does not clip the model picker overlay", () => {
  const styles = readFileSync(path.join(fileURLToPath(new URL("..", import.meta.url)), "public", "styles.css"), "utf8");
  const composerLeftRules = [...styles.matchAll(/\.composer-left\s*\{([^}]*)\}/g)].map((match) => match[1]);
  assert.ok(composerLeftRules.length, "expected a composer-left rule");
  assert.ok(composerLeftRules.some((rule) => /overflow:\s*visible\s*;/.test(rule)));
  assert.ok(composerLeftRules.every((rule) => !/overflow:\s*hidden\s*;/.test(rule)));
});

test("served HTML references versioned local assets so upgrades cannot reuse stale JS/CSS", async () => {
  const html = [
    "<link rel=\"stylesheet\" href=\"/styles.css\" />",
    "<script src=\"/vendor/marked.umd.js\"></script>",
    "<script src=\"/app.js\" type=\"module\"></script>"
  ].join("\n");

  const stamped = await withAssetVersions(html);

  assert.match(stamped, /href="\/styles\.css\?v=[0-9a-z-]+"/);
  assert.match(stamped, /src="\/app\.js\?v=[0-9a-z-]+"/);
  assert.match(stamped, /src="\/vendor\/marked\.umd\.js\?v=[0-9a-z-]+"/);
  assert.equal(stamped.split('src="/app.js?v=').length, 2, "expected exactly one versioned app.js reference");
});

test("every local asset in index.html can be stamped with a cache-busting version", () => {
  const html = readFileSync(path.join(fileURLToPath(new URL("..", import.meta.url)), "public", "index.html"), "utf8");
  const refs = [...html.matchAll(/(?:href|src)="(\/[^"]+\.(?:css|js)[^"]*)"/g)].map((m) => m[1]);

  assert.ok(refs.length >= 3, "expected the stylesheets and app.js to be referenced");
  // withAssetVersions only matches refs with no query string, so a hand-written
  // "?v=..." pins that file to one URL forever and silently defeats cache busting
  // (a real regression: styles.v3.css was stuck on the version it shipped with).
  assert.deepEqual(
    refs.filter((ref) => ref.includes("?")),
    [],
    "local css/js refs must stay bare so the server can stamp them"
  );
});

test("load failures offer an explicit retry affordance", () => {
  const styles = readFileSync(path.join(fileURLToPath(new URL("..", import.meta.url)), "public", "styles.css"), "utf8");
  const app = readFileSync(path.join(fileURLToPath(new URL("..", import.meta.url)), "public", "app.js"), "utf8");

  assert.match(styles, /\.empty-state-retry\s*\{[^}]*min-height:\s*44px/);
  assert.match(app, /data-load-retry/);
  assert.match(app, /function friendlyErrorMessage/, "expected a shared formatter for transport errors");
  assert.ok(!/empty-state">\$\{escapeHtml\(error\.message\)\}/.test(app), "raw error.message must not be rendered in the message list");
});

test("an empty or truncated auth.json degrades to no account instead of a 500", () => {
  assert.deepEqual(authProfileFromRaw(""), {});
  assert.deepEqual(authProfileFromRaw("   \n"), {});
  assert.deepEqual(authProfileFromRaw('{"tokens":'), {});
  assert.deepEqual(authProfileFromRaw("[]"), {});
  assert.deepEqual(authProfileFromRaw("null"), {});

  const jwt = (claims) =>
    `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;
  const profile = authProfileFromRaw(
    JSON.stringify({
      auth_mode: "chatgpt",
      tokens: { id_token: jwt({ email: "pilot@example.com", sub: "u1" }) }
    })
  );
  assert.equal(profile.email, "pilot@example.com");
  assert.equal(profile.sub, "u1");
  assert.equal(profile.authMode, "chatgpt");
});

test("large model catalogues default to models this machine actually uses", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const html = readFileSync(path.join(root, "public", "index.html"), "utf8");
  const app = readFileSync(path.join(root, "public", "app.js"), "utf8");
  const server = readFileSync(path.join(root, "server.js"), "utf8");

  // 供应商自动发现的 240 个模型不该一上来全平铺给用户。
  assert.match(html, /id="modelList"/, "expected an in-app model list instead of a native select");
  assert.match(html, /id="modelScopeButton"/, "expected an explicit 'show all' switch");
  assert.match(html, /id="modelFilter"[^>]*placeholder="搜索模型或供应商"/);
  assert.match(app, /usedModelIds/, "the client must scope models by the used list");
  assert.match(app, /state\.showAllModels/, "the client needs an explicit all-models mode");
  assert.match(server, /async function usedModelIds\(/, "the server must derive used models from the facade DB");
  assert.match(server, /usedModelIds: usedModels/, "health must carry the used-model ids");
});

test("a conversation started from the phone stays visible until Desktop lists it", () => {
  rememberStartedThread({
    id: "started-1",
    title: startedThreadTitle("line one\nline two"),
    createdAtMs: 1,
    updatedAtMs: 2,
    rolloutPath: "",
    source: "desktop-ipc"
  });

  const rows = recentStartedThreadRows();
  const row = rows.find((entry) => entry.id === "started-1");
  assert.ok(row, "expected the started thread to be remembered");
  assert.equal(row.title, "line one", "title must come from the first non-empty line");
  assert.equal(row.rolloutPath, "", "a new conversation has no rollout file yet");
});

test("started thread titles stay short and readable", () => {
  assert.equal(startedThreadTitle(""), "新对话");
  assert.equal(startedThreadTitle("   \n  \n"), "新对话");
  assert.equal(startedThreadTitle("  hello   world  "), "hello world");
  const long = startedThreadTitle("x".repeat(80));
  assert.equal(long.length, 41, "long titles are cut to 40 characters plus an ellipsis");
  assert.ok(long.endsWith("…"));
});

test("styles.css never leaves a declaration outside a rule", () => {
  // A stray declaration at top level makes the CSS parser skip forward to the next
  // closing brace, which silently kills the whole following @media block.
  const styles = readFileSync(path.join(fileURLToPath(new URL("..", import.meta.url)), "public", "styles.css"), "utf8");
  let depth = 0;
  const offenders = [];
  styles.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    if (depth === 0 && line.endsWith(";") && !line.startsWith("/*")) offenders.push(`${index + 1}: ${line}`);
    for (const character of line) {
      if (character === "{") depth += 1;
      else if (character === "}") depth = Math.max(0, depth - 1);
    }
  });
  assert.deepEqual(offenders, []);
});

test("a database running flag needs transcript corroboration", () => {
  const dbRunning = { state: "running", source: "db", turnId: "t1", startedAtMs: 1 };
  assert.equal(overrideNeedsRolloutCorroboration(dbRunning), true);
  assert.equal(overrideNeedsRolloutCorroboration({ state: "waiting", source: "db" }), true);
  assert.equal(overrideNeedsRolloutCorroboration({ state: "ended", source: "db" }), false);
  // A live adapter refreshes a short TTL, so it is trusted as-is.
  assert.equal(overrideNeedsRolloutCorroboration({ state: "running", source: "adapter" }), false);
  assert.equal(overrideNeedsRolloutCorroboration(null), false);
});

test("a database running flag is flagged when nothing corroborates it", () => {
  const dbRunning = { state: "running", source: "db" };
  assert.equal(overrideLacksCorroboration(dbRunning, null), true);
  assert.equal(overrideLacksCorroboration(dbRunning, { thinking: false }), true);
  assert.equal(overrideLacksCorroboration(dbRunning, { thinking: true }), false);
  assert.equal(overrideLacksCorroboration(dbRunning, { interactionRequired: true }), false);
  assert.equal(overrideLacksCorroboration({ state: "running", source: "adapter" }, null), false);
  assert.equal(overrideLacksCorroboration({ state: "ended", source: "db" }, null), false);
});

test("the override status contract only gains staleTurn when contested", () => {
  const record = { state: "running", source: "db", turnId: "t1", startedAtMs: 1234 };
  assert.deepEqual(statusFieldsFromOverride(record), {
    state: "running",
    thinking: true,
    interactionRequired: false,
    turnId: "t1",
    startedAtMs: 1234,
    statusSource: "db"
  });
  assert.equal(statusFieldsFromOverride(record, true).staleTurn, true);
});

test("a stale running turn is surfaced once in the attention group, not on every row", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const app = readFileSync(path.join(root, "public", "app.js"), "utf8");
  const threads = readFileSync(path.join(root, "public", "threads.js"), "utf8");
  const css = readFileSync(path.join(root, "public", "styles.app.css"), "utf8");

  assert.match(threads, /attention: true/, "attention group must be a distinct group");
  assert.match(app, /thread-group-attention/, "attention group must be styled");
  assert.match(app, /if \(group\.attention\) return false;/, "attention group must never collapse");
  assert.match(css, /\.thread-group-attention\s*\{/);
  // 逐条会话不再写「长时间无输出」；标题栏也不再重复。
  assert.doesNotMatch(app, /stale: `\$\{t\("statusThinking"\)\} · \$\{t\("statusStale"\)\}`/);
  assert.doesNotMatch(app, /status-pill-note/);
  assert.doesNotMatch(app, /const staleNote/, "no per-conversation stale note");
  // 全局总览仍保留「疑似停滞」计数，用户点了就能筛到那一组。
  assert.match(app, /statusCountStale/);
});

test("a running conversation is inside the status window even when it is old", () => {
  const rows = [];
  for (let index = 0; index < 200; index += 1) {
    rows.push({ id: `row-${index}`, statusState: index === 180 ? "running" : "ended", statusStartedMs: index === 180 ? 1 : null });
  }

  const picked = threadStatusCandidates(rows, 120);
  const ids = picked.map((row) => row.id);

  assert.equal(ids.length, 121, "window plus the one running row outside it");
  assert.ok(ids.includes("row-180"), "a running row past the window must still get a real status");
  assert.ok(ids.includes("row-0"), "the recency window is kept");
  assert.equal(new Set(ids).size, ids.length, "no duplicates");
});

test("the status window stays bounded when nothing is running", () => {
  const rows = Array.from({ length: 200 }, (_, index) => ({ id: `row-${index}`, statusState: "ended", statusStartedMs: null }));
  assert.equal(threadStatusCandidates(rows, 120).length, 120);
  assert.equal(threadStatusCandidates([], 120).length, 0);
});

test("archived PWA keeps its draft attachment hint and server length errors stay localized", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const app = readFileSync(path.join(root, "public", "app.js"), "utf8");
  const server = readFileSync(path.join(root, "server.js"), "utf8");

  // The first message of a conversation has to be text, so the attach button must be
  // disabled in a draft instead of letting the send come back as an error.
  assert.match(app, /els\.attachButton\.disabled = !allowWrite \|\| state\.composerBusy \|\| !hasTarget \|\| draftThread;/);
  assert.match(app, /t\(draftThread \? "attachNeedsText" : "addImage"\)/);
  assert.equal((app.match(/attachNeedsText:/g) || []).length, 2, "both locales need the hint");
  // The archived PWA keeps its old picker hint; the active App supports first-turn images.
  assert.match(server, /消息过长，请拆分成多条发送/);
  assert.ok(!/new Error\("Message is too long"\)/.test(server));
});

test("a .jsonl.zst transcript is decompressed and parsed like a plain one", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "turnloom-zst-"));
  try {
    const lines = [
      JSON.stringify({ timestamp: "2026-07-28T00:00:00.000Z", type: "session_meta", payload: { id: "zst-thread", cwd: "" } }),
      JSON.stringify({ timestamp: "2026-07-28T00:00:01.000Z", type: "event_msg", payload: { type: "user_message", message: "hello from a compressed transcript" } }),
      JSON.stringify({ timestamp: "2026-07-28T00:00:02.000Z", type: "event_msg", payload: { type: "agent_message", message: "and the answer" } }),
    ];
    const plain = path.join(dir, "rollout-plain.jsonl");
    const compressed = `${plain}.zst`;
    const body = lines.join("\n") + "\n";
    writeFileSync(plain, body, "utf8");
    writeFileSync(compressed, zstdCompressSync(Buffer.from(body, "utf8")));

    const decoded = await readZstdRolloutLines(compressed);
    assert.equal(decoded.length, 3);
    assert.match(decoded[1], /hello from a compressed transcript/);

    // The compressed file must parse through the same path as the plain one, and must
    // never be read with byte offsets (that produced parse errors on every line).
    const fromPlain = await parseRollout(plain, { limit: 10 });
    const fromZst = await parseRollout(compressed, { limit: 10, preferTail: true });
    assert.equal(fromZst.messages.length, fromPlain.messages.length);
    assert.deepEqual(
      fromZst.messages.map((m) => m.content),
      fromPlain.messages.map((m) => m.content),
    );
    assert.ok(
      !fromZst.messages.some((m) => m.kind === "parse_error"),
      "a compressed transcript must not produce parse errors",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("copy and branch live behind a long-press sheet, not per-message buttons", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const app = readFileSync(path.join(root, "public", "app.js"), "utf8");
  const html = readFileSync(path.join(root, "public", "index.html"), "utf8");
  const v3 = readFileSync(path.join(root, "public", "styles.v3.css"), "utf8");

  // 每条消息下面常驻的「复制」「从这里创建分支」两个按钮会把气泡撑得比正文还高，
  // 而且分支按钮在 PI 会话里根本出不来（PI 消息不带 id）。现在是长按弹操作单。
  assert.doesNotMatch(app, /class="message-copy-button"/);
  assert.doesNotMatch(app, /class="message-branch-button"/);
  assert.match(html, /id="messageActionSheet"/);
  assert.match(html, /id="messageCopyItem"/);
  assert.match(html, /id="messageBranchItem"/);
  assert.match(app, /const LONG_PRESS_MS = \d+;/);
  assert.match(app, /els\.messageList\.addEventListener\("pointerdown"/);
  // 滑动必须取消长按，否则想滚动列表就会冒出菜单。
  assert.match(app, /Math\.abs\(event\.clientX - start\.x\) > 10/);
  assert.match(app, /els\.messageList\.addEventListener\("contextmenu"/);
  // 按住期间关掉 WebView 自己的长按选词，选「选择文字」时才放开。
  assert.match(v3, /#shell \.message \.bubble\s*\{[^}]*user-select:\s*none/);
  assert.match(v3, /#shell \.message\.selecting \.bubble\s*\{[^}]*user-select:\s*text/);

  // 分支按 turnId 走：PI 消息没有 id，但有 turnId。
  assert.match(app, /await createMessageBranch\(target\.turnId\)/);
  assert.match(app, /data-turn-id="\$\{escapeHtml\(message\.turnId \|\| ""\)\}"/);

  // The workspace is served over plain http on a LAN address, so it is not a secure
  // context and navigator.clipboard is unavailable; execCommand is the fallback.
  assert.match(app, /document\.execCommand\("copy"\)/);
  assert.match(app, /navigator\.clipboard\?\.writeText/);
  // The Android shell exposes a native clipboard writer that needs neither a secure
  // context nor a trusted gesture; it is preferred when present.
  assert.match(app, /window\.CodexPocket\?\.copyText/);
});

test("the interrupt control sits in the composer row, next to send", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const html = readFileSync(path.join(root, "public", "index.html"), "utf8");
  const v3 = readFileSync(path.join(root, "public", "styles.v3.css"), "utf8");

  // 中断按钮原本漂在输入框上方的「排队/插入」条里；按习惯它该和发送键同一行。
  assert.match(html, /<div class="composer-buttons">[\s\S]{0,700}?id="stopButton"/);
  const followUp = /<div id="followUpMode"[\s\S]*?<\/div>\s*<\/div>/.exec(html)?.[0] || "";
  assert.ok(followUp, "the follow-up mode bar should still exist");
  assert.doesNotMatch(followUp, /id="stopButton"/, "stop must not live in the follow-up bar");
  assert.match(v3, /#shell \.composer-buttons \.stop-button\s*\{[^}]*width:\s*44px/);
  assert.match(v3, /#shell \.composer-buttons \.stop-button\s*\{[^}]*height:\s*44px/);
});

test("an autostart duplicate never raises the console window", () => {
  const main = readFileSync(path.join(fileURLToPath(new URL("..", import.meta.url)), "desktop", "main.cjs"), "utf8");

  // Both autostart entries launch with --hidden. The one that loses the single-instance
  // race must not call showWindow, otherwise the console pops up at every logon.
  const handler = /app\.on\("second-instance",[\s\S]{0,400}?\n  \}\);/.exec(main)?.[0] || "";
  assert.match(handler, /--hidden/, "the second-instance handler must inspect the launch args");
  const guardIndex = handler.indexOf("--hidden");
  const showIndex = handler.indexOf("showWindow(");
  assert.ok(guardIndex !== -1 && showIndex !== -1 && guardIndex < showIndex, "the --hidden guard must run before showWindow");
  // The scheduled task is the single source of autostart; a leftover Run entry is cleared.
  assert.match(main, /app\.setLoginItemSettings\(\{ openAtLogin: false, path: process\.execPath, args: \[\] \}\)/);
});

test("the design layer neutralises legacy chrome that broke the phone layout", () => {
  const v3 = readFileSync(path.join(fileURLToPath(new URL("..", import.meta.url)), "public", "styles.v3.css"), "utf8");
  const html = readFileSync(path.join(fileURLToPath(new URL("..", import.meta.url)), "public", "index.html"), "utf8");

  // The legacy sheet painted a filled box behind the animated thinking dots, so the
  // phone showed a solid amber rectangle after 「思考中」.
  assert.match(v3, /\.thinking-dots::after\s*\{[^}]*background:\s*none/);
  // .composer is a grid, so align-self never moved the queue control; auto margins
  // centred it. justify-self plus margin:0 pins it to the composer's left edge.
  assert.match(v3, /\.follow-up-mode\s*\{[^}]*justify-self:\s*start/);
  assert.match(v3, /\.follow-up-mode\s*\{[^}]*margin:\s*0;/);
  // An empty composer reserved two lines of height.
  assert.match(html, /id="composerInput"[\s\S]{0,80}rows="1"/);
});

test("conversation groups read as separate cards with a real collapse control", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const v3 = readFileSync(path.join(root, "public", "styles.v3.css"), "utf8");
  const app = readFileSync(path.join(root, "public", "app.js"), "utf8");

  // 分组标题曾只是 12px 灰字、组间只有 12px 空隙，和会话条目同色系，
  // 扫视时读不出「这是另一个项目」。现在每组是一整块带边框的卡片。
  assert.match(v3, /#shell \.thread-group\s*\{[^}]*border:\s*1px solid var\(--c-line\)/);
  assert.match(v3, /#shell \.thread-group\s*\{[^}]*background:\s*var\(--c-surface\)/);
  assert.match(v3, /#shell \.thread-group-title\s*\{[^}]*font-weight:\s*700/);
  assert.match(v3, /#shell \.thread-group-title\s*\{[^}]*min-height:\s*48px/);

  // 展开/收起曾是 8px 高的文字符号「⌄」，看不出能点；现在换成 20px 图标，
  // 包在 44×44 的命中区里。
  assert.match(app, /class="thread-group-chevron"[^>]*>\s*<svg/);
  assert.match(v3, /#shell \.thread-group-chevron\s*\{[^}]*flex:\s*0 0 44px/);
  assert.match(v3, /#shell \.thread-group-chevron svg\s*\{[^}]*width:\s*20px/);
  // 收起时箭头转 90°，而且条目必须真的塌下去（旧规则被 #shell 提权盖掉了）。
  assert.match(v3, /#shell \.thread-group\.is-collapsed \.thread-group-chevron\s*\{[^}]*rotate\(-90deg\)/);
  assert.match(v3, /#shell \.thread-group\.is-collapsed \.thread-group-items\s*\{[^}]*display:\s*none/);

  // 默认只展开当前会话所在的那组：否则一个 33 条会话的项目就占掉几屏，
  // 后面的项目根本露不出来。
  assert.match(app, /const groupCollapsed = \(group\) => \{/);
  assert.match(app, /return !group\.threads\.some\(\(thread\) => thread\.id === state\.selectedId\)/);
});

test("the time-ordered list still shows which folder each conversation belongs to", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const app = readFileSync(path.join(root, "public", "app.js"), "utf8");
  const v3 = readFileSync(path.join(root, "public", "styles.v3.css"), "utf8");
  const threads = readFileSync(path.join(root, "public", "threads.js"), "utf8");

  // 「按最近」把会话平铺成一组「最近对话」，项目标题就全没了。行内不带文件夹名，
  // 用户根本分不出这条属于哪个项目 —— 这正是「一个项目和另一个项目没分开」的来源。
  assert.match(threads, /sortMode === "recent"/);
  assert.match(app, /state\.threadSortMode === "recent" && thread\.id !== DRAFT_THREAD_ID/);
  assert.match(app, /class="thread-folder"/);
  // 口径和分组一致：项目名 → 工作目录末段 → 其他对话。
  assert.match(app, /function threadFolderLabel\(thread\) \{/);
  assert.match(app, /const segment = cwd\.split\(\/\[\\\\\/\]\+\/\)\.filter\(Boolean\)\.pop\(\)/);
  assert.match(v3, /#shell \.thread-folder\s*\{[^}]*text-overflow:\s*ellipsis/);
});

test("a stalled messages request cannot leave the list loading forever", () => {
  const app = readFileSync(path.join(fileURLToPath(new URL("..", import.meta.url)), "public", "app.js"), "utf8");

  // The messages fetch must be bounded, otherwise a stalled connection parks the UI on
  // "加载中" with no error and no retry (observed once on the phone).
  assert.match(app, /const MESSAGE_REQUEST_TIMEOUT_MS = \d+;/);
  assert.match(app, /signal: AbortSignal\.timeout\(MESSAGE_REQUEST_TIMEOUT_MS\)/);
  // A timeout must read as a timeout, not as "the computer is unreachable".
  assert.match(app, /error\?\.name === "TimeoutError"/);
  assert.equal((app.match(/requestTimedOut:/g) || []).length, 2, "both locales need the wording");
});

test("a running turn cannot blank the open conversation", () => {
  const app = readFileSync(path.join(fileURLToPath(new URL("..", import.meta.url)), "public", "app.js"), "utf8");

  // codexHomeVersion bumps on every write while a turn runs, so resetting the view on a
  // version change blanked the open conversation to 「加载中」 a few seconds into every
  // sync — and the thread sync reloads the list but not the messages, so it never came
  // back. This is what left the phone stuck; the reset must key on the home path.
  assert.match(app, /const changed = state\.codexHomeVersion != null && nextHome != null && nextHome !== state\.codexHome;/);
  assert.ok(!/version !== state\.codexHomeVersion/.test(app), "a version bump must not reset the view");
  // And a genuine home switch has to reload the messages it just cleared.
  assert.match(app, /!state\.lastMessagesData\) await loadMessages\(true\)/);
});

test("a stalled first paint cannot leave the drawer on 加载中", () => {
  const app = readFileSync(path.join(fileURLToPath(new URL("..", import.meta.url)), "public", "app.js"), "utf8");

  // /api/health and /api/threads both gate the first paint, and only /messages was
  // bounded. On the phone a stalled connection therefore parked the drawer on
  // 「加载中」 forever: no error, no retry, no recovery.
  assert.match(app, /const THREADS_REQUEST_TIMEOUT_MS = \d+;/);
  assert.match(app, /const HEALTH_REQUEST_TIMEOUT_MS = \d+;/);
  assert.match(app, /signal: AbortSignal\.timeout\(THREADS_REQUEST_TIMEOUT_MS\)/);
  assert.match(app, /signal: AbortSignal\.timeout\(HEALTH_REQUEST_TIMEOUT_MS\)/);
});

test("the advertised app version comes from the build files, not a stale constant", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const gradle = readFileSync(path.join(root, "android", "app", "build.gradle.kts"), "utf8");
  const gradleCode = Number(/versionCode\s*=\s*(\d+)/.exec(gradle)?.[1]);

  const version = readPackagedAppVersion();
  assert.equal(version.name, pkg.version, "health must advertise the packaged version");
  assert.equal(version.code, gradleCode, "versionCode must match the Android build file");
  assert.ok(version.code > 0 && version.name.length > 0);

  // The old hardcoded pair must be gone; a stale constant silently breaks the update dialog.
  const server = readFileSync(path.join(root, "server.js"), "utf8");
  assert.ok(!/const APP_VERSION_CODE = 24;/.test(server));
  assert.ok(!/const APP_VERSION_NAME = "1\.17\.3";/.test(server));
});

test("the Android shell suppresses browser text selection and JS system dialogs", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const main = readFileSync(path.join(root, "android", "app", "src", "main", "java", "com", "codexpocket", "mobile", "MainActivity.java"), "utf8");
  const app = readFileSync(path.join(root, "public", "app.js"), "utf8");
  const css = readFileSync(path.join(root, "public", "styles.app.css"), "utf8");
  const html = readFileSync(path.join(root, "public", "index.html"), "utf8");

  assert.match(main, /setLongClickable\(false\)/, "long-press selection must be disabled at the WebView level");
  assert.match(main, /onActionModeStarted/, "system copy handles must be intercepted");
  assert.match(main, /onJsConfirm/, "JS confirm must not fall through to the system dialog");
  assert.match(css, /user-select:\s*none/, "web layer must not allow arbitrary text selection");
  assert.match(html, /id="appDialog"/, "in-app confirmation layer must exist");
  assert.match(app, /function appConfirm\(/, "confirmations must use the in-app dialog");
  assert.doesNotMatch(app, /!\s*confirm\(/, "no bare window.confirm left");
});

test("search expands groups and interrupt waits for host confirmation", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const app = readFileSync(path.join(root, "public", "app.js"), "utf8");
  const html = readFileSync(path.join(root, "public", "index.html"), "utf8");

  assert.match(html, /id="searchEmpty"/, "an explicit empty-search state is required");
  assert.match(app, /if \(searching \|\| filtering\) return false;/, "search/status filter must expand every group");
  assert.match(app, /expectedTurnId/, "interrupt should carry the active turn id");
  assert.match(app, /stopping: true/, "interrupt must show a stopping state");
  assert.doesNotMatch(app, /thinking: false, turnId: null, stopping: true/, "interrupt must not fake a stop before confirmation");
});

test("conversation status counts, overview and per-thread marks stay consistent", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const html = readFileSync(path.join(root, "public", "index.html"), "utf8");
  const app = readFileSync(path.join(root, "public", "app.js"), "utf8");
  const threads = readFileSync(path.join(root, "public", "threads.js"), "utf8");

  assert.match(html, /id="statusOverview"/, "a global status overview must exist");
  assert.match(html, /id="headerStatusButton"/, "the header badge must be visible with the drawer closed");
  assert.match(threads, /export function threadStatusKind\(/, "one shared status classifier");
  assert.match(threads, /export function threadStatusCounts\(/, "counts must come from the shared classifier");
  assert.match(threads, /statusFilter/, "the overview must actually filter the list");
  assert.match(app, /thread-status-mark \$\{kind\}/, "every row must carry a visual status mark");
  assert.match(app, /status-\$\{kind\}/, "status class must be attached to the row");
});

test("the composer stays above the software keyboard on short viewports", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const app = readFileSync(path.join(root, "public", "app.js"), "utf8");
  const css = readFileSync(path.join(root, "public", "styles.app.css"), "utf8");

  assert.match(app, /function syncVisualViewport\(/, "must track the visual viewport, not just 100dvh");
  assert.match(app, /visualViewport\.addEventListener\("resize"/);
  assert.match(app, /--app-visible-height/, "shell height must be pinned to the visible area");
  assert.match(app, /keyboard-open/, "a keyboard state must be exposed to CSS");
  assert.match(css, /html\.keyboard-open #shell \.composer/, "keyboard state must compact the composer");
  assert.match(css, /html\.keyboard-open #shell \.follow-up-mode[\s\S]{0,160}display:\s*none/, "queue bar must not eat the short viewport");
});

test("system font scaling keeps text readable and layout scrollable", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const app = readFileSync(path.join(root, "public", "app.js"), "utf8");
  const css = readFileSync(path.join(root, "public", "styles.app.css"), "utf8");
  const main = readFileSync(path.join(root, "android", "app", "src", "main", "java", "com", "codexpocket", "mobile", "MainActivity.java"), "utf8");

  assert.match(main, /getResources\(\)\.getConfiguration\(\)\.fontScale/, "respect the system font scale");
  assert.match(main, /setTextZoom\(zoom\)/, "WebView zoom must follow it with a cap");
  assert.match(app, /classList\.toggle\("large-text"/, "large text must be detectable in CSS");
  assert.match(css, /html\.large-text #shell \.status-overview/, "large text switches the overview to two columns");
  assert.match(css, /min-height:\s*max\(44px, 2\.8em\)/, "touch targets must grow with the font");
  assert.match(css, /overflow-wrap:\s*anywhere/, "titles must wrap instead of being clipped");
  assert.match(css, /#shell \.message-list \{\s*flex: 1 1 auto/, "content area must remain scrollable");
});


test("native queue preserves failure metadata and last known state during IPC jitter", () => {
  const status = nativeQueuedSendStatusFromEntries("thread-a", [{
    id: "q1",
    content: "带图排队",
    attachments: [{ name: "a.jpg", path: "D:/x/a.jpg", mimeType: "image/jpeg" }],
    model: "cn:hy4",
    effort: "high",
    deliveryState: "failed",
    lastError: "No provider configured",
    nextAttemptAtMs: 1790000000000,
    principal: "turnloom-mobile"
  }]);
  assert.equal(status.queueLength, 1);
  assert.equal(status.queuedMessages[0].deliveryState, "failed");
  assert.match(status.queuedMessages[0].lastError, /No provider configured/);
  assert.equal(status.queuedMessages[0].model, "cn:hy4");
  assert.equal(status.queuedMessages[0].effort, "high");
  assert.equal(status.queuedMessages[0].nextAttemptAtMs, 1790000000000);
  const store = new Map([["thread-a", status]]);
  const stale = nativeQueueFallbackStatus("thread-a", new Error("IPC timeout"), store);
  assert.equal(stale.queueLength, 1, "IPC 抖动不能把已知队列清零");
  assert.equal(stale.queueStale, true);
  assert.match(stale.queueError, /IPC timeout/);
  const missing = nativeQueueFallbackStatus("thread-b", new Error("IPC timeout"), store);
  assert.equal(missing.queueLength, 0);
  assert.equal(missing.queueStale, undefined);
});

test("queued native attachments are restricted to this session scratch directory", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "turnloom-native-image-"));
  const dir = path.join(root, "scratch", "thread-a");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "turnloom-1.jpg");
  writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const safe = safeQueuedNativeAttachment("thread-a", { path: file, name: "photo.jpg", mimeType: "image/jpeg" }, root);
  assert.equal(safe?.path, path.resolve(file));
  assert.equal(safeQueuedNativeAttachment("thread-a", { path: path.join(root, "secret.jpg") }, root), null);
  assert.equal(safeQueuedNativeAttachment("thread-a", { path: file, mimeType: "application/pdf" }, root), null);
  assert.equal(safeThreadScratchPath("../escape", "turnloom-1.jpg", root), null);
  assert.equal(safeThreadScratchPath("thread-a", "../../etc/passwd", root), null);
  rmSync(root, { recursive: true, force: true });
});

test("image receipts restore attachments once and respect time, text and existing images", () => {
  const now = Date.now();
  const receipts = [
    { id: "r1", turnId: "turn-1", text: "请看图", createdAtMs: now, images: [{ name: "turnloom-1.jpg", mimeType: "image/jpeg", size: 4 }] },
    { id: "r2", turnId: "", text: "另一张", createdAtMs: now + 1000, images: [{ name: "turnloom-2.png", mimeType: "image/png", size: 4 }] }
  ];
  const messages = [
    { role: "user", turnId: "turn-1", content: "请看图", images: [], localImages: [] },
    { role: "user", content: "另一张", timestamp: new Date(now + 1500).toISOString(), images: [], localImages: [] },
    { role: "user", content: "已有图", images: ["data:image/png;base64,AAAA"], localImages: [] }
  ];
  const restored = restoreLocalImages(messages, receipts, "thread-a");
  assert.equal(restored.messages[0].restoredAttachments, true);
  assert.match(restored.messages[0].images[0].url, /\/api\/thread-image\?threadId=thread-a&name=turnloom-1\.jpg/);
  assert.equal(restored.messages[1].images.length, 1);
  assert.equal(restored.messages[2].images.length, 1, "已有图片不能被覆盖");
  assert.deepEqual(restored.consumedIds.sort(), ["r1", "r2"]);
  assert.equal(restored.remainingReceipts.length, 0);
  const again = restoreLocalImages(restored.messages, receipts, "thread-a");
  assert.equal(again.consumedIds.length, 0, "每个 receipt 在结果里只消耗一次，已带图消息不再匹配");
  const tooLate = restoreLocalImages(
    [{ role: "user", content: "另一张", timestamp: new Date(now + 11 * 60 * 1000).toISOString(), images: [], localImages: [] }],
    [receipts[1]],
    "thread-a"
  );
  assert.equal(tooLate.messages[0].images.length, 0, "超过 10 分钟不能错配");
  assert.equal(tooLate.remainingReceipts.length, 1);
});

test("image receipts are atomic, bounded and never contain base64 payloads", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "turnloom-image-receipt-"));
  const receipt = appendImageReceipt(
    "thread-a",
    "请看图",
    [{ name: "turnloom-1.jpg", mimeType: "image/jpeg", size: 4, data: "AAAA" }],
    "turn-1",
    root
  );
  assert.ok(receipt?.id);
  const stored = readFileSync(path.join(root, "scratch", "thread-a", "turnloom-image-receipts.json"), "utf8");
  assert.doesNotMatch(stored, /AAAA/);
  assert.doesNotMatch(stored, /test-code/);
  assert.equal(readImageReceipts("thread-a", root).length, 1);
  rmSync(root, { recursive: true, force: true });
});

test("native queue drains through the authoritative claim/retry contract", () => {
  const serverSource = readFileSync(fileURLToPath(new URL("../server.js", import.meta.url)), "utf8");
  assert.match(serverSource, /scheduleNativeQueuedSendDrain\(threadId/);
  assert.match(serverSource, /requestNativeQueue\("claim", key/);
  assert.match(serverSource, /sendToCodex\(entry\.content, key, images/);
  assert.match(serverSource, /requestNativeQueue\("state", key, \{[\s\S]*deliveryState: "failed"/);
  assert.match(serverSource, /\/api\/queue\/retry/);
  assert.match(serverSource, /requestNativeQueue\("retry", threadId/);
});

test("Android starts in chat and the picker is not the home page", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const main = readFileSync(path.join(root, "android", "app", "src", "main", "java", "com", "codexpocket", "mobile", "MainActivity.java"), "utf8");

  assert.match(main, /Device startupDevice = findActiveDevice\(\);[\s\S]{0,180}openDevice\(startupDevice, pendingNotificationThreadId\)/);
  assert.match(main, /else \{\s*showMachinePicker\(\);\s*\}/, "first run still opens the picker once");
  assert.match(main, /switchComputer\.setText\("切换电脑"\)/, "explicit large switch-computer button");
  assert.match(main, /switchComputer\.setMinHeight\(0\)/);
  assert.match(main, /switchComputer\.setOnClickListener\(v -> showMachinePicker\(false\)\)/, "switching preserves active computer");
  assert.match(main, /@JavascriptInterface[\s\S]{0,120}public void showMachinePicker\(\)/, "web More menu can request the picker");
  assert.match(main, /MainActivity\.this\.showMachinePicker\(false\)/);
  assert.match(main, /private boolean clearMachinePickerMode = false;/);
  assert.match(main, /if \(!clearMachinePickerMode\) \{[\s\S]{0,180}activeDevice != null \? activeDevice : findActiveDevice\(\)/);
  assert.match(main, /moveTaskToBack\(true\)/, "chat root never jumps to picker on Back");
  assert.match(main, /Button back = headerButton\("‹", "返回聊天", v -> openDevice\(previousDevice\)\)/);
});
