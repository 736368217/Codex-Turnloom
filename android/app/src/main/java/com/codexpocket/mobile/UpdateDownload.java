package com.codexpocket.mobile;

import java.net.URLEncoder;

/** Pure helpers for the in-app APK updater; kept free of Android framework types so JVM tests can cover them. */
public final class UpdateDownload {
    private static final long MIN_APK_BYTES = 100_000L;

    private UpdateDownload() {}

    /**
     * Append the access code as a query parameter as well as the x-access-token header.
     * Reverse proxies and redirects can drop custom headers, but the query survives.
     */
    public static String downloadUrl(String url, String token) {
        if (url == null || token == null || token.isBlank() || url.contains("token=")) return url;
        int hash = url.indexOf('#');
        String base = hash >= 0 ? url.substring(0, hash) : url;
        String fragment = hash >= 0 ? url.substring(hash) : "";
        String separator = base.contains("?") ? "&" : "?";
        String encoded;
        try {
            encoded = URLEncoder.encode(token, "UTF-8");
        } catch (Exception ignored) {
            encoded = token;
        }
        return base + separator + "token=" + encoded + fragment;
    }

    /** APK files are ZIP archives; a 200 response containing an HTML login page must not be installed. */
    public static boolean hasApkMagic(byte[] header) {
        return header != null && header.length >= 2 && header[0] == 'P' && header[1] == 'K';
    }

    /** Return a human-readable size mismatch, or null when the download is usable. */
    public static String sizeProblem(long total, long expected) {
        if (total < MIN_APK_BYTES) return "下载内容不完整（" + total + " bytes）";
        if (expected > 0L && total != expected) return "下载长度不一致（" + total + "/" + expected + "）";
        return null;
    }
}
