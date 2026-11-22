#!/usr/bin/env node
/**
 * Publish one release: tag, push, GitHub Release, and prove the bytes.
 *
 * The rule this script exists for: a version only counts as released when it is
 * (1) on origin/main, (2) tagged, and (3) downloadable from a GitHub Release whose
 * asset digest equals the file the build produced. Anything less is a local build.
 *
 * Usage:
 *   node scripts/release-github.mjs --version 2.4.0 --notes docs/RELEASE_2_4_0_2026-11-21.md
 *   node scripts/release-github.mjs --version 2.4.0 --notes … --dry-run
 *
 * Environment:
 *   GIT_PROXY   optional HTTP proxy for git/gh (this machine needs http://127.0.0.1:7897)
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, mkdtempSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..');
const PROXY = process.env.GIT_PROXY || '';
// A token makes this script independent of the machine's credential helper:
// Git Credential Manager can pop a GUI prompt (or hang headless) and `gh` may
// hold a stale token. Pass GITHUB_TOKEN/GH_TOKEN and both git and gh use it.
const TOKEN = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
const args = process.argv.slice(2);

function arg(name, fallback = '') {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || '') : fallback;
}
const flag = (name) => args.includes(name);

const version = arg('--version');
const notesPath = arg('--notes');
const dryRun = flag('--dry-run');
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('usage: node scripts/release-github.mjs --version <x.y.z> --notes <file.md> [--dry-run]');
  process.exit(2);
}

const sh = (cmd, argv, env = process.env) => execFileSync(cmd, argv, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env }).trim();
const AUTH_HEADER = TOKEN ? `Authorization: Basic ${Buffer.from(`x-access-token:${TOKEN}`).toString('base64')}` : '';
const git = (...argv) => {
  const config = [];
  if (PROXY) config.push('-c', `http.proxy=${PROXY}`, '-c', `https.proxy=${PROXY}`);
  if (AUTH_HEADER) config.push('-c', `http.https://github.com/.extraheader=${AUTH_HEADER}`);
  return sh('git', [...config, ...argv]);
};
const ghEnv = () => (TOKEN ? { ...process.env, GH_TOKEN: TOKEN, GH_NO_UPDATE_NOTIFIER: '1' } : { ...process.env, GH_NO_UPDATE_NOTIFIER: '1' });
const gh = (...argv) => sh('gh', argv, ghEnv());
const fail = (message) => { console.error(`release: ${message}`); process.exit(1); };

// 1. Identity must agree in all three places that carry it.
const gradle = readFileSync(join(REPO, 'native-shell/app/build.gradle.kts'), 'utf8');
const versionName = (gradle.match(/versionName\s*=\s*"([^"]+)"/) || [])[1] || '';
const versionCode = Number((gradle.match(/versionCode\s*=\s*(\d+)/) || [])[1] || 0);
const appPkg = JSON.parse(readFileSync(join(REPO, 'app/package.json'), 'utf8'));
if (versionName !== version) fail(`build.gradle.kts says ${versionName || '(none)'}, asked for ${version}`);
if (appPkg.version !== version) fail(`app/package.json says ${appPkg.version}; bump it with the gradle version`);
if (!versionCode) fail('build.gradle.kts has no versionCode');

// 2. Nothing uncommitted may ride along, and the tree must already be on main.
const dirty = git('status', '--porcelain', '--untracked-files=no');
if (dirty) fail(`working tree is dirty:\n${dirty}`);
if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') fail('not on main');

// 3. Artifacts: APK (release name without -debug) and the Windows server zip.
const candidates = [
  `dist-app/Codex-Turnloom-${version}-app.apk`,
  `dist-app/Codex-Turnloom-${version}-app-debug.apk`,
];
const apkPath = candidates.find((candidate) => existsSync(join(REPO, candidate)));
if (!apkPath) fail(`no APK for ${version} in dist-app/ — build it first (scripts/build-single-app.ps1)`);
const serverZip = `dist-app/turnloom-${version}-server.zip`;
if (!existsSync(join(REPO, serverZip))) fail(`no server package ${serverZip} — run scripts/package-server-upgrade.ps1`);

const sha256 = (path) => createHash('sha256').update(readFileSync(join(REPO, path))).digest('hex');
const apkSha = sha256(apkPath);
const zipSha = sha256(serverZip);

// 4. Stage the two files under their published names, with fresh checksum files.
const stage = mkdtempSync(join(tmpdir(), `turnloom-release-${version}-`));
const apkName = `Codex-Turnloom-${version}-app.apk`;
const zipName = `turnloom-${version}-server.zip`;
copyFileSync(join(REPO, apkPath), join(stage, apkName));
copyFileSync(join(REPO, serverZip), join(stage, zipName));
writeFileSync(join(stage, `${apkName}.sha256`), `${apkSha}  ${apkName}\n`, 'ascii');
writeFileSync(join(stage, `${zipName}.sha256`), `${zipSha}  ${zipName}\n`, 'ascii');

const notesFile = notesPath ? resolve(notesPath) : '';
if (!notesFile || !existsSync(notesFile)) fail('--notes <release notes markdown> is required and must exist');

const tag = `v${version}`;
console.log(`release ${tag} (${versionCode})\n  apk    ${apkPath}\n  sha256 ${apkSha}\n  zip    ${serverZip}\n  sha256 ${zipSha}`);
if (dryRun) {
  console.log('dry-run: nothing pushed');
  process.exit(0);
}

// 5. Push main first: a tag without the branch is a version nobody can build.
git('push', 'origin', 'main');
const existing = (() => { try { return git('tag', '--list', tag); } catch { return ''; } })();
if (!existing) git('tag', '-a', tag, '-m', `Codex-Turnloom ${version} (${versionCode})`);
git('push', 'origin', tag);

// 6. GitHub Release with the bytes, then re-read the asset digests.
const body = readFileSync(notesFile, 'utf8');
const bodyFile = join(stage, 'notes.md');
writeFileSync(bodyFile, body, 'utf8');
const has = (() => { try { gh('release', 'view', tag, '--json', 'tagName'); return true; } catch { return false; } })();
if (has) {
  gh('release', 'upload', tag, join(stage, apkName), join(stage, `${apkName}.sha256`), join(stage, zipName), join(stage, `${zipName}.sha256`), '--clobber');
} else {
  gh('release', 'create', tag, join(stage, apkName), join(stage, `${apkName}.sha256`), join(stage, zipName), join(stage, `${zipName}.sha256`),
    '--title', `Codex-Turnloom ${version} (${versionCode})`, '--notes-file', bodyFile);
}

const info = JSON.parse(gh('release', 'view', tag, '--json', 'assets,isLatest,tagName'));
const byName = new Map(info.assets.map((asset) => [asset.name, asset]));
for (const [name, expected] of [[apkName, apkSha], [zipName, zipSha]]) {
  const asset = byName.get(name);
  if (!asset) fail(`release is missing ${name}`);
  const digest = String(asset.digest || '').replace(/^sha256:/, '');
  if (digest && digest !== expected) fail(`${name}: release digest ${digest} != local ${expected}`);
  console.log(`  ✓ ${name} ${asset.size} bytes${digest ? ' digest matches' : ' (no digest recorded)'}`);
}
console.log(`\nrelease: ${tag} published — https://github.com/736368217/Codex-Turnloom/releases/tag/${tag}`);
console.log('next: point public latest.json at this build, then announce in the Main stream.');
