package com.codexpocket.mobile;

/**
 * Two saved computers may share an origin and differ only by access code — that is
 * exactly what the dual-device dispatcher exists for. Anything that tracks per-computer
 * state (online pill, status cache, view tags) must therefore be keyed by origin *and*
 * access code; keying by origin alone made the second computer inherit the first one's
 * state and stay stuck on "正在检测".
 */
final class DeviceIdentity {
    private static final String SEPARATOR = "\u0000";

    private DeviceIdentity() {
    }

    static String key(String url, String token) {
        String safeUrl = url == null ? "" : url.trim();
        String safeToken = token == null ? "" : token;
        return safeUrl + SEPARATOR + safeToken;
    }
}
