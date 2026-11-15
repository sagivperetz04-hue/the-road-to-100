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
    if (!data || typeof data !== "object") data = {};
    data.courses = data.courses || {};
    data.q = data.q || {};
    data.settings = Object.assign({ sound: true, music: true, theme: "auto" }, data.settings || {});
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
    set music(v) { read().settings.music = !!v; write(); },

    lastTopics(cid) { return course(cid).lastTopics; },
    setLastTopics(cid, topics, source) {
      course(cid).lastTopics = topics.slice();
      if (source) src(cid, source).lastTopics = topics.slice();
      write();
    },

    sourceStats(cid, source) { const s = src(cid, source); return { best: s.best || 0, summits: s.summits || 0 }; },
    bestForCourse(cid) {
      const c = course(cid);
      return Object.values(c.sources).reduce((m, s) => Math.max(m, s.best || 0), 0);
    },
    recordStreak(cid, source, streak) {
      const s = src(cid, source);
      if (streak > (s.best || 0)) { s.best = streak; write(); return true; }
      return false;
    },
    recordSummit(cid, source) { const s = src(cid, source); s.summits = (s.summits || 0) + 1; write(); return s.summits; },

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
