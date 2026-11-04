import assert from "node:assert/strict";
import test from "node:test";

import { groupedVisibleThreads, threadDeepLink, threadStatusCounts, threadStatusKind } from "../public/threads.js";

test("thread groups put pinned tasks first and never duplicate them", () => {
  const groups = groupedVisibleThreads([
    { id: "recent-a", title: "A", project: { key: "cwd:a", name: "Project A" } },
    { id: "pinned", title: "Pinned", pinned: true, project: { key: "cwd:a", name: "Project A" } },
    { id: "recent-b", title: "B", project: { key: "cwd:b", name: "Project B" } }
  ]);

  assert.deepEqual(groups.map((group) => group.label), ["置顶", "Project A", "Project B"]);
  assert.deepEqual(groups.flatMap((group) => group.threads.map((thread) => thread.id)), ["pinned", "recent-a", "recent-b"]);
});

test("thread search filters the grouped main-task collection", () => {
  const groups = groupedVisibleThreads(
    [
      { id: "one", title: "Alpha", cwd: "C:\\work\\one", project: { key: "cwd:one", name: "One" } },
      { id: "two", title: "Beta", preview: "needle", project: null }
    ],
    { query: "needle" }
  );

  assert.equal(groups[0].ungrouped, true);
  assert.deepEqual(groups[0].threads.map((thread) => thread.id), ["two"]);
});

test("conversations without a project are filed by their working folder", () => {
  const groups = groupedVisibleThreads([
    { id: "one", title: "Alpha", cwd: "C:\\work\\one", project: null },
    { id: "two", title: "Beta", cwd: "C:\\work\\two", project: null },
    { id: "three", title: "Gamma", project: { key: "project:three", name: "Project Three" } },
    { id: "loose", title: "Delta", project: null }
  ]);

  const labels = groups.map((group) => group.label);
  const one = groups.find((group) => group.label === "one");
  const two = groups.find((group) => group.label === "two");
  assert.deepEqual(one.threads.map((thread) => thread.id), ["one"]);
  assert.deepEqual(two.threads.map((thread) => thread.id), ["two"]);
  assert.equal(one.ungrouped, false);
  // 既没有项目也没有工作目录的会话仍然有归宿，并排在最后，真实文件夹留在顶部。
  assert.equal(labels[labels.length - 1], "其他对话");
  const ungrouped = groups[groups.length - 1];
  assert.equal(ungrouped.ungrouped, true);
  assert.deepEqual(ungrouped.threads.map((thread) => thread.id), ["loose"]);
});

test("mobile grouping preserves Desktop project names and lists folders by name", () => {
  const groups = groupedVisibleThreads([
    { id: "fast", title: "Fast", project: { key: "project:fast", name: "fast监控" } },
    { id: "pocket", title: "Pocket", project: { key: "project:pocket", name: "codex poket" } },
    { id: "plain", title: "Plain", project: null }
  ]);
  assert.deepEqual(groups.map((group) => group.label), ["codex poket", "fast监控", "其他对话"]);
});

test("project sorting puts other conversations last and recent sorting uses updated time", () => {
  const projectGroups = groupedVisibleThreads([
    { id: "other", title: "Other", updatedAtMs: 300, project: null },
    { id: "project", title: "Project", updatedAtMs: 100, project: { key: "project:a", name: "A" } }
  ]);
  assert.deepEqual(projectGroups.map((group) => group.label), ["A", "其他对话"]);
  const recentGroups = groupedVisibleThreads([
    { id: "old", title: "Old", updatedAtMs: 100, project: { key: "project:a", name: "A" } },
    { id: "new", title: "New", updatedAtMs: 300, project: null }
  ], { sortMode: "recent" });
  assert.deepEqual(recentGroups[0].threads.map((thread) => thread.id), ["new", "old"]);
});


test("the time-ordered list puts conversations needing attention first", () => {
  const groups = groupedVisibleThreads([
    { id: "finished", title: "Done", updatedAtMs: 900, status: { state: "ended" } },
    { id: "stuck", title: "Stuck", updatedAtMs: 100, status: { state: "running", thinking: true, staleTurn: true } },
    { id: "waiting", title: "Decide", updatedAtMs: 200, status: { interactionRequired: true } },
    { id: "running", title: "Live", updatedAtMs: 800, status: { state: "running", thinking: true } }
  ], { sortMode: "recent" });
  assert.deepEqual(groups[0].threads.map((thread) => thread.id), ["waiting", "stuck", "running", "finished"]);
});

test("status counts use one shared classifier", () => {
  const counts = threadStatusCounts([
    { status: { interactionRequired: true } },
    { status: { thinking: true, staleTurn: true } },
    { status: { thinking: true } },
    { status: { state: "ended" } },
    { status: {} }
  ]);
  assert.deepEqual(counts, { waiting: 1, running: 1, stale: 1, ended: 1, unknown: 1 });
});

test("status classifier covers the four states a phone user can see", () => {
  assert.equal(threadStatusKind({ interactionRequired: true }), "waiting");
  assert.equal(threadStatusKind({ thinking: true, staleTurn: true }), "stale");
  assert.equal(threadStatusKind({ thinking: true }), "running");
  assert.equal(threadStatusKind({ state: "ended" }), "ended");
  assert.equal(threadStatusKind({}), "unknown");
});

test("thread deep links use the Codex Desktop thread scheme", () => {
  assert.equal(threadDeepLink("01abc-123"), "codex://threads/01abc-123");
  assert.equal(threadDeepLink(""), "");
});
