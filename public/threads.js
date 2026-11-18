export function filterVisibleThreads(threads, query = "") {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return [...threads];
  return threads.filter((thread) => {
    const projectName = thread.project?.name || "";
    return `${thread.title || ""} ${thread.preview || ""} ${thread.cwd || ""} ${projectName}`.toLowerCase().includes(needle);
  });
}

/** 统一的状态口径：列表、总览、筛选、状态条都用这一套。 */
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

/** 需要人处理的会话：待处理、疑似停滞。它们是唯一会进「需要关注」组的。 */
export function needsAttention(status) {
  const kind = threadStatusKind(status);
  return kind === "waiting" || kind === "stale";
}

export function groupedVisibleThreads(threads, {
  query = "",
  pinnedLabel = "置顶",
  ungroupedLabel = "其他对话",
  sortMode = "project",
  statusFilter = "",
  attentionLabel = "需要关注"
} = {}) {
  let visible = filterVisibleThreads(threads, query);
  if (statusFilter) visible = visible.filter((thread) => threadStatusKind(thread?.status) === statusFilter);

  const groups = [];
  const pinned = visible.filter((thread) => thread.pinned);
  if (pinned.length) groups.push({ key: "pinned", label: pinnedLabel, threads: pinned });

  // 「疑似停滞/需决策」只在最上面出现一次：做成一个置顶分组，
  // 其余分组里不再重复它们，也不再在每条会话上写「长时间无输出」。
  // 用户明确说：看见了会自己处理，不要每个会话都提示。
  const attention = visible.filter((thread) => !thread.pinned && needsAttention(thread?.status));
  if (attention.length) {
    const rank = { waiting: 0, stale: 1 };
    attention.sort((a, b) =>
      (rank[threadStatusKind(a?.status)] ?? 9) - (rank[threadStatusKind(b?.status)] ?? 9)
    );
    groups.push({ key: "attention", label: attentionLabel, attention: true, threads: attention });
  }
  const attentionIds = new Set(attention.map((thread) => thread.id));
  // 普通列表（项目/最近/文件夹）里跳过这些会话，避免同一条出现两次。
  const rest = visible.filter((thread) => !thread.pinned && !attentionIds.has(thread.id));

  if (sortMode === "recent") {
    const recent = rest.slice().sort((a, b) => (Number(b.updatedAtMs) || 0) - (Number(a.updatedAtMs) || 0));
    if (recent.length) groups.push({ key: "recent", label: "最近对话", threads: recent });
    return groups;
  }

  if (sortMode === "folder") {
    const folders = new Map();
    for (const thread of rest) {
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
  for (const thread of rest) {
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
