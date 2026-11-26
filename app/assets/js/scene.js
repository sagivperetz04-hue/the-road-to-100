/* The staircase scene: 20 steps rising to the left (RTL), a small monster that climbs, and a following camera. */
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const W = 46, H = 24, STEPS = 20;
  // y = 0 is the ground surface: step 0 stands on the grass, step i is i*H above it.
  const GROUND = 0;
  const VIEW_W = 400, VIEW_H = 260, CAM_X = 212, CAM_Y = 192;
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const stepPos = (i) => ({ x: -i * W, y: -i * H });
  const DX = 10, DY = 7;                 // the stairs' depth: the top and side planes recede up and to the right
  const MAT = {
    light: { mHi: "#E1B7FF", mMid: "#AC60E2", mLow: "#713AA7", sheen: "#FFFFFF", rim: "#E6C6FF", hornHi: "#FFE99A", hornLow: "#DDA536", eye: "#FFFEFA", face: "#30203F", cheek: "#F385CD", contact: "#3B274E",
      top: "#FFF2D2", frontHi: "#EBD7AE", frontLow: "#DCC18F", side: "#BA9969", outline: "#CBB282", bevel: "#FFF9E9", seam: "#846440" },
    pink: { mHi: "#FFC0EB", mMid: "#D66AD8", mLow: "#8E3CA9", sheen: "#FFF5FC", rim: "#FFE0A8", hornHi: "#FFF1B3", hornLow: "#EDAF53", eye: "#FFFEFA", face: "#49213E", cheek: "#FF91BF", contact: "#65264F",
      top: "#FFF6FC", frontHi: "#F5BEDF", frontLow: "#E69BC8", side: "#BC72A5", outline: "#CD8EB7", bevel: "#FFFFFF", seam: "#87476F" },
    // gallery: the monster is the product on show; the stairs are a white plinth with silver hairlines
    gallery: { mHi: "#E1B7FF", mMid: "#AC60E2", mLow: "#713AA7", sheen: "#FFFFFF", rim: "#E6C6FF", hornHi: "#FFE99A", hornLow: "#DDA536", eye: "#FFFEFA", face: "#30203F", cheek: "#F385CD", contact: "#1D1D1F",
      top: "#FFFFFF", frontHi: "#FAFAFC", frontLow: "#F5F5F7", side: "#E6E6E8", outline: "#D6D6D6", bevel: "#FFFFFF", seam: "#86868B" },
    dark: { mHi: "#C6BCFF", mMid: "#9275DE", mLow: "#4F3C8D", sheen: "#E9F3FF", rim: "#AFCBFF", hornHi: "#EEE4BE", hornLow: "#AA956B", eye: "#F3F5FF", face: "#211A38", cheek: "#CA8BDC", contact: "#050611",
      top: "#A9B3D7", frontHi: "#65729A", frontLow: "#4D587E", side: "#343E62", outline: "#485478", bevel: "#D3DFFF", seam: "#18213D" },
  };
  let sceneN = 0;
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

  const MS = 0.6;   // monster scale: about 42 units wide and 52 tall on a 46-unit stair
  function monster(parent, M, id) {
    const g = el("g", { class: "hero" }, parent);
    const T = `translate(${-60 * MS} ${-118 * MS}) scale(${MS})`;
    // shadow + feet stay planted on the surface; only the body above them bobs and squashes
    const feet = el("g", { class: "hero-feet" }, g);
    feet.innerHTML = `<g transform="${T}">
        <g class="hero-shadow" fill="${M.contact}"><ellipse cx="60" cy="119" rx="30" ry="5" opacity=".10"/><ellipse cx="60" cy="118" rx="19" ry="2.5" opacity=".18"/></g>
        <ellipse class="foot" cx="46" cy="112" rx="12" ry="6" fill="${M.mLow}"/><ellipse class="foot" cx="74" cy="112" rx="12" ry="6" fill="${M.mLow}"/></g>`;
    const bob = el("g", { class: "hero-bob" }, g);
    const body = el("g", { class: "hero-body" }, bob);
    body.innerHTML = `<g transform="${T}">
      <defs>
        <radialGradient id="${id}b" cx="32%" cy="22%" r="82%"><stop offset="0" stop-color="${M.mHi}"/><stop offset=".52" stop-color="${M.mMid}"/><stop offset="1" stop-color="${M.mLow}"/></radialGradient>
        <linearGradient id="${id}h" x2=".3" y2="1"><stop stop-color="${M.hornHi}"/><stop offset="1" stop-color="${M.hornLow}"/></linearGradient>
      </defs>
      <path d="M38 49 31 14 51 43Z" fill="url(#${id}h)"/><path d="M69 43 89 14 82 49Z" fill="url(#${id}h)"/>
      <g fill="${M.mMid}"><ellipse cx="25" cy="84" rx="7" ry="11" transform="rotate(12 25 84)"/><ellipse cx="95" cy="84" rx="7" ry="11" transform="rotate(-12 95 84)"/></g>
      <ellipse cx="60" cy="78" rx="34" ry="37" fill="url(#${id}b)"/>
      <path d="M35 62C38 48 49 43 61 45" fill="none" stroke="${M.sheen}" stroke-width="3" stroke-linecap="round" opacity=".24"/>
      <path class="m-rim" d="M87 84C85 98 78 105 68 109" fill="none" stroke="${M.rim}" stroke-width="1.5" stroke-linecap="round" opacity=".18"/>
      <g class="face-happy"><g class="eyes"><g fill="${M.eye}"><ellipse cx="48" cy="68" rx="10" ry="12"/><ellipse cx="72" cy="68" rx="10" ry="12"/></g>
          <g fill="${M.face}"><circle cx="50" cy="70" r="4.5"/><circle cx="74" cy="70" r="4.5"/></g>
          <g fill="#FFFFFF"><circle cx="48.5" cy="68" r="1.5"/><circle cx="72.5" cy="68" r="1.5"/></g></g>
        <path d="M47 87Q60 92 73 87Q60 108 47 87Z" fill="${M.face}"/></g>
      <g class="face-oops" style="display:none"><g fill="${M.eye}"><ellipse cx="48" cy="66" rx="11" ry="13"/><ellipse cx="72" cy="66" rx="11" ry="13"/></g>
        <g fill="${M.face}"><circle cx="48" cy="66" r="3.2"/><circle cx="72" cy="66" r="3.2"/><ellipse cx="60" cy="94" rx="5.5" ry="7"/></g></g>
      <g class="face-party" style="display:none"><path d="M39 70Q48 58 57 70M63 70Q72 58 81 70" fill="none" stroke="${M.face}" stroke-width="4" stroke-linecap="round"/>
        <path d="M44 84Q60 112 76 84Z" fill="${M.face}"/><path d="M52 95Q60 101 68 95" fill="none" stroke="${M.cheek}" stroke-width="3" stroke-linecap="round"/></g>
      <g fill="${M.cheek}" opacity=".55"><ellipse cx="37" cy="83" rx="5" ry="3.5"/><ellipse cx="83" cy="83" rx="5" ry="3.5"/></g></g>`;
    return { g, bob, body, shadow: feet.querySelector(".hero-shadow") };
  }

  function build(container, opts) {
    const color = opts.color || "#FF9500";
    container.innerHTML = "";
    const theme = opts.theme || "light";
    const P = Art.PALETTES[theme] || Art.PALETTES.light;
    const M = MAT[theme] || MAT.light;
    const uid = "sc" + (++sceneN);
    const casual = opts.difficulty === "casual";
    const svg = el("svg", { viewBox: `0 0 ${VIEW_W} ${VIEW_H}`, preserveAspectRatio: "xMidYMid slice", role: "img", "aria-label": "מדרגות הטיפוס", "data-theme": theme }, container);
    // sky decorations sit at the top right, clear of the streak pill (top left) and the back button (top right corner)
    const sky = theme === "dark"
      ? `<g transform="translate(296 62)">${Art.moon(16)}</g>` + [[40, 30, 2.6], [110, 72, 2], [160, 22, 3], [212, 50, 2.2], [250, 18, 2.6], [350, 96, 2], [20, 100, 1.8], [190, 104, 1.6], [372, 40, 2.4]].map(([x, y, r]) => Art.star(x, y, r)).join("")
      : theme === "pink"
        ? `<g transform="translate(298 66)">${Art.sunny(17)}</g>`
        : theme === "gallery" ? ""
        : `<circle cx="298" cy="62" r="46" fill="url(#sunGlow)"/><circle cx="298" cy="62" r="17" fill="#FFE066"/>`;
    svg.innerHTML = `
      <defs>${Art.DEFS}
        <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.sky[0]}"/><stop offset=".65" stop-color="${P.sky[1]}"/><stop offset="1" stop-color="${P.sky[2]}"/></linearGradient>
        <linearGradient id="stepGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${M.frontHi}"/><stop offset="1" stop-color="${M.frontLow}"/></linearGradient>
        <linearGradient id="grassGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.grass[0]}"/><stop offset="1" stop-color="${P.grass[1]}"/></linearGradient>
      </defs>
      <rect width="${VIEW_W}" height="${VIEW_H}" fill="url(#skyGrad)"/>
      <rect class="hell-layer" width="${VIEW_W}" height="${VIEW_H}" fill="url(#${uid}hell)"/><g class="sky-deco">${sky}</g>`;
    svg.querySelector("defs").insertAdjacentHTML("beforeend",
      `<linearGradient id="${uid}hell" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#211526"/><stop offset=".55" stop-color="#531B24"/><stop offset="1" stop-color="#B83A1D"/></linearGradient>`);
    const far = el("g", { class: "far" }, svg);
    far.innerHTML = (theme === "pink" ? `<g transform="translate(150 214)">${Art.rainbow(150, 11)}</g>` : "") + `
      <path d="M-400 230 L-250 120 L-140 190 L-20 95 L110 185 L230 105 L360 190 L470 120 L640 230 Z" fill="${P.far[0]}" opacity=".7"/>
      <path d="M-400 240 L-300 170 L-180 215 L-60 150 L70 220 L190 160 L320 225 L450 165 L640 240 Z" fill="${P.far[1]}" opacity=".6"/>`;
    const clouds = el("g", { class: "clouds" }, svg);
    clouds.innerHTML = [[60, 40, 1], [190, 26, .8], [400, 60, .9], [-120, 50, .85]].map(([x, y, s]) =>
      `<g transform="translate(${x} ${y}) scale(${s})" opacity="${P.cloudOpacity}"><ellipse cx="0" cy="0" rx="26" ry="10" fill="${P.cloud}"/><ellipse cx="14" cy="-6" rx="16" ry="11" fill="${P.cloud}"/><ellipse cx="-12" cy="-4" rx="12" ry="8" fill="${P.cloud}"/></g>`).join("");

    const world = el("g", { class: "world" }, svg);
    // the ground; its top edge is y = 0
    el("rect", { class: "ground", x: -1500, y: GROUND, width: 2400, height: 600, fill: "url(#grassGrad)" }, world);
    el("rect", { class: "grass-top", x: -1500, y: GROUND, width: 2400, height: 4, fill: P.grassTop }, world);
    const deco = el("g", { class: "ground-deco" }, world);
    if (theme === "pink") {
      // lollipops instead of bushes, and a unicorn waiting next to the first stair
      deco.innerHTML = [[142, "#FF4FA3", "#FFFFFF", 9, 24], [190, "#A77BFF", "#FFD84D", 8, 20], [300, "#FFB020", "#FF4FA3", 10, 28], [-1080, "#3BA4F0", "#FFFFFF", 9, 24]]
        .map(([x, c1, c2, r, h]) => `<g transform="translate(${x} ${GROUND})">${Art.lollipop({ r, h, c1, c2 })}</g>`).join("")
        + `<g transform="translate(78 ${GROUND})">${Art.unicorn({ scale: .82 })}</g>`;
    } else if (theme !== "gallery") {
      deco.innerHTML = [[70, 1], [150, .8], [-1080, .9], [300, 1.1]].map(([bx, s]) =>
        `<g transform="translate(${bx} ${GROUND}) scale(${s})"><ellipse cx="0" cy="-6" rx="14" ry="7" fill="${P.bush[0]}"/><ellipse cx="10" cy="-8" rx="9" ry="8" fill="${P.bush[1]}"/><ellipse cx="-9" cy="-7" rx="8" ry="7" fill="${P.bush[1]}"/></g>`).join("")
        + (theme === "dark" ? [[40, -14], [96, -26], [180, -12], [250, -30]].map(([x, y]) => `<circle class="twinkle" style="animation-delay:-${(x % 7) / 3}s" cx="${x}" cy="${y}" r="1.6" fill="#FFF3A0"/>`).join("") : "");
    }
    // three-plane stone stairs (front, top, side), far ones first so each nearer block covers the hidden parts
    const block = (x0, x1, y) => {
      const g = el("g", { "stroke-linejoin": "round" }, world);
      g.innerHTML = `<path class="st-side" d="M${x1} ${y} L${x1 + DX} ${y - DY} L${x1 + DX} ${GROUND} L${x1} ${GROUND} Z" fill="${M.side}" stroke="${M.outline}" stroke-width=".6"/>
        <path class="st-top" d="M${x0} ${y} L${x0 + DX} ${y - DY} L${x1 + DX} ${y - DY} L${x1} ${y} Z" fill="${M.top}" stroke="${M.outline}" stroke-width=".6"/>
        <line x1="${x0 + .6}" y1="${y + .8}" x2="${x1 - .6}" y2="${y + .8}" stroke="${M.bevel}" stroke-width="1.2" opacity=".8"/>`;
      el("rect", { class: "step-block", x: x0, y, width: x1 - x0, height: GROUND - y, fill: "url(#stepGrad)", stroke: M.outline, "stroke-width": .6 }, g);
      el("line", { x1: x1 - .4, y1: y + 1, x2: x1 - .4, y2: GROUND, stroke: M.seam, "stroke-width": .8, opacity: .25 }, g);
      g.appendChild(g.querySelector(".step-block"));   // front face over the side's seam, under the top's bevel line
      g.appendChild(g.querySelector("line"));
      return g;
    };
    const top = stepPos(STEPS);
    block(top.x - W / 2 - 70, top.x + W / 2, top.y);
    const SPRINKLES = ["#FF4FA3", "#FFB020", "#A77BFF", "#3BA4F0", "#33C9A0"];
    const flags = [];
    for (let i = STEPS - 1; i >= 1; i--) {
      const p = stepPos(i);
      block(p.x - W / 2, p.x + W / 2, p.y);
      if (theme === "pink") {
        // icing under the top edge with three drips, and up to three sprinkles per stair
        const g = el("g", {}, world);
        const x0 = p.x - W / 2, d = (k) => x0 + 8 + ((i * 11 + k * 13) % (W - 16));
        g.innerHTML = `<path d="M${x0} ${p.y} H${x0 + W} V${p.y + 4} ${[0, 1, 2].map((k) => `H${d(k) + 3} Q${d(k) + 1.5} ${p.y + 9} ${d(k)} ${p.y + 4}`).join(" ")} H${x0} Z" fill="#FFFFFF" opacity=".92"/>`
          + [0, 1, 2].map((k) => {
            const sx = x0 + 7 + ((i * 13 + k * 15) % (W - 14)), sy = p.y + 10 + ((i * 7 + k * 5) % 9);
            return `<rect x="${sx}" y="${sy}" width="4" height="1.5" rx=".75" fill="${SPRINKLES[(i + k) % SPRINKLES.length]}" transform="rotate(${(i * 37 + k * 50) % 180} ${sx + 2} ${sy + .75})"/>`;
          }).join("");
      }
      if (i % 5 === 0) {
        // casual: a checkpoint pennant on the side of stairs 5, 10, 15; hardcore: a numbered stone marker
        const t = el("text", { x: p.x, y: p.y + 18, "text-anchor": "middle", "font-size": 11, "font-weight": 800, fill: P.stepText, "font-family": "AppSans" }, world);
        t.textContent = String(i);
        if (casual) {
          const m = el("g", { class: "checkpoint", "data-step": i, transform: `translate(${p.x - W / 2 + 5} ${p.y})` }, world);
          m.innerHTML = `<rect x="-.8" y="-22" width="1.6" height="22" rx=".8" fill="${theme === "dark" ? "#C3C5EC" : theme === "gallery" ? "#1D1D1F" : "#8A7354"}"/>
            <g class="pennant"><path d="M.8 -21.5 L15 -17 L.8 -12.5 Z" fill="${color}"/><path class="cp-check" d="M4.2 -17.2 l1.8 1.8 3.4 -3.6" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></g>`;
          flags.push(m);
        }
      }
    }
    // summit flag (and, in pink, a unicorn waiting at the top)
    const flag = el("g", { class: "flag", transform: `translate(${top.x - 40} ${top.y})` }, world);
    flag.innerHTML = `<rect x="-1.2" y="-62" width="2.4" height="62" rx="1.2" fill="${theme === "dark" ? "#C3C5EC" : theme === "gallery" ? "#1D1D1F" : "#6E5A40"}"/>
      <path class="flag-cloth" d="M1 -61 C12 -65 20 -55 32 -59 L32 -41 C20 -37 12 -47 1 -43 Z" fill="${color}"/>
      <circle cx="0" cy="-63" r="2.8" fill="#FFD60A"/>`;
    if (theme === "pink") {
      const u = el("g", { transform: `translate(${top.x - 72} ${top.y})` }, world);
      u.innerHTML = Art.unicorn({ scale: .78, flip: true });
    }
    const glow = el("circle", { cx: top.x - 20, cy: top.y - 20, r: 46, fill: "url(#sunGlow)", opacity: 0 }, world);

    const hero = monster(world, M, uid);
    function paintFlags() {
      const cp = Math.floor(Math.min(state.step, STEPS - 1) / 5) * 5;   // the checkpoint she falls back to
      for (const f of flags) {
        const n = +f.dataset.step;
        f.classList.toggle("reached", state.step >= n);
        f.classList.toggle("current", n === cp && state.step >= n);
      }
    }

    const state = { step: 0, x: 0, y: 0, cam: { x: CAM_X, y: CAM_Y }, raf: 0, alive: true };

    function apply() {
      world.setAttribute("transform", `translate(${(CAM_X - state.cam.x).toFixed(2)} ${(CAM_Y - state.cam.y).toFixed(2)})`);
      far.setAttribute("transform", `translate(${((CAM_X - state.cam.x) * 0.22).toFixed(2)} ${((CAM_Y - state.cam.y) * 0.12).toFixed(2)})`);
      clouds.setAttribute("transform", `translate(${((CAM_X - state.cam.x) * 0.1).toFixed(2)} ${((CAM_Y - state.cam.y) * 0.06).toFixed(2)})`);
      hero.g.setAttribute("transform", `translate(${state.x.toFixed(2)} ${state.y.toFixed(2)})${state.rot ? ` rotate(${state.rot.toFixed(1)} 0 -16)` : ""}`);
    }
    function camTarget(x, y) { return { x: x, y: y }; }

    function animate(dur, fn) {
      // a new animation ends the running one (fast answers): finish it, so whatever waits for it still runs
      cancelAnimationFrame(state.raf);
      if (state.done) { const d = state.done; state.done = null; d(); }
      return new Promise((resolve0) => {
        const resolve = () => { if (state.done === resolve) state.done = null; resolve0(); };
        state.done = resolve;
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
        apply(); paintFlags();
      },
      async hop() {
        const from = stepPos(state.step);
        state.step = Math.min(STEPS, state.step + 1);
        paintFlags();
        const to = stepPos(state.step);
        const cam0 = { ...state.cam };
        const lift = 22;
        await animate(320, (t) => {
          const e = ease.inOut(t);
          state.x = from.x + (to.x - from.x) * e;
          state.y = from.y + (to.y - from.y) * e - Math.sin(Math.PI * t) * lift;
          const c = ease.out(t);
          state.cam = { x: cam0.x + (to.x - cam0.x) * c, y: cam0.y + (to.y - cam0.y) * c };
          const a = Math.sin(Math.PI * t);
          if (hero.shadow) { hero.shadow.style.opacity = String(1 - a * .45); hero.shadow.setAttribute("transform", `translate(60 118) scale(${(1 - a * .28).toFixed(3)}) translate(-60 -118)`); }
        });
        if (hero.shadow) { hero.shadow.style.opacity = ""; hero.shadow.removeAttribute("transform"); }
        hero.body.classList.remove("squash"); void hero.body.getBoundingClientRect(); hero.body.classList.add("squash");
        paintFlags();
        if (state.step >= STEPS) { face("party"); glow.setAttribute("opacity", 1); }
      },
      async fall(toStep) {
        const back = Math.max(0, Math.min(state.step, toStep || 0));
        const from = stepPos(state.step);
        const to = stepPos(back);
        const cam0 = { ...state.cam };
        face("oops");
        if (state.step === back) {
          // already on the ground: a short stumble instead of a full fall that goes nowhere
          await animate(420, (t) => {
            const k = 1 - t;
            state.x = from.x + Math.sin(t * Math.PI * 4) * 3 * k;
            state.y = from.y - Math.sin(Math.PI * t) * 6;
            state.rot = Math.sin(t * Math.PI * 2) * 14 * k;
          });
          state.x = from.x; state.y = from.y; state.rot = 0; apply();
          setTimeout(() => { if (state.alive && state.step < STEPS) face("happy"); }, 900);
          return;
        }
        const drop = state.step - back;
        state.step = back;
        const dur = 520 + Math.min(20, drop) * 26;
        await animate(dur, (t) => {
          const e = ease.in(t);
          state.x = from.x + (to.x - from.x) * ease.out(t);
          state.y = from.y + (to.y - from.y) * e - Math.sin(Math.PI * Math.min(1, t * 1.6)) * 16;
          state.rot = 540 * ease.out(t);
          const c = ease.inOut(t);
          state.cam = { x: cam0.x + (to.x - cam0.x) * c, y: cam0.y + (to.y - cam0.y) * c };
        });
        state.rot = 0; apply(); paintFlags();
        container.classList.remove("shake"); void container.offsetWidth; container.classList.add("shake");
        setTimeout(() => { if (state.alive && state.step < STEPS) face("happy"); }, 900);
      },
      celebrate() { face("party"); glow.setAttribute("opacity", 1); },
      destroy() { state.alive = false; cancelAnimationFrame(state.raf); },
    };
    const blink = () => {
      if (!state.alive) return;
      const eyes = hero.body.querySelector(".face-happy .eyes");
      if (eyes && !reduced()) { eyes.classList.remove("blink"); void eyes.getBoundingClientRect(); eyes.classList.add("blink"); }
      const quiet = document.documentElement.dataset.mode === "boring";
      state.blinkT = setTimeout(blink, (quiet ? 5000 : 4000) + Math.random() * 3000);
    };
    state.blinkT = setTimeout(blink, 2500);
    const destroy0 = api.destroy;
    api.destroy = () => { clearTimeout(state.blinkT); destroy0(); };
    api.set(opts.step || 0);
    return api;
  }

  let svgN = 0;
  function monsterSvg(theme, face, cls, extra) {
    const M = MAT[theme] || MAT.light, id = "ms" + (++svgN);
    const faces = {
      party: `<path d="M39 70Q48 58 57 70M63 70Q72 58 81 70" fill="none" stroke="${M.face}" stroke-width="4" stroke-linecap="round"/><path d="M44 84Q60 112 76 84Z" fill="${M.face}"/><path d="M52 95Q60 101 68 95" fill="none" stroke="${M.cheek}" stroke-width="3" stroke-linecap="round"/>`,
      happy: `<g fill="${M.eye}"><ellipse cx="48" cy="68" rx="10" ry="12"/><ellipse cx="72" cy="68" rx="10" ry="12"/></g><g fill="${M.face}"><circle cx="50" cy="70" r="4.5"/><circle cx="74" cy="70" r="4.5"/></g><g fill="#fff"><circle cx="48.5" cy="68" r="1.5"/><circle cx="72.5" cy="68" r="1.5"/></g><path d="M47 87Q60 92 73 87Q60 108 47 87Z" fill="${M.face}"/>`,
    };
    return `<svg class="${cls || ""}" viewBox="0 0 120 128" aria-hidden="true"><defs>
        <radialGradient id="${id}b" cx="32%" cy="22%" r="82%"><stop offset="0" stop-color="${M.mHi}"/><stop offset=".52" stop-color="${M.mMid}"/><stop offset="1" stop-color="${M.mLow}"/></radialGradient>
        <linearGradient id="${id}h" x2=".3" y2="1"><stop stop-color="${M.hornHi}"/><stop offset="1" stop-color="${M.hornLow}"/></linearGradient></defs>
      <g fill="${M.contact}"><ellipse cx="60" cy="121" rx="30" ry="5" opacity=".10"/><ellipse cx="60" cy="120" rx="19" ry="2.5" opacity=".18"/></g>
      <path d="M38 49 31 14 51 43Z" fill="url(#${id}h)"/><path d="M69 43 89 14 82 49Z" fill="url(#${id}h)"/>
      <g fill="${M.mLow}"><ellipse cx="46" cy="112" rx="12" ry="6"/><ellipse cx="74" cy="112" rx="12" ry="6"/></g>
      <g fill="${M.mMid}"><ellipse cx="22" cy="56" rx="7" ry="13" transform="rotate(-28 22 56)"/><ellipse cx="98" cy="56" rx="7" ry="13" transform="rotate(28 98 56)"/></g>
      <ellipse cx="60" cy="78" rx="34" ry="37" fill="url(#${id}b)"/>
      <path d="M35 62C38 48 49 43 61 45" fill="none" stroke="${M.sheen}" stroke-width="3" stroke-linecap="round" opacity=".24"/>
      <path d="M87 84C85 98 78 105 68 109" fill="none" stroke="${M.rim}" stroke-width="1.5" stroke-linecap="round" opacity=".18"/>
      ${faces[face] || faces.happy}${extra || ""}
      <g fill="${M.cheek}" opacity=".55"><ellipse cx="37" cy="83" rx="5" ry="3.5"/><ellipse cx="83" cy="83" rx="5" ry="3.5"/></g></svg>`;
  }

  window.Scene = { create: build, STEPS, monsterSvg };
})();
