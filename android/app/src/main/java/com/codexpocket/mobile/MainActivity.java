package com.codexpocket.mobile;

import android.app.AlertDialog;
import android.app.DownloadManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.os.Environment;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.text.InputType;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.JavascriptInterface;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.ComponentActivity;
import androidx.activity.result.PickVisualMediaRequest;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;

import com.journeyapps.barcodescanner.ScanContract;
import com.journeyapps.barcodescanner.ScanOptions;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public class MainActivity extends ComponentActivity {
    private static final String PREFS = "codex_pocket";
    private static final String DEVICES_KEY = "devices";
    private static final String KEY_ALIAS = "codex-pocket-device-store";
    public static final String EXTRA_DEVICE_URL = "codex_pocket_device_url";
    public static final String EXTRA_THREAD_ID = "codex_pocket_thread_id";
    private static final String REMINDERS_KEY = "thread_reminders";
    private static final int NOTIFICATION_PERMISSION_REQUEST = 7102;

    private static final int INK = Color.rgb(24, 31, 38);
    private static final int MUTED = Color.rgb(100, 112, 124);
    private static final int PAPER = Color.rgb(247, 248, 250);
    private static final int LINE = Color.rgb(224, 228, 233);
    private static final int ACCENT = Color.rgb(22, 104, 218);
    private static final int ONLINE = Color.rgb(34, 139, 84);
    private static final int OFFLINE = Color.rgb(181, 55, 55);

    private final List<Device> devices = new ArrayList<>();
    private final Map<String, Boolean> deviceStatus = new HashMap<>();
    private LinearLayout root;
    private WebView webView;
    private ProgressBar pageProgress;
    private TextView connectionDot;
    private Device activeDevice;
    private volatile String currentMainFrameUrl = "";
    private String pendingNotificationDeviceUrl;
    private String pendingNotificationThreadId;
    private ValueCallback<Uri[]> fileChooserCallback;

    private final ActivityResultLauncher<Intent> fileChooser = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(), result -> {
                Uri[] uris = null;
                if (result.getResultCode() == RESULT_OK && result.getData() != null) {
                    Intent data = result.getData();
                    if (data.getClipData() != null) {
                        int count = data.getClipData().getItemCount();
                        uris = new Uri[count];
                        for (int i = 0; i < count; i++) uris[i] = data.getClipData().getItemAt(i).getUri();
                    } else if (data.getData() != null) {
                        uris = new Uri[]{data.getData()};
                    }
                }
                if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(uris);
                fileChooserCallback = null;
            });

    private final ActivityResultLauncher<PickVisualMediaRequest> photoChooser = registerForActivityResult(
            new ActivityResultContracts.PickMultipleVisualMedia(10), uris -> {
                if (fileChooserCallback != null) {
                    fileChooserCallback.onReceiveValue(uris == null || uris.isEmpty() ? null : uris.toArray(new Uri[0]));
                }
                fileChooserCallback = null;
            });

    private final ActivityResultLauncher<ScanOptions> scanner = registerForActivityResult(
            new ScanContract(), result -> {
                if (result.getContents() == null) return;
                Device imported = parseDeviceQr(result.getContents());
                if (imported == null) {
                    Toast.makeText(this, "这不是可识别的 codex-Turnloom 设备码", Toast.LENGTH_LONG).show();
                    return;
                }
                int existing = findDeviceByUrl(imported.url);
                if (existing >= 0) {
                    Device previous = devices.get(existing);
                    devices.set(existing, imported.withNote(imported.note.isEmpty() ? previous.note : imported.note));
                }
                else devices.add(imported);
                saveDevices();
                showMachinePicker();
                Toast.makeText(this, existing >= 0 ? "电脑信息已更新" : "电脑已添加", Toast.LENGTH_SHORT).show();
            });

    @Override
    protected void attachBaseContext(Context newBase) {
        Configuration config = new Configuration(newBase.getResources().getConfiguration());
        config.fontScale = 1f;
        super.attachBaseContext(newBase.createConfigurationContext(config));
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        handleNotificationIntent(getIntent());
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        devices.addAll(loadDevices());
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(PAPER);
        setContentView(root);
        showMachinePicker();
        clearLegacyReminderNotification();
        ReminderScheduler.sync(this);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleNotificationIntent(intent);
        if (pendingNotificationDeviceUrl != null) openPendingNotificationTarget();
    }

    private void handleNotificationIntent(Intent intent) {
        if (intent == null) return;
        pendingNotificationDeviceUrl = intent.getStringExtra(EXTRA_DEVICE_URL);
        pendingNotificationThreadId = intent.getStringExtra(EXTRA_THREAD_ID);
    }

    private void openPendingNotificationTarget() {
        if (pendingNotificationDeviceUrl == null) return;
        for (Device device : devices) {
            if (device.url.equalsIgnoreCase(pendingNotificationDeviceUrl)) {
                String threadId = pendingNotificationThreadId;
                pendingNotificationDeviceUrl = null;
                pendingNotificationThreadId = null;
                openDevice(device, threadId);
                return;
            }
        }
    }

    private void showMachinePicker() {
        activeDevice = null;
        destroyWebView();
        root.removeAllViews();
        getWindow().setStatusBarColor(INK);
        getWindow().setNavigationBarColor(PAPER);

        LinearLayout appBar = new LinearLayout(this);
        appBar.setGravity(Gravity.CENTER_VERTICAL);
        appBar.setPadding(dp(18), dp(8), dp(10), dp(8));
        appBar.setBackgroundColor(INK);
        TextView title = label("codex-Turnloom", 20, Color.WHITE);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        appBar.addView(title, new LinearLayout.LayoutParams(0, dp(48), 1));
        appBar.addView(iconButton("扫码", "扫描二维码添加电脑", v -> startScanner()), new LinearLayout.LayoutParams(dp(58), dp(44)));
        appBar.addView(iconButton("＋", "手动添加电脑", v -> showDeviceDialog(-1)), new LinearLayout.LayoutParams(dp(48), dp(44)));
        root.addView(appBar, new LinearLayout.LayoutParams(-1, dp(64)));

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setPadding(dp(16), dp(22), dp(16), dp(28));
        scroll.addView(page, new ScrollView.LayoutParams(-1, -2));

        TextView heading = label("选择电脑", 24, INK);
        heading.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        page.addView(heading);
        TextView subtitle = label("选择后进入完整会话页面", 14, MUTED);
        subtitle.setPadding(0, dp(4), 0, dp(18));
        page.addView(subtitle);

        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setBackground(rounded(Color.WHITE, 1, LINE, 8));
        page.addView(list, new LinearLayout.LayoutParams(-1, -2));
        for (int i = 0; i < devices.size(); i++) addDeviceRow(list, devices.get(i), i, i == devices.size() - 1);

        TextView localNote = label("电脑信息和访问码仅保存在这台手机上。", 12, MUTED);
        localNote.setPadding(dp(2), dp(16), dp(2), 0);
        page.addView(localNote);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));

        for (Device device : new ArrayList<>(devices)) checkConnection(device, list);
        openPendingNotificationTarget();
    }

    private void addDeviceRow(LinearLayout list, Device device, int index, boolean last) {
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(16), dp(10), dp(8), dp(10));
        int rowHeight = device.note.isEmpty() ? 76 : 94;
        row.setMinimumHeight(dp(rowHeight));
        row.setClickable(true);
        row.setFocusable(true);
        row.setBackgroundColor(Color.TRANSPARENT);
        row.setOnClickListener(v -> openDevice(device));

        TextView dot = label("●", 11, statusColor(device));
        dot.setTag("status:" + device.url);
        dot.setGravity(Gravity.TOP);
        row.addView(dot, new LinearLayout.LayoutParams(dp(22), dp(48)));

        LinearLayout copy = new LinearLayout(this);
        copy.setOrientation(LinearLayout.VERTICAL);
        TextView name = label(device.name, 17, INK);
        name.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        name.setMaxLines(1);
        copy.addView(name);
        if (!device.note.isEmpty()) {
            TextView note = label(device.note, 13, INK);
            note.setMaxLines(1);
            copy.addView(note);
        }
        TextView address = label(displayAddress(device.url), 12, MUTED);
        address.setMaxLines(1);
        copy.addView(address);
        row.addView(copy, new LinearLayout.LayoutParams(0, -2, 1));

        TextView arrow = label("›", 28, MUTED);
        arrow.setGravity(Gravity.CENTER);
        row.addView(arrow, new LinearLayout.LayoutParams(dp(32), dp(48)));
        Button menu = iconButton("⋮", "管理这台电脑", v -> showDeviceMenu(v, index));
        menu.setTextColor(MUTED);
        row.addView(menu, new LinearLayout.LayoutParams(dp(44), dp(48)));
        list.addView(row, new LinearLayout.LayoutParams(-1, dp(rowHeight)));

        if (!last) {
            View divider = new View(this);
            divider.setBackgroundColor(LINE);
            LinearLayout.LayoutParams line = new LinearLayout.LayoutParams(-1, dp(1));
            line.setMargins(dp(54), 0, 0, 0);
            list.addView(divider, line);
        }
    }

    private void showDeviceMenu(View anchor, int index) {
        if (index < 0 || index >= devices.size()) return;
        PopupMenu menu = new PopupMenu(this, anchor);
        menu.getMenu().add("编辑");
        menu.getMenu().add("测试连接");
        menu.getMenu().add("删除");
        menu.setOnMenuItemClickListener(item -> {
            String action = item.getTitle().toString();
            if ("编辑".equals(action)) showDeviceDialog(index);
            else if ("测试连接".equals(action)) testConnectionWithFeedback(devices.get(index));
            else if ("删除".equals(action)) confirmDelete(index);
            return true;
        });
        menu.show();
    }

    private void openDevice(Device device) {
        openDevice(device, null);
    }

    private void openDevice(Device device, String threadId) {
        activeDevice = device;
        root.removeAllViews();
        getWindow().setStatusBarColor(INK);
        getWindow().setNavigationBarColor(Color.WHITE);

        LinearLayout topBar = new LinearLayout(this);
        topBar.setGravity(Gravity.CENTER_VERTICAL);
        topBar.setPadding(dp(4), dp(4), dp(6), dp(4));
        topBar.setBackgroundColor(INK);
        Button back = iconButton("‹", "返回电脑列表", v -> showMachinePicker());
        back.setTextSize(30);
        topBar.addView(back, new LinearLayout.LayoutParams(dp(48), dp(48)));
        connectionDot = label("●", 10, Color.rgb(244, 190, 74));
        connectionDot.setGravity(Gravity.CENTER);
        topBar.addView(connectionDot, new LinearLayout.LayoutParams(dp(22), dp(48)));
        LinearLayout connectedCopy = new LinearLayout(this);
        connectedCopy.setOrientation(LinearLayout.VERTICAL);
        connectedCopy.setGravity(Gravity.CENTER_VERTICAL);
        TextView connectedTitle = label(device.name, 16, Color.WHITE);
        connectedTitle.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        connectedTitle.setMaxLines(1);
        connectedCopy.addView(connectedTitle);
        if (!device.note.isEmpty()) {
            TextView connectedNote = label(device.note, 11, Color.rgb(196, 205, 214));
            connectedNote.setMaxLines(1);
            connectedCopy.addView(connectedNote);
        }
        topBar.addView(connectedCopy, new LinearLayout.LayoutParams(0, dp(48), 1));
        Button refresh = iconButton("↻", "刷新当前页面", v -> {
            if (webView != null && activeDevice != null) webView.loadUrl(targetUrl(activeDevice));
        });
        refresh.setTextSize(24);
        topBar.addView(refresh, new LinearLayout.LayoutParams(dp(48), dp(48)));
        root.addView(topBar, new LinearLayout.LayoutParams(-1, dp(56)));

        pageProgress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        pageProgress.setMax(100);
        pageProgress.setProgressTintList(android.content.res.ColorStateList.valueOf(ACCENT));
        root.addView(pageProgress, new LinearLayout.LayoutParams(-1, dp(2)));

        FrameLayout webContainer = new FrameLayout(this);
        webContainer.setBackgroundColor(Color.WHITE);
        webView = buildWebView();
        webContainer.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        root.addView(webContainer, new LinearLayout.LayoutParams(-1, 0, 1));
        webView.loadUrl(targetUrl(device, threadId));
    }

    private WebView buildWebView() {
        WebView view = new WebView(this);
        view.setBackgroundColor(Color.WHITE);
        view.setFocusableInTouchMode(true);
        view.setOverScrollMode(View.OVER_SCROLL_NEVER);
        view.addJavascriptInterface(new NativeBridge(), "CodexPocket");
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(false);
        settings.setTextZoom(100);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, true);
        view.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) ->
                downloadFile(url, userAgent, contentDisposition, mimeType));

        view.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView webView, int progress) {
                if (pageProgress == null) return;
                pageProgress.setProgress(progress);
                pageProgress.setVisibility(progress >= 100 ? View.INVISIBLE : View.VISIBLE);
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
                fileChooserCallback = callback;
                try {
                    String[] acceptTypes = params == null ? null : params.getAcceptTypes();
                    if (FileChooserRequests.isPhotoPickerRequest(acceptTypes)) {
                        PickVisualMediaRequest request = new PickVisualMediaRequest.Builder()
                                .setMediaType(ActivityResultContracts.PickVisualMedia.ImageOnly.INSTANCE)
                                .build();
                        photoChooser.launch(request);
                        return true;
                    }
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                    fileChooser.launch(intent);
                    return true;
                } catch (Exception error) {
                    fileChooserCallback = null;
                    Toast.makeText(MainActivity.this, "无法打开文件选择器", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });
        view.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView webView, String url, android.graphics.Bitmap favicon) {
                currentMainFrameUrl = url == null ? "" : url;
                setConnectionState(Color.rgb(244, 190, 74));
            }

            @Override
            public void onPageFinished(WebView webView, String url) {
                setConnectionState(ONLINE);
                CookieManager.getInstance().flush();
            }

            @Override
            public void onReceivedError(WebView webView, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) setConnectionState(OFFLINE);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView webView, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (Exception ignored) {
                        Toast.makeText(MainActivity.this, "无法打开这个链接", Toast.LENGTH_SHORT).show();
                    }
                    return true;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    Toast.makeText(MainActivity.this, "无法打开这个链接", Toast.LENGTH_SHORT).show();
                }
                return true;
            }
        });
        return view;
    }

    private void downloadFile(String url, String userAgent, String contentDisposition, String mimeType) {
        try {
            String fileName = DownloadFileNames.resolve(url, contentDisposition, mimeType);
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle(fileName);
            request.setDescription("来自 " + (activeDevice == null ? "codex-Turnloom" : activeDevice.name));
            request.setMimeType(mimeType);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
            if (userAgent != null && !userAgent.isBlank()) request.addRequestHeader("User-Agent", userAgent);
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null && !cookie.isBlank()) request.addRequestHeader("Cookie", cookie);
            DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            manager.enqueue(request);
            Toast.makeText(this, "正在下载到“下载”目录", Toast.LENGTH_SHORT).show();
        } catch (Exception error) {
            Toast.makeText(this, "下载失败，请稍后重试", Toast.LENGTH_LONG).show();
        }
    }

    private void setConnectionState(int color) {
        if (connectionDot != null) connectionDot.setTextColor(color);
    }

    private void destroyWebView() {
        if (webView == null) return;
        currentMainFrameUrl = "";
        webView.stopLoading();
        webView.setWebChromeClient(null);
        webView.setWebViewClient(null);
        webView.destroy();
        webView = null;
    }

    private void startScanner() {
        ScanOptions options = new ScanOptions();
        options.setPrompt("将二维码放入取景框");
        options.setBeepEnabled(true);
        options.setOrientationLocked(true);
        options.setCaptureActivity(PortraitCaptureActivity.class);
        scanner.launch(options);
    }

    private Device parseDeviceQr(String raw) {
        try {
            if (raw.startsWith("codexpocket://")) {
                Uri uri = Uri.parse(raw);
                String url = uri.getQueryParameter("url");
                if (url == null || url.isBlank()) return null;
                return new Device(valueOr(uri.getQueryParameter("name"), "新电脑"), trimTrailingSlash(url), valueOr(uri.getQueryParameter("token"), ""), valueOr(uri.getQueryParameter("note"), ""));
            }
            if (raw.startsWith("http://") || raw.startsWith("https://")) {
                Uri uri = Uri.parse(raw);
                String token = valueOr(uri.getQueryParameter("token"), uri.getQueryParameter("login"));
                Uri base = new Uri.Builder()
                        .scheme(uri.getScheme())
                        .encodedAuthority(uri.getEncodedAuthority())
                        .encodedPath(uri.getEncodedPath())
                        .build();
                return new Device(valueOr(uri.getHost(), "新电脑"), trimTrailingSlash(base.toString()), valueOr(token, ""), "");
            }
            JSONObject item = new JSONObject(raw);
            String url = item.optString("url");
            if (url.isBlank()) return null;
            return new Device(item.optString("name", "新电脑"), trimTrailingSlash(url), item.optString("token"), item.optString("note"));
        } catch (Exception ignored) {
            return null;
        }
    }

    private void checkConnection(Device device, LinearLayout currentList) {
        new Thread(() -> {
            boolean online;
            try {
                httpGet(device, "/api/health");
                online = true;
            } catch (Exception ignored) {
                online = false;
            }
            boolean value = online;
            runOnUiThread(() -> {
                if (activeDevice != null || root.getChildCount() == 0) return;
                deviceStatus.put(device.url, value);
                View dot = currentList.findViewWithTag("status:" + device.url);
                if (dot instanceof TextView) ((TextView) dot).setTextColor(value ? ONLINE : OFFLINE);
            });
        }).start();
    }

    private void testConnectionWithFeedback(Device device) {
        Toast.makeText(this, "正在测试连接…", Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            try {
                httpGet(device, "/api/health");
                runOnUiThread(() -> Toast.makeText(this, "连接正常", Toast.LENGTH_SHORT).show());
            } catch (Exception error) {
                runOnUiThread(() -> Toast.makeText(this, "连接失败，请检查地址和访问码", Toast.LENGTH_LONG).show());
            }
        }).start();
    }

    private void showDeviceDialog(int editingIndex) {
        boolean editing = editingIndex >= 0 && editingIndex < devices.size();
        Device existing = editing ? devices.get(editingIndex) : new Device("", "", "", "");
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(22), dp(6), dp(22), 0);
        EditText name = field("电脑名称", existing.name, false);
        EditText note = field("备注（例如：家里书房、公司台式机）", existing.note, false);
        EditText url = field("访问地址，例如 https://example.com:18787", existing.url, false);
        EditText token = field("访问码", existing.token, true);
        form.addView(name);
        form.addView(note);
        form.addView(url);
        form.addView(token);

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle(editing ? "编辑电脑" : "添加电脑")
                .setView(form)
                .setNegativeButton("取消", null)
                .setPositiveButton("保存", null)
                .create();
        dialog.setOnShowListener(d -> dialog.getButton(DialogInterface.BUTTON_POSITIVE).setOnClickListener(v -> {
            String n = name.getText().toString().trim();
            String remark = note.getText().toString().trim();
            String u = trimTrailingSlash(url.getText().toString().trim());
            String t = token.getText().toString().trim();
            Uri parsed = Uri.parse(u);
            if (n.isEmpty() || parsed.getHost() == null || !("http".equals(parsed.getScheme()) || "https".equals(parsed.getScheme()))) {
                Toast.makeText(this, "请填写名称和有效的 http(s) 地址", Toast.LENGTH_SHORT).show();
                return;
            }
            Device next = new Device(n, u, t, remark);
            if (editing) devices.set(editingIndex, next);
            else devices.add(next);
            saveDevices();
            dialog.dismiss();
            showMachinePicker();
        }));
        dialog.show();
    }

    private void confirmDelete(int index) {
        if (index < 0 || index >= devices.size()) return;
        Device device = devices.get(index);
        new AlertDialog.Builder(this)
                .setTitle("删除电脑")
                .setMessage("确定删除“" + device.name + "”？")
                .setNegativeButton("取消", null)
                .setPositiveButton("删除", (dialog, which) -> {
                    devices.remove(index);
                    saveDevices();
                    showMachinePicker();
                })
                .show();
    }

    private Button iconButton(String text, String description, View.OnClickListener listener) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextSize(text.length() > 1 ? 13 : 22);
        button.setTextColor(Color.WHITE);
        button.setAllCaps(false);
        button.setMinWidth(0);
        button.setMinimumWidth(0);
        button.setPadding(dp(6), 0, dp(6), 0);
        button.setBackgroundColor(Color.TRANSPARENT);
        button.setContentDescription(description);
        button.setOnClickListener(listener);
        return button;
    }

    private EditText field(String hint, String value, boolean password) {
        EditText field = new EditText(this);
        field.setHint(hint);
        field.setText(value);
        field.setSingleLine(true);
        field.setTextSize(15);
        field.setPadding(0, dp(10), 0, dp(10));
        if (password) field.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        return field;
    }

    private TextView label(String value, int size, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setGravity(Gravity.CENTER_VERTICAL);
        view.setLetterSpacing(0f);
        return view;
    }

    private GradientDrawable rounded(int fill, int strokeWidth, int stroke, int radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(dp(radiusDp));
        if (strokeWidth > 0) drawable.setStroke(dp(strokeWidth), stroke);
        return drawable;
    }

    private int statusColor(Device device) {
        Boolean online = deviceStatus.get(device.url);
        return online == null ? Color.rgb(170, 178, 186) : online ? ONLINE : OFFLINE;
    }

    private String displayAddress(String value) {
        try {
            Uri uri = Uri.parse(value);
            String host = valueOr(uri.getHost(), value);
            return uri.getPort() > 0 ? host + ":" + uri.getPort() : host;
        } catch (Exception ignored) {
            return value;
        }
    }

    private String targetUrl(Device device) {
        return targetUrl(device, null);
    }

    private String targetUrl(Device device, String threadId) {
        String url = device.url;
        StringBuilder query = new StringBuilder();
        if (device.token.isEmpty() || url.contains("token=")) {
            // Keep the existing URL and only append a selected conversation below.
        } else {
            query.append("token=").append(Uri.encode(device.token));
        }
        if (threadId != null && !threadId.isBlank()) {
            if (query.length() > 0) query.append('&');
            query.append("selectedId=").append(Uri.encode(threadId));
        }
        if (query.length() > 0) url += (url.contains("?") ? "&" : "?") + query;
        return url;
    }

    private String httpGet(Device device, String path) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(trimTrailingSlash(device.url) + path).openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(10000);
        connection.setRequestProperty("Accept", "application/json");
        if (!device.token.isEmpty()) connection.setRequestProperty("x-access-token", device.token);
        int code = connection.getResponseCode();
        InputStream stream = code >= 200 && code < 400 ? connection.getInputStream() : connection.getErrorStream();
        StringBuilder result = new StringBuilder();
        if (stream != null) {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) result.append(line);
            }
        }
        connection.disconnect();
        if (code < 200 || code >= 300) throw new Exception("HTTP " + code);
        return result.toString();
    }

    private int findDeviceByUrl(String url) {
        for (int i = 0; i < devices.size(); i++) if (devices.get(i).url.equalsIgnoreCase(url)) return i;
        return -1;
    }

    private String valueOr(String value, String fallback) {
        return value == null || value.isBlank() ? (fallback == null ? "" : fallback) : value;
    }

    private String trimTrailingSlash(String value) {
        while (value.endsWith("/") && value.length() > 8) value = value.substring(0, value.length() - 1);
        return value;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    public void onBackPressed() {
        BackNavigation.Action action = BackNavigation.action(activeDevice != null);
        if (action == BackNavigation.Action.SHOW_COMPUTER_PICKER) {
            showMachinePicker();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        destroyWebView();
        super.onDestroy();
    }

    private List<Device> loadDevices() {
        List<Device> result = new ArrayList<>();
        try {
            String raw = Store.read(this);
            if (raw == null || raw.isEmpty()) return result;
            JSONArray array = new JSONArray(raw);
            for (int i = 0; i < array.length(); i++) {
                JSONObject item = array.getJSONObject(i);
                result.add(new Device(item.optString("name"), item.optString("url"), item.optString("token"), item.optString("note")));
            }
        } catch (Exception ignored) {
        }
        return result;
    }

    private void saveDevices() {
        try {
            JSONArray array = new JSONArray();
            for (Device device : devices) {
                JSONObject item = new JSONObject();
                item.put("name", device.name);
                item.put("url", device.url);
                item.put("token", device.token);
                item.put("note", device.note);
                array.put(item);
            }
            Store.write(this, array.toString());
        } catch (Exception ignored) {
        }
    }

    private void setThreadReminder(String threadId, String title, boolean enabled) {
        if (activeDevice == null || threadId == null || threadId.isBlank()) return;
        try {
            JSONArray current = new JSONArray(getSharedPreferences(PREFS, MODE_PRIVATE).getString(REMINDERS_KEY, "[]"));
            JSONArray next = new JSONArray();
            String key = activeDevice.url + "\n" + threadId;
            for (int i = 0; i < current.length(); i++) {
                JSONObject item = current.getJSONObject(i);
                String itemKey = item.optString("deviceUrl") + "\n" + item.optString("threadId");
                if (!itemKey.equals(key)) next.put(item);
            }
            if (enabled) {
                JSONObject item = new JSONObject();
                item.put("deviceUrl", activeDevice.url);
                item.put("threadId", threadId);
                item.put("title", title == null ? "" : title);
                item.put("enabled", true);
                item.put("baselineSet", false);
                item.put("lastThinking", false);
                next.put(item);
            }
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(REMINDERS_KEY, next.toString()).apply();
            if (enabled && Build.VERSION.SDK_INT >= 33
                    && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, NOTIFICATION_PERMISSION_REQUEST);
            }
            ReminderScheduler.sync(this);
        } catch (Exception ignored) {
        }
    }

    private void clearLegacyReminderNotification() {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) return;
        manager.cancel(7101);
        if (Build.VERSION.SDK_INT >= 26) manager.deleteNotificationChannel("codex-pocket-monitor");
    }

    private class NativeBridge {
        @JavascriptInterface
        public void setThreadReminder(String threadId, String title, boolean enabled) {
            runOnUiThread(() -> MainActivity.this.setThreadReminder(threadId, title, enabled));
        }

        @JavascriptInterface
        public void kickReminderCheck() {
            ReminderScheduler.kick(MainActivity.this);
        }

        @JavascriptInterface
        public String getAccessToken() {
            Device device = activeDevice;
            return device != null && DeviceOrigin.matches(device.url, currentMainFrameUrl) ? device.token : "";
        }
    }

    private static class Device {
        final String name;
        final String url;
        final String token;
        final String note;

        Device(String name, String url, String token, String note) {
            this.name = name;
            this.url = url;
            this.token = token;
            this.note = note == null ? "" : note;
        }

        Device withNote(String nextNote) {
            return new Device(name, url, token, nextNote);
        }
    }

    private static class Store {
        static String read(Context context) {
            String encrypted = context.getSharedPreferences(PREFS, MODE_PRIVATE).getString(DEVICES_KEY, "");
            if (encrypted == null || encrypted.isEmpty()) return "";
            try {
                String[] parts = encrypted.split(":", 2);
                byte[] iv = Base64.decode(parts[0], Base64.DEFAULT);
                byte[] data = Base64.decode(parts[1], Base64.DEFAULT);
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
                return new String(cipher.doFinal(data), StandardCharsets.UTF_8);
            } catch (Exception ignored) {
                return encrypted;
            }
        }

        static void write(Context context, String value) {
            try {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.ENCRYPT_MODE, key());
                byte[] iv = cipher.getIV();
                byte[] data = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
                String encoded = Base64.encodeToString(iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(data, Base64.NO_WRAP);
                context.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(DEVICES_KEY, encoded).apply();
            } catch (Exception ignored) {
            }
        }

        private static SecretKey key() throws Exception {
            KeyStore store = KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            if (store.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build());
            return generator.generateKey();
        }
    }
}
