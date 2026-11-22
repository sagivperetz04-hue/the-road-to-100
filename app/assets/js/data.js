/* Data layer: /data/courses.json + /data/<folder>/{course,questions-real,questions-generated}.json */
(function () {
  async function getJSON(url, fallback) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return fallback;
      return await res.json();
    } catch (e) {
      return fallback;
    }
  }

  let IMAGES = new Set();   // images/index.json: the pictures bundled in this APK
  function cleanQuestions(list, source, topicIds) {
    if (!Array.isArray(list)) return [];
    return list.filter((q) =>
      // a picture question needs its picture in this build (photos are not in the public repo or in updates)
      (q.image === undefined || (typeof q.image === "string" && IMAGES.has(q.image))) &&
      q && typeof q.id === "string" && typeof q.q === "string" && q.q.trim() &&
      Array.isArray(q.options) && q.options.length === 4 && q.options.every((o) => typeof o === "string" && o.trim()) &&
      Number.isInteger(q.answer) && q.answer >= 0 && q.answer <= 3 &&
      topicIds.has(q.topic)
    ).map((q) => Object.assign({}, q, { source }));
  }

  /* ---- question updates from GitHub (data only; the app code changes only with a new APK) ----
   * data/version.json = { format, hash, updated }. The app checks the repo's copy at most once an hour; when it is
   * newer it downloads every data file, checks them like the build does, and keeps them in localStorage. The
   * bundled data wins again when a newer APK brings newer data. Nothing is sent; failures change nothing. */
  const REMOTE = "https://raw.githubusercontent.com/sagivperetz04-hue/the-road-to-100/master/app/assets/data/";
  const CACHE_KEY = "stairs.data.v1", CHECK_KEY = "stairs.data.checked", FORMAT = 1, EVERY = 3600000;
  const FILES = ["course.json", "questions-real.json", "questions-generated.json"];

  function readCache() {
    try { const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); return c && c.version && c.files ? c : null; } catch (e) { return null; }
  }
  const newer = (a, b) => !!(a && a.updated && (!b || !b.updated || a.updated > b.updated));

  /** A source of data files: the bundled assets, or a map of downloaded files. */
  function bundledSource() { return (name, fallback) => getJSON(name, fallback); }
  function cachedSource(files) {
    return async (name, fallback) => {
      const key = name.replace(/^data\//, "");
      if (!(key in files)) return fallback;
      try { return JSON.parse(files[key]); } catch (e) { return fallback; }
    };
  }

  async function loadCourse(entry, get) {
    const base = `data/${entry.folder}/`;
    const [info, real, gen] = await Promise.all([
      get(base + "course.json", null),
      get(base + "questions-real.json", []),
      get(base + "questions-generated.json", []),
    ]);
    if (!info || !Array.isArray(info.topics)) return null;
    const topics = info.topics.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const ids = new Set(topics.map((t) => t.id));
    const questions = cleanQuestions(real, "real", ids).concat(cleanQuestions(gen, "generated", ids));
    return {
      id: entry.id, folder: entry.folder,
      name: info.name || entry.name, code: info.code || entry.code,
      subtitle: info.subtitle || "", color: info.color || "", icon: info.icon || "book",
      topics, questions,
    };
  }

  async function loadAll(get) {
    const manifest = await get("data/courses.json", null);
    if (!Array.isArray(manifest)) throw new Error("courses.json is missing or invalid");
    const loaded = await Promise.all(manifest.map((e) => loadCourse(e, get)));
    return loaded.filter(Boolean);
  }

  /** Download all data files of the repo's current version; null when anything is missing or invalid. */
  async function download(version) {
    const fetchText = async (name) => {
      const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const t = ctl ? setTimeout(() => ctl.abort(), 15000) : 0;
      try {
        const res = await fetch(REMOTE + name, { cache: "no-store", signal: ctl ? ctl.signal : undefined });
        if (!res.ok) return null;
        return await res.text();
      } catch (e) { return null; } finally { clearTimeout(t); }
    };
    const files = {};
    const man = await fetchText("courses.json");
    let manifest;
    try { manifest = JSON.parse(man); } catch (e) { return null; }
    if (!Array.isArray(manifest) || !manifest.length) return null;
    files["courses.json"] = man;
    for (const entry of manifest) {
      if (!entry || typeof entry.folder !== "string" || !/^[a-z0-9-]+$/.test(entry.folder)) return null;
      for (const f of FILES) {
        const txt = await fetchText(`${entry.folder}/${f}`);
        if (txt === null) { if (f === "course.json") return null; continue; }
        try { JSON.parse(txt); } catch (e) { return null; }
        files[`${entry.folder}/${f}`] = txt;
      }
    }
    // the same checks as loading: every course must load and have questions
    const courses = await loadAll(cachedSource(files)).catch(() => null);
    if (!courses || courses.length !== manifest.length || courses.some((c) => !c.questions.length)) return null;
    return { version, files, courses };
  }

  window.Data = {
    courses: [],
    version: null,          // { format, hash, updated } of the data in use
    fromUpdate: false,      // true when the data came from a downloaded update
    async load() {
      const imgs = await getJSON("images/index.json", []);
      IMAGES = new Set(Array.isArray(imgs) ? imgs : []);
      const bundled = await getJSON("data/version.json", null);
      const cache = readCache();
      if (cache && cache.version.format <= FORMAT && newer(cache.version, bundled)) {
        try {
          this.courses = await loadAll(cachedSource(cache.files));
          this.version = cache.version; this.fromUpdate = true;
          return this.courses;
        } catch (e) { /* a broken cache: fall back to the bundled data */ }
      }
      if (cache) { try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* storage blocked */ } }   // older than the APK's data
      this.courses = await loadAll(bundledSource());
      this.version = bundled; this.fromUpdate = false;
      return this.courses;
    },
    /**
     * Look for newer questions on GitHub (at most once an hour unless force). Resolves to
     * { added, total } when new data was downloaded and is now in use, or null.
     */
    async checkForUpdates(force) {
      if (window.__noDataUpdates) return null;
      const now = Date.now();
      try { if (!force && now - (+localStorage.getItem(CHECK_KEY) || 0) < EVERY) return null; } catch (e) { /* storage blocked */ }
      if (this._checking) return null;
      this._checking = true;
      try { return await this._check(now); } finally { this._checking = false; }
    },
    async _check(now) {
      let remote = null;
      try {
        const res = await fetch(REMOTE + "version.json", { cache: "no-store" });
        if (res.ok) remote = await res.json();
      } catch (e) { return null; }        // offline or no answer: try again on the next launch or resume
      if (remote) { try { localStorage.setItem(CHECK_KEY, String(now)); } catch (e) { /* storage blocked */ } }
      if (!remote || typeof remote.hash !== "string" || !(remote.format <= FORMAT)) return null;
      if (this.version && remote.hash === this.version.hash) return null;
      if (!newer(remote, this.version)) return null;
      const got = await download(remote);
      if (!got) return null;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ version: got.version, files: got.files })); } catch (e) { return null; }   // too big for storage: keep what we have
      const before = this.courses.reduce((n, c) => n + c.questions.length, 0);
      this.courses = got.courses; this.version = got.version; this.fromUpdate = true;
      const total = got.courses.reduce((n, c) => n + c.questions.length, 0);
      return { added: total - before, total };
    },
    hasImage(src) { return IMAGES.has(src); },
    course(id) { return this.courses.find((c) => c.id === id); },
    /** questions of a course filtered by topics + source ("real" | "generated" | "mixed") */
    pool(course, topics, source) {
      const set = new Set(topics);
      return course.questions.filter((q) => set.has(q.topic) && (source === "mixed" || q.source === source));
    },
    count(course, topics, source) { return this.pool(course, topics, source).length; },
    topicName(course, tid) { const t = course.topics.find((x) => x.id === tid); return t ? t.name : tid; },
  };
})();
