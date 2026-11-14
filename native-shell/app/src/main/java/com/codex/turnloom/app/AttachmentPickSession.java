package com.codex.turnloom.app;

import java.util.concurrent.atomic.AtomicInteger;

/** UI-thread request ownership, independent of Android's result payload. */
final class AttachmentPickSession {
    private static final int FIRST_CODE = 0x7200;
    private static final int LAST_CODE = 0xffff;
    // Never reuse a code in this process, including after Activity recreation.
    private static final AtomicInteger nextCode = new AtomicInteger(FIRST_CODE);

    static final class Request {
        final String id;
        final String kind;
        final int code;
        private boolean reading;

        Request(String id, String kind, int code) {
            this.id = id;
            this.kind = kind;
            this.code = code;
        }
    }

    private Request current;
    private boolean closed;

    static boolean ownsCode(int code) {
        return code >= FIRST_CODE && code <= LAST_CODE;
    }

    boolean busy() { return current != null; }

    Request begin(String id, String kind) {
        if (closed || busy()) return null;
        int code = nextCode.getAndIncrement();
        if (!ownsCode(code)) return null; // Exhaustion is explicit; no unsafe wraparound.
        current = new Request(id, kind, code);
        return current;
    }

    Request acceptResult(int code) {
        if (current == null || current.code != code || current.reading) return null;
        current.reading = true;
        return current;
    }

    boolean finish(Request request) {
        if (request == null || current != request) return false;
        current = null;
        return true;
    }

    boolean cancel(String id) {
        if (current == null || !current.id.equals(id)) return false;
        current = null;
        return true;
    }

    void close() {
        closed = true;
        current = null;
    }
}
