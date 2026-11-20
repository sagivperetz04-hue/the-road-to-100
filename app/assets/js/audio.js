/* Sound: short UI effects, 5-second "Now Playing" clips, and optional background music.
   audio/manifest.json is either a list of clips (old format) or
     { "clips": [ ...5-second clips... ], "music": { "menu": [...], "game": [...], "summit": [...] },
       "sfx": { "wrong": { "file": ... } }, "final": { "file": ..., "gain": 3 } }.
   "final" is the last-stair track: it plays even when sound is off, boosted by "gain" (3 = 300%) through Web Audio,
   and holds the background song until it stops.
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
  const made = [];         // every <audio> this module created (pause() reaches all of them; Sound.debugPlaying lists them)
  function mkAudio(file, kind) {
    const el = new Audio("audio/" + file);
    el.dataset.kind = kind; el.dataset.file = file;
    for (let i = made.length - 1; i >= 0; i--) if (!made[i].getAttribute("src")) made.splice(i, 1);   // dropped ones
    made.push(el);
    return el;
  }
  function dropEl(el) { if (!el) return; clearInterval(el._fade); try { el.pause(); el.removeAttribute("src"); el.load(); } catch (e) { /* ignore */ } }

  /** Each element has its own fade, so starting a new fade never strands an old song half-faded and still playing. */
  function fadeTo(el, to, ms, done) {
    if (!el) { if (done) done(); return; }
    clearInterval(el._fade);
    const from = el.volume, t0 = Date.now();
    if (ms <= 0) { try { el.volume = to; } catch (e) { /* ignore */ } if (done) done(); return; }
    el._fade = setInterval(() => {
      const k = Math.min(1, (Date.now() - t0) / ms);
      try { el.volume = Math.max(0, Math.min(1, from + (to - from) * k)); } catch (e) { /* ignore */ }
      if (k >= 1) { clearInterval(el._fade); el._fade = 0; if (done) done(); }
    }, 40);
  }

  /** One song at a time: every music element except `keep` fades out and is dropped. */
  function retireOthers(keep, ms) {
    for (const e of made) {
      if (e === keep || e.dataset.kind !== "music" || !e.getAttribute("src") || e.dataset.retiring) continue;
      e.dataset.retiring = "1";
      if (e.paused) dropEl(e); else fadeTo(e, 0, ms == null ? FADE_MS / 2 : ms, () => dropEl(e));
    }
  }

  const sfxFiles = {};     // kind -> { file, volume, el }
  let lastSfx = null;
  const music = { tracks: { menu: [], game: [], summit: [] }, scene: null, el: null, track: null, index: {}, ducked: false, duckTimer: 0,
    paused: false, userPaused: false, bags: {}, lastFile: null, watch: 0, played: null, history: [] };
  const listeners = [];
  function notify() { for (const fn of listeners) { try { fn(); } catch (e) { /* ignore */ } } }

  /* ------------------------------------------------------------ library and the player's choices (the music tab) */
  const lib = { list: [], byFile: {}, bgVol: {}, sumVol: {}, base: { menu: [], game: [], summit: [] }, baseFinal: null };
  let prefs = { playlist: null, shuffle: true, summit: null, final: null };   // null = the manifest's choice
  const BG_VOL = 0.3, SUMMIT_VOL = 0.9;

  function buildLibrary(m, fin) {
    lib.list = []; lib.byFile = {}; lib.bgVol = {}; lib.sumVol = {};
    const add = (t) => {
      if (!lib.byFile[t.file]) {
        const e = { file: t.file, title: t.title || t.file.replace(/^.*\//, "").replace(/\.\w+$/, ""), artist: t.artist || "", color: t.color || "#1DB954" };
        lib.byFile[t.file] = e; lib.list.push(e);
      }
    };
    for (const sc of SCENES) for (const t of m[sc] || []) {
      add(t);
      if (sc !== "summit" && t.volume != null && lib.bgVol[t.file] == null) lib.bgVol[t.file] = t.volume;
      if (sc === "summit" && t.volume != null) lib.sumVol[t.file] = t.volume;
    }
    if (fin) add(fin);
    lib.base = { menu: m.menu || [], game: m.game || [], summit: m.summit || [] };
    lib.baseFinal = fin;
  }

  /** The tracks each scene plays: the manifest's, overridden by the player's choices. */
  function applyPrefs() {
    const have = (f) => !!lib.byFile[f];
    const pl = Array.isArray(prefs.playlist) ? prefs.playlist.filter(have) : [];
    if (pl.length) {
      const list = pl.map((f) => Object.assign({}, lib.byFile[f], { volume: lib.bgVol[f] != null ? lib.bgVol[f] : BG_VOL }));
      music.tracks.menu = list; music.tracks.game = list;
    } else { music.tracks.menu = lib.base.menu; music.tracks.game = lib.base.game; }
    music.tracks.summit = prefs.summit && have(prefs.summit)
      ? [Object.assign({}, lib.byFile[prefs.summit], { volume: lib.sumVol[prefs.summit] != null ? lib.sumVol[prefs.summit] : SUMMIT_VOL, loop: false })]
      : lib.base.summit;
    const fb = lib.baseFinal;
    final.cfg = prefs.final && have(prefs.final) ? Object.assign({}, lib.byFile[prefs.final], { gain: fb && fb.gain != null ? fb.gain : 3 }) : fb;
    music.bags = {};
  }

  /** Shuffle: every song once per round in random order, never the same song twice in a row.
      With shuffle off: the playlist in order. Scenes with the same list (menu and game) share one round. */
  function nextIndex(list) {
    if (list.length === 1) return 0;
    if (!prefs.shuffle) {
      const at = list.findIndex((t) => t.file === music.lastFile);
      return at < 0 ? 0 : (at + 1) % list.length;
    }
    const key = list.map((t) => t.file).join("|");
    let bag = music.bags[key];
    if (!bag || !bag.length) {
      bag = list.map((_, i) => i);
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
      if (list[bag[0]].file === music.lastFile) bag.push(bag.shift());   // don't repeat the song that just ended
      music.bags[key] = bag;
    }
    return bag.shift();
  }

  /** Some Android WebViews don't fire "ended" for streamed assets: every 1.5 s, notice a song that ran out and move on. */
  function watchEnd() {
    clearInterval(music.watch);
    music.watch = setInterval(() => {
      const el = music.el;
      if (!el || music.paused || music.userPaused) return;
      const done = el.ended || (el.paused && el.duration > 0 && isFinite(el.duration) && el.currentTime >= el.duration - 0.6);
      if (done) el.dispatchEvent(new Event("ended"));
    }, 1500);
  }

  /* ------------------------------------------------------------ the last-stair track */
  const final = { cfg: null, el: null, gain: null, on: false };

  function finalPlay() {
    const f = final.cfg;
    if (!f) return;
    if (final.el && final.el.dataset.file !== f.file) { dropEl(final.el); final.el = null; final.gain = null; }   // another song was picked
    if (!final.el) {
      final.el = mkAudio(f.file, "final");
      final.el.preload = "auto";
      final.el.loop = true;
      // louder than 100%: route the element through a gain node (an <audio> volume stops at 1), then a limiter so the
      // boost stays loud instead of clipping into noise
      const c = ensureCtx();
      if (c && c.createMediaElementSource) {
        try {
          const src = c.createMediaElementSource(final.el);
          final.gain = c.createGain();
          final.gain.gain.value = f.gain != null ? f.gain : 3;
          const lim = c.createDynamicsCompressor();
          lim.threshold.value = -3; lim.knee.value = 4; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.2;
          src.connect(final.gain); final.gain.connect(lim); lim.connect(c.destination);
        } catch (e) { final.gain = null; }
      }
    } else ensureCtx();
    final.el.volume = 1;
    const p = final.el.play();
    if (p && p.catch) p.catch(() => {});
  }

  function finalStart() {
    if (!final.cfg || Store.mode === "boring") return false;
    if (final.on) return true;
    final.on = true;
    stopAll();
    retireOthers(music.el, 150);
    if (music.el) { clearInterval(music.el._fade); try { music.el.pause(); } catch (e) { /* ignore */ } }   // hold the song where it is
    try { if (final.el) final.el.currentTime = 0; } catch (e) { /* not loaded yet */ }
    if (!music.paused) finalPlay();
    notify();
    return true;
  }

  function finalStop() {
    if (!final.on) return;
    final.on = false;
    if (final.el) { try { final.el.pause(); final.el.currentTime = 0; } catch (e) { /* ignore */ } }
    const held = music.el;
    // let a scene change that follows right away (the summit) replace the held song instead of resuming it
    setTimeout(() => { if (!final.on && !music.paused && music.el === held) resumeMusic(); notify(); }, 0);
  }

  const musicOn = () => Store.sound && Store.music && Store.mode !== "boring";   // the "משעמם" mode has no music at all
  const canPlay = () => musicOn() && !music.paused && !music.userPaused && !final.on;
  const target = () => (music.track ? (music.track.volume != null ? music.track.volume : MUSIC_VOL) : MUSIC_VOL) * (music.ducked ? DUCK : 1);

  /** Starts a song for the scene: the next one from its list, list[at], or a given track (picked in the music tab). */
  function startTrack(scene, at, pick) {
    const list = music.tracks[scene] || [];
    if ((!list.length && !pick) || final.on) return;
    let t = pick;
    if (!t) { const i = at != null ? at : nextIndex(list); music.index[scene] = i; t = list[i]; }
    if (music.track && music.track.file !== t.file) { music.history.push(music.track.file); if (music.history.length > 30) music.history.shift(); }
    music.lastFile = t.file;
    const el = mkAudio(t.file, "music");
    el.preload = "auto";
    el.loop = !pick && list.length === 1 && t.loop !== false;
    el.volume = 0;
    el.addEventListener("ended", () => {
      if (music.el !== el || el.dataset.done) return;
      el.dataset.done = "1";
      dropEl(el); music.el = null;
      const now = music.scene, nowList = music.tracks[now] || [];
      if (nowList.length === 1 && nowList[0].loop === false) { music.track = null; music.played = now; notify(); return; }   // one-shot: done
      if (now && canPlay()) startTrack(now); else notify();
    });
    el.addEventListener("error", () => { if (music.el === el) { music.el = null; music.track = null; notify(); } });
    el.addEventListener("play", notify);
    el.addEventListener("pause", notify);
    music.el = el; music.track = t;
    retireOthers(el);
    watchEnd();
    const p = el.play();
    if (p && p.catch) p.catch(() => {});
    fadeTo(el, target(), FADE_MS);
    notify();
  }

  function setScene(scene) {
    if (scene && !SCENES.includes(scene)) scene = null;
    if (music.scene === scene && (music.el || !musicOn() || music.played === scene)) return;
    // the song playing now is also in the new scene's list (menu <-> game): keep it going
    const shared = scene && music.el && music.track ? (music.tracks[scene] || []).findIndex((t) => t.file === music.track.file) : -1;
    if (shared >= 0) { music.scene = scene; music.played = null; music.index[scene] = shared; return; }
    // a song picked in the music tab keeps playing between the menu and the game too
    if ((scene === "menu" || scene === "game") && (music.scene === "menu" || music.scene === "game") && music.el && music.track && music.track.picked) {
      music.scene = scene; music.played = null; return;
    }
    music.scene = scene;
    music.played = null;
    const had = !!music.el;
    music.el = null; music.track = null;
    retireOthers(null);
    if (scene && canPlay()) setTimeout(() => { if (music.scene === scene && !music.el && canPlay()) startTrack(scene); }, had ? FADE_MS / 2 : 0);
    notify();
  }

  function duck(ms) {
    if (!music.el) return;
    music.ducked = true; fadeTo(music.el, target(), 250);
    clearTimeout(music.duckTimer);
    music.duckTimer = setTimeout(() => { music.ducked = false; if (music.el && !music.userPaused) fadeTo(music.el, target(), 600); }, ms);
  }

  /** App in the background: silence every element this module made (songs still fading out are dropped outright). */
  function pauseMusic() {
    music.paused = true;
    for (const e of made) {
      if (e.dataset.kind === "music" && e !== music.el) dropEl(e);
      else { try { e.pause(); } catch (err) { /* ignore */ } }
    }
  }

  function resumeMusic() {
    music.paused = false;
    if (final.on) { finalPlay(); return; }
    if (!musicOn() || music.userPaused || !music.scene || music.played === music.scene) return;
    if (music.el) { const p = music.el.play(); if (p && p.catch) p.catch(() => {}); fadeTo(music.el, target(), FADE_MS); }
    else startTrack(music.scene);
  }

  function stopMusic() {
    music.el = null; music.track = null;
    retireOthers(null, 200);
    notify();
  }

  function stopAll() {
    clearTimeout(stopTimer);
    for (const n of active) { try { n.stop(); } catch (e) { /* already stopped */ } }
    active = [];
    if (master && ctx) { master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setValueAtTime(0.55, ctx.currentTime); }
    if (activeEl) { try { activeEl.pause(); } catch (e) { /* ignore */ } activeEl = null; }
  }

  /** The music tab's play button also switches music (and sound) on: pressing play means "I want music". */
  function turnOn() {
    music.userPaused = false;
    if (!Store.sound) Store.sound = true;
    if (!Store.music) Store.music = true;
    ensureCtx();
  }
  const bgScene = () => (music.scene === "menu" || music.scene === "game" ? music.scene : null);

  function playFile(file) {
    const sc = bgScene(), e = lib.byFile[file];
    if (!sc || !e || final.on) return false;
    turnOn();
    const list = music.tracks[sc] || [];
    const at = list.findIndex((t) => t.file === file);
    if (at >= 0) startTrack(sc, at);
    else startTrack(sc, null, Object.assign({}, e, { volume: lib.bgVol[file] != null ? lib.bgVol[file] : BG_VOL, picked: true }));
    return true;
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
      const raw = (man && !Array.isArray(man) && man.music) || {};
      const m = {};
      for (const sc of SCENES) m[sc] = Array.isArray(raw[sc]) ? raw[sc].filter(ok) : [];
      const fx = (man && !Array.isArray(man) && man.sfx) || {};
      for (const kind of Object.keys(fx)) {
        if (!ok(fx[kind])) continue;
        const el = mkAudio(fx[kind].file, "sfx");
        el.preload = "auto";
        sfxFiles[kind] = { file: fx[kind].file, volume: fx[kind].volume != null ? fx[kind].volume : 1, el };
      }
      buildLibrary(m, man && !Array.isArray(man) && ok(man.final) ? man.final : null);
      prefs = Object.assign({ playlist: null, shuffle: true, summit: null, final: null }, Store.musicPrefs || {});
      applyPrefs();
    },
    // first tap: browsers that block autoplay start the waiting music now
    unlock() { if (Store.sound || final.on) ensureCtx(); if (final.on || music.userPaused) return; if (musicOn() && music.scene && !music.paused && (!music.el || music.el.paused)) resumeMusic(); },

    /** True when the manifest lists at least one background-music track. */
    get hasMusic() { return lib.list.length > 0; },

    /* ---- the music tab */
    /** Every song in the app: [{ file, title, artist, color }]. */
    library() { return lib.list.map((t) => Object.assign({}, t)); },
    /** The player's choices as files: { playlist: [...], shuffle, summit, final } (manifest defaults filled in). */
    prefs() {
      return { playlist: (music.tracks.menu.length ? music.tracks.menu : music.tracks.game).map((t) => t.file), shuffle: prefs.shuffle !== false,
        summit: music.tracks.summit[0] ? music.tracks.summit[0].file : null, final: final.cfg ? final.cfg.file : null };
    },
    /** Change some choices ({ playlist, shuffle, summit, final }); saved in stairs.v1. */
    setPrefs(patch) {
      prefs = Object.assign({}, prefs, patch);
      Store.musicPrefs = prefs;
      applyPrefs();
      notify();
    },
    /** What the player shows: the current song, play state and progress. */
    player() {
      const t = final.on ? final.cfg : music.track, el = final.on ? final.el : music.el;
      const e = t ? (lib.byFile[t.file] || t) : null;
      return { file: e ? e.file : null, title: e ? e.title : "", artist: e ? e.artist : "", color: e ? e.color : "#1DB954",
        playing: !!(el && !el.paused) && !music.userPaused, time: el ? el.currentTime || 0 : 0,
        duration: el && isFinite(el.duration) ? el.duration : 0, shuffle: prefs.shuffle !== false, final: final.on, scene: music.scene,
        on: musicOn() };
    },
    /** Play / pause from the music tab. */
    toggle() {
      if (final.on) return;
      if (music.el && !music.el.paused && !music.userPaused) {
        music.userPaused = true;
        const el = music.el;
        fadeTo(el, 0, 180, () => { if (music.userPaused && music.el === el) el.pause(); notify(); });
      } else {
        turnOn();
        if (!bgScene() && music.scene !== "summit") return notify();
        resumeMusic();
      }
      notify();
    },
    /** Skip to the next song of the playlist. */
    next() { const sc = bgScene(); if (!sc || final.on) return; turnOn(); startTrack(sc); },
    /** Back to the start of the song, or (in its first 3 seconds) the song before. */
    prev() {
      if (final.on) return;
      if (music.el && music.el.currentTime > 3) { music.el.currentTime = 0; turnOn(); resumeMusic(); return; }
      const f = music.history.pop();
      if (f) { playFile(f); music.history.pop(); } else if (music.el) { music.el.currentTime = 0; }
    },
    /** Jump to a point of the current song (0..1). */
    seek(frac) { const el = music.el; if (!final.on && el && isFinite(el.duration) && el.duration > 0) el.currentTime = Math.max(0, Math.min(0.999, frac)) * el.duration; },
    /** Play this song now (from the music tab). */
    playFile,
    /** Call fn whenever the song or play state changes. */
    onChange(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
    /** Which music to play: "menu", "game", "summit", or null for silence. Crossfades; same scene keeps playing. */
    music(scene) { setScene(scene); },
    /** Called when sound or music is switched on/off. */
    refresh() { if (final.on) return; if (musicOn()) resumeMusic(); else stopMusic(); },
    /** App went to the background / came back (also called from MainActivity.onPause/onResume). */
    pause() { stopAll(); pauseMusic(); },
    resume() { resumeMusic(); },
    /** The last-stair track: on = play it (even when sound is off), off = back to the background song.
        Returns false when the manifest has no "final" track. */
    final(on) { return on ? finalStart() : (finalStop(), !!final.cfg); },
    /** For tests: what the last-stair track is doing. */
    finalState() { return { on: final.on, playing: !!(final.el && !final.el.paused), boosted: !!final.gain, gain: final.gain ? final.gain.gain.value : 1, file: final.cfg ? final.cfg.file : null }; },
    /** For tests: every audio element that is playing right now (kind, file, volume, speed). */
    debugPlaying() { return made.filter((e) => !e.paused && !e.ended && e.getAttribute("src")).map((e) => ({ kind: e.dataset.kind, file: e.dataset.file, volume: +e.volume.toFixed(2), rate: e.playbackRate, time: +e.currentTime.toFixed(1) })); },
    /** For tests: play the current song faster, to reach its end quickly. */
    debugSpeed(rate) { if (music.el) music.el.playbackRate = rate; return !!music.el; },
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
    musicState() { return { scene: music.scene, userPaused: music.userPaused, playing: !!(music.el && !music.el.paused), held: !!(music.el && music.el.paused && final.on), file: music.track ? music.track.file : null, ducked: music.ducked, volume: music.el ? +music.el.volume.toFixed(2) : 0, played: music.played || null, time: music.el ? +music.el.currentTime.toFixed(2) : 0 }; },

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
          const el = mkAudio(c.file, "clip");
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
