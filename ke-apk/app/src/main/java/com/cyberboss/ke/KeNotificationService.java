package com.cyberboss.ke;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.time.Instant;

import org.json.JSONObject;

public class KeNotificationService extends Service {

    private static final String CHANNEL_ID = "ke-messages";
    private static final int FOREGROUND_ID = 1;
    private static final int MESSAGE_NOTIFY_ID = 2;
    private static final long POLL_INTERVAL_MS = 60_000;
    private static final String BASE_URL = "https://克.withtoge.us";

    public static long sLastNotifyEpoch = 0;
    private static KeNotificationService sInstance;

    public static void updateForegroundStatus(String status) {
        if (sInstance != null) {
            Notification n = sInstance.buildForegroundNotification(status);
            sInstance.startForeground(FOREGROUND_ID, n);
        }
    }

    private HandlerThread handlerThread;
    private Handler handler;
    private volatile boolean running = false;

    @Override
    public void onCreate() {
        super.onCreate();
        sInstance = this;
        createNotificationChannel();
        startForeground(FOREGROUND_ID, buildForegroundNotification("在线"));
    }

    @Override
    public void onDestroy() {
        sInstance = null;
        running = false;
        if (handler != null) {
            handler.removeCallbacks(pollRunnable);
        }
        if (handlerThread != null) {
            handlerThread.quitSafely();
        }
        super.onDestroy();
    }

    public static void heartbeat(long epochMillis) {
        sLastNotifyEpoch = epochMillis;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!running) {
            running = true;
            handlerThread = new HandlerThread("KeNotifPoller");
            handlerThread.start();
            handler = new Handler(handlerThread.getLooper());
            handler.post(pollRunnable);
        }
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private final Runnable pollRunnable = new Runnable() {
        @Override
        public void run() {
            if (!running) return;
            try {
                String result = httpGet(BASE_URL + "/api/last-ke-message");
                if (result != null) {
                    JSONObject json = new JSONObject(result);
                    String time = json.optString("time", "");
                    String text = json.optString("text", "");

                    if (!time.isEmpty()) {
                        long msgEpoch = Instant.parse(time).toEpochMilli();
                        if (msgEpoch > sLastNotifyEpoch) {
                            showMessageNotification(text);
                            sLastNotifyEpoch = msgEpoch;
                        }
                    }
                }
            } catch (Exception ignored) {
            }
            if (running && handler != null) {
                handler.postDelayed(this, POLL_INTERVAL_MS);
            }
        }
    };

    private void showMessageNotification(String text) {
        String preview = (text == null || text.isEmpty()) ? "克给你发了新消息" : text;
        if (preview.length() > 80) preview = preview.substring(0, 80) + "…";

        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(
                this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder builder = new Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.icon)
                .setContentTitle("克")
                .setContentText(preview)
                .setAutoCancel(true)
                .setContentIntent(pending)
                .setCategory(Notification.CATEGORY_MESSAGE)
                .setDefaults(Notification.DEFAULT_VIBRATE | Notification.DEFAULT_LIGHTS);

        if (Build.VERSION.SDK_INT < 26) {
            builder.setPriority(Notification.PRIORITY_MAX);
        }

        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) {
            nm.notify(MESSAGE_NOTIFY_ID, builder.build());
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "克的消息", NotificationManager.IMPORTANCE_HIGH);
            channel.setBypassDnd(true);
            channel.setDescription("克的消息通知");
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
    }

    private Notification buildForegroundNotification(String status) {
        Intent intent = new Intent(this, MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(
                this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.icon)
                .setContentTitle("克")
                .setContentText(status)
                .setOngoing(true)
                .setContentIntent(pending)
                .build();
    }

    private String httpGet(String urlString) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlString);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(8_000);
            conn.setReadTimeout(8_000);
            conn.setRequestMethod("GET");
            conn.setRequestProperty("Accept", "application/json");

            int code = conn.getResponseCode();
            if (code != 200) return null;

            BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line);
            }
            reader.close();
            return sb.toString();
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
