/* Shared SVG artwork (original drawings for this app): returns SVG markup strings.
   Every piece is drawn around (0, 0) = the point where it touches the ground, so callers just translate it. */
(function () {
  const RAINBOW = ["#FF5A7A", "#FF9F45", "#FFD84D", "#5FD68A", "#4FB8FF", "#A77BFF"];

  /** A unicorn standing on the ground, facing left (towards the stairs). About 56 wide, 50 tall. */
  function unicorn(opts) {
    const o = opts || {};
    const s = o.scale || 1, flip = o.flip ? -1 : 1;
    const mane = RAINBOW;
    return `<g class="unicorn" transform="scale(${(flip * s).toFixed(3)} ${s})">
      <ellipse cx="2" cy="-1" rx="22" ry="3.2" fill="rgba(90,24,70,.14)"/>
      <!-- tail -->
      <path d="M20 -26 C34 -30 36 -14 30 -6 C28 -14 26 -18 20 -20 Z" fill="${mane[4]}"/>
      <path d="M20 -24 C31 -26 33 -16 29 -10 C27 -16 25 -19 20 -20 Z" fill="${mane[2]}"/>
      <path d="M20 -22 C27 -22 29 -17 27 -13 C25 -17 23 -19 20 -20 Z" fill="${mane[0]}"/>
      <!-- legs -->
      <rect x="-14" y="-16" width="5" height="15" rx="2.5" fill="#F3E9FF"/><rect x="-6" y="-16" width="5" height="15" rx="2.5" fill="#FFFFFF"/>
      <rect x="7" y="-16" width="5" height="15" rx="2.5" fill="#F3E9FF"/><rect x="14" y="-16" width="5" height="15" rx="2.5" fill="#FFFFFF"/>
      <rect x="-14" y="-4" width="5" height="3.5" rx="1.5" fill="#FFC94D"/><rect x="-6" y="-4" width="5" height="3.5" rx="1.5" fill="#FFC94D"/>
      <rect x="7" y="-4" width="5" height="3.5" rx="1.5" fill="#FFC94D"/><rect x="14" y="-4" width="5" height="3.5" rx="1.5" fill="#FFC94D"/>
      <!-- body -->
      <ellipse cx="3" cy="-21" rx="20" ry="11" fill="#FFFFFF"/>
      <ellipse cx="5" cy="-17" rx="15" ry="5" fill="#F3E9FF"/>
      <!-- neck + head -->
      <path d="M-12 -26 C-16 -34 -18 -40 -16 -44 L-6 -42 C-5 -36 -4 -31 -2 -27 Z" fill="#FFFFFF"/>
      <ellipse cx="-19" cy="-44" rx="9" ry="7" fill="#FFFFFF"/>
      <ellipse cx="-26" cy="-41.5" rx="4.6" ry="4" fill="#FFD3E6"/>
      <circle cx="-27.6" cy="-41.8" r=".8" fill="#C7487F"/>
      <path d="M-20 -46.5 q2 -2 4 0" fill="none" stroke="#3B1534" stroke-width="1.3" stroke-linecap="round"/>
      <circle cx="-20" cy="-41.6" r="1.8" fill="#FF8FB8" opacity=".7"/>
      <path d="M-14 -50 l2 -6 l3 5 z" fill="#FFFFFF" stroke="#F0DFFF" stroke-width=".6"/>
      <!-- horn -->
      <path d="M-21 -50 L-27 -64 L-17 -51 Z" fill="#FFD84D" stroke="#F0B429" stroke-width=".7" stroke-linejoin="round"/>
      <path d="M-22 -53 L-18.5 -52.2 M-23.4 -56.5 L-20.3 -55.7 M-24.8 -60 L-22.4 -59.3" stroke="#F0B429" stroke-width=".9" stroke-linecap="round"/>
      <!-- mane -->
      <path d="M-14 -50 C-6 -50 -4 -42 -6 -34 C-9 -40 -10 -44 -14 -46 Z" fill="${mane[0]}"/>
      <path d="M-11 -46 C-4 -44 -2 -36 -4 -30 C-7 -35 -8 -39 -11 -42 Z" fill="${mane[1]}"/>
      <path d="M-9 -41 C-2 -38 -1 -31 -3 -26 C-5 -30 -6 -34 -9 -37 Z" fill="${mane[3]}"/>
      <path d="M-17 -52 C-12 -55 -8 -53 -7 -50 C-10 -51 -13 -51 -17 -50 Z" fill="${mane[5]}"/>
    </g>`;
  }

  /** A swirl lollipop on a stick. r = candy radius. */
  function lollipop(opts) {
    const o = opts || {};
    const r = o.r || 9, h = o.h || 26, c1 = o.c1 || "#FF4FA3", c2 = o.c2 || "#FFFFFF";
    const cy = -h - r;
    return `<g class="lollipop">
      <rect x="-1.2" y="${-h}" width="2.4" height="${h}" rx="1.2" fill="#FFFFFF" stroke="rgba(90,24,70,.18)" stroke-width=".5"/>
      <circle cx="0" cy="${cy}" r="${r}" fill="${c1}"/>
      <circle cx="0" cy="${cy}" r="${(r * .68).toFixed(2)}" fill="none" stroke="${c2}" stroke-width="${(r * .22).toFixed(2)}" stroke-dasharray="${(r * 2.2).toFixed(1)} ${(r * 1.1).toFixed(1)}"/>
      <circle cx="0" cy="${cy}" r="${(r * .3).toFixed(2)}" fill="${c2}"/>
      <ellipse cx="${(-r * .38).toFixed(2)}" cy="${(cy - r * .42).toFixed(2)}" rx="${(r * .28).toFixed(2)}" ry="${(r * .16).toFixed(2)}" fill="#fff" opacity=".7" transform="rotate(-35 ${(-r * .38).toFixed(2)} ${(cy - r * .42).toFixed(2)})"/>
    </g>`;
  }

  /** A rainbow arc standing on its ends; r = outer radius, w = band width. */
  function rainbow(r, w) {
    return `<g class="rainbow" opacity=".9">${RAINBOW.map((c, i) => {
      const rr = r - w * (i + .5);
      return `<path d="M${-rr} 0 A${rr} ${rr} 0 0 1 ${rr} 0" fill="none" stroke="${c}" stroke-width="${w + .4}"/>`;
    }).join("")}</g>`;
  }

  /** A smiling sun with slowly turning rays (class sun-rays). */
  function sunny(r) {
    const rays = Array.from({ length: 12 }, (_, i) => `<path d="M0 ${-(r + 4)} L4 ${-(r + 13)} L-4 ${-(r + 13)} Z" fill="#FFC93C" transform="rotate(${i * 30})"/>`).join("");
    return `<g class="sunny"><circle r="${r + 22}" fill="url(#sunGlow)"/>
      <g class="sun-rays">${rays}</g>
      <circle r="${r}" fill="#FFD84D" stroke="#FFC22E" stroke-width="2"/>
      <path d="M${-r * .45} ${-r * .12} q${r * .14} ${-r * .2} ${r * .28} 0 M${r * .17} ${-r * .12} q${r * .14} ${-r * .2} ${r * .28} 0" fill="none" stroke="#7A3B00" stroke-width="2" stroke-linecap="round"/>
      <path d="M${-r * .38} ${r * .22} Q0 ${r * .62} ${r * .38} ${r * .22}" fill="none" stroke="#7A3B00" stroke-width="2.2" stroke-linecap="round"/>
      <circle cx="${-r * .55}" cy="${r * .2}" r="${r * .15}" fill="#FF8FB8" opacity=".75"/><circle cx="${r * .55}" cy="${r * .2}" r="${r * .15}" fill="#FF8FB8" opacity=".75"/></g>`;
  }

  /** A crescent moon with a soft glow. */
  function moon(r) {
    // crescent = outer circle (radius r, centre 0) minus an inner circle (radius ri, centre a,0); x,y = where they cross
    const a = r * .5, ri = r * .85;
    const x = (r * r - ri * ri + a * a) / (2 * a), y = Math.sqrt(r * r - x * x);
    const f = (v) => v.toFixed(2);
    return `<g class="moon"><circle r="${r * 2.6}" fill="url(#moonGlow)"/>
      <path d="M${f(x)} ${f(-y)} A${f(r)} ${f(r)} 0 1 0 ${f(x)} ${f(y)} A${f(ri)} ${f(ri)} 0 1 1 ${f(x)} ${f(-y)} Z" fill="#FFF3C4"/>
      <circle cx="${-r * .45}" cy="${-r * .1}" r="${r * .12}" fill="#F1DE9A"/><circle cx="${-r * .2}" cy="${r * .45}" r="${r * .08}" fill="#F1DE9A"/></g>`;
  }

  /** A small four-point sparkle star. */
  function star(x, y, s, cls) {
    return `<path class="${cls || "twinkle"}" style="animation-delay:${(-(x * 7 + y * 3) % 30 / 10).toFixed(1)}s" d="M${x} ${y - s} Q${x + s * .18} ${y - s * .18} ${x + s} ${y} Q${x + s * .18} ${y + s * .18} ${x} ${y + s} Q${x - s * .18} ${y + s * .18} ${x - s} ${y} Q${x - s * .18} ${y - s * .18} ${x} ${y - s} Z" fill="#FFF6C9"/>`;
  }

  function heart(x, y, s, fill) {
    return `<path transform="translate(${x} ${y}) scale(${s})" d="M0 3 C-6 -2 -5 -7 -2.5 -7 C-1 -7 0 -6 0 -5 C0 -6 1 -7 2.5 -7 C5 -7 6 -2 0 3 Z" fill="${fill}"/>`;
  }

  /** The climber, small, for banners and the theme picker. */
  function climber(s) {
    return `<g transform="scale(${s || 1})"><ellipse cx="0" cy="-1" rx="12" ry="2.6" fill="rgba(0,0,0,.16)"/>
      <ellipse cx="-6" cy="-3.4" rx="5" ry="3.4" fill="#7A3FA8"/><ellipse cx="6" cy="-3.4" rx="5" ry="3.4" fill="#7A3FA8"/>
      <path d="M-9 -29 L-12 -40 L-3 -32 Z M9 -29 L12 -40 L3 -32 Z" fill="#FFD60A" stroke="#E0A800" stroke-width=".8"/>
      <ellipse cx="0" cy="-17" rx="15" ry="15.5" fill="url(#heroGrad)"/>
      <ellipse cx="-5.5" cy="-21" rx="4.2" ry="4.8" fill="#fff"/><ellipse cx="5.5" cy="-21" rx="4.2" ry="4.8" fill="#fff"/>
      <circle cx="-6.6" cy="-21.6" r="2.3" fill="#1c1c1e"/><circle cx="4.4" cy="-21.6" r="2.3" fill="#1c1c1e"/>
      <path d="M-4.5 -13.5 Q0 -9.5 4.5 -13.5" fill="none" stroke="#5B1A61" stroke-width="1.6" stroke-linecap="round"/>
      <circle cx="-10" cy="-15" r="2.3" fill="#FF6FA8" opacity=".55"/><circle cx="10" cy="-15" r="2.3" fill="#FF6FA8" opacity=".55"/></g>`;
  }

  /** Gradients the pieces above refer to. Put once inside an <svg>'s <defs>. */
  const DEFS = `<radialGradient id="heroGrad" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#FF9BD2"/><stop offset=".55" stop-color="#E05CC8"/><stop offset="1" stop-color="#9B3FC4"/></radialGradient>
    <radialGradient id="sunGlow"><stop offset="0" stop-color="#FFF4B8"/><stop offset=".5" stop-color="#FFE066" stop-opacity=".6"/><stop offset="1" stop-color="#FFE066" stop-opacity="0"/></radialGradient>    <radialGradient id="moonGlow"><stop offset="0" stop-color="#FFF3C4" stop-opacity=".55"/><stop offset=".45" stop-color="#C9C6FF" stop-opacity=".18"/><stop offset="1" stop-color="#C9C6FF" stop-opacity="0"/></radialGradient>`;

  /** Theme palettes shared by the scene, the banner and the summit. */
  const PALETTES = {
    light: { sky: ["#6EC1FF", "#BFE3FF", "#E9F5FF"], far: ["#A9C8EC", "#8FB3DE"], grass: ["#A6DA8A", "#78BD62"], grassTop: "#C8EDAE",
      step: ["#F6E7C8", "#DCC08E"], stepTop: "#FFF6E3", stepEdge: "rgba(150,110,60,.32)", stepText: "rgba(120,85,40,.8)",
      bush: ["#6CC456", "#7FD266"], cloud: "#FFFFFF", cloudOpacity: .92 },
    dark: { sky: ["#070B2E", "#1A2266", "#3A3C8C"], far: ["#2A3170", "#1E2457"], grass: ["#2C7A58", "#1A503B"], grassTop: "#45A078",
      step: ["#9396C4", "#5D6198"], stepTop: "#C3C5EC", stepEdge: "rgba(20,22,60,.45)", stepText: "rgba(25,27,70,.75)",
      bush: ["#246647", "#2F7D57"], cloud: "#7F86C9", cloudOpacity: .35 },
    pink: { sky: ["#FF9ECF", "#FFC8E2", "#FFF0F7"], far: ["#FFB5DA", "#F79CCB"], grass: ["#A8F0C2", "#73D79C"], grassTop: "#DFFFEA",
      step: ["#FFF1F8", "#FFC4E1"], stepTop: "#FFFFFF", stepEdge: "rgba(214,60,140,.28)", stepText: "rgba(190,40,120,.75)",
      bush: ["#FF6FB5", "#FFD84D"], cloud: "#FFFFFF", cloudOpacity: .95 },
  };

  /** The first-screen banner: sky, a few stairs and the climber, in the given theme. */
  let bannerN = 0;
  function banner(theme) {
    const P = PALETTES[theme] || PALETTES.light;
    const u = `bn${++bannerN}`;   // gradient ids must be unique: several banners can be on screen at once
    // stairs rise to the left, like the game's staircase (RTL)
    const stairs = [0, 1, 2, 3].map((i) => `<rect x="${134 - i * 30}" y="${118 - i * 16}" width="30" height="${i * 16 + 40}" rx="3" fill="url(#${u}Step)"/><rect x="${134 - i * 30}" y="${118 - i * 16}" width="30" height="4" rx="2" fill="${P.stepTop}"/>`).join("");
    let extra = "", front = "";   // extra: in the sky, behind the hills; front: standing on the grass, drawn last
    if (theme === "dark") {
      extra = `<g transform="translate(330 42)">${moon(15)}</g>` + [[30, 20, 3], [120, 30, 2.4], [160, 16, 3.2], [200, 44, 2], [330, 22, 2.6], [372, 52, 2.2], [98, 66, 1.8], [250, 30, 2]].map(([x, y, s]) => star(x, y, s)).join("");
    } else if (theme === "pink") {
      extra = `<g transform="translate(214 136)">${rainbow(112, 9)}</g><g transform="translate(336 46)">${sunny(17)}</g>`
        + heart(150, 40, 1, "#FF6FB5") + heart(270, 22, .8, "#FFFFFF") + heart(300, 86, .7, "#FF8FC6");
      front = `<g transform="translate(250 135)">${unicorn({ scale: .95 })}</g>`
        + `<g transform="translate(376 135)">${lollipop({ r: 8, h: 18, c1: "#FF4FA3" })}</g><g transform="translate(190 135)">${lollipop({ r: 7, h: 14, c1: "#A77BFF", c2: "#FFD84D" })}</g>`;
    } else {
      extra = `<g transform="translate(334 44)"><circle r="40" fill="url(#sunGlow)"/><circle r="16" fill="#FFE066"/></g>`;
    }
    const clouds = theme === "dark" ? "" : [[200, 34, .8], [120, 26, .6], [36, 30, .7]].map(([x, y, s]) => `<g transform="translate(${x} ${y}) scale(${s})" opacity="${P.cloudOpacity}"><ellipse rx="24" ry="9" fill="${P.cloud}"/><ellipse cx="12" cy="-6" rx="14" ry="10" fill="${P.cloud}"/><ellipse cx="-10" cy="-4" rx="11" ry="7" fill="${P.cloud}"/></g>`).join("");
    return `<svg class="banner-art" viewBox="0 0 400 160" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <defs>${DEFS}<linearGradient id="${u}Sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.sky[0]}"/><stop offset=".7" stop-color="${P.sky[1]}"/><stop offset="1" stop-color="${P.sky[2]}"/></linearGradient>
        <linearGradient id="${u}Step" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.step[0]}"/><stop offset="1" stop-color="${P.step[1]}"/></linearGradient>
        <linearGradient id="${u}Grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.grass[0]}"/><stop offset="1" stop-color="${P.grass[1]}"/></linearGradient></defs>
      <rect width="400" height="160" fill="url(#${u}Sky)"/>
      ${extra}${clouds}
      <path d="M-10 160 L60 96 L130 140 L210 84 L290 150 L410 96 L410 160 Z" fill="${P.far[0]}" opacity=".7"/>
      ${stairs}
      <rect x="-10" y="134" width="420" height="40" fill="url(#${u}Grass)"/><rect x="-10" y="134" width="420" height="3" fill="${P.grassTop}"/>
      ${front}
      <g transform="translate(59 70)">${climber(.95)}</g>
    </svg>`;
  }

  window.Art = { unicorn, lollipop, rainbow, sunny, moon, star, heart, climber, banner, DEFS, PALETTES, RAINBOW };
})();
