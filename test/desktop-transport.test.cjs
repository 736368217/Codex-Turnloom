"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { transportMode, configuredPublicUrl, changeImpact } = require('../desktop/service/transport.cjs');
const { normalizeConfig, urlsFor, validateConfig } = require('../desktop/service/config.cjs');
const { pairingIdentity } = require('../desktop/service/machine-gateway.cjs');
const { RuntimeManager } = require('../desktop/service/runtime.cjs');

const base = { accessCode: 'fixture-only', port: 8787, host: '0.0.0.0', publicUrl: 'https://old.example.test',
  tunnel: { enabled: true, host: 'relay.example.test' }, console: { theme: 'light' } };
function controllers() {
  const calls = [];
  const service = Object.assign(new EventEmitter(), {
    snapshot: () => ({ state: 'running', detail: 'local ready', service: { pid: 42 }, health: { ok: true } }),
    setConfig() {}, restart: async () => { calls.push('service.restart'); return { ok: true }; }
  });
  const tunnel = Object.assign(new EventEmitter(), {
    snapshot: () => ({ enabled: true, state: 'retrying', error: 'remote unavailable' }),
    setConfig() {}, stop: async () => { calls.push('relay.stop'); }, start: async () => { calls.push('relay.start'); }
  });
  return { calls, service, tunnel };
}
test('legacy SSH and external URL configurations retain their mode', () => {
  assert.equal(transportMode(base), 'ssh');
  assert.equal(transportMode({ publicUrl: base.publicUrl }), 'external');
  assert.equal(transportMode({}), 'direct');
});
test('explicit direct mode ignores old public URLs without erasing them or machine identity', () => {
  const config = normalizeConfig({ ...base, network: { mode: 'direct' }, machineGateway: { origin: 'https://stale.example.test' } });
  assert.equal(config.tunnel.enabled, false);
  assert.equal(config.publicUrl, base.publicUrl);
  assert.equal(configuredPublicUrl(config), '');
  const urls = urlsFor(config);
  assert.equal(urls.publicUrl, '');
  assert.equal(urls.browser, urls.lan);
  assert.equal(pairingIdentity(config, urls).url, urls.lan);
});
test('external proxy uses editable client URL rather than stale gateway origin and needs no SSH files', () => {
  const config = normalizeConfig({ ...base, network: { mode: 'external' }, publicUrl: 'https://new.example.test',
    machineGateway: { origin: 'https://old.example.test' }, tunnel: { enabled: true, keyPath: '', knownHostsPath: '' } });
  assert.equal(config.tunnel.enabled, false);
  assert.equal(urlsFor(config).publicUrl, 'https://new.example.test');
  assert.equal(validateConfig(config).filter(e => e.field.startsWith('tunnel.')).length, 0);
  assert.ok(validateConfig({ ...config, publicUrl: 'https://user:secret@example.test' }).some(e => e.field === 'publicUrl'));
});
test('appearance and client URL changes do not restart server or relay', async () => {
  const deps = controllers();
  const runtime = new RuntimeManager({ config: base, logger: {}, ...deps });
  await runtime.applyConfig({ ...base, publicUrl: 'https://new.example.test', console: { theme: 'dark' } });
  assert.deepEqual(deps.calls, []);
});
test('changing relay mode leaves the healthy session service running', async () => {
  const deps = controllers();
  const runtime = new RuntimeManager({ config: base, logger: {}, ...deps });
  const next = normalizeConfig({ ...base, network: { mode: 'direct' } });
  // Compare complete normalized configs, as the real save path does.
  runtime.setConfig(normalizeConfig(base));
  const impact = await runtime.applyConfig(next);
  assert.equal(impact.service, false);
  assert.deepEqual(deps.calls, ['relay.stop']);
  assert.equal(runtime.snapshot().topology.server.healthy, true);
  assert.equal(runtime.snapshot().topology.relay.state, 'disabled');
});
test('port changes restart the service and SSH in dependency order', async () => {
  const deps = controllers();
  const runtime = new RuntimeManager({ config: base, logger: {}, ...deps });
  await runtime.applyConfig({ ...base, port: 9000 });
  assert.deepEqual(deps.calls, ['relay.stop', 'service.restart', 'relay.start']);
});
test('relay failure remains separately visible while local server is healthy', () => {
  const runtime = new RuntimeManager({ config: base, logger: {}, ...controllers() });
  const snap = runtime.snapshot();
  assert.equal(snap.topology.server.state, 'running');
  assert.equal(snap.topology.relay.state, 'retrying');
  assert.equal(snap.health.ok, true);
  assert.equal(changeImpact(base, { ...base, readonly: true }).service, true);
});

test('SSH readiness requires a remote forwarding confirmation, not process age', () => {
  const { confirmsRemoteForward } = require('../desktop/service/tunnel.cjs');
  assert.equal(confirmsRemoteForward('debug1: Connecting to relay.test port 22.'), false);
  assert.equal(confirmsRemoteForward('debug1: Authentication succeeded'), false);
  assert.equal(confirmsRemoteForward('debug1: remote forward failure for: listen 127.0.0.1:9000'), false);
  assert.equal(confirmsRemoteForward('debug1: remote forward success for: listen 127.0.0.1:9000, connect 127.0.0.1:8787'), true);
});

test('failed service restart does not advertise a newly started relay', async () => {
  const deps = controllers();
  deps.service.restart = async () => { deps.calls.push('service.restart'); return { ok: false }; };
  const runtime = new RuntimeManager({ config: base, logger: {}, ...deps });
  await runtime.applyConfig({ ...base, port: 9100 });
  assert.deepEqual(deps.calls, ['relay.stop', 'service.restart']);
});
