/* Progress, kept in localStorage (every access wrapped in try/catch; falls back to memory). */
(function () {
  const KEY = "stairs.v1";
  const DAY = 86400000;
  const RECALL_GAP = 72 * 3600000;          // a correct answer counts as "recalled later" after 72 h without seeing it
  const STEP_DAYS = [0, 1, 3, 7, 14];       // review interval per step (step 1 = tomorrow ... capped at 14 days)
  let mem = null, dirty = false;

  function read() {
    if (mem) return mem;
    let data = null;
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) data = JSON.parse(raw);
    } catch (e) { data = null; }
    const existing = !!(data && typeof data === "object" && data.courses && Object.keys(data.courses).length);
    if (!data || typeof data !== "object") data = {};
    data.courses = data.courses || {};
    data.q = data.q || {};
    // learning state per question id: { d: due time, s: step, a: anchor (a correct answer), r: recalled later, l: last seen }
    data.L = data.L && typeof data.L === "object" ? data.L : {};
    if (!data.lv) {
      // first launch with spaced review: questions answered wrong before are due now (history kept, no recall credit)
      const now = Date.now();
      Object.keys(data.q).forEach((qid) => { const v = data.q[qid]; if (v && v[1] > 0 && !data.L[qid]) data.L[qid] = { d: now, s: 1, a: 0, r: 0, l: 0 }; });
      data.lv = 1; dirty = true;
    }
    data.settings = Object.assign({ sound: true, music: true, theme: "auto" }, data.settings || {});
    // the rules never change silently: players from before keep the full reset
    if (data.settings.difficulty !== "casual" && data.settings.difficulty !== "hardcore") data.settings.difficulty = existing ? "hardcore" : "casual";
    mem = data;
    if (dirty) { dirty = false; write(); }
    return mem;
  }

  function write() {
    try { window.localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* storage full or blocked: keep in memory */ }
  }

  function course(cid) {
    const d = read();
    if (!d.courses[cid]) d.courses[cid] = { lastTopics: null, sources: {} };
    if (!d.courses[cid].sources) d.courses[cid].sources = {};
    return d.courses[cid];
  }

  function src(cid, source) {
    const c = course(cid);
    if (!c.sources[source]) c.sources[source] = { best: 0, summits: 0, lastTopics: null };
    return c.sources[source];
  }

  window.Store = {
    get sound() { return !!read().settings.sound; },
    set sound(v) { read().settings.sound = !!v; write(); },
    get theme() { return read().settings.theme || "auto"; },
    set theme(v) { read().settings.theme = String(v); write(); },
    get music() { return !!read().settings.music; },
    /** "cool" (למגניבים בלבד: music, hell mode) or "boring" (משעמם: neither). Picked on the first screen. */
    /** "hardcore" (a wrong answer: back to stair 0) or "casual" (back to the last checkpoint: 5, 10 or 15). */
    get difficulty() { return read().settings.difficulty === "hardcore" ? "hardcore" : "casual"; },
    set difficulty(v) { read().settings.difficulty = v === "hardcore" ? "hardcore" : "casual"; write(); },
    get mode() { return read().settings.mode === "boring" ? "boring" : "cool"; },
    set mode(v) { read().settings.mode = v === "boring" ? "boring" : "cool"; write(); },
    set music(v) { read().settings.music = !!v; write(); },
    /** The music tab's choices: { playlist: [files] | null, shuffle, summit: file | null, final: file | null }. */
    get musicPrefs() { const m = read().settings.musicPrefs; return m && typeof m === "object" ? m : null; },
    set musicPrefs(v) { read().settings.musicPrefs = v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : null; write(); },

    lastTopics(cid) { return course(cid).lastTopics; },
    setLastTopics(cid, topics, source) {
      course(cid).lastTopics = topics.slice();
      if (source) src(cid, source).lastTopics = topics.slice();
      write();
    },

    sourceStats(cid, source) { const s = src(cid, source); return { best: s.best || 0, summits: s.summits || 0, casualSummits: s.casualSummits || 0 }; },
    bestForCourse(cid) {
      const c = course(cid);
      return Object.values(c.sources).reduce((m, s) => Math.max(m, s.best || 0), 0);
    },
    recordStreak(cid, source, streak) {
      const s = src(cid, source);
      if (streak > (s.best || 0)) { s.best = streak; write(); return true; }
      return false;
    },
    /** Hardcore and casual summits are kept apart (a casual summit isn't 20 in a row). */
    recordSummit(cid, source, casual) {
      const s = src(cid, source);
      if (casual) { s.casualSummits = (s.casualSummits || 0) + 1; write(); return s.casualSummits; }
      s.summits = (s.summits || 0) + 1; write(); return s.summits;
    },

    qStats(qid) { const v = read().q[qid]; return v ? { seen: v[0], wrong: v[1] } : { seen: 0, wrong: 0 }; },
    /** Learning state of one question: seen at all, due for review now (and since when), recalled later, last seen. */
    learning(qid, now = Date.now()) {
      const d = read(), L = d.L[qid], v = d.q[qid];
      return { seen: !!(v && v[0]) || !!(L && L.l), due: !!(L && L.d && L.d <= now), dueAt: L ? L.d || 0 : 0, recalled: !!(L && L.r), last: L ? L.l || 0 : 0 };
    },
    /** The question is on screen: remember when, and return the previous time it was seen (for the 72 h recall rule). */
    expose(qid, now = Date.now()) {
      const d = read();
      const L = d.L[qid] || (d.L[qid] = { d: 0, s: 0, a: 0, r: 0, l: 0 });
      const prev = L.l || 0;
      L.l = now; write();
      return prev;
    },
    /**
     * An answer. Spaced review: the first correct answer -> due tomorrow; a correct answer to a due question ->
     * the next interval (3, 7, 14 days); a wrong answer -> due tomorrow and no recall credit. Early practice and
     * same-session retries ({ retry: true }) never move a due date or give recall credit.
     * prevSeen: when the question was seen before this showing (from expose()).
     */
    recordAnswer(qid, correct, opt = {}, now = Date.now()) {
      const d = read();
      const v = d.q[qid] || [0, 0];
      v[0] += 1;
      if (!correct) v[1] += 1;
      d.q[qid] = v;
      const L = d.L[qid] || (d.L[qid] = { d: 0, s: 0, a: 0, r: 0, l: 0 });
      const prev = opt.prevSeen != null ? opt.prevSeen : (L.l || 0);
      if (!correct) {
        L.a = 0; L.r = 0; L.s = 1; L.d = now + DAY;
      } else if (!opt.retry) {
        if (!L.r && L.a && prev && now - prev >= RECALL_GAP) L.r = 1;
        if (!L.a) L.a = now;
        if (!L.d) { L.s = 1; L.d = now + DAY; }
        else if (now >= L.d) { L.s = Math.min((L.s || 1) + 1, 4); L.d = now + STEP_DAYS[L.s] * DAY; }
      }
      L.l = Math.max(L.l || 0, now);
      write();
    },
  };
})();
