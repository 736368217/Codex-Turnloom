package com.codex.turnloom.app;

import android.Manifest;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * Native SAF attachment picker for the packaged WebView.
 *
 * <p>No storage permission or persistent URI grant is used: ACTION_OPEN_DOCUMENT
 * gives a transient, user-selected read grant. Bytes are read on a bounded
 * worker pool and returned as base64 data URLs through one exact callback per
 * request. Remote document metadata is quoted by the callback and never used
 * as JavaScript source, filesystem paths or log text.</p>
 */
final class AttachmentPicker {
    interface Deliverer {
        void deliverAttachments(String requestId, String resultJson);
    }

    interface Launcher {
        void launch(Intent intent, int requestCode);

        /** Ask the Activity for one runtime permission; the answer comes back via callback. */
        void requestPermission(String permission, int requestCode);
    }

    /** `<applicationId>.photofiles` — the camera app receives write access to one file through it. */
    static final String PHOTO_AUTHORITY_SUFFIX = ".photofiles";
    private static final int REQ_CAMERA_PERMISSION = 0x70a1;
    /** Long edge kept before JPEG encoding; 1600px is ~1.5 MB at q85 and keeps ARGB memory bounded. */
    private static final int MAX_PHOTO_EDGE = 1600;
    private static final int PHOTO_QUALITY = 85;

    private static final int BUFFER_BYTES = 8192;

    private final Context context;
    private final Launcher launcher;
    private final Deliverer deliverer;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService pool = Executors.newSingleThreadExecutor();
    /** Ownership and worker handles are touched only on the UI thread. */
    private final AttachmentPickSession session = new AttachmentPickSession();
    private Future<?> activeRead;
    /** One camera request may be waiting on the system permission dialog. */
    private String pendingCameraRequestId;
    /** Output file handed to the camera app for the in-flight capture. */
    private File pendingPhotoFile;
    private volatile boolean destroyed = false;

    AttachmentPicker(Context context, Launcher launcher, Deliverer deliverer) {
        this.context = context.getApplicationContext();
        this.launcher = launcher;
        this.deliverer = deliverer;
    }

    /** JavascriptInterface methods run on a WebView bridge thread, never the UI thread. */
    void beginPick(String requestId, String kind) {
        if (destroyed) {
            if (BridgeContract.validRequestId(requestId)) deliverer.deliverAttachments(requestId,
                    BridgeContract.attachmentErrorJson(BridgeContract.ATTACH_PICKER_UNAVAILABLE));
            return;
        }
        if (!BridgeContract.validRequestId(requestId)) {
            deliverer.deliverAttachments("", BridgeContract.attachmentErrorJson(
                    BridgeContract.ATTACH_INVALID_REQUEST));
            return;
        }
        if (!BridgeContract.validAttachmentKind(kind)) {
            deliverer.deliverAttachments(requestId, BridgeContract.attachmentErrorJson(
                    BridgeContract.ATTACH_INVALID_KIND));
            return;
        }
        mainHandler.post(() -> startPicker(requestId, kind));
    }

    /** Launch the system document picker on the UI thread. */
    private void startPicker(String requestId, String kind) {
        if (destroyed) {
            deliverer.deliverAttachments(requestId, BridgeContract.attachmentErrorJson(
                    BridgeContract.ATTACH_PICKER_UNAVAILABLE));
            return;
        }
        if (session.busy()) {
            deliverer.deliverAttachments(requestId, BridgeContract.attachmentErrorJson(
                    BridgeContract.ATTACH_PICKER_BUSY));
            return;
        }
        if (BridgeContract.ATTACH_KIND_CAMERA.equals(kind)) {
            startCamera(requestId);
            return;
        }
        // 「图片」走系统相册（Android 13+ 用系统照片选择器，旧版本用 GET_CONTENT image/*），
        // 「附件」才走文档选择器。旧实现两个按钮都用 ACTION_OPEN_DOCUMENT，用户在真机上
        // 看到的是同一个文件管理器，选图片要多点三层。
        Intent intent;
        if ("image".equals(kind) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent = new Intent(MediaStore.ACTION_PICK_IMAGES);
            intent.setType("image/*");
            intent.putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX,
                Math.min(BridgeContract.MAX_ATTACHMENT_FILES, 10));
        } else if ("image".equals(kind)) {
            intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("image/*");
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        } else {
            intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        }
        AttachmentPickSession.Request request = session.begin(requestId, kind);
        if (request == null) {
            deliverer.deliverAttachments(requestId, BridgeContract.attachmentErrorJson(
                    BridgeContract.ATTACH_PICKER_UNAVAILABLE));
            return;
        }
        try {
            launcher.launch(intent, request.code);
        } catch (Exception e) {
            // 部分车机/精简 ROM 没有系统照片选择器：退回文档选择器，别让用户点不动。
            if ("image".equals(kind) && !(e instanceof SecurityException)) {
                Intent fallback = new Intent(Intent.ACTION_GET_CONTENT);
                fallback.addCategory(Intent.CATEGORY_OPENABLE);
                fallback.setType("image/*");
                fallback.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    launcher.launch(fallback, request.code);
                    return;
                } catch (Exception ignored) {
                    // 落到下面的统一错误回包
                }
            }
            // Never propagate activity/URI details to JS or logs.
            session.finish(request);
            deliverer.deliverAttachments(requestId, BridgeContract.attachmentErrorJson(
                e instanceof SecurityException ? "permission-denied"
                    : BridgeContract.ATTACH_PICKER_UNAVAILABLE));
        }
    }

    /** Consume the picker result on the UI thread; read bytes on a worker. */
    void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (destroyed) return;
        AttachmentPickSession.Request request = session.acceptResult(requestCode);
        if (request == null) return;
        String requestId = request.id;
        if (BridgeContract.ATTACH_KIND_CAMERA.equals(request.kind)) {
            handleCameraResult(request, resultCode);
            return;
        }
        if (resultCode != android.app.Activity.RESULT_OK) {
            session.finish(request);
            deliverer.deliverAttachments(requestId,
                    BridgeContract.attachmentsResultJson("cancelled", null, null));
            return;
        }
        List<Uri> uris = selectedUris(data);
        if (uris == null || uris.isEmpty()) {
            session.finish(request);
            deliverer.deliverAttachments(requestId,
                    BridgeContract.attachmentsResultJson("cancelled", null, null));
            return;
        }
        if (uris.size() > BridgeContract.MAX_ATTACHMENT_FILES) {
            session.finish(request);
            deliverer.deliverAttachments(requestId, BridgeContract.attachmentErrorJson(
                    BridgeContract.ATTACH_TOO_MANY_FILES));
            return;
        }
        activeRead = pool.submit(() -> readAttachments(request, uris));
    }

    // ---- camera capture -------------------------------------------------

    private boolean hasCameraPermission() {
        return context.checkSelfPermission(Manifest.permission.CAMERA)
                == PackageManager.PERMISSION_GRANTED;
    }

    /** Ask for CAMERA first; the capture starts from onRequestPermissionsResult. */
    private void startCamera(String requestId) {
        if (hasCameraPermission()) {
            beginCapture(requestId);
            return;
        }
        if (pendingCameraRequestId != null) {
            deliverer.deliverAttachments(requestId, BridgeContract.attachmentErrorJson(
                    BridgeContract.ATTACH_PICKER_BUSY));
            return;
        }
        pendingCameraRequestId = requestId;
        try {
            launcher.requestPermission(Manifest.permission.CAMERA, REQ_CAMERA_PERMISSION);
        } catch (RuntimeException e) {
            pendingCameraRequestId = null;
            deliverer.deliverAttachments(requestId, BridgeContract.attachmentErrorJson(
                    BridgeContract.ATTACH_CAMERA_PERMISSION_DENIED));
        }
    }

    /** Called from the Activity once the CAMERA prompt is answered. */
    void onRequestPermissionsResult(int requestCode, int[] grantResults) {
        if (requestCode != REQ_CAMERA_PERMISSION || destroyed) return;
        String requestId = pendingCameraRequestId;
        pendingCameraRequestId = null;
        if (requestId == null) return;
        boolean granted = grantResults != null && grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (!granted) {
            deliverer.deliverAttachments(requestId, BridgeContract.attachmentErrorJson(
                    BridgeContract.ATTACH_CAMERA_PERMISSION_DENIED));
            return;
        }
        beginCapture(requestId);
    }

    private void beginCapture(String requestId) {
        if (destroyed) {
            deliverer.deliverAttachments(requestId, BridgeContract.attachmentErrorJson(
                    BridgeContract.ATTACH_PICKER_UNAVAILABLE));
            return;
        }
        AttachmentPickSession.Request request =
                session.begin(requestId, BridgeContract.ATTACH_KIND_CAMERA);
        if (request == null) {
            deliverer.deliverAttachments(requestId, BridgeContract.attachmentErrorJson(
                    BridgeContract.ATTACH_PICKER_UNAVAILABLE));
            return;
        }
        Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        if (intent.resolveActivity(context.getPackageManager()) == null) {
            session.finish(request);
            deliverer.deliverAttachments(requestId, BridgeContract.attachmentErrorJson(
                    BridgeContract.ATTACH_CAMERA_UNAVAILABLE));
            return;
        }
        final File photo;
        try {
            File dir = new File(context.getCacheDir(), "photos");
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("photo-dir");
            photo = new File(dir, "IMG_" + System.currentTimeMillis() + ".jpg");
        } catch (RuntimeException | IOException e) {
            session.finish(request);
            deliverer.deliverAttachments(requestId, BridgeContract.attachmentErrorJson(
                    BridgeContract.ATTACH_READ_FAILED));
            return;
        }
        try {
            // The camera app writes through this single-file grant; nothing else is exposed.
            Uri output = FileProvider.getUriForFile(context,
                    context.getPackageName() + PHOTO_AUTHORITY_SUFFIX, photo);
            intent.putExtra(MediaStore.EXTRA_OUTPUT, output);
            intent.setClipData(ClipData.newRawUri("photo", output));
            intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            pendingPhotoFile = photo;
            launcher.launch(intent, request.code);
        } catch (Exception e) {
            pendingPhotoFile = null;
            deleteQuietly(photo);
            session.finish(request);
            deliverer.deliverAttachments(requestId, BridgeContract.attachmentErrorJson(
                    BridgeContract.ATTACH_CAMERA_UNAVAILABLE));
        }
    }

    private void handleCameraResult(AttachmentPickSession.Request request, int resultCode) {
        File photo = pendingPhotoFile;
        pendingPhotoFile = null;
        if (resultCode != android.app.Activity.RESULT_OK
                || photo == null || !photo.isFile() || photo.length() == 0) {
            deleteQuietly(photo);
            session.finish(request);
            deliverer.deliverAttachments(request.id,
                    BridgeContract.attachmentsResultJson("cancelled", null, null));
            return;
        }
        activeRead = pool.submit(() -> readCapturedPhoto(request, photo));
    }

    private void readCapturedPhoto(AttachmentPickSession.Request request, File photo) {
        String result;
        try {
            byte[] bytes = compressPhoto(photo);
            JSONArray items = new JSONArray();
            items.put(new JSONObject(BridgeContract.attachmentItemJson(
                    photo.getName(), "image/jpeg", bytes.length,
                    "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP))));
            result = BridgeContract.attachmentsResultJson("success", items, null);
        } catch (PickerException e) {
            result = BridgeContract.attachmentErrorJson(e.code);
        } catch (Exception e) {
            result = BridgeContract.attachmentErrorJson(BridgeContract.ATTACH_READ_FAILED);
        } finally {
            deleteQuietly(photo);
        }
        if (Thread.currentThread().isInterrupted() || destroyed) return;
        final String payload = result;
        mainHandler.post(() -> {
            if (!destroyed && session.finish(request)) {
                activeRead = null;
                deliverer.deliverAttachments(request.id, payload);
            }
        });
    }

    /** Decode with a bounded sample size, then re-encode JPEG under the attachment cap. */
    private static byte[] compressPhoto(File photo) throws PickerException {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(photo.getAbsolutePath(), bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) fail(BridgeContract.ATTACH_READ_FAILED);
        int sample = 1;
        int longest = Math.max(bounds.outWidth, bounds.outHeight);
        while (longest / (sample * 2) >= MAX_PHOTO_EDGE) sample *= 2;
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        Bitmap bitmap = BitmapFactory.decodeFile(photo.getAbsolutePath(), options);
        if (bitmap == null) fail(BridgeContract.ATTACH_READ_FAILED);
        try {
            Bitmap scaled = bitmap;
            int width = bitmap.getWidth();
            int height = bitmap.getHeight();
            if (Math.max(width, height) > MAX_PHOTO_EDGE) {
                float ratio = (float) MAX_PHOTO_EDGE / Math.max(width, height);
                scaled = Bitmap.createScaledBitmap(bitmap,
                        Math.max(1, Math.round(width * ratio)),
                        Math.max(1, Math.round(height * ratio)), true);
            }
            try {
                byte[] bytes = encodeJpeg(scaled, PHOTO_QUALITY);
                if (bytes.length > BridgeContract.MAX_ATTACHMENT_FILE_BYTES) {
                    bytes = encodeJpeg(scaled, 60);
                }
                if (bytes.length > BridgeContract.MAX_ATTACHMENT_FILE_BYTES) {
                    fail(BridgeContract.ATTACH_FILE_TOO_LARGE);
                }
                return bytes;
            } finally {
                if (scaled != bitmap) scaled.recycle();
            }
        } finally {
            bitmap.recycle();
        }
    }

    private static byte[] encodeJpeg(Bitmap bitmap, int quality) throws PickerException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(BUFFER_BYTES);
        if (!bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)) {
            fail(BridgeContract.ATTACH_READ_FAILED);
        }
        return out.toByteArray();
    }

    private static void deleteQuietly(File file) {
        if (file == null) return;
        try {
            file.delete();
        } catch (RuntimeException ignored) {
            // A leftover cache file is not worth failing the request over.
        }
    }

    private static List<Uri> selectedUris(Intent data) {
        if (data == null) return null;
        Uri single = data.getData();
        android.content.ClipData clip = data.getClipData();
        if (clip == null) {
            return single == null ? null : java.util.Collections.singletonList(single);
        }
        List<Uri> uris = new ArrayList<>();
        for (int i = 0; i < clip.getItemCount(); i++) {
            Uri uri = clip.getItemAt(i).getUri();
            if (uri != null) uris.add(uri);
        }
        if (uris.isEmpty() && single != null) uris.add(single);
        return uris;
    }

    private void readAttachments(AttachmentPickSession.Request request, List<Uri> uris) {
        String result;
        try {
            result = BridgeContract.attachmentsResultJson("success", readAll(request.kind, uris), null);
        } catch (PickerException e) {
            result = BridgeContract.attachmentErrorJson(e.code);
        } catch (SecurityException e) {
            result = BridgeContract.attachmentErrorJson("permission-denied");
        } catch (Exception e) {
            // Never expose an exception message: it may contain a content URI.
            result = BridgeContract.attachmentErrorJson(BridgeContract.ATTACH_READ_FAILED);
        }
        if (Thread.currentThread().isInterrupted() || destroyed) return;
        final String payload = result;
        mainHandler.post(() -> {
            if (!destroyed && session.finish(request)) {
                activeRead = null;
                deliverer.deliverAttachments(request.id, payload);
            }
        });
    }

    private JSONArray readAll(String kind, List<Uri> uris) throws PickerException {
        ContentResolver resolver = context.getContentResolver();
        if (resolver == null) fail(BridgeContract.ATTACH_READ_FAILED);
        JSONArray items = new JSONArray();
        long total = 0;
        for (Uri uri : uris) {
            if (Thread.currentThread().isInterrupted()) fail(BridgeContract.ATTACH_READ_FAILED);
            String mimeType = mimeTypeOf(resolver.getType(uri));
            if ("image".equals(kind) && !mimeType.startsWith("image/")) {
                fail(BridgeContract.ATTACH_INVALID_MIME);
            }
            byte[] bytes = readBounded(resolver, uri,
                    BridgeContract.MAX_ATTACHMENT_TOTAL_BYTES - total);
            total += bytes.length;
            try {
                items.put(new JSONObject(BridgeContract.attachmentItemJson(
                        displayName(resolver, uri), mimeType, bytes.length,
                        "data:" + mimeType + ";base64,"
                                + Base64.encodeToString(bytes, Base64.NO_WRAP))));
            } catch (JSONException | BridgeContract.ValidationException e) {
                fail(BridgeContract.ATTACH_READ_FAILED);
            }
        }
        if (total > BridgeContract.MAX_ATTACHMENT_TOTAL_BYTES) {
            fail(BridgeContract.ATTACH_TOTAL_TOO_LARGE);
        }
        return items;
    }

    /** Read at most limit+1 bytes; reject oversized files without buffering them. */
    private static byte[] readBounded(ContentResolver resolver, Uri uri, long remaining)
            throws PickerException {
        long limit = Math.min(BridgeContract.MAX_ATTACHMENT_FILE_BYTES,
                Math.max(0, remaining));
        try (InputStream in = resolver.openInputStream(uri)) {
            if (in == null) fail(BridgeContract.ATTACH_READ_FAILED);
            ByteArrayOutputStream out = new ByteArrayOutputStream(BUFFER_BYTES);
            byte[] buffer = new byte[BUFFER_BYTES];
            long total = 0;
            int n;
            while ((n = in.read(buffer)) != -1) {
                if (Thread.currentThread().isInterrupted()) {
                    fail(BridgeContract.ATTACH_READ_FAILED);
                }
                total += n;
                if (total > limit) fail(limit < BridgeContract.MAX_ATTACHMENT_FILE_BYTES
                        ? BridgeContract.ATTACH_TOTAL_TOO_LARGE
                        : BridgeContract.ATTACH_FILE_TOO_LARGE);
                out.write(buffer, 0, n);
            }
            if (total > BridgeContract.MAX_ATTACHMENT_FILE_BYTES) {
                fail(BridgeContract.ATTACH_FILE_TOO_LARGE);
            }
            return out.toByteArray();
        } catch (SecurityException e) {
            fail("permission-denied");
            return null;
        } catch (IOException | RuntimeException e) {
            fail(BridgeContract.ATTACH_READ_FAILED);
            return null;
        }
    }

    private static String displayName(ContentResolver resolver, Uri uri) {
        Cursor cursor = null;
        try {
            cursor = resolver.query(uri, new String[]{OpenableColumns.DISPLAY_NAME},
                    null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    String name = cursor.getString(index);
                    if (name != null) return name;
                }
            }
        } catch (RuntimeException ignored) {
            // A failed metadata query is not a failed byte read.
        } finally {
            if (cursor != null) {
                try { cursor.close(); } catch (RuntimeException ignored) { }
            }
        }
        return "attachment";
    }

    private static String mimeTypeOf(String value) throws PickerException {
        try {
            return BridgeContract.safeAttachmentMimeType(value);
        } catch (BridgeContract.ValidationException e) {
            fail(BridgeContract.ATTACH_INVALID_MIME);
            return null;
        }
    }

    private static void fail(String code) throws PickerException {
        throw new PickerException(code);
    }

    void cancel(String requestId) {
        if (!BridgeContract.validRequestId(requestId)) return;
        mainHandler.post(() -> {
            if (session.cancel(requestId) && activeRead != null) {
                activeRead.cancel(true);
                activeRead = null;
            }
        });
    }

    void destroy() {
        destroyed = true;
        session.close();
        if (activeRead != null) {
            activeRead.cancel(true);
            activeRead = null;
        }
        pool.shutdownNow();
    }

    private static final class PickerException extends Exception {
        final String code;

        PickerException(String code) {
            super(code);
            this.code = code;
        }
    }
}
