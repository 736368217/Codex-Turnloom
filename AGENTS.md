# Codex-Turnloom — repository agent rules

This file is the public, tracked counterpart to the private operator memory. It guides any
coding agent (Codex, PI, or another) working in this repository. It is intentionally short;
the binding product contract is [`docs/option-a/SINGLE_APP_CONTRACT.md`](docs/option-a/SINGLE_APP_CONTRACT.md).

## What this project is

A private, self-hosted mobile workbench for AI agents running on your own computer:
Codex Desktop and PI-Desktop. The phone connects over LAN/VPN (or an HTTPS relay) to a local
Node service; conversations and files stay on the computer.

## Delivery line (do not drift)

- **Only** `app/` + `native-shell/` is the shipping client: React + Vite + Konsta UI + Vaul
  compiled into an Android Java WebView container (`ROUTE=dom-shell`).
- `public/`, `mobile-app/`, `android/`, `dist-native/`, `dshgo/` are frozen archives. Do not
  base new features on them, and do not present them as the current client.
- `server.js` / `backends/` keep the `/api/*` contract. `desktop/` is the Windows tray console.
- `third-party/turnloom-pidesktop/` is the PI-Desktop bridge. Codex data is read-only; writes
  go through the host IPC.

## Product bar

- Light **Option A** (Cupertino Daylight Glass) only: `#F2F2F7` canvas, white grouped cards,
  `#E5E5EA` separators, glass top/bottom bars, bottom gesture sheets. No dark primary UI, no
  centered desktop modals, no footer/breadcrumb web chrome.
- Mobile-first: 390×844 reference, also 320/360/768; no horizontal overflow; touch targets
  ≥44px; safe areas; keyboard must not cover the composer; system Back must not quit mid-flow.
- State must be honest: never show "offline" for an HTTP 4xx/5xx that the server answered, and
  never enable an approval without a real `requestId` + `detailsHash` + `canApprove`.
- A finished piece of work includes its verification: command output, screenshot, request log,
  or a test name. "Should work" is not a result.

## UX bar (applies to every control you add or keep)

- **One test per control**: "when does the user need this?" If the answer is not a moment in a
  real task, delete the control. A second way to do the same thing is a defect, not a courtesy.
- **Zero states do not render**: a count of 0, an empty group, a disabled row with nothing to
  say — either hide it or say something only the real state can produce.
- **Numbers have one source**: a count shown on the phone must equal what the computer or the
  server says. Two surfaces disagreeing is a bug with a name, not a rounding detail. If the two
  sides really do count different things, the UI must label both (e.g. 运行中 / 待你处理).
- **Same question, one place**: machine status lives on the device page, not duplicated in
  settings; update lives on the version row, not in a second card.

## Commands

```powershell
npm ci
npm test
npm run check
npm run app:typecheck
npm run app:build
npm run app:android          # APK path: dist-app/Codex-Turnloom-<version>-app.apk
node scripts/verify-single-app.mjs
```

For a debug APK without release keys:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-single-app.ps1 -BuildType debug
```

**Vite builds need a temp directory this process can delete.** On this machine
`npm run app:build` (and `check-redesign --build`, which runs Vite in `app/`)
dies in `[vite:esbuild-transpile]` with `remove
C:\Users\<you>\AppData\Local\Temp\esbuild-…: Access is denied` unless `TEMP`/`TMP`
point inside the repository. That error is an environment problem, not a code
problem — a red gate that reports `vite build exited 1` on an otherwise clean
tree is usually this:

```powershell
$env:TEMP = 'D:\Turn-DSH\Codex-Turnloom\.scratch\tmp'; $env:TMP = $env:TEMP
npm run app:build
```

## Releasing (a version is not "done" until it is public)

Every shipped version must leave the machine it was built on:

1. `main` is pushed to `origin` — no version may exist only on one computer.
2. The tag `v<version>` and a GitHub Release exist, carrying the APK, the Windows server
   upgrade zip, and a `.sha256` for each.
3. The update channel (`latest.json`) points at the same bytes; version, size and sha256 agree
   in all three places (build output, Release asset, manifest).

```powershell
$env:GIT_PROXY="http://127.0.0.1:7897"      # only where a proxy is needed
npm run release -- --version 2.4.0 --notes docs/RELEASE_2_4_0_2026-11-21.md
```

The script refuses a dirty tree, a version mismatch between `native-shell/app/build.gradle.kts`
and `app/package.json`, or a missing artifact, then re-reads the Release asset digests and
compares them with the local hashes. Never announce "已更新" before that check passes.

## Host safety (a mistake here can destroy the machine)

- **Never assign `$HOME` in PowerShell.** It is a read-only automatic variable: the assignment
  throws a *non-terminating* error, every later `$HOME` still points at the real user profile,
  and a cleanup that follows deletes the real profile. Use `$FixtureHome`, and start destructive
  scripts with `$ErrorActionPreference = 'Stop'` and `Set-StrictMode -Version Latest`.
- **A recursive delete may only target a root created by this run**: a `%TEMP%\turnloom-qa-<id>`
  directory, or `.scratch\<id>` inside the repo. Resolve and validate it first (exists, is a
  directory, not a reparse point, not `$HOME` / `$env:USERPROFILE` / volume root / the workspace
  root), then delete with `-LiteralPath`. Empty, relative, `..`, or a failed resolution aborts —
  never fall back to the current directory or the user profile.
- **Destructive commands are reviewed one by one — not banned, not waved through.**
  Before anything that deletes, overwrites, resets, reformats or mirrors data
  (`Remove-Item -Recurse`, `rd /s`, `rm -rf`, `git clean -fdx`, `git reset --hard`,
  `robocopy /mir`, `format`, `diskpart`, registry deletes), print the resolved absolute
  target, the object count and what recovery exists. Run the dry run first (`-WhatIf`,
  `git clean -ndx`, `--dry-run`) and abort if the output names `%USERPROFILE%`, a volume
  root, the repo root, or anything outside the task's scope.
- **Anything this run did not create needs an explicit approval in the Thread that names
  the target and the object count.** A general "clean up" does not cover a different path;
  no approval means no command. A delete inside a `%TEMP%\turnloom-qa-<id>` or
  `.scratch\<id>` root this run created still prints its target first, but needs no second
  approval. Prefer `workspace-write`; `danger-full-access` is requested per task, not a default.
- **Prefer quarantine over deletion**: move to `.scratch\<run-id>\quarantine\<timestamp>\`
  and delete only after the task is accepted, so a mistake stays recoverable.
- **Log it**: command, resolved target, object count and result go into the task report.
  If the target cannot be resolved, stop — never fall back to cwd, `$HOME` or a parent.
- **Tests never clean real user data.** A test that needs a "fresh home" gets a synthetic
  `--codex-home` under `%TEMP%`; it never deletes the real `~/.codex`, `~/.dsh`, `~/.zcode`,
  or a real AVD.
- Incident and the four-input acceptance checklist:
  `docs/team/INCIDENT_2026-11-21_profile-deletion.md`.

## Hygiene

- Do not commit `node_modules/`, `.scratch/`, `dist-app/` APKs, keystores, access codes,
  `bridge.json`, real private conversations, or machine-local paths.
- Keep `app/package-lock.json` tracked for reproducible app builds.
- Do not edit Codex Desktop's data or install; PI-Desktop is a disposable test target.
- Tests that depend on frozen archives must skip when the archive is absent from a clean
  checkout; a clean clone must pass its own gates.
