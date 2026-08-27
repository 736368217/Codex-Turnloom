package com.codexpocket.mobile;

final class ReminderDecision {
    private ReminderDecision() {
    }

    static boolean shouldNotify(boolean baselineSet, boolean thinking, long lastCompletedAtMs, long observedCompletedAtMs) {
        return baselineSet && !thinking && observedCompletedAtMs > 0L && observedCompletedAtMs > lastCompletedAtMs;
    }
}
