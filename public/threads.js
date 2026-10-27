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

export function groupedVisibleThreads(threads, { query = "", pinnedLabel = "置顶", ungroupedLabel = "其他对话", sortMode = "project" } = {}) {
  const visible = filterVisibleThreads(threads, query);
  const pinned = visible.filter((thread) => thread.pinned);
  const groups = [];
  if (pinned.length) groups.push({ key: "pinned", label: pinnedLabel, threads: pinned });

  if (sortMode === "recent") {
    const recent = visible.filter((thread) => !thread.pinned).slice().sort((a, b) => (Number(b.updatedAtMs) || 0) - (Number(a.updatedAtMs) || 0));
    if (recent.length) groups.push({ key: "recent", label: "最近对话", threads: recent });
    return groups;
  }

  if (sortMode === "folder") {
    // Codex sessions only carry a cwd; group them by the working folder's last
    // segment so a phone user still gets buckets instead of one flat list.
    const folders = new Map();
    for (const thread of visible) {
      if (thread.pinned) continue;
      const label = folderLabel(thread, ungroupedLabel);
      const key = `folder:${label.toLowerCase()}`;
      if (!folders.has(key)) folders.set(key, { key, label, threads: [] });
      folders.get(key).threads.push(thread);
    }
    const ordered = [...folders.values()].sort((a, b) => {
      const aOther = a.label === ungroupedLabel ? 1 : 0;
      const bOther = b.label === ungroupedLabel ? 1 : 0;
      if (aOther !== bOther) return aOther - bOther;
      return a.label.localeCompare(b.label, "zh-Hans-CN");
    });
    return [...groups, ...ordered];
  }

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
  const ungrouped = projectGroups.get("other");
  if (ungrouped) projectGroups.delete("other");
  return [...groups, ...projectGroups.values(), ...(ungrouped ? [ungrouped] : [])];
}

function folderLabel(thread, fallback) {
  const cwd = String(thread?.cwd || "").replace(/[\\/]+$/, "");
  if (!cwd) return fallback;
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  const name = parts[parts.length - 1] || "";
  return name || fallback;
}
