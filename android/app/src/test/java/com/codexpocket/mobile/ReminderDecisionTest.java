package com.codexpocket.mobile;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ReminderDecisionTest {
    @Test
    public void initialBaselineNeverNotifies() {
        assertFalse(ReminderDecision.shouldNotify(false, false, 0L, 100L));
    }

    @Test
    public void newerCompletionNotifiesEvenWhenRunningTransitionWasMissed() {
        assertTrue(ReminderDecision.shouldNotify(true, false, 100L, 200L));
    }

    @Test
    public void activeOrAlreadyObservedCompletionDoesNotNotify() {
        assertFalse(ReminderDecision.shouldNotify(true, true, 100L, 200L));
        assertFalse(ReminderDecision.shouldNotify(true, false, 200L, 200L));
    }
}
