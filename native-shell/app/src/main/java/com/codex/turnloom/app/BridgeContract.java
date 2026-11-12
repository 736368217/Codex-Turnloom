package com.codex.turnloom.app;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

import org.json.JSONException;
import org.json.JSONObject;

/** Pure parsing / validation for native HTTP and update bridges (no Android API). */
final class BridgeContract {
    static final long MAX_HTTP_BODY_BYTES = 2L * 1024 * 1024;
    static final long MAX_HTTP_RESPONSE_BYTES = 4L * 1024 * 1024;
    static final int MAX_TIMEOUT_MS = 60_000;
    static final int DEFAULT_TIMEOUT_MS = 8_000;
    static final long MAX_APK_BYTES = 512L * 1024 * 1024;
    static final long MIN_APK_BYTES = 64L * 1024;
    static final int MAX_HEADER_COUNT = 32;
    static final int MAX_HEADER_NAME_BYTES = 128;
    static final int MAX_HEADER_VALUE_BYTES = 4096;
    static final long MAX_REQUEST_BODY_BYTES = 1024L * 1024;
    static final String APP_PACKAGE = "com.codex.turnloom.app";

    static final class Origin {
        final String scheme;
        final String host;
        final int port;
        final String authority;

        Origin(String scheme, String host, int port, String authority) {
            this.scheme = scheme;
            this.host = host;
            this.port = port;
            this.authority = authority;
        }

        @Override
        public boolean equals(Object other) {
            if (!(other instanceof Origin)) return false;
            Origin o = (Origin) other;
            return scheme.equals(o.scheme) && host.equals(o.host) && port == o.port;
        }

        @Override
        public int hashCode() {
            return (scheme + host + port).hashCode();
        }
    }

    static final class HttpRequest {
        final java.net.URL url;
        final Origin origin;
        final String method;
        final Map<String, String> headers;
        final byte[] body;
        final int timeoutMs;

        HttpRequest(java.net.URL url, Origin origin, String method,
                Map<String, String> headers, byte[] body, int timeoutMs) {
            this.url = url;
            this.origin = origin;
            this.method = method;
            this.headers = headers;
            this.body = body;
            this.timeoutMs = timeoutMs;
        }
    }

    static final class UpdateRequest {
        final java.net.URL url;
        final Origin origin;
        final String token;
        final String sha256;
        final long versionCode;
        final String packageName;

        UpdateRequest(java.net.URL url, Origin origin, String token, String sha256,
                long versionCode, String packageName) {
            this.url = url;
            this.origin = origin;
            this.token = token;
            this.sha256 = sha256;
            this.versionCode = versionCode;
            this.packageName = packageName;
        }
    }

    static final class ValidationException extends Exception {
        ValidationException(String message) {
            super(message);
        }
    }

    private BridgeContract() {
    }

    static boolean hasControlChars(String value) {
        if (value == null) return false;
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c < 0x20 || c == 0x7f) return true;
        }
        return false;
    }

    static boolean isBareHost(String host) {
        if (host == null || host.isEmpty() || host.length() > 253) return false;
        if (host.startsWith("[") && host.endsWith("]")) {
            String inner = host.substring(1, host.length() - 1).toLowerCase(Locale.ROOT);
            return inner.matches("[0-9a-f:]+") && inner.contains(":");
        }
        if (host.contains(":") || host.startsWith("-") || host.endsWith("-")
                || host.startsWith(".") || host.endsWith(".")) return false;
        String[] labels = host.split("\\.", -1);
        for (String label : labels) {
            if (label.isEmpty() || label.length() > 63
                    || !label.matches("[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?")) {
                return false;
            }
        }
        return host.contains(".") || host.equalsIgnoreCase("localhost");
    }

    static boolean isPrivateLanHost(String host) {
        if (host == null) return false;
        String h = host.toLowerCase(Locale.ROOT);
        if (h.equals("localhost") || h.equals("127.0.0.1") || h.equals("::1")
                || h.equals("[::1]") || h.equals("10.0.2.2")) return true;
        if (h.startsWith("127.") || h.endsWith(".localhost")) return true;
        String[] parts = h.split("\\.", -1);
        if (parts.length != 4) return false;
        int[] octets = new int[4];
        for (int i = 0; i < 4; i++) {
            if (!parts[i].matches("\\d{1,3}")) return false;
            try {
                octets[i] = Integer.parseInt(parts[i]);
            } catch (NumberFormatException e) {
                return false;
            }
            if (octets[i] > 255) return false;
        }
        if (octets[0] == 10) return true;
        if (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31) return true;
        if (octets[0] == 192 && octets[1] == 168) return true;
        return octets[0] == 169 && octets[1] == 254;
    }

    /**
     * Absolute http(s) URL, no userinfo/fragment, canonical /api/* path and no
     * percent-encoded path tricks. Public HTTPS is allowed; plain HTTP is
     * restricted to private LAN hosts and additionally requires an explicit
     * pairing record checked by NativeHttpPolicy.
     */
    static Origin validateApiUrl(String raw, boolean allowHttpsPublic)
            throws ValidationException {
        if (raw == null || raw.isEmpty() || raw.length() > 4096 || hasControlChars(raw)) {
            throw new ValidationException("INVALID_URL");
        }
        try {
            URI uri = new URI(raw);
            if (!uri.isAbsolute() || uri.getRawUserInfo() != null || uri.getRawFragment() != null
                    || uri.isOpaque() || uri.getHost() == null) {
                throw new ValidationException("INVALID_URL");
            }
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            if (!scheme.equals("http") && !scheme.equals("https")) {
                throw new ValidationException("INVALID_SCHEME");
            }
            String path = uri.getRawPath();
            if (path == null || !path.startsWith("/api/")
                    || path.length() < 6 || path.contains("..") || path.contains("\\")
                    || path.contains("//") || path.contains("%")) {
                throw new ValidationException("INVALID_PATH");
            }
            int port = uri.getPort();
            if (port < -1 || port == 0 || port > 65535) {
                throw new ValidationException("INVALID_PORT");
            }
            String host = uri.getHost();
            if (!isBareHost(host)) throw new ValidationException("INVALID_HOST");
            String query = uri.getRawQuery();
            if (query != null && (hasControlChars(query)
                    || query.toLowerCase(Locale.ROOT).contains("token"))) {
                throw new ValidationException("INVALID_QUERY");
            }
            if (scheme.equals("http") && !isPrivateLanHost(host)) {
                throw new ValidationException("HTTP_ORIGIN_NOT_PAIRED");
            }
            if (scheme.equals("https") && !allowHttpsPublic && !isPrivateLanHost(host)) {
                throw new ValidationException("HTTPS_ORIGIN_NOT_ALLOWED");
            }
            java.net.URL url = uri.toURL();
            int effectivePort = port == -1 ? url.getDefaultPort() : port;
            String authority = host + (port == -1 ? "" : ":" + port);
            return new Origin(scheme, host.toLowerCase(Locale.ROOT), effectivePort, authority);
        } catch (ValidationException e) {
            throw e;
        } catch (Exception e) {
            throw new ValidationException("INVALID_URL");
        }
    }

    static boolean isCanonicalHexSha256(String value) {
        return value != null && value.matches("[a-fA-F0-9]{64}");
    }

    static Map<String, String> parseHeaders(JSONObject raw) throws ValidationException {
        Map<String, String> out = new HashMap<>();
        if (raw == null || raw == JSONObject.NULL) return out;
        if (raw.length() > MAX_HEADER_COUNT) throw new ValidationException("TOO_MANY_HEADERS");
        java.util.Iterator<String> keys = raw.keys();
        while (keys.hasNext()) {
            String name = keys.next();
            if (name == null || name.isEmpty() || name.length() > MAX_HEADER_NAME_BYTES
                    || !name.matches("[A-Za-z0-9!#$%&'*+.^_`|~-]+") || hasControlChars(name)) {
                throw new ValidationException("INVALID_HEADER_NAME");
            }
            String lower = name.toLowerCase(Locale.ROOT);
            if (lower.equals("host") || lower.equals("cookie") || lower.equals("set-cookie")
                    || lower.equals("accept-encoding") || lower.equals("transfer-encoding")
                    || lower.equals("connection") || lower.equals("proxy-authorization")
                    || lower.equals("content-length") || lower.equals("range")
                    || lower.startsWith("proxy-") || lower.startsWith("sec-")) {
                throw new ValidationException("FORBIDDEN_HEADER");
            }
            Object value = raw.opt(name);
            if (!(value instanceof String) || hasControlChars((String) value)
                    || ((String) value).length() > MAX_HEADER_VALUE_BYTES) {
                throw new ValidationException("INVALID_HEADER_VALUE");
            }
            if (out.put(name, (String) value) != null) {
                throw new ValidationException("DUPLICATE_HEADER");
            }
        }
        return out;
    }

    static HttpRequest parseHttpRequest(String requestJson) throws ValidationException {
        if (requestJson == null || requestJson.length() > MAX_HTTP_BODY_BYTES) {
            throw new ValidationException("INVALID_REQUEST_JSON");
        }
        try {
            JSONObject o = new JSONObject(requestJson);
            String rawUrl = o.optString("url", "");
            Origin origin = validateApiUrl(rawUrl, true);
            String method = o.optString("method", "GET");
            if (!method.equals("GET") && !method.equals("POST")) {
                throw new ValidationException("INVALID_METHOD");
            }
            Object headersRaw = o.opt("headers");
            if (headersRaw != null && !(headersRaw instanceof JSONObject)) {
                throw new ValidationException("INVALID_HEADERS");
            }
            Map<String, String> headers = parseHeaders(
                    headersRaw instanceof JSONObject ? (JSONObject) headersRaw : null);
            byte[] body = null;
            if (o.has("body") && o.get("body") != JSONObject.NULL) {
                Object rawBody = o.get("body");
                if (!(rawBody instanceof String)) throw new ValidationException("INVALID_BODY");
                body = ((String) rawBody).getBytes(StandardCharsets.UTF_8);
                if (body.length > MAX_REQUEST_BODY_BYTES) {
                    throw new ValidationException("BODY_TOO_LARGE");
                }
                if (!method.equals("POST")) throw new ValidationException("BODY_ON_GET");
            }
            int timeout = o.optInt("timeoutMs", DEFAULT_TIMEOUT_MS);
            if (timeout < 1000 || timeout > MAX_TIMEOUT_MS) {
                throw new ValidationException("INVALID_TIMEOUT");
            }
            return new HttpRequest(new java.net.URL(rawUrl), origin, method,
                    Collections.unmodifiableMap(headers), body, timeout);
        } catch (ValidationException e) {
            throw e;
        } catch (JSONException | java.net.MalformedURLException e) {
            throw new ValidationException("INVALID_REQUEST_JSON");
        }
    }

    static UpdateRequest parseUpdateRequest(String optionsJson) throws ValidationException {
        if (optionsJson == null || optionsJson.length() > 64 * 1024) {
            throw new ValidationException("INVALID_OPTIONS");
        }
        try {
            JSONObject o = new JSONObject(optionsJson);
            String rawUrl = o.optString("url", "");
            Origin origin = validateApiUrl(rawUrl, true);
            String token = o.optString("token", "");
            if (token.isEmpty() || token.length() > 256 || hasControlChars(token)) {
                throw new ValidationException("INVALID_TOKEN");
            }
            String sha = o.optString("sha256", "");
            if (!isCanonicalHexSha256(sha)) throw new ValidationException("INVALID_SHA256");
            long version = o.optLong("versionCode", -1);
            if (version < 1 || version > Integer.MAX_VALUE) {
                throw new ValidationException("INVALID_VERSION_CODE");
            }
            String pkg = o.optString("packageName", "");
            if (!pkg.equals(APP_PACKAGE)) throw new ValidationException("INVALID_PACKAGE_NAME");
            return new UpdateRequest(new java.net.URL(rawUrl), origin, token,
                    sha.toLowerCase(Locale.ROOT), version, pkg);
        } catch (ValidationException e) {
            throw e;
        } catch (JSONException | java.net.MalformedURLException e) {
            throw new ValidationException("INVALID_OPTIONS");
        }
    }

    static boolean validRequestId(String id) {
        return id != null && id.matches("[A-Za-z0-9._:-]{1,128}");
    }

    static String httpErrorJson(String error) {
        try {
            JSONObject o = new JSONObject();
            o.put("status", 0);
            o.put("body", "");
            o.put("error", error == null ? "ERROR" : error);
            return o.toString();
        } catch (JSONException e) {
            return "{\"status\":0,\"body\":\"\",\"error\":\"ERROR\"}";
        }
    }
}
