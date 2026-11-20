/* Progress, kept in localStorage (every access wrapped in try/catch; falls back to memory). */
(function () {
  const KEY = "stairs.v1";
  let mem = null;

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
    data.settings = Object.assign({ sound: true, music: true, theme: "auto" }, data.settings || {});
    // the rules never change silently: players from before keep the full reset
    if (data.settings.difficulty !== "casual" && data.settings.difficulty !== "hardcore") data.settings.difficulty = existing ? "hardcore" : "casual";
    mem = data;
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
    recordAnswer(qid, correct) {
      const d = read();
      const v = d.q[qid] || [0, 0];
      v[0] += 1;
      if (!correct) v[1] += 1;
      d.q[qid] = v;
      write();
    },
  };
})();
