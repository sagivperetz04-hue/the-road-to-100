package com.plap.studystairs;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import java.util.Calendar;

/**
 * Two daily reminders, at 08:00 and 20:00 (texts in res/values/strings.xml).
 * Each alarm shows its notification and books the same time for the next day; boot, app updates and
 * clock changes book both again. Nothing goes online.
 */
public class Reminders extends BroadcastReceiver {
    private static final String CHANNEL = "daily";
    private static final String EXTRA = "which";
    private static final int[][] TIMES = {{8, 0}, {20, 0}};
    private static final int[] TEXTS = {R.string.reminder_morning, R.string.reminder_evening};

    @Override
    public void onReceive(Context c, Intent intent) {
        int which = intent.getIntExtra(EXTRA, -1);
        if (which >= 0 && which < TIMES.length) {
            show(c, which);
            schedule(c, which);          // the same time tomorrow
        } else {
            scheduleAll(c);              // boot, app update, clock or time-zone change
        }
    }

    /** Books both reminders (safe to call often: it replaces the pending ones). */
    public static void scheduleAll(Context c) {
        for (int i = 0; i < TIMES.length; i++) schedule(c, i);
    }

    private static void schedule(Context c, int which) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Calendar at = Calendar.getInstance();
        at.set(Calendar.HOUR_OF_DAY, TIMES[which][0]);
        at.set(Calendar.MINUTE, TIMES[which][1]);
        at.set(Calendar.SECOND, 0);
        at.set(Calendar.MILLISECOND, 0);
        if (at.getTimeInMillis() <= System.currentTimeMillis() + 1000) at.add(Calendar.DAY_OF_YEAR, 1);
        Intent i = new Intent(c, Reminders.class).setAction("com.plap.studystairs.REMIND_" + which).putExtra(EXTRA, which);
        PendingIntent pi = PendingIntent.getBroadcast(c, 100 + which, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        long t = at.getTimeInMillis();
        try {
            if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, t, pi);
            else am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, t, pi);
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, t, pi);   // exact alarms not allowed: within a few minutes
        }
    }

    /** Shows reminder `which` now (also used by the debug-build test hook). */
    public static void show(Context c, int which) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 33 && c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, c.getString(R.string.reminder_channel), NotificationManager.IMPORTANCE_DEFAULT));
        }
        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent tap = PendingIntent.getActivity(c, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String text = c.getString(TEXTS[which]);
        @SuppressWarnings("deprecation")
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, CHANNEL) : new Notification.Builder(c);
        b.setSmallIcon(R.drawable.ic_notify)
            .setColor(0xFFFF2D78)
            .setContentTitle(c.getString(R.string.app_name))
            .setContentText(text)
            .setStyle(new Notification.BigTextStyle().bigText(text))
            .setContentIntent(tap)
            .setAutoCancel(true);
        nm.notify(200 + which, b.build());
    }
}
