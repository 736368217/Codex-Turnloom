package com.codexpocket.mobile;

import android.content.Context;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import org.json.JSONArray;

import java.util.concurrent.TimeUnit;

final class ReminderScheduler {
    private static final String PREFS = "codex_pocket";
    private static final String REMINDERS_KEY = "thread_reminders";
    private static final String PERIODIC_WORK = "codex-pocket-reminder-periodic";
    private static final String ACTIVE_WORK = "codex-pocket-reminder-active";
    private static final long ACTIVE_POLL_SECONDS = 30L;

    private ReminderScheduler() {
    }

    static void sync(Context context) {
        if (!hasReminders(context)) {
            cancel(context);
            return;
        }
        WorkManager manager = WorkManager.getInstance(context);
        PeriodicWorkRequest periodic = new PeriodicWorkRequest.Builder(ReminderWorker.class, 15, TimeUnit.MINUTES)
                .setConstraints(networkConstraints())
                .build();
        manager.enqueueUniquePeriodicWork(PERIODIC_WORK, ExistingPeriodicWorkPolicy.KEEP, periodic);
        kick(context);
    }

    static void kick(Context context) {
        if (!hasReminders(context)) return;
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(ReminderWorker.class)
                .setConstraints(networkConstraints())
                .build();
        WorkManager.getInstance(context).enqueueUniqueWork(ACTIVE_WORK, ExistingWorkPolicy.REPLACE, request);
    }

    static void scheduleActiveFollowUp(Context context) {
        if (!hasReminders(context)) return;
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(ReminderWorker.class)
                .setInitialDelay(ACTIVE_POLL_SECONDS, TimeUnit.SECONDS)
                .setConstraints(networkConstraints())
                .build();
        WorkManager.getInstance(context).enqueueUniqueWork(ACTIVE_WORK, ExistingWorkPolicy.APPEND_OR_REPLACE, request);
    }

    static void cancel(Context context) {
        WorkManager manager = WorkManager.getInstance(context);
        manager.cancelUniqueWork(PERIODIC_WORK);
        manager.cancelUniqueWork(ACTIVE_WORK);
    }

    private static Constraints networkConstraints() {
        return new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
    }

    private static boolean hasReminders(Context context) {
        try {
            JSONArray reminders = new JSONArray(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .getString(REMINDERS_KEY, "[]"));
            for (int i = 0; i < reminders.length(); i++) {
                if (reminders.getJSONObject(i).optBoolean("enabled", true)) return true;
            }
        } catch (Exception ignored) {
        }
        return false;
    }
}
