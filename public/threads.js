export function filterVisibleThreads(threads, query = "") {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return [...threads];
  return threads.filter((thread) => {
    const projectName = thread.project?.name || "";
    return `${thread.title || ""} ${thread.preview || ""} ${thread.cwd || ""} ${projectName}`.toLowerCase().includes(needle);
  });
}

/** 统一的状态口径：列表、总览、筛选、状态条都用这一套，避免各处判断不一致。 */
export function threadStatusKind(status) {
  const s = status || {};
  if (s.interactionRequired) return "waiting";
  if (s.thinking) return s.staleTurn ? "stale" : "running";
  if (s.state === "ended") return "ended";
  return "unknown";
}

export function threadStatusCounts(threads) {
  const counts = { waiting: 0, running: 0, stale: 0, ended: 0, unknown: 0 };
  for (const thread of threads || []) counts[threadStatusKind(thread?.status)] += 1;
  return counts;
}

export function threadDeepLink(threadId) {
  const id = String(threadId || "").trim();
  return id ? `codex://threads/${encodeURIComponent(id)}` : "";
}

export function groupedVisibleThreads(threads, {
  query = "",
  pinnedLabel = "置顶",
  ungroupedLabel = "其他对话",
  sortMode = "project",
  statusFilter = ""
} = {}) {
  let visible = filterVisibleThreads(threads, query);
  if (statusFilter) {
    visible = visible.filter((thread) => threadStatusKind(thread?.status) === statusFilter);
    // 点状态总览时，最需要人处理的排在最前（待处理 > 疑似停滞 > 运行中）。
    const rank = { waiting: 0, stale: 1, running: 2 };
    if (rank[statusFilter] !== undefined) {
      visible = visible.slice().sort((a, b) =>
        (rank[threadStatusKind(a?.status)] ?? 9) - (rank[threadStatusKind(b?.status)] ?? 9)
      );
    }
  }
  const pinned = visible.filter((thread) => thread.pinned);
  const groups = [];
  if (pinned.length) groups.push({ key: "pinned", label: pinnedLabel, threads: pinned });

  if (sortMode === "recent") {
    // 最需要人处理的排最前：待处理 > 疑似停滞 > 运行中，其余才按时间。
    // 否则一个卡住的任务会被一堆刚结束的会话挤到下面，用户在列表里找不到它。
    const priority = { waiting: 0, stale: 1, running: 2 };
    const recent = visible.filter((thread) => !thread.pinned).slice().sort((a, b) => {
      const pa = priority[threadStatusKind(a?.status)] ?? 3;
      const pb = priority[threadStatusKind(b?.status)] ?? 3;
      if (pa !== pb) return pa - pb;
      return (Number(b.updatedAtMs) || 0) - (Number(a.updatedAtMs) || 0);
    });
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

  // A folder and a project are the same thing here: a conversation is filed
  // under its project, and one that has no project yet falls back to the last
  // segment of its working directory so the list never loses its buckets.
  const projectGroups = new Map();
  for (const thread of visible) {
    if (thread.pinned) continue;
    const projectKey = thread.project?.key;
    const label = thread.project?.name || folderLabel(thread, ungroupedLabel);
    const key = projectKey || `folder:${label.toLowerCase()}`;
    if (!projectGroups.has(key)) {
      projectGroups.set(key, {
        key,
        label,
        ungrouped: !projectKey && label === ungroupedLabel,
        threads: []
      });
    }
    projectGroups.get(key).threads.push(thread);
  }
  const ordered = [...projectGroups.values()].sort((a, b) => {
    if (a.ungrouped !== b.ungrouped) return a.ungrouped ? 1 : -1;
    return a.label.localeCompare(b.label, "zh-Hans-CN");
  });
  return [...groups, ...ordered];
}

function folderLabel(thread, fallback) {
  const cwd = String(thread?.cwd || "").replace(/[\\/]+$/, "");
  if (!cwd) return fallback;
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  const name = parts[parts.length - 1] || "";
  return name || fallback;
}
