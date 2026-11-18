package com.codexpocket.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class UpdateDownloadTest {
    @Test
    public void keepsTokenInBothHeaderAndQueryForProxies() {
        assertEquals(
                "https://example.test/api/apk?token=a%2Bb%3Dc",
                UpdateDownload.downloadUrl("https://example.test/api/apk", "a+b=c"));
        assertEquals(
                "https://example.test/api/apk?v=1&token=secret#note",
                UpdateDownload.downloadUrl("https://example.test/api/apk?v=1#note", "secret"));
    }

    @Test
    public void doesNotDuplicateAnExistingToken() {
        String url = "https://example.test/api/apk?token=from-qr";
        assertEquals(url, UpdateDownload.downloadUrl(url, "another"));
    }

    @Test
    public void rejectsHtmlLoginPagesThatAreServedWithStatus200() {
        assertFalse(UpdateDownload.hasApkMagic("<!DOCTYPE html>".getBytes()));
        assertFalse(UpdateDownload.hasApkMagic(new byte[] { 'P' }));
        assertTrue(UpdateDownload.hasApkMagic(new byte[] { 'P', 'K', 3, 4 }));
    }

    @Test
    public void validatesDownloadedLength() {
        assertNotNull(UpdateDownload.sizeProblem(4096L, 0L));
        assertNotNull(UpdateDownload.sizeProblem(3_000_000L, 3_408_256L));
        assertNull(UpdateDownload.sizeProblem(3_408_256L, 3_408_256L));
        assertNull(UpdateDownload.sizeProblem(3_408_256L, 0L));
    }
}
