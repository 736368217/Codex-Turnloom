import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const watchdog = readFileSync(new URL("../scripts/link-watchdog.mjs", import.meta.url), "utf8");
const launcher = readFileSync(new URL("../scripts/link-watchdog-launcher.vbs", import.meta.url), "utf8");

test("watchdog logon autostart never Execs node.exe directly", () => {
  // 真机事故：node.exe 是控制台程序，任务 Hidden 仍会弹可见 node/conhost 窗口。
  assert.match(watchdog, /const LAUNCHER = .*link-watchdog-launcher\.vbs/);
  assert.match(watchdog, /const WSCRIPT = .*wscript\.exe/);
  assert.match(watchdog, /New-ScheduledTaskAction -Execute \$wscript/);
  assert.match(watchdog, /\/\/B \/\/Nologo/);
  assert.doesNotMatch(watchdog, /New-ScheduledTaskAction -Execute \$node/);
  assert.doesNotMatch(watchdog, /\$action = New-ScheduledTaskAction -Execute \$node -Argument/);
  assert.match(watchdog, /Stop-ScheduledTask -TaskName/);
  assert.match(watchdog, /Register-ScheduledTask -TaskName .* -Force/);
  assert.match(watchdog, /Unregister-ScheduledTask -TaskName/);
});

test("VBS launcher keeps console hidden and redirects diagnostic output", () => {
  assert.match(launcher, /shell\.Run command, 0, False/);
  assert.match(launcher, /\/d \/s \/c/);
  assert.match(launcher, /--loop/);
  assert.match(launcher, /watchdog-out\.log/);
  assert.match(launcher, /watchdog-err\.log/);
  assert.match(launcher, /2>>/);
  assert.match(launcher, /WScript\.Quit 0/);
  assert.doesNotMatch(launcher, /shell\.Run command, 1,|shell\.Run command, [2-9],/);
});

test("watchdog still performs every-10-second health checks and restarts", () => {
  assert.match(watchdog, /setInterval\(\(\) => sweep\(\)[\s\S]*?10000\)/);
  assert.match(watchdog, /startDispatcher\(main\)/);
  assert.match(watchdog, /startBackend\(device, main\)/);
  assert.match(watchdog, /startTunnel\(main\)/);
  assert.match(watchdog, /WATCHDOG_LOG/);
});
