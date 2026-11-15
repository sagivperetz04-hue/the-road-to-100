/* Sound: short UI effects, 5-second "Now Playing" clips, and optional background music.
   audio/manifest.json is either a list of clips (old format) or
     { "clips": [ ...5-second clips... ], "music": { "menu": [...], "game": [...], "summit": [...] },
       "sfx": { "wrong": { "file": ... } } }.
   A song listed for both menu and game keeps playing when moving between those screens.
   A file sound effect replaces the built-in one (a "wrong" file also replaces the falling sound).
   With no clips listed nothing plays at the 5-stair milestones; with no music tracks there is no background music. */
(function () {
  const SCENES = ["menu", "game", "summit"];
  const MUSIC_VOL = 0.35;   // default track volume (a track can set its own "volume", 0..1)
  const DUCK = 0.25;        // music volume factor while a clip plays
  const FADE_MS = 700;
  let ctx = null;
  let master = null;
  let fileClips = [];
  let clipIndex = 0;
  let active = [];      // scheduled nodes of the current clip
  let activeEl = null;  // <audio> element of the current file clip
  let stopTimer = null;

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

  /* ------------------------------------------------------------ background music */
  const sfxFiles = {};     // kind -> { file, volume, el }
  let lastSfx = null;
  const music = { tracks: {}, scene: null, el: null, track: null, index: {}, fadeIv: 0, ducked: false, duckTimer: 0, paused: false };

  const musicOn = () => Store.sound && Store.music;
  const target = () => (music.track ? (music.track.volume != null ? music.track.volume : MUSIC_VOL) : MUSIC_VOL) * (music.ducked ? DUCK : 1);

  function fadeTo(el, to, ms, done) {
    clearInterval(music.fadeIv);
    if (!el) { if (done) done(); return; }
    const from = el.volume, t0 = Date.now();
    if (ms <= 0) { el.volume = to; if (done) done(); return; }
    music.fadeIv = setInterval(() => {
      const k = Math.min(1, (Date.now() - t0) / ms);
      try { el.volume = Math.max(0, Math.min(1, from + (to - from) * k)); } catch (e) { /* ignore */ }
      if (k >= 1) { clearInterval(music.fadeIv); if (done) done(); }
    }, 40);
  }

  function dropEl(el) { if (!el) return; try { el.pause(); el.removeAttribute("src"); el.load(); } catch (e) { /* ignore */ } }

  function startTrack(scene) {
    const list = music.tracks[scene] || [];
    if (!list.length) return;
    const i = (music.index[scene] = ((music.index[scene] == null ? -1 : music.index[scene]) + 1) % list.length);
    const t = list[i];
    const el = new Audio("audio/" + t.file);
    el.preload = "auto";
    el.loop = list.length === 1 && t.loop !== false;
    el.volume = 0;
    el.addEventListener("ended", () => {
      if (music.el !== el) return;
      dropEl(el); music.el = null;
      const now = music.scene, nowList = music.tracks[now] || [];
      if (nowList.length === 1 && nowList[0].loop === false) { music.track = null; music.played = now; return; }   // one-shot: done
      if (now && musicOn() && !music.paused) startTrack(now);
    });
    el.addEventListener("error", () => { if (music.el === el) { music.el = null; music.track = null; } });
    music.el = el; music.track = t;
    const p = el.play();
    if (p && p.catch) p.catch(() => {});
    fadeTo(el, target(), FADE_MS);
  }

  function setScene(scene) {
    if (scene && !SCENES.includes(scene)) scene = null;
    if (music.scene === scene && (music.el || !musicOn() || music.played === scene)) return;
    // the song playing now is also in the new scene's list (menu <-> game): keep it going
    const shared = scene && music.el && music.track ? (music.tracks[scene] || []).findIndex((t) => t.file === music.track.file) : -1;
    if (shared >= 0) { music.scene = scene; music.played = null; music.index[scene] = shared; return; }
    music.scene = scene;
    music.played = null;
    const old = music.el;
    music.el = null; music.track = null;
    if (old) fadeTo(old, 0, FADE_MS / 2, () => dropEl(old));
    if (scene && musicOn() && !music.paused) setTimeout(() => { if (music.scene === scene && !music.el) startTrack(scene); }, old ? FADE_MS / 2 : 0);
  }

  function duck(ms) {
    if (!music.el) return;
    music.ducked = true; fadeTo(music.el, target(), 250);
    clearTimeout(music.duckTimer);
    music.duckTimer = setTimeout(() => { music.ducked = false; if (music.el) fadeTo(music.el, target(), 600); }, ms);
  }

  function pauseMusic() {
    music.paused = true;
    if (music.el) { try { music.el.pause(); } catch (e) { /* ignore */ } }
  }

  function resumeMusic() {
    music.paused = false;
    if (!musicOn() || !music.scene || music.played === music.scene) return;
    if (music.el) { const p = music.el.play(); if (p && p.catch) p.catch(() => {}); fadeTo(music.el, target(), FADE_MS); }
    else startTrack(music.scene);
  }

  function stopMusic() {
    const old = music.el;
    music.el = null; music.track = null;
    if (old) fadeTo(old, 0, 200, () => dropEl(old));
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
      let man = [];
      try {
        const res = await fetch("audio/manifest.json", { cache: "no-store" });
        man = res.ok ? await res.json() : [];
      } catch (e) { man = []; }
      const ok = (c) => c && typeof c.file === "string" && c.file.trim();
      const clips = Array.isArray(man) ? man : (man && Array.isArray(man.clips) ? man.clips : []);
      fileClips = clips.filter(ok);
      const m = (man && !Array.isArray(man) && man.music) || {};
      music.tracks = {};
      for (const sc of SCENES) music.tracks[sc] = Array.isArray(m[sc]) ? m[sc].filter(ok) : [];
      const fx = (man && !Array.isArray(man) && man.sfx) || {};
      for (const kind of Object.keys(fx)) {
        if (!ok(fx[kind])) continue;
        const el = new Audio("audio/" + fx[kind].file);
        el.preload = "auto";
        sfxFiles[kind] = { file: fx[kind].file, volume: fx[kind].volume != null ? fx[kind].volume : 1, el };
      }
    },
    // first tap: browsers that block autoplay start the waiting music now
    unlock() { if (Store.sound) ensureCtx(); if (musicOn() && music.scene && !music.paused && (!music.el || music.el.paused)) resumeMusic(); },

    /** True when the manifest lists at least one background-music track. */
    get hasMusic() { return SCENES.some((sc) => music.tracks[sc] && music.tracks[sc].length); },
    /** Which music to play: "menu", "game", "summit", or null for silence. Crossfades; same scene keeps playing. */
    music(scene) { setScene(scene); },
    /** Called when sound or music is switched on/off. */
    refresh() { if (musicOn()) resumeMusic(); else stopMusic(); },
    /** App went to the background / came back (also called from MainActivity.onPause/onResume). */
    pause() { stopAll(); pauseMusic(); },
    resume() { resumeMusic(); },
    /** For tests: the last sound effect asked for, and which file played it (null = built-in). */
    sfxState() { return lastSfx; },
    /** True when the manifest lists music for this scene ("menu" | "game" | "summit"). */
    hasSceneMusic(scene) { return !!(music.tracks[scene] && music.tracks[scene].length); },
    /** Title info of the scene's current (or first) track, for the "Now Playing" island; null when muted. */
    nowPlaying(scene) {
      if (!musicOn()) return null;
      const t = music.track || (music.tracks[scene] || [])[0];
      return t ? { title: t.title || t.file, artist: t.artist || "", color: t.color || "#FF2D78" } : null;
    },
    /** For tests: what the music player is doing. */
    musicState() { return { scene: music.scene, playing: !!(music.el && !music.el.paused), file: music.track ? music.track.file : null, ducked: music.ducked, volume: music.el ? +music.el.volume.toFixed(2) : 0, played: music.played || null, time: music.el ? +music.el.currentTime.toFixed(2) : 0 }; },

    sfx(kind) {
      if (!Store.sound) return;
      if (kind === "fall" && sfxFiles.wrong) return;          // the "wrong" sound effect covers the fall too
      const f = sfxFiles[kind];
      if (f) {
        try {
          f.el.pause(); f.el.currentTime = 0; f.el.volume = Math.max(0, Math.min(1, f.volume));
          const pr = f.el.play();
          if (pr && pr.catch) pr.catch(() => {});
          duck(Math.min(3000, (f.el.duration || 2) * 1000));
          lastSfx = { kind, file: f.file, at: Date.now() };
        } catch (e) { /* ignore */ }
        return;
      }
      lastSfx = { kind, file: null, at: Date.now() };
      const c = ensureCtx();
      if (!c) return;
      const t = c.currentTime + 0.01;
      if (kind === "correct") { tone(hz(84), t, 0.12, "sine", 0.25); tone(hz(88), t + 0.08, 0.18, "sine", 0.22); tone(hz(91), t + 0.16, 0.3, "sine", 0.2); }
      else if (kind === "wrong") { tone(hz(52), t, 0.22, "square", 0.08); tone(hz(47), t + 0.14, 0.35, "square", 0.07); }
      else if (kind === "tap") { tone(hz(96), t, 0.04, "sine", 0.06); }
      else if (kind === "fall") { const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = "triangle"; o.frequency.setValueAtTime(700, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.6); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.65); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.7); }
    },

    /** Plays a 5-second clip from the manifest. Returns { title, artist, color } for the island, or null (muted, or no clips). */
    playClip() {
      if (!Store.sound || !fileClips.length) return null;   // no clips listed: the background song is left alone
      stopAll();
      duck(5200);
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
      return null;   // no clips listed: nothing plays at the milestones
    },
    stop: stopAll,
  };
})();
