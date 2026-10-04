// Vector brand marks: the Bitcode pixel "b" and the four Sats as geometric
// "dots" with eyes. No raster assets; every state is a CSS class driven by
// real run events (idle, thinking, reading, running, drafting, waiting, happy, concerned).
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, children = []) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  for (const c of children) n.append(c);
  return n;
};

// The 4×5 pixel "b" from the Bitcode design system; each cell is its own piece
// so the mark can assemble itself like on the website.
const B_PIECES = [[0, 0, 1, 4], [1, 0, 2, 1], [2, 1, 1, 1], [1, 2, 1, 1], [3, 2, 1, 2]];
const B_BASE = [0, 4, 2, 1];
export function logo({ size = 24, build = false, variant = 'ink' } = {}) {
  const body = variant === 'orange' ? 'var(--accent)' : 'var(--ink)', base = variant === 'orange' ? 'var(--ink)' : 'var(--accent)';
  const pieces = [...B_PIECES.map(p => [p, body]), [B_BASE, base]].map(([[x, y, w, hgt], fill], i) =>
    el('rect', { x, y, width: w, height: hgt, fill, class: 'lp', style: `--i:${i}` }));
  return el('svg', { viewBox: '0 0 4 5', width: size * 0.8, height: size, 'shape-rendering': 'crispEdges', class: `logo${build ? ' build' : ''}`, 'aria-hidden': 'true' }, pieces);
}

export const SAT_META = {
  node: { color: '#3297ff', shape: 'circle' },
  script: { color: '#f7931a', shape: 'square' },
  hash: { color: '#b6f500', shape: 'hex' },
  merkle: { color: '#c96bff', shape: 'diamond' }
};
const BODY = {
  circle: () => el('circle', { cx: 50, cy: 52, r: 38, class: 'body' }),
  square: () => el('rect', { x: 14, y: 16, width: 72, height: 72, rx: 18, class: 'body' }),
  hex: () => el('path', { d: 'M50 12 L85 32 L85 72 L50 92 L15 72 L15 32 Z', 'stroke-linejoin': 'round', 'stroke-width': 8, class: 'body' }),
  diamond: () => el('path', { d: 'M50 10 L90 52 L50 94 L10 52 Z', 'stroke-linejoin': 'round', 'stroke-width': 10, class: 'body' })
};
const STATES = new Set(['idle', 'thinking', 'reading', 'running', 'drafting', 'waiting', 'happy', 'concerned']);
export function sat(id, { size = 28, state = 'idle', title } = {}) {
  const meta = SAT_META[id] || SAT_META.node;
  const eye = x => el('g', { class: 'eye', transform: `translate(${x} 50)` }, [
    el('rect', { x: -6, y: -11, width: 12, height: 22, rx: 6, class: 'open' }),
    el('path', { d: 'M-7 3 Q0 -7 7 3', class: 'arc' }),
    el('path', { d: x < 50 ? 'M-7 -2 L7 3' : 'M-7 3 L7 -2', class: 'slant' })
  ]);
  const svg = el('svg', { viewBox: '0 0 100 104', width: size, height: size, class: `sat sat-${id} st-${STATES.has(state) ? state : 'thinking'}`, style: `--sat:${meta.color}`, role: 'img', 'aria-label': title || id }, [
    title ? el('title', {}, [document.createTextNode(title)]) : '',
    el('circle', { cx: 50, cy: 52, r: 48, class: 'halo' }),
    el('g', { class: 'bob' }, [BODY[meta.shape](), el('g', { class: 'eyes' }, [eye(37), eye(63)])]),
    el('g', { class: 'think' }, [el('circle', { cx: 82, cy: 14, r: 7 }), el('circle', { cx: 95, cy: 3, r: 4.5 })])
  ].filter(Boolean));
  return svg;
}
export function setSatState(svg, state) {
  svg.setAttribute('class', svg.getAttribute('class').replace(/st-\S+/, `st-${STATES.has(state) ? state : 'thinking'}`));
}
// Typing indicator: three dots in the Sat's colour (or the accent).
export const typing = color => Object.assign(document.createElement('span'), { className: 'typing', style: color ? `--dot:${color}` : '', innerHTML: '<i></i><i></i><i></i>' });
