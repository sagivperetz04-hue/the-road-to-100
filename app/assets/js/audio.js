/* Sound: short UI effects + 5-second "Now Playing" clips.
   Clips come from audio/manifest.json; when it is empty the app plays its own synthesized jingles. */
(function () {
  let ctx = null;
  let master = null;
  let fileClips = [];
  let clipIndex = 0;
  let active = [];      // scheduled nodes of the current clip
  let activeEl = null;  // <audio> element of the current file clip
  let stopTimer = null;

  // Original melodies written for this app: [semitones from root, beats] ; null = rest
  const JINGLES = [
    { title: "Marble Steps", artist: "Studio Madregot", color: "#30D158", bpm: 132, root: 72,
      lead: [[0,.5],[4,.5],[7,.5],[12,.5],[11,.5],[7,.5],[4,.5],[7,.5],[9,.5],[5,.5],[2,.5],[5,.5],[7,1],[12,1],[14,.5],[12,.5],[11,.5],[12,1.5]],
      bass: [[-24,2],[-20,2],[-27,2],[-29,2],[-24,3]] },
    { title: "Ziggurat Groove", artist: "Studio Madregot", color: "#FF9F0A", bpm: 118, root: 69,
      lead: [[0,.75],[3,.25],[5,.5],[7,.5],[10,.5],[7,.5],[5,1],[3,.5],[5,.5],[7,.75],[10,.25],[12,1],[10,.5],[7,.5],[5,.5],[3,.5],[0,1.5]],
      bass: [[-24,1],[-24,1],[-21,1],[-19,1],[-17,1],[-19,1],[-21,1],[-24,1],[-24,2]] },
    { title: "Olive Grove", artist: "Studio Madregot", color: "#64D2FF", bpm: 104, root: 67,
      lead: [[7,.5],[5,.5],[4,.5],[2,.5],[4,1],[0,1],[2,.5],[4,.5],[5,.5],[7,.5],[9,1],[7,1],[12,1.5]],
      bass: [[-24,2],[-19,2],[-22,2],[-17,2.5]] },
    { title: "Summit Glow", artist: "Studio Madregot", color: "#FF375F", bpm: 140, root: 74,
      lead: [[0,.25],[4,.25],[7,.25],[12,.75],[7,.25],[12,.25],[16,1],[14,.5],[12,.5],[11,.5],[12,.5],[16,.5],[19,1.5],[24,2]],
      bass: [[-24,1],[-17,1],[-12,1],[-17,1],[-20,1],[-15,1],[-24,2],[-12,2]] },
  ];

  function ensureCtx() {
    if (ctx) { if (ctx.state === "suspended") ctx.resume().catch(() => {}); return ctx; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
    } catch (e) { ctx = null; }
    return ctx;
  }

  const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  function tone(freq, start, dur, type, vol, dest) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + 0.015);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol * 0.45), start + Math.min(dur * 0.6, 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g); g.connect(dest || master);
    o.start(start); o.stop(start + dur + 0.05);
    active.push(o);
    return o;
  }

  function hat(start, vol) {
    const len = Math.floor(ctx.sampleRate * 0.05);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const n = ctx.createBufferSource();
    n.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 7000;
    const g = ctx.createGain(); g.gain.value = vol;
    n.connect(f); f.connect(g); g.connect(master);
    n.start(start);
    active.push(n);
  }

  function kick(start) {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.setValueAtTime(130, start); o.frequency.exponentialRampToValueAtTime(45, start + 0.12);
    g.gain.setValueAtTime(0.5, start); g.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
    o.connect(g); g.connect(master); o.start(start); o.stop(start + 0.2);
    active.push(o);
  }

  function playJingle(j) {
    const c = ensureCtx();
    if (!c) return;
    const beat = 60 / j.bpm;
    const t0 = c.currentTime + 0.05;
    const end = t0 + 5;
    let t = t0;
    for (const [n, b] of j.lead) {
      if (t >= end) break;
      const d = Math.min(b * beat, end - t);
      if (n !== null) { tone(hz(j.root + n), t, d * 0.95, "triangle", 0.22); tone(hz(j.root + n + 12), t, d * 0.5, "sine", 0.05); }
      t += b * beat;
    }
    t = t0;
    for (const [n, b] of j.bass) {
      if (t >= end) break;
      tone(hz(j.root + n), t, Math.min(b * beat, end - t) * 0.9, "sine", 0.28);
      t += b * beat;
    }
    for (let k = 0, bt = t0; bt < end - 0.1; k++, bt += beat / 2) {
      hat(bt, k % 2 ? 0.05 : 0.08);
      if (k % 4 === 0) kick(bt);
    }
    const fade = master.gain;
    fade.cancelScheduledValues(c.currentTime);
    fade.setValueAtTime(0.55, c.currentTime);
    fade.setValueAtTime(0.55, end - 0.6);
    fade.linearRampToValueAtTime(0.0001, end);
    fade.setValueAtTime(0.55, end + 0.05);
  }

  function stopAll() {
    clearTimeout(stopTimer);
    for (const n of active) { try { n.stop(); } catch (e) { /* already stopped */ } }
    active = [];
    if (master && ctx) { master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setValueAtTime(0.55, ctx.currentTime); }
    if (activeEl) { try { activeEl.pause(); } catch (e) { /* ignore */ } activeEl = null; }
  }

  window.Sound = {
    async init() {
      try {
        const res = await fetch("audio/manifest.json", { cache: "no-store" });
        const list = res.ok ? await res.json() : [];
        fileClips = Array.isArray(list) ? list.filter((c) => c && typeof c.file === "string") : [];
      } catch (e) { fileClips = []; }
    },
    unlock() { if (Store.sound) ensureCtx(); },

    sfx(kind) {
      if (!Store.sound) return;
      const c = ensureCtx();
      if (!c) return;
      const t = c.currentTime + 0.01;
      if (kind === "correct") { tone(hz(84), t, 0.12, "sine", 0.25); tone(hz(88), t + 0.08, 0.18, "sine", 0.22); tone(hz(91), t + 0.16, 0.3, "sine", 0.2); }
      else if (kind === "wrong") { tone(hz(52), t, 0.22, "square", 0.08); tone(hz(47), t + 0.14, 0.35, "square", 0.07); }
      else if (kind === "tap") { tone(hz(96), t, 0.04, "sine", 0.06); }
      else if (kind === "fall") { const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = "triangle"; o.frequency.setValueAtTime(700, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.6); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.65); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.7); }
    },

    /** Plays a 5-second clip. Returns { title, artist, color } for the island, or null when muted. */
    playClip(preferSummit) {
      if (!Store.sound) return null;
      stopAll();
      if (fileClips.length) {
        const c = fileClips[clipIndex++ % fileClips.length];
        try {
          const el = new Audio("audio/" + c.file);
          activeEl = el;
          el.volume = 1;
          el.addEventListener("loadedmetadata", () => { if (c.start) el.currentTime = c.start; }, { once: true });
          const p = el.play();
          if (p && p.catch) p.catch(() => {});
          const fadeStart = Date.now() + 4400;
          const iv = setInterval(() => { if (activeEl !== el) return clearInterval(iv); const left = fadeStart + 600 - Date.now(); if (Date.now() > fadeStart) el.volume = Math.max(0, left / 600); }, 60);
          stopTimer = setTimeout(() => { clearInterval(iv); stopAll(); }, 5000);
        } catch (e) { return null; }
        return { title: c.title || c.file, artist: c.artist || "", color: c.color || "#30D158" };
      }
      const j = preferSummit ? JINGLES[3] : JINGLES[clipIndex++ % 3];
      playJingle(j);
      stopTimer = setTimeout(stopAll, 5100);
      return { title: j.title, artist: j.artist, color: j.color };
    },
    stop: stopAll,
  };
})();
