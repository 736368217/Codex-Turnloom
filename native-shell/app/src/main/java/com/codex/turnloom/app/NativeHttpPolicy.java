package com.codex.turnloom.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.security.NetworkSecurityPolicy;

import org.json.JSONObject;

import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Origin and transport policy for the native HTTP bridge.
 *
 * <p>HTTPS uses platform trust anchors. Plain HTTP is allowed only for a
 * manually paired private LAN origin and only when Android's network security
 * policy also permits cleartext for that host. WebView universal file access
 * is never enabled; all API traffic uses the native executor instead.</p>
 */
final class NativeHttpPolicy {
    private static final String PREFS = "turnloom_paired_origins_v1";
    private static final String KEY = "origins";
    private static final Set<String> authorizedOrigins = ConcurrentHashMap.newKeySet();
    private static volatile boolean loaded = false;

    private NativeHttpPolicy() {
    }

    static void initialize(Context context) {
        if (loaded) return;
        synchronized (NativeHttpPolicy.class) {
            if (loaded) return;
            try {
                SharedPreferences p = context.getApplicationContext()
                        .getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                String raw = p.getString(KEY, "[]");
                org.json.JSONArray a = new org.json.JSONArray(raw);
                for (int i = 0; i < a.length(); i++) {
                    String value = a.optString(i, "");
                    if (value.matches("https?://[a-zA-Z0-9.\\[\\]:-]+")) {
                        authorizedOrigins.add(value);
                    }
                }
            } catch (Exception ignored) {
                // Corrupt pairing state fails closed: no explicit LAN origin.
            }
            loaded = true;
        }
    }

    /** Explicitly pair a private LAN origin. Returns false for non-LAN URLs. */
    static boolean pairLanOrigin(Context context, String rawUrl) {
        try {
            BridgeContract.Origin origin = BridgeContract.validateApiUrl(rawUrl, true);
            if (!origin.scheme.equals("http") || !BridgeContract.isPrivateLanHost(origin.host)) {
                return false;
            }
            initialize(context);
            saveOrigins(context, origin.scheme + "://" + origin.authority, true);
            return true;
        } catch (BridgeContract.ValidationException e) {
            return false;
        }
    }

    static void forgetOrigin(Context context, String rawUrl) {
        try {
            BridgeContract.Origin origin = BridgeContract.validateApiUrl(rawUrl, true);
            initialize(context);
            saveOrigins(context, origin.scheme + "://" + origin.authority, false);
        } catch (BridgeContract.ValidationException ignored) {
            // No paired origin to remove.
        }
    }

    static void clearAllOrigins(Context context) {
        initialize(context);
        authorizedOrigins.clear();
        context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().remove(KEY).commit();
    }

    private static void saveOrigins(Context context, String key, boolean add) {
        synchronized (NativeHttpPolicy.class) {
            if (add) authorizedOrigins.add(key);
            else authorizedOrigins.remove(key);
            org.json.JSONArray a = new org.json.JSONArray();
            for (String value : authorizedOrigins) a.put(value);
            context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit().putString(KEY, a.toString()).commit();
        }
    }

    static boolean isExplicitlyPairedLan(BridgeContract.Origin origin) {
        return origin.scheme.equals("http")
                && authorizedOrigins.contains(origin.scheme + "://" + origin.authority)
                && BridgeContract.isPrivateLanHost(origin.host);
    }

    static void assertPermitted(Context context, BridgeContract.Origin origin, String purpose)
            throws BridgeContract.ValidationException {
        initialize(context);
        if (origin.scheme.equals("https")) return; // system CA validation by HttpsURLConnection
        if (!isExplicitlyPairedLan(origin)) {
            throw new BridgeContract.ValidationException("HTTP_ORIGIN_NOT_PAIRED");
        }
        if (!NetworkSecurityPolicy.getInstance().isCleartextTrafficPermitted(origin.host)) {
            throw new BridgeContract.ValidationException("CLEARTEXT_BLOCKED_BY_POLICY");
        }
    }

    /** Apply validated request fields to a freshly opened, same-origin connection. */
    static void configure(HttpURLConnection conn, BridgeContract.HttpRequest req,
            String tokenHeader) {
        conn.setInstanceFollowRedirects(false);
        conn.setConnectTimeout(req.timeoutMs);
        conn.setReadTimeout(req.timeoutMs);
        conn.setUseCaches(false);
        conn.setRequestProperty("Accept", "application/json");
        conn.setRequestProperty("Accept-Encoding", "identity");
        conn.setRequestProperty("User-Agent", "Codex-Turnloom/2.1.0");
        if (tokenHeader != null && !tokenHeader.isEmpty()) {
            conn.setRequestProperty("x-access-token", tokenHeader);
        }
        for (Map.Entry<String, String> h : req.headers.entrySet()) {
            conn.setRequestProperty(h.getKey(), h.getValue());
        }
    }

    /** Reject all cross-origin, non-/api/ and non-canonical redirect targets. */
    static URL sameOriginRedirect(HttpURLConnection conn, BridgeContract.Origin origin,
            int redirectCount) throws BridgeContract.ValidationException {
        if (redirectCount >= 3) throw new BridgeContract.ValidationException("TOO_MANY_REDIRECTS");
        String location = conn.getHeaderField("Location");
        if (location == null || location.isEmpty()) {
            throw new BridgeContract.ValidationException("INVALID_REDIRECT");
        }
        try {
            URL resolved = new URL(conn.getURL(), location);
            String canonical = resolved.toString();
            if (!canonical.equals(new URI(canonical).normalize().toString())) {
                throw new BridgeContract.ValidationException("INVALID_REDIRECT");
            }
            BridgeContract.Origin next = BridgeContract.validateApiUrl(canonical, true);
            if (!origin.equals(next)) {
                throw new BridgeContract.ValidationException("CROSS_ORIGIN_REDIRECT");
            }
            return resolved;
        } catch (BridgeContract.ValidationException e) {
            throw e;
        } catch (Exception e) {
            throw new BridgeContract.ValidationException("INVALID_REDIRECT");
        }
    }

    static JSONObject appCapabilities(PackageManager pm) {
        JSONObject o = new JSONObject();
        try {
            o.put("cameraAvailable", pm != null && pm.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY));
            o.put("updatesAvailable", true);
            o.put("nativeHttp", true);
            o.put("https", true);
            o.put("pairedLanCleartext", !authorizedOrigins.isEmpty());
        } catch (Exception ignored) {
            // Capability reporting must never break getAppInfo.
        }
        return o;
    }
}
