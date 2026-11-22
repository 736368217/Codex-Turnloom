"use strict";

/**
 * The reverse of a normal test: `test/fixtures/message-typo.ts` must FAIL to
 * compile. If it ever passes, `ThreadMessage` has an index signature again and
 * a misspelled field (the 2.4.0 date-separator bug) is silently allowed.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const FIXTURE = path.join(ROOT, "test", "fixtures", "message-typo.ts");
const TSC = path.join(ROOT, "app", "node_modules", "typescript", "bin", "tsc");

test("a misspelled message field fails the typecheck", { skip: !fs.existsSync(TSC) }, () => {
  const result = spawnSync(
    process.execPath,
    [TSC, "--noEmit", "--strict", "--skipLibCheck", "--target", "es2020", "--module", "esnext", "--moduleResolution", "node", FIXTURE],
    { cwd: ROOT, encoding: "utf8" }
  );
  assert.notEqual(result.status, 0, "the negative fixture compiled; ThreadMessage lost its key check");
  assert.match(String(result.stdout) + String(result.stderr), /createAt/);
});
