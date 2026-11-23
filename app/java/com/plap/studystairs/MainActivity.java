package com.plap.studystairs;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ApplicationInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * One Activity hosting a WebView. The HTML/JS game lives in /assets and is served from a
 * virtual https origin (so fetch() and localStorage work and progress persists across updates).
 * Nothing is loaded from the network.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    /** The only place the app may reach online: the question data in the public GitHub repo (read-only). */
    private static final String UPDATE_HOST = "raw.githubusercontent.com";
    private static final String UPDATE_PATH = "/sagivperetz04-hue/the-road-to-100/master/app/assets/data/";
    private static final String START_URL = "https://" + HOST + "/index.html";
    private static final int BG = Color.rgb(0xEE, 0xF3, 0xFF);

    private WebView web;
    /** A repeating vibration the page asked for (the last stair); stopped in the background, restarted on return. */
    private long[] rumble;
    private int rumbleRepeat = -1;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean resumed = false;
    /** Set when the home-screen widget opened the app: the page asks for it once (takeOpen) and shows the widget settings. */
    private volatile String pendingOpen = null;
    /** Android 11+: the stair-19 heartbeat as two crisp "thud" primitives, every 1.1 s (no buzzy waveform). */
    private final Runnable heartbeat = new Runnable() {
        @Override public void run() {
            Vibrator v = vibrator();
            if (v == null || rumble == null || !resumed || !hapticsOn() || Build.VERSION.SDK_INT < 31) return;
            v.vibrate(VibrationEffect.startComposition()
                .addPrimitive(VibrationEffect.Composition.PRIMITIVE_THUD, 1f)
                .addPrimitive(VibrationEffect.Composition.PRIMITIVE_THUD, .55f, 140)
                .compose());
            handler.postDelayed(this, 1100);
        }
    };

    private boolean thudSupported(Vibrator v) {
        return Build.VERSION.SDK_INT >= 31 && v != null && v.hasVibrator()
            && v.areAllPrimitivesSupported(VibrationEffect.Composition.PRIMITIVE_THUD, VibrationEffect.Composition.PRIMITIVE_QUICK_RISE);
    }

    /** The user's "touch feedback" setting also covers our own effects. */
    private boolean hapticsOn() {
        try { return Settings.System.getInt(getContentResolver(), Settings.System.HAPTIC_FEEDBACK_ENABLED, 1) != 0; }
        catch (Exception e) { return true; }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        styleSystemBars();

        pendingOpen = openTarget(getIntent());

        // daily reminders at 08:00 and 20:00; Android 13+ asks once for permission to show notifications
        Reminders.scheduleAll(this);
        // redraw the home-screen widget: today's numbers, and fresh tap actions (a force-stop cancels the old ones)
        TimerWidget.updateAll(this);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }

        // Debug builds only (tools/build.sh --debuggable): lets Chrome DevTools / tests drive the WebView over adb.
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        web.setBackgroundColor(BG);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        // follow the system font size, but cap it so the layout keeps fitting
        int zoom = Math.round(getResources().getConfiguration().fontScale * 100f);
        s.setTextZoom(Math.max(85, Math.min(zoom, 125)));

        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        web.setWebViewClient(new AssetClient());
        setContentView(web);

        // a restored WebView doesn't bring back the live game state; when nothing comes back, start fresh
        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) web.loadUrl(START_URL);
    }

    private static String openTarget(Intent i) {
        return i != null && "widget".equals(i.getStringExtra(TimerWidget.EXTRA_OPEN)) ? "widget" : null;
    }

    /** The app is already open (singleTask) and the widget was tapped: show its settings now. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (openTarget(intent) != null) {
            // kept until the page takes it: the page may still be loading (the activity can come back here after
            // its process was killed). A loaded page opens the settings now and clears it (appOpenWidget).
            pendingOpen = "widget";
            if (web != null) web.evaluateJavascript("window.appOpenWidget && window.appOpenWidget()", null);
        }
    }

    private void styleSystemBars() {
        applyBars(BG, true);
    }

    @SuppressWarnings("deprecation")
    private void applyBars(int color, boolean darkIcons) {
        Window w = getWindow();
        w.setStatusBarColor(color);
        w.setNavigationBarColor(color);
        int flags = 0;
        if (darkIcons && Build.VERSION.SDK_INT >= 23) flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (darkIcons && Build.VERSION.SDK_INT >= 26) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        w.getDecorView().setSystemUiVisibility(flags);
    }

    /** Hardware Back goes one screen back inside the app; on the first screen it exits. */
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web == null) { finish(); return; }
        web.evaluateJavascript("(window.appBack ? window.appBack() : 'exit')", value -> {
            if (value == null || value.contains("exit")) finish();
        });
    }

    @SuppressWarnings("deprecation")
    private Vibrator vibrator() {
        if (Build.VERSION.SDK_INT >= 31) {
            VibratorManager vm = (VibratorManager) getSystemService(VIBRATOR_MANAGER_SERVICE);
            return vm != null ? vm.getDefaultVibrator() : null;
        }
        return (Vibrator) getSystemService(VIBRATOR_SERVICE);
    }

    @SuppressWarnings("deprecation")
    private void startVibration(long[] timings, int repeat) {
        Vibrator v = vibrator();
        if (v == null || !v.hasVibrator() || !resumed || !hapticsOn()) return;
        handler.removeCallbacks(heartbeat);
        v.cancel();
        if (repeat >= 0 && thudSupported(v)) {
            // a rising rumble, then the heartbeat loop
            v.vibrate(VibrationEffect.startComposition()
                .addPrimitive(VibrationEffect.Composition.PRIMITIVE_QUICK_RISE, 1f)
                .addPrimitive(VibrationEffect.Composition.PRIMITIVE_THUD, 1f, 60)
                .compose());
            handler.postDelayed(heartbeat, 700);
            return;
        }
        if (Build.VERSION.SDK_INT >= 26) {
            int[] amps = new int[timings.length];
            for (int i = 0; i < amps.length; i++) amps[i] = i % 2 == 0 ? 0 : 255;   // even = pause, odd = full strength
            v.vibrate(VibrationEffect.createWaveform(timings, amps, repeat));
        } else {
            v.vibrate(timings, repeat);
        }
    }

    private void stopVibration() {
        handler.removeCallbacks(heartbeat);
        Vibrator v = vibrator();
        if (v != null) v.cancel();
    }

    @Override
    protected void onPause() {
        resumed = false;
        stopVibration();
        if (web != null) {
            web.evaluateJavascript("window.Sound && (window.Sound.pause ? window.Sound.pause() : window.Sound.stop())", null);
            web.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        if (web != null) {
            web.onResume();
            web.evaluateJavascript("window.Sound && window.Sound.resume && window.Sound.resume()", null);
        }
        if (rumble != null) startVibration(rumble, rumbleRepeat);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    /** Small native helpers the page may call. */
    private final class Bridge {
        /** For the "auto" theme: is the phone in dark mode? (The WebView itself always reports light.) */
        @JavascriptInterface
        public boolean isNightMode() {
            return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        }

        /** Colours the status and navigation bars to match the page's theme. */
        @JavascriptInterface
        public void setSystemBars(final String hex, final boolean darkIcons) {
            runOnUiThread(() -> {
                int c;
                try { c = Color.parseColor(hex); } catch (IllegalArgumentException e) { return; }
                applyBars(c, darkIcons);
                if (web != null) web.setBackgroundColor(c);
            });
        }

        /** Semantic system haptics: tap, success (CONFIRM), error (REJECT), heavy (a milestone). */
        @JavascriptInterface
        public void haptic(final String kind) {
            runOnUiThread(() -> {
                if (web == null) return;
                if ("heavy".equals(kind)) {
                    Vibrator v = vibrator();
                    if (Build.VERSION.SDK_INT >= 29 && v != null && v.hasVibrator()) {
                        if (hapticsOn()) v.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_HEAVY_CLICK));
                        return;
                    }
                    web.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS);
                    return;
                }
                int c;
                if ("success".equals(kind)) c = Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.VIRTUAL_KEY;
                else if ("error".equals(kind)) c = Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.REJECT : HapticFeedbackConstants.LONG_PRESS;
                else c = HapticFeedbackConstants.VIRTUAL_KEY;
                web.performHapticFeedback(c);
            });
        }

        /** Pattern "off,on,off,on,..." in ms; repeat = index to loop from (-1 = once) until stopVibrate(). */
        @JavascriptInterface
        public void vibrate(final String pattern, final int repeat) {
            final long[] t;
            try {
                String[] parts = pattern.split(",");
                if (parts.length < 2 || parts.length > 64) return;
                t = new long[parts.length];
                for (int i = 0; i < parts.length; i++) t[i] = Math.max(0, Math.min(5000, Long.parseLong(parts[i].trim())));
            } catch (NumberFormatException e) { return; }
            final int rep = repeat >= 0 && repeat < t.length ? repeat : -1;
            runOnUiThread(() -> {
                rumble = rep >= 0 ? t : null;
                rumbleRepeat = rep;
                startVibration(t, rep);
            });
        }

        @JavascriptInterface
        public void stopVibrate() {
            runOnUiThread(() -> { rumble = null; rumbleRepeat = -1; stopVibration(); });
        }

        /** Debug builds only: show reminder 0 (morning) or 1 (evening) now, to test it. */
        @JavascriptInterface
        public void testReminder(final int which) {
            if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) == 0 || which < 0 || which > 1) return;
            Reminders.show(MainActivity.this, which);
        }

        /* ---- home-screen widget (TimerWidget) ---- */

        /** The widget's settings as JSON: {title, start, goal, unit, count, theme}. */
        @JavascriptInterface
        public String widgetGet() { return TimerWidget.settingsJson(MainActivity.this); }

        /** Saves the settings and redraws every placed widget. */
        @JavascriptInterface
        public boolean widgetSave(String json) { return json != null && json.length() < 2000 && TimerWidget.save(MainActivity.this, json); }

        /** Today's sentence (the same one the widget shows). */
        @JavascriptInterface
        public String widgetSentence() { return TimerWidget.sentence(MainActivity.this, 0); }

        /** Moves the widget on to the next sentence and returns it. */
        @JavascriptInterface
        public String widgetNext() { TimerWidget.next(MainActivity.this); return TimerWidget.sentence(MainActivity.this, 0); }

        /** How many timer widgets are on the home screen. */
        @JavascriptInterface
        public int widgetCount() { return TimerWidget.count(MainActivity.this); }

        /** Asks the launcher to add the widget (it shows its own dialog); false when the launcher can't. */
        @JavascriptInterface
        public boolean widgetPin() { return TimerWidget.requestPin(MainActivity.this); }

        /** "widget" once when the widget opened the app, else "". */
        @JavascriptInterface
        public String takeOpen() { String o = pendingOpen; pendingOpen = null; return o == null ? "" : o; }

        @JavascriptInterface
        public void exitApp() {
            runOnUiThread(MainActivity.this::finish);
        }
    }

    /** Serves /assets at https://appassets.androidplatform.net/ and blocks everything else. */
    private final class AssetClient extends WebViewClient {
        private final Map<String, String> mime = new HashMap<>();

        AssetClient() {
            mime.put("html", "text/html");
            mime.put("css", "text/css");
            mime.put("js", "text/javascript");
            mime.put("json", "application/json");
            mime.put("svg", "image/svg+xml");
            mime.put("png", "image/png");
            mime.put("jpg", "image/jpeg");
            mime.put("webp", "image/webp");
            mime.put("woff2", "font/woff2");
            mime.put("woff", "font/woff");
            mime.put("mp3", "audio/mpeg");
            mime.put("m4a", "audio/mp4");
            mime.put("aac", "audio/aac");
            mime.put("ogg", "audio/ogg");
            mime.put("wav", "audio/wav");
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return !HOST.equals(request.getUrl().getHost());   // stay inside the app
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (!HOST.equals(url.getHost())) {
                // question updates: GET of a .json file in the repo's data folder, nothing else
                String p = url.getPath();
                if ("https".equals(url.getScheme()) && UPDATE_HOST.equals(url.getHost()) && "GET".equals(request.getMethod())
                        && p != null && p.startsWith(UPDATE_PATH) && p.endsWith(".json") && !p.contains("..")) {
                    return null;   // let the WebView fetch it from the network
                }
                return empty(403, "Offline app");
            }
            String path = url.getPath();
            if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
            path = path.substring(1);
            if (path.contains("..")) return empty(404, "Not found");
            String ext = path.lastIndexOf('.') >= 0 ? path.substring(path.lastIndexOf('.') + 1).toLowerCase() : "";
            String type = mime.containsKey(ext) ? mime.get(ext) : "application/octet-stream";
            try {
                InputStream in = getAssets().open(path);
                boolean text = type.startsWith("text/") || type.equals("application/json") || type.equals("image/svg+xml");
                WebResourceResponse r = new WebResourceResponse(type, text ? "utf-8" : null, in);
                Map<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-cache");
                headers.put("Access-Control-Allow-Origin", "https://" + HOST);
                r.setResponseHeaders(headers);
                return r;
            } catch (IOException e) {
                return empty(404, "Not found");
            }
        }

        private WebResourceResponse empty(int code, String reason) {
            return new WebResourceResponse("text/plain", "utf-8", code, reason, new HashMap<>(), new ByteArrayInputStream(new byte[0]));
        }
    }
}
