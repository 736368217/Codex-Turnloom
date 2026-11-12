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
`setLightBars`, `request`, `cancelRequest`, `downloadUpdate`, `cancelUpdate`,
`installUpdate`.

Callbacks: `window.__turnloomNativeQrResult`, `window.__turnloomNativeQrError`,
`window.__turnloomNativeHttpResult`, `window.__turnloomNativeUpdateEvent`,
`window.__turnloomBack`.

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
update descriptor parsing, origin equality and log-safe error JSON.

## Known limits

- Real camera QR recognition, installer permission flows and update
  installation require a device/emulator; a successful Gradle build and JVM
  unit tests do not prove those hardware/system flows.
- HTTP LAN hosts must be listed literally in `network_security_config.xml`.
  HTTPS does not need entries. The included `192.168.1.10` is an example only.
- Release signing uses the parent build's debug keystore; this is not a
  production signing configuration.
