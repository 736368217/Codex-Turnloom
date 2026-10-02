import assert from "node:assert/strict";
import test from "node:test";

import { groupedVisibleThreads, threadDeepLink } from "../public/threads.js";

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

test("ordinary conversations share the ungrouped section even when they have different working folders", () => {
  const groups = groupedVisibleThreads([
    { id: "one", title: "Alpha", cwd: "C:\\work\\one", project: null },
    { id: "two", title: "Beta", cwd: "C:\\work\\two", project: null },
    { id: "three", title: "Gamma", project: { key: "project:three", name: "Project Three" } }
  ]);

  assert.deepEqual(groups.map((group) => group.label), ["Project Three", "其他对话"]);
  assert.equal(groups[1].ungrouped, true);
  assert.deepEqual(groups[1].threads.map((thread) => thread.id), ["one", "two"]);
});

test("mobile grouping preserves Desktop project names from server metadata", () => {
  const groups = groupedVisibleThreads([
    { id: "fast", title: "Fast", project: { key: "project:fast", name: "fast监控" } },
    { id: "pocket", title: "Pocket", project: { key: "project:pocket", name: "codex poket" } },
    { id: "plain", title: "Plain", project: null }
  ]);
  assert.deepEqual(groups.map((group) => group.label), ["fast监控", "codex poket", "其他对话"]);
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

test("thread deep links use the Codex Desktop thread scheme", () => {
  assert.equal(threadDeepLink("01abc-123"), "codex://threads/01abc-123");
  assert.equal(threadDeepLink(""), "");
});
