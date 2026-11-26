/**
 * 2.4.2 D: the phone-side harness choice.
 *
 * One rule everywhere — explicit user pick > PI > the desktop's own default >
 * first discovered — with an honest `harnessExplicit` flag so a 401 fallback or
 * a stale id can never masquerade as the user's choice. The module under test is
 * TypeScript, so the suite runs it through Node's built-in type stripping;
 * runtimes without stripping skip instead of failing the gate.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let registry = null;
let platforms = null;
let unavailable = "";
try {
  registry = await import("../app/src/lib/machineRegistry.ts");
  platforms = await import("../app/src/lib/platforms.ts");
} catch (error) {
  unavailable = `type stripping unavailable: ${error?.code || error?.message || "unknown"}`;
}
const skip = registry && platforms ? false : unavailable;
const t = (name, fn) => test(name, { skip }, fn);

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../app/src");

function harness(id, kind, { desktopDefault = false, online = true } = {}) {
  return { id, name: id.toUpperCase(), token: `${id.toUpperCase()}-TOKEN`, kind, defaultHarness: desktopDefault, online };
}

function machine(overrides = {}) {
  return {
    machineId: "office-pc",
    machineName: "Office PC",
    serverUrl: "http://192.168.1.10:8787",
    machineToken: "MACHINE-TOKEN",
    harnesses: [harness("codex", "codex", { desktopDefault: true })],
    defaultHarnessId: "codex",
    ...overrides,
  };
}

function roundTrip(machines) {
  const raw = registry.serializeRegistry({ version: 3, activeMachineId: machines[0].machineId, machines });
  return registry.parseRegistry(raw).machines[0];
}

t("D1: without a marker the PI harness wins over the desktop default", () => {
  const list = [harness("codex", "codex", { desktopDefault: true }), harness("pi", "pi")];
  assert.equal(registry.preferredHarnessId(list), "pi");
  assert.equal(
    registry.preferredHarnessId([harness("codex", "codex", { desktopDefault: true }), harness("pidesk", "pidesk")]),
    "pidesk",
  );
});

t("D2: an explicit Codex pick outranks the PI rule", () => {
  const list = [harness("codex", "codex", { desktopDefault: true }), harness("pi", "pi")];
  assert.deepEqual(registry.selectHarness(list, { explicit: true, preferredId: "codex" }), { harnessId: "codex", explicit: true });
});

t("D3: a successful revalidation keeps the explicit Codex pick while the desktop default is still PI", () => {
  const stored = machine({
    harnesses: [harness("codex", "codex", { desktopDefault: true }), harness("pi", "pi")],
    defaultHarnessId: "codex",
    harnessExplicit: true,
  });
  // Discovery says the computer's default is still PI — that must not win.
  const discovered = [harness("codex", "codex"), harness("pi", "pi", { desktopDefault: true })];
  const next = registry.applyHarnessChoice(stored, discovered);
  assert.equal(next.defaultHarnessId, "codex");
  assert.equal(next.harnessExplicit, true);
});

t("D4: a 401 self-heal that falls back records explicit=false, and it survives serialize/parse", () => {
  const stored = machine({
    harnesses: [harness("codex", "codex"), harness("pi", "pi", { desktopDefault: true })],
    defaultHarnessId: "codex",
    harnessExplicit: true,
  });
  const order = registry.harnessProbeOrder(stored.harnesses, { explicit: true, preferredId: "codex" });
  assert.deepEqual(order.map((item) => item.id), ["codex", "pi"], "the persisted pick is probed first");
  // Codex failed, PI verified: the fallback is not the user's choice.
  const stillExplicit = registry.explicitAfterFallback({ explicit: true, preferredId: "codex" }, "pi");
  assert.equal(stillExplicit, false);
  const healed = machine({ ...stored, defaultHarnessId: "pi", harnessExplicit: stillExplicit });
  const parsed = roundTrip([healed]);
  assert.equal(parsed.defaultHarnessId, "pi");
  assert.equal(parsed.harnessExplicit, false);
});

t("D5: a pre-2.4.2 registry migrates to PI once and the migration is not a user choice", () => {
  const legacy = machine({
    harnesses: [harness("codex", "codex", { desktopDefault: true }), harness("pi", "pi")],
    defaultHarnessId: "codex",
  });
  assert.equal(Object.prototype.hasOwnProperty.call(legacy, "harnessExplicit"), false);
  const first = registry.parseRegistry(JSON.stringify(legacy));
  assert.equal(first.machines[0].defaultHarnessId, "pi");
  assert.equal(first.machines[0].harnessExplicit, false);
  const raw = registry.serializeRegistry(first);
  assert.equal(JSON.parse(raw).machines[0].harnessExplicit, false, "the migration marker is always written");
  const second = registry.parseRegistry(raw);
  assert.equal(second.machines[0].defaultHarnessId, "pi");
  assert.equal(second.machines[0].harnessExplicit, false, "a second parse must not upgrade the rule pick into a user pick");
});

t("D6: a pre-2.4.2 registry without PI keeps its working Codex default", () => {
  const legacy = machine({
    harnesses: [harness("codex", "codex"), harness("local", "codex", { desktopDefault: true })],
    defaultHarnessId: "codex",
  });
  const parsed = registry.parseRegistry(JSON.stringify(legacy)).machines[0];
  assert.equal(parsed.defaultHarnessId, "codex");
});

t("D7: without PI the desktop default wins, then the first discovered one", () => {
  assert.equal(
    registry.preferredHarnessId([harness("a", "codex"), harness("b", "codex", { desktopDefault: true })]),
    "b",
  );
  assert.equal(registry.preferredHarnessId([harness("a", "codex"), harness("b", "codex")]), "a");
});

t("D8: an explicit harness that disappeared falls back to the rule and drops the flag", () => {
  const stored = machine({
    harnesses: [harness("codex", "codex"), harness("pi", "pi")],
    defaultHarnessId: "ghost",
    harnessExplicit: true,
  });
  const next = registry.applyHarnessChoice(stored, [harness("codex", "codex", { desktopDefault: true }), harness("pi", "pi")]);
  assert.equal(next.defaultHarnessId, "pi");
  assert.equal(next.harnessExplicit, false);
});

t("D9: serializeRegistry writes the flag both ways, so read-back cannot re-decide it", () => {
  const explicitMachine = machine({ harnessExplicit: true });
  const parsed = roundTrip([explicitMachine]);
  assert.equal(parsed.defaultHarnessId, "codex");
  assert.equal(parsed.harnessExplicit, true);
});

t("D10: the device page opens the current harness's platform and keeps a manual open", () => {
  const list = platforms.platformsOf([harness("codex", "codex", { desktopDefault: true }), harness("pi", "pi")], "Office PC");
  assert.deepEqual(list.map((platform) => platform.key), ["codex", "pi"]);
  assert.equal(platforms.openPlatformFor(list, "pi"), "pi", "PI is second yet it must be the one open");
  assert.equal(platforms.openPlatformFor(list, "pi", "codex"), "codex", "a manual platform open is never stolen back");
  assert.equal(platforms.openPlatformFor(list, "ghost"), "codex");
  assert.equal(platforms.openPlatformFor([], "pi"), "");
});

t("D11: device rows call the desktop default what it is, and the screen uses the shared rule", () => {
  const devices = fs.readFileSync(path.join(SRC, "screens/DevicesScreen.tsx"), "utf8");
  assert.doesNotMatch(devices, /默认入口/);
  // 2.4.3 (QA 2026-11-26, 320dp): only a real "offline" is worth the characters.
  // The positive case used to print 发现时在线 and lost the tail of the row on a
  // 320-wide phone; the row now stays silent unless discovery failed.
  assert.match(devices, /本机服务\{harness\.online === false \? ' · 发现时离线' : ''\}/);
  assert.doesNotMatch(devices, /发现时在线/);
  assert.match(devices, /openPlatformFor\(platforms, session\.harnessId, current\)/);
});

t("D12: every entry path uses the one rule (pairing, revalidation, 401, explicit switch)", () => {
  const store = fs.readFileSync(path.join(SRC, "state/sessionStore.ts"), "utf8");
  assert.match(store, /const updated = applyHarnessChoice\(\{\s*\.\.\.machine,/,
    'revalidation must spread the persisted machine, or the explicit pick is lost');
  assert.match(store, /const machine = applyHarnessChoice\(/);
  assert.match(store, /harnessProbeOrder\(saved, \{ explicit, preferredId \}\)/);
  assert.match(store, /explicitAfterFallback\(\{ explicit, preferredId \}, harness\.id\)/);
  assert.match(store, /activateMachine\(machine, harness\.id, false, attempt, reportConnectionFailure, true\)/);
  // The retry candidate must carry both the stored id and the flag.
  const appRoot = fs.readFileSync(path.join(SRC, "AppRoot.tsx"), "utf8");
  assert.match(appRoot, /defaultHarnessId: s\.harnessId \|\| s\.harnessDefaultId \|\| s\.harnesses\[0\]\.id/);
  assert.match(appRoot, /harnessExplicit: s\.harnessExplicit/);
});
