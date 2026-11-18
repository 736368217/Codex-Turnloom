package com.codex.turnloom.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class AttachmentPickSessionTest {
    @Test public void doubleOpenAndDuplicateResultAreRejected() {
        AttachmentPickSession session = new AttachmentPickSession();
        AttachmentPickSession.Request first = session.begin("first", "image");
        assertNotNull(first);
        assertNull(session.begin("second", "file"));
        assertSame(first, session.acceptResult(first.code));
        assertTrue(session.busy()); // Reading is still part of this request.
        assertNull(session.acceptResult(first.code));
        assertTrue(session.finish(first));
        assertFalse(session.finish(first));
        assertFalse(session.busy());
    }

    @Test public void cancelledActivityResultCannotBecomeTheNextRequest() {
        AttachmentPickSession session = new AttachmentPickSession();
        AttachmentPickSession.Request old = session.begin("old", "image");
        assertTrue(session.cancel(old.id));
        AttachmentPickSession.Request fresh = session.begin("fresh", "file");
        assertNotEquals(old.code, fresh.code);
        assertNull(session.acceptResult(old.code));
        assertFalse(session.finish(old));
        assertFalse(session.cancel(old.id));
        assertSame(fresh, session.acceptResult(fresh.code));
        assertEquals("file", fresh.kind);
        assertTrue(session.finish(fresh));
    }

    @Test public void cancelledReadAndItsPostedCompletionCannotOverwriteNewRead() {
        AttachmentPickSession session = new AttachmentPickSession();
        AttachmentPickSession.Request old = session.begin("read-old", "image");
        assertSame(old, session.acceptResult(old.code));
        assertTrue(session.cancel(old.id));
        AttachmentPickSession.Request fresh = session.begin("read-new", "image");
        assertSame(fresh, session.acceptResult(fresh.code));
        assertFalse(session.finish(old));
        assertTrue(session.busy());
        assertTrue(session.finish(fresh));
    }

    @Test public void activityRecreationDoesNotReuseAnOutstandingCode() {
        AttachmentPickSession before = new AttachmentPickSession();
        AttachmentPickSession.Request old = before.begin("before", "file");
        before.close();
        assertNull(before.acceptResult(old.code));
        assertNull(before.begin("closed", "file"));
        AttachmentPickSession after = new AttachmentPickSession();
        AttachmentPickSession.Request fresh = after.begin("after", "file");
        assertNull(after.acceptResult(old.code));
        assertSame(fresh, after.acceptResult(fresh.code));
        assertTrue(AttachmentPickSession.ownsCode(fresh.code));
        assertFalse(AttachmentPickSession.ownsCode(0x52));
        assertFalse(AttachmentPickSession.ownsCode(0x62));
    }
}
