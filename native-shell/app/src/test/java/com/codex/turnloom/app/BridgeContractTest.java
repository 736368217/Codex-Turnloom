package com.codex.turnloom.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.util.Map;

/** JVM tests for the pure native bridge parsing / validation contract. */
public class BridgeContractTest {
    private static final String SHA = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    private static void expectCode(String expected, Runnable action) {
        try {
            action.run();
            fail("expected " + expected);
        } catch (RuntimeException e) {
            Throwable cause = e.getCause();
            if (!(cause instanceof BridgeContract.ValidationException)) throw e;
            assertEquals(expected, cause.getMessage());
        }
    }

    private static String requestJson(String url, String method, String headers, String body) {
        try {
            JSONObject o = new JSONObject();
            o.put("url", url);
            o.put("method", method);
            if (headers != null) o.put("headers", new JSONObject(headers));
            if (body != null) o.put("body", body);
            return o.toString();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private static void assertError(String expected, String json) {
        try {
            BridgeContract.validateApiUrl(json, true);
            fail("expected " + expected);
        } catch (BridgeContract.ValidationException e) {
            assertEquals(expected, e.getMessage());
        }
    }

    @Test
    public void acceptsHttpsAndPrivateLanApiPaths() throws Exception {
        BridgeContract.Origin https = BridgeContract.validateApiUrl(
                "https://pair.example.com/api/harnesses", true);
        assertEquals("https", https.scheme);
        assertEquals(443, https.port);
        BridgeContract.Origin lan = BridgeContract.validateApiUrl(
                "http://192.168.1.10:8787/api/app/update?channel=stable", true);
        assertEquals("http", lan.scheme);
        assertEquals(8787, lan.port);
        assertEquals("192.168.1.10:8787", lan.authority);
    }

    @Test
    public void rejectsUnsafeSchemesOriginsAndPaths() {
        assertError("INVALID_URL", "file:///android_asset/public/index.html");
        assertError("INVALID_URL", "intent://scan/#Intent;scheme=http;end");
        assertError("HTTP_ORIGIN_NOT_PAIRED", "http://public.example.com/api/health");
        assertError("INVALID_PATH", "https://pair.example.com/health");
        assertError("INVALID_PATH", "https://pair.example.com/api/../admin");
        assertError("INVALID_PATH", "https://pair.example.com/api/%2e%2e/admin");
        assertError("INVALID_URL", "https://user:pass@pair.example.com/api/health");
        assertError("INVALID_URL", "https://pair.example.com/api/health#fragment");
        assertError("INVALID_QUERY", "https://pair.example.com/api/health?token=secret");
        assertError("INVALID_URL", "javascript:alert(1)");
    }

    @Test
    public void validatesPrivateLanHosts() {
        assertTrue(BridgeContract.isPrivateLanHost("localhost"));
        assertTrue(BridgeContract.isPrivateLanHost("192.168.2.30"));
        assertTrue(BridgeContract.isPrivateLanHost("10.4.5.6"));
        assertTrue(BridgeContract.isPrivateLanHost("172.20.1.2"));
        assertFalse(BridgeContract.isPrivateLanHost("172.32.1.2"));
        assertFalse(BridgeContract.isPrivateLanHost("8.8.8.8"));
        assertFalse(BridgeContract.isPrivateLanHost("example.com"));
    }

    @Test
    public void parsesBoundedHttpRequests() throws Exception {
        String json = requestJson("https://pair.example.com/api/send", "POST",
                "{\"x-access-token\":\"opaque\",\"Accept\":\"application/json\"}",
                "{\"message\":\"hello\"}");
        BridgeContract.HttpRequest req = BridgeContract.parseHttpRequest(json);
        assertEquals("POST", req.method);
        assertEquals(8000, req.timeoutMs);
        assertEquals("opaque", req.headers.get("x-access-token"));
        assertEquals("{\"message\":\"hello\"}", new String(req.body,
                java.nio.charset.StandardCharsets.UTF_8));
        assertNotNull(req.url);
    }

    @Test
    public void rejectsUnsafeHeadersMethodsAndTimeouts() {
        expectCode("FORBIDDEN_HEADER", () -> {
            try {
                BridgeContract.parseHttpRequest(requestJson(
                        "https://pair.example.com/api/health", "GET",
                        "{\"Host\":\"evil.example\"}", null));
            } catch (BridgeContract.ValidationException e) {
                throw new RuntimeException(e);
            }
        });
        expectCode("INVALID_HEADER_VALUE", () -> {
            try {
                BridgeContract.parseHttpRequest(requestJson(
                        "https://pair.example.com/api/health", "GET",
                        "{\"X-Test\":\"a\\nb\"}", null));
            } catch (BridgeContract.ValidationException e) {
                throw new RuntimeException(e);
            }
        });
        expectCode("INVALID_METHOD", () -> {
            try {
                BridgeContract.parseHttpRequest(requestJson(
                        "https://pair.example.com/api/health", "DELETE", null, null));
            } catch (BridgeContract.ValidationException e) {
                throw new RuntimeException(e);
            }
        });
        expectCode("BODY_ON_GET", () -> {
            try {
                BridgeContract.parseHttpRequest(requestJson(
                        "https://pair.example.com/api/health", "GET", null, "{}"));
            } catch (BridgeContract.ValidationException e) {
                throw new RuntimeException(e);
            }
        });
        expectCode("INVALID_TIMEOUT", () -> {
            try {
                JSONObject o = new JSONObject(requestJson(
                        "https://pair.example.com/api/health", "GET", null, null));
                o.put("timeoutMs", 999999);
                BridgeContract.parseHttpRequest(o.toString());
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        });
    }

    @Test
    public void parsesAndRejectsUpdateDescriptors() throws Exception {
        JSONObject valid = new JSONObject();
        valid.put("url", "https://pair.example.com/api/apk");
        valid.put("token", "opaque");
        valid.put("sha256", SHA);
        valid.put("versionCode", 82);
        valid.put("packageName", "com.codex.turnloom.app");
        BridgeContract.UpdateRequest req = BridgeContract.parseUpdateRequest(valid.toString());
        assertEquals(SHA, req.sha256);
        assertEquals(82L, req.versionCode);
        assertEquals("com.codex.turnloom.app", req.packageName);

        JSONObject wrongPackage = new JSONObject(valid.toString());
        wrongPackage.put("packageName", "com.evil.app");
        expectCode("INVALID_PACKAGE_NAME", () -> {
            try {
                BridgeContract.parseUpdateRequest(wrongPackage.toString());
            } catch (BridgeContract.ValidationException e) {
                throw new RuntimeException(e);
            }
        });
        JSONObject badHash = new JSONObject(valid.toString());
        badHash.put("sha256", "deadbeef");
        expectCode("INVALID_SHA256", () -> {
            try {
                BridgeContract.parseUpdateRequest(badHash.toString());
            } catch (BridgeContract.ValidationException e) {
                throw new RuntimeException(e);
            }
        });
    }

    @Test
    public void originEqualityIncludesPortAndScheme() throws Exception {
        BridgeContract.Origin a = BridgeContract.validateApiUrl(
                "http://192.168.1.10:8787/api/health", true);
        BridgeContract.Origin b = BridgeContract.validateApiUrl(
                "http://192.168.1.10:8787/api/apk", true);
        BridgeContract.Origin c = BridgeContract.validateApiUrl(
                "http://192.168.1.10:9999/api/health", true);
        BridgeContract.Origin d = BridgeContract.validateApiUrl(
                "https://192.168.1.10:8787/api/health", true);
        assertEquals(a, b);
        assertFalse(a.equals(c));
        assertFalse(a.equals(d));
    }

    @Test
    public void errorJsonNeverIncludesInputAndUsesStatusZero() throws Exception {
        String json = BridgeContract.httpErrorJson("CROSS_ORIGIN_REDIRECT");
        JSONObject o = new JSONObject(json);
        assertEquals(0, o.getInt("status"));
        assertEquals("", o.getString("body"));
        assertEquals("CROSS_ORIGIN_REDIRECT", o.getString("error"));
        assertFalse(json.contains("secret"));
        assertTrue(BridgeContract.validRequestId("req-1:A.b_c"));
        assertFalse(BridgeContract.validRequestId("req\"alert(1)"));
    }

    /** Request JSON and its body both stay bounded, but an encoded 6 MiB pick fits. */
    @Test
    public void acceptsBase64SizedBodyAndStillRejectsOversizedRequests() throws Exception {
        String body = repeat('a', (int) BridgeContract.MAX_REQUEST_BODY_BYTES);
        BridgeContract.HttpRequest req = BridgeContract.parseHttpRequest(requestJson(
                "https://pair.example.com/api/send", "POST", null, body));
        assertEquals(BridgeContract.MAX_REQUEST_BODY_BYTES, req.body.length);
        assertEquals(BridgeContract.MAX_REQUEST_BODY_BYTES + 64L * 1024,
                BridgeContract.MAX_HTTP_BODY_BYTES);
        assertTrue(BridgeContract.MAX_HTTP_RESPONSE_BYTES
                >= BridgeContract.MAX_REQUEST_BODY_BYTES);
        expectCode("INVALID_REQUEST_JSON", () -> {
            try {
                BridgeContract.parseHttpRequest(requestJson(
                        "https://pair.example.com/api/send", "POST", null,
                        body + repeat('b', 64 * 1024 + 1)));
            } catch (BridgeContract.ValidationException e) {
                throw new RuntimeException(e);
            }
        });
        expectCode("BODY_TOO_LARGE", () -> {
            try {
                BridgeContract.parseHttpRequest(requestJson(
                        "https://pair.example.com/api/send", "POST", null, body + "z"));
            } catch (BridgeContract.ValidationException e) {
                throw new RuntimeException(e);
            }
        });
    }

    @Test
    public void attachmentContractUsesBoundedStatusAndSafeMetadata() throws Exception {
        assertEquals(4, BridgeContract.MAX_ATTACHMENT_FILES);
        assertEquals(4L * 1024 * 1024, BridgeContract.MAX_ATTACHMENT_FILE_BYTES);
        assertEquals(6L * 1024 * 1024, BridgeContract.MAX_ATTACHMENT_TOTAL_BYTES);
        assertTrue(BridgeContract.validAttachmentKind("image"));
        assertTrue(BridgeContract.validAttachmentKind("file"));
        assertFalse(BridgeContract.validAttachmentKind("video"));
        assertTrue(BridgeContract.validRequestId("attach-1:A.b_c"));
        assertFalse(BridgeContract.validRequestId("attach\");alert(1)"));

        String cancelled = BridgeContract.attachmentsResultJson("cancelled", null, null);
        JSONObject cancelledJson = new JSONObject(cancelled);
        assertEquals("cancelled", cancelledJson.getString("status"));
        assertEquals(0, cancelledJson.getJSONArray("items").length());
        assertFalse(cancelledJson.has("error"));

        JSONObject error = new JSONObject(BridgeContract.attachmentErrorJson(
                BridgeContract.ATTACH_FILE_TOO_LARGE));
        assertEquals("error", error.getString("status"));
        assertEquals(0, error.getJSONArray("items").length());
        assertEquals("file-too-large", error.getString("error"));

        assertEquals("image/png", BridgeContract.safeAttachmentMimeType(
                "IMAGE/PNG; charset=binary"));
        assertEquals("application/octet-stream",
                BridgeContract.safeAttachmentMimeType(null));
        try {
            BridgeContract.safeAttachmentMimeType("image/svg+html\"><script>");
            fail("expected invalid MIME");
        } catch (BridgeContract.ValidationException e) {
            assertEquals(BridgeContract.ATTACH_INVALID_MIME, e.getMessage());
        }
        assertEquals("report.txt", BridgeContract.safeAttachmentName(
                "  report\n.txt  "));
        assertEquals("ab", BridgeContract.safeAttachmentName("a\u2028b\u2029"));
        assertEquals("attachment", BridgeContract.safeAttachmentName(" \u0000\t "));

        JSONArray items = new JSONArray().put(new JSONObject(
                BridgeContract.attachmentItemJson("evil\";alert(1)", "application/pdf", 3,
                        "data:application/pdf;base64,AAEC")));
        JSONObject success = new JSONObject(
                BridgeContract.attachmentsResultJson("success", items, null));
        assertEquals("success", success.getString("status"));
        assertEquals(1, success.getJSONArray("items").length());
        JSONObject item = success.getJSONArray("items").getJSONObject(0);
        assertEquals("evil\";alert(1)", item.getString("name"));
        assertEquals("application/pdf", item.getString("mimeType"));
        assertEquals(3, item.getInt("sizeBytes"));
        assertEquals("data:application/pdf;base64,AAEC", item.getString("dataUrl"));
        assertFalse(success.has("error"));
    }

    private static String repeat(char value, int count) {
        StringBuilder out = new StringBuilder(count);
        for (int i = 0; i < count; i++) out.append(value);
        return out.toString();
    }
}
