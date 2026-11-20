/* App: navigation stack, the four screens, overlays and the staircase game. */
(function () {
  "use strict";
  const GOAL = 20;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const plural = (n, one, many) => (n === 1 ? one : `${n} ${many}`);
  const nQuestions = (n) => plural(n, "שאלה אחת", "שאלות");
  const nTopics = (n) => plural(n, "נושא אחד", "נושאים");
  const ltr = (s) => `<bdi dir="ltr">${esc(s)}</bdi>`;
  const haptic = (kind) => { try { if (window.AndroidBridge && window.AndroidBridge.haptic) window.AndroidBridge.haptic(kind); } catch (e) { /* no bridge in the browser */ } };
  /** Android-style pattern [off, on, off, on, ...] in ms; repeat = index to loop from, or -1 for once. */
  const vibrate = (pattern, repeat) => {
    try {
      if (window.AndroidBridge && window.AndroidBridge.vibrate) window.AndroidBridge.vibrate(pattern.join(","), repeat == null ? -1 : repeat);
      else if (navigator.vibrate) navigator.vibrate(pattern.slice(1));
    } catch (e) { /* no vibrator */ }
  };
  const stopVibrate = () => {
    try {
      if (window.AndroidBridge && window.AndroidBridge.stopVibrate) window.AndroidBridge.stopVibrate();
      else if (navigator.vibrate) navigator.vibrate(0);
    } catch (e) { /* no vibrator */ }
  };
  const LETTERS = ["א", "ב", "ג", "ד"];
  const SOURCE_INFO = {
    real: { title: "שאלות אמיתיות", desc: "ממבחנים, בחנים ומהמרצה", icon: "exam", color: "linear-gradient(145deg,#34C759,#248A3D)", badge: "אמיתית" },
    generated: { title: "שאלות כלליות", desc: "נוצרו בבינה מלאכותית מתוך הסיכומים של הקורס", icon: "sparkles", color: "linear-gradient(145deg,#BF5AF2,#8944AB)", badge: "כללית" },
    mixed: { title: "מעורב", desc: "גם אמיתיות וגם כלליות, בסדר אקראי", icon: "shuffle", color: "linear-gradient(145deg,#FF9F0A,#FF6B00)", badge: "" },
  };

  function courseColor(c) {
    const base = c.color || "#007AFF";
    return `linear-gradient(145deg, ${base}, ${shade(base, -0.22)})`;
  }
  function shade(hex, amt) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v + (amt < 0 ? v * amt : (255 - v) * amt))));
    return "#" + [f(n >> 16), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, "0")).join("");
  }

  /* ------------------------------------------------------------------ navigation stack */
  const stackEl = $("#stack");
  const stack = [];
  const overlays = [];
  let busy = false;

  async function push(scr) {
    if (busy) return;
    busy = true;
    const prev = stack[stack.length - 1];
    stack.push(scr);
    scr.el.classList.add("screen");
    if (prev) {
      scr.el.classList.add("is-enter");
      stackEl.appendChild(scr.el);
      void scr.el.offsetWidth;
      scr.el.classList.remove("is-enter");
      prev.el.classList.add("is-under");
      await wait(reduced() ? 0 : 310);
      prev.el.classList.add("is-hidden");
    } else {
      stackEl.appendChild(scr.el);
    }
    busy = false;
    syncMusic();
    if (scr.onShow) scr.onShow();
  }

  async function pop() {
    if (busy || stack.length < 2) return;
    busy = true;
    const cur = stack.pop();
    const prev = stack[stack.length - 1];
    prev.el.classList.remove("is-hidden");
    void prev.el.offsetWidth;
    prev.el.classList.remove("is-under");
    cur.el.classList.add("is-leave");
    await wait(reduced() ? 0 : 310);
    if (cur.destroy) cur.destroy();
    cur.el.remove();
    busy = false;
    syncMusic();
    if (prev.onShow) prev.onShow();
  }

  // background music follows the top screen: the game has its own playlist, every other screen plays "menu"
  function syncMusic() {
    const top = stack[stack.length - 1];
    if (top) Sound.music(top.el.dataset.screen === "mode" ? null : top.el.dataset.screen === "game" ? "game" : "menu");
  }

  function back() {
    const ov = overlays[overlays.length - 1];
    if (ov) { ov.onBack(); return "handled"; }
    if (stack.length <= 1) return (stack[0] && stack[0].onRootBack && stack[0].onRootBack()) || "exit";
    const top = stack[stack.length - 1];
    if (top.onBack) top.onBack(); else pop();
    return "handled";
  }
  // Android: MainActivity.onBackPressed() -> evaluateJavascript("appBack()") ; "exit" closes the app
  window.appBack = back;
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" || e.key === "BrowserBack") back(); });

  function navbar(opts) {
    return `<div class="navbar">
      ${opts.back ? `<button class="nav-back" data-act="back" aria-label="חזרה ל${esc(opts.back)}">${Icons.back()}<span>${esc(opts.back)}</span></button>` : '<span class="nav-spacer"></span>'}
      <div class="nav-title" aria-hidden="true">${esc(opts.title)}</div>
      ${opts.action || '<span class="nav-spacer"></span>'}
    </div>`;
  }
  function wireScroller(el) {
    const sc = $(".scroller", el);
    if (sc) sc.addEventListener("scroll", () => el.classList.toggle("scrolled", sc.scrollTop > 36), { passive: true });
    const b = $('[data-act="back"]', el);
    if (b) b.addEventListener("click", () => { Sound.sfx("tap"); back(); });
  }

  /* ------------------------------------------------------------------ overlays */
  function showAlert({ title, message, buttons, stacked }) {
    return new Promise((resolve) => {
      const layer = h(`<div class="dim-layer" role="alertdialog" aria-modal="true" aria-labelledby="al-t">
        <div class="alert"><div class="alert-body"><div class="alert-title" id="al-t">${esc(title)}</div>${message ? `<div class="alert-msg">${esc(message)}</div>` : ""}</div>
        <div class="alert-actions ${stacked ? "stacked" : ""}">${buttons.map((b, i) => `<button data-i="${i}" class="${b.style || ""}">${esc(b.text)}</button>`).join("")}</div></div></div>`);
      const cancelIdx = Math.max(0, buttons.findIndex((b) => b.cancel));
      const close = (i) => { layer.remove(); overlays.splice(overlays.indexOf(entry), 1); resolve(buttons[i].value); };
      const entry = { onBack: () => close(cancelIdx) };
      overlays.push(entry);
      $$("button", layer).forEach((b) => b.addEventListener("click", () => close(+b.dataset.i)));
      $("#overlay-root").appendChild(layer);
      const def = $$("button", layer).find((b) => b.classList.contains("bold")) || $("button", layer);
      if (def) def.focus({ preventScroll: true });
    });
  }

  /* ------------------------------------------------------------------ theme picker (bottom sheet) */
  const THEME_INFO = [
    { id: "auto", name: "אוטומטי", sub: "לפי הטלפון: בהיר או כהה" },
    { id: "light", name: "בהיר", sub: "שמיים כחולים ושמש" },
    { id: "dark", name: "כהה", sub: "לילה, ירח וכוכבים" },
    { id: "pink", name: "ורוד", sub: "קשת, סוכריות וחדי־קרן" },
  ];
  function themeSheet() {
    const layer = h(`<div class="dim-layer sheet-layer" role="dialog" aria-modal="true" aria-labelledby="th-t">
      <div class="sheet"><div class="grabber"></div><h2 id="th-t">ערכת צבעים</h2><p>איך המשחק ייראה. אפשר להחליף מתי שרוצים.</p>
        <div class="theme-grid">${THEME_INFO.map((t) => `<button class="theme-opt" data-theme-opt="${t.id}" aria-pressed="false">
          <span class="tp-art ${t.id === "auto" ? "split" : ""}" style="display:block">${t.id === "auto" ? `<div>${Art.banner("light")}</div><div>${Art.banner("dark")}</div>` : Art.banner(t.id)}</span>
          <span class="tp-label"><span><span class="tp-name">${esc(t.name)}</span><span class="tp-sub">${esc(t.sub)}</span></span>${Icons.check().replace('class="check"', 'class="tp-check"')}</span>
        </button>`).join("")}</div></div></div>`);
    const paint = () => $$(".theme-opt", layer).forEach((b) => { const on = b.dataset.themeOpt === Theme.setting; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on ? "true" : "false"); });
    const close = () => { layer.remove(); overlays.splice(overlays.indexOf(entry), 1); };
    const entry = { onBack: close };
    overlays.push(entry);
    layer.addEventListener("click", (e) => { if (e.target === layer) { Sound.sfx("tap"); close(); } });
    $$(".theme-opt", layer).forEach((b) => b.addEventListener("click", () => {
      Sound.sfx("tap"); haptic("tap");
      Theme.set(b.dataset.themeOpt);
      paint();
    }));
    paint();
    $("#overlay-root").appendChild(layer);
    const cur = $(".theme-opt.on", layer);
    if (cur) cur.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------------ screen 1: courses */
  function coursesScreen() {
    const el = h(`<section data-screen="courses">
      ${navbar({ title: "בחרי קורס", action: `<span class="nav-actions"><button class="nav-action" data-act="theme" aria-label="ערכת צבעים">${Icons.palette()}</button>${Sound.hasMusic && Store.mode !== "boring" ? '<button class="nav-action" data-act="music" aria-label="מוזיקה"></button>' : ""}<button class="nav-action" data-act="sound" aria-label="צלילים"></button></span>` })}
      <div class="scroller">
        <div class="banner" data-banner aria-hidden="true"></div>
        <div class="large-title"><h1>בחרי קורס</h1><p>20 תשובות נכונות ברצף = פסגה.</p>
          <button class="mode-pill ${Store.mode}" data-act="mode">מצב: ${Store.mode === "boring" ? "משעמם" : "למגניבים בלבד"}<span>החלפה</span></button></div>
        <div class="group" data-list></div>
        <div class="section-footer">ההתקדמות נשמרת במכשיר הזה.</div>
      </div></section>`);
    wireScroller(el);
    const snd = $('[data-act="sound"]', el);
    const paintSound = () => { snd.innerHTML = Icons.sound(Store.sound); snd.setAttribute("aria-pressed", Store.sound ? "true" : "false"); snd.setAttribute("aria-label", Store.sound ? "השתקת צלילים" : "הפעלת צלילים"); };
    snd.addEventListener("click", () => { Store.sound = !Store.sound; if (!Store.sound) Sound.stop(); else { Sound.unlock(); Sound.sfx("tap"); } Sound.refresh(); paintSound(); });
    paintSound();
    const mus = $('[data-act="music"]', el);
    if (mus) {
      const paintMusic = () => { mus.innerHTML = Icons.music(Store.music); mus.setAttribute("aria-pressed", Store.music ? "true" : "false"); mus.setAttribute("aria-label", Store.music ? "השתקת מוזיקה" : "הפעלת מוזיקה"); };
      mus.addEventListener("click", () => { Store.music = !Store.music; Sound.unlock(); Sound.sfx("tap"); Sound.refresh(); paintMusic(); });
      paintMusic();
      Sound.onChange(() => { paintMusic(); paintSound(); });   // the music tab's play button can switch them on
    }

    const paintBanner = () => { $("[data-banner]", el).innerHTML = Art.banner(Theme.current); };
    paintBanner();
    Theme.onChange(paintBanner);
    $('[data-act="theme"]', el).addEventListener("click", () => { Sound.unlock(); Sound.sfx("tap"); haptic("tap"); themeSheet(); });
    $('[data-act="mode"]', el).addEventListener("click", () => { Sound.sfx("tap"); haptic("tap"); resetRoot(modeScreen()); });

    function render() {
      const list = $("[data-list]", el);
      list.innerHTML = Data.courses.map((c) => {
        const best = Store.bestForCourse(c.id);
        return `<button class="row course-row" data-id="${esc(c.id)}">
          <span class="icon-tile" style="background:${courseColor(c)}">${(Icons[c.icon] || Icons.book)()}</span>
          <span class="row-body"><span class="row-title">${esc(c.name)}</span>
            <span class="row-sub"><span class="meta-item">${ltr(c.code)}</span> · <span class="meta-item">${nTopics(c.topics.length)}</span> · <span class="meta-item">${nQuestions(c.questions.length)}</span></span>
            <span class="row-meta"><span class="best-pill ${best ? "" : "zero"}" aria-label="שיא רצף ${best}">${Icons.flame()}${best ? `שיא ${best} ברצף` : "עוד אין שיא"}</span>${best ? `<span class="course-progress" style="--p:${(Math.min(best, GOAL) / GOAL).toFixed(2)}" aria-hidden="true"><i></i></span>` : ""}</span></span>
          <span class="row-trail">${Icons.chevron()}</span>
        </button>`;
      }).join("");
      $$(".course-row", list).forEach((b) => b.addEventListener("click", () => {
        Sound.unlock(); Sound.sfx("tap"); haptic("tap");
        push(topicsScreen(Data.course(b.dataset.id)));
      }));
    }
    render();
    return { el, onShow: render };
  }

  /* ------------------------------------------------------------------ screen 2: topics */
  function topicsScreen(course) {
    const all = course.topics.map((t) => t.id);
    const saved = (Store.lastTopics(course.id) || []).filter((t) => all.includes(t));
    let selected = new Set(saved.length ? saved : all);
    const countFor = (tid) => course.questions.filter((q) => q.topic === tid).length;

    const el = h(`<section data-screen="topics">
      ${navbar({ title: "על מה מתרגלים?", back: "קורסים" })}
      <div class="scroller has-footer">
        <div class="large-title"><h1>על מה מתרגלים?</h1><p>${esc(course.name)}</p></div>
        <div class="group">
          <button class="row pressable" data-all role="switch">
            <span class="row-body"><span class="row-title">כל הנושאים</span><span class="row-sub">${nQuestions(course.questions.length)} בסך הכול</span></span>
            <span class="switch" aria-hidden="true"></span>
          </button>
        </div>
        <div class="section-header">נושאים</div>
        <div class="group" data-topics>
          ${course.topics.map((t) => {
            const n = countFor(t.id);
            return `<button class="row topic-row ${n ? "" : "empty"}" data-tid="${esc(t.id)}" role="checkbox">
              <span class="row-body"><span class="row-title">${esc(t.name)}</span>${t.note || !n ? `<span class="row-sub">${esc(n ? t.note : "אין עדיין שאלות בנושא הזה")}</span>` : ""}</span>
              <span class="row-trail"><span class="count-badge">${n}</span>${Icons.check()}</span>
            </button>`;
          }).join("")}
        </div>
        <div class="section-footer">בחירה של נושא אחד מכבה את "כל הנושאים". בחירה של כולם מדליקה אותו שוב.</div>
      </div>
      <div class="footer-bar"><div class="footer-note" data-note></div><button class="btn-primary" data-go>המשך</button></div>
    </section>`);
    wireScroller(el);

    const allBtn = $("[data-all]", el);
    const sw = $(".switch", allBtn);
    const go = $("[data-go]", el);
    function paint() {
      const allOn = selected.size === all.length;
      sw.classList.toggle("on", allOn);
      allBtn.setAttribute("aria-checked", allOn ? "true" : "false");
      $$(".topic-row", el).forEach((r) => {
        const on = selected.has(r.dataset.tid);
        r.classList.toggle("selected", on);
        r.setAttribute("aria-checked", on ? "true" : "false");
      });
      const n = Data.count(course, [...selected], "mixed");
      go.disabled = selected.size === 0;
      $("[data-note]", el).textContent = selected.size ? `${allOn ? "כל הנושאים" : nTopics(selected.size)} · ${nQuestions(n)}` : "צריך לבחור לפחות נושא אחד";
    }
    allBtn.addEventListener("click", () => {
      Sound.sfx("tap"); haptic("tap");
      selected = selected.size === all.length ? new Set() : new Set(all);
      paint();
    });
    $$(".topic-row", el).forEach((r) => r.addEventListener("click", () => {
      Sound.sfx("tap"); haptic("tap");
      const tid = r.dataset.tid;
      if (selected.size === all.length) selected = new Set([tid]);   // "all" on: picking one topic turns "all" off
      else if (selected.has(tid)) selected.delete(tid);
      else selected.add(tid);                                         // picking the last missing one turns "all" back on
      paint();
    }));
    go.addEventListener("click", () => {
      if (!selected.size) return;
      Sound.sfx("tap"); haptic("tap");
      const topics = all.filter((t) => selected.has(t));
      Store.setLastTopics(course.id, topics);
      push(sourceScreen(course, topics));
    });
    paint();
    return { el };
  }

  /* ------------------------------------------------------------------ screen 3: question source */
  function sourceScreen(course, topics) {
    const allTopics = topics.length === course.topics.length;
    const el = h(`<section data-screen="source">
      ${navbar({ title: "איזה שאלות?", back: "נושאים" })}
      <div class="scroller">
        <div class="large-title"><h1>איזה שאלות?</h1><p>${esc(course.name)}</p></div>
        <div class="picked">${allTopics ? `<span class="chip blue">כל הנושאים</span>` : topics.map((t) => `<span class="chip">${esc(Data.topicName(course, t))}</span>`).join("")}</div>
        <div class="cards" data-cards></div>
      </div></section>`);
    wireScroller(el);

    function card(source, n) {
      const info = SOURCE_INFO[source];
      const st = Store.sourceStats(course.id, source);
      const meta = n
        ? `<div class="src-meta"><span class="chip blue">${nQuestions(n)}</span>${st.best ? `<span class="chip pink">${Icons.flame()}שיא ${st.best}</span>` : ""}${st.summits ? `<span class="chip">${Icons.trophy()}${plural(st.summits, "פסגה אחת", "פסגות")}</span>` : ""}</div>`
        : `<div class="src-empty">אין עדיין שאלות כאלה בנושאים שבחרת</div>`;
      return `<button class="src-card" data-src="${source}" ${n ? "" : "disabled aria-disabled=\"true\""}>
        <span class="icon-tile" style="background:${info.color}">${Icons[info.icon]()}</span>
        <span class="row-body"><span class="src-title" style="display:block">${esc(info.title)}</span><span class="src-desc" style="display:block">${esc(info.desc)}</span>${meta}</span>
        ${n ? Icons.chevron() : ""}
      </button>`;
    }
    function render() {
      const real = Data.count(course, topics, "real");
      const gen = Data.count(course, topics, "generated");
      const cards = $("[data-cards]", el);
      cards.innerHTML = card("real", real) + card("generated", gen) + (real && gen ? card("mixed", real + gen) : "");
      $$(".src-card:not(:disabled)", cards).forEach((b) => b.addEventListener("click", () => {
        Sound.unlock(); Sound.sfx("tap"); haptic("tap");
        Store.setLastTopics(course.id, topics, b.dataset.src);
        push(gameScreen(course, topics, b.dataset.src));
      }));
    }
    render();
    return { el, onShow: render };
  }

  /* ------------------------------------------------------------------ screen 4: the game */
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  /** Weighted shuffle: questions answered wrong before get weight ×2. Never the same question back to back. */
  function buildDeck(pool, lastId) {
    const keyed = pool.map((q) => {
      const w = Store.qStats(q.id).wrong > 0 ? 2 : 1;
      return { q, k: Math.pow(Math.random(), 1 / w) };
    });
    keyed.sort((a, b) => b.k - a.k);
    const deck = keyed.map((x) => x.q);
    if (deck.length > 1 && deck[0].id === lastId) [deck[0], deck[1]] = [deck[1], deck[0]];
    return deck;
  }

  let rageN = 0;
  function gameScreen(course, topics, source) {
    const pool = Data.pool(course, topics, source);
    let deck = [], lastId = null, current = null, order = [], answered = false;
    let streak = 0, summitOpen = false, alive = true, islandTimer = 0, started = false;
    const C = 2 * Math.PI * 18;

    const el = h(`<section data-screen="game" class="game">
      <div class="game-top">
        <button class="round-btn" data-act="leave" aria-label="יציאה מהמשחק">${Icons.back()}</button>
        <div class="island" data-island aria-live="polite"><div class="isl-content"></div></div>
        <div class="ring-wrap" data-ringwrap>
          <span class="ring-label">רצף<b data-best></b></span>
          <div class="ring" data-ring role="img">
            <svg viewBox="0 0 44 44"><defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF2D55"/><stop offset="1" stop-color="#FF6482"/></linearGradient></defs>
              <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(255,45,85,.18)" stroke-width="5.5"/>
              <circle class="arc" cx="22" cy="22" r="18" fill="none" stroke="url(#ringGrad)" stroke-width="5.5" stroke-linecap="round" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${C.toFixed(2)}"/></svg>
            <span class="ring-num" data-num>0</span>
          </div>
        </div>
      </div>
      <div class="scene" data-scene></div>
      <div class="game-body" data-body><div class="qcard" data-card></div></div>
      <div class="game-foot" data-foot><button class="btn-primary" data-next>לשאלה הבאה</button></div>
    </section>`);

    const sceneBox = $("[data-scene]", el);
    const scene = Scene.create(sceneBox, { color: course.color || "#FF9500", theme: Theme.current });
    const stepCap = h('<span class="caption-step" data-stepcap></span>');
    sceneBox.appendChild(stepCap);
    const card = $("[data-card]", el);
    const foot = $("[data-foot]", el);
    const body = $("[data-body]", el);
    const island = $("[data-island]", el);

    function paintRing(pulse) {
      const arc = $(".arc", el);
      arc.setAttribute("stroke-dashoffset", (C * (1 - Math.min(streak, GOAL) / GOAL)).toFixed(2));
      $("[data-num]", el).textContent = streak;
      $("[data-best]", el).textContent = `שיא ${Store.sourceStats(course.id, source).best}`;
      const ring = $("[data-ring]", el);
      ring.setAttribute("aria-label", `רצף ${streak} מתוך ${GOAL}`);
      if (pulse && !reduced()) { ring.classList.remove("pulse"); void ring.offsetWidth; ring.classList.add("pulse"); }
      stepCap.textContent = streak >= GOAL ? "פסגה!" : `מדרגה ${streak} מתוך ${GOAL}`;
    }

    function showIsland(meta) {
      if (!meta) return;
      clearTimeout(islandTimer);
      const content = $(".isl-content", island);
      content.innerHTML = `<span class="isl-art" style="background:${meta.color}">${Icons.note()}</span>
        <span class="isl-text"><span class="isl-kicker" style="display:block">מתנגן עכשיו</span><span class="isl-title" style="display:block">${ltr(meta.title)}</span></span>
        <span class="eq" style="--isl-color:${meta.color}"><i></i><i></i><i></i><i></i></span>`;
      const top = $(".game-top", el);
      island.classList.add("open"); top.classList.add("island-open");
      islandTimer = setTimeout(() => { island.classList.remove("open"); top.classList.remove("island-open"); }, 5000);
    }
    island.addEventListener("click", () => { Sound.stop(); clearTimeout(islandTimer); island.classList.remove("open"); $(".game-top", el).classList.remove("island-open"); });

    /* ---- the last stair (streak 19): red shaking hell, flames, the "final" track at 300% even when muted, vibration */
    let rage = null;
    function rageLayer() {
      const n = ++rageN;
      const flame = (i) => `<i class="flame" style="--i:${i}"><svg viewBox="0 0 40 80" preserveAspectRatio="none" aria-hidden="true">
        <path d="M20 80C3 72 0 54 9 38c2 11 8 14 9 14-4-17 1-35 13-50-2 20 9 28 9 48 0 19-8 29-20 30z" fill="url(#rgF${n})"/>
        <path d="M20 80c-9-4-11-14-6-23 1 6 5 8 5 8-1-10 3-19 9-25-1 11 6 16 5 26-1 9-6 14-13 14z" fill="url(#rgC${n})"/></svg></i>`;
      const skull = (horned) => `<svg viewBox="-20 -12 100 82" aria-hidden="true">
        ${horned ? `<path d="M12 24C-2 18-8 2-4-10 2 2 9 9 18 12zM48 24c14-6 20-22 16-34-6 12-13 19-22 22z" fill="#5A0D00" stroke="#1A0000" stroke-width="1.5"/>` : ""}
        <path d="M30 4C14 4 6 16 6 30c0 10 5 16 10 19v9h28v-9c5-3 10-9 10-19C54 16 46 4 30 4z" fill="#E9DCC6" stroke="#2A0500" stroke-width="2"/>
        <path d="M6 30c3 6 8 9 10 10M54 30c-3 6-8 9-10 10" fill="none" stroke="#B9A88E" stroke-width="2"/>
        <ellipse cx="20" cy="31" rx="7" ry="8" fill="#1A0000"/><ellipse cx="40" cy="31" rx="7" ry="8" fill="#1A0000"/>
        <circle class="eye" cx="20" cy="32" r="3.2" fill="#FF3B00"/><circle class="eye" cx="40" cy="32" r="3.2" fill="#FF3B00"/>
        <path d="M30 38l-4 8h8z" fill="#1A0000"/>
        <path d="M18 51v7M24 51v7M30 51v7M36 51v7M42 51v7" stroke="#2A0500" stroke-width="1.6"/></svg>`;
      const chain = (side) => `<svg class="chain ${side}" viewBox="0 0 20 200" aria-hidden="true">${Array.from({ length: 11 }, (_, k) =>
        k % 2 ? `<rect x="8" y="${k * 18}" width="4" height="22" rx="2" fill="#3B3B40" stroke="#16161A"/>`
              : `<ellipse cx="10" cy="${k * 18 + 10}" rx="6" ry="11" fill="none" stroke="#4A4A50" stroke-width="3.5"/>`).join("")}</svg>`;
      const embers = Array.from({ length: 22 }, () => `<i class="ember" style="--x:${(Math.random() * 100).toFixed(1)}%;--d:${(2.4 + Math.random() * 2.6).toFixed(2)}s;--w:${(-Math.random() * 4).toFixed(2)}s;--dx:${(Math.random() * 60 - 30).toFixed(0)}px"></i>`).join("");
      const row = (cls, count) => `<div class="flames ${cls}">${Array.from({ length: count }, (_, i) => flame(i)).join("")}</div>`;
      return h(`<div class="rage-fx" aria-hidden="true">
        <svg width="0" height="0" style="position:absolute"><defs>
          <linearGradient id="rgF${n}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#FFE27A"/><stop offset=".3" stop-color="#FF9A00"/><stop offset=".7" stop-color="#FF2E00"/><stop offset="1" stop-color="#8A0000" stop-opacity="0"/></linearGradient>
          <linearGradient id="rgC${n}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".45" stop-color="#FFE96B"/><stop offset="1" stop-color="#FFB000" stop-opacity="0"/></linearGradient></defs></svg>
        <div class="hell-sky"></div>
        <div class="demon">${skull(true)}</div>
        ${chain("left")}${chain("right")}
        <div class="pike left">${skull(false)}<i></i></div><div class="pike right">${skull(false)}<i></i></div>
        ${row("ground", 12)}
        ${row("floor", 9)}
        <div class="embers">${embers}</div>
        <div class="vignette"></div>
      </div>`);
    }
    function setRage(on) {
      if (on === !!rage) return;
      if (on) {
        rage = rageLayer();
        sceneBox.after(rage);
        el.classList.add("rage");
        const slam = h('<div class="slam" aria-live="assertive"><b>שלב אחרון</b><span>טעות אחת – וחוזרים לתחתית</span></div>');
        el.appendChild(slam);
        setTimeout(() => slam.remove(), 2600);
        Sound.final(true);
        // a heavy rumble, then a heartbeat that repeats until the stair is decided
        vibrate([0, 700, 150, 300, 500, 90, 120, 160, 650], 5);
        try { if (window.AndroidBridge && window.AndroidBridge.setSystemBars) window.AndroidBridge.setSystemBars("#1A0300", false); } catch (e) { /* no bridge */ }
      } else {
        rage.remove(); rage = null;
        el.classList.remove("rage");
        Sound.final(false);
        stopVibrate();
        Theme.apply();   // the theme's bar colours again
      }
    }

    function nextQuestion() {
      if (!deck.length) deck = buildDeck(pool, lastId);
      current = deck.shift();
      lastId = current.id;
      order = shuffle([0, 1, 2, 3]);     // never trust the stored option order
      answered = false;
      const info = SOURCE_INFO[current.source];
      card.dataset.qid = current.id;
      card.innerHTML = `
        <div class="q-meta"><div class="q-caption"><span class="q-course">${esc(course.name)}</span><span class="q-topic">${esc(Data.topicName(course, current.topic))}</span></div>
          <span class="badge ${current.source}">${current.source === "real" ? Icons.exam() : Icons.sparkles()}${esc(info.badge)}</span></div>
        <div class="q-text" id="qtext">${esc(current.q)}</div>
        <div class="opts" role="group" aria-labelledby="qtext">
          ${order.map((oi, k) => `<button class="opt" data-oi="${oi}"><span class="opt-letter" aria-hidden="true">${LETTERS[k]}</span><span class="opt-text">${esc(current.options[oi])}</span><span class="opt-mark"></span></button>`).join("")}
        </div>
        <div data-explain></div>`;
      $$(".opt", card).forEach((b) => b.addEventListener("click", () => answer(+b.dataset.oi, b)));
      foot.classList.remove("show");
      body.scrollTop = 0;
    }

    async function answer(oi, btn) {
      if (answered || summitOpen) return;
      answered = true;
      const ok = oi === current.answer;
      Store.recordAnswer(current.id, ok);
      $$(".opt", card).forEach((b) => {
        b.disabled = true;
        const i = +b.dataset.oi;
        if (i === current.answer) { b.classList.add("correct"); $(".opt-mark", b).innerHTML = Icons.tick(); }
        else if (b === btn) { b.classList.add("wrong"); $(".opt-mark", b).innerHTML = Icons.cross(); }
        else b.classList.add("dim");
      });
      $("[data-explain]", card).innerHTML = `<div class="explain ${ok ? "ok" : "bad"}" role="status">
        <h3>${ok ? Icons.tick() : Icons.cross()}${ok ? "נכון!" : "לא נכון – חוזרים למטה"}</h3>
        <div>${esc(current.explanation || "")}</div>${current.ref ? `<div class="ref">מקור: ${esc(current.ref)}</div>` : ""}</div>`;

      if (ok) {
        streak += 1;
        Sound.sfx("correct"); haptic("success");
        celebrate(btn || $(`.opt[data-oi="${current.answer}"]`, card));
        Store.recordStreak(course.id, source, streak);
        paintRing(true);
        const hop = scene.hop();
        if (streak >= GOAL) { setRage(false); await hop; if (alive) openSummit(); return; }
        if (streak === GOAL - 1 && Store.mode !== "boring") setRage(true);
        if (streak % 5 === 0) setTimeout(() => { if (alive) showIsland(Sound.playClip(false)); }, 350);
      } else {
        const had = streak;
        streak = 0;
        setRage(false);
        Sound.sfx("wrong"); haptic("error");
        if (had > 0) setTimeout(() => Sound.sfx("fall"), 120);
        paintRing(false);
        scene.fall();
      }
      foot.classList.add("show");
      $("[data-next]", el).focus({ preventScroll: true });
      requestAnimationFrame(revealExplain);
    }

    /** The "next" bar floats over the bottom of the card: make room for it and scroll the explanation clear of it. */
    function revealExplain() {
      const ex = $(".explain", card);
      if (!ex || !alive) return;
      const footH = foot.offsetHeight;
      body.style.paddingBottom = `${footH + 16}px`;
      const b = body.getBoundingClientRect(), r = ex.getBoundingClientRect();
      const limit = b.bottom - footH - 12;
      // scroll just enough to show the explanation's end, but never push its heading off the top
      const by = Math.min(r.bottom - limit, r.top - b.top - 8);
      if (by > 0) body.scrollBy({ top: by, behavior: reduced() ? "auto" : "smooth" });
    }

    /** A star burst from the answer button and a "+1" by the streak ring. */
    function celebrate(btn) {
      if (reduced() || !btn) return;
      const box = el.getBoundingClientRect(), r = btn.getBoundingClientRect();
      const burst = h('<div class="burst" aria-hidden="true"></div>');
      burst.style.left = `${r.left - box.left + 30}px`; burst.style.top = `${r.top - box.top + r.height / 2}px`;
      const colors = ["#FFC93C", "#FF4FA3", "#4FB8FF", "#5FD68A", "#A77BFF"];
      burst.innerHTML = Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2 + Math.random() * .4, d = 42 + Math.random() * 38;
        return `<i style="--dx:${(Math.cos(a) * d).toFixed(1)}px;--dy:${(Math.sin(a) * d).toFixed(1)}px;--c:${colors[i % colors.length]};animation-delay:${(Math.random() * .06).toFixed(2)}s"></i>`;
      }).join("");
      el.appendChild(burst);
      const ring = $("[data-ring]", el).getBoundingClientRect();
      const plus = h('<div class="plus-one" aria-hidden="true">+1</div>');
      plus.style.left = `${ring.left - box.left + ring.width / 2 - 12}px`; plus.style.top = `${ring.bottom - box.top + 2}px`;
      el.appendChild(plus);
      setTimeout(() => { burst.remove(); plus.remove(); }, 1100);
    }

    /** The summit confetti show, about 10 seconds (the length of the summit sound):
        cannons from both bottom corners, a steady rain while the chimes play, a big finale at about 6 s.
        Theme shapes: ribbons and dots everywhere, hearts in pink, glowing gold stars in dark. */
    /** The summit's confetti dance (about 10 s, then it stops itself):
        three staggered bursts (1.12 – 2.1 s), then every piece settles into a spot on the screen and dances there in
        waves on a 120 BPM beat (1.3 – 9.8 s), and everything fades out by 10.35 s. onBeat(n) fires on every beat.
        One canvas, DPR capped at 1.5, nothing drawn when reduced motion is on. Returns stop(). */
    function confetti(host, theme, onBeat) {
      if (reduced()) return () => {};
      const cv = document.createElement("canvas");
      cv.setAttribute("aria-hidden", "true");
      host.prepend(cv);
      const ctx = cv.getContext("2d");
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      let W = 0, H = 0;
      const resize = () => { W = cv.width = Math.round(innerWidth * dpr); H = cv.height = Math.round(innerHeight * dpr); };
      resize();
      addEventListener("resize", resize);
      const palette = theme === "pink" ? ["#FF4FA3", "#FF8AC4", "#FFD84D", "#A77BFF", "#5FD68A", "#4FB8FF", "#FFFFFF"]
        : theme === "dark" ? ["#FFD45C", "#FF8FC6", "#9C8FFF", "#5BE3C0", "#7FB8FF", "#FFFFFF"]
        : ["#FF2D55", "#FF9500", "#FFCC00", "#34C759", "#007AFF", "#AF52DE"];
      const shapes = theme === "pink" ? ["rect", "circle", "heart", "star", "ribbon"] : ["rect", "rect", "circle", "star", "ribbon"];
      const N = 128, BEAT = 500, DANCE0 = 1300, DANCE1 = 9800, FADE0 = 9100, FADE1 = 10350;
      const bursts = [[1120, 0.5, 0.36], [1420, 0.22, 0.44], [1720, 0.78, 0.44]];   // [ms, x, y] as fractions
      const parts = [];
      for (let i = 0; i < N; i++) {
        const b = bursts[i % 3];
        const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5, sp = (7 + Math.random() * 9) * dpr;
        parts.push({
          born: b[0], bx: b[1], by: b[2], vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, x: 0, y: 0, live: false,
          hx: 0.04 + Math.random() * 0.92, hy: 0.04 + Math.random() * 0.9,          // its spot in the dance
          r: (6 + Math.random() * 7) * dpr, c: palette[i % palette.length], shape: shapes[i % shapes.length],
          a: Math.random() * 6.28, va: (Math.random() - 0.5) * 0.25, ph: Math.random() * 6.28, sway: (10 + Math.random() * 18) * dpr,
        });
      }
      const ease = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
      function draw(p, alpha) {
        ctx.save(); ctx.globalAlpha = alpha; ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c;
        const r = p.r, sx = Math.cos(p.ph + p.a * 2);      // flip: a piece of paper turning over
        switch (p.shape) {
          case "circle": ctx.beginPath(); ctx.arc(0, 0, r * 0.38, 0, 6.283); ctx.fill(); break;
          case "ribbon": ctx.scale(sx, 1); ctx.fillRect(-r * 0.12, -r * 0.7, r * 0.24, r * 1.4); break;
          case "star": {
            if (theme === "dark") { ctx.shadowColor = p.c; ctx.shadowBlur = 8 * dpr; }
            ctx.beginPath(); const R = r * 0.6, q = R * 0.22;
            ctx.moveTo(0, -R); ctx.quadraticCurveTo(q, -q, R, 0); ctx.quadraticCurveTo(q, q, 0, R);
            ctx.quadraticCurveTo(-q, q, -R, 0); ctx.quadraticCurveTo(-q, -q, 0, -R); ctx.fill(); break;
          }
          case "heart": {
            ctx.scale(sx, 1); ctx.beginPath(); const k = r * 0.11;
            ctx.moveTo(0, 3 * k); ctx.bezierCurveTo(-6 * k, -2 * k, -5 * k, -7 * k, -2.5 * k, -7 * k);
            ctx.bezierCurveTo(-1 * k, -7 * k, 0, -6 * k, 0, -5 * k); ctx.bezierCurveTo(0, -6 * k, 1 * k, -7 * k, 2.5 * k, -7 * k);
            ctx.bezierCurveTo(5 * k, -7 * k, 6 * k, -2 * k, 0, 3 * k); ctx.fill(); break;
          }
          default: ctx.scale(sx, 1); ctx.fillRect(-r / 2, -r / 4, r, r / 2);
        }
        ctx.restore();
      }
      let raf = 0, last = performance.now(), beatN = -1, pulseAt = -1e9;
      const t0 = last;
      const tick = (now) => {
        const dt = Math.min(3, (now - last) / 16.7);
        last = now;
        const t = now - t0;
        // the beat: a pulse that makes the dance jump, and a callback for the monster
        if (t >= DANCE0 && t < DANCE1) {
          const n = Math.floor((t - DANCE0) / BEAT);
          if (n !== beatN) { beatN = n; pulseAt = t; if (onBeat) try { onBeat(n); } catch (e) { /* ignore */ } }
        }
        const pulse = Math.exp(-(t - pulseAt) / 140);              // 1 on the beat, fading fast
        const strong = beatN % 4 === 0 ? 1.6 : 1;                    // every 4th beat is a bigger wave
        const alpha = 1 - ease((t - FADE0) / (FADE1 - FADE0));
        ctx.clearRect(0, 0, W, H);
        for (const p of parts) {
          if (t < p.born) continue;
          if (!p.live) { p.live = true; p.x = p.bx * W; p.y = p.by * H; }
          // burst physics, then glide into the dance spot
          p.vx *= Math.pow(0.95, dt); p.vy = p.vy * Math.pow(0.95, dt) + 0.25 * dpr * dt;
          const bx = p.x + p.vx * dt, by = p.y + p.vy * dt;
          const life = t - p.born, k = ease((life - 500) / 1100);
          const wave = Math.sin(t / 1000 * Math.PI * 2 * 0.5 + p.hx * 7 + p.ph);           // a slow wave across the screen
          const hop = pulse * strong * 26 * dpr * Math.sin(p.hx * 9 + beatN);              // the beat makes rows jump
          const dx = p.hx * W + Math.sin(t / 700 + p.ph) * p.sway;
          const dy = p.hy * H + wave * 22 * dpr - hop;
          p.x = bx + (dx - bx) * k * 0.12 * dt; p.y = by + (dy - by) * k * 0.12 * dt;
          if (k > 0) { p.vx *= 1 - k * 0.2; p.vy *= 1 - k * 0.2; }
          p.a += (p.va + pulse * 0.2) * dt;
          draw(p, alpha);
        }
        if (t < FADE1 + 50) raf = requestAnimationFrame(tick); else stop();
      };
      const stop = () => { cancelAnimationFrame(raf); removeEventListener("resize", resize); cv.remove(); };
      raf = requestAnimationFrame(tick);
      return stop;
    }

    function openSummit() {
      summitOpen = true;
      const summits = Store.recordSummit(course.id, source);
      const st = Store.sourceStats(course.id, source);
      scene.celebrate();
      Sound.music("summit");
      Sound.sfx("correct"); haptic("success");
      // the summit has its own music: show it in the island instead of playing a clip on top of it
      setTimeout(() => { if (alive) showIsland(Sound.hasSceneMusic("summit") ? Sound.nowPlaying("summit") : Sound.playClip(true)); }, 250);
      const theme = Theme.current;
      const buddy = (flip) => theme === "pink"
        ? `<svg class="buddy" viewBox="-40 -70 80 74" aria-hidden="true"><defs>${Art.DEFS}</defs>${Art.unicorn({ flip })}</svg>`
        : "";
      const mini = `<svg class="sm-mini" viewBox="0 0 24 18" aria-hidden="true"><path d="M2 15L1 4l6 5 5-8 5 8 6-5-1 11z" fill="#FFC21A" stroke="#E08A00" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
      const ov = h(`<div class="summit" role="dialog" aria-modal="true" aria-labelledby="sm-t">
        <div class="rays" aria-hidden="true"></div>
        <div class="sm-badge">${mini}<span>${summits === 1 ? "הפסגה הראשונה נכבשה" : `הפסגה מספר ${summits} נכבשה`}</span>${mini}</div>
        <div class="stage">${buddy(true)}<span class="hero-wrap"><span class="sm-sparkle s1"></span><span class="sm-sparkle s2"></span><span class="sm-sparkle s3"></span>${Icons.crown()}
        <svg class="hero" viewBox="-40 -64 80 70" aria-hidden="true"><defs><radialGradient id="heroGrad2" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#FF9BD2"/><stop offset=".55" stop-color="#E05CC8"/><stop offset="1" stop-color="#9B3FC4"/></radialGradient></defs>
          <ellipse cx="-6" cy="-3" rx="5" ry="3.4" fill="#7A3FA8"/><ellipse cx="6" cy="-3" rx="5" ry="3.4" fill="#7A3FA8"/>
          <path d="M-9 -29 L-12 -40 L-3 -32 Z M9 -29 L12 -40 L3 -32 Z" fill="#FFD60A" stroke="#E0A800" stroke-width=".8"/>
          <ellipse cx="0" cy="-17" rx="15" ry="15.5" fill="url(#heroGrad2)"/>
          <path d="M-14 -16 L-24 -30 M14 -16 L24 -30" stroke="#C04FC9" stroke-width="6" stroke-linecap="round"/>
          <path d="M-9 -20 Q-5.5 -25 -2 -20 M2 -20 Q5.5 -25 9 -20" fill="none" stroke="#1c1c1e" stroke-width="1.8" stroke-linecap="round"/>
          <path d="M-6 -14 Q0 -6.5 6 -14 Z" fill="#5B1A61"/>
          <circle cx="-10" cy="-15" r="2.3" fill="#FF6FA8" opacity=".6"/><circle cx="10" cy="-15" r="2.3" fill="#FF6FA8" opacity=".6"/></svg></span>${buddy(false)}</div>
        <div class="kicker">${GOAL} תשובות נכונות ברצף!</div>
        <h2 id="sm-t">ציציפלצת האולטימטיבית</h2>
        <p>${esc(course.name)}</p>
        <div class="sm-chip"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.8l2.5 5.2 5.7.8-4.1 4 1 5.6L10 14.7l-5.1 2.7 1-5.6-4.1-4 5.7-.8z" fill="currentColor"/></svg>הישג מושלם: 20 מתוך 20</div>
        <div class="stats">
          <div class="stat"><b data-to="${summits}">${summits}</b><span>${summits === 1 ? "פסגה ראשונה" : "פסגות בקורס"}</span></div>
          <div class="stat key"><b data-to="${st.best}">${st.best}</b><span>שיא רצף</span></div>
          <div class="stat"><b data-to="${pool.length}">${pool.length}</b><span>שאלות במאגר</span></div>
        </div>
        <div class="actions"><button class="btn-primary" data-again>עוד טיפוס</button><button class="btn-secondary" data-menu>חזרה לבחירת שאלות</button></div>
      </div>`);
      const heroWrap = $(".hero-wrap", ov);
      const stop = confetti(ov, theme, () => {
        if (!heroWrap) return;
        heroWrap.classList.remove("beat"); void heroWrap.offsetWidth; heroWrap.classList.add("beat");
      });
      if (!reduced()) {
        const nums = $$(".stat b[data-to]", ov);
        nums.forEach((n) => { n.textContent = "0"; });
        const c0 = performance.now() + 1750;
        const count = (now) => {
          const k = Math.max(0, Math.min(1, (now - c0) / 1200)), e = 1 - Math.pow(1 - k, 3);
          nums.forEach((n) => { n.textContent = Math.round(+n.dataset.to * e); });
          if (k < 1 && ov.isConnected) requestAnimationFrame(count);
        };
        requestAnimationFrame(count);
      }
      const close = () => { stop(); ov.remove(); overlays.splice(overlays.indexOf(entry), 1); summitOpen = false; Sound.music("game"); };
      const entry = { onBack: () => { close(); pop(); } };
      overlays.push(entry);
      $("[data-again]", ov).addEventListener("click", () => { Sound.sfx("tap"); close(); streak = 0; scene.set(0); paintRing(false); nextQuestion(); });
      $("[data-menu]", ov).addEventListener("click", () => { Sound.sfx("tap"); close(); pop(); });
      $("#overlay-root").appendChild(ov);
      $("[data-again]", ov).focus({ preventScroll: true });
    }

    async function leave() {
      if (summitOpen) return;
      if (streak > 0) {
        const r = await showAlert({
          title: "לצאת? הרצף הנוכחי יאבד",
          buttons: [{ text: "צאי", value: "leave", style: "destructive" }, { text: "המשך לשחק", value: "stay", style: "bold", cancel: true }],
        });
        if (r !== "leave") return;
      }
      pop();
    }

    $('[data-act="leave"]', el).addEventListener("click", () => { Sound.sfx("tap"); leave(); });
    $("[data-next]", el).addEventListener("click", () => { Sound.sfx("tap"); nextQuestion(); });

    async function start() {
      if (started) return;
      started = true;
      paintRing(false);
      if (!pool.length) {
        card.innerHTML = `<div class="q-text">אין שאלות לבחירה הזו.</div>`;
        return;
      }
      if (pool.length < GOAL) {
        await showAlert({
          title: "שימי לב",
          message: `יש רק ${pool.length} שאלות. אחרי שייגמרו הן יחזרו בסדר אחר.`,
          buttons: [{ text: "יאללה, מתחילים", value: "ok", style: "bold", cancel: true }],
        });
        if (!alive) return;
      }
      nextQuestion();
    }

    paintRing(false);
    card.innerHTML = '<div class="q-text" aria-busy="true">&nbsp;</div>';
    return {
      el,
      onShow: start,
      onBack: leave,
      destroy() { alive = false; setRage(false); scene.destroy(); clearTimeout(islandTimer); Sound.stop(); },
    };
  }

  /* ------------------------------------------------------------------ home: the courses and music tabs */
  const fmtTime = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  /** Album-style cover for a song: its colour, a record and its initials (no images needed). */
  function cover(t, cls) {
    const c = (t && t.color) || "#1DB954";
    const words = String((t && t.title) || "").replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
    const ini = words.slice(0, 2).map((w) => w[0]).join("").toUpperCase();
    return `<span class="cover ${cls || ""}" style="--c:${c};--c2:${shade(c, -0.6)}" aria-hidden="true">
      <svg viewBox="0 0 100 100"><circle cx="74" cy="80" r="46" fill="rgba(0,0,0,.3)"/><circle cx="74" cy="80" r="33" fill="none" stroke="rgba(255,255,255,.13)" stroke-width="1.5"/><circle cx="74" cy="80" r="21" fill="none" stroke="rgba(255,255,255,.13)" stroke-width="1.5"/><circle cx="74" cy="80" r="7" fill="rgba(255,255,255,.55)"/></svg>
      <b dir="ltr">${esc(ini)}</b></span>`;
  }
  const eqBars = (on) => `<span class="eq-mini ${on ? "" : "still"}" aria-hidden="true"><i></i><i></i><i></i></span>`;

  function musicPanel() {
    const el = h(`<div class="tab-panel music-tab" data-panel="music">
      <div class="scroller">
        <div class="mt-head" data-head>
          <h1>מוזיקה</h1>
          <div class="np">
            <div class="np-cover" data-np-cover></div>
            <div class="np-text"><div class="np-title" data-np-title></div><div class="np-artist" data-np-artist></div></div>
            <div class="np-bar" data-seek role="slider" tabindex="0" aria-label="מיקום בשיר" aria-valuemin="0" aria-valuemax="100"><i data-np-fill></i></div>
            <div class="np-times"><span data-np-t>0:00</span><span data-np-d>0:00</span></div>
            <div class="np-ctrls">
              <button class="ic small" data-p-shuffle aria-label="ערבוב">${Icons.shuffle()}</button>
              <button class="ic" data-p-prev aria-label="השיר הקודם">${Icons.prev()}</button>
              <button class="big" data-p-play aria-label="נגינה"></button>
              <button class="ic" data-p-next aria-label="השיר הבא">${Icons.next()}</button>
              <button class="ic small" data-p-music aria-label="מוזיקה ברקע"></button>
            </div>
            <div class="np-note" data-np-note></div>
          </div>
        </div>
        <h2 class="mt-h">הפלייליסט שלך <span data-count></span></h2>
        <p class="mt-sub">נגיעה בשיר מנגנת אותו. ${Icons.added()} = בפלייליסט של התפריט והמשחק.</p>
        <div class="tracks" data-tracks></div>
        <h2 class="mt-h">שיר הפסגה</h2><p class="mt-sub">מתנגן כשמגיעים ל־20 ברצף.</p>
        <div class="pick-row" data-pick="summit"></div>
        <h2 class="mt-h">שיר המדרגה האחרונה</h2><p class="mt-sub">מדרגה 19: מתנגן חזק פי 3, גם כשהצלילים כבויים.</p>
        <div class="pick-row" data-pick="final"></div>
        <p class="mt-foot">הבחירות נשמרות במכשיר הזה.</p>
      </div></div>`);
    const lib = Sound.library();
    let visible = false, ticker = 0, lastKey = "";

    function paintProgress() {
      const p = Sound.player();
      const pct = p.duration ? Math.min(100, (p.time / p.duration) * 100) : 0;
      $("[data-np-fill]", el).style.setProperty("--p", pct.toFixed(2) + "%");
      $("[data-seek]", el).setAttribute("aria-valuenow", Math.round(pct));
      $("[data-np-t]", el).textContent = fmtTime(p.time);
      $("[data-np-d]", el).textContent = fmtTime(p.duration);
    }

    function paint() {
      const p = Sound.player(), pr = Sound.prefs();
      const cur = p.file ? lib.find((t) => t.file === p.file) || p : lib.find((t) => t.file === pr.playlist[0]) || lib[0];
      const head = $("[data-head]", el);
      head.style.setProperty("--hc", shade((cur && cur.color) || "#1DB954", -0.25));
      // the big cover and titles only change with the song
      const key = (cur && cur.file) + "|" + p.final;
      if (key !== lastKey) {
        lastKey = key;
        $("[data-np-cover]", el).innerHTML = cover(cur, "lg");
        $("[data-np-title]", el).innerHTML = cur ? ltr(cur.title) : "";
        $("[data-np-artist]", el).innerHTML = cur ? ltr(cur.artist) : "";
      }
      const play = $("[data-p-play]", el);
      play.innerHTML = p.playing ? Icons.pause() : Icons.play();
      play.setAttribute("aria-label", p.playing ? "השהיה" : "נגינה");
      const sh = $("[data-p-shuffle]", el);
      sh.classList.toggle("on", p.shuffle); sh.setAttribute("aria-pressed", p.shuffle ? "true" : "false");
      const mt = $("[data-p-music]", el);
      mt.innerHTML = Icons.music(Store.music); mt.classList.toggle("on", Store.music);
      mt.setAttribute("aria-pressed", Store.music ? "true" : "false");
      mt.setAttribute("aria-label", Store.music ? "כיבוי מוזיקה ברקע" : "הפעלת מוזיקה ברקע");
      $("[data-np-note]", el).textContent = p.final ? "המדרגה האחרונה מתנגנת עכשיו" : !p.on ? "המוזיקה כבויה – נגיעה בנגינה מפעילה אותה" : "";
      paintProgress();

      const inPl = new Set(pr.playlist);
      $("[data-count]", el).textContent = `· ${inPl.size}`;
      const order = pr.playlist.map((f) => lib.find((t) => t.file === f)).filter(Boolean).concat(lib.filter((t) => !inPl.has(t.file)));
      $("[data-tracks]", el).innerHTML = order.map((t) => {
        const on = inPl.has(t.file), isCur = p.file === t.file && !p.final;
        return `<div class="trk ${isCur ? "cur" : ""} ${on ? "" : "out"}" data-file="${esc(t.file)}">
          <button class="trk-main" data-play-file aria-label="נגינה: ${esc(t.title)}">${cover(t, "sm")}
            <span class="trk-text"><span class="trk-title">${isCur ? eqBars(p.playing) : ""}${ltr(t.title)}</span><span class="trk-artist">${ltr(t.artist)}</span></span></button>
          <button class="trk-add ${on ? "on" : ""}" data-toggle-file aria-pressed="${on}" aria-label="${on ? "הוצאה מהפלייליסט" : "הוספה לפלייליסט"}">${on ? Icons.added() : Icons.add()}</button>
        </div>`;
      }).join("");
      for (const kind of ["summit", "final"]) {
        $(`[data-pick="${kind}"]`, el).innerHTML = lib.map((t) => `<button class="card-pick ${pr[kind] === t.file ? "on" : ""}" data-file="${esc(t.file)}" aria-pressed="${pr[kind] === t.file}">
          ${cover(t, "md")}<span class="cp-badge">${Icons.added()}</span>
          <span class="cp-title">${ltr(t.title)}</span><span class="cp-artist">${ltr(t.artist)}</span></button>`).join("");
      }
    }

    el.addEventListener("click", (e) => {
      const b = e.target.closest("button, [data-seek]");
      if (!b || !el.contains(b)) return;
      Sound.unlock();
      if (b.matches("[data-p-play]")) { haptic("tap"); Sound.toggle(); }
      else if (b.matches("[data-p-next]")) { haptic("tap"); Sound.next(); }
      else if (b.matches("[data-p-prev]")) { haptic("tap"); Sound.prev(); }
      else if (b.matches("[data-p-shuffle]")) { Sound.sfx("tap"); Sound.setPrefs({ shuffle: !Sound.player().shuffle }); }
      else if (b.matches("[data-p-music]")) { Store.music = !Store.music; Sound.refresh(); Sound.sfx("tap"); paint(); }
      else if (b.matches("[data-seek]")) {
        const r = b.getBoundingClientRect();
        Sound.seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
        paintProgress();
      } else if (b.matches("[data-play-file]")) { haptic("tap"); Sound.playFile(b.closest("[data-file]").dataset.file); }
      else if (b.matches("[data-toggle-file]")) {
        const f = b.closest("[data-file]").dataset.file;
        const pl = Sound.prefs().playlist;
        const next = pl.includes(f) ? pl.filter((x) => x !== f) : pl.concat(f);
        if (!next.length) { b.classList.remove("nope"); void b.offsetWidth; b.classList.add("nope"); haptic("error"); return; }   // keep at least one song
        Sound.sfx("tap"); haptic("tap");
        Sound.setPrefs({ playlist: next });
      } else if (b.matches(".card-pick")) {
        const kind = b.parentElement.dataset.pick;
        Sound.sfx("tap"); haptic("tap");
        Sound.setPrefs({ [kind]: b.dataset.file });
      }
    });

    Sound.onChange(() => { if (visible) paint(); });
    return {
      el,
      show() {
        visible = true; paint(); clearInterval(ticker); ticker = setInterval(paintProgress, 500);
        // bring the chosen summit / last-stair song into view in its row
        $$(".pick-row", el).forEach((row) => {
          const c = $(".card-pick.on", row);
          if (!c) return;
          const r1 = c.getBoundingClientRect(), r2 = row.getBoundingClientRect();
          row.scrollLeft += (r1.left + r1.width / 2) - (r2.left + r2.width / 2);
        });
      },
      hide() { visible = false; clearInterval(ticker); },
    };
  }

  function homeScreen() {
    const courses = coursesScreen();
    const musicTab = musicPanel();
    const el = h(`<section data-screen="courses" class="home" data-tab="courses">
      <div class="mini" data-mini role="button" tabindex="0" aria-label="פתיחת המוזיקה" hidden></div>
      <nav class="tabbar" role="tablist" aria-label="לשוניות">
        <button class="tab" role="tab" data-tab-btn="courses" aria-selected="true">${Icons.home()}<span>קורסים</span></button>
        <button class="tab" role="tab" data-tab-btn="music" aria-selected="false">${Icons.library()}<span>מוזיקה</span></button>
      </nav></section>`);
    courses.el.classList.add("tab-panel"); courses.el.dataset.panel = "courses"; delete courses.el.dataset.screen;
    el.prepend(musicTab.el); el.prepend(courses.el);
    const musicMode = Sound.hasMusic && Store.mode !== "boring";
    if (!musicMode) { $('[data-tab-btn="music"]', el).hidden = true; el.classList.add("no-music"); }
    let tab = "courses", miniTick = 0;

    function bars() {
      if (tab === "music") { try { if (window.AndroidBridge && window.AndroidBridge.setSystemBars) window.AndroidBridge.setSystemBars("#121212", false); } catch (e) { /* no bridge */ } }
      else Theme.apply();
    }
    function setTab(t) {
      if (t === tab) return;
      tab = t; el.dataset.tab = t;
      $$("[data-tab-btn]", el).forEach((b) => b.setAttribute("aria-selected", b.dataset.tabBtn === t ? "true" : "false"));
      if (t === "music") musicTab.show(); else musicTab.hide();
      bars(); paintMini();
    }
    $$("[data-tab-btn]", el).forEach((b) => b.addEventListener("click", () => { Sound.unlock(); Sound.sfx("tap"); haptic("tap"); setTab(b.dataset.tabBtn); }));

    // mini player above the tabs (on the courses tab)
    const mini = $("[data-mini]", el);
    let miniKey = "";
    function miniProgress() {
      const p = Sound.player();
      const bar = $(".mini-prog i", mini);
      if (bar) bar.style.width = (p.duration ? Math.min(100, (p.time / p.duration) * 100) : 0).toFixed(1) + "%";
    }
    function paintMini() {
      if (!musicMode) { mini.hidden = true; return; }
      const p = Sound.player();
      const t = p.file ? p : Sound.library().find((x) => x.file === Sound.prefs().playlist[0]);
      mini.hidden = !t;
      if (!t) return;
      const key = `${t.file}|${p.playing}`;
      if (key !== miniKey) {
        miniKey = key;
        mini.style.setProperty("--mc", shade(t.color || "#1DB954", -0.55));
        mini.innerHTML = `${cover(t, "xs")}<span class="mini-text"><span class="mini-title">${p.playing ? eqBars(true) : ""}${ltr(t.title)}</span><span class="mini-artist">${ltr(t.artist)}</span></span>
          <button class="mini-play" data-mini-play aria-label="${p.playing ? "השהיה" : "נגינה"}">${p.playing ? Icons.pause() : Icons.play()}</button>
          <span class="mini-prog" aria-hidden="true"><i></i></span>`;
      }
      miniProgress();
    }
    mini.addEventListener("click", (e) => {
      Sound.unlock();
      if (e.target.closest("[data-mini-play]")) { haptic("tap"); Sound.toggle(); return; }
      Sound.sfx("tap"); setTab("music");
    });
    Sound.onChange(paintMini);
    miniTick = setInterval(() => { if (tab === "courses" && !mini.hidden && el.isConnected) miniProgress(); }, 1000);

    return {
      el,
      onShow() { courses.onShow(); paintMini(); bars(); },
      /** Android Back on the first screen: from the music tab, back to the courses; from the courses, exit. */
      onRootBack() { if (tab === "music") { setTab("courses"); return "handled"; } return "exit"; },
      setTab,
    };
  }

  /* ------------------------------------------------------------------ the first screen: pick a mode */
  const MODES = {
    boring: { title: "משעמם", sub: "בלי מוזיקה ובלי מצב גיהנום, רק שאלות" },
    cool: { title: "למגניבים בלבד", sub: "מוזיקה, קונפטי, ובמדרגה 19 – גיהנום אמיתי" },
  };
  const MODE_ART = {
    boring: `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="34" r="22" fill="#C9CED8"/><path d="M21 33q4 3 8 0M35 33q4 3 8 0" fill="none" stroke="#5B6170" stroke-width="2.6" stroke-linecap="round"/><path d="M26 44h12" stroke="#5B6170" stroke-width="2.6" stroke-linecap="round"/><path d="M44 8h8l-8 9h8M52 20h5l-5 6h5" fill="none" stroke="#8A90A0" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    cool: `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M14 22C6 18 4 8 7 2c3 7 8 11 14 13zM50 22c8-4 10-14 7-20-3 7-8 11-14 13z" fill="#7A0F00"/><circle cx="32" cy="34" r="22" fill="#FFB020"/><path d="M12 28h40l-2 8a6 6 0 0 1-6 5h-6a5 5 0 0 1-5-4l-1-3-1 3a5 5 0 0 1-5 4h-6a6 6 0 0 1-6-5z" fill="#14141A"/><path d="M17 31h8M39 31h8" stroke="#5AD8FF" stroke-width="1.6" stroke-linecap="round" opacity=".8"/><path d="M24 47q8 6 16 0" fill="none" stroke="#7A2A00" stroke-width="2.8" stroke-linecap="round"/></svg>`,
  };

  function modeScreen() {
    const last = Store.mode;
    const card = (m) => `<button class="mode-card ${m}" data-mode="${m}">
        ${m === "cool" ? '<span class="mode-fire" aria-hidden="true"></span>' : ""}
        <span class="mode-ic">${MODE_ART[m]}</span>
        <span class="mode-txt"><b>${MODES[m].title}</b><span>${MODES[m].sub}</span></span>
        ${last === m ? '<span class="mode-last">בפעם הקודמת</span>' : ""}
      </button>`;
    const el = h(`<section data-screen="mode" class="mode-screen">
      <div class="mode-wrap">
        <div class="mode-art" aria-hidden="true">${Art.banner(Theme.current)}</div>
        <h1 class="mode-title"><bdi dir="ltr">The Road To 100</bdi></h1>
        <p class="mode-q">איך משחקים היום?</p>
        ${card("boring")}${card("cool")}
      </div></section>`);
    $$(".mode-card", el).forEach((b) => b.addEventListener("click", () => {
      Store.mode = b.dataset.mode;
      Sound.unlock(); Sound.sfx("tap"); haptic("success");
      Sound.refresh();
      resetRoot(homeScreen());
    }));
    return { el };
  }

  /** Replace the whole stack with one screen (no slide). */
  async function resetRoot(scr) {
    while (stack.length) {
      const s = stack.pop();
      if (s.destroy) s.destroy();
      s.el.parentNode && s.el.parentNode.removeChild(s.el);
    }
    stackEl.classList.add("no-anim");
    await push(scr);
    requestAnimationFrame(() => stackEl.classList.remove("no-anim"));
  }

  /* ------------------------------------------------------------------ boot */
  /** The loading screen in index.html: shown at least 1.2 s from launch, then it fades out. */
  async function finishLoading() {
    const sp = document.getElementById("splash");
    if (!sp) return;
    const left = 1200 - performance.now();
    if (left > 0 && !reduced()) await wait(left);
    sp.classList.add("out");
    setTimeout(() => { if (sp.parentNode) sp.parentNode.removeChild(sp); }, 400);
  }

  async function boot() {
    try {
      await Promise.all([Data.load(), Sound.init(), document.fonts ? document.fonts.ready : null]);
      stackEl.classList.add("no-anim");
      await push(modeScreen());
      requestAnimationFrame(() => stackEl.classList.remove("no-anim"));
      finishLoading();
    } catch (e) {
      const cap = document.querySelector("[data-splash-cap]");
      if (cap) cap.textContent = `לא הצלחתי לטעון את הקורסים. (${e.message})`;
    }
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) Sound.pause(); else Sound.resume(); });
  boot();
})();
