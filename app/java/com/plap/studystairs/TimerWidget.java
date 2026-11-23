package com.plap.studystairs;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.TimeZone;

/**
 * Home-screen widget: a timer toward a goal date (days or months, counting down or up) and a sentence of the day
 * from res/values/sentences.xml (365 lines; res-private replaces them with a personal mix).
 * Two looks: "pro" (dark, calm) and "pink" (unicorns, sunshine and rainbows).
 * Settings live in SharedPreferences "widget" and are edited in the app (window.AndroidBridge.widget*).
 * A tap on the timer opens the settings in the app; a tap on the sentence shows the next one.
 * Updates itself after midnight; nothing goes online.
 */
public class TimerWidget extends AppWidgetProvider {
    static final String PREFS = "widget";
    private static final String ACTION_NEXT = "com.plap.studystairs.WIDGET_NEXT";
    private static final String ACTION_TICK = "com.plap.studystairs.WIDGET_TICK";
    static final String EXTRA_OPEN = "open";

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        updateAll(c);
    }

    @Override
    public void onReceive(Context c, Intent intent) {
        super.onReceive(c, intent);
        String a = intent.getAction();
        if (ACTION_NEXT.equals(a)) {
            SharedPreferences p = prefs(c);
            p.edit().putInt("shift", p.getInt("shift", 0) + 1).apply();
            updateAll(c);
        } else if (ACTION_TICK.equals(a) || Intent.ACTION_TIME_CHANGED.equals(a) || Intent.ACTION_TIMEZONE_CHANGED.equals(a)) {
            updateAll(c);
        }
    }

    @Override
    public void onDisabled(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(tick(c));
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static int count(Context c) {
        return AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c, TimerWidget.class)).length;
    }

    /** Redraws every placed widget and books the next redraw just after midnight. */
    static void updateAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, TimerWidget.class));
        if (ids.length == 0) return;
        for (int id : ids) m.updateAppWidget(id, build(c));
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am != null) {
            Calendar next = Calendar.getInstance();
            next.add(Calendar.DAY_OF_YEAR, 1);
            next.set(Calendar.HOUR_OF_DAY, 0);
            next.set(Calendar.MINUTE, 0);
            next.set(Calendar.SECOND, 5);
            next.set(Calendar.MILLISECOND, 0);
            am.setAndAllowWhileIdle(AlarmManager.RTC, next.getTimeInMillis(), tick(c));
        }
    }

    private static PendingIntent tick(Context c) {
        Intent i = new Intent(c, TimerWidget.class).setAction(ACTION_TICK);
        return PendingIntent.getBroadcast(c, 301, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /* ------------------------------------------------------------------ settings (JSON for the page) */

    /** {title, start, goal, unit: days|months, count: down|up, theme: pro|pink, set: bool} */
    static String settingsJson(Context c) {
        SharedPreferences p = prefs(c);
        JSONObject o = new JSONObject();
        try {
            o.put("title", p.getString("title", ""));
            o.put("start", p.getString("start", ""));
            o.put("goal", p.getString("goal", ""));
            o.put("unit", p.getString("unit", "days"));
            o.put("count", p.getString("count", "down"));
            o.put("theme", p.getString("theme", "pink"));
        } catch (JSONException e) { /* not reachable */ }
        return o.toString();
    }

    /** Stores settings from the page (anything invalid is dropped) and redraws. */
    static boolean save(Context c, String json) {
        JSONObject o;
        try { o = new JSONObject(json); } catch (JSONException e) { return false; }
        String title = o.optString("title", "").trim();
        if (title.length() > 40) title = title.substring(0, 40);
        String start = o.optString("start", ""), goal = o.optString("goal", "");
        prefs(c).edit()
            .putString("title", title)
            .putString("start", day(start) != null ? start : "")
            .putString("goal", day(goal) != null ? goal : "")
            .putString("unit", "months".equals(o.optString("unit")) ? "months" : "days")
            .putString("count", "up".equals(o.optString("count")) ? "up" : "down")
            .putString("theme", "pro".equals(o.optString("theme")) ? "pro" : "pink")
            .apply();
        updateAll(c);
        return true;
    }

    /** Today's sentence, moved on by the taps so far plus `extra`. */
    static String sentence(Context c, int extra) {
        String[] all = c.getResources().getStringArray(R.array.widget_sentences);
        if (all.length == 0) return "";
        long n = today() + prefs(c).getInt("shift", 0) + extra;
        return all[(int) (((n % all.length) + all.length) % all.length)];
    }

    static void next(Context c) {
        SharedPreferences p = prefs(c);
        p.edit().putInt("shift", p.getInt("shift", 0) + 1).apply();
        updateAll(c);
    }

    /* ------------------------------------------------------------------ dates (whole days, local calendar) */

    /** "yyyy-MM-dd" as a day number (days since 1970-01-01), or null. */
    static Long day(String s) {
        if (s == null || !s.matches("\\d{4}-\\d{2}-\\d{2}")) return null;
        int y = Integer.parseInt(s.substring(0, 4)), mo = Integer.parseInt(s.substring(5, 7)), d = Integer.parseInt(s.substring(8, 10));
        if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
        return epochDay(y, mo - 1, d);
    }

    private static long epochDay(int y, int month0, int d) {
        Calendar u = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
        u.clear();
        u.set(y, month0, d);
        return Math.floorDiv(u.getTimeInMillis(), 86400000L);
    }

    static long today() {
        Calendar now = Calendar.getInstance();
        return epochDay(now.get(Calendar.YEAR), now.get(Calendar.MONTH), now.get(Calendar.DAY_OF_MONTH));
    }

    /** Whole months from day a to day b (a <= b) and the days left over. */
    private static long[] monthsBetween(long a, long b) {
        Calendar ca = utc(a), cb = utc(b);
        int months = (cb.get(Calendar.YEAR) - ca.get(Calendar.YEAR)) * 12 + cb.get(Calendar.MONTH) - ca.get(Calendar.MONTH);
        if (cb.get(Calendar.DAY_OF_MONTH) < ca.get(Calendar.DAY_OF_MONTH)) months--;
        if (months < 0) months = 0;
        Calendar mid = utc(a);
        mid.add(Calendar.MONTH, months);
        long rest = b - Math.floorDiv(mid.getTimeInMillis(), 86400000L);
        return new long[]{months, rest};
    }

    private static Calendar utc(long dayNum) {
        Calendar u = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
        u.setTimeInMillis(dayNum * 86400000L);
        return u;
    }

    static String days(long n) { return n == 1 ? "יום" : "ימים"; }
    static String months(long n) { return n == 1 ? "חודש" : "חודשים"; }
    static String andDays(long n) { return n == 1 ? "ועוד יום אחד" : n == 2 ? "ועוד יומיים" : "ועוד " + n + " ימים"; }

    /* ------------------------------------------------------------------ drawing */

    static RemoteViews build(Context c) {
        SharedPreferences p = prefs(c);
        boolean pro = "pro".equals(p.getString("theme", "pink"));
        RemoteViews v = new RemoteViews(c.getPackageName(), pro ? R.layout.widget_pro : R.layout.widget_pink);

        String title = p.getString("title", "");
        Long goal = day(p.getString("goal", ""));
        Long start = day(p.getString("start", ""));
        boolean monthsUnit = "months".equals(p.getString("unit", "days"));
        boolean up = "up".equals(p.getString("count", "down"));
        long now = today();

        String label, number, unit = "", sub = "";
        int progress = -1;
        if (goal == null) {
            label = "טיימר ליעד";
            number = "?";
            sub = "הקישי כדי להגדיר יעד";
        } else {
            if (start != null && goal > start) progress = (int) Math.max(0, Math.min(1000, (now - start) * 1000 / (goal - start)));
            if (up && start != null) {
                long passed = now - start;
                if (passed < 0) {
                    label = "מתחילים בעוד"; number = String.valueOf(-passed); unit = days(-passed);
                } else {
                    label = "עברו";
                    if (monthsUnit && passed >= 31) {
                        long[] mr = monthsBetween(start, now);
                        number = String.valueOf(mr[0]); unit = months(mr[0]); sub = mr[1] > 0 ? andDays(mr[1]) : "";
                    } else {
                        number = String.valueOf(passed); unit = days(passed);
                    }
                    long total = goal - start;
                    if (total > 0) sub = (sub.isEmpty() ? "" : sub + " · ") + (passed >= total ? "היעד הושג!" : "מתוך " + total + " ימים");
                }
            } else {
                long left = goal - now;
                if (left > 0) {
                    label = "נשארו";
                    if (monthsUnit && left >= 31) {
                        long[] mr = monthsBetween(now, goal);
                        number = String.valueOf(mr[0]); unit = months(mr[0]); sub = mr[1] > 0 ? andDays(mr[1]) : "";
                    } else {
                        number = String.valueOf(left); unit = days(left);
                    }
                } else if (left == 0) {
                    label = "זה היום!"; number = pro ? "0" : "🎉"; unit = pro ? "ימים" : ""; sub = "בהצלחה!";
                } else {
                    label = "הגעת ליעד"; number = pro ? "✓" : "🏆"; sub = "לפני " + (-left) + " " + days(-left);
                }
            }
        }

        v.setTextViewText(R.id.w_label, label);
        v.setTextViewText(R.id.w_number, number);
        v.setTextViewText(R.id.w_unit, unit);
        v.setViewVisibility(R.id.w_unit, unit.isEmpty() ? View.GONE : View.VISIBLE);
        v.setTextViewText(R.id.w_sub, sub);
        v.setViewVisibility(R.id.w_sub, sub.isEmpty() ? View.GONE : View.VISIBLE);
        v.setTextViewText(R.id.w_title, title.isEmpty() ? (goal == null ? "The Road To 100" : "היעד שלי") : title);
        if (progress >= 0) {
            v.setProgressBar(R.id.w_progress, 1000, progress, false);
            v.setViewVisibility(R.id.w_progress, View.VISIBLE);
        } else {
            v.setViewVisibility(R.id.w_progress, View.GONE);
        }
        v.setTextViewText(R.id.w_sentence, sentence(c, 0));

        Intent open = new Intent(c, MainActivity.class).setAction("com.plap.studystairs.OPEN_WIDGET")
            .putExtra(EXTRA_OPEN, "widget").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        v.setOnClickPendingIntent(R.id.w_root, PendingIntent.getActivity(c, 302, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        Intent nextI = new Intent(c, TimerWidget.class).setAction(ACTION_NEXT);
        v.setOnClickPendingIntent(R.id.w_sentence_box, PendingIntent.getBroadcast(c, 303, nextI, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        return v;
    }

    /** Android 8+: asks the launcher to place the widget (the launcher shows its own dialog). */
    static boolean requestPin(Context c) {
        if (Build.VERSION.SDK_INT < 26) return false;
        AppWidgetManager m = c.getSystemService(AppWidgetManager.class);
        if (m == null || !m.isRequestPinAppWidgetSupported()) return false;
        return m.requestPinAppWidget(new ComponentName(c, TimerWidget.class), null, null);
    }
}
