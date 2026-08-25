package com.codexpocket.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.List;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public class ReminderService extends Service {
    private static final String PREFS = "codex_pocket";
    private static final String DEVICES_KEY = "devices";
    private static final String REMINDERS_KEY = "thread_reminders";
    private static final String KEY_ALIAS = "codex-pocket-device-store";
    private static final String CHANNEL_ID = "codex-pocket-completions";
    private static final int SERVICE_NOTIFICATION_ID = 7101;
    private static final long POLL_MS = 5000L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable pollTask = this::poll;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        startForeground(SERVICE_NOTIFICATION_ID, serviceNotification());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        handler.removeCallbacks(pollTask);
        handler.post(pollTask);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(pollTask);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void poll() {
        List<Reminder> reminders = loadReminders();
        if (reminders.isEmpty()) {
            stopSelf();
            return;
        }
        List<Device> devices = loadDevices();
        new Thread(() -> {
            boolean changed = false;
            for (Reminder reminder : reminders) {
                Device device = findDevice(devices, reminder.deviceUrl);
                if (device == null) continue;
                try {
                    boolean thinking = readThinking(device, reminder.threadId);
                    boolean wasBaselineSet = reminder.baselineSet;
                    boolean wasThinking = reminder.lastThinking;
                    if (!wasBaselineSet) {
                        reminder.baselineSet = true;
                    } else if (wasThinking && !thinking) {
                        showCompletionNotification(reminder, device);
                    }
                    if (!wasBaselineSet || wasThinking != thinking) changed = true;
                    reminder.lastThinking = thinking;
                    reminder.baselineSet = true;
                } catch (Exception ignored) {
                    // The next poll retries without disturbing the reminder state.
                }
            }
            if (changed) saveReminders(reminders);
            handler.postDelayed(pollTask, POLL_MS);
        }).start();
    }

    private boolean readThinking(Device device, String threadId) throws Exception {
        String path = "/api/threads/" + threadId + "/messages?limit=1";
        HttpURLConnection connection = (HttpURLConnection) new URL(trimTrailingSlash(device.url) + path).openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(10000);
        connection.setRequestProperty("Accept", "application/json");
        if (!device.token.isEmpty()) connection.setRequestProperty("x-access-token", device.token);
        int code = connection.getResponseCode();
        InputStream stream = code >= 200 && code < 300 ? connection.getInputStream() : connection.getErrorStream();
        StringBuilder result = new StringBuilder();
        if (stream != null) {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) result.append(line);
            }
        }
        connection.disconnect();
        if (code < 200 || code >= 300) throw new Exception("HTTP " + code);
        JSONObject body = new JSONObject(result.toString());
        return body.optJSONObject("status") != null && body.optJSONObject("status").optBoolean("thinking", false);
    }

    private void showCompletionNotification(Reminder reminder, Device device) {
        Intent intent = new Intent(this, MainActivity.class)
                .putExtra(MainActivity.EXTRA_DEVICE_URL, device.url)
                .putExtra(MainActivity.EXTRA_THREAD_ID, reminder.threadId)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                (device.url + reminder.threadId).hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0)
        );
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        builder.setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("Codex 已完成 · " + device.label())
                .setContentText(reminder.title.isEmpty() ? "对话已结束，可以继续下一步" : reminder.title)
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_STATUS)
                .setPriority(Notification.PRIORITY_DEFAULT);
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(
                (device.url + reminder.threadId + System.currentTimeMillis()).hashCode(), builder.build());
    }

    private Notification serviceNotification() {
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        return builder.setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("Codex Pocket")
                .setContentText("正在监测已开启提醒的对话")
                .setOngoing(true)
                .setCategory(Notification.CATEGORY_SERVICE)
                .build();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Codex 对话完成提醒",
                NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Codex 对话完成后显示通知");
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(channel);
    }

    private List<Device> loadDevices() {
        List<Device> devices = new ArrayList<>();
        try {
            String raw = decrypt(getSharedPreferences(PREFS, MODE_PRIVATE).getString(DEVICES_KEY, ""));
            JSONArray array = new JSONArray(raw);
            for (int i = 0; i < array.length(); i++) {
                JSONObject item = array.getJSONObject(i);
                devices.add(new Device(item.optString("name"), item.optString("note"), item.optString("url"), item.optString("token")));
            }
        } catch (Exception ignored) {
        }
        return devices;
    }

    private List<Reminder> loadReminders() {
        List<Reminder> reminders = new ArrayList<>();
        try {
            String raw = getSharedPreferences(PREFS, MODE_PRIVATE).getString(REMINDERS_KEY, "[]");
            JSONArray array = new JSONArray(raw);
            for (int i = 0; i < array.length(); i++) {
                JSONObject item = array.getJSONObject(i);
                if (!item.optBoolean("enabled", true)) continue;
                Reminder reminder = new Reminder(
                        item.optString("deviceUrl"),
                        item.optString("threadId"),
                        item.optString("title")
                );
                reminder.lastThinking = item.optBoolean("lastThinking", false);
                reminder.baselineSet = item.optBoolean("baselineSet", false);
                reminders.add(reminder);
            }
        } catch (Exception ignored) {
        }
        return reminders;
    }

    private void saveReminders(List<Reminder> reminders) {
        try {
            JSONArray array = new JSONArray();
            for (Reminder reminder : reminders) {
                JSONObject item = new JSONObject();
                item.put("deviceUrl", reminder.deviceUrl);
                item.put("threadId", reminder.threadId);
                item.put("title", reminder.title);
                item.put("enabled", true);
                item.put("lastThinking", reminder.lastThinking);
                item.put("baselineSet", reminder.baselineSet);
                array.put(item);
            }
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(REMINDERS_KEY, array.toString()).apply();
        } catch (Exception ignored) {
        }
    }

    private Device findDevice(List<Device> devices, String url) {
        for (Device device : devices) if (device.url.equalsIgnoreCase(url)) return device;
        return null;
    }

    private String decrypt(String encrypted) throws Exception {
        if (encrypted == null || encrypted.isEmpty()) return "[]";
        String[] parts = encrypted.split(":", 2);
        if (parts.length != 2) return encrypted;
        byte[] iv = Base64.decode(parts[0], Base64.DEFAULT);
        byte[] data = Base64.decode(parts[1], Base64.DEFAULT);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(data), StandardCharsets.UTF_8);
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
        return generator.generateKey();
    }

    private String trimTrailingSlash(String value) {
        while (value.endsWith("/") && value.length() > 8) value = value.substring(0, value.length() - 1);
        return value;
    }

    private static class Device {
        final String name;
        final String note;
        final String url;
        final String token;

        Device(String name, String note, String url, String token) {
            this.name = name;
            this.note = note;
            this.url = url;
            this.token = token;
        }

        String label() {
            if (note != null && !note.isBlank()) return note;
            if (name != null && !name.isBlank()) return name;
            return "电脑";
        }
    }

    private static class Reminder {
        final String deviceUrl;
        final String threadId;
        final String title;
        boolean lastThinking;
        boolean baselineSet;

        Reminder(String deviceUrl, String threadId, String title) {
            this.deviceUrl = deviceUrl;
            this.threadId = threadId;
            this.title = title;
        }
    }
}
