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

  function cleanQuestions(list, source, topicIds) {
    if (!Array.isArray(list)) return [];
    return list.filter((q) =>
      q && typeof q.id === "string" && typeof q.q === "string" && q.q.trim() &&
      Array.isArray(q.options) && q.options.length === 4 && q.options.every((o) => typeof o === "string" && o.trim()) &&
      Number.isInteger(q.answer) && q.answer >= 0 && q.answer <= 3 &&
      topicIds.has(q.topic)
    ).map((q) => Object.assign({}, q, { source }));
  }

  async function loadCourse(entry) {
    const base = `data/${entry.folder}/`;
    const [info, real, gen] = await Promise.all([
      getJSON(base + "course.json", null),
      getJSON(base + "questions-real.json", []),
      getJSON(base + "questions-generated.json", []),
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

  window.Data = {
    courses: [],
    async load() {
      const manifest = await getJSON("data/courses.json", null);
      if (!Array.isArray(manifest)) throw new Error("courses.json is missing or invalid");
      const loaded = await Promise.all(manifest.map(loadCourse));
      this.courses = loaded.filter(Boolean);
      return this.courses;
    },
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
