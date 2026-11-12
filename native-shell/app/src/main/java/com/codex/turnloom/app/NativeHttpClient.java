package com.codex.turnloom.app;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * Asynchronous, bounded native HTTP executor for the WebView bridge.
 *
 * <p>The WebView page is a packaged file:// document and cannot use fetch() to
 * reach the paired server. This executor performs the request with
 * HttpURLConnection, returning exactly one JSON result per request id. Tokens
 * are set as headers only, never interpolated into URLs, callbacks or logs.</p>
 */
final class NativeHttpClient {
    interface Deliverer {
        void deliverHttp(String requestId, String responseJson);
    }

    private final Context context;
    private final Deliverer deliverer;
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ConcurrentHashMap<String, Future<?>> active = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, HttpURLConnection> connections = new ConcurrentHashMap<>();
    private volatile boolean destroyed = false;

    NativeHttpClient(Context context, Deliverer deliverer) {
        this.context = context.getApplicationContext();
        this.deliverer = deliverer;
    }

    /** Submit one request; validation errors are returned through the same callback. */
    void request(String requestId, String requestJson) {
        if (destroyed) return;
        if (!BridgeContract.validRequestId(requestId)) {
            deliverer.deliverHttp("", BridgeContract.httpErrorJson("INVALID_REQUEST_ID"));
            return;
        }
        final BridgeContract.HttpRequest req;
        try {
            req = BridgeContract.parseHttpRequest(requestJson);
            NativeHttpPolicy.assertPermitted(context, req.origin, "api");
        } catch (BridgeContract.ValidationException e) {
            deliverer.deliverHttp(requestId, BridgeContract.httpErrorJson(e.getMessage()));
            return;
        }
        synchronized (active) {
            if (destroyed) return;
            Future<?> previous = active.remove(requestId);
            if (previous != null) previous.cancel(true);
            Future<?> future = pool.submit(() -> runRequest(requestId, req));
            active.put(requestId, future);
        }
    }

    void cancelRequest(String requestId) {
        if (!BridgeContract.validRequestId(requestId)) return;
        Future<?> f = active.remove(requestId);
        if (f != null) f.cancel(true);
        HttpURLConnection conn = connections.remove(requestId);
        if (conn != null) pool.execute(conn::disconnect);
        // No result is delivered on cancellation. Frontend generation guards
        // discard any late callback from an already obsolete request.
    }

    void destroy() {
        destroyed = true;
        synchronized (active) {
            for (Future<?> f : active.values()) f.cancel(true);
            active.clear();
        }
        for (HttpURLConnection conn : connections.values()) conn.disconnect();
        connections.clear();
        pool.shutdownNow();
    }

    private void runRequest(String requestId, BridgeContract.HttpRequest req) {
        String result;
        try {
            result = execute(requestId, req);
        } catch (BridgeContract.ValidationException e) {
            result = BridgeContract.httpErrorJson(e.getMessage());
        } catch (Exception e) {
            // Never put exception.toString() (which may include a URL/query) in a callback.
            result = BridgeContract.httpErrorJson(getSafeErrorCode(e));
        } finally {
            active.remove(requestId);
            connections.remove(requestId);
        }
        if (Thread.currentThread().isInterrupted() || destroyed) return;
        final String payload = result;
        mainHandler.post(() -> {
            if (!destroyed) deliverer.deliverHttp(requestId, payload);
        });
    }

    private static String getSafeErrorCode(Exception e) {
        if (e instanceof java.net.SocketTimeoutException) return "TIMEOUT";
        if (e instanceof java.net.UnknownHostException) return "UNREACHABLE";
        if (e instanceof java.net.ConnectException) return "UNREACHABLE";
        if (e instanceof javax.net.ssl.SSLException) return "TLS_ERROR";
        if (e instanceof java.io.IOException) return "NETWORK_ERROR";
        return "ERROR";
    }

    /** Follow only same-origin /api/ redirects, with fresh connections. */
    private String execute(String requestId, BridgeContract.HttpRequest req)
            throws BridgeContract.ValidationException, IOException {
        URL current = req.url;
        for (int redirects = 0; redirects <= 3; redirects++) {
            if (Thread.currentThread().isInterrupted()) throw new IOException("cancelled");
            HttpURLConnection conn = (HttpURLConnection) current.openConnection();
            connections.put(requestId, conn);
            try {
                NativeHttpPolicy.configure(conn, req, null);
                conn.setRequestMethod(req.method);
                if (req.body != null) {
                    conn.setDoOutput(true);
                    conn.setFixedLengthStreamingMode(req.body.length);
                    try (OutputStream out = conn.getOutputStream()) {
                        out.write(req.body);
                    }
                }
                int status = conn.getResponseCode();
                if (status == 301 || status == 302 || status == 303
                        || status == 307 || status == 308) {
                    URL next = NativeHttpPolicy.sameOriginRedirect(conn, req.origin, redirects);
                    current = next;
                    continue;
                }
                byte[] body = readBounded(status >= 400 ? conn.getErrorStream() : conn.getInputStream());
                return responseJson(status, body, null);
            } finally {
                conn.disconnect();
            }
        }
        throw new BridgeContract.ValidationException("TOO_MANY_REDIRECTS");
    }

    static byte[] readBounded(InputStream in) throws IOException {
        if (in == null) return new byte[0];
        try (InputStream stream = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream(8192);
            byte[] buffer = new byte[8192];
            long total = 0;
            int n;
            while ((n = stream.read(buffer)) != -1) {
                total += n;
                if (total > BridgeContract.MAX_HTTP_RESPONSE_BYTES) {
                    throw new IOException("response too large");
                }
                if (Thread.currentThread().isInterrupted()) throw new IOException("cancelled");
                out.write(buffer, 0, n);
            }
            return out.toByteArray();
        }
    }

    static String responseJson(int status, byte[] body, String error) {
        try {
            JSONObject o = new JSONObject();
            o.put("status", status);
            o.put("body", new String(body == null ? new byte[0] : body, StandardCharsets.UTF_8));
            if (error != null) o.put("error", error);
            return o.toString();
        } catch (Exception e) {
            return BridgeContract.httpErrorJson("ERROR");
        }
    }
}
