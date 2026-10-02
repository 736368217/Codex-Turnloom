package com.codexpocket.mobile;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ReminderDecisionTest {
    @Test
    public void initialBaselineNeverNotifies() {
        assertFalse(ReminderDecision.shouldNotify(false, false, 0L, 100L, 100L));
    }

    @Test
    public void recentCompletionNotifiesEvenWhenRunningTransitionWasMissed() {
        assertTrue(ReminderDecision.shouldNotify(true, false, 100L, 200L, 200L));
    }

    @Test
    public void activeOrAlreadyObservedCompletionDoesNotNotify() {
        assertFalse(ReminderDecision.shouldNotify(true, true, 100L, 200L, 200L));
        assertFalse(ReminderDecision.shouldNotify(true, false, 200L, 200L, 200L));
    }

    @Test
    public void staleCompletionIsAcknowledgedWithoutANotification() {
        long completedAtMs = 1_000L;
        long checkedAtMs = completedAtMs + ReminderDecision.MAX_NOTIFICATION_DELAY_MS + 1L;
        assertFalse(ReminderDecision.shouldNotify(true, false, 0L, completedAtMs, checkedAtMs));
    }

    @Test
    public void notificationIdentityIsStableForOneDeviceAndThread() {
        int first = ReminderDecision.notificationId("https://office.example.com", "thread-1");
        int duplicate = ReminderDecision.notificationId("https://office.example.com", "thread-1");
        int otherThread = ReminderDecision.notificationId("https://office.example.com", "thread-2");
        assertTrue(first == duplicate);
        assertTrue(first != otherThread);
    }
}
