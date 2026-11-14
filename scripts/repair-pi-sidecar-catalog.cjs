'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const target = process.argv[2];
const backupDir = process.argv[3];
if (!target || !backupDir || !path.isAbsolute(target) || !path.isAbsolute(backupDir)) throw Error('Usage: node scripts/repair-pi-sidecar-catalog.cjs <absolute-sidecar> <absolute-backup-dir> [--apply]');
const original = fs.readFileSync(target, 'utf8');
if (original.includes('function modelThinkingFromRow')) throw Error('Already migrated; refusing duplicate edit');
let next = original;
function replaceOnce(before, after) {
  if (next.split(before).length !== 2) throw Error('Expected unique migration anchor: ' + before.slice(0, 70));
  next = next.replace(before, after);
}
const plugin = fs.readFileSync(path.join(__dirname, '../third-party/turnloom-pidesktop/plugin/main.js'), 'utf8');
const helper = plugin.match(/function modelThinkingFromRow\(row\) \{[\s\S]*?\n\}/)?.[0];
if (!helper) throw Error('Canonical thinking helper missing');
replaceOnce('function syncCatalog(models, latest) {', helper + '\n\nfunction syncCatalog(models, latest) {');
replaceOnce('p.enabled AS provider_enabled', 'p.enabled AS provider_enabled, p.config_json AS provider_config_json');
replaceOnce('supported_reasoning_levels: EFFORTS.map((effort) => ({ effort, description: effortDescriptions[effort] || effort })),', 'supported_reasoning_levels: modelThinkingFromRow(row).efforts.map((effort) => ({ effort, description: effortDescriptions[effort] || effort })),');
replaceOnce('default_reasoning_level: "medium",', 'default_reasoning_level: modelThinkingFromRow(row).defaultEffort,');
replaceOnce('const signature = `${entries.length}:${defaultSlug}`;', 'const signature = JSON.stringify([defaultSlug, entries.map(entry => [entry.slug, entry.supported_reasoning_levels, entry.default_reasoning_level])]);');
replaceOnce('`model = "${defaultSlug}"\\nmodel_reasoning_effort = "medium"\\nmodel_catalog_json = "model-catalogs/pidesk.json"\\n`,', '`model = ${JSON.stringify(defaultSlug)}\\n${(() => { const effort = entries.find(entry => entry.slug === defaultSlug).default_reasoning_level; return effort ? `model_reasoning_effort = ${JSON.stringify(effort)}\\n` : ""; })()}model_catalog_json = "model-catalogs/pidesk.json"\\n`,');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const receipt = { target, beforeSha256: digest(original), afterSha256: digest(next), applied: process.argv.includes('--apply') };
if (receipt.applied) {
  fs.mkdirSync(backupDir, { recursive: true });
  const backup = path.join(backupDir, 'pidesk-sidecar.before.mjs');
  if (fs.existsSync(backup)) throw Error('Backup exists; refusing overwrite');
  fs.writeFileSync(backup, original);
  fs.writeFileSync(target, next);
  if (digest(fs.readFileSync(target)) !== receipt.afterSha256) throw Error('Write verification failed');
  fs.writeFileSync(path.join(backupDir, 'receipt.json'), JSON.stringify(receipt, null, 2));
}
console.log(JSON.stringify(receipt));
