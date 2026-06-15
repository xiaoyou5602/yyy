package com.toge.alarm

import android.app.Activity
import android.content.Context
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.TextView

class RingActivity : Activity() {

    private var ringtone: android.media.Ringtone? = null
    private var vibrator: Vibrator? = null
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val msg = intent.getStringExtra("msg") ?: "闹钟"

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }

        // Keep screen on
        window.addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        )

        // Full screen
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.hide(
                android.view.WindowInsets.Type.statusBars() or
                android.view.WindowInsets.Type.navigationBars()
            )
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            )
        }

        // Simple layout
        val root = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setBackgroundColor(0xFF1a1a2e.toInt())
            gravity = android.view.Gravity.CENTER
        }

        val label = TextView(this).apply {
            text = "⏰"
            textSize = 64f
            gravity = android.view.Gravity.CENTER
        }
        val msgView = TextView(this).apply {
            text = msg
            textSize = 32f
            setTextColor(0xFFFFFFFF.toInt())
            gravity = android.view.Gravity.CENTER
            setPadding(48, 32, 48, 32)
        }
        val timeView = TextView(this).apply {
            val now = java.util.Calendar.getInstance()
            text = "%02d:%02d".format(now.get(java.util.Calendar.HOUR_OF_DAY), now.get(java.util.Calendar.MINUTE))
            textSize = 56f
            setTextColor(0xFFFF6B35.toInt())
            gravity = android.view.Gravity.CENTER
        }
        val dismissBtn = Button(this).apply {
            text = "关闭"
            textSize = 22f
            setTextColor(0xFFFFFFFF.toInt())
            setBackgroundColor(0xFFFF6B35.toInt())
            setOnClickListener { dismiss() }
        }

        root.addView(label)
        root.addView(msgView)
        root.addView(timeView)
        root.addView(dismissBtn, android.widget.LinearLayout.LayoutParams(
            400, android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = 80 })

        setContentView(root)
    }

    override fun onStart() {
        super.onStart()
        startRinging()
    }

    override fun onStop() {
        super.onStop()
        stopRinging()
    }

    private fun startRinging() {
        // Alarm sound
        val alarmUri = Settings.System.DEFAULT_ALARM_ALERT_URI
        ringtone = RingtoneManager.getRingtone(this, alarmUri).apply {
            audioAttributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            play()
        }

        // Vibration
        vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vm = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
            vm.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        vibrator?.vibrate(
            VibrationEffect.createWaveform(longArrayOf(0, 500, 500), 0)
        )

        // Wake lock
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(
            PowerManager.FULL_WAKE_LOCK or
            PowerManager.ACQUIRE_CAUSES_WAKEUP or
            PowerManager.ON_AFTER_RELEASE,
            "TogeAlarm:Ring"
        ).apply { acquire(10 * 60 * 1000L) }
    }

    private fun stopRinging() {
        ringtone?.stop()
        vibrator?.cancel()
        wakeLock?.let { if (it.isHeld) it.release() }
    }

    private fun dismiss() {
        stopRinging()
        finish()
    }
}
