package com.codex.turnloom.app;

import java.io.File;
import java.util.function.Consumer;
import java.util.function.Supplier;

/** One explicit startup attempt per call; failure never schedules its own retry. */
final class WebViewStartup {
    static final String ERROR_CODE = "WEBVIEW_INIT_FAILED";
    private boolean attempting;
    private boolean ready;
    private boolean closed;

    boolean attempt(Supplier<File> privateDirectory, Runnable initialize, Consumer<Throwable> failed) {
        if (closed || attempting || ready) return false;
        attempting = true;
        try {
            File directory = privateDirectory.get();
            if (directory == null || (!directory.isDirectory() && !directory.mkdirs())
                    || !directory.isDirectory()) {
                throw new IllegalStateException("WebView private directory unavailable");
            }
            initialize.run();
            ready = true;
            return true;
        } catch (RuntimeException | LinkageError error) {
            failed.accept(error);
            return false;
        } finally {
            attempting = false;
        }
    }

    void close() { closed = true; }
}
