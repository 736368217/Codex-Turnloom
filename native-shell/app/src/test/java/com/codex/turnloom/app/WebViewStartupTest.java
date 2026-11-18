package com.codex.turnloom.app;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import static org.junit.Assert.*;

public class WebViewStartupTest {
    @Rule public TemporaryFolder files = new TemporaryFolder(new File(
            System.getenv().getOrDefault("PI_SCRATCH_DIR", System.getProperty("java.io.tmpdir"))));

    @Test public void preparesDirectoryBeforeConstructionAndPreservesExistingFiles() throws Exception {
        File root = files.newFolder();
        File directory = new File(root, "app_webview");
        File prefs = new File(root, "shared_prefs/pairing.xml");
        assertTrue(prefs.getParentFile().mkdirs());
        Files.write(prefs.toPath(), "paired".getBytes(StandardCharsets.UTF_8));
        WebViewStartup startup = new WebViewStartup();
        assertTrue(startup.attempt(() -> directory, () -> assertTrue(directory.isDirectory()),
                error -> fail(error.toString())));
        File lock = new File(directory, "webview_data.lock");
        Files.write(lock.toPath(), new byte[]{1, 2, 3});
        assertTrue(new WebViewStartup().attempt(() -> directory, () -> {}, error -> fail()));
        assertArrayEquals(new byte[]{1, 2, 3}, Files.readAllBytes(lock.toPath()));
        assertEquals("paired", new String(Files.readAllBytes(prefs.toPath()), StandardCharsets.UTF_8));
    }

    @Test public void runtimeFailureReportsOnceThenExplicitRetryCanSucceed() throws Exception {
        File directory = files.newFolder();
        WebViewStartup startup = new WebViewStartup();
        AtomicInteger errors = new AtomicInteger();
        RuntimeException original = new RuntimeException("provider failed");
        assertFalse(startup.attempt(() -> directory, () -> { throw original; }, error -> {
            assertSame(original, error);
            errors.incrementAndGet();
            assertFalse(startup.attempt(() -> directory, () -> fail("recursive retry"), ignored -> fail()));
        }));
        assertEquals(1, errors.get());
        assertEquals("WEBVIEW_INIT_FAILED", WebViewStartup.ERROR_CODE);
        assertTrue(startup.attempt(() -> directory, () -> {}, ignored -> fail()));
        assertFalse(startup.attempt(() -> directory, () -> fail("already initialized"), ignored -> fail()));
    }

    @Test public void repeatedLinkageFailureRequiresOneCallPerAttemptAndCloseBlocksRetry() throws Exception {
        File directory = files.newFolder();
        WebViewStartup startup = new WebViewStartup();
        AtomicInteger attempts = new AtomicInteger();
        AtomicInteger errors = new AtomicInteger();
        Runnable construct = () -> { attempts.incrementAndGet(); throw new UnsatisfiedLinkError("provider"); };
        for (int i = 0; i < 3; i++) {
            assertFalse(startup.attempt(() -> directory, construct, error -> {
                assertTrue(error instanceof LinkageError);
                errors.incrementAndGet();
            }));
        }
        assertEquals(3, attempts.get());
        assertEquals(3, errors.get());
        startup.close();
        assertFalse(startup.attempt(() -> directory, construct, ignored -> fail()));
        assertEquals(3, attempts.get());
    }

    @Test public void unusableDirectoryAndContextFailureNeverConstructWebView() throws Exception {
        File regularFile = files.newFile();
        AtomicInteger errors = new AtomicInteger();
        WebViewStartup startup = new WebViewStartup();
        assertFalse(startup.attempt(() -> regularFile, () -> fail("must not construct"), error -> errors.incrementAndGet()));
        assertFalse(startup.attempt(() -> { throw new SecurityException("context denied"); },
                () -> fail("must not construct"), error -> errors.incrementAndGet()));
        assertEquals(2, errors.get());
        assertTrue(regularFile.isFile());
    }
}
