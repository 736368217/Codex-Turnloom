#!/usr/bin/env node
// Live check: does a conversation started from the phone land in the chosen
// project? Creates one marked probe conversation, verifies the project on the
// thread the server returns, then (with --interrupt) stops its turn so it does
// not keep a model running.
//
//   node scripts/verify-project-archiving.mjs                 # uses the local config
//   node scripts/verify-project-archiving.mjs --project 14    # pick a project by id or name
//   node scripts/verify-project-archiving.mjs --interrupt     # stop the probe turn afterwards
//
// Exit code 0 means the thread came back with the expected project.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const argValue = (flag, fallback = "") => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const configPath = path.resolve(
  argValue(
    "--config",
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "CodexPocket", "config.json"),
  ),
);

let base = String(argValue("--base", "")).replace(/\/+$/, "");
let token = argValue("--token", "") || String(process.env.CODEXPOCKET_TOKEN || "");
if (!base || !token) {
  if (!fs.existsSync(configPath)) {
    console.error(`config not found: ${configPath} (pass --base http://host:port and --token …)`);
    process.exit(2);
  }
  const config = JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));
  base = base || String(config.publicUrl || `http://127.0.0.1:${config.port || 8787}`).replace(/\/+$/, "");
  token = token || String(config.accessCode || "");
}
if (!token) {
  console.error("no access code: set accessCode in the config or pass --token");
  process.exit(2);
}

const wantInterrupt = args.includes("--interrupt");
const wantProject = argValue("--project", "");
const PROBE = "QA 项目归档复验（可删）";

const auth = await fetch(`${base}/api/auth/session`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ token }),
});
if (!auth.ok) {
  console.error(`login failed: ${auth.status}`);
  process.exit(2);
}
const cookie = (auth.headers.getSetCookie?.() || []).map((c) => String(c).split(";")[0]).join("; ");
const H = { cookie, "content-type": "application/json" };

const projectsRes = await fetch(`${base}/api/projects`, { headers: { cookie } });
const projectsPayload = await projectsRes.json().catch(() => ({}));
const projects = Array.isArray(projectsPayload.projects) ? projectsPayload.projects : [];
if (!projects.length) {
  console.error(`no projects returned (${projectsRes.status}); the bridge has not mirrored them yet`);
  process.exit(2);
}
const target =
  projects.find((p) => String(p.id) === wantProject || String(p.name) === wantProject) ||
  projects.reduce((best, p) => (Number(p.threadCount) || 0) > (Number(best.threadCount) || 0) ? p : best, projects[0]);
console.log(`target project: ${target.name} (id=${target.id}, threads=${target.threadCount ?? "?"})`);

const sendRes = await fetch(`${base}/api/send`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({
    newThread: true,
    message: PROBE,
    projectId: String(target.id),
    clientRequestId: `verify-project-${Date.now()}`,
  }),
});
const sendBody = await sendRes.json().catch(() => ({}));
const threadId = String(sendBody.threadId || sendBody.thread?.id || "");
console.log(`send: ${sendRes.status} threadId=${threadId || "(none)"}`);
if (!sendRes.ok || !threadId) {
  console.error(`FAIL send was refused: ${JSON.stringify(sendBody).slice(0, 240)}`);
  process.exit(1);
}

let seen = null;
for (let attempt = 0; attempt < 12 && !seen; attempt++) {
  await new Promise((r) => setTimeout(r, 2000));
  const listRes = await fetch(`${base}/api/threads`, { headers: { cookie } });
  const list = await listRes.json().catch(() => ({}));
  const threads = Array.isArray(list.threads) ? list.threads : [];
  seen = threads.find((t) => String(t.id) === threadId) || null;
  if (!seen) continue;
}

if (wantInterrupt) {
  const r = await fetch(`${base}/api/interrupt`, { method: "POST", headers: H, body: JSON.stringify({ threadId }) });
  console.log(`interrupt: ${r.status}`);
}

const projectOnThread = seen ? String(seen.projectId ?? seen.project?.id ?? "") : "";
const nameOnThread = seen ? String(seen.project?.name ?? "") : "";
const pass = Boolean(seen) && projectOnThread === String(target.id);

console.log(
  JSON.stringify(
    {
      pass,
      threadId,
      expectedProject: { id: String(target.id), name: target.name },
      threadProject: seen ? { id: projectOnThread || null, name: nameOnThread || null } : null,
      threadFound: Boolean(seen),
      note: pass ? "新会话已归档到所选项目" : "新会话未带项目：桥的新代码可能还没被宿主加载（重载插件或重启 PI-Desktop 后重跑）",
    },
    null,
    2,
  ),
);
if (threadId) console.log(`\n清理：这条探针会话（标题以 “${PROBE}” 开头）可在此验证后删除。`);
process.exit(pass ? 0 : 1);
