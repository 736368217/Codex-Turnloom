# Codex-Turnloom Android shell (2.1.0 / code 81)

`native-shell/` is the WebView-based Android container for the packaged React UI.

## Runtime boundaries

- Launcher `MainActivity` loads only `file:///android_asset/public/index.html`.
  External navigation is refused. The injected `window.TurnloomNative` bridge is
  callable only while that packaged page is loaded. JavaScript `fetch` to the
  paired server is intentionally not enabled through universal file access.
- `request(requestId, requestJson)` performs bounded, asynchronous
  `HttpURLConnection` calls on a worker pool. Only absolute `/api/*` http(s)
  URLs are accepted; userinfo, fragments, arbitrary schemes, encoded path
  tricks, hop-by-hop headers and cross-origin redirects are rejected.
  `cancelRequest(requestId)` interrupts and disconnects the worker. Results are
  delivered as `window.__turnloomNativeHttpResult(requestId, responseJson)`.
- HTTPS uses the platform trust anchors. Plain HTTP requires an explicit paired
  private LAN origin recorded in app-private preferences, **and** a literal
  host entry in `res/xml/network_security_config.xml`. Android domain config
  does not support CIDR; the bogus CIDR entries were removed. Cleartext LAN
  traffic can be observed by other devices on that LAN; prefer HTTPS.
- `pickAttachments(requestId, kind)` uses `ACTION_OPEN_DOCUMENT` on the UI
  thread with `CATEGORY_OPENABLE`, `EXTRA_ALLOW_MULTIPLE`, `image/*` or `*/*`.
  It needs no storage permission or persistent URI grant. The single pending
  request is tracked; cancellation, no selection and a launch failure all return
  an explicit status rather than a fabricated success. ContentResolver bytes are
  read on one background worker, with at most 4 items, 4 MiB per item and 6 MiB
  total. Streams and metadata cursors are closed, errors are stable codes, and
  no content URI, path, exception text or file content is logged. Each item is
  `{name,mimeType,sizeBytes,dataUrl}`; base64 preserves bytes for images and
  arbitrary files, while MIME tokens and names are validated before the result
  is JSON-quoted into `window.__turnloomNativeAttachmentsResult(requestId, resultJson)`.
- The HTTP bridge request envelope is bounded at 9 MiB + 64 KiB and its body at
  9 MiB, enough for a 6 MiB picker selection encoded as base64. Responses are
  bounded at 10 MiB; all three checks remain hard rejections, not unbounded.
- `scanQr(requestId)` opens an in-process `ScannerActivity` with a real
  ZXing (journeyapps `zxing-android-embedded` + `zxing:core`) camera preview
  and QR decoder. Permission denial, cancellation and camera errors are
  explicit; success returns the original raw QR text.
- `downloadUpdate(requestId, optionsJson)` downloads to a private
  `files/updates/pending.apk.part`, supports HTTP `Range` continuation and
  preserves the partial after cancellation/transient errors. `ready` is emitted
  only after SHA-256, APK package, greater versionCode and signer checks pass.
  `cancelUpdate()` preserves the partial. `installUpdate()` is an explicit user
  action: it may first show Android's unknown-sources permission screen, then
  hands the validated APK through a narrow read-only content provider to the
  system installer, which requires user confirmation. There is no automatic
  install or silent success.
- `getAppInfo()` reads the real `PackageInfo` version/code and truthful
  capability booleans; hardware acceleration and the blue launcher icon are
  unchanged. The back stack is still handled by `window.__turnloomBack()` and
  `moveTaskToBack(true)`.

## Bridge methods

`secureGet`, `secureSet`, `secureRemove`, `haptic`, `scanQr`, `getAppInfo`,
`setLightBars`, `pickAttachments`, `request`, `cancelRequest`, `downloadUpdate`,
`cancelUpdate`, `installUpdate`.

Callbacks: `window.__turnloomNativeQrResult`, `window.__turnloomNativeQrError`,
`window.__turnloomNativeHttpResult`, `window.__turnloomNativeUpdateEvent`,
`window.__turnloomNativeAttachmentsResult`, `window.__turnloomBack`.

## Build and tests

The parent `scripts/build-single-app.ps1` copies the frontend build into
`app/src/main/assets/public/`, runs `gradlew assembleRelease`, then zipaligns
and signs the unsigned APK. This is a 2.1.0 / versionCode 81 tree; do not
overwrite the 2.0.0 artifact.

Toolchain: Gradle 8.10.2, AGP 8.7.3, compileSdk 35, JDK 21,
`GRADLE_USER_HOME=D:\HermesData\gradle`. Real ZXing and androidx.core
dependencies are used; the earlier zero-dependency assumption is obsolete.
An online Gradle pass may be needed once to refresh dependency metadata; the
artifacts and plugin are present in the shared cache.

Local JVM tests (no emulator): `gradlew :app:testReleaseUnitTest --offline`.
They cover URL/origin/path validation, request header/method/timeout bounds,
the 9 MiB body envelope and 10 MiB response bounds, update descriptor parsing,
origin equality, log-safe error JSON and the picker's size/status/metadata
contract.

## Known limits

- Real document picking, camera QR recognition, installer permission flows
  and update installation require a device/emulator; a successful Gradle build
  and JVM unit tests do not prove those system flows. The picker's URI grant,
  multi-select result and byte reading are device-side acceptance items.
- HTTP LAN hosts must be listed literally in `network_security_config.xml`.
  HTTPS does not need entries. The included `192.168.1.10` is an example only.
- Release signing uses the parent build's debug keystore; this is not a
  production signing configuration.
