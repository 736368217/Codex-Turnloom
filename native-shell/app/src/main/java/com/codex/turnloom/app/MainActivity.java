package com.codex.turnloom.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Codex-Turnloom Android shell: a full-screen WebView bound to the packaged
 * UI, with native camera, scoped HTTP, app update and secure storage bridges.
 *
 * <p>The WebView stays on file:///android_asset/public/index.html. It never
 * gets universal file access; API requests use the native HttpURLConnection
 * executor, which enforces explicit private-LAN pairing and HTTPS origins.</p>
 */
public class MainActivity extends Activity {
    private static final String LOCAL_ENTRY = "file:///android_asset/public/index.html";
    private static final String PREFS_NAME = "turnloom_native_secure_v1";
    private static final int REQ_SCAN = 0x52;
    private static final int REQ_INSTALL = 0x62;

    private WebView webView;
    private NativeHttpClient httpClient;
    private UpdateManager updateManager;
    private AttachmentPicker attachmentPicker;
    private final WebViewStartup webViewStartup = new WebViewStartup();
    private volatile boolean packagedPageLoaded = false;
    private volatile boolean loadingPackagedPage = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        NativeHttpPolicy.initialize(getApplicationContext());

        // A pairing URL saved by the frontend is the explicit user action that
        // permits native plain HTTP to this private LAN origin.
        String pairedUrl = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                .getString("turnloom.serverUrl", "");
        if (!pairedUrl.isEmpty()) {
            NativeHttpPolicy.pairLanOrigin(this, pairedUrl + "/api/health");
        }
        startWebView();
    }

    private void startWebView() {
        webViewStartup.attempt(() -> getDir("webview", Context.MODE_PRIVATE),
                this::initializeWebView, error -> {
                    Log.e("Turnloom", WebViewStartup.ERROR_CODE, error);
                    releaseWebViewResources();
                    showWebViewFailure();
                });
    }

    private void showWebViewFailure() {
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setGravity(Gravity.CENTER);
        int padding = (int) (24 * getResources().getDisplayMetrics().density);
        page.setPadding(padding, padding, padding, padding);
        page.setBackgroundColor(Color.parseColor("#F2F2F7"));
        TextView title = new TextView(this);
        title.setText("暂时无法启动应用界面");
        title.setTextSize(22);
        title.setTextColor(Color.parseColor("#1C1C1E"));
        page.addView(title);
        TextView detail = new TextView(this);
        detail.setText("系统 WebView 初始化失败，请重试。配对信息已保留。\n"
                + WebViewStartup.ERROR_CODE);
        detail.setTextSize(16);
        detail.setTextColor(Color.parseColor("#636366"));
        detail.setPadding(0, padding, 0, padding);
        page.addView(detail);
        Button retry = new Button(this);
        retry.setText("重试");
        retry.setTextColor(Color.WHITE);
        retry.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.parseColor("#0062CC")));
        retry.setMinHeight((int) (48 * getResources().getDisplayMetrics().density));
        retry.setOnClickListener(view -> {
            retry.setEnabled(false);
            startWebView();
        });
        page.addView(retry);
        setContentView(page);
        applyLightSystemBars();
    }

    private void initializeWebView() {

        webView = new WebView(this);
        if (getIntent() != null && getIntent().getBooleanExtra("turnloom.softwareLayer", false)) {
            webView.setLayerType(View.LAYER_TYPE_SOFTWARE, null);
        }
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.setBackgroundColor(Color.parseColor("#F2F2F7"));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setLongClickable(false);
        webView.setHapticFeedbackEnabled(false);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMediaPlaybackRequiresUserGesture(true);

        attachmentPicker = new AttachmentPicker(this,
                (intent, requestCode) -> startActivityForResult(intent, requestCode),
                this::deliverAttachmentsResult);
        httpClient = new NativeHttpClient(this, this::deliverHttpResult);
        updateManager = new UpdateManager(this, new UpdateManager.Deliverer() {
            @Override public void deliverUpdate(String id, String json) {
                deliverUpdateEvent(id, json);
            }
            @Override public void launchInstaller(Intent intent, int requestCode) {
                try {
                    startActivityForResult(intent, requestCode);
                } catch (Exception e) {
                    deliverUpdateEvent(updateManager.currentRequestId(),
                            "{\"state\":\"error\",\"message\":\"installer-unavailable\"}");
                }
            }
        });
        webView.addJavascriptInterface(new TurnloomBridge(), "TurnloomNative");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                // Rejected navigation leaves the current packaged document intact.
                return !isPackagedPage(url);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (view != webView) return;
                packagedPageLoaded = isPackagedPage(url);
                loadingPackagedPage = false;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                if (view != webView) return;
                if (!isPackagedPage(url)) {
                    packagedPageLoaded = false;
                    loadingPackagedPage = false;
                    view.stopLoading();
                    return;
                }
                packagedPageLoaded = false;
                loadingPackagedPage = true;
            }

            @Override
            public android.webkit.WebResourceResponse shouldInterceptRequest(
                    WebView view, String url) {
                if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
                    return new android.webkit.WebResourceResponse("text/plain", "UTF-8",
                            new java.io.ByteArrayInputStream(new byte[0]));
                }
                return super.shouldInterceptRequest(view, url);
            }
        });
        webView.setWebChromeClient(new WebChromeClient());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            boolean qaDebug = getIntent() != null
                    && getIntent().getBooleanExtra("turnloom.qaDebug", false);
            WebView.setWebContentsDebuggingEnabled(qaDebug);
        }
        loadingPackagedPage = true;
        webView.loadUrl(LOCAL_ENTRY);
    }

    private static boolean isPackagedPage(String url) {
        return url != null && url.startsWith("file:///android_asset/public/")
                && !url.contains("..") && !url.contains("%");
    }

    /** Restrict all JS bridge calls to the packaged local page. */
    private boolean bridgeAllowed() {
        // JavascriptInterface methods run on WebView's bridge thread. Never
        // call WebView getters here; the page-load callback records this flag
        // on the UI thread before the packaged page can use the bridge.
        return webView != null && (loadingPackagedPage || packagedPageLoaded);
    }

    private void evaluateBridgeJs(String js) {
        WebView target = webView;
        if (target == null) return;
        target.post(() -> {
            if (webView == target && bridgeAllowed()) target.evaluateJavascript(js, null);
        });
    }

    private void deliverHttpResult(String requestId, String responseJson) {
        if (!BridgeContract.validRequestId(requestId)) return;
        String js = "window.__turnloomNativeHttpResult && window.__turnloomNativeHttpResult("
                + JSONObject.quote(requestId) + "," + JSONObject.quote(responseJson) + ")";
        evaluateBridgeJs(js);
    }

    private void deliverUpdateEvent(String requestId, String eventJson) {
        if (!BridgeContract.validRequestId(requestId)) return;
        String js = "window.__turnloomNativeUpdateEvent && window.__turnloomNativeUpdateEvent("
                + JSONObject.quote(requestId) + "," + JSONObject.quote(eventJson) + ")";
        evaluateBridgeJs(js);
    }

    private void deliverQrResult(String requestId, String value) {
        if (!BridgeContract.validRequestId(requestId)) return;
        String js = "window.__turnloomNativeQrResult && window.__turnloomNativeQrResult("
                + JSONObject.quote(requestId) + ","
                + JSONObject.quote(value == null ? "" : value) + ")";
        evaluateBridgeJs(js);
    }

    private void deliverQrError(String requestId, String code, String message) {
        if (!BridgeContract.validRequestId(requestId)) return;
        String js = "window.__turnloomNativeQrError && window.__turnloomNativeQrError("
                + JSONObject.quote(requestId) + "," + JSONObject.quote(code) + ","
                + JSONObject.quote(message) + ")";
        evaluateBridgeJs(js);
    }

    private void deliverAttachmentsResult(String requestId, String resultJson) {
        if (!BridgeContract.validRequestId(requestId) || !bridgeAllowed()) return;
        String js = "window.__turnloomNativeAttachmentsResult "
                + "&& window.__turnloomNativeAttachmentsResult("
                + JSONObject.quote(requestId) + "," + JSONObject.quote(resultJson) + ")";
        evaluateBridgeJs(js);
    }

    private void applyLightSystemBars() {
        try {
            Window w = getWindow();
            w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            w.setStatusBarColor(Color.parseColor("#F2F2F7"));
            w.setNavigationBarColor(Color.parseColor("#FFFFFF"));
            View decor = w.getDecorView();
            if (decor == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                WindowInsetsController c = w.getInsetsController();
                if (c != null) {
                    c.setSystemBarsAppearance(
                            WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                                    | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                            WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                                    | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
                }
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                int flags = decor.getSystemUiVisibility();
                decor.setSystemUiVisibility(flags | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
            }
        } catch (Throwable ignored) {
            // Cosmetic fallback; never break app startup.
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyLightSystemBars();
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            moveTaskToBack(true);
            return;
        }
        webView.evaluateJavascript(
                "(function(){try{return typeof window.__turnloomBack === 'function' "
                        + "? (window.__turnloomBack() === true) : false;}catch(e){return false;}})()",
                value -> {
                    boolean handled = value != null && value.trim().equals("true");
                    if (!handled) moveTaskToBack(true);
                });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_SCAN) {
            String id = data == null ? "" : data.getStringExtra(ScannerActivity.EXTRA_REQUEST_ID);
            if (!BridgeContract.validRequestId(id)) return;
            String value = data == null ? "" : data.getStringExtra(ScannerActivity.EXTRA_QR_VALUE);
            String code = data == null ? "" : data.getStringExtra(ScannerActivity.EXTRA_ERROR_CODE);
            String message = data == null ? "" : data.getStringExtra(ScannerActivity.EXTRA_ERROR_MESSAGE);
            if (code != null && !code.isEmpty()) {
                deliverQrError(id, code, message == null ? "scan-error" : message);
            } else {
                deliverQrResult(id, value == null ? "" : value);
            }
        } else if (AttachmentPickSession.ownsCode(requestCode)) {
            if (attachmentPicker != null) attachmentPicker.onActivityResult(requestCode, resultCode, data);
        } else if (requestCode == REQ_INSTALL) {
            if (updateManager != null) updateManager.onInstallerResult(resultCode);
        }
    }

    @Override
    protected void onDestroy() {
        webViewStartup.close();
        releaseWebViewResources();
        super.onDestroy();
    }

    private void releaseWebViewResources() {
        packagedPageLoaded = false;
        loadingPackagedPage = false;
        if (attachmentPicker != null) attachmentPicker.destroy();
        attachmentPicker = null;
        if (httpClient != null) httpClient.destroy();
        httpClient = null;
        if (updateManager != null) updateManager.destroy();
        updateManager = null;
        WebView target = webView;
        webView = null;
        if (target != null) {
            try {
                if (target.getParent() instanceof ViewGroup) ((ViewGroup) target.getParent()).removeView(target);
                target.removeJavascriptInterface("TurnloomNative");
                target.destroy();
            } catch (RuntimeException | LinkageError error) {
                Log.w("Turnloom", "WEBVIEW_RELEASE_FAILED", error);
            }
        }
    }

    /** Methods injected as window.TurnloomNative (frozen 2.1 bridge contract). */
    public final class TurnloomBridge {
        private SharedPreferences prefs() {
            return getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        }

        @JavascriptInterface
        public String secureGet(String key) {
            if (!bridgeAllowed() || key == null) return null;
            return prefs().getString(key, null);
        }

        @JavascriptInterface
        public boolean secureSet(String key, String value) {
            if (!bridgeAllowed() || key == null) return false;
            try {
                // Saving a server origin is the explicit pairing action. A
                // non-LAN / HTTPS URL is intentionally not added to cleartext.
                if ("turnloom.serverUrl".equals(key) && value != null) {
                    NativeHttpPolicy.pairLanOrigin(MainActivity.this, value + "/api/health");
                }
                if ("turnloom.serverUrl".equals(key) && value == null) {
                    NativeHttpPolicy.clearAllOrigins(MainActivity.this);
                }
                if (value == null) return prefs().edit().remove(key).commit();
                return prefs().edit().putString(key, value).commit();
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean secureRemove(String key) {
            if (!bridgeAllowed() || key == null) return false;
            if ("turnloom.serverUrl".equals(key)) {
                NativeHttpPolicy.clearAllOrigins(MainActivity.this);
            }
            return prefs().edit().remove(key).commit();
        }

        @JavascriptInterface
        public boolean openExternalUrl(String value) {
            if (!bridgeAllowed() || value == null || value.length() > 8192) return false;
            try {
                java.net.URI parsed = new java.net.URI(value);
                String scheme = parsed.getScheme();
                if (!("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))
                        || parsed.getHost() == null || parsed.getRawUserInfo() != null) return false;
                Intent intent = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(value));
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                startActivity(intent);
                return true;
            } catch (Exception ignored) { return false; }
        }

        @JavascriptInterface
        public void haptic(String kind) {
            if (!bridgeAllowed()) return;
            try {
                android.os.Vibrator v = (android.os.Vibrator)
                        getSystemService(Context.VIBRATOR_SERVICE);
                if (v == null || !v.hasVibrator()) return;
                int ms = 10;
                if ("success".equals(kind)) ms = 20;
                else if ("warning".equals(kind)) ms = 35;
                else if ("error".equals(kind)) ms = 50;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(android.os.VibrationEffect.createOneShot(ms,
                            android.os.VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    v.vibrate(ms);
                }
            } catch (Exception ignored) {
                // Haptics are cosmetic.
            }
        }

        @JavascriptInterface
        public void scanQr(final String requestId) {
            if (!bridgeAllowed()) return;
            if (!BridgeContract.validRequestId(requestId)) {
                deliverQrError("", "invalid-request", "扫描请求无效");
                return;
            }
            runOnUiThread(() -> {
                PackageManager pm = getPackageManager();
                if (!pm.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)) {
                    deliverQrError(requestId, "camera-unavailable", "此设备没有可用相机");
                    return;
                }
                Intent intent = new Intent(MainActivity.this, ScannerActivity.class);
                intent.putExtra(ScannerActivity.EXTRA_REQUEST_ID, requestId);
                try {
                    startActivityForResult(intent, REQ_SCAN);
                } catch (Exception e) {
                    deliverQrError(requestId, "camera-unavailable", "无法打开相机");
                }
            });
        }

        @JavascriptInterface
        public String getAppInfo() {
            if (!bridgeAllowed()) return "{}";
            try {
                PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
                JSONObject o = new JSONObject();
                o.put("label", "Codex-Turnloom");
                o.put("version", pi.versionName == null ? "" : pi.versionName);
                o.put("versionCode", Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                        ? pi.getLongVersionCode() : pi.versionCode);
                o.put("route", "dom-shell");
                o.put("applicationId", getPackageName());
                o.put("packageName", getPackageName());
                JSONObject capabilities = NativeHttpPolicy.appCapabilities(getPackageManager());
                o.put("cameraAvailable", capabilities.optBoolean("cameraAvailable"));
                o.put("updatesAvailable", capabilities.optBoolean("updatesAvailable"));
                o.put("nativeHttp", true);
                o.put("https", true);
                o.put("pairedLanCleartext", capabilities.optBoolean("pairedLanCleartext"));
                return o.toString();
            } catch (PackageManager.NameNotFoundException | JSONException e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public void setLightBars() {
            if (!bridgeAllowed()) return;
            runOnUiThread(MainActivity.this::applyLightSystemBars);
        }


        @JavascriptInterface
        public String pickAttachments(String requestId, String kind) {
            if (!BridgeContract.validRequestId(requestId)) return "invalid-request";
            if (!bridgeAllowed()) return "bridge-not-ready";
            if (attachmentPicker == null) return "picker-unavailable";
            attachmentPicker.beginPick(requestId, kind);
            return "";
        }

        @JavascriptInterface
        public void cancelAttachmentPick(String requestId) {
            if (!bridgeAllowed() || !BridgeContract.validRequestId(requestId)) return;
            if (attachmentPicker != null) attachmentPicker.cancel(requestId);
        }
        @JavascriptInterface
        public void request(String requestId, String requestJson) {
            if (!bridgeAllowed()) return;
            httpClient.request(requestId, requestJson);
        }

        @JavascriptInterface
        public void cancelRequest(String requestId) {
            if (!bridgeAllowed()) return;
            httpClient.cancelRequest(requestId);
        }

        @JavascriptInterface
        public void downloadUpdate(String requestId, String optionsJson) {
            if (!bridgeAllowed()) return;
            updateManager.downloadUpdate(requestId, optionsJson);
        }

        @JavascriptInterface
        public void cancelUpdate() {
            if (!bridgeAllowed()) return;
            updateManager.cancelUpdate();
        }

        @JavascriptInterface
        public void installUpdate() {
            if (!bridgeAllowed()) return;
            runOnUiThread(() -> updateManager.installUpdate());
        }
    }
}
