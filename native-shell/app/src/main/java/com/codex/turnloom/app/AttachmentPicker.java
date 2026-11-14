package com.codex.turnloom.app;

import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
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
    }

    private static final int BUFFER_BYTES = 8192;

    private final Context context;
    private final Launcher launcher;
    private final Deliverer deliverer;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService pool = Executors.newSingleThreadExecutor();
    /** Ownership and worker handles are touched only on the UI thread. */
    private final AttachmentPickSession session = new AttachmentPickSession();
    private Future<?> activeRead;
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
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image".equals(kind) ? "image/*" : "*/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        AttachmentPickSession.Request request = session.begin(requestId, kind);
        if (request == null) {
            deliverer.deliverAttachments(requestId, BridgeContract.attachmentErrorJson(
                    BridgeContract.ATTACH_PICKER_UNAVAILABLE));
            return;
        }
        try {
            launcher.launch(intent, request.code);
        } catch (Exception e) {
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
