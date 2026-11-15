/* The staircase scene: 20 steps rising to the left (RTL), a small monster that climbs, and a following camera. */
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const W = 46, H = 24, STEPS = 20;
  // y = 0 is the ground surface: step 0 stands on the grass, step i is i*H above it.
  const GROUND = 0;
  const VIEW_W = 400, VIEW_H = 260, CAM_X = 212, CAM_Y = 192;
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const stepPos = (i) => ({ x: -i * W, y: -i * H });
  const ease = {
    out: (t) => 1 - Math.pow(1 - t, 3),
    inOut: (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    in: (t) => t * t,
  };

  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function monster(parent) {
    const g = el("g", { class: "hero" }, parent);
    // shadow + feet stay planted on the surface; only the body above them bobs and squashes
    const feet = el("g", { class: "hero-feet" }, g);
    feet.innerHTML = `
      <ellipse cx="0" cy="-.6" rx="13" ry="2.6" fill="rgba(0,0,0,.16)"/>
      <ellipse class="foot" cx="-6" cy="-3.4" rx="5" ry="3.4" fill="#7A3FA8"/>
      <ellipse class="foot" cx="6" cy="-3.4" rx="5" ry="3.4" fill="#7A3FA8"/>`;
    const bob = el("g", { class: "hero-bob" }, g);
    const body = el("g", { class: "hero-body" }, bob);
    body.innerHTML = `
      <path d="M-9 -29 L-12 -40 L-3 -32 Z" fill="#FFD60A" stroke="#E0A800" stroke-width=".8" stroke-linejoin="round"/>
      <path d="M9 -29 L12 -40 L3 -32 Z" fill="#FFD60A" stroke="#E0A800" stroke-width=".8" stroke-linejoin="round"/>
      <ellipse cx="0" cy="-17" rx="15" ry="15.5" fill="url(#heroGrad)"/>
      <ellipse cx="0" cy="-12" rx="9" ry="8" fill="#FFC8E4" opacity=".55"/>
      <ellipse cx="-14.5" cy="-14" rx="3.4" ry="5" fill="#C04FC9" transform="rotate(20 -14.5 -14)"/>
      <ellipse cx="14.5" cy="-14" rx="3.4" ry="5" fill="#C04FC9" transform="rotate(-20 14.5 -14)"/>
      <g class="face-happy">
        <ellipse cx="-5.5" cy="-21" rx="4.2" ry="4.8" fill="#fff"/><ellipse cx="5.5" cy="-21" rx="4.2" ry="4.8" fill="#fff"/>
        <circle cx="-6.6" cy="-21.6" r="2.3" fill="#1c1c1e"/><circle cx="4.4" cy="-21.6" r="2.3" fill="#1c1c1e"/>
        <circle cx="-7.3" cy="-22.6" r=".8" fill="#fff"/><circle cx="3.7" cy="-22.6" r=".8" fill="#fff"/>
        <path d="M-4.5 -13.5 Q0 -9.5 4.5 -13.5" fill="none" stroke="#5B1A61" stroke-width="1.6" stroke-linecap="round"/>
      </g>
      <g class="face-oops" style="display:none">
        <ellipse cx="-5.5" cy="-21" rx="4.6" ry="5.2" fill="#fff"/><ellipse cx="5.5" cy="-21" rx="4.6" ry="5.2" fill="#fff"/>
        <circle cx="-5.5" cy="-21" r="1.6" fill="#1c1c1e"/><circle cx="5.5" cy="-21" r="1.6" fill="#1c1c1e"/>
        <ellipse cx="0" cy="-11.5" rx="2.6" ry="3.2" fill="#5B1A61"/>
      </g>
      <g class="face-party" style="display:none">
        <path d="M-9 -20 Q-5.5 -25 -2 -20 M2 -20 Q5.5 -25 9 -20" fill="none" stroke="#1c1c1e" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M-6 -14 Q0 -6.5 6 -14 Z" fill="#5B1A61"/>
      </g>
      <circle cx="-10" cy="-15" r="2.3" fill="#FF6FA8" opacity=".55"/><circle cx="10" cy="-15" r="2.3" fill="#FF6FA8" opacity=".55"/>`;
    return { g, bob, body };
  }

  function build(container, opts) {
    const color = opts.color || "#FF9500";
    container.innerHTML = "";
    const svg = el("svg", { viewBox: `0 0 ${VIEW_W} ${VIEW_H}`, preserveAspectRatio: "xMidYMid slice", role: "img", "aria-label": "מדרגות הטיפוס" }, container);
    svg.innerHTML = `
      <defs>
        <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7EC8FF"/><stop offset=".65" stop-color="#C9E8FF"/><stop offset="1" stop-color="#EAF4FF"/></linearGradient>
        <radialGradient id="heroGrad" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#FF9BD2"/><stop offset=".55" stop-color="#E05CC8"/><stop offset="1" stop-color="#9B3FC4"/></radialGradient>
        <linearGradient id="stepGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F3E2C1"/><stop offset="1" stop-color="#DCC08E"/></linearGradient>
        <linearGradient id="grassGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ED96B"/><stop offset="1" stop-color="#5DB54A"/></linearGradient>
        <radialGradient id="sunGlow"><stop offset="0" stop-color="#FFF4B8"/><stop offset=".5" stop-color="#FFE066" stop-opacity=".6"/><stop offset="1" stop-color="#FFE066" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="${VIEW_W}" height="${VIEW_H}" fill="url(#skyGrad)"/>
      <circle cx="78" cy="58" r="46" fill="url(#sunGlow)"/><circle cx="78" cy="58" r="17" fill="#FFE066"/>`;
    const far = el("g", {}, svg);
    far.innerHTML = `
      <path d="M-400 230 L-250 120 L-140 190 L-20 95 L110 185 L230 105 L360 190 L470 120 L640 230 Z" fill="#A9C8EC" opacity=".7"/>
      <path d="M-400 240 L-300 170 L-180 215 L-60 150 L70 220 L190 160 L320 225 L450 165 L640 240 Z" fill="#8FB3DE" opacity=".6"/>`;
    const clouds = el("g", { class: "clouds" }, svg);
    clouds.innerHTML = [[60, 40, 1], [250, 26, .8], [400, 60, .9], [-120, 50, .85]].map(([x, y, s]) =>
      `<g transform="translate(${x} ${y}) scale(${s})" opacity=".92"><ellipse cx="0" cy="0" rx="26" ry="10" fill="#fff"/><ellipse cx="14" cy="-6" rx="16" ry="11" fill="#fff"/><ellipse cx="-12" cy="-4" rx="12" ry="8" fill="#fff"/></g>`).join("");

    const world = el("g", { class: "world" }, svg);
    // ground with a few bushes
    el("rect", { class: "ground", x: -1500, y: GROUND, width: 2400, height: 600, fill: "url(#grassGrad)" }, world);
    el("rect", { x: -1500, y: GROUND, width: 2400, height: 4, fill: "#B5EB95" }, world);
    for (const [bx, s] of [[70, 1], [150, .8], [-1080, .9], [300, 1.1]]) {
      const b = el("g", { transform: `translate(${bx} ${GROUND}) scale(${s})` }, world);
      b.innerHTML = '<ellipse cx="0" cy="-6" rx="14" ry="7" fill="#6CC456"/><ellipse cx="10" cy="-8" rx="9" ry="8" fill="#7FD266"/><ellipse cx="-9" cy="-7" rx="8" ry="7" fill="#7FD266"/>';
    }
    // summit platform (wider top)
    const top = stepPos(STEPS);
    el("rect", { class: "step-block", x: top.x - W / 2 - 70, y: top.y, width: 70 + W, height: GROUND - top.y, fill: "url(#stepGrad)" }, world);
    el("rect", { x: top.x - W / 2 - 70, y: top.y, width: 70 + W, height: 5, fill: "#FBF1DD" }, world);
    // steps
    for (let i = STEPS - 1; i >= 1; i--) {
      const p = stepPos(i);
      el("rect", { class: "step-block", x: p.x - W / 2, y: p.y, width: W, height: GROUND - p.y, fill: "url(#stepGrad)" }, world);
      el("rect", { x: p.x - W / 2, y: p.y, width: W, height: 5, fill: "#FBF1DD" }, world);
      el("rect", { x: p.x + W / 2 - 4, y: p.y + 5, width: 4, height: GROUND - p.y - 5, fill: "rgba(150,110,60,.16)" }, world);
      el("line", { x1: p.x + W / 2, y1: p.y, x2: p.x + W / 2, y2: p.y + H, stroke: "rgba(150,110,60,.32)", "stroke-width": 1 }, world);
      if (i % 5 === 0) {
        const t = el("text", { x: p.x, y: p.y + 18, "text-anchor": "middle", "font-size": 11, "font-weight": 700, fill: "rgba(120,85,40,.8)", "font-family": "AppSans" }, world);
        t.textContent = String(i);
        const m = el("g", { transform: `translate(${p.x - W / 2 + 7} ${p.y})` }, world);
        m.innerHTML = `<rect x="-.8" y="-22" width="1.6" height="22" rx=".8" fill="#8A7354"/><path d="M.8 -21.5 L13 -17.5 L.8 -13.5 Z" fill="${color}" opacity=".85"/>`;
      }
    }
    // summit flag
    const flag = el("g", { class: "flag", transform: `translate(${top.x - 40} ${top.y})` }, world);
    flag.innerHTML = `<rect x="-1.2" y="-62" width="2.4" height="62" rx="1.2" fill="#6E5A40"/>
      <path class="flag-cloth" d="M1 -61 C12 -65 20 -55 32 -59 L32 -41 C20 -37 12 -47 1 -43 Z" fill="${color}"/>
      <circle cx="0" cy="-63" r="2.8" fill="#FFD60A"/>`;
    const glow = el("circle", { cx: top.x - 20, cy: top.y - 20, r: 46, fill: "url(#sunGlow)", opacity: 0 }, world);

    const hero = monster(world);

    const state = { step: 0, x: 0, y: 0, cam: { x: CAM_X, y: CAM_Y }, raf: 0, alive: true };

    function apply() {
      world.setAttribute("transform", `translate(${(CAM_X - state.cam.x).toFixed(2)} ${(CAM_Y - state.cam.y).toFixed(2)})`);
      far.setAttribute("transform", `translate(${((CAM_X - state.cam.x) * 0.22).toFixed(2)} ${((CAM_Y - state.cam.y) * 0.12).toFixed(2)})`);
      clouds.setAttribute("transform", `translate(${((CAM_X - state.cam.x) * 0.1).toFixed(2)} ${((CAM_Y - state.cam.y) * 0.06).toFixed(2)})`);
      hero.g.setAttribute("transform", `translate(${state.x.toFixed(2)} ${state.y.toFixed(2)})${state.rot ? ` rotate(${state.rot.toFixed(1)} 0 -16)` : ""}`);
    }
    function camTarget(x, y) { return { x: x, y: y }; }

    function animate(dur, fn) {
      cancelAnimationFrame(state.raf);
      return new Promise((resolve) => {
        if (reduced() || dur <= 0) { fn(1); apply(); resolve(); return; }
        const t0 = performance.now();
        const tick = (now) => {
          if (!state.alive) return resolve();
          const t = Math.min(1, (now - t0) / dur);
          fn(t); apply();
          if (t < 1) state.raf = requestAnimationFrame(tick); else resolve();
        };
        state.raf = requestAnimationFrame(tick);
      });
    }

    function face(kind) {
      for (const k of ["happy", "oops", "party"]) {
        const f = hero.body.querySelector(".face-" + k);
        if (f) f.style.display = k === kind ? "" : "none";
      }
    }

    const api = {
      get step() { return state.step; },
      set(step) {
        state.step = step;
        const p = stepPos(step);
        state.x = p.x; state.y = p.y; state.rot = 0;
        state.cam = camTarget(p.x, p.y);
        face(step >= STEPS ? "party" : "happy");
        glow.setAttribute("opacity", step >= STEPS ? 1 : 0);
        apply();
      },
      async hop() {
        const from = stepPos(state.step);
        state.step = Math.min(STEPS, state.step + 1);
        const to = stepPos(state.step);
        const cam0 = { ...state.cam };
        const lift = 22;
        await animate(430, (t) => {
          const e = ease.inOut(t);
          state.x = from.x + (to.x - from.x) * e;
          state.y = from.y + (to.y - from.y) * e - Math.sin(Math.PI * t) * lift;
          const c = ease.out(t);
          state.cam = { x: cam0.x + (to.x - cam0.x) * c, y: cam0.y + (to.y - cam0.y) * c };
        });
        hero.body.classList.remove("squash"); void hero.body.getBoundingClientRect(); hero.body.classList.add("squash");
        if (state.step >= STEPS) { face("party"); glow.setAttribute("opacity", 1); }
      },
      async fall() {
        const from = stepPos(state.step);
        const to = stepPos(0);
        const cam0 = { ...state.cam };
        face("oops");
        state.step = 0;
        const dur = 520 + Math.min(20, Math.abs(from.x) / W) * 26;
        await animate(dur, (t) => {
          const e = ease.in(t);
          state.x = from.x + (to.x - from.x) * ease.out(t);
          state.y = from.y + (to.y - from.y) * e - Math.sin(Math.PI * Math.min(1, t * 1.6)) * 16;
          state.rot = 540 * ease.out(t);
          const c = ease.inOut(t);
          state.cam = { x: cam0.x + (to.x - cam0.x) * c, y: cam0.y + (to.y - cam0.y) * c };
        });
        state.rot = 0; apply();
        container.classList.remove("shake"); void container.offsetWidth; container.classList.add("shake");
        setTimeout(() => { if (state.alive && state.step < STEPS) face("happy"); }, 900);
      },
      celebrate() { face("party"); glow.setAttribute("opacity", 1); },
      destroy() { state.alive = false; cancelAnimationFrame(state.raf); },
    };
    api.set(opts.step || 0);
    return api;
  }

  window.Scene = { create: build, STEPS };
})();
