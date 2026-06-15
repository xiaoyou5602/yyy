package com.toge.alarm

import android.app.*
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.os.*
import androidx.core.app.NotificationCompat
import fi.iki.elonen.NanoHTTPD
import java.io.IOException
import java.net.BindException
import java.net.HttpURLConnection
import java.net.ServerSocket
import java.net.URL

class AlarmService : Service() {

    private var httpServer: AlarmHttpServer? = null
    private var serverError: String? = null
    private var healthHandler: Handler? = null
    private var healthRunning = false
    private var wakelock: PowerManager.WakeLock? = null
    private var healthTick = 0
    private var connectivityReceiver: BroadcastReceiver? = null

    override fun onCreate() {
        super.onCreate()
        acquireWakeLock()
        registerConnectivityReceiver()
        updateNotification()
        Thread {
            Thread.sleep(500)
            startHttpServer()
            updateNotification()
            startHealthCheck()
        }.start()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        stopHealthCheck()
        unregisterConnectivityReceiver()
        try { httpServer?.stop() } catch (_: Exception) {}
        releaseWakeLock()
        super.onDestroy()
    }

    private fun acquireWakeLock() {
        releaseWakeLock()
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakelock = pm.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "TogeAlarm:HttpServer"
        ).apply { acquire(60 * 60 * 1000L) }
    }

    private fun releaseWakeLock() {
        wakelock?.let { if (it.isHeld) it.release() }
        wakelock = null
    }

    private fun registerConnectivityReceiver() {
        connectivityReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                // When network changes, restart the HTTP server
                Thread {
                    Thread.sleep(1000)
                    startHttpServer()
                    updateNotification()
                }.start()
            }
        }
        registerReceiver(connectivityReceiver, IntentFilter(ConnectivityManager.CONNECTIVITY_ACTION))
    }

    private fun unregisterConnectivityReceiver() {
        try { connectivityReceiver?.let { unregisterReceiver(it) } } catch (_: Exception) {}
        connectivityReceiver = null
    }

    private fun startHealthCheck() {
        healthRunning = true
        healthTick = 0
        healthHandler = Handler(Looper.getMainLooper())
        healthHandler?.postDelayed(object : Runnable {
            override fun run() {
                if (!healthRunning) return
                healthTick += 1
                // Re-acquire WakeLock every 30 min so it never expires
                if (healthTick % 30 == 0) acquireWakeLock()
                checkAndRestartServer()
                healthHandler?.postDelayed(this, 60_000) // every 60 seconds
            }
        }, 60_000)
    }

    private fun stopHealthCheck() {
        healthRunning = false
        healthHandler?.removeCallbacksAndMessages(null)
        healthHandler = null
    }

    private fun checkAndRestartServer() {
        try {
            val url = URL("http://127.0.0.1:8765/health")
            val conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 3000
            conn.readTimeout = 3000
            conn.requestMethod = "GET"
            val code = conn.responseCode
            conn.disconnect()
            if (code != 200) throw IOException("bad status $code")
        } catch (e: Exception) {
            // Server dead, restart it
            startHttpServer()
            updateNotification()
        }
    }

    private fun tryStopServer() {
        try { httpServer?.stop() } catch (_: Exception) {}
        try { Thread.sleep(SERVER_RETRY_DELAY_MS) } catch (_: Exception) {}
    }

    private fun tryForceReleasePort() {
        try {
            val sock = ServerSocket(8765)
            sock.reuseAddress = true
            sock.close()
        } catch (_: Exception) {}
    }

    private fun startHttpServer() {
        for (retry in 0..SERVER_MAX_RETRIES) {
            try {
                tryStopServer()
                tryForceReleasePort()
                httpServer = AlarmHttpServer(this)
                httpServer?.start()
                serverError = null
                return
            } catch (e: BindException) {
                if (retry < SERVER_MAX_RETRIES) {
                    Thread.sleep(SERVER_RETRY_DELAY_MS * (retry + 1))
                    continue
                }
                serverError = "端口被占用"
            } catch (e: IOException) {
                serverError = "网络错误: ${e.message}"
                return
            } catch (e: Exception) {
                serverError = "启动失败: ${e.message}"
                return
            }
        }
    }

    private fun updateNotification() {
        val title = if (serverError != null) "闹钟服务异常" else "闹钟服务运行中"
        val text = serverError ?: "端口 8765"
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIFICATION_ID, buildNotification(title, text))
    }

    private fun buildNotification(title: String, text: String): Notification {
        val channelId = "alarm_service"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId,
                "闹钟服务",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "保持闹钟 HTTP 服务运行"
            }
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(channel)
        }

        val intent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, channelId)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .build()
    }

    companion object {
        private const val NOTIFICATION_ID = 4221
        private const val SERVER_RETRY_DELAY_MS = 800L
        private const val SERVER_MAX_RETRIES = 3
    }
}

/** Minimal HTTP server that handles /alarm GET requests. */
class AlarmHttpServer(private val context: Context) : NanoHTTPD("0.0.0.0", 8765) {

    override fun serve(session: IHTTPSession): Response {
        if (session.method == Method.GET && session.uri == "/health") {
            return newFixedLengthResponse("OK")
        }

        if (session.method != Method.GET || session.uri != "/alarm") {
            return newFixedLengthResponse(
                Response.Status.NOT_FOUND,
                MIME_PLAINTEXT,
                "use GET /alarm?hour=8&minute=30&msg=hello"
            )
        }

        val params = session.parms ?: emptyMap()
        val hour = params["hour"]?.toIntOrNull() ?: return bad("missing hour")
        val minute = params["minute"]?.toIntOrNull() ?: return bad("missing minute")
        val msg = params["msg"] ?: "闹钟"

        if (hour !in 0..23 || minute !in 0..59) {
            return bad("hour 0-23, minute 0-59")
        }

        AlarmHelper.setAlarm(context, hour, minute, msg)
        return newFixedLengthResponse("OK alarm set $hour:$minute $msg")
    }

    private fun bad(reason: String): Response {
        return newFixedLengthResponse(
            Response.Status.BAD_REQUEST,
            MIME_PLAINTEXT,
            "ERROR $reason"
        )
    }
}
