package com.codexpocket.mobile;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class DownloadFileNames {
    private static final Pattern UTF8_NAME = Pattern.compile("(?i)filename\\*\\s*=\\s*(?:UTF-8'')?([^;]+)");
    private static final Pattern BASIC_NAME = Pattern.compile("(?i)filename\\s*=\\s*(?:\"([^\"]+)\"|([^;]+))");

    private DownloadFileNames() {}

    static String resolve(String url, String contentDisposition, String mimeType) {
        String name = queryParameter(url, "name");
        if (isBlank(name)) name = dispositionName(contentDisposition);
        if (isBlank(name)) name = pathName(url);
        if (isBlank(name) || "local-file".equalsIgnoreCase(name)) name = "download" + extensionForMime(mimeType);
        return sanitize(name);
    }

    private static String queryParameter(String url, String key) {
        try {
            String query = URI.create(url).getRawQuery();
            if (query == null) return null;
            for (String part : query.split("&")) {
                int separator = part.indexOf('=');
                String rawKey = separator >= 0 ? part.substring(0, separator) : part;
                if (key.equals(decode(rawKey))) return decode(separator >= 0 ? part.substring(separator + 1) : "");
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private static String dispositionName(String contentDisposition) {
        if (isBlank(contentDisposition)) return null;
        Matcher utf8 = UTF8_NAME.matcher(contentDisposition);
        if (utf8.find()) return decode(trimQuotes(utf8.group(1).trim()));
        Matcher basic = BASIC_NAME.matcher(contentDisposition);
        if (!basic.find()) return null;
        return trimQuotes((basic.group(1) != null ? basic.group(1) : basic.group(2)).trim());
    }

    private static String pathName(String url) {
        try {
            String path = URI.create(url).getPath();
            if (path == null || path.endsWith("/")) return null;
            return decode(path.substring(path.lastIndexOf('/') + 1));
        } catch (Exception ignored) {
            return null;
        }
    }

    private static String extensionForMime(String mimeType) {
        String normalized = mimeType == null ? "" : mimeType.toLowerCase(Locale.ROOT);
        if (normalized.contains("pdf")) return ".pdf";
        if (normalized.contains("json")) return ".json";
        if (normalized.startsWith("text/")) return ".txt";
        if (normalized.contains("spreadsheet") || normalized.contains("excel")) return ".xlsx";
        if (normalized.contains("wordprocessingml") || normalized.contains("msword")) return ".docx";
        if (normalized.startsWith("image/jpeg")) return ".jpg";
        if (normalized.startsWith("image/png")) return ".png";
        if (normalized.startsWith("image/webp")) return ".webp";
        return ".bin";
    }

    private static String sanitize(String value) {
        String result = value.replaceAll("[\\p{Cntrl}\\\\/:*?\"<>|]", "_").trim();
        return result.isEmpty() ? "download.bin" : result;
    }

    private static String trimQuotes(String value) {
        return value.length() >= 2 && value.startsWith("\"") && value.endsWith("\"")
                ? value.substring(1, value.length() - 1)
                : value;
    }

    private static String decode(String value) {
        try {
            return URLDecoder.decode(value, StandardCharsets.UTF_8);
        } catch (Exception ignored) {
            return value;
        }
    }

    private static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }
}
