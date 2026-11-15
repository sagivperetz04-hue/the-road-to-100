package com.plap.studystairs;

import android.app.Activity;
import android.content.pm.ApplicationInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
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
    private static final String START_URL = "https://" + HOST + "/index.html";
    private static final int BG = Color.rgb(0xEE, 0xF3, 0xFF);

    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        styleSystemBars();

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

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl(START_URL);
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

    @Override
    protected void onPause() {
        if (web != null) {
            web.evaluateJavascript("window.Sound && (window.Sound.pause ? window.Sound.pause() : window.Sound.stop())", null);
            web.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
            web.evaluateJavascript("window.Sound && window.Sound.resume && window.Sound.resume()", null);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    @Override
    protected void onDestroy() {
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

        @JavascriptInterface
        public void haptic(final String kind) {
            runOnUiThread(() -> {
                if (web == null) return;
                int c;
                if ("success".equals(kind)) c = Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.VIRTUAL_KEY;
                else if ("error".equals(kind)) c = Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.REJECT : HapticFeedbackConstants.LONG_PRESS;
                else c = HapticFeedbackConstants.KEYBOARD_TAP;
                web.performHapticFeedback(c);
            });
        }

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
