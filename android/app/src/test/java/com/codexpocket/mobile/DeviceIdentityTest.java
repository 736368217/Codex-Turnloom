package com.codexpocket.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;

import org.junit.Test;

public class DeviceIdentityTest {
    @Test
    public void separatesTwoComputersThatShareOneOrigin() {
        assertNotEquals(
                DeviceIdentity.key("http://127.0.0.1:8787", "test-code"),
                DeviceIdentity.key("http://127.0.0.1:8787", "example-code"));
    }

    @Test
    public void keepsAKeyStableForTheSameComputer() {
        assertEquals(
                DeviceIdentity.key("http://127.0.0.1:8787", "test-code"),
                DeviceIdentity.key("  http://127.0.0.1:8787  ", "test-code"));
    }

    @Test
    public void toleratesMissingParts() {
        assertEquals(DeviceIdentity.key(null, null), "\u0000");
        assertNotEquals(DeviceIdentity.key("http://a.test", ""), DeviceIdentity.key("http://a.test", "x"));
    }
}
