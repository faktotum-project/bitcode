// Deterministic frame engine. The renderer calls step(t) for every frame:
// due actions run once and in order, then the camera, cursor, window effects
// and every CSS animation are set as pure functions of t. No wall-clock time.
(() => {
  const W = 1920, H = 1080, WIN = { x: 160, y: 90, w: 1600, h: 900 };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, s) => a + (b - a) * s;
  const ease = { // cinematic ease-in-out family
    cubic: u => (u < .5 ? 4 * u ** 3 : 1 - ((-2 * u + 2) ** 3) / 2),
    quint: u => (u < .5 ? 16 * u ** 5 : 1 - ((-2 * u + 2) ** 5) / 2),
    sine: u => -(Math.cos(Math.PI * u) - 1) / 2,
    out: u => 1 - (1 - u) ** 3
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const raf2 = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const $id = id => document.getElementById(id);
  const frameEl = $id('app');
  const fdoc = () => frameEl.contentDocument, fwin = () => frameEl.contentWindow;

  // ---- element lookup inside the app (iframe) ----
  const $ = (css, text, nth = 0) => {
    const list = [...fdoc().querySelectorAll(css)].filter(e => !text || e.textContent.includes(text));
    const el = list[nth];
    if (!el) throw new Error(`not found: ${css} ${text || ''}`);
    return el;
  };
  const rectOf = el => { const r = el.getBoundingClientRect(); return { x: r.left + WIN.x, y: r.top + WIN.y, w: r.width, h: r.height }; };

  const FULL = { cx: WIN.x + WIN.w / 2, cy: WIN.y + WIN.h / 2, z: .9, ax: 960, ay: 470 };
  function resolveView(spec) {
    if (spec === 'full') return { ...FULL };
    if (spec.view) return { ...FULL, ...spec.view };
    const r = rectOf(spec.el());
    const z = clamp(spec.z ?? Math.min(spec.fit[0] * W / r.w, spec.fit[1] * H / r.h), .6, spec.zmax ?? 9);
    return { cx: r.x + r.w * (spec.px ?? .5) + (spec.dx || 0), cy: r.y + r.h * (spec.py ?? .5) + (spec.dy || 0), z, ax: spec.ax ?? 960, ay: spec.ay ?? 470 };
  }
  function resolvePoint(spec) {
    if (typeof spec === 'function') spec = { el: spec };
    if (spec.x != null) return { x: spec.x, y: spec.y };
    const r = rectOf(spec.el());
    return { x: r.x + r.w * (spec.px ?? .5) + (spec.dx || 0), y: r.y + r.h * (spec.py ?? .5) + (spec.dy || 0) };
  }

  // ---- timeline ----
  const tl = { actions: [], cams: [], curs: [], taps: [], fx: () => ({}) };
  const api = {
    W, H, WIN, $, rectOf, ease, tl, sleep,
    at(t, fn, wait = 30) { tl.actions.push({ t, fn, wait, done: false }); },
    cam(t0, t1, spec, e = 'cubic') { tl.cams.push({ t0, t1, spec, e: ease[e] }); },
    cur(t0, t1, spec, e = 'cubic', bend = .12) { tl.curs.push({ t0, t1, spec, e: ease[e], bend }); },
    tap(t, fn, wait = 60) { tl.taps.push({ t, done: false }); if (fn) api.at(t, fn, wait); },
    cursorShow: [] // [t0, t1] visibility fades
  };

  // ---- state ----
  const cam = { cx: FULL.cx, cy: FULL.cy, z: FULL.z, ax: FULL.ax, ay: FULL.ay };
  const cur = { x: 960, y: 700 };
  let ripples = [];
  const born = new WeakMap();
  let firstScan = true;

  function camAt(t) {
    let s = { ...FULL };
    for (const seg of tl.cams) {
      if (t < seg.t0) break;
      if (!seg.from) { seg.from = { ...s }; seg.to = resolveView(seg.spec); }
      if (t >= seg.t1) { s = { ...seg.to }; continue; }
      const k = seg.e((t - seg.t0) / (seg.t1 - seg.t0));
      return { cx: lerp(seg.from.cx, seg.to.cx, k), cy: lerp(seg.from.cy, seg.to.cy, k), z: seg.from.z * (seg.to.z / seg.from.z) ** k, ax: lerp(seg.from.ax, seg.to.ax, k), ay: lerp(seg.from.ay, seg.to.ay, k) };
    }
    return s;
  }
  function curAt(t) {
    let s = { x: 960, y: 760 };
    for (const seg of tl.curs) {
      if (t < seg.t0) break;
      if (!seg.from) { seg.from = { ...s }; seg.to = resolvePoint(seg.spec); }
      if (t >= seg.t1) { s = { ...seg.to }; continue; }
      const k = seg.e((t - seg.t0) / (seg.t1 - seg.t0)), a = seg.from, b = seg.to;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, bump = Math.sin(Math.PI * k) * d * seg.bend;
      return { x: lerp(a.x, b.x, k) - (dy / d) * bump, y: lerp(a.y, b.y, k) + (dx / d) * bump };
    }
    return s;
  }

  // ---- bokeh (deterministic) ----
  const rnd = (i, k) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
  const near = $id('layer-near');
  const bokeh = Array.from({ length: 16 }, (_, i) => {
    const el = document.createElement('div'); el.className = 'bokeh';
    const size = 26 + rnd(i, 1) * 120; Object.assign(el.style, { width: size + 'px', height: size + 'px', opacity: String(.10 + rnd(i, 2) * .22), filter: `blur(${5 + rnd(i, 3) * 11}px)` });
    near.append(el); return { el, x: rnd(i, 4) * 2300, y: rnd(i, 5) * 1500, vx: (rnd(i, 6) - .5) * 14, vy: -3 - rnd(i, 7) * 6, size, depth: .25 + rnd(i, 8) * .6 };
  });
  // film grain
  (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), d = g.createImageData(256, 256);
    for (let i = 0; i < d.data.length; i += 4) { const v = rnd(i, 9) * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    g.putImageData(d, 0, 0); $id('grain').style.backgroundImage = `url(${c.toDataURL()})`; })();

  // closing glow: soft Bitcoin-orange halo with the centre left empty for the logo and call to action
  (() => { const c = document.createElement('canvas'); c.width = 480; c.height = 270; const g = c.getContext('2d');
    const gr = g.createRadialGradient(240, 130, 10, 240, 130, 170); gr.addColorStop(0, 'rgba(247,147,26,.30)'); gr.addColorStop(.45, 'rgba(247,147,26,.11)'); gr.addColorStop(1, 'rgba(247,147,26,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 480, 270); $id('endglow').style.setProperty('--endglow', `url(${c.toDataURL()})`); })();
  // vignette as a pre-rendered image (a live CSS gradient over the zoomed iframe showed tile seams)
  (() => { const c = document.createElement('canvas'); c.width = 480; c.height = 270; const g = c.getContext('2d');
    const gr = g.createRadialGradient(240, 124, 40, 240, 124, 300); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(.62, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.55)');
    g.fillStyle = gr; g.fillRect(0, 0, 480, 270); $id('vignette').style.backgroundImage = `url(${c.toDataURL()})`; })();

  // ---- intro logo (the Bitcode pixel "b") ----
  const NS = 'http://www.w3.org/2000/svg';
  const PIECES = [[0, 0, 1, 4], [1, 0, 2, 1], [2, 1, 1, 1], [1, 2, 1, 1], [3, 2, 1, 2], [0, 4, 2, 1]];
  const logoSvg = $id('intro-logo');
  const logoRects = PIECES.map(([x, y, w, h], i) => { const r = document.createElementNS(NS, 'rect'); Object.entries({ x, y, width: w, height: h, fill: i === 5 ? '#f7931a' : '#ffffff' }).forEach(([k, v]) => r.setAttribute(k, v)); logoSvg.append(r); return r; });

  function applyFx(t) {
    const f = { black: 0, win: { o: 1, y: 0, s: 1, rx: 0, blur: 0 }, logo: { o: 0, s: 1, glow: 0 }, glow: 0, cursor: 0, ...api.tl.fx(t) };
    const wr = $id('winwrap'), w = f.win;
    wr.style.opacity = String(w.o);
    wr.style.transform = w.rx ? `perspective(2600px) translateY(${w.y}px) rotateX(${w.rx}deg) scale(${w.s})` : `translateY(${w.y}px) scale(${w.s})`;
    wr.style.filter = w.blur ? `blur(${w.blur}px)` : 'none';
    $id('black').style.opacity = String(f.black);
    $id('endglow').style.opacity = String(f.end || 0);
    $id('layer-near').style.opacity = String(1 - .6 * (f.end || 0));
    const lg = f.logo, intro = $id('intro');
    intro.style.opacity = String(lg.o); intro.style.transform = `scale(${lg.s})`;
    logoRects.forEach((r, i) => { const u = clamp((t - (.45 + i * .14)) / .22, 0, 1); r.style.opacity = String(Math.round(u * 4) / 4); r.setAttribute('transform', `translate(0 ${(-.7 * (1 - Math.round(u * 3) / 3)).toFixed(3)})`); });
    $id('intro-glow').style.opacity = String(lg.glow);
    $id('intro-logo').style.filter = `drop-shadow(0 0 ${20 + lg.glow * 70}px rgba(247,147,26,${.35 + lg.glow * .6}))`;
    return f;
  }

  // ---- per-frame ----
  let sorted = false;
  async function step(t, { settle = false } = {}) {
    if (!sorted) { sorted = true; tl.cams.sort((a, b) => a.t0 - b.t0); tl.curs.sort((a, b) => a.t0 - b.t0); tl.taps.sort((a, b) => a.t - b.t); tl.actions.sort((a, b) => a.t - b.t); }
    let waited = 0;
    for (const a of tl.actions) {
      if (a.done || a.t > t) continue;
      a.done = true; await a.fn(); waited = Math.max(waited, a.wait);
    }
    if (waited) await sleep(waited);

    for (const n of [$id('view'), document.documentElement, document.body, $id('world'), $id('winwrap'), $id('winclip')]) { if (n.scrollLeft || n.scrollTop) { n.scrollLeft = 0; n.scrollTop = 0; } }
    const c = camAt(t);
    const dr = { x: 5 * Math.sin(t * .45), y: 3.5 * Math.sin(t * .37 + 1.3) };
    Object.assign(cam, c);
    const cx = c.cx + dr.x / c.z, cy = c.cy + dr.y / c.z;
    const tx = c.ax - cx * c.z, ty = c.ay - cy * c.z;
    $id('world').style.transform = `translate(${tx.toFixed(3)}px, ${ty.toFixed(3)}px) scale(${c.z.toFixed(5)})`;

    // parallax: far glow drifts slowly against the camera, bokeh faster
    const px = (cx - 960), py = (cy - 540);
    $id('layer-far').style.transform = `translate(${(-px * .05 + Math.sin(t * .2) * 18).toFixed(2)}px, ${(-py * .05 + Math.cos(t * .17) * 12).toFixed(2)}px) scale(${(1 + (c.z - .9) * .03).toFixed(4)})`;
    for (const b of bokeh) {
      const x = ((b.x + b.vx * t - px * b.depth + 4600) % 2300) - 190, y = ((b.y + b.vy * t - py * b.depth + 3000) % 1500) - 190;
      b.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }

    // cursor, taps and ripples
    const p = curAt(t), f = applyFx(t);
    const k = clamp(1 / Math.pow(c.z, .55), .25, 1.4) * 1.0;
    const tap = tl.taps.find(x => t >= x.t - .05 && t <= x.t + .14);
    const press = tap ? .86 : 1;
    const cursorEl = $id('cursor');
    cursorEl.style.opacity = String(f.cursor ?? 0);
    cursorEl.style.transform = `translate(${p.x.toFixed(2)}px, ${p.y.toFixed(2)}px) scale(${(k * press).toFixed(4)})`;
    for (const tp of tl.taps) if (!tp.done && t >= tp.t) { tp.done = true; tp.pos = { ...p }; const el = document.createElement('div'); el.className = 'ripple'; $id('ripples').append(el); ripples.push({ el, t: tp.t, ...p }); }
    for (const r of ripples) {
      const u = clamp((t - r.t) / .65, 0, 1), size = (14 + 78 * ease.out(u)) * k;
      Object.assign(r.el.style, { left: (r.x + 2 - size / 2) + 'px', top: (r.y + 2 - size / 2) + 'px', width: size + 'px', height: size + 'px', opacity: String(u >= 1 ? 0 : (1 - u) * .95), borderWidth: Math.max(1, 2.2 * k) + 'px' });
    }
    return { mx: clamp(tx + p.x * c.z, 0, W - 1), my: clamp(ty + p.y * c.z, 0, H - 1), cursor: f.cursor ?? 0 };
  }

  // Pin every CSS animation/transition (app and stage) to t, so frames never depend on wall-clock time.
  async function scan(t, { settle = false } = {}) {
    for (const doc of [document, fdoc()]) for (const a of doc.getAnimations()) {
      if (!born.has(a)) born.set(a, firstScan ? 2.6 : t);
      a.pause(); a.currentTime = Math.max(0, (t - born.get(a)) * 1000);
    }
    firstScan = false;
    if (settle) await raf2();
  }

  async function ready() {
    for (let i = 0; i < 200; i++) { try { if (fdoc()?.querySelector('.sidebar') && fdoc().querySelector('.home')) return true; } catch {} await sleep(50); }
    throw new Error('app did not boot');
  }
  window.engine = Object.assign(api, { step, scan, ready, applyFx, state: () => ({ ...cam, cur: { ...cur } }) });
})();
