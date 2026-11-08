package com.codexpocket.mobile;

import android.app.AlertDialog;
import android.app.DownloadManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ClipData;
import android.content.ClipboardManager;
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
import android.text.TextUtils;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.JavascriptInterface;

import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;
import android.webkit.JsResult;
import android.webkit.JsPromptResult;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.Space;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.content.FileProvider;
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

    /** 应用内样式的 JS 对话框兜底，替代 WebView 默认系统对话框。 */
    private void showJsDialog(String message, String defaultValue, JsResult result, boolean cancellable) {
        AlertDialog.Builder builder = new AlertDialog.Builder(this);
        builder.setTitle("Codex-Turnloom");
        builder.setMessage(message == null ? "" : message);
        builder.setCancelable(cancellable);
        builder.setPositiveButton("确定", (dialog, which) -> {
            if (result instanceof JsPromptResult) {
                ((JsPromptResult) result).confirm(defaultValue == null ? "" : defaultValue);
            } else {
                result.confirm();
            }
        });
        if (cancellable) {
            builder.setNegativeButton("取消", (dialog, which) -> result.cancel());
        }
        builder.setOnCancelListener(dialog -> result.cancel());
        AlertDialog dialog = builder.create();
        dialog.setOnShowListener(d -> {
            Button positive = dialog.getButton(DialogInterface.BUTTON_POSITIVE);
            Button negative = dialog.getButton(DialogInterface.BUTTON_NEGATIVE);
            int blue = Color.rgb(37, 99, 235);
            if (positive != null) positive.setTextColor(blue);
            if (negative != null) negative.setTextColor(Color.rgb(107, 124, 147));
        });
        dialog.show();
    }

    /** 拦掉系统文字选择 ActionMode（复制/全选把手），长按交给网页里的应用内菜单。 */
    @Override
    public void onActionModeStarted(ActionMode mode) {
        super.onActionModeStarted(mode);
        Menu menu = mode.getMenu();
        boolean isTextSelection = false;
        for (int i = 0; i < menu.size(); i++) {
            MenuItem item = menu.getItem(i);
            int id = item.getItemId();
            if (id == android.R.id.selectAll || id == android.R.id.copy
                    || "复制".equals(item.getTitle()) || "全选".equals(item.getTitle())) {
                isTextSelection = true;
                break;
            }
        }
        if (isTextSelection) mode.finish();
    }
    /** Installed package version code. Never hardcode it: a stale constant makes every device prompt for an update forever. */
    private int appVersionCode() {
        try {
            android.content.pm.PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            return android.os.Build.VERSION.SDK_INT >= 28 ? (int) info.getLongVersionCode() : info.versionCode;
        } catch (Exception ignored) {
            return 0;
        }
    }
    private String appVersionName() {
        try {
            android.content.pm.PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            return info.versionName == null ? "" : info.versionName;
        } catch (Exception ignored) {
            return "";
        }
    }
    private static final String PREFS = "codex_pocket";
    private static final String DEVICES_KEY = "devices";
    private static final String KEY_ALIAS = "codex-pocket-device-store";
    public static final String EXTRA_DEVICE_URL = "codex_pocket_device_url";
    public static final String EXTRA_THREAD_ID = "codex_pocket_thread_id";
    private static final String REMINDERS_KEY = "thread_reminders";
    private static final String ONBOARDING_KEY = "turnloom_onboarding_seen_v1";
    private static final String ACTIVE_DEVICE_URL_KEY = "turnloom_active_device_url_v1";
    // V7 示例数据包：内置单文件 HTML，零联网；正式包保持 false。
    // 由 applicationId 判定：正式包 (…optiona.web) 走真实服务，演示包 (…optiona.demo.web) 走内置离线页面。
    // 不能用 BuildConfig.APPLICATION_ID —— 本项目 AGP 8 默认未开启 buildConfig。
    private boolean demoMode = false; // 在 onCreate 里由 applicationId 判定（构造函数阶段无 Context）
    private static final String DEMO_ASSET_URL = "file:///android_asset/offline-demo.html";
    private static final String DEFAULT_DEVICE_SEEDED_KEY = "turnloom_option_a_default_seeded_v1";
    private static final String DEFAULT_DEVICE_NAME = "我的电脑";
    private static final String DEFAULT_DEVICE_URL = "http://192.168.0.10:8787/option-a/index.html";
    private static final String DEFAULT_DEVICE_TOKEN = "test-code";
    private volatile boolean updateDownloadRunning = false;
    private static final int NOTIFICATION_PERMISSION_REQUEST = 7102;

    private static final int INK = Color.rgb(17, 24, 39);
    private static final int MUTED = Color.rgb(107, 114, 128);
    private static final int TEXT_SECONDARY = Color.rgb(75, 85, 99);
    private static final int PAPER = Color.rgb(244, 245, 248);
    private static final int LINE = Color.rgb(226, 229, 236);
    private static final int ACCENT = Color.rgb(0, 102, 204);
    private static final int ACCENT_SOFT = Color.rgb(232, 242, 255);
    private static final int ACCENT_BORDER = Color.rgb(194, 220, 255);
    private static final int ONLINE = Color.rgb(22, 163, 74);
    private static final int ONLINE_SOFT = Color.rgb(220, 252, 231);
    private static final int ONLINE_TEXT = Color.rgb(21, 128, 61);
    private static final int OFFLINE = Color.rgb(220, 38, 38);
    private static final int OFFLINE_SOFT = Color.rgb(254, 226, 226);
    private static final int OFFLINE_TEXT = Color.rgb(185, 28, 28);
    private static final int PENDING = Color.rgb(100, 116, 139);
    private static final int PENDING_SOFT = Color.rgb(241, 245, 249);
    private static final int PENDING_TEXT = Color.rgb(71, 85, 105);

    private final List<Device> devices = new ArrayList<>();
    private final Map<String, Boolean> deviceStatus = new HashMap<>();
    private boolean autoUpdatePrompted = false;
    private LinearLayout root;
    private WebView webView;
    private FrameLayout webContainer;
    private ProgressBar pageProgress;
    private TextView connectionDot;
    private Device activeDevice;
    private volatile String currentMainFrameUrl = "";
    private boolean clearMachinePickerMode = false;
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
                    Toast.makeText(this, "这不是可识别的 Codex-Turnloom 设备码", Toast.LENGTH_LONG).show();
                    return;
                }
                int existing = findDevice(imported);
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
        demoMode = getPackageName().endsWith(".demo.web");
        handleNotificationIntent(getIntent());
        if (demoMode) {
            // 示例数据：不加载/保存任何真实设备，直接打开本地单文件页面。
            activeDevice = demoDevice();
        } else {
            devices.addAll(loadDevices());
            seedDefaultDeviceIfNeeded();
        }
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(PAPER);
        setContentView(root);
        Device startupDevice = demoMode ? activeDevice : findActiveDevice();
        if (startupDevice != null) {
            openDevice(startupDevice, pendingNotificationThreadId);
            pendingNotificationThreadId = null;
        } else {
            showMachinePicker();
        }
        // 演示包不弹新手引导、不启动任何后台联网同步。
        if (!demoMode) {
            if (!getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(ONBOARDING_KEY, false)) {
                root.post(() -> showWelcomeGuide(true));
            }
            clearLegacyReminderNotification();
            ReminderScheduler.sync(this);
        }
    }

    /** 演示包不读写任何真实设备：直接构造本地演示设备，跳过选电脑页。 */
    private Device demoDevice() {
        return new Device("示例数据 · 本机", DEMO_ASSET_URL, "demo", "演示数据 · 无需联网");
    }

    /**
     * 独立新包首次启动（或删除全部设备后）注入默认电脑，免去扫码/手输。
     * 保留原有扫码、手动添加、设备列表能力；用户删除后不会再次强行注入。
     */
    private void seedDefaultDeviceIfNeeded() {
        android.content.SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (prefs.getBoolean(DEFAULT_DEVICE_SEEDED_KEY, false)) return;
        if (!devices.isEmpty()) {
            prefs.edit().putBoolean(DEFAULT_DEVICE_SEEDED_KEY, true).apply();
            return;
        }
        Device builtin = new Device(DEFAULT_DEVICE_NAME, DEFAULT_DEVICE_URL, DEFAULT_DEVICE_TOKEN, "预置连接");
        devices.add(builtin);
        saveDevices();
        prefs.edit()
                .putBoolean(DEFAULT_DEVICE_SEEDED_KEY, true)
                .putString(ACTIVE_DEVICE_URL_KEY, DEFAULT_DEVICE_URL)
                .putBoolean(ONBOARDING_KEY, true)
                .apply();
    }

    private Device findActiveDevice() {
        String activeUrl = getSharedPreferences(PREFS, MODE_PRIVATE).getString(ACTIVE_DEVICE_URL_KEY, "");
        if (activeUrl.isEmpty()) return null;
        for (Device device : devices) {
            if (device.url.equalsIgnoreCase(activeUrl) && device.token != null && !device.token.isBlank()) return device;
        }
        return null;
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
        showMachinePicker(true);
    }

    /** false 表示用户主动从聊天页进来；取消时回到原电脑，不把它当首页。 */
    private void showMachinePicker(boolean clearActiveDevice) {
        Device previousDevice = activeDevice;
        clearMachinePickerMode = clearActiveDevice;
        if (clearActiveDevice) {
            activeDevice = null;
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().remove(ACTIVE_DEVICE_URL_KEY).apply();
        }
        destroyWebView();
        root.removeAllViews();
        getWindow().setStatusBarColor(Color.WHITE);
        getWindow().setNavigationBarColor(PAPER);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);

        LinearLayout appBar = new LinearLayout(this);
        appBar.setGravity(Gravity.CENTER_VERTICAL);
        appBar.setPadding(dp(18), dp(8), dp(10), dp(8));
        appBar.setBackgroundColor(Color.WHITE);
        if (!clearActiveDevice && previousDevice != null) {
            Button back = headerButton("‹", "返回聊天", v -> openDevice(previousDevice));
            back.setTextSize(28);
            appBar.addView(back, new LinearLayout.LayoutParams(dp(44), dp(44)));
        }
        TextView title = label("Codex-Turnloom", 18, INK);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        appBar.addView(title, new LinearLayout.LayoutParams(0, dp(48), 1));
        appBar.addView(headerButton("?", "打开使用指引", v -> showWelcomeGuide(false)), new LinearLayout.LayoutParams(dp(44), dp(44)));
        appBar.addView(headerButton("更新", "检查应用更新", v -> checkForUpdates()), new LinearLayout.LayoutParams(dp(58), dp(44)));
        appBar.addView(headerButton("＋", "手动添加电脑", v -> showDeviceDialog(-1)), new LinearLayout.LayoutParams(dp(44), dp(44)));
        root.addView(appBar, new LinearLayout.LayoutParams(-1, dp(64)));

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setPadding(dp(18), dp(24), dp(18), dp(28));
        scroll.addView(page, new ScrollView.LayoutParams(-1, -2));

        TextView heading = label(devices.isEmpty() ? "连接你的第一台电脑" : "选择工作台电脑", 25, INK);
        heading.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        page.addView(heading);
        TextView subtitle = label(devices.isEmpty() ? "扫描电脑上显示的设备码，即可把正在运行的 Codex 延续到手机。" : "选择一台电脑，继续它上面的 Codex 会话。", 14, MUTED);
        subtitle.setLineSpacing(0, 1.15f);
        subtitle.setPadding(0, dp(6), 0, dp(22));
        page.addView(subtitle);

        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        if (devices.isEmpty()) {
            list.setGravity(Gravity.CENTER_HORIZONTAL);
            list.setPadding(dp(22), dp(26), dp(22), dp(24));
            list.setBackground(rounded(Color.WHITE, 1, LINE, 22));
            TextView mark = label("◎", 40, ACCENT);
            mark.setGravity(Gravity.CENTER);
            list.addView(mark, new LinearLayout.LayoutParams(-1, dp(54)));
            TextView emptyTitle = label("扫描设备码开始", 18, INK);
            emptyTitle.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            emptyTitle.setGravity(Gravity.CENTER);
            list.addView(emptyTitle);
            TextView emptyCopy = label("在电脑端运行设备二维码命令，然后用这里的扫描功能添加。", 13, MUTED);
            emptyCopy.setGravity(Gravity.CENTER);
            emptyCopy.setLineSpacing(0, 1.2f);
            emptyCopy.setPadding(dp(10), dp(7), dp(10), dp(20));
            list.addView(emptyCopy);
            Button scan = primaryButton("扫描二维码", v -> startScanner());
            list.addView(scan, new LinearLayout.LayoutParams(-1, dp(48)));
            Button manual = secondaryButton("手动输入地址", v -> showDeviceDialog(-1));
            LinearLayout.LayoutParams manualParams = new LinearLayout.LayoutParams(-1, dp(46));
            manualParams.setMargins(0, dp(10), 0, 0);
            list.addView(manual, manualParams);
        } else {
            list.setBackgroundColor(Color.TRANSPARENT);
            for (int i = 0; i < devices.size(); i++) addDeviceRow(list, devices.get(i), i, i == devices.size() - 1);
        }
        page.addView(list, new LinearLayout.LayoutParams(-1, -2));

        if (!devices.isEmpty()) {
            TextView sectionTitle = label("添加另一台电脑", 13, INK);
            sectionTitle.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            sectionTitle.setPadding(dp(2), dp(24), 0, dp(10));
            page.addView(sectionTitle);
            LinearLayout actions = new LinearLayout(this);
            actions.setOrientation(LinearLayout.HORIZONTAL);
            actions.setGravity(Gravity.CENTER_VERTICAL);
            Button scan = primaryButton("扫描二维码", v -> startScanner());
            actions.addView(scan, new LinearLayout.LayoutParams(0, dp(48), 1));
            Space gap = new Space(this);
            actions.addView(gap, new LinearLayout.LayoutParams(dp(10), dp(1)));
            Button manual = secondaryButton("手动添加", v -> showDeviceDialog(-1));
            actions.addView(manual, new LinearLayout.LayoutParams(0, dp(48), 1));
            page.addView(actions);
        }

        TextView localNote = label("🔒 无需云端账号 · 电脑信息与访问码只保存在这台手机上", 11, MUTED);
        localNote.setGravity(Gravity.CENTER);
        localNote.setPadding(dp(2), dp(22), dp(2), 0);
        page.addView(localNote);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));

        for (Device device : new ArrayList<>(devices)) checkConnection(device, list);
        openPendingNotificationTarget();
    }

    private void addDeviceRow(LinearLayout list, Device device, int index, boolean last) {
        Boolean state = deviceStatus.get(device.key());
        boolean online = Boolean.TRUE.equals(state);
        boolean pending = state == null;

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(14), dp(10), dp(14));
        card.setMinimumHeight(dp(82));
        card.setBackground(rounded(Color.WHITE, online ? 2 : 1, online ? ACCENT_BORDER : LINE, 16));
        card.setClickable(true);
        card.setFocusable(true);
        card.setOnClickListener(v -> openDevice(device));

        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);

        TextView icon = label("▣", 18, online ? ACCENT : pending ? PENDING_TEXT : MUTED);
        icon.setGravity(Gravity.CENTER);
        icon.setBackground(rounded(online ? ACCENT_SOFT : PENDING_SOFT, 0, 0, 12));
        header.addView(icon, new LinearLayout.LayoutParams(dp(44), dp(44)));

        LinearLayout copy = new LinearLayout(this);
        copy.setOrientation(LinearLayout.VERTICAL);
        TextView name = label(device.name, 16, INK);
        name.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        name.setMaxLines(1);
        name.setEllipsize(TextUtils.TruncateAt.END);
        copy.addView(name);
        if (!device.note.isEmpty()) {
            TextView note = label(device.note, 12, TEXT_SECONDARY);
            note.setMaxLines(1);
            note.setEllipsize(TextUtils.TruncateAt.END);
            copy.addView(note);
        }
        TextView address = label(displayAddress(device.url), 12, MUTED);
        address.setTypeface(Typeface.MONOSPACE);
        address.setMaxLines(1);
        address.setEllipsize(TextUtils.TruncateAt.END);
        copy.addView(address);
        LinearLayout.LayoutParams copyParams = new LinearLayout.LayoutParams(0, -2, 1);
        copyParams.setMargins(dp(11), 0, dp(8), 0);
        header.addView(copy, copyParams);

        TextView pill = label(statusLabel(state), 12, statusTextColor(state));
        pill.setTag("status-pill:" + device.key());
        pill.setGravity(Gravity.CENTER);
        pill.setSingleLine(true);
        pill.setBackground(rounded(statusSoftColor(state), 0, 0, 24));
        pill.setPadding(dp(10), dp(4), dp(10), dp(4));
        header.addView(pill, new LinearLayout.LayoutParams(-2, -2));

        Button menu = iconButton("⋮", "管理这台电脑", v -> showDeviceMenu(v, index));
        menu.setTextColor(MUTED);
        header.addView(menu, new LinearLayout.LayoutParams(dp(48), dp(48)));
        card.addView(header, new LinearLayout.LayoutParams(-1, -2));

        LinearLayout.LayoutParams cardParams = new LinearLayout.LayoutParams(-1, -2);
        cardParams.setMargins(0, 0, 0, last ? 0 : dp(11));
        list.addView(card, cardParams);
    }

    private String statusLabel(Boolean online) {
        if (online == null) return "● 正在检测";
        return online ? "● 在线" : "● 离线";
    }

    private int statusTextColor(Boolean online) {
        if (online == null) return PENDING_TEXT;
        return online ? ONLINE_TEXT : OFFLINE_TEXT;
    }

    private int statusSoftColor(Boolean online) {
        if (online == null) return PENDING_SOFT;
        return online ? ONLINE_SOFT : OFFLINE_SOFT;
    }

    private void showDeviceMenu(View anchor, int index) {
        if (index < 0 || index >= devices.size()) return;
        PopupMenu menu = new PopupMenu(this, anchor);
        menu.getMenu().add("编辑");
        menu.getMenu().add("测试连接");
        menu.getMenu().add("检查更新");
        menu.getMenu().add("删除");
        menu.setOnMenuItemClickListener(item -> {
            String action = item.getTitle().toString();
            if ("编辑".equals(action)) showDeviceDialog(index);
            else if ("测试连接".equals(action)) testConnectionWithFeedback(devices.get(index));
            else if ("检查更新".equals(action)) checkForUpdates(devices.get(index));
            else if ("删除".equals(action)) confirmDelete(index);
            return true;
        });
        menu.show();
    }

    private void openDevice(Device device) {
        openDevice(device, null);
    }

    /**
     * A device without a saved access code would land on the web login page.
     * Ask for the code in-app once, store it, then open the workspace directly.
     */
    private void reportMissingAccessCode(Device device, String threadId) {
        EditText input = field("访问码", "", false);
        input.setInputType(InputType.TYPE_CLASS_TEXT);
        new AlertDialog.Builder(this)
                .setTitle("输入访问码")
                .setMessage("这台电脑开启了访问码校验。访问码在电脑端控制台的「手机配对」页可以看到，输入一次后会保存在这台手机上。")
                .setView(input)
                .setPositiveButton("连接", (dialog, which) -> {
                    String value = input.getText().toString().trim();
                    if (value.isEmpty()) return;
                    Device updated = new Device(device.name, device.url, value, device.note);
                    for (int i = 0; i < devices.size(); i += 1) {
                        if (devices.get(i).url.equals(device.url) && devices.get(i).name.equals(device.name)) {
                            devices.set(i, updated);
                            break;
                        }
                    }
                    saveDevices();
                    openDevice(updated, threadId);
                })
                .setNegativeButton("取消", (dialog, which) -> showMachinePicker())
                .show();
    }

    private void openDevice(Device device, String threadId) {
        if (device.token == null || device.token.isBlank()) {
            reportMissingAccessCode(device, threadId);
            return;
        }
        activeDevice = device;
        clearMachinePickerMode = false;
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(ACTIVE_DEVICE_URL_KEY, device.url).apply();
        root.removeAllViews();
        // The WebView is the primary workspace, so keep the native chrome quiet and light.
        getWindow().setStatusBarColor(Color.WHITE);
        getWindow().setNavigationBarColor(PAPER);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        }

        LinearLayout topBar = new LinearLayout(this);
        topBar.setGravity(Gravity.CENTER_VERTICAL);
        topBar.setPadding(dp(8), dp(2), dp(8), dp(2));
        topBar.setBackgroundColor(Color.WHITE);
        if (demoMode) {
            // 演示包没有「切换电脑 / 在线圆点」这类会误导为真实连接的入口。
            TextView demoBadge = label("示例数据 · 演示数据 · 无需联网", 13, ACCENT);
            demoBadge.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            demoBadge.setGravity(Gravity.CENTER_VERTICAL);
            demoBadge.setMaxLines(1);
            topBar.addView(demoBadge, new LinearLayout.LayoutParams(0, dp(48), 1));
            connectionDot = null;
        } else {
            Button switchComputer = new Button(this);
            switchComputer.setText("切换电脑");
            switchComputer.setAllCaps(false);
            switchComputer.setTextSize(14);
            switchComputer.setTextColor(ACCENT);
            switchComputer.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            switchComputer.setBackground(rounded(ACCENT_SOFT, 1, ACCENT_BORDER, 18));
            switchComputer.setMinHeight(0);
            switchComputer.setMinimumHeight(0);
            switchComputer.setPadding(dp(14), 0, dp(14), 0);
            switchComputer.setContentDescription("切换电脑");
            switchComputer.setOnClickListener(v -> showMachinePicker(false));
            topBar.addView(switchComputer, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(44)));
            connectionDot = label("●", 10, ONLINE);
            connectionDot.setGravity(Gravity.CENTER);
            topBar.addView(connectionDot, new LinearLayout.LayoutParams(dp(22), dp(44)));
        }
        if (!demoMode) {
            LinearLayout connectedCopy = new LinearLayout(this);
            connectedCopy.setOrientation(LinearLayout.VERTICAL);
            connectedCopy.setGravity(Gravity.CENTER_VERTICAL);
            TextView connectedTitle = label(device.name, 16, INK);
            connectedTitle.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            connectedTitle.setMaxLines(1);
            connectedCopy.addView(connectedTitle);
            if (!device.note.isEmpty()) {
                TextView connectedNote = label(device.note, 11, MUTED);
                connectedNote.setMaxLines(1);
                connectedCopy.addView(connectedNote);
            }
            topBar.addView(connectedCopy, new LinearLayout.LayoutParams(0, dp(48), 1));
            Button refresh = iconButton("↻", "刷新当前页面", v -> {
                if (webView != null && activeDevice != null) webView.loadUrl(targetUrl(activeDevice));
            });
            refresh.setTextSize(24);
            refresh.setTextColor(INK);
            topBar.addView(refresh, new LinearLayout.LayoutParams(dp(44), dp(44)));
        }
        root.addView(topBar, new LinearLayout.LayoutParams(-1, dp(52)));

        pageProgress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        pageProgress.setMax(100);
        pageProgress.setProgressTintList(android.content.res.ColorStateList.valueOf(ACCENT));
        root.addView(pageProgress, new LinearLayout.LayoutParams(-1, dp(2)));
        webContainer = new FrameLayout(this);
        webContainer.setBackgroundColor(Color.WHITE);
        webView = buildWebView();
        webContainer.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        root.addView(webContainer, new LinearLayout.LayoutParams(-1, 0, 1));
        webView.loadUrl(targetUrl(device, threadId));
    }

    private WebView buildWebView() {
        if (demoMode && Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
        WebView view = new WebView(this);
        view.setBackgroundColor(Color.WHITE);
        view.setFocusableInTouchMode(true);
        view.setOverScrollMode(View.OVER_SCROLL_NEVER);
        view.addJavascriptInterface(new NativeBridge(), "CodexPocket");
        // 长按由网页里的应用内操作单接管；不要让 WebView 弹出系统选词把手。
        view.setLongClickable(false);
        view.setHapticFeedbackEnabled(false);
        view.setOnLongClickListener(v -> true);
        view.setNestedScrollingEnabled(false);
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        if (demoMode) {
            // file:// 页面需要 localStorage 与同文件脚本互相访问；全部限在本地 assets。
            settings.setAllowFileAccessFromFileURLs(true);
            settings.setAllowUniversalAccessFromFileURLs(true);
            settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        }
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(false);
        // 尊重系统「字体大小」设置，但夹在 100–150 之间：完全屏蔽会让无障碍
        // 设置失效，完全放开又会把布局撑坏。Web 层据根字号切 large-text 布局。
        float systemScale = getResources().getConfiguration().fontScale;
        int zoom = Math.round(100 * Math.max(1f, Math.min(1.5f, systemScale)));
        settings.setTextZoom(zoom);
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

            // 兜底：网页里任何残留的 alert/confirm/prompt 都不再掉进
            // WebView 的默认系统对话框（那种方框一眼就是网页水平）。
            // Web 层已改用应用内弹层；这里用带样式的 AlertDialog 收尾，
            // 且必须调用 JsResult，否则 JS 线程会一直被挂住。
            @Override
            public boolean onJsAlert(WebView webView, String url, String message, JsResult result) {
                showJsDialog(message, null, result, false);
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView webView, String url, String message, JsResult result) {
                showJsDialog(message, null, result, true);
                return true;
            }

            @Override
            public boolean onJsPrompt(WebView webView, String url, String message,
                                      String defaultValue, JsPromptResult result) {
                showJsDialog(message, defaultValue, result, true);
                return true;
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
            public WebResourceResponse shouldInterceptRequest(WebView webView, WebResourceRequest request) {
                if (demoMode && request != null && request.getUrl() != null) {
                    String scheme = request.getUrl().getScheme();
                    // 只放行本地 file/data 资源；任何 http/https 都被本地空响应吞掉，
                    // 保证演示包绝不会产生真实外网请求。
                    if (!"file".equalsIgnoreCase(scheme) && !"data".equalsIgnoreCase(scheme)) {
                        return new WebResourceResponse("application/json", "utf-8",
                                new java.io.ByteArrayInputStream(new byte[0]));
                    }
                }
                return super.shouldInterceptRequest(webView, request);
            }

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
                if (demoMode) return; // 本地资源不弹「连不上电脑」误导提示
                if (!request.isForMainFrame()) return;
                setConnectionState(OFFLINE);
                showLoadError(activeDevice == null ? "" : activeDevice.url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView webView, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme() == null ? "" : uri.getScheme();
                if (demoMode) {
                    // 演示包只允许 file:// 主文档，其余一律丢弃，绝不跳浏览器或联网。
                    return !"file".equalsIgnoreCase(scheme);
                }
                boolean isWeb = "http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme);
                if (isWeb) {
                    return false;
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

    /** 加载失败给出人能看懂的说明和可操作的下一步，而不是浏览器原始报错。 */
    private void showLoadError(String url) {
        if (root == null) return;
        View previous = root.findViewWithTag("load-error");
        if (previous != null) root.removeView(previous);
        if (webContainer != null) webContainer.setVisibility(View.GONE);

        LinearLayout box = new LinearLayout(this);
        box.setTag("load-error");
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setPadding(dp(28), dp(28), dp(28), dp(28));

        TextView title = label("连不上这台电脑", 19, INK);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        title.setGravity(Gravity.CENTER);
        box.addView(title);

        TextView detail = label("请确认电脑端服务在运行、手机网络可用；如果用的是公网地址，也可能是电脑上的隧道断了。", 14, MUTED);
        detail.setGravity(Gravity.CENTER);
        detail.setPadding(0, dp(10), 0, dp(6));
        box.addView(detail);

        if (url != null && !url.isEmpty()) {
            TextView addr = label(url, 12, MUTED);
            addr.setGravity(Gravity.CENTER);
            box.addView(addr);
        }

        Button retry = new Button(this);
        retry.setText("重试");
        retry.setAllCaps(false);
        retry.setOnClickListener(v -> {
            root.removeView(box);
            if (webContainer != null) webContainer.setVisibility(View.VISIBLE);
            if (webView != null) webView.reload();
        });
        LinearLayout.LayoutParams retryParams = new LinearLayout.LayoutParams(-1, dp(48));
        retryParams.setMargins(0, dp(20), 0, dp(4));
        box.addView(retry, retryParams);

        Button back = new Button(this);
        back.setText("返回电脑列表");
        back.setAllCaps(false);
        back.setOnClickListener(v -> showMachinePicker());
        box.addView(back, new LinearLayout.LayoutParams(-1, dp(48)));

        root.addView(box, 2, new LinearLayout.LayoutParams(-1, 0, 1));
    }

    private void downloadFile(String url, String userAgent, String contentDisposition, String mimeType) {
        try {
            String fileName = DownloadFileNames.resolve(url, contentDisposition, mimeType);
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle(fileName);
            request.setDescription("来自 " + (activeDevice == null ? "Codex-Turnloom" : activeDevice.name));
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
            JSONObject health = null;
            try {
                health = new JSONObject(httpGet(device, "/api/health"));
                online = true;
            } catch (Exception ignored) {
                online = false;
            }
            boolean value = online;
            JSONObject healthResult = health;
            runOnUiThread(() -> {
                if (activeDevice != null || root.getChildCount() == 0) return;
                deviceStatus.put(device.key(), value);
                View pill = currentList.findViewWithTag("status-pill:" + device.key());
                if (pill instanceof TextView) {
                    TextView statusView = (TextView) pill;
                    statusView.setText(statusLabel(value));
                    statusView.setTextColor(statusTextColor(value));
                    statusView.setBackground(rounded(statusSoftColor(value), 0, 0, 24));
                }
                if (value && healthResult != null) maybeOfferUpdate(device, healthResult);
            });
        }).start();
    }

    /** One dialog with current/latest/time; auto-offered at most once per app run. */
    private void maybeOfferUpdate(Device device, JSONObject health) {
        if (autoUpdatePrompted) return;
        int remoteCode = health.optInt("appVersionCode", 0);
        if (remoteCode <= appVersionCode() || !health.optBoolean("apkAvailable", false)) return;
        autoUpdatePrompted = true;
        showUpdateDialog(device, health);
    }

    private String updateSummary(JSONObject health) {
        int remoteCode = health.optInt("appVersionCode", 0);
        String remoteName = health.optString("appVersionName", "未知");
        String updatedAt = formatUpdateTime(health.optString("apkUpdatedAt", ""));
        boolean newer = remoteCode > appVersionCode() && health.optBoolean("apkAvailable", false);
        // Never print a "latest version" that is older than what is installed: that reads
        // as a contradiction next to "已是最新版本".
        String latestName = newer ? remoteName : appVersionName();
        int latestCode = newer ? remoteCode : appVersionCode();
        StringBuilder text = new StringBuilder();
        text.append("当前版本：").append(appVersionName()).append("（").append(appVersionCode()).append("）\n");
        text.append("最新版本：").append(latestName).append("（").append(latestCode).append("）\n");
        text.append("安装包时间：").append(updatedAt.isEmpty() ? "未知" : updatedAt).append("\n");
        if (newer) {
            text.append("状态：有新版本可以更新");
        } else if (remoteCode > 0 && remoteCode < appVersionCode()) {
            text.append("状态：已是最新版本（服务器上的 ").append(remoteName).append(" 比当前旧）");
        } else {
            text.append("状态：已是最新版本");
        }
        return text.toString();
    }

    private String formatUpdateTime(String iso) {
        if (iso == null || iso.isEmpty()) return "";
        try {
            java.text.SimpleDateFormat parser = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.US);
            // health.apkUpdatedAt is an ISO-8601 UTC instant; parsing it as local time
            // showed every timestamp shifted by the device's UTC offset.
            parser.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            java.util.Date date = parser.parse(iso.length() > 19 ? iso.substring(0, 19) : iso);
            java.text.SimpleDateFormat printer = new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm", java.util.Locale.CHINA);
            return printer.format(date);
        } catch (Exception ignored) {
            return iso;
        }
    }

    private void showUpdateDialog(Device device, JSONObject health) {
        int remoteCode = health.optInt("appVersionCode", 0);
        boolean newer = remoteCode > appVersionCode() && health.optBoolean("apkAvailable", false);
        AlertDialog.Builder builder = new AlertDialog.Builder(this)
                .setTitle("应用更新")
                .setMessage(updateSummary(health))
                .setNegativeButton(newer ? "稍后" : "关闭", null);
        if (newer) {
            builder.setPositiveButton("下载更新", (dialog, which) -> {
                String path = health.optString("apkUrl", "/api/apk");
                downloadUpdate(device, apiBaseUrl(device) + path);
            });
        }
        builder.show();
    }

    private void checkForUpdates() {
        if (devices.isEmpty()) {
            Toast.makeText(this, "请先添加一台电脑", Toast.LENGTH_SHORT).show();
            return;
        }
        Toast.makeText(this, "正在检查更新…", Toast.LENGTH_SHORT).show();
        final List<Device> snapshot = new ArrayList<>(devices);
        new Thread(() -> {
            Device bestDevice = null;
            JSONObject best = null;
            int bestCode = -1;
            boolean anyOk = false;
            for (Device device : snapshot) {
                try {
                    JSONObject health = new JSONObject(httpGet(device, "/api/health"));
                    anyOk = true;
                    int code = health.optInt("appVersionCode", 0);
                    if (code > bestCode) {
                        bestCode = code;
                        best = health;
                        bestDevice = device;
                    }
                } catch (Exception ignored) {
                }
            }
            final Device targetDevice = bestDevice;
            final JSONObject targetHealth = best;
            final boolean reachable = anyOk;
            runOnUiThread(() -> {
                if (!reachable || targetHealth == null || targetDevice == null) {
                    Toast.makeText(this, "检查更新失败，请确认电脑在线", Toast.LENGTH_LONG).show();
                    return;
                }
                autoUpdatePrompted = true;
                showUpdateDialog(targetDevice, targetHealth);
            });
        }).start();
    }

    private void checkForUpdates(Device device) {
        Toast.makeText(this, "正在检查更新…", Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            try {
                JSONObject health = new JSONObject(httpGet(device, "/api/health"));
                runOnUiThread(() -> {
                    autoUpdatePrompted = true;
                    showUpdateDialog(device, health);
                });
            } catch (Exception error) {
                runOnUiThread(() -> Toast.makeText(this, "检查更新失败，请确认电脑在线", Toast.LENGTH_LONG).show());
            }
        }).start();
    }

    // 系统 DownloadManager 在 Android 10+ 分区存储、反向代理/自签 HTTPS 等场景下
    // 会独立报「下载失败」，而健康检查明明可达。改用与 /api/health 完全相同的
    // HttpURLConnection + token 头部/查询参数链路，把 APK 直接下载到应用私有目录，
    // 再用 FileProvider 交给系统安装器。整条链路不再依赖存储权限或系统下载服务。
    private void downloadUpdate(Device device, String url) {
        if (updateDownloadRunning) {
            Toast.makeText(this, "更新正在下载中", Toast.LENGTH_SHORT).show();
            return;
        }
        updateDownloadRunning = true;
        Toast.makeText(this, "正在下载更新，完成后会打开安装界面", Toast.LENGTH_SHORT).show();
        String token = device.token == null ? "" : device.token;
        String downloadUrl = UpdateDownload.downloadUrl(url, token);
        new Thread(() -> {
            java.io.File outFile = null;
            try {
                java.io.File outDir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (outDir == null) throw new IllegalStateException("没有可用的应用下载目录");
                if (!outDir.exists() && !outDir.mkdirs()) throw new IllegalStateException("无法创建应用下载目录");
                outFile = new java.io.File(outDir, "Codex-Turnloom-update.apk");
                java.io.File partial = new java.io.File(outDir, "Codex-Turnloom-update.apk.part");
                if (partial.exists() && !partial.delete()) throw new IllegalStateException("无法清理旧下载文件");

                HttpURLConnection connection = (HttpURLConnection) new URL(downloadUrl).openConnection();
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(60000);
                connection.setInstanceFollowRedirects(true);
                connection.setRequestProperty("Accept", "application/vnd.android.package-archive");
                if (!token.isBlank()) connection.setRequestProperty("x-access-token", token);
                int code = connection.getResponseCode();
                if (code < 200 || code >= 300) throw new Exception("HTTP " + code);
                long expected = connection.getHeaderFieldLong("Content-Length", 0L);
                byte[] buffer = new byte[64 * 1024];
                long total = 0L;
                try (InputStream input = connection.getInputStream();
                     java.io.FileOutputStream output = new java.io.FileOutputStream(partial)) {
                    int read;
                    while ((read = input.read(buffer)) != -1) {
                        output.write(buffer, 0, read);
                        total += read;
                    }
                } finally {
                    connection.disconnect();
                }
                String sizeProblem = UpdateDownload.sizeProblem(total, expected);
                if (sizeProblem != null) throw new Exception(sizeProblem);
                try (java.io.FileInputStream input = new java.io.FileInputStream(partial)) {
                    byte[] header = new byte[2];
                    if (input.read(header) != 2 || !UpdateDownload.hasApkMagic(header)) {
                        throw new Exception("下载内容不是 APK（可能返回了登录页）");
                    }
                }
                if (outFile.exists() && !outFile.delete()) throw new IllegalStateException("无法替换旧更新文件");
                if (!partial.renameTo(outFile)) throw new IllegalStateException("无法保存更新文件");

                Uri apkUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", outFile);
                runOnUiThread(() -> {
                    Toast.makeText(this, "更新下载完成，正在打开安装界面", Toast.LENGTH_SHORT).show();
                    installApk(apkUri);
                });
            } catch (Exception error) {
                String message = error.getMessage() == null || error.getMessage().isBlank()
                        ? "网络或存储不可用" : error.getMessage();
                runOnUiThread(() -> Toast.makeText(this, "更新下载失败：" + message, Toast.LENGTH_LONG).show());
            } finally {
                updateDownloadRunning = false;
            }
        }, "turnloom-update-download").start();
    }

    private void installApk(Uri uri) {
        // 私有目录下的 APK 必须经 FileProvider 生成 content:// URI；直接使用
        // file:// 会在 Android 7+ 触发 FileUriExposedException。
        try {
            Intent intent = new Intent(Intent.ACTION_INSTALL_PACKAGE);
            intent.setData(uri);
            intent.setType("application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            intent.putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true);
            intent.putExtra(Intent.EXTRA_RETURN_RESULT, true);
            startActivity(intent);
        } catch (Exception error) {
            try {
                Intent fallback = new Intent(Intent.ACTION_VIEW);
                fallback.setDataAndType(uri, "application/vnd.android.package-archive");
                fallback.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(fallback);
            } catch (Exception ignored) {
                Toast.makeText(this, "更新已下载，请打开文件管理器的应用下载目录安装", Toast.LENGTH_LONG).show();
            }
        }
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

    private Button headerButton(String text, String description, View.OnClickListener listener) {
        Button button = iconButton(text, description, listener);
        button.setTextColor(INK);
        button.setTextSize(text.length() > 1 ? 13 : 22);
        return button;
    }

    private Button primaryButton(String text, View.OnClickListener listener) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextSize(15);
        button.setTextColor(Color.WHITE);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        button.setAllCaps(false);
        button.setMinHeight(0);
        button.setMinimumHeight(0);
        button.setPadding(dp(16), 0, dp(16), 0);
        button.setBackground(rounded(ACCENT, 0, ACCENT, 24));
        button.setOnClickListener(listener);
        return button;
    }

    private Button secondaryButton(String text, View.OnClickListener listener) {
        Button button = primaryButton(text, listener);
        button.setTextColor(ACCENT);
        button.setBackground(rounded(Color.WHITE, 1, LINE, 24));
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

    private String displayAddress(String value) {
        try {
            Uri uri = Uri.parse(value);
            String host = valueOr(uri.getHost(), value);
            return uri.getPort() > 0 ? host + ":" + uri.getPort() : host;
        } catch (Exception ignored) {
            return value;
        }
    }

    /** API 请求必须使用服务根地址；预置设备的 URL 带 /option-a/index.html 页面路径。 */
    private String apiBaseUrl(Device device) {
        try {
            Uri uri = Uri.parse(device.url);
            String scheme = uri.getScheme() == null ? "http" : uri.getScheme();
            String authority = uri.getAuthority() == null ? "" : uri.getAuthority();
            return scheme + "://" + authority;
        } catch (Exception ignored) {
            return trimTrailingSlash(device.url);
        }
    }

    private String targetUrl(Device device) {
        return targetUrl(device, null);
    }

    private String targetUrl(Device device, String threadId) {
        if (demoMode) return DEMO_ASSET_URL;
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
        HttpURLConnection connection = (HttpURLConnection) new URL(apiBaseUrl(device) + path).openConnection();
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

    private int findDevice(Device imported) {
        for (int i = 0; i < devices.size(); i++) {
            Device existing = devices.get(i);
            String existingToken = existing.token == null ? "" : existing.token;
            String importedToken = imported.token == null ? "" : imported.token;
            if (DeviceOrigin.matches(existing.url, imported.url) && existingToken.equals(importedToken)) return i;
        }
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
        if (webView != null) {
            webView.evaluateJavascript(
                "(typeof window.codexPocketHandleBack === 'function' && window.codexPocketHandleBack()) ? 'true' : 'false'",
                value -> {
                    if ("true".equals(value) || "\"true\"".equals(value)) return;
                    // Chat is the home page. A normal back press keeps the selected
                    // computer and backgrounds the app; the picker is only reached
                    // through the explicit switch-computer button or first-run setup.
                    moveTaskToBack(true);
                }
            );
            return;
        }
        if (!clearMachinePickerMode) {
            Device startupDevice = activeDevice != null ? activeDevice : findActiveDevice();
            if (startupDevice != null) {
                openDevice(startupDevice, null);
                return;
            }
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

    private void showWelcomeGuide(boolean firstRun) {
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(24), dp(6), dp(24), dp(6));

        TextView intro = label("手机是电脑端 Codex 的控制窗口。电脑保留所有数据，手机只负责连接和操作。", 15, MUTED);
        intro.setLineSpacing(0, 1.2f);
        intro.setPadding(0, 0, 0, dp(18));
        content.addView(intro);
        addGuideStep(content, "1", "在电脑上启动服务", "保持 Codex Desktop 和 Codex-Turnloom 服务运行。");
        addGuideStep(content, "2", "扫描设备二维码", "设备地址和访问码会加密保存在这台手机上。");
        addGuideStep(content, "3", "选择电脑并继续", "打开会话、发送消息、图片或文件，必要时处理等待操作。");

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("欢迎使用 Codex-Turnloom")
                .setView(content)
                .setNegativeButton(firstRun ? "稍后" : "关闭", null)
                .setPositiveButton(devices.isEmpty() ? "扫描二维码" : "知道了", null)
                .create();
        dialog.setOnShowListener(value -> dialog.getButton(DialogInterface.BUTTON_POSITIVE).setOnClickListener(view -> {
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(ONBOARDING_KEY, true).apply();
            dialog.dismiss();
            if (devices.isEmpty()) startScanner();
        }));
        dialog.setOnDismissListener(value -> getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(ONBOARDING_KEY, true).apply());
        dialog.show();
    }

    private void addGuideStep(LinearLayout parent, String number, String title, String copy) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.TOP);
        row.setPadding(0, 0, 0, dp(16));
        TextView badge = label(number, 14, ACCENT);
        badge.setGravity(Gravity.CENTER);
        badge.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        badge.setBackground(rounded(ACCENT_SOFT, 0, ACCENT_SOFT, 18));
        row.addView(badge, new LinearLayout.LayoutParams(dp(34), dp(34)));
        LinearLayout text = new LinearLayout(this);
        text.setOrientation(LinearLayout.VERTICAL);
        text.setPadding(dp(12), 0, 0, 0);
        TextView heading = label(title, 15, INK);
        heading.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        text.addView(heading);
        TextView description = label(copy, 13, MUTED);
        description.setLineSpacing(0, 1.15f);
        text.addView(description);
        row.addView(text, new LinearLayout.LayoutParams(0, -2, 1));
        parent.addView(row);
    }

    private void clearLegacyReminderNotification() {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) return;
        manager.cancelAll();
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
        public void copyText(String text) {
            if (text == null || text.isEmpty()) return;
            runOnUiThread(() -> {
                ClipboardManager manager = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                if (manager != null) manager.setPrimaryClip(ClipData.newPlainText("Codex-Turnloom", text));
            });
        }

        @JavascriptInterface
        public void showMachinePicker() {
            runOnUiThread(() -> MainActivity.this.showMachinePicker(false));
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

        /** Stable per-computer identity: origin plus access code. */
        String key() {
            return DeviceIdentity.key(url, token);
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
