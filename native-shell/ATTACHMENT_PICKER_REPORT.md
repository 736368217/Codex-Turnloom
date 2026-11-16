# Native attachment picker implementation report

Scope: `native-shell/**` only. No edits to `app/**`, generated `assets/public`,
`server*`, `scripts*`, manifest or `build.gradle.kts`. The version change to
2.1.2 / 83 was already present on disk from the parent session and was left
untouched. No delegation, emulator, process restart or workspace-concurrent
build was used.

## Changed files

- `native-shell/app/src/main/java/com/codex/turnloom/app/AttachmentPicker.java` (new)
- `native-shell/app/src/main/java/com/codex/turnloom/app/MainActivity.java`
- `native-shell/app/src/main/java/com/codex/turnloom/app/BridgeContract.java`
- `native-shell/app/src/test/java/com/codex/turnloom/app/BridgeContractTest.java`
- `native-shell/README.md`

## Implemented behavior

- Added `@JavascriptInterface pickAttachments(requestId, kind)` to the existing
  injected `TurnloomNative` object. `kind` is exactly `image` or `file`.
  `requestId` uses the existing strict `[A-Za-z0-9._:-]{1,128}` validator.
- The bridge thread only checks the existing volatile page flags and hands off
  via `mainHandler.post`; it never calls a `WebView` getter. The UI thread
  launches `ACTION_OPEN_DOCUMENT` through `startActivityForResult` with
  `CATEGORY_OPENABLE`, `EXTRA_ALLOW_MULTIPLE=true`, and `image/*` or `*/*`.
  One pending request/kind is tracked. No storage permission, persistent URI
  grant or `WebChromeClient`/`onShowFileChooser` fallback was added.
- Cancellation (`RESULT_CANCELED`), no selected URI and null/missing data all
  produce `{"status":"cancelled","items":[]}`. A second concurrent request gets
  `picker-busy`; a launch exception gets `picker-unavailable`. Invalid request
  or kind gets a corresponding stable error code. No fake success.
- Results use exactly:
  `window.__turnloomNativeAttachmentsResult(requestId, resultJson)`, with both
  arguments `JSONObject.quote`d. `resultJson` is
  `{status:'success'|'cancelled'|'error',items:[{name,mimeType,sizeBytes,dataUrl}],error?:stable-code}`.
  Success has no `error`; cancelled/error always have an `items` array.
- Real `ContentResolver` bytes are read on a single background executor with
  try-with-resources streams and closed metadata cursors. Limits: 4 files,
  4 MiB each, 6 MiB aggregate. Reading stops at `limit+1`; oversized files are
  not buffered. `sizeBytes` is the real byte count and base64 `NO_WRAP`
  preserves bytes and MIME for both binary files and images. MIME tokens are
  normalized/validated; display names are bounded to 120 characters, stripped
  of control characters and JS line separators, then JSON-quoted. No content
  URI, filesystem path, exception text, token or file content is logged or
  included in an error. Stable codes include `invalid-request`, `invalid-kind`,
  `picker-busy`, `picker-unavailable`, `too-many-files`, `file-too-large`,
  `attachments-too-large`, `read-failed`, `invalid-mime-type`.
- Bounded HTTP request limits are now consistently: request JSON envelope
  9 MiB + 64 KiB, decoded POST body 9 MiB, response 10 MiB. This admits the
  maximum 6 MiB raw picker aggregate (8 MiB base64) plus JSON overhead;
  `MAX_HTTP_RESPONSE_BYTES` was raised from 4 MiB so an echoed request is not
  truncated by `NativeHttpClient.readBounded`. All three are still hard bounds.
- `NativeHttpPolicy` needed no numeric change: its API is origin/transport
  validation and `configure()` applies the already validated bounded body to
  `HttpURLConnection`; no separate body cap exists there.
- Added JVM tests for the 9 MiB body acceptance, both oversized-request
  rejections, picker limits/kinds/request IDs, cancelled/error/success JSON
  shape, safe MIME/name handling (including U+2028/U+2029), and binary dataUrl
  shape. README documents methods, callback, actual bounds and device limits.

## Actual verification

Built in this session's own scratch copy only:
`D:\pi-data\data\scratch\a46ed19c-b13d-4c89-9d2e-3be12ac8339c\native-shell-verify`
(copied from the current disk state, excluding workspace `.gradle`/`build`).

Command (final pass, JDK 21 / Gradle 8.10.2 offline):

    gradlew.bat --offline --no-daemon --console=plain :app:compileReleaseJavaWithJavac :app:testReleaseUnitTest :app:assembleRelease

Result: `BUILD SUCCESSFUL`, exit 0; logs at
`%PI_SCRATCH_DIR%\native-shell-final-gradle.log` and
`native-shell-gradle.log` / `native-shell-assemble.log`.
An earlier compile exposed two Java errors (duplicate local, overlapping
multi-catch alternatives); both were fixed before the final pass.

Test evidence:
`native-shell-verify/app/build/test-results/testReleaseUnitTest/TEST-com.codex.turnloom.app.BridgeContractTest.xml`:
`tests="10" skipped="0" failures="0" errors="0"`.
Release Java compilation produced `AttachmentPicker.class` and
`MainActivity$TurnloomBridge.class`; `assembleRelease` produced
`app-release-unsigned.apk` (1,725,394 bytes) in scratch. This is an unsigned
verification artifact, not a delivery APK. `git diff --check -- native-shell`
is clean.

Static source checks confirmed: exact bridge signature and callback, SAF
action/category/multi-select/MIME selection, `startActivityForResult`, no
storage permission, no persistent grant and no WebChromeClient fallback.
No edits were made to `app/`, `server*`, `scripts*`, generated assets, manifest
or build version.

## Remaining acceptance (parent session / device)

Static compilation and JVM tests cannot prove the Android SAF runtime flow.
Device acceptance still needs: actual document picker launch and URI grant;
single/multiple image and binary selections; cancellation and no-data callbacks;
4-file / 4 MiB / 6 MiB rejection paths; and end-to-end frontend consumption of
`window.__turnloomNativeAttachmentsResult` plus a 6 MiB aggregate POST through
the native HTTP bridge. The parent session owns final signing, APK and
emulator/device verification.
