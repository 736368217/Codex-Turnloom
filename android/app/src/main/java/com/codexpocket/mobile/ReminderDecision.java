package com.codexpocket.mobile;

final class ReminderDecision {
    static final long MAX_NOTIFICATION_DELAY_MS = 2L * 60L * 1000L;
    private static final long MAX_FUTURE_CLOCK_SKEW_MS = 60L * 1000L;

    private ReminderDecision() {
    }

    static boolean shouldNotify(
            boolean baselineSet,
            boolean thinking,
            long lastCompletedAtMs,
            long observedCompletedAtMs,
            long observedAtMs
    ) {
        if (!baselineSet || thinking || observedCompletedAtMs <= 0L || observedCompletedAtMs <= lastCompletedAtMs) {
            return false;
        }
        long ageMs = observedAtMs - observedCompletedAtMs;
        return ageMs >= -MAX_FUTURE_CLOCK_SKEW_MS && ageMs <= MAX_NOTIFICATION_DELAY_MS;
    }

    static int notificationId(String deviceUrl, String threadId) {
        return (String.valueOf(deviceUrl) + "\n" + String.valueOf(threadId)).hashCode();
    }
}
