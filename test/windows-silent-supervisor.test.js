import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const installScript = new URL("../scripts/install-windows.ps1", import.meta.url);
const launcherScript = new URL("../scripts/windows-supervisor-launcher.vbs", import.meta.url);

test("Windows supervisor uses a windowless scheduled-task launcher", async () => {
  const [installer, launcher] = await Promise.all([
    readFile(installScript, "utf8"),
    readFile(launcherScript, "utf8")
  ]);

  assert.match(installer, /windows-supervisor-launcher\.vbs/);
  assert.match(installer, /New-ScheduledTaskAction\s+-Execute\s+\$wscript/);
  assert.match(installer, /New-ScheduledTaskSettingsSet[\s\S]*?-Hidden/);
  assert.doesNotMatch(installer, /New-ScheduledTaskAction\s+-Execute\s+\$powershell/);
  assert.match(launcher, /shell\.Run\(command, 0, True\)/i);
});
