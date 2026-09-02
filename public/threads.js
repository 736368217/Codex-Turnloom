export function filterVisibleThreads(threads, query = "") {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return [...threads];
  return threads.filter((thread) => {
    const projectName = thread.project?.name || "";
    return `${thread.title || ""} ${thread.preview || ""} ${thread.cwd || ""} ${projectName}`.toLowerCase().includes(needle);
  });
}

export function threadDeepLink(threadId) {
  const id = String(threadId || "").trim();
  return id ? `codex://threads/${encodeURIComponent(id)}` : "";
}

export function groupedVisibleThreads(threads, { query = "", pinnedLabel = "置顶", ungroupedLabel = "其他对话" } = {}) {
  const visible = filterVisibleThreads(threads, query);
  const pinned = visible.filter((thread) => thread.pinned);
  const groups = [];
  if (pinned.length) groups.push({ key: "pinned", label: pinnedLabel, threads: pinned });

  const projectGroups = new Map();
  for (const thread of visible) {
    if (thread.pinned) continue;
    const key = thread.project?.key || "other";
    if (!projectGroups.has(key)) {
      projectGroups.set(key, {
        key,
        label: thread.project?.name || ungroupedLabel,
        ungrouped: key === "other",
        threads: []
      });
    }
    projectGroups.get(key).threads.push(thread);
  }
  return [...groups, ...projectGroups.values()];
}
