package com.codex.turnloom.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

/**
 * JVM tests for the native HTTP response envelope.
 *
 * <p>The packaged page cannot load remote subresources (the WebView intercepts
 * every http(s) request), so an image has to reach the page as exact bytes. The
 * envelope keeps the historical UTF-8 {@code body} and adds {@code bodyBase64}
 * only for image content types.</p>
 */
public class NativeHttpResponseTest {

    /** Four bytes that are not valid UTF-8 - a JPEG-style binary prefix. */
    private static final byte[] BINARY = new byte[] {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, 0x00, 0x7B};

    private static JSONObject parse(String json) throws Exception {
        return new JSONObject(json);
    }

    @Test
    public void imageResponseCarriesExactBase64AndKeepsBody() throws Exception {
        JSONObject o = parse(NativeHttpClient.responseJson(200, "image/jpeg", BINARY, null));
        assertEquals(200, o.getInt("status"));
        assertEquals(Base64.getEncoder().encodeToString(BINARY), o.getString("bodyBase64"));
        assertArrayEquals(BINARY, Base64.getDecoder().decode(o.getString("bodyBase64")));
        // The historical field stays present so an older page bundle is unaffected.
        assertTrue(o.has("body"));
        assertFalse(o.has("error"));
    }

    @Test
    public void contentTypeParametersAndCaseAreIgnored() throws Exception {
        JSONObject o = parse(NativeHttpClient.responseJson(200, "IMAGE/PNG; charset=binary", BINARY, null));
        assertTrue(o.has("bodyBase64"));
    }

    @Test
    public void jsonResponseHasNoBase64Field() throws Exception {
        byte[] json = "{\"ok\":true}".getBytes(StandardCharsets.UTF_8);
        JSONObject o = parse(NativeHttpClient.responseJson(200, "application/json; charset=utf-8", json, null));
        assertEquals("{\"ok\":true}", o.getString("body"));
        assertFalse(o.has("bodyBase64"));
    }

    @Test
    public void unknownOrMissingContentTypeHasNoBase64Field() throws Exception {
        assertFalse(parse(NativeHttpClient.responseJson(200, null, BINARY, null)).has("bodyBase64"));
        assertFalse(parse(NativeHttpClient.responseJson(200, "application/octet-stream", BINARY, null))
                .has("bodyBase64"));
    }

    @Test
    public void emptyImageBodyHasNoBase64Field() throws Exception {
        JSONObject o = parse(NativeHttpClient.responseJson(200, "image/png", new byte[0], null));
        assertEquals("", o.getString("body"));
        // An empty data: URL would render as a broken image; omit the field instead.
        assertFalse(o.has("bodyBase64"));
    }

    @Test
    public void errorEnvelopeKeepsErrorAndStillDecodesImages() throws Exception {
        JSONObject o = parse(NativeHttpClient.responseJson(404, "image/png", BINARY, "NOT_FOUND"));
        assertEquals("NOT_FOUND", o.getString("error"));
        assertEquals(Base64.getEncoder().encodeToString(BINARY), o.getString("bodyBase64"));
    }

    @Test
    public void nullBodyIsTreatedAsEmpty() throws Exception {
        JSONObject o = parse(NativeHttpClient.responseJson(204, "image/png", null, null));
        assertEquals("", o.getString("body"));
        assertFalse(o.has("bodyBase64"));
    }

    @Test
    public void imageTypePredicateMatchesOnlyImageMime() {
        assertTrue(NativeHttpClient.isBinaryImageType("image/webp"));
        assertTrue(NativeHttpClient.isBinaryImageType("image/jpeg; q=1"));
        assertFalse(NativeHttpClient.isBinaryImageType("text/html"));
        assertFalse(NativeHttpClient.isBinaryImageType(""));
        assertFalse(NativeHttpClient.isBinaryImageType(null));
    }
}
