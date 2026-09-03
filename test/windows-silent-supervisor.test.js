import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const installScript = new URL("../scripts/install-windows.ps1", import.meta.url);
const launcherScript = new URL("../scripts/windows-supervisor-launcher.vbs", import.meta.url);
const supervisorScript = new URL("../scripts/windows-supervisor.ps1", import.meta.url);

test("Windows supervisor uses a windowless scheduled-task launcher", async () => {
  const [installer, launcher, supervisor] = await Promise.all([
    readFile(installScript, "utf8"),
    readFile(launcherScript, "utf8"),
    readFile(supervisorScript, "utf8")
  ]);

  assert.match(installer, /windows-supervisor-launcher\.vbs/);
  assert.match(installer, /New-ScheduledTaskAction\s+-Execute\s+\$wscript/);
  assert.match(installer, /New-ScheduledTaskSettingsSet[\s\S]*?-Hidden/);
  assert.doesNotMatch(installer, /New-ScheduledTaskAction\s+-Execute\s+\$powershell/);
  assert.match(launcher, /shell\.Run\(command, 0, True\)/i);
  assert.match(supervisor, /System\.Threading\.Mutex/);
  assert.match(supervisor, /Local\\CodexPocketSupervisor/);
  assert.match(installer, /-AllowStartIfOnBatteries/);
  assert.match(installer, /-DontStopIfGoingOnBatteries/);
  assert.match(installer, /-DontStopOnIdleEnd/);
  assert.match(installer, /function Stop-ManagedServerProcess/);
  assert.match(
    installer,
    /Stop-ScheduledTask\s+-TaskName\s+\$taskName[\s\S]*?Stop-ManagedServerProcess[\s\S]*?Register-ScheduledTask\s+-TaskName\s+\$taskName/
  );
});
