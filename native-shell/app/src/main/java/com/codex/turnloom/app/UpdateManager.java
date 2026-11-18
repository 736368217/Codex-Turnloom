package com.codex.turnloom.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * Update download / verification / installer handoff.
 *
 * <p>Only an explicit frontend downloadUpdate() starts the worker. Downloads
 * use a stable private .part file and HTTP Range continuation (a 200 response
 * restarts from zero); cancellation and transient network failures preserve
 * the partial. 'ready' is emitted only after SHA-256, APK package identity,
 * greater versionCode and signer certificate checks all pass. Installation
 * is always a system installer Intent with user confirmation.</p>
 */
final class UpdateManager {
    interface Deliverer {
        void deliverUpdate(String requestId, String eventJson);
        void launchInstaller(Intent intent, int requestCode);
    }

    private static final int DOWNLOAD_PASSES = 2;
    private static final int CONNECT_TIMEOUT_MS = 20_000;
    private static final int READ_TIMEOUT_MS = 75_000;
    private static final int REQ_UNKNOWN_SOURCES = 0x62;
    private static final String PART_NAME = "pending.apk.part";
    private static final String APK_NAME = "pending.apk";

    private final Context context;
    private final Deliverer deliverer;
    private final ExecutorService pool = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final File updateDir;
    private final File partFile;
    private final File apkFile;
    private final Object lock = new Object();

    private volatile boolean downloadRunning = false;
    private volatile HttpURLConnection downloadingConnection;
    private volatile boolean cancelled = false;
    private volatile boolean destroyed = false;
    private volatile boolean ready = false;
    private volatile String activeRequestId = "";
    private volatile boolean awaitingPermission = false;
    private volatile boolean awaitingInstaller = false;

    String currentRequestId() { return activeRequestId; }

    UpdateManager(Context context, Deliverer deliverer) {
        this.context = context.getApplicationContext();
        this.deliverer = deliverer;
        this.updateDir = new File(this.context.getFilesDir(), "updates");
        this.partFile = new File(updateDir, PART_NAME);
        this.apkFile = new File(updateDir, APK_NAME);
    }

    private static String event(String state, Long received, Long total, String message) {
        try {
            JSONObject o = new JSONObject();
            o.put("state", state);
            if (received != null) o.put("received", received.longValue());
            if (total != null) o.put("total", total.longValue());
            if (message != null && !message.isEmpty()) o.put("message", message);
            return o.toString();
        } catch (Exception e) {
            return "{\"state\":\"error\",\"message\":\"event-error\"}";
        }
    }

    private void emit(String requestId, String state, Long received, Long total, String message) {
        if (destroyed) return;
        String json = event(state, received, total, message);
        mainHandler.post(() -> {
            if (!destroyed) deliverer.deliverUpdate(requestId, json);
        });
    }

    private void emit(String requestId, String state, String message) {
        emit(requestId, state, null, null, message);
    }

    void downloadUpdate(String requestId, String optionsJson) {
        if (destroyed) return;
        if (!BridgeContract.validRequestId(requestId)) {
            emit("", "error", "invalid-request");
            return;
        }
        final BridgeContract.UpdateRequest req;
        try {
            req = BridgeContract.parseUpdateRequest(optionsJson);
            NativeHttpPolicy.assertPermitted(context, req.origin, "apk");
            PackageInfo installed = installedInfo();
            if (req.versionCode <= packageVersionCode(installed)) {
                emit(requestId, "error", "not-newer");
                return;
            }
        } catch (BridgeContract.ValidationException | PackageManager.NameNotFoundException e) {
            emit(requestId, "error", e instanceof BridgeContract.ValidationException
                    ? e.getMessage() : "installed-package-unavailable");
            return;
        }
        synchronized (lock) {
            if (destroyed) return;
            if (downloadRunning) {
                emit(requestId, "error", "download-in-progress");
                return;
            }
            cancelled = false;
            ready = false;
            downloadRunning = true;
            activeRequestId = requestId;
            pool.submit(() -> downloadWorker(requestId, req));
        }
    }

    void cancelUpdate() {
        cancelled = true;
        HttpURLConnection connection = downloadingConnection;
        if (connection != null) connection.disconnect();
    }

    private void downloadWorker(String requestId, BridgeContract.UpdateRequest req) {
        String requestIdToReport = requestId;
        try {
            if (!updateDir.isDirectory() && !updateDir.mkdirs()) {
                throw new IOException("private-dir-unavailable");
            }
            android.content.SharedPreferences metadata = context.getSharedPreferences("turnloom_update_v1", Context.MODE_PRIVATE);
            if (!req.sha256.equals(metadata.getString("partialSha256", ""))) {
                if (partFile.exists() && !partFile.delete()) throw new IOException("stale-partial");
                metadata.edit().putString("partialSha256", req.sha256).commit();
            }
            if (partFile.isFile() && req.sha256.equalsIgnoreCase(sha256(partFile)) && verifyAndPromote(req)) {
                ready = true;
                emit(requestId, "ready", "update-verified");
                return;
            }
            for (int pass = 1; pass <= DOWNLOAD_PASSES && !cancelled; pass++) {
                if (downloadPass(requestId, req, pass)) {
                    if (cancelled) break;
                    if (verifyAndPromote(req)) {
                        ready = true;
                        emit(requestId, "ready", "update-verified");
                    } else {
                        // Verification cannot be repaired by continuation.
                        deleteBoth();
                        emit(requestId, "error", "apk-verification-failed");
                    }
                    return;
                }
            }
            if (cancelled) {
                long kept = partFile.isFile() ? partFile.length() : 0;
                emit(requestIdToReport, "cancelled", kept, null,
                        "已取消下载（已下载部分保留，可继续）");
            } else {
                emit(requestIdToReport, "error", "download-incomplete");
            }
        } catch (Exception e) {
            if (cancelled) {
                long kept = partFile.isFile() ? partFile.length() : 0;
                emit(requestIdToReport, "cancelled", kept, null,
                        "已取消下载（已下载部分保留，可继续）");
            } else {
                emit(requestIdToReport, "error", safeError(e));
            }
        } finally {
            synchronized (lock) {
                downloadRunning = false;
            }
        }
    }

    /** One bounded pass. true means a complete assembled file is staged as .part. */
    private boolean downloadPass(String requestId, BridgeContract.UpdateRequest req, int pass)
            throws Exception {
        long resumeFrom = partFile.isFile() ? partFile.length() : 0;
        long expectedTotal = -1;
        URL url = req.url;
        for (int redirects = 0; redirects <= 3; redirects++) {
            if (cancelled || Thread.currentThread().isInterrupted()) return false;
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            downloadingConnection = conn;
            try {
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
                conn.setReadTimeout(READ_TIMEOUT_MS);
                conn.setUseCaches(false);
                conn.setRequestMethod("GET");
                conn.setRequestProperty("Accept", "application/vnd.android.package-archive");
                conn.setRequestProperty("Accept-Encoding", "identity");
                conn.setRequestProperty("x-access-token", req.token);
                if (resumeFrom > 0) {
                    conn.setRequestProperty("Range", "bytes=" + resumeFrom + "-");
                }
                int status = conn.getResponseCode();
                if (status == 301 || status == 302 || status == 303
                        || status == 307 || status == 308) {
                    url = NativeHttpPolicy.sameOriginRedirect(conn, req.origin, redirects);
                    continue;
                }
                if (status != 200 && status != 206) throw new IOException("http-" + status);
                if (status == 206 && resumeFrom <= 0) throw new IOException("unexpected-partial");
                boolean append = status == 206;
                if (!append) resumeFrom = 0;
                long contentLength = contentLength(conn);
                if (append) {
                    String range = conn.getHeaderField("Content-Range");
                    if (range == null || !range.startsWith("bytes " + resumeFrom + "-")) {
                        throw new IOException("invalid-range");
                    }
                    int slash = range.indexOf('/');
                    long parsedTotal = -1;
                    if (slash > 0) {
                        String tail = range.substring(slash + 1).trim();
                        if (tail.matches("\\d+")) parsedTotal = Long.parseLong(tail);
                    }
                    expectedTotal = parsedTotal > 0 ? parsedTotal : -1;
                } else {
                    expectedTotal = contentLength;
                }
                if (expectedTotal > BridgeContract.MAX_APK_BYTES) {
                    throw new IOException("apk-too-large");
                }
                emit(requestId, "downloading", append ? resumeFrom : 0,
                        expectedTotal > 0 ? expectedTotal : null, null);
                long received = transfer(conn.getInputStream(), append, requestId, expectedTotal,
                        append ? resumeFrom : 0);
                long fileLength = partFile.isFile() ? partFile.length() : 0;
                if (cancelled) return false;
                if (expectedTotal > 0 && fileLength != expectedTotal) return false;
                if (fileLength < BridgeContract.MIN_APK_BYTES
                        || fileLength > BridgeContract.MAX_APK_BYTES) {
                    throw new IOException("invalid-apk-size");
                }
                return true;
            } finally {
                conn.disconnect();
            }
        }
        return false;
    }

    private long transfer(InputStream input, boolean append, String requestId,
            long total, long startBytes) throws IOException {
        long received = startBytes;
        long lastEmit = 0;
        try (InputStream in = input;
             OutputStream out = new FileOutputStream(partFile, append)) {
            byte[] buffer = new byte[64 * 1024];
            int n;
            while ((n = in.read(buffer)) != -1) {
                if (cancelled || Thread.currentThread().isInterrupted()) {
                    throw new IOException("cancelled");
                }
                if (received + n > BridgeContract.MAX_APK_BYTES) {
                    throw new IOException("apk-too-large");
                }
                out.write(buffer, 0, n);
                received += n;
                if (System.nanoTime() - lastEmit >= 200_000_000L || (total > 0 && received == total)) {
                    lastEmit = System.nanoTime();
                    emit(requestId, "downloading", received, total > 0 ? total : null, null);
                }
            }
            out.flush();
        }
        return received;
    }

    private static long contentLength(HttpURLConnection conn) {
        try {
            return Long.parseLong(conn.getHeaderField("Content-Length"));
        } catch (Exception e) {
            return -1;
        }
    }

    private PackageInfo installedInfo() throws PackageManager.NameNotFoundException {
        PackageInfo info = context.getPackageManager().getPackageInfo(
                BridgeContract.APP_PACKAGE, signingInfoFlags());
        if (info == null) throw new PackageManager.NameNotFoundException();
        return info;
    }

    private static int signingInfoFlags() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
    }

    private static long packageVersionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? info.getLongVersionCode() : info.versionCode;
    }
    /** SHA-256, APK package, version and signer checks; rename only on success. */
    private boolean verifyAndPromote(BridgeContract.UpdateRequest req) {
        if (!partFile.isFile() || partFile.length() < BridgeContract.MIN_APK_BYTES) return false;
        String digest = sha256(partFile);
        if (!req.sha256.equalsIgnoreCase(digest)) return false;
        PackageManager pm = context.getPackageManager();
        PackageInfo candidate = pm.getPackageArchiveInfo(
                partFile.getAbsolutePath(), signingInfoFlags());
        if (candidate == null || !BridgeContract.APP_PACKAGE.equals(candidate.packageName)) {
            return false;
        }
        PackageInfo installed;
        try {
            installed = installedInfo();
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
        if (packageVersionCode(candidate) <= packageVersionCode(installed)
                || packageVersionCode(candidate) != req.versionCode) {
            return false;
        }
        byte[][] installedSigners = signerDigests(installed);
        byte[][] candidateSigners = signerDigests(candidate);
        if (installedSigners.length == 0 || installedSigners.length != candidateSigners.length) {
            return false;
        }
        for (byte[] local : installedSigners) {
            boolean found = false;
            for (byte[] remote : candidateSigners) {
                if (Arrays.equals(local, remote)) {
                    found = true;
                    break;
                }
            }
            if (!found) return false;
        }
        if (apkFile.exists() && !apkFile.delete()) return false;
        if (!partFile.renameTo(apkFile)) return false;
        return true;
    }

    static byte[][] signerDigests(PackageInfo info) {
        Signature[] signatures = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && info.signingInfo != null) {
            signatures = info.signingInfo.getApkContentsSigners();
        }
        if (signatures == null || signatures.length == 0) signatures = info.signatures;
        if (signatures == null) return new byte[0][];
        byte[][] out = new byte[signatures.length][];
        for (int i = 0; i < signatures.length; i++) {
            try {
                out[i] = MessageDigest.getInstance("SHA-256").digest(signatures[i].toByteArray());
            } catch (Exception e) {
                return new byte[0][];
            }
        }
        return out;
    }

    static String sha256(File file) {
        try (InputStream in = new FileInputStream(file)) {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[64 * 1024];
            int n;
            while ((n = in.read(buffer)) != -1) md.update(buffer, 0, n);
            StringBuilder sb = new StringBuilder();
            for (byte b : md.digest()) sb.append(String.format(Locale.ROOT, "%02x", b & 0xff));
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    private void deleteBoth() {
        if (partFile.exists() && !partFile.delete()) partFile.deleteOnExit();
        if (apkFile.exists() && !apkFile.delete()) apkFile.deleteOnExit();
        ready = false;
    }

    private static String safeError(Exception e) {
        if (e instanceof java.net.SocketTimeoutException) return "timeout";
        if (e instanceof java.io.IOException) return "network-error";
        return "download-error";
    }

    /** Explicit install action; never called automatically after download. */
    void installUpdate() {
        if (destroyed) return;
        if (!ready || !apkFile.isFile()) {
            emit(activeRequestId, "error", "update-not-ready");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !context.getPackageManager().canRequestPackageInstalls()) {
            emit(activeRequestId, "permission-required", "需要允许安装未知来源应用");
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
            settings.setData(Uri.parse("package:" + context.getPackageName()));
            awaitingPermission = true;
            deliverer.launchInstaller(settings, REQ_UNKNOWN_SOURCES);
            return;
        }
        launchInstaller();
    }

    /** Called from MainActivity.onActivityResult after a settings / installer screen. */
    void onInstallerResult(int resultCode) {
        if (!ready) return;
        if (awaitingPermission) {
            awaitingPermission = false;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    && !context.getPackageManager().canRequestPackageInstalls()) {
                emit(activeRequestId, "error", "install-permission-denied");
                return;
            }
            launchInstaller();
            return;
        }
        if (awaitingInstaller) {
            awaitingInstaller = false;
            if (resultCode == Activity.RESULT_OK) {
                emit(activeRequestId, "error", "installer-restarted-app");
            } else {
                emit(activeRequestId, "error", "install-cancelled");
            }
        }
    }

    private void launchInstaller() {
        if (!ready || !apkFile.isFile()) {
            emit(activeRequestId, "error", "update-not-ready");
            return;
        }
        Uri contentUri = Uri.parse("content://"
                + context.getPackageName() + UpdateFileProvider.AUTHORITY_SUFFIX
                + "/" + APK_NAME);
        Intent intent = new Intent(Intent.ACTION_INSTALL_PACKAGE);
        intent.setData(contentUri);
        intent.setFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, false);
        intent.putExtra(Intent.EXTRA_RETURN_RESULT, true);
        awaitingInstaller = true;
        mainHandler.post(() -> deliverer.launchInstaller(intent, REQ_UNKNOWN_SOURCES));
    }

    void destroy() {
        destroyed = true;
        cancelUpdate();
        pool.shutdownNow();
    }
}
