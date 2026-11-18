"use strict";
/**
 * Project routing regression test.
 *
 * A conversation created from the phone must be filed into the project the user
 * picked. That means the project root has to reach the host as `projectPath` on
 * session/create — the host files a session by root path, and it does not accept
 * a facade id like "p14".
 *
 * Safety: PIPE_PATH is redirected to a temporary pipe name, so this never talks
 * to the running instance.
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const SRC = path.join(__dirname, "plugin", "main.js");
const TMP_PIPE = `\\\\.\\pipe\\turnloom-test-${Date.now()}`;

let source = fs.readFileSync(SRC, "utf8");
const before = source;
source = source.replace(
  'const PIPE_PATH = "\\\\\\\\.\\\\pipe\\\\pidesktop-codex-ipc";',
  `const PIPE_PATH = ${JSON.stringify(TMP_PIPE)};`,
);
if (source === before) {
  console.error("FAIL: could not redirect PIPE_PATH — refusing to run against the live pipe");
  process.exit(1);
}
source += "\nmodule.exports = { handleAction };\n";

const outDir = path.join(os.tmpdir(), `turnloom-project-test-${Date.now()}`);
fs.mkdirSync(outDir, { recursive: true });
for (const name of ["codex-side.cjs", "manifest.json"]) {
  fs.copyFileSync(path.join(path.dirname(SRC), name), path.join(outDir, name));
}
const testFile = path.join(outDir, "main.js");
fs.writeFileSync(testFile, source, "utf8");

const calls = [];
global.pi = {
  desktop: {
    invoke: async ({ operation, args }) => {
      calls.push({ operation, args });
      if (operation === "session/create") return { session: { id: "sess-new" } };
      return { ok: true };
    },
  },
};

const plugin = require(testFile);

const fails = [];
const check = (label, condition, detail) => {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${!condition && detail ? " :: " + detail : ""}`);
  if (!condition) fails.push(label);
};

(async () => {
  // 1. With a project: the root path must reach session/create.
  calls.length = 0;
  await plugin.handleAction(
    "start-conversation",
    {
      input: [{ type: "text", text: "hello", text_elements: [] }],
      cwd: "项目目录\\11\\Codex-Turnloom",
      workspaceRoots: ["项目目录\\11\\Codex-Turnloom"],
      projectPath: "项目目录\\11\\Codex-Turnloom",
      projectId: "p14",
      projectName: "Codex-Turnloom",
    },
    0,
  );
  const create = calls.find((c) => c.operation === "session/create");
  check("session/create is called", Boolean(create), JSON.stringify(calls.map((c) => c.operation)));
  check(
    "session/create carries projectPath",
    Boolean(create) && create.args[0].projectPath === "项目目录\\11\\Codex-Turnloom",
    JSON.stringify(create && create.args[0]),
  );
  check(
    "facade ids are not leaked to the host",
    Boolean(create) && create.args[0].projectId === undefined && create.args[0].projectName === undefined,
    JSON.stringify(create && create.args[0]),
  );

  // 2. Without a project: no projectPath, and the turn still works.
  calls.length = 0;
  await plugin.handleAction(
    "start-conversation",
    { input: [{ type: "text", text: "loose", text_elements: [] }], cwd: "C:\\somewhere\\else" },
    0,
  );
  const loose = calls.find((c) => c.operation === "session/create");
  check("unfiled conversation sends no projectPath", Boolean(loose) && loose.args[0].projectPath === undefined, JSON.stringify(loose && loose.args[0]));
  check(
    "cwd alone never becomes a project (would misfile every loose chat)",
    Boolean(loose) && loose.args[0].projectPath === undefined,
    JSON.stringify(loose && loose.args[0]),
  );
  const prompt = calls.find((c) => c.operation === "agent/prompt");
  check("the first message is still sent", Boolean(prompt) && prompt.args[0].content === "loose");

  fs.rmSync(outDir, { recursive: true, force: true });
  console.log(`\n${fails.length} failure(s)`);
  process.exit(fails.length ? 1 : 0);
})();
