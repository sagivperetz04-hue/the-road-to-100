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
  const LETTERS = ["א", "ב", "ג", "ד"];
  const SOURCE_INFO = {
    real: { title: "שאלות אמיתיות", desc: "ממבחנים, בחנים ומהמרצה", icon: "exam", color: "linear-gradient(145deg,#34C759,#248A3D)", badge: "אמיתית" },
    generated: { title: "שאלות מחוללות", desc: "נוצרו בבינה מלאכותית מתוך הסיכומים של הקורס", icon: "sparkles", color: "linear-gradient(145deg,#BF5AF2,#8944AB)", badge: "מחוללת" },
    mixed: { title: "מעורב", desc: "גם אמיתיות וגם מחוללות, בסדר אקראי", icon: "shuffle", color: "linear-gradient(145deg,#FF9F0A,#FF6B00)", badge: "" },
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
    if (top) Sound.music(top.el.dataset.screen === "game" ? "game" : "menu");
  }

  function back() {
    const ov = overlays[overlays.length - 1];
    if (ov) { ov.onBack(); return "handled"; }
    if (stack.length <= 1) return "exit";
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
      ${navbar({ title: "בחרי קורס", action: `<span class="nav-actions"><button class="nav-action" data-act="theme" aria-label="ערכת צבעים">${Icons.palette()}</button>${Sound.hasMusic ? '<button class="nav-action" data-act="music" aria-label="מוזיקה"></button>' : ""}<button class="nav-action" data-act="sound" aria-label="צלילים"></button></span>` })}
      <div class="scroller">
        <div class="banner" data-banner aria-hidden="true"></div>
        <div class="large-title"><h1>בחרי קורס</h1><p>20 תשובות נכונות ברצף = פסגה.</p></div>
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
    }

    const paintBanner = () => { $("[data-banner]", el).innerHTML = Art.banner(Theme.current); };
    paintBanner();
    Theme.onChange(paintBanner);
    $('[data-act="theme"]', el).addEventListener("click", () => { Sound.unlock(); Sound.sfx("tap"); haptic("tap"); themeSheet(); });

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

  function gameScreen(course, topics, source) {
    const pool = Data.pool(course, topics, source);
    let deck = [], lastId = null, current = null, order = [], answered = false;
    let streak = 0, summitOpen = false, alive = true, islandTimer = 0, started = false;
    const C = 2 * Math.PI * 18;

    const el = h(`<section data-screen="game" class="game">
      <div class="game-top">
        <button class="round-btn" data-act="leave" aria-label="יציאה מהמשחק">${Icons.back()}</button>
        <div class="island" data-island aria-live="polite"><span class="isl-idle"></span><div class="isl-content"></div></div>
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
        if (streak >= GOAL) { await hop; if (alive) openSummit(); return; }
        if (streak % 5 === 0) setTimeout(() => { if (alive) showIsland(Sound.playClip(false)); }, 350);
      } else {
        const had = streak;
        streak = 0;
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

    function confetti(host) {
      if (reduced()) return () => {};
      const cv = document.createElement("canvas");
      host.prepend(cv);
      const ctx = cv.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      const resize = () => { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; };
      resize();
      const colors = ["#FF2D55", "#FF9F0A", "#FFD60A", "#30D158", "#64D2FF", "#BF5AF2", "#5856D6"];
      const parts = Array.from({ length: 140 }, () => ({
        x: Math.random() * cv.width, y: -Math.random() * cv.height * 0.6, r: (4 + Math.random() * 5) * dpr,
        vx: (Math.random() - 0.5) * 2.2 * dpr, vy: (2 + Math.random() * 3) * dpr, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.25,
        c: colors[(Math.random() * colors.length) | 0],
      }));
      let raf = 0; const t0 = performance.now();
      const tick = (now) => {
        ctx.clearRect(0, 0, cv.width, cv.height);
        const fade = Math.max(0, 1 - Math.max(0, now - t0 - 2600) / 1200);
        for (const p of parts) {
          p.x += p.vx; p.y += p.vy; p.a += p.va; p.vy += 0.03 * dpr;
          ctx.save(); ctx.globalAlpha = fade; ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); ctx.restore();
        }
        if (fade > 0) raf = requestAnimationFrame(tick); else cv.remove();
      };
      raf = requestAnimationFrame(tick);
      return () => { cancelAnimationFrame(raf); cv.remove(); };
    }

    function openSummit() {
      summitOpen = true;
      const summits = Store.recordSummit(course.id, source);
      const st = Store.sourceStats(course.id, source);
      scene.celebrate();
      Sound.music("summit");
      Sound.sfx("correct"); haptic("success");
      setTimeout(() => { if (alive) showIsland(Sound.playClip(true)); }, 250);
      const theme = Theme.current;
      const buddy = (flip) => theme === "pink"
        ? `<svg class="buddy" viewBox="-40 -70 80 74" aria-hidden="true"><defs>${Art.DEFS}</defs>${Art.unicorn({ flip })}</svg>`
        : "";
      const ov = h(`<div class="summit" role="dialog" aria-modal="true" aria-labelledby="sm-t">
        <div class="rays" aria-hidden="true"></div>
        ${Icons.crown()}
        <div class="stage">${buddy(true)}
        <svg class="hero" viewBox="-40 -64 80 70" aria-hidden="true"><defs><radialGradient id="heroGrad2" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#FF9BD2"/><stop offset=".55" stop-color="#E05CC8"/><stop offset="1" stop-color="#9B3FC4"/></radialGradient></defs>
          <ellipse cx="-6" cy="-3" rx="5" ry="3.4" fill="#7A3FA8"/><ellipse cx="6" cy="-3" rx="5" ry="3.4" fill="#7A3FA8"/>
          <path d="M-9 -29 L-12 -40 L-3 -32 Z M9 -29 L12 -40 L3 -32 Z" fill="#FFD60A" stroke="#E0A800" stroke-width=".8"/>
          <ellipse cx="0" cy="-17" rx="15" ry="15.5" fill="url(#heroGrad2)"/>
          <path d="M-14 -16 L-24 -30 M14 -16 L24 -30" stroke="#C04FC9" stroke-width="6" stroke-linecap="round"/>
          <path d="M-9 -20 Q-5.5 -25 -2 -20 M2 -20 Q5.5 -25 9 -20" fill="none" stroke="#1c1c1e" stroke-width="1.8" stroke-linecap="round"/>
          <path d="M-6 -14 Q0 -6.5 6 -14 Z" fill="#5B1A61"/>
          <circle cx="-10" cy="-15" r="2.3" fill="#FF6FA8" opacity=".6"/><circle cx="10" cy="-15" r="2.3" fill="#FF6FA8" opacity=".6"/></svg>${buddy(false)}</div>
        <div class="kicker">${GOAL} תשובות נכונות ברצף!</div>
        <h2 id="sm-t">ציציפלצת האולטימטיבית</h2>
        <p>${esc(course.name)}</p>
        <div class="stats">
          <div class="stat"><b>${summits}</b><span>${summits === 1 ? "פסגה ראשונה" : "פסגות בקורס"}</span></div>
          <div class="stat key"><b>${st.best}</b><span>שיא רצף</span></div>
          <div class="stat"><b>${pool.length}</b><span>שאלות במאגר</span></div>
        </div>
        <div class="actions"><button class="btn-primary" data-again>עוד טיפוס</button><button class="btn-secondary" data-menu>חזרה לבחירת שאלות</button></div>
      </div>`);
      const stop = confetti(ov);
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
      destroy() { alive = false; scene.destroy(); clearTimeout(islandTimer); Sound.stop(); },
    };
  }

  /* ------------------------------------------------------------------ boot */
  async function boot() {
    const loading = h('<section class="screen"><div class="loading">טוען…</div></section>');
    stackEl.appendChild(loading);
    try {
      await Promise.all([Data.load(), Sound.init(), document.fonts ? document.fonts.ready : null]);
      loading.remove();
      stackEl.classList.add("no-anim");
      await push(coursesScreen());
      requestAnimationFrame(() => stackEl.classList.remove("no-anim"));
    } catch (e) {
      loading.innerHTML = `<div class="error-box">לא הצלחתי לטעון את הקורסים. (${esc(e.message)})</div>`;
    }
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) Sound.pause(); else Sound.resume(); });
  boot();
})();
