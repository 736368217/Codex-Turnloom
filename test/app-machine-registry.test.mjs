/**
 * Registry rules are pure data: parse the historical single-machine value,
 * keep N machines with one active pointer, and never invent liveness.
 *
 * The module under test is TypeScript, so the suite runs it through Node's
 * built-in type stripping. Runtimes without stripping (older Node 22) skip
 * instead of failing the whole gate; the local Node 24 always exercises them.
 */
import test from "node:test";
import assert from "node:assert/strict";

let registryModule = null;
let unavailable = "";
try {
  registryModule = await import("../app/src/lib/machineRegistry.ts");
} catch (error) {
  unavailable = `type stripping unavailable: ${error?.code || error?.message || "unknown"}`;
}
const skip = registryModule ? false : unavailable;
const t = (name, fn) => test(name, { skip }, fn);

function harness(id = "codex", token = "HARNESS-TOKEN") {
  return { id, name: id.toUpperCase(), token, kind: "codex", defaultHarness: true, online: true };
}

function machine(overrides = {}) {
  return {
    machineId: "office-pc",
    machineName: "Office PC",
    serverUrl: "http://192.168.1.10:8787",
    machineToken: "MACHINE-TOKEN",
    harnesses: [harness()],
    defaultHarnessId: "codex",
    ...overrides,
  };
}

t("legacy single-machine value migrates into a one-entry registry", () => {
  const { parseRegistry } = registryModule;
  const registry = parseRegistry(JSON.stringify(machine()));
  assert.ok(registry);
  assert.equal(registry.version, 3);
  assert.equal(registry.machines.length, 1);
  assert.equal(registry.activeMachineId, "office-pc");
  assert.equal(registry.machines[0].lastUsedAt, undefined);
});

t("registry keeps every machine and the stored active pointer", () => {
  const { parseRegistry, serializeRegistry } = registryModule;
  const raw = serializeRegistry({
    version: 3,
    activeMachineId: "b",
    machines: [machine({ machineId: "a", machineName: "A" }), machine({ machineId: "b", machineName: "B", serverUrl: "http://10.0.0.2:8787" })],
  });
  const registry = parseRegistry(raw);
  assert.equal(registry.machines.length, 2);
  assert.equal(registry.activeMachineId, "b");
});

t("an active pointer that names no machine falls back to the newest one", () => {
  const { parseRegistry } = registryModule;
  const raw = JSON.stringify({
    version: 3,
    activeMachineId: "missing",
    machines: [
      machine({ machineId: "old", lastUsedAt: 100 }),
      machine({ machineId: "new", lastUsedAt: 900, serverUrl: "http://10.0.0.9:8787" }),
    ],
  });
  assert.equal(parseRegistry(raw).activeMachineId, "new");
});

t("unusable machines are dropped, and all-unusable input stays unpaired", () => {
  const { parseRegistry } = registryModule;
  const raw = JSON.stringify({
    version: 3,
    activeMachineId: "ok",
    machines: [
      machine({ machineId: "ok" }),
      { machineId: "no-url", machineToken: "t", harnesses: [harness()] },
      { machineId: "no-harness", serverUrl: "http://10.0.0.3:8787", machineToken: "t", harnesses: [] },
      { machineId: "empty", serverUrl: "http://10.0.0.4:8787", machineToken: "", harnesses: [harness()] },
    ],
  });
  const registry = parseRegistry(raw);
  assert.deepEqual(registry.machines.map((item) => item.machineId), ["ok"]);
  assert.equal(parseRegistry(JSON.stringify({ machines: [{}] })), null);
  assert.equal(parseRegistry("not json"), null);
  assert.equal(parseRegistry(null), null);
});

t("manual pairing without a machineId is keyed by its origin", () => {
  const { machineKey, parseRegistry } = registryModule;
  const legacy = parseRegistry(JSON.stringify(machine({ machineId: "" })));
  assert.equal(legacy.activeMachineId, "http://192.168.1.10:8787");
  assert.equal(machineKey({ machineId: "", serverUrl: "http://192.168.1.10:8787" }), "http://192.168.1.10:8787");
});

t("upsert replaces an existing machine in place and stamps lastUsedAt", () => {
  const { parseRegistry, upsertMachine } = registryModule;
  const first = upsertMachine(parseRegistry(JSON.stringify(machine())), machine(), 1000);
  const second = upsertMachine(first, machine({ machineName: "Renamed", harnesses: [harness("codex"), harness("pidesk", "T2")] }), 2000);
  assert.equal(second.machines.length, 1);
  assert.equal(second.machines[0].machineName, "Renamed");
  assert.equal(second.machines[0].harnesses.length, 2);
  assert.equal(second.machines[0].lastUsedAt, 2000);
  assert.equal(second.activeMachineId, "office-pc");
});

t("upsert adds a second machine and makes it active", () => {
  const { upsertMachine } = registryModule;
  const first = upsertMachine(null, machine(), 1000);
  const second = upsertMachine(first, machine({ machineId: "laptop", serverUrl: "http://10.0.0.5:8787" }), 2000);
  assert.equal(second.machines.length, 2);
  assert.equal(second.activeMachineId, "laptop");
});

t("the list is capped and evicts the least recently used inactive machine", () => {
  const { MAX_MACHINES, upsertMachine } = registryModule;
  let registry = null;
  for (let i = 0; i < MAX_MACHINES; i += 1) {
    registry = upsertMachine(registry, machine({ machineId: `m${i}`, serverUrl: `http://10.0.0.${i + 1}:8787` }), 1000 + i);
  }
  assert.equal(registry.machines.length, MAX_MACHINES);
  registry = upsertMachine(registry, machine({ machineId: "fresh", serverUrl: "http://10.0.0.99:8787" }), 9999);
  assert.equal(registry.machines.length, MAX_MACHINES);
  assert.equal(registry.activeMachineId, "fresh");
  assert.equal(registry.machines.some((item) => item.machineId === "m0"), false, "oldest inactive machine is evicted");
  assert.equal(registry.machines.some((item) => item.machineId === "fresh"), true);
});

t("removing the active machine promotes the newest remaining one", () => {
  const { parseRegistry, removeMachine } = registryModule;
  const registry = parseRegistry(JSON.stringify({
    version: 3,
    activeMachineId: "a",
    machines: [machine({ machineId: "a", lastUsedAt: 100 }), machine({ machineId: "b", serverUrl: "http://10.0.0.2:8787", lastUsedAt: 500 })],
  }));
  const next = removeMachine(registry, "a");
  assert.equal(next.activeMachineId, "b");
  assert.equal(next.machines.length, 1);
  assert.deepEqual(removeMachine(next, "b").machines, []);
  assert.equal(removeMachine(next, "b").activeMachineId, "");
});

t("removing an inactive machine leaves the active pointer alone", () => {
  const { parseRegistry, removeMachine } = registryModule;
  const registry = parseRegistry(JSON.stringify({
    version: 3,
    activeMachineId: "a",
    machines: [machine({ machineId: "a" }), machine({ machineId: "b", serverUrl: "http://10.0.0.2:8787" })],
  }));
  assert.equal(removeMachine(registry, "b").activeMachineId, "a");
});

t("summaries expose card fields and never invent liveness", () => {
  const { machineSummaries, parseRegistry } = registryModule;
  const registry = parseRegistry(JSON.stringify({
    version: 3,
    activeMachineId: "a",
    machines: [
      machine({ machineId: "a", machineName: "Desk", lastUsedAt: 1234 }),
      machine({ machineId: "b", machineName: "Laptop", serverUrl: "https://turnloom.example.com", lastUsedAt: 99 }),
    ],
  }));
  const [desk, laptop] = machineSummaries(registry);
  assert.deepEqual(desk, { id: "a", name: "Desk", host: "192.168.1.10:8787", active: true, harnessCount: 1, lastUsedAt: 1234, platforms: [{ key: "codex", label: "Codex Desktop", mark: "CX" }] });
  assert.deepEqual(laptop, { id: "b", name: "Laptop", host: "turnloom.example.com", active: false, harnessCount: 1, lastUsedAt: 99, platforms: [{ key: "codex", label: "Codex Desktop", mark: "CX" }] });
  assert.deepEqual(machineSummaries(null), []);
});

t("serialize/parse round-trips tokens and default harness", () => {
  const { parseRegistry, serializeRegistry, upsertMachine } = registryModule;
  const registry = upsertMachine(null, machine(), 7);
  const parsed = parseRegistry(serializeRegistry(registry));
  assert.equal(parsed.machines[0].machineToken, "MACHINE-TOKEN");
  assert.equal(parsed.machines[0].harnesses[0].token, "HARNESS-TOKEN");
  assert.equal(parsed.machines[0].defaultHarnessId, "codex");
});
