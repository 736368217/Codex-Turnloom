package com.codexpocket.mobile;

import java.net.URI;

final class DeviceOrigin {
    private DeviceOrigin() {
    }

    static boolean matches(String deviceUrl, String pageUrl) {
        try {
            URI device = URI.create(deviceUrl);
            URI page = URI.create(pageUrl);
            return equalIgnoreCase(device.getScheme(), page.getScheme())
                    && equalIgnoreCase(device.getHost(), page.getHost())
                    && effectivePort(device) == effectivePort(page);
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }

    private static boolean equalIgnoreCase(String left, String right) {
        return left != null && right != null && left.equalsIgnoreCase(right);
    }

    private static int effectivePort(URI uri) {
        if (uri.getPort() >= 0) return uri.getPort();
        if ("http".equalsIgnoreCase(uri.getScheme())) return 80;
        if ("https".equalsIgnoreCase(uri.getScheme())) return 443;
        return -1;
    }
}
