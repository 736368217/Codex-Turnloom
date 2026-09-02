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

  assert.deepEqual(groups.map((group) => group.label), ["其他对话", "Project Three"]);
  assert.equal(groups[0].ungrouped, true);
  assert.deepEqual(groups[0].threads.map((thread) => thread.id), ["one", "two"]);
});

test("thread deep links use the Codex Desktop thread scheme", () => {
  assert.equal(threadDeepLink("01abc-123"), "codex://threads/01abc-123");
  assert.equal(threadDeepLink(""), "");
});
