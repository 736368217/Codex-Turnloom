package com.codexpocket.mobile;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class DeviceOriginTest {
    @Test
    public void acceptsPagesFromTheConfiguredComputerOrigin() {
        assertTrue(DeviceOrigin.matches(
                "https://example.test:18787",
                "https://example.test:18787/?selectedId=thread"));
        assertTrue(DeviceOrigin.matches("https://example.test", "https://example.test/path"));
    }

    @Test
    public void rejectsOtherOriginsAndInvalidUrls() {
        assertFalse(DeviceOrigin.matches("https://example.test:18787", "https://evil.test:18787"));
        assertFalse(DeviceOrigin.matches("https://example.test:18787", "https://example.test:443"));
        assertFalse(DeviceOrigin.matches("not a url", "https://example.test"));
    }
}
