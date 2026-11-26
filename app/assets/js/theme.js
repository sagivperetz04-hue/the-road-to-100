/* Themes: "auto" (follows the phone), "light", "dark", "pink", "gallery" (white gallery, Apple-style). Stored with the rest of the settings in stairs.v1.
   The resolved theme is set as <html data-theme="light|dark|pink">; CSS and the scene take their colours from it. */
(function () {
  const THEMES = ["auto", "light", "dark", "pink", "gallery"];
  const BARS = { light: "#EEF3FF", dark: "#0E1130", pink: "#FFE3F1", gallery: "#F5F5F7" };
  const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const listeners = [];

  function systemDark() {
    try { if (window.AndroidBridge && window.AndroidBridge.isNightMode) return !!window.AndroidBridge.isNightMode(); } catch (e) { /* no bridge */ }
    return !!(media && media.matches);
  }
  const resolve = (setting) => (setting === "auto" || !THEMES.includes(setting) ? (systemDark() ? "dark" : "light") : setting);

  function apply() {
    const t = resolve(Store.theme);
    const root = document.documentElement;
    const changed = root.dataset.theme !== t;
    root.dataset.theme = t;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", BARS[t]);
    try { if (window.AndroidBridge && window.AndroidBridge.setSystemBars) window.AndroidBridge.setSystemBars(BARS[t], t !== "dark"); } catch (e) { /* no bridge */ }
    if (changed) listeners.forEach((fn) => { try { fn(t); } catch (e) { /* ignore */ } });
    return t;
  }

  if (media) {
    const onSys = () => { if (Store.theme === "auto") apply(); };
    if (media.addEventListener) media.addEventListener("change", onSys); else if (media.addListener) media.addListener(onSys);
  }

  window.Theme = {
    THEMES,
    get current() { return resolve(Store.theme); },
    get setting() { return Store.theme; },
    set(setting) { Store.theme = THEMES.includes(setting) ? setting : "auto"; return apply(); },
    apply,
    onChange(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
  };
  apply();
})();
