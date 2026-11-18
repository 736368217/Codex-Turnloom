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

## Hygiene

- Do not commit `node_modules/`, `.scratch/`, `dist-app/` APKs, keystores, access codes,
  `bridge.json`, real private conversations, or machine-local paths.
- Keep `app/package-lock.json` tracked for reproducible app builds.
- Do not edit Codex Desktop's data or install; PI-Desktop is a disposable test target.
- Tests that depend on frozen archives must skip when the archive is absent from a clean
  checkout; a clean clone must pass its own gates.
