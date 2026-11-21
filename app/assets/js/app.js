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
  const chain = (s) => esc(s).replace(/ ?(←|→) ?/g, "\u00A0$1\u00A0");
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
    if (busy) { if (scr && scr.destroy) scr.destroy(); return; }
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
    if (start) { Sound.music(null); return; }       // silence until a mode is picked
    if (top) Sound.music(top.el.dataset.screen === "game" ? "game" : "menu");
  }

  function back() {
    const ov = overlays[overlays.length - 1];
    if (ov) { ov.onBack(); return "handled"; }
    if (start) { if (start.boot) return "exit"; closeStart(); return "handled"; }   // the start screen
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
        <div class="large-title"><h1>בחרי קורס</h1><p>20 תשובות נכונות ברצף = פסגה.</p><p class="due-total" data-duetotal hidden></p>
          <button class="mode-pill ${Store.mode}" data-act="mode">מצב: ${Store.mode === "boring" ? "משעמם" : "למגניבים בלבד"}<span>החלפה</span></button></div>
        <div class="group" data-list></div>
        <div class="section-footer">ההתקדמות נשמרת במכשיר הזה.</div>
      </div></section>`);
    wireScroller(el);
    const offs = [];
    const snd = $('[data-act="sound"]', el);
    const paintSound = () => { snd.innerHTML = Icons.sound(Store.sound); snd.setAttribute("aria-pressed", Store.sound ? "true" : "false"); snd.setAttribute("aria-label", Store.sound ? "השתקת צלילים" : "הפעלת צלילים"); };
    snd.addEventListener("click", () => { Store.sound = !Store.sound; if (!Store.sound) Sound.stop(); else { Sound.unlock(); Sound.sfx("tap"); } Sound.refresh(); paintSound(); });
    paintSound();
    const mus = $('[data-act="music"]', el);
    if (mus) {
      const paintMusic = () => { mus.innerHTML = Icons.music(Store.music); mus.setAttribute("aria-pressed", Store.music ? "true" : "false"); mus.setAttribute("aria-label", Store.music ? "השתקת מוזיקה" : "הפעלת מוזיקה"); };
      mus.addEventListener("click", () => { Store.music = !Store.music; Sound.unlock(); Sound.sfx("tap"); Sound.refresh(); paintMusic(); });
      paintMusic();
      offs.push(Sound.onChange(() => { paintMusic(); paintSound(); }));   // the music tab's play button can switch them on
    }

    const paintBanner = () => { $("[data-banner]", el).innerHTML = Art.banner(Theme.current); };
    paintBanner();
    offs.push(Theme.onChange(paintBanner));
    $('[data-act="theme"]', el).addEventListener("click", () => { Sound.unlock(); Sound.sfx("tap"); haptic("tap"); themeSheet(); });
    $('[data-act="mode"]', el).addEventListener("click", () => { Sound.sfx("tap"); haptic("tap"); openStart(); });

    function render() {
      const list = $("[data-list]", el);
      const now = Date.now();
      let total = 0;
      list.innerHTML = Data.courses.map((c) => {
        const best = Store.bestForCourse(c.id);
        const due = new Set(dueQuestions(c.questions, now).map((q) => q.id)).size;
        total += due;
        return `<div class="course-item ${due ? "has-review" : ""}"><button class="row course-row" data-id="${esc(c.id)}">
          <span class="icon-tile" style="background:${courseColor(c)}">${(Icons[c.icon] || Icons.book)()}</span>
          <span class="row-body"><span class="row-title">${esc(c.name)}</span>
            <span class="row-sub"><span class="meta-item">${nTopics(c.topics.length)}</span> · <span class="meta-item">${nQuestions(c.questions.length)}</span></span>
            <span class="row-meta"><span class="best-pill ${best ? "" : "zero"}" aria-label="שיא רצף ${best}">${Icons.flame()}${best ? `שיא ${best} ברצף` : "עוד אין שיא"}</span>${best ? `<span class="course-progress" style="--p:${(Math.min(best, GOAL) / GOAL).toFixed(2)}" aria-hidden="true"><i></i></span>` : ""}</span></span>
          <span class="row-trail">${Icons.chevron()}</span>
        </button>${due ? `<button class="review-row" data-review="${esc(c.id)}" aria-label="${due} לחזרה היום: חזרה בכל הנושאים, מכל המקורות"><span class="review-dot" aria-hidden="true"></span><span class="review-label">${due} לחזרה היום</span>${Icons.chevron()}</button>` : ""}</div>`;
      }).join("");
      const dt = $("[data-duetotal]", el);
      dt.hidden = !total;
      dt.textContent = total ? `לחזרה היום: ${total}` : "";
      $$(".review-row", list).forEach((b) => b.addEventListener("click", () => {
        Sound.unlock(); Sound.sfx("tap"); haptic("tap");
        const c = Data.course(b.dataset.review);
        push(gameScreen(c, c.topics.map((t) => t.id), "mixed", { review: true }));
      }));
      $$(".course-row", list).forEach((b) => b.addEventListener("click", () => {
        Sound.unlock(); Sound.sfx("tap"); haptic("tap");
        push(topicsScreen(Data.course(b.dataset.id)));
      }));
    }
    render();
    return { el, onShow: render, destroy() { offs.forEach((f) => f()); } };
  }

  /* ------------------------------------------------------------------ screen 2: topics */
  function topicsScreen(course) {
    const all = course.topics.map((t) => t.id);
    const saved = (Store.lastTopics(course.id) || []).filter((t) => all.includes(t));
    let selected = new Set(saved.length ? saved : all);
    const countFor = (tid) => course.questions.filter((q) => q.topic === tid).length;
    /** Per topic: questions seen, recalled later (a later correct answer after 72 h), due now. Ids are counted once. */
    function topicProgress(tid) {
      const now = Date.now(), ids = new Set(course.questions.filter((q) => q.topic === tid).map((q) => q.id));
      let seen = 0, recalled = 0, due = 0;
      ids.forEach((id) => { const L = Store.learning(id, now); if (L.seen) seen++; if (L.recalled) recalled++; if (L.due) due++; });
      return { seen, recalled, due };
    }

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
        <div class="section-header topics-head"><span>נושאים</span><span class="legend" aria-hidden="true"><i class="lg seen"></i>נצפו<i class="lg recalled"></i>נענו שוב נכון</span></div>
        <div class="group" data-topics>
          ${course.topics.map((t) => {
            const n = countFor(t.id);
            const p = topicProgress(t.id);
            const label = n ? `${t.name}. מתוך ${n} שאלות: ${p.seen} נצפו, ${p.recalled} נענו שוב נכון לאחר מרווח${p.due ? `, ${p.due} לחזרה` : ""}` : t.name;
            return `<button class="row topic-row ${n ? "" : "empty"}" data-tid="${esc(t.id)}" role="checkbox" aria-label="${esc(label)}">
              <span class="row-body"><span class="row-title">${esc(t.name)}</span>${t.note || !n ? `<span class="row-sub">${esc(n ? t.note : "אין עדיין שאלות בנושא הזה")}</span>` : ""}
                ${n ? `<span class="topic-bar" aria-hidden="true"><i class="seen" style="width:${(100 * (p.seen - p.recalled) / n).toFixed(1)}%"></i><i class="recalled" style="width:${(100 * p.recalled / n).toFixed(1)}%"></i></span>` : ""}</span>
              <span class="row-trail">${p.due ? `<span class="due-chip" aria-hidden="true">לחזרה: ${p.due}</span>` : ""}<span class="count-badge">${n}</span>${Icons.check()}</span>
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
        <div class="group check-group" data-check></div>
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
      // the self-check: a separate action, not a fourth source
      const n = new Set(Data.pool(course, topics, "mixed").map((q) => q.id)).size;
      const history = Store.checks(course.id);
      const box = $("[data-check]", el);
      box.innerHTML = `<button class="row check-row" data-start-check ${n >= CHECK_MIN ? "" : 'disabled aria-disabled="true"'}>
          <span class="row-body"><span class="row-title">בוחן עצמי · ${Math.min(CHECK_SIZE, n)} שאלות</span>
            <span class="row-sub">${n >= CHECK_MIN ? "בנושאים שנבחרו · מכל המקורות" : `נדרשות לפחות ${CHECK_MIN} שאלות בנושאים שנבחרו`}</span></span>
          ${n >= CHECK_MIN ? Icons.chevron() : ""}</button>
        ${history.length ? `<button class="row check-row quiet" data-history><span class="row-body"><span class="row-title">תוצאות קודמות בקורס</span><span class="row-sub">${plural(history.length, "בוחן אחד", "בחנים")}</span></span>${Icons.chevron()}</button>` : ""}`;
      const sc = $("[data-start-check]", box);
      if (n >= CHECK_MIN) sc.addEventListener("click", () => { Sound.unlock(); Sound.sfx("tap"); haptic("tap"); push(checkScreen(course, topics)); });
      const hb = $("[data-history]", box);
      if (hb) hb.addEventListener("click", () => { Sound.sfx("tap"); haptic("tap"); push(resultScreen(course, history[0], { saved: true })); });
    }
    render();
    return { el, onShow: render };
  }

  /* ------------------------------------------------------------------ screen 4: the game */
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  const BLOCK = 10;   // a study session: 10 distinct questions, then a short summary
  /**
   * Order the candidates for the next question: due reviews first (oldest due first), then unseen questions,
   * then the rest (least recently seen first). Ties are random.
   */
  function rankQuestions(list, now) {
    const keyed = shuffle(list.slice()).map((q) => {
      const L = Store.learning(q.id, now);
      return { q, g: L.due ? 0 : L.seen ? 2 : 1, k: L.due ? L.dueAt : L.last };
    });
    keyed.sort((a, b) => a.g - b.g || (a.g === 1 ? 0 : a.k - b.k));
    return keyed.map((x) => x.q);
  }
  const dueQuestions = (questions, now = Date.now()) => questions.filter((q) => Store.learning(q.id, now).due);

  let rageN = 0;
  function gameScreen(course, topics, source, opts = {}) {
    let review = !!opts.review;                          // "N לחזרה היום": only this course's due questions
    let pool = review ? course.questions.slice() : Data.pool(course, topics, source);
    let lastId = null, current = null, order = [], answered = false;
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
      <div class="game-body" data-body><div class="block-line" data-blockline aria-live="polite"></div><div class="qcard" data-card></div></div>
      <div class="game-foot" data-foot><button class="btn-primary" data-next>לשאלה הבאה</button></div>
    </section>`);

    const sceneBox = $("[data-scene]", el);
    const casual = Store.difficulty === "casual";      // fixed for this run
    const quiet = Store.mode === "boring";
    let run = 0;                                         // correct answers in a row (the record), apart from the stair
    const scene = Scene.create(sceneBox, { color: course.color || "#FF9500", theme: Theme.current, difficulty: Store.difficulty });
    const stepCap = h('<span class="caption-step" data-stepcap></span>');
    sceneBox.appendChild(stepCap);
    const card = $("[data-card]", el);
    const foot = $("[data-foot]", el);
    const body = $("[data-body]", el);
    const island = $("[data-island]", el);

    /* ---- the study session ("סבב"): 10 distinct questions; falls never reset it */
    let block = newBlock(), shownAs = null;   // shownAs: how the current question was picked (retry, was due, was new)
    function newBlock() {
      const size = review ? dueQuestions(pool).length : new Set(pool.map((q) => q.id)).size;
      return { target: Math.min(BLOCK, size), done: new Set(), firstOk: 0, fresh: 0, dueOk: 0, retries: [] };
    }
    const blockComplete = () => block.done.size >= block.target;
    function paintBlock() {
      $("[data-blockline]", el).textContent = `${review ? "חזרה" : "הסבב"}: ${block.done.size} מתוך ${block.target}`;
    }
    function summaryLines() {
      return [`נכון בניסיון ראשון: ${block.firstOk} מתוך ${block.done.size}`, `שאלות חדשות: ${block.fresh}`, `תשובות נכונות בחזרה מתוזמנת: ${block.dueOk}`];
    }
    /** The next question: a retry whose wait is over, else the best-ranked one not yet answered in this session. */
    function pickNext() {
      const ri = block.retries.findIndex((r) => r.after <= block.done.size && r.id !== lastId);
      if (ri >= 0) {
        const r = block.retries.splice(ri, 1)[0];
        const q = pool.find((x) => x.id === r.id);
        if (q) return { q, retry: true };
      }
      const now = Date.now();
      let cand = pool.filter((q) => !block.done.has(q.id) && q.id !== lastId);
      if (review) cand = cand.filter((q) => Store.learning(q.id, now).due);
      const q = rankQuestions(cand, now)[0];
      return q ? { q, retry: false } : null;
    }
    async function finishBlock() {
      let buttons, title;
      const left = review ? dueQuestions(pool).length : 0;
      if (review && left) { title = "סבב החזרה הושלם"; buttons = [{ text: "להמשך החזרה", value: "go", style: "bold", cancel: true }, { text: "לסיום", value: "end" }]; }
      else if (review) { title = "החזרה הושלמה"; buttons = [{ text: "לתרגול מעורב", value: "mix", style: "bold", cancel: true }, { text: "לסיום", value: "end" }]; }
      else { title = "הסבב הושלם"; buttons = [{ text: "להמשיך לטפס", value: "go", style: "bold", cancel: true }, { text: "לסיום", value: "end" }]; }
      haptic("success");
      const r = await showAlert({ title, message: summaryLines().join("\n"), buttons });
      if (!alive) return;
      if (r === "end") { pop(); return; }
      if (r === "mix") { review = false; pool = Data.pool(course, topics, "mixed"); }
      block = newBlock();
      nextQuestion();
    }

    function paintRing(pulse) {
      const arc = $(".arc", el);
      arc.setAttribute("stroke-dashoffset", (C * (1 - Math.min(streak, GOAL) / GOAL)).toFixed(2));
      $("[data-num]", el).textContent = streak;
      $("[data-best]", el).textContent = `שיא ${Store.sourceStats(course.id, source).best}`;
      const ring = $("[data-ring]", el);
      ring.setAttribute("aria-label", `רצף ${streak} מתוך ${GOAL}`);
      if (pulse && !reduced()) { ring.classList.remove("pulse"); void ring.offsetWidth; ring.classList.add("pulse"); }
      stepCap.textContent = streak >= GOAL ? "פסגה!" : `מדרגה ${streak} מתוך ${GOAL}`;
      const lbl = $(".ring-label", el);
      if (lbl) lbl.firstChild.textContent = `מתוך ${GOAL}`;
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
      // a horned demon face: glowing eyes, fangs, a crack of fire for a mouth
      const demonFace = (n2) => `<svg viewBox="0 0 120 110" aria-hidden="true"><defs>
          <radialGradient id="dmF${n}${n2}" cx="50%" cy="42%" r="60%"><stop offset="0" stop-color="#C8261A"/><stop offset=".7" stop-color="#7A0E08"/><stop offset="1" stop-color="#2E0402"/></radialGradient></defs>
        <path d="M30 34C16 26 8 8 12-4c4 14 14 22 26 26zM90 34c14-8 22-26 18-38-4 14-14 22-26 26z" fill="#2A0A06" stroke="#0E0201" stroke-width="2"/>
        <path d="M60 14C32 14 20 34 22 56c2 22 18 44 38 50 20-6 36-28 38-50 2-22-10-42-38-42z" fill="url(#dmF${n}${n2})" stroke="#0E0201" stroke-width="2.5"/>
        <path d="M30 46l20 8M90 46l-20 8" stroke="#0E0201" stroke-width="5" stroke-linecap="round"/>
        <path class="eye" d="M34 58q8-8 16 0q-8 5-16 0zM70 58q8-8 16 0q-8 5-16 0z" fill="#FFB000"/>
        <path d="M40 80q20 12 40 0l-6 10-6-6-4 10-4-10-4 10-4-10-6 6z" fill="#FF6A00" stroke="#0E0201" stroke-width="2" stroke-linejoin="round"/>
        <path d="M44 82l4 9 3-8M76 82l-4 9-3-8" fill="#F4E9D6" stroke="#0E0201" stroke-width="1.2"/></svg>`;
      const pike = (side) => `<div class="pike ${side}">${skull(side === "left")}<i></i></div>`;
      const garland = () => `<svg class="garland" viewBox="0 0 400 40" preserveAspectRatio="none" aria-hidden="true">${Array.from({ length: 22 }, (_, k) => {
        const x = k * 18 + 4, y = 6 + Math.sin((k / 21) * Math.PI) * 22;
        return k % 2 ? `<rect x="${x - 2}" y="${y - 5}" width="14" height="5" rx="2.5" fill="#3B3B40" stroke="#16161A"/>`
          : `<ellipse cx="${x + 5}" cy="${y - 2}" rx="9" ry="5" fill="none" stroke="#4A4A50" stroke-width="3"/>`;
      }).join("")}</svg>`;
      const pile = Array.from({ length: 7 }, (_, k) => `<i class="pile-skull" style="--k:${k}">${skull(k === 3)}</i>`).join("");
      const embers = Array.from({ length: 20 }, () => `<i class="ember" style="--x:${(Math.random() * 100).toFixed(1)}%;--d:${(2 + Math.random() * 2.4).toFixed(2)}s;--w:${(-Math.random() * 4).toFixed(2)}s;--dx:${(Math.random() * 70 - 35).toFixed(0)}px"></i>`).join("");
      const row = (cls, count) => `<div class="flames ${cls}">${Array.from({ length: count }, (_, i) => flame(i)).join("")}</div>`;
      return h(`<div class="rage-fx metal" aria-hidden="true">
        <svg width="0" height="0" style="position:absolute"><defs>
          <linearGradient id="rgF${n}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#FFE27A"/><stop offset=".3" stop-color="#FF9A00"/><stop offset=".7" stop-color="#FF2E00"/><stop offset="1" stop-color="#8A0000" stop-opacity="0"/></linearGradient>
          <linearGradient id="rgC${n}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".45" stop-color="#FFE96B"/><stop offset="1" stop-color="#FFB000" stop-opacity="0"/></linearGradient></defs></svg>
        <div class="hell-glow"></div>
        <div class="demon side l">${demonFace("a")}</div>
        <div class="demon">${skull(true)}</div>
        <div class="demon side r">${demonFace("b")}</div>
        ${garland()}
        ${chain("left")}${chain("right")}
        ${pike("left")}${pike("right")}
        ${row("back", 9)}
        ${row("ground", 14)}
        <div class="skull-pile">${pile}</div>
        <div class="lava"></div>
        <div class="embers">${embers}</div>
        ${row("floor", 11)}
        <div class="vignette"></div>
      </div>`);
    }
    function setRage(on) {
      if (on === !!rage) return;
      if (on) {
        rage = rageLayer();
        sceneBox.after(rage);
        el.classList.add("rage");
        const slam = h(`<div class="slam" aria-live="assertive"><b>תשובה אחת לפסגה</b><span>${casual ? "טעות אחת – וחוזרים למדרגה 15" : "טעות אחת – וחוזרים לתחתית"}</span></div>`);
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

    let golden = null;
    function setGolden(on) {
      if (on === !!golden) return;
      if (on) {
        golden = h('<div class="golden-fx" aria-hidden="true"><span>עוד תשובה אחת לפסגה</span></div>');
        sceneBox.appendChild(golden);
        el.classList.add("golden");
        haptic("heavy");
      } else { golden.remove(); golden = null; el.classList.remove("golden"); }
    }
    function checkpointToast(n) {
      const t = h(`<div class="cp-toast" role="status">${Icons.tick()}<span>נקודת שמירה: ${n}</span></div>`);
      sceneBox.appendChild(t);
      haptic("heavy");
      if (!quiet) celebrate();
      setTimeout(() => t.remove(), 1400);
    }

    function nextQuestion() {
      if (blockComplete()) { finishBlock(); return; }
      const next = pickNext();
      if (!next) { block.target = block.done.size; finishBlock(); return; }   // a small pool ran out
      current = next.q;
      lastId = current.id;
      const L = Store.learning(current.id);
      shownAs = { retry: next.retry, due: L.due, fresh: !L.seen, prevSeen: Store.expose(current.id) };
      paintBlock();
      order = shuffle([0, 1, 2, 3]);     // never trust the stored option order
      answered = false;
      const info = SOURCE_INFO[current.source];
      card.dataset.qid = current.id;
      card.innerHTML = `
        <div class="q-meta"><div class="q-caption"><span class="q-course">${esc(course.name)}</span><span class="q-topic">${esc(Data.topicName(course, current.topic))}</span></div>
          <span class="q-badges">${shownAs.retry ? '<span class="badge retry">ניסיון נוסף</span>' : ""}<span class="badge ${current.source}">${current.source === "real" ? Icons.exam() : Icons.sparkles()}${esc(info.badge)}</span></span></div>
        <div class="q-text" id="qtext">${esc(current.q)}</div>
        <div class="opts" role="group" aria-labelledby="qtext">
          ${order.map((oi, k) => `<button class="opt" data-oi="${oi}"><span class="opt-letter" aria-hidden="true">${LETTERS[k]}</span><span class="opt-text">${chain(current.options[oi])}</span><span class="opt-mark"></span></button>`).join("")}
        </div>
        <div data-explain></div>`;
      $$(".opt", card).forEach((b) => b.addEventListener("click", () => answer(+b.dataset.oi, b)));
      $("[data-next]", el).textContent = "לשאלה הבאה";
      foot.classList.remove("show");
      body.scrollTop = 0;
    }

    async function answer(oi, btn) {
      if (answered || summitOpen) return;
      answered = true;
      const ok = oi === current.answer;
      Store.recordAnswer(current.id, ok, { retry: shownAs.retry, prevSeen: shownAs.prevSeen });
      if (!shownAs.retry) {
        block.done.add(current.id);
        if (ok) block.firstOk += 1;
        if (shownAs.fresh) block.fresh += 1;
        if (shownAs.due && ok) block.dueOk += 1;
        // one more try later in this session, after 5 other questions (never extends the session)
        if (!ok && !block.retries.some((r) => r.id === current.id)) block.retries.push({ id: current.id, after: block.done.size + 5 });
      }
      paintBlock();
      $$(".opt", card).forEach((b) => {
        b.disabled = true;
        const i = +b.dataset.oi;
        if (i === current.answer) { b.classList.add("correct"); $(".opt-mark", b).innerHTML = Icons.tick(); }
        else if (b === btn) { b.classList.add("wrong"); $(".opt-mark", b).innerHTML = Icons.cross(); }
        else b.classList.add("dim");
      });
      const back = casual ? Math.floor(Math.min(streak, GOAL - 1) / 5) * 5 : 0;
      $("[data-explain]", card).innerHTML = `<div class="explain ${ok ? "ok" : "bad"}" role="status">
        <h3>${ok ? Icons.tick() : Icons.cross()}${ok ? "נכון!" : back ? `לא נכון – חוזרים למדרגה ${back}` : "לא נכון – חוזרים למטה"}</h3>
        <div>${esc(current.explanation || "")}</div>${current.ref ? `<div class="ref">מקור: ${esc(current.ref)}</div>` : ""}</div>`;

      if (ok) {
        // the state shows at once; the hop (~320 ms) follows, with a crisp haptic on landing
        streak += 1; run += 1;
        Sound.sfx("correct"); haptic("tap");
        if (!quiet) setTimeout(() => { if (alive) celebrate(); }, 300);   // at the landing
        Store.recordStreak(course.id, source, run);
        paintRing(true);
        const hop = scene.hop().then(() => { if (alive) haptic("success"); });
        if (streak >= GOAL) { setRage(false); setGolden(false); await hop; if (alive) openSummit(); return; }
        if (streak === GOAL - 1) { if (quiet) setGolden(true); else setRage(true); $("[data-next]", el).textContent = "לשאלה האחרונה"; }
        if (streak % 5 === 0) {
          if (casual) checkpointToast(streak);
          setTimeout(() => { if (alive) showIsland(Sound.playClip(false)); }, 350);
        }
      } else {
        const had = streak;
        streak = back; run = 0;
        setRage(false); setGolden(false);
        Sound.sfx("wrong"); haptic("error");
        if (had > back) setTimeout(() => Sound.sfx("fall"), 120);
        paintRing(false);
        scene.fall(back);
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
    function celebrate() {
      if (reduced()) return;
      const box = sceneBox.getBoundingClientRect();
      const hero = sceneBox.querySelector(".hero-body") || sceneBox;
      const r = hero.getBoundingClientRect();
      const cx = r.left - box.left + r.width / 2, cy = r.top - box.top + r.height / 2;
      const burst = h('<div class="burst" aria-hidden="true"></div>');
      burst.style.left = `${cx}px`; burst.style.top = `${cy}px`;
      const colors = ["#FFC93C", "#FF4FA3", "#4FB8FF", "#5FD68A", "#A77BFF"];
      burst.innerHTML = Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2 + Math.random() * .4, d = 42 + Math.random() * 38;
        return `<i style="--dx:${(Math.cos(a) * d).toFixed(1)}px;--dy:${(Math.sin(a) * d).toFixed(1)}px;--c:${colors[i % colors.length]};animation-delay:${(Math.random() * .06).toFixed(2)}s"></i>`;
      }).join("");
      sceneBox.appendChild(burst);
      const plus = h('<div class="plus-one" aria-hidden="true">+1</div>');
      plus.style.left = `${cx - 12}px`; plus.style.top = `${Math.max(4, r.top - box.top - 30)}px`;
      sceneBox.appendChild(plus);
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
      // cool: 60 pieces in three bursts, then short beat bursts (at most 80 alive); quiet: a few drifting stars
      const calm = !onBeat;
      const N = calm ? 16 : 60, CAP = 80, BEAT = 500, DANCE0 = 1300, DANCE1 = 9800, FADE0 = 9100, FADE1 = 10350;
      const bursts = [[1120, 0.5, 0.36], [1420, 0.22, 0.44], [1720, 0.78, 0.44]];   // [ms, x, y] as fractions
      const parts = [];
      for (let i = 0; i < N; i++) {
        const b = bursts[i % 3];
        const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5, sp = (calm ? 1 + Math.random() * 2 : 7 + Math.random() * 9) * dpr;
        parts.push({
          born: b[0], bx: b[1], by: b[2], vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, x: 0, y: 0, live: false,
          hx: 0.04 + Math.random() * 0.92, hy: 0.04 + Math.random() * 0.9,          // its spot in the dance
          r: (6 + Math.random() * 7) * dpr, c: calm ? "#FFE27A" : palette[i % palette.length], shape: calm ? "star" : shapes[i % shapes.length],
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
        if (!calm && t >= DANCE0 && t < DANCE1) {
          const n = Math.floor((t - DANCE0) / BEAT);
          if (n !== beatN) {
            beatN = n; pulseAt = t;
            if (onBeat) try { onBeat(n); } catch (e) { /* ignore */ }
            // a short burst on the beat: four pieces that fall and fade within 1.4 s
            const live = parts.filter((q) => q.live && !q.dead).length;
            for (let k = 0; k < 4 && live + k < CAP && t < FADE0 - 1400; k++) {
              parts.push({ born: t, bx: .1 + Math.random() * .8, by: .05, vx: (Math.random() - .5) * 6 * dpr, vy: (1 + Math.random() * 2) * dpr, x: 0, y: 0, live: false, ttl: 1400,
                hx: 0, hy: 0, r: (6 + Math.random() * 6) * dpr, c: palette[(n + k) % palette.length], shape: shapes[(n + k) % shapes.length], a: Math.random() * 6.28, va: (Math.random() - .5) * .3, ph: Math.random() * 6.28, sway: 0 });
            }
          }
        }
        const pulse = Math.exp(-(t - pulseAt) / 140);              // 1 on the beat, fading fast
        const strong = beatN % 4 === 0 ? 1.6 : 1;                    // every 4th beat is a bigger wave
        const alpha = 1 - ease((t - FADE0) / (FADE1 - FADE0));
        ctx.clearRect(0, 0, W, H);
        for (const p of parts) {
          if (t < p.born || p.dead) continue;
          if (!p.live) { p.live = true; p.x = p.bx * W; p.y = p.by * H; }
          if (p.ttl) {                                                  // a beat piece: falls, then fades out
            const age = t - p.born;
            if (age > p.ttl) { p.dead = true; continue; }
            p.vy += 0.25 * dpr * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.a += p.va * dt;
            draw(p, alpha * (1 - age / p.ttl));
            continue;
          }
          // burst physics, then glide into the dance spot
          p.vx *= Math.pow(0.95, dt); p.vy = p.vy * Math.pow(0.95, dt) + 0.25 * dpr * dt;
          const bx = p.x + p.vx * dt, by = p.y + p.vy * dt;
          const life = t - p.born, k = ease((life - 500) / 1100);
          const wave = Math.sin(t / 1000 * Math.PI * 2 * 0.5 + p.hx * 7 + p.ph);           // a slow wave across the screen
          const hop = calm ? 0 : pulse * strong * 26 * dpr * Math.sin(p.hx * 9 + beatN);   // the beat makes rows jump
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
      const summits = Store.recordSummit(course.id, source, casual);
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
        <div class="stage">${buddy(true)}<span class="hero-wrap"><span class="sm-sparkle s1"></span><span class="sm-sparkle s2"></span><span class="sm-sparkle s3"></span>${Icons.crown()}${Scene.monsterSvg(theme, "party", "hero")}</span>${buddy(false)}</div>
        <h2 id="sm-t">ציציפלצת האולטימטיבית</h2>
        <p class="sm-line">${summits === 1 ? "הפסגה הראשונה שלך!" : casual ? "הגעת לפסגה!" : `${GOAL} תשובות נכונות ברצף`} · ${esc(course.name)}</p>
        <p class="sm-sum">${review ? "חזרה" : "הסבב"}: ${block.done.size} מתוך ${block.target} · ${summaryLines()[0]}</p>
        <div class="stats">
          <div class="stat key"><b data-to="${st.best}">${st.best}</b><span>שיא רצף</span></div>
          <div class="stat"><b data-to="${summits}">${summits}</b><span>${casual ? "פסגות עם נקודות שמירה" : "פסגות בקורס"}</span></div>
        </div>
        <div class="actions"><button class="btn-primary" data-again>עוד טיפוס</button><button class="btn-quiet" data-menu>חזרה לבחירת שאלות</button></div>
      </div>`);
      const heroWrap = $(".hero-wrap", ov);
      const stop = confetti(ov, theme, quiet ? null : () => {
        if (!heroWrap) return;
        if (heroWrap.animate) heroWrap.animate([{ filter: "drop-shadow(0 0 14px rgba(255,210,90,.85))" }, { filter: "none" }], { duration: 420, easing: "ease-out" });
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
      $("[data-again]", ov).addEventListener("click", () => {
        Sound.sfx("tap"); close(); streak = 0; run = 0; scene.set(0); paintRing(false);
        if (blockComplete()) block = newBlock();   // the summit already showed this session's result
        nextQuestion();
      });
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
    // a fast double tap on "next" must not skip a question: only an answered question moves on
    $("[data-next]", el).addEventListener("click", () => { if (!answered || summitOpen) return; Sound.sfx("tap"); nextQuestion(); });

    async function start() {
      if (started) return;
      started = true;
      paintRing(false);
      if (!pool.length) {
        card.innerHTML = `<div class="q-text">אין שאלות לבחירה הזו.</div>`;
        return;
      }
      if (review) {
        const t = h(`<div class="cp-toast" role="status">${Icons.tick()}<span>חזרה · כל הנושאים · מקורות מעורבים</span></div>`);
        sceneBox.appendChild(t);
        setTimeout(() => t.remove(), 2200);
      } else if (pool.length < GOAL) {
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
      destroy() { alive = false; setRage(false); setGolden(false); scene.destroy(); clearTimeout(islandTimer); Sound.stop(); },
    };
  }

  /* ------------------------------------------------------------------ the self-check ("בוחן עצמי") */
  const CHECK_SIZE = 20, CHECK_MIN = 10;
  /**
   * A fixed batch, chosen before it starts: slots go round-robin over the selected topics (in a shuffled order,
   * so no topic is always first); inside a topic unseen questions first, then the least recently seen, and real
   * questions only break ties. Then the order is shuffled.
   */
  function pickCheck(course, topics) {
    const now = Date.now();
    const rank = (qs) => shuffle(qs.slice()).map((q) => { const L = Store.learning(q.id, now); return { q, u: L.seen ? 1 : 0, k: L.last, r: q.source === "real" ? 0 : 1 }; })
      .sort((a, b) => a.u - b.u || a.k - b.k || a.r - b.r).map((x) => x.q);
    const lists = shuffle(topics.map((t) => rank(course.questions.filter((q) => q.topic === t))).filter((l) => l.length));
    const total = new Set(lists.flat().map((q) => q.id)).size;
    const n = Math.min(CHECK_SIZE, total), out = [], used = new Set();
    while (out.length < n) {
      let added = false;
      for (const l of lists) {
        if (out.length >= n) break;
        while (l.length && used.has(l[0].id)) l.shift();
        if (l.length) { const q = l.shift(); used.add(q.id); out.push(q); added = true; }
      }
      if (!added) break;
    }
    return shuffle(out);
  }
  const fmtDate = (t) => { try { return new Date(t).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } };
  const scopeText = (course, topics) => topics.length === course.topics.length ? "כל הנושאים" : topics.map((t) => Data.topicName(course, t)).join(", ");

  function qBody(course, q, order, opts = {}) {
    return `<div class="q-meta"><div class="q-caption"><span class="q-course">${esc(course.name)}</span><span class="q-topic">${esc(Data.topicName(course, q.topic))}</span></div></div>
      <div class="q-text" id="qtext" tabindex="-1">${esc(q.q)}</div>
      <div class="opts" role="${opts.radio ? "radiogroup" : "group"}" aria-labelledby="qtext">
        ${order.map((oi, k) => `<button class="opt" data-oi="${oi}" ${opts.radio ? 'role="radio" aria-checked="false"' : ""}><span class="opt-letter" aria-hidden="true">${LETTERS[k]}</span><span class="opt-text">${chain(q.options[oi])}</span><span class="opt-mark"></span></button>`).join("")}
      </div><div data-explain></div>`;
  }

  /** The check itself: no stairs, no right/wrong cues; one committed answer per question, then the results. */
  function checkScreen(course, topics) {
    const qs = pickCheck(course, topics);
    const answers = [];   // { id, chosen, ok, wasSeen }
    let i = 0, chosen = null, shown = null, done = false;
    const el = h(`<section data-screen="check" class="check-screen">
      ${navbar({ title: "בוחן עצמי", back: "יציאה" })}
      <div class="scroller has-footer">
        <div class="block-line" data-progress aria-live="polite"></div>
        <div class="qcard" data-card></div>
      </div>
      <div class="footer-bar"><button class="btn-primary" data-next disabled>הבא</button></div>
    </section>`);
    const card = $("[data-card]", el), next = $("[data-next]", el), sc = $(".scroller", el);
    $('[data-act="back"]', el).addEventListener("click", () => { Sound.sfx("tap"); leave(); });

    function show() {
      const q = qs[i];
      const L = Store.learning(q.id);
      shown = { wasSeen: L.seen, prevSeen: Store.expose(q.id), order: shuffle([0, 1, 2, 3]) };
      chosen = null;
      $("[data-progress]", el).textContent = `שאלה ${i + 1} מתוך ${qs.length}`;
      card.innerHTML = qBody(course, q, shown.order, { radio: true });
      next.disabled = true;
      next.textContent = i === qs.length - 1 ? "לתוצאות" : "הבא";
      $$(".opt", card).forEach((b) => b.addEventListener("click", () => {
        chosen = +b.dataset.oi;
        $$(".opt", card).forEach((x) => { const on = x === b; x.classList.toggle("chosen", on); x.setAttribute("aria-checked", on ? "true" : "false"); });
        Sound.sfx("tap");
        next.disabled = false;
      }));
      sc.scrollTop = 0;
      const qt = $("#qtext", card); if (qt) qt.focus({ preventScroll: true });
    }
    next.addEventListener("click", () => {
      if (chosen === null || done) return;
      const q = qs[i], ok = chosen === q.answer;
      // a check is retrieval practice too: the review schedule moves, the climb records do not
      Store.recordAnswer(q.id, ok, { prevSeen: shown.prevSeen });
      answers.push({ id: q.id, chosen, ok, wasSeen: shown.wasSeen });
      Sound.sfx("tap");
      if (++i < qs.length) { show(); return; }
      done = true;
      const result = {
        at: Date.now(), topics: topics.slice(), n: qs.length, score: answers.filter((a) => a.ok).length,
        unseen: answers.filter((a) => !a.wasSeen).length, real: qs.filter((q) => q.source === "real").length,
        items: qs.map((q, k) => ({ id: q.id, topic: q.topic, source: q.source, q: q.q, options: q.options.slice(), answer: q.answer, explanation: q.explanation || "", chosen: answers[k].chosen })),
      };
      Store.saveCheck(course.id, result);
      haptic("success");
      // the results replace the check on the same screen, so Back goes to the question sources
      const view = resultScreen(course, result, {});
      el.replaceChildren(...view.el.children);
      el.dataset.screen = "result";
      view.wire(el);
    });
    async function leave() {
      if (done || !answers.length) { pop(); return; }
      const r = await showAlert({ title: "לצאת מהבוחן?", message: "הבוחן לא יישמר. התרגול שכבר בוצע נשמר.",
        buttons: [{ text: "יציאה", value: "leave", style: "destructive" }, { text: "להמשיך", value: "stay", style: "bold", cancel: true }] });
      if (r === "leave") pop();
    }
    return { el, onShow() { if (!shown) show(); }, onBack: leave };
  }

  /** Results of a check (just taken, or saved). Reopening a saved one never touches the learning state. */
  function resultScreen(course, res, opts) {
    const items = res.items || [];
    const wrong = items.filter((it) => it.chosen !== it.answer);
    const per = {};
    items.forEach((it) => { const p = per[it.topic] || (per[it.topic] = [0, 0]); p[1]++; if (it.chosen === it.answer) p[0]++; });
    const history = Store.checks(course.id).slice(0, 3);
    const item = (it) => {
      const ok = it.chosen === it.answer;
      return `<div class="qcard res-item ${ok ? "ok" : "bad"}">
        <div class="q-text">${esc(it.q)}</div>
        <p class="res-line"><b>התשובה שסומנה:</b> <span>${chain(it.options[it.chosen] || "")}</span> ${ok ? "(נכונה)" : "(שגויה)"}</p>
        ${ok ? "" : `<p class="res-line"><b>התשובה הנכונה:</b> <span>${chain(it.options[it.answer])}</span></p>`}
        ${it.explanation ? `<div class="explain ${ok ? "ok" : "bad"}"><div>${esc(it.explanation)}</div></div>` : ""}</div>`;
    };
    const el = h(`<section data-screen="result" class="result">
      ${navbar({ title: "תוצאות הבוחן", back: opts.saved ? "חזרה" : "סיום" })}
      <div class="scroller has-footer">
        <div class="large-title"><h1 class="res-score" tabindex="-1"><bdi>${res.score} מתוך ${res.n}</bdi></h1>
          <p>${esc(fmtDate(res.at))} · ${esc(scopeText(course, res.topics))}</p></div>
        <div class="res-facts"><p>שאלות שלא נראו קודם: <bdi>${res.unseen}</bdi></p><p>שאלות ממבחנים אמיתיים: <bdi>${res.real}</bdi></p>
          <p class="res-note">התוצאה מתייחסת לשאלות שנבדקו בלבד.</p></div>
        <h2 class="section-header">לפי נושא</h2>
        <div class="group">${res.topics.map((t) => `<div class="row res-topic"><span class="row-body"><span class="row-title">${esc(Data.topicName(course, t))}</span></span>
          <span class="row-trail">${per[t] ? `<bdi>${per[t][0]} מתוך ${per[t][1]}</bdi>` : "לא נבדק בבוחן זה"}</span></div>`).join("")}</div>
        <h2 class="section-header">${wrong.length ? `טעויות (${wrong.length})` : "אין טעויות בבוחן הזה"}</h2>
        <div class="res-list" data-wrong>${wrong.map(item).join("")}</div>
        <div class="group"><button class="row check-row quiet" data-all-answers aria-expanded="false"><span class="row-body"><span class="row-title">כל התשובות</span></span>${Icons.chevron()}</button></div>
        <div class="res-list" data-all hidden>${items.filter((it) => it.chosen === it.answer).map(item).join("")}</div>
        ${history.length ? `<h2 class="section-header">תוצאות אחרונות בקורס</h2><div class="group">${history.map((r, k) => `<button class="row check-row quiet" data-past="${k}"><span class="row-body"><span class="row-title"><bdi>${r.score} מתוך ${r.n}</bdi></span><span class="row-sub">${esc(fmtDate(r.at))} · ${esc(scopeText(course, r.topics))}</span></span>${Icons.chevron()}</button>`).join("")}</div>` : ""}
      </div>
      <div class="footer-bar result-actions">${wrong.length ? '<button class="btn-primary" data-practice>לתרגול הטעויות</button>' : ""}<button class="${wrong.length ? "btn-quiet" : "btn-primary"}" data-finish>לסיום</button></div>
    </section>`);
    function wire(root) {
      const b = $('[data-act="back"]', root);
      if (b) b.addEventListener("click", () => { Sound.sfx("tap"); pop(); });
      $("[data-finish]", root).addEventListener("click", () => { Sound.sfx("tap"); pop(); });
      const pr = $("[data-practice]", root);
      if (pr) pr.addEventListener("click", () => { Sound.sfx("tap"); haptic("tap"); push(practiceScreen(course, wrong.map((w) => w.id).slice(0, CHECK_SIZE))); });
      const all = $("[data-all-answers]", root);
      all.addEventListener("click", () => { const box = $("[data-all]", root); box.hidden = !box.hidden; all.setAttribute("aria-expanded", box.hidden ? "false" : "true"); });
      $$("[data-past]", root).forEach((x) => x.addEventListener("click", () => { Sound.sfx("tap"); push(resultScreen(course, history[+x.dataset.past], { saved: true })); }));
      const sc = $(".scroller", root);
      if (sc) sc.addEventListener("scroll", () => root.classList.toggle("scrolled", sc.scrollTop > 36), { passive: true });
      const hd = $(".res-score", root); if (hd) setTimeout(() => hd.focus({ preventScroll: true }), 50);
    }
    return { el, wire, onShow() { if (!el.dataset.wired) { el.dataset.wired = "1"; wire(el); } } };
  }

  /** "לתרגול הטעויות": one pass through the missed questions, with the explanation after each answer. No stairs. */
  function practiceScreen(course, ids) {
    const qs = shuffle(ids.map((id) => course.questions.find((q) => q.id === id)).filter(Boolean));
    let i = 0, answered = false, okCount = 0, cur = null;
    const el = h(`<section data-screen="practice" class="check-screen">
      ${navbar({ title: "תרגול הטעויות", back: "תוצאות" })}
      <div class="scroller has-footer"><div class="block-line" data-progress aria-live="polite"></div><div class="qcard" data-card></div></div>
      <div class="footer-bar"><button class="btn-primary" data-next disabled>הבא</button></div>
    </section>`);
    wireScroller(el);
    const card = $("[data-card]", el), next = $("[data-next]", el);
    function show() {
      const q = qs[i];
      cur = { q, prevSeen: Store.expose(q.id), order: shuffle([0, 1, 2, 3]) };
      answered = false;
      $("[data-progress]", el).textContent = `תרגול: ${i + 1} מתוך ${qs.length}`;
      card.innerHTML = qBody(course, q, cur.order);
      next.disabled = true;
      next.textContent = i === qs.length - 1 ? "לסיום" : "הבא";
      $$(".opt", card).forEach((b) => b.addEventListener("click", () => {
        if (answered) return;
        answered = true;
        const oi = +b.dataset.oi, ok = oi === q.answer;
        if (ok) okCount++;
        Store.recordAnswer(q.id, ok, { prevSeen: cur.prevSeen });
        $$(".opt", card).forEach((x) => {
          x.disabled = true;
          const k = +x.dataset.oi;
          if (k === q.answer) { x.classList.add("correct"); $(".opt-mark", x).innerHTML = Icons.tick(); }
          else if (x === b) { x.classList.add("wrong"); $(".opt-mark", x).innerHTML = Icons.cross(); }
          else x.classList.add("dim");
        });
        Sound.sfx(ok ? "correct" : "wrong"); haptic(ok ? "tap" : "error");
        $("[data-explain]", card).innerHTML = `<div class="explain ${ok ? "ok" : "bad"}" role="status"><h3>${ok ? Icons.tick() : Icons.cross()}${ok ? "נכון!" : "לא נכון"}</h3><div>${esc(q.explanation || "")}</div></div>`;
        next.disabled = false;
      }));
      $(".scroller", el).scrollTop = 0;
    }
    next.addEventListener("click", async () => {
      if (!answered) return;
      Sound.sfx("tap");
      if (++i < qs.length) { show(); return; }
      next.disabled = true;
      await showAlert({ title: "סיימת את תרגול הטעויות", message: `נכון: ${okCount} מתוך ${qs.length}\nתוצאת הבוחן נשארת כפי שהייתה.`, buttons: [{ text: "לסיום", value: "ok", style: "bold", cancel: true }] });
      pop();
    });
    return { el, onShow() { if (!cur) show(); } };
  }

  /* ------------------------------------------------------------------ home: the courses and music tabs */
  const fmtTime = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  /** Album-style cover for a song, drawn from the game's own world (summit, crown, monster, stairs, flames). */
  const COVER_ART = [
    // summit: hills, the sun and the flag
    `<circle cx="72" cy="30" r="12" fill="#FFE27A"/><path d="M0 100 L30 52 L48 74 L70 40 L100 82 V100Z" fill="rgba(0,0,0,.22)"/><path d="M0 100 L22 72 L40 88 L64 62 L100 96 V100Z" fill="rgba(0,0,0,.3)"/><path d="M70 40 V22" stroke="#fff" stroke-width="2"/><path d="M70 22 l12 4 -12 4Z" fill="#fff"/>`,
    // the crown
    `<path d="M24 66 L20 34 L38 50 L50 26 L62 50 L80 34 L76 66Z" fill="#FFD45C" stroke="#E08A00" stroke-width="3" stroke-linejoin="round"/><rect x="24" y="64" width="52" height="10" rx="3" fill="#FFB020"/><circle cx="50" cy="52" r="5" fill="#FF2D55"/>`,
    // the monster, peeking
    `<path d="M34 40 30 22 42 36Z M66 40 70 22 58 36Z" fill="#FFE27A"/><ellipse cx="50" cy="66" rx="30" ry="32" fill="rgba(255,255,255,.18)"/><ellipse cx="40" cy="58" rx="8" ry="9.5" fill="#fff"/><ellipse cx="60" cy="58" rx="8" ry="9.5" fill="#fff"/><circle cx="42" cy="60" r="3.6" fill="#2A1B3A"/><circle cx="62" cy="60" r="3.6" fill="#2A1B3A"/><path d="M40 76 Q50 86 60 76" fill="none" stroke="#2A1B3A" stroke-width="3.5" stroke-linecap="round"/>`,
    // the stairs
    `<path d="M14 86 H34 V70 H50 V54 H66 V38 H86 V86Z" fill="rgba(255,255,255,.28)"/><path d="M14 86 H34 V70 H50 V54 H66 V38 H86" fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round" opacity=".8"/><path d="M80 38 V20" stroke="#fff" stroke-width="2"/><path d="M80 20 l12 4 -12 4Z" fill="#FFE27A"/>`,
  ];
  const FIRE_ART = `<path d="M50 90 C26 84 22 60 36 44 C38 56 46 58 46 58 C42 40 50 22 64 12 C62 32 78 42 78 62 C78 80 66 90 50 90Z" fill="#FFB23A"/><path d="M50 90 C40 86 38 74 44 66 C45 72 50 74 50 74 C49 64 54 56 60 50 C60 62 68 68 66 78 C64 86 58 90 50 90Z" fill="#FFE27A"/>`;
  function cover(t, cls) {
    const c = (t && t.color) || "#6747D9", f = (t && t.file) || "";
    const n = [...f].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
    const art = /final|hell|metal/i.test(f) ? FIRE_ART : COVER_ART[n % COVER_ART.length];
    return `<span class="cover ${cls || ""}" style="--c:${c};--c2:${shade(c, -0.55)}" aria-hidden="true">
      <svg class="art" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">${art}</svg></span>`;
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
              <span class="ic small" aria-hidden="true"></span>
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
    let visible = false, ticker = 0, lastKey = "", lastList = "";

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
      head.style.setProperty("--hc", ((cur && cur.color) || "#6747D9") + "40");     // a soft tint of the song's colour
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

      $("[data-np-note]", el).textContent = p.final ? "המדרגה האחרונה מתנגנת עכשיו" : !p.on ? "המוזיקה כבויה – נגיעה בנגינה מפעילה אותה" : "";
      paintProgress();

      const listKey = JSON.stringify([pr, p.file, p.final, p.playing]);
      if (listKey === lastList) return;
      lastList = listKey;
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

    const off = Sound.onChange(() => { if (visible) paint(); });
    return {
      el,
      destroy() { visible = false; clearInterval(ticker); off(); },
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
      Theme.apply();      // the music tab uses the theme's own surfaces now
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
    const offMini = Sound.onChange(paintMini);
    miniTick = setInterval(() => { if (tab === "courses" && !mini.hidden && el.isConnected) miniProgress(); }, 1000);

    return {
      el,
      onShow() { courses.onShow(); paintMini(); bars(); },
      destroy() { clearInterval(miniTick); offMini(); musicTab.destroy(); if (courses.destroy) courses.destroy(); },
      /** Android Back on the first screen: from the music tab, back to the courses; from the courses, exit. */
      onRootBack() { if (tab === "music") { setTab("courses"); return "handled"; } return "exit"; },
      setTab,
    };
  }

  /* ------------------------------------------------------------------ the start screen
     The loading screen (index.html #splash) turns into the start screen: its sky card shrinks to the top, the monster
     takes the crown and says the line of the day, and the two modes rise below. The last-used mode is the big card.
     The same screen opens again from the "מצב" pill on the courses screen. */
  const MODES = {
    boring: { title: "משעמם", sub: "בשקט: בלי מוזיקה ובלי גיהנום", icon: "quiet" },
    cool: { title: "למגניבים בלבד", sub: "מוזיקה, קונפטי ומטאל במדרגה 19", icon: "loud" },
  };
  const SHADES = `<path d="M33 58h54l-3 12a7 7 0 0 1-6.8 5.4h-9.4a6 6 0 0 1-5.8-4.4l-2-6-2 6a6 6 0 0 1-5.8 4.4h-9.4A7 7 0 0 1 36 70z" fill="#14141A"/><path d="M40 62h10M66 62h10" stroke="#5AD8FF" stroke-width="2" stroke-linecap="round" opacity=".8"/>`;
  const SPECS_BOOK = `<g fill="none" stroke="#3B2C7A" stroke-width="3"><circle cx="48" cy="68" r="12"/><circle cx="72" cy="68" r="12"/><path d="M58 68h4"/></g><path d="M30 98q30-10 60 0v20q-30-9-60 0z" fill="#FFF6E6" stroke="#C9A36B" stroke-width="2"/><path d="M60 92v24" stroke="#C9A36B" stroke-width="2"/>`;
  const modeArt = (m) => Scene.monsterSvg(Theme.current, "happy", "", m === "cool" ? SHADES : SPECS_BOOK);

  const SPEAKER = {
    quiet: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 7.5h3l4-3.5v12l-4-3.5H3z" fill="currentColor"/><path d="M13.5 7.5l4.5 5M18 7.5l-4.5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
    loud: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 7.5h3l4-3.5v12l-4-3.5H2z" fill="currentColor"/><path d="M12 6.5q2.5 3.5 0 7M14.6 4.5q4.2 5.5 0 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  };
  /** The monster's line of the day (picked by date, so it changes every day and needs no upkeep). */
  const LINES = [
    "היום עולים לפסגה. ביחד.", "עוד 20 תשובות ואני עם כתר", "כל תשובה נכונה = מדרגה. בואי נטפס", "קפה? בדוק. מוח? בדוק. יאללה",
    "המבחן לא יודע מה מחכה לו", "טעות היא רק מדרגה אחת אחורה", "אם תגיעי ל־20 אני רוקד", "אני מוכן. את מוכנה?",
    "שאלה אחת. ואז עוד אחת. ואז פסגה.", "אדריכלות? תרבות? הכול אצלך בכיס", "זה היום שלך", "הכתר הזה מחכה לך",
    "בואי נשבור את השיא", "אני שומר לך את הכתר חם", "את ואני = פסגה", "המדרגות לא יטפסו את עצמן",
    "עוד ניצחון קטן אחד?", "היום אני לא נופל. נכון?", "מי שעונה נכון מקבל קונפטי", "רק חמש דקות. אוקיי, עשר.",
    "יש לי הרגשה של 20 ברצף", "בואי נעשה את זה מהר ויפה", "אני פה. את פה. מתחילים", "כל פסגה מתחילה במדרגה אחת",
    "המוח שלך מחמם מנועים", "אני כבר עומד על המדרגה הראשונה", "תני לי לנצח היום, בבקשה?", "לימוד קטן, קפיצה גדולה",
    "עוד יום, עוד פסגה", "את יותר חכמה ממה שאת חושבת",
  ];
  const lineOfDay = () => { const d = new Date(); return LINES[(d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate()) % LINES.length]; };

  function myStats() {
    let best = 0, summits = 0;
    for (const c of Data.courses) {
      best = Math.max(best, Store.bestForCourse(c.id));
      for (const src of ["real", "generated", "mixed"]) summits += Store.sourceStats(c.id, src).summits;
    }
    return { best, summits };
  }

  let SPLASH_CARD = "";       // the sky card's markup, kept to rebuild the start screen from the "מצב" pill
  let start = null;           // the open start screen: { el, boot }

  /** Turns `sp` (the loading screen, or a fresh copy of it) into the start screen. */
  function startScreen(sp, boot) {
    const last = Store.mode, other = last === "cool" ? "boring" : "cool";
    const hero = sp.querySelector(".sp-hero > g");
    if (hero && !hero.querySelector(".sp-shades")) {
      hero.insertAdjacentHTML("beforeend", `<g class="sp-shades"><path d="M33 58h54l-3 12a7 7 0 0 1-6.8 5.4h-9.4a6 6 0 0 1-5.8-4.4l-2-6-2 6a6 6 0 0 1-5.8 4.4h-9.4A7 7 0 0 1 36 70z" fill="#14141A"/><path d="M40 62h10M66 62h10" stroke="#5AD8FF" stroke-width="2" stroke-linecap="round" opacity=".8"/></g>
        <g class="sp-specs" fill="none" stroke="#3B2C7A" stroke-width="3"><circle cx="48" cy="68" r="12"/><circle cx="72" cy="68" r="12"/><path d="M58 68h4"/></g>`);
    }
    const { best, summits } = myStats();
    const card = (m, primary) => `<button class="mode-card ${m} ${primary ? "primary" : "secondary"}" data-mode="${m}">
        ${m === "cool" ? '<span class="mode-fire" aria-hidden="true"></span>' : ""}
        <span class="mode-ic">${modeArt(m)}</span>
        <span class="mode-txt"><b>${MODES[m].title}</b><span class="mode-sub">${SPEAKER[MODES[m].icon]}${MODES[m].sub}</span></span>
        ${primary ? `<span class="mode-go" aria-hidden="true">${Icons.play()}</span>` : ""}
      </button>`;
    const ui = h(`<div class="start-ui">
        <div class="start-stats">${best ? `${Icons.flame()}<span>שיא ${best} ברצף</span><i></i><span>${summits === 1 ? "פסגה אחת" : `${summits} פסגות`}</span>` : `${Icons.flame()}<span>עוד אין שיא – זה הזמן</span>`}</div>
        <div class="start-spacer"></div>
        <p class="start-q">איך משחקים היום?</p>
        <button class="diff-ctl" data-diff aria-haspopup="dialog"></button>
        ${card(last, true)}${card(other, false)}
      </div>`);
    const bubble = h(`<div class="start-bubble" role="note"><span>${esc(lineOfDay())}</span></div>`);
    sp.querySelector(".sp-card").appendChild(bubble);
    sp.appendChild(ui);
    sp.setAttribute("role", "dialog");
    sp.setAttribute("aria-label", "איך משחקים היום?");
    sp.dataset.screen = "mode";

    // the card and the title glide from their loading positions to the top (FLIP), the rest rises in
    const moving = [sp.querySelector(".sp-card"), sp.querySelector("h1")].filter(Boolean);
    const first = moving.map((e) => e.getBoundingClientRect());
    const svg = sp.querySelector(".sp-card svg");
    if (svg) svg.setAttribute("preserveAspectRatio", "xMidYMax slice");   // the card is wider than the art: crop the sky, keep the stairs
    sp.classList.add("ready");
    if (boot && !reduced()) {
      moving.forEach((e, i) => {
        const r = e.getBoundingClientRect(), f = first[i];
        e.style.transition = "none";
        e.style.transform = `translate(${f.left - r.left}px, ${f.top - r.top}px) scale(${f.width / r.width})`;
        e.style.transformOrigin = "0 0";
        void e.offsetWidth;
        e.style.transition = "transform 360ms cubic-bezier(.22, 1, .36, 1)";
        e.style.transform = "";
      });
    }
    if (!boot) sp.classList.add("instant");

    $$(".mode-card", sp).forEach((b) => b.addEventListener("click", () => pickMode(b.dataset.mode, b)));
    const diff = $("[data-diff]", sp);
    const paintDiff = () => {
      const c = Store.difficulty === "casual";
      diff.innerHTML = `${c ? Icons.flagSave() : Icons.stairsDown()}<span>${c ? "עם נקודות שמירה" : "נפילה להתחלה"}</span><i>שינוי</i>`;
      diff.setAttribute("aria-label", `קושי: ${c ? "עם נקודות שמירה" : "נפילה להתחלה"}. שינוי`);
    };
    paintDiff();
    diff.addEventListener("click", () => { Sound.unlock(); Sound.sfx("tap"); haptic("tap"); difficultySheet(paintDiff); });
    document.documentElement.dataset.mode = Store.mode;
    start = { el: sp, boot };
    Sound.music(null);          // no music before she picks (the loud mode might be the wrong one right now)
  }

  const DIFFS = [
    { id: "casual", name: "עם נקודות שמירה", tag: "קז׳ואל", sub: "טעות מחזירה לנקודת השמירה האחרונה: 5, 10 או 15" },
    { id: "hardcore", name: "נפילה להתחלה", tag: "הארדקור", sub: "כל טעות מחזירה למדרגה 0. רק 20 ברצף מגיעים לפסגה" },
  ];
  function difficultySheet(onDone) {
    const layer = h(`<div class="dim-layer sheet-layer on-top" role="dialog" aria-modal="true" aria-labelledby="df-t">
      <div class="sheet"><div class="grabber"></div><h2 id="df-t">מה קורה כשטועים?</h2><p>חל מהטיפוס הבא.</p>
        <div class="diff-list" role="radiogroup">${DIFFS.map((d) => `<button class="diff-row" role="radio" data-d="${d.id}" aria-checked="${Store.difficulty === d.id}">
          <span class="diff-radio" aria-hidden="true"></span><span class="diff-txt"><b>${d.name}</b><small>${d.sub}</small></span><span class="diff-tag">${d.tag}</span></button>`).join("")}</div></div></div>`);
    const close = () => { layer.remove(); const i = overlays.indexOf(entry); if (i >= 0) overlays.splice(i, 1); };
    const entry = { onBack: close };
    overlays.push(entry);
    layer.addEventListener("click", (e) => { if (e.target === layer) { Sound.sfx("tap"); close(); } });
    $$(".diff-row", layer).forEach((b) => b.addEventListener("click", () => {
      Store.difficulty = b.dataset.d;
      Sound.sfx("tap"); haptic("success");
      $$(".diff-row", layer).forEach((x) => x.setAttribute("aria-checked", x === b ? "true" : "false"));
      if (onDone) onDone();
      setTimeout(close, 160);
    }));
    document.body.appendChild(layer);
    const cur = $('.diff-row[aria-checked="true"]', layer);
    if (cur) cur.focus({ preventScroll: true });
  }

  async function pickMode(mode, btn) {
    if (!start || start.picking) return;
    start.picking = true;
    const sp = start.el;
    Store.mode = mode;
    document.documentElement.dataset.mode = mode;
    Sound.unlock(); Sound.sfx("tap"); haptic("success");
    btn.classList.add("is-picked");
    sp.classList.add(mode === "cool" ? "react-cool" : "react-boring");     // shades on, or reading glasses on
    await wait(reduced() ? 0 : 320);
    start = null;                       // closed: the home screen's music may start now
    Sound.refresh();
    await resetRoot(homeScreen());
    sp.classList.add("out");
    setTimeout(() => { if (sp.parentNode) sp.parentNode.removeChild(sp); }, 400);
  }

  /** The "מצב" pill: the start screen again, on top of the courses. Back closes it. */
  function openStart() {
    if (start || !SPLASH_CARD) return;
    const sp = h(`<div id="splash">${SPLASH_CARD}<h1><bdi dir="ltr">The Road To 100</bdi></h1></div>`);
    document.body.appendChild(sp);
    startScreen(sp, false);
  }
  function closeStart() {
    if (!start || start.boot) return;
    const sp = start.el;
    start = null;
    sp.classList.add("out");
    setTimeout(() => { if (sp.parentNode) sp.parentNode.removeChild(sp); }, 400);
    syncMusic();
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

  /* ------------------------------------------------------------------ question updates (data only) */
  async function lookForQuestionUpdates(force) {
    let r = null;
    try { r = await Data.checkForUpdates(force); } catch (e) { r = null; }
    if (!r) return r;
    // screens opened before keep their course objects; the list shows the new data now
    const top = stack[stack.length - 1];
    if (top && top.el.dataset.screen === "courses" && top.onShow) top.onShow();
    const msg = r.added === 1 ? "נוספה שאלה חדשה" : r.added > 1 ? `נוספו ${r.added} שאלות חדשות` : "השאלות עודכנו";
    const t = h(`<div class="update-toast" role="status">${Icons.sparkles()}<span>${msg}</span></div>`);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3800);
    return r;
  }
  window.appCheckForQuestionUpdates = () => lookForQuestionUpdates(true);   // for tests and debugging

  /* ------------------------------------------------------------------ boot */
  async function boot() {
    try {
      await Promise.all([Data.load(), Sound.init(), document.fonts ? document.fonts.ready : null]);
      const sp = document.getElementById("splash");
      const cardEl = sp && sp.querySelector(".sp-card");
      SPLASH_CARD = cardEl ? cardEl.outerHTML : "";
      if (sp) startScreen(sp, true);
      else await resetRoot(homeScreen());
      setTimeout(lookForQuestionUpdates, 4000);   // after the start screen settles; never blocks the app
    } catch (e) {
      const cap = document.querySelector("[data-splash-cap]");
      if (cap) cap.textContent = `לא הצלחתי לטעון את הקורסים. (${e.message})`;
    }
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) Sound.pause(); else Sound.resume(); });
  boot();
})();
