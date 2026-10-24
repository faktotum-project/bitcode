// One brand composition for the social kit and the site OG image.
// Development-only: returns an HTML string that Playwright screenshots.
// Rules it follows (brand/README.md): dark canvas, one orange highlight, the official
// wordmark and the untouched 4x5 pixel mark, Inter for text and JetBrains Mono for labels.

const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const px = n => `${Math.round(n * 10) / 10}px`;

// Split the tagline on its first comma so the second clause can carry the orange highlight.
function taglineLines(tokens, lang) {
  const custom = tokens.brand.taglineLines?.[lang];
  if (custom) return custom;
  const [first, ...rest] = tokens.brand.taglines[lang].split(',');
  return [first.trim() + ',', rest.join(',').trim()];
}

export function cardHtml({ w, h, lang = 'en', layout = 'split', tokens, logo, font, safe }) {
  const C = tokens.color.dark;
  const accent = tokens.color.accent;
  const stack = layout === 'stack';
  const pad = Math.round(Math.min(w, h) * 0.075);
  const boxW = safe?.width ?? w - pad * 2;
  const boxH = safe?.height ?? h - pad * 2;
  const unit = stack ? Math.min(boxW, boxH) : boxH;

  const [line1, line2] = taglineLines(tokens, lang);
  const eyebrow = tokens.brand.eyebrow?.[lang] ?? 'Bitcoin agent';
  const lede = tokens.brand.lede?.[lang] ?? tokens.brand.taglines[lang];

  const brandH = Math.max(unit * (stack ? 0.075 : 0.11), 22);
  const titleSize = unit * (stack ? 0.14 : 0.155);
  const eyebrowSize = Math.min(Math.max(unit * 0.024, 11), 22);
  const ledeSize = Math.min(Math.max(unit * 0.034, 14), 34);
  const footSize = Math.min(Math.max(unit * 0.024, 10), 17);
  const gap = Math.round(unit * 0.035);
  const markH = Math.round(stack ? Math.min(unit * 0.4, boxH * 0.3) : Math.min(boxH * 0.5, boxW * 0.22));
  const plateW = Math.round(markH * 1.52);
  const plateH = Math.round(markH * 1.62);
  const capSize = Math.min(Math.max(markH * 0.055, 9), 14);
  const radius = Math.round(unit * 0.03);
  const grid = Math.max(Math.round(Math.min(w, h) * 0.06), 24);
  const cell = Math.max(Math.round(markH / 5), 8);

  const css = `
@font-face{font-family:Inter;src:url('${font('inter-latin.woff2')}') format('woff2');font-weight:400 700;font-display:block}
@font-face{font-family:Mono;src:url('${font('jetbrains-mono-latin.woff2')}') format('woff2');font-weight:400 600;font-display:block}
*{box-sizing:border-box}
html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden}
body{background:${C.canvas};color:${C.ink};font-family:Inter,system-ui,sans-serif;color-scheme:dark}
.card{position:relative;width:${w}px;height:${h}px;overflow:hidden;background:${C.canvas}}
.field{position:absolute;inset:0;background-image:linear-gradient(rgba(247,247,244,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(247,247,244,.05) 1px,transparent 1px);background-size:${grid}px ${grid}px;background-position:center}
.glow{position:absolute;inset:0;background:radial-gradient(58% 66% at 76% 44%,rgba(247,147,26,.09),transparent 70%)}
${safe?.x != null ? `.frame{position:absolute;left:${safe.x}px;top:50%;transform:translateY(-50%)}` : '.frame{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)}'}
.frame--split{width:${boxW}px;height:${boxH}px;display:flex;align-items:stretch;gap:${Math.round(boxW * 0.05)}px}
.copy{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;justify-content:space-between;gap:${gap}px}
.copy .hero{flex:1 1 auto;display:flex;flex-direction:column;justify-content:center}
.visual{flex:0 0 ${Math.round(boxW * 0.4)}px;display:flex;align-items:center;justify-content:center}
.brand svg{height:${px(brandH)};width:auto;display:block}
.eyebrow{display:flex;align-items:center;gap:.7em;margin:0 0 ${gap}px;font-family:Mono,ui-monospace,monospace;font-size:${px(eyebrowSize)};font-weight:500;line-height:1;letter-spacing:.16em;text-transform:uppercase;color:${C.body}}
.sq{width:${px(eyebrowSize * 0.72)};height:${px(eyebrowSize * 0.72)};background:${accent};display:inline-block;flex:none}
h1{margin:0;font-size:${px(titleSize)};font-weight:600;line-height:1.02;letter-spacing:-.045em;color:${C.ink}}
h1 .accent{color:${accent}}
.lede{margin:${gap}px 0 0;font-size:${px(ledeSize)};line-height:1.45;letter-spacing:-.02em;color:${C.body};max-width:${Math.round(boxW * 0.58)}px}
.foot{display:flex;align-items:center;gap:.7em;font-family:Mono,ui-monospace,monospace;font-size:${px(footSize)};font-weight:400;line-height:1.4;letter-spacing:-.02em;color:${C.muted}}
.foot .sq{width:${px(footSize * 0.62)};height:${px(footSize * 0.62)}}
.plate{position:relative;width:${plateW}px;height:${plateH}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${Math.round(markH * 0.1)}px;background:${C.surface};border:1px solid ${C.hairline};border-radius:${radius}px;overflow:hidden}
.plate::before{content:'';position:absolute;inset:0;background-image:linear-gradient(rgba(247,247,244,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(247,247,244,.05) 1px,transparent 1px);background-size:${cell}px ${cell}px;background-position:center}
.plate svg{position:relative;height:${markH}px;width:auto;display:block}
.plate .cap{position:relative;font-family:Mono,ui-monospace,monospace;font-size:${px(capSize)};letter-spacing:.16em;text-transform:uppercase;color:${C.mutedSoft}}
.frame--stack{width:${boxW}px;height:${boxH}px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:${gap}px}
.frame--stack .brand{align-self:flex-start}
.frame--stack .hero{flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center}
.frame--stack .eyebrow{justify-content:center}
.frame--stack .lede{max-width:${Math.round(boxW * 0.74)}px}
.frame--stack .foot{justify-content:center}
.frame--stack .plate{width:${Math.round(Math.min(plateW, boxW * 0.72))}px;height:${Math.round(Math.min(plateH, boxH * 0.42))}px}
`;

  const wordmark = logo('wordmark-on-dark.svg');
  const mark = logo('mark-on-dark.svg');
  const brand = `<div class="brand">${wordmark}</div>`;
  const hero = `<div class="hero"><p class="eyebrow"><span class="sq"></span>${escape(eyebrow)}</p><h1>${escape(line1)}<br><span class="accent">${escape(line2)}</span></h1><p class="lede">${escape(lede)}</p></div>`;
  const visual = `<div class="visual"><div class="plate">${mark}<span class="cap">Pixel B · 4×5</span></div></div>`;
  const foot = `<div class="foot"><span class="sq"></span><span>Bitcoin · Lightning · Liquid · Taproot Assets · RGB · Cashu</span></div>`;

  const frame = stack
    ? `<div class="frame frame--stack">${brand}${hero}${visual}${foot}</div>`
    : `<div class="frame frame--split"><div class="copy">${brand}${hero}${foot}</div>${visual}</div>`;

  return `<!doctype html><html lang="${escape(lang)}"><head><meta charset="utf-8"><style>${css}</style></head><body><div class="card"><div class="field"></div><div class="glow"></div>${frame}</div></body></html>`;
}

// Avatar: the mark alone, safe for circular crops. Kept separate from the card composition.
export function avatarHtml({ size, tokens, logo }) {
  const dark = tokens.color.dark;
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden}body{display:flex;align-items:center;justify-content:center;background:${dark.canvas}}.mark svg{height:${Math.round(size * 0.5)}px;width:auto;display:block}</style></head><body><div class="mark">${logo('mark-on-dark.svg')}</div></body></html>`;
}

// Link preview (OG, X/LinkedIn post card, GitHub): a Sat and the tagline, nothing else. Titles and
// descriptions already travel with the link, so the image carries only what the text cannot: the
// mood of the site. The Sat stays inside the centre square that messaging apps crop to.
export function shareHtml({ w, h, lang = 'en', tokens, logo, font, sat }) {
  const W = tokens.web.color, accent = tokens.color.accent;
  const [line1, line2] = taglineLines(tokens, lang);
  // Scale from the 1200x630 master by whichever side is tighter, and anchor the Sat to the right edge.
  const unit = Math.min(h / 630, w / 1200);
  const satSize = Math.round(600 * unit);
  const satLeft = Math.round(w - satSize + 35 * unit);
  const css = `
@font-face{font-family:Inter;src:url('${font('inter-latin.woff2')}') format('woff2');font-weight:400 700;font-display:block}
*{box-sizing:border-box}
html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:${W.canvas}}
.card{position:relative;width:${w}px;height:${h}px;overflow:hidden;font-family:Inter,system-ui,sans-serif;color:${W.ink}}
.dots{position:absolute;inset:0;background-image:radial-gradient(circle,rgba(247,247,244,.09) ${px(1.2 * unit)},transparent ${px(1.4 * unit)});background-size:${px(24 * unit)} ${px(24 * unit)};-webkit-mask-image:radial-gradient(120% 90% at 30% 40%,black,transparent 75%)}
.glow{position:absolute;left:${satLeft + satSize / 2 - 380 * unit}px;top:${h / 2 - 380 * unit}px;width:${760 * unit}px;height:${760 * unit}px;border-radius:50%;background:radial-gradient(closest-side,rgba(247,147,26,.30),rgba(247,147,26,.08) 55%,transparent)}
.floor{position:absolute;left:${satLeft + satSize * 0.2}px;top:${h - 70 * unit}px;width:${satSize * 0.6}px;height:${36 * unit}px;border-radius:50%;background:radial-gradient(closest-side,rgba(0,0,0,.75),transparent)}
.sat{position:absolute;left:${satLeft}px;top:${h - satSize * 0.95}px;width:${satSize}px;height:${satSize}px;filter:drop-shadow(0 ${px(26 * unit)} ${px(40 * unit)} rgba(0,0,0,.6))}
.brand{position:absolute;left:${px(72 * unit)};top:${px(64 * unit)}}
.brand svg{height:${px(46 * unit)};width:auto;display:block}
h1{position:absolute;left:${px(72 * unit)};top:50%;transform:translateY(-38%);margin:0;font-size:${px(92 * unit)};font-weight:600;line-height:.98;letter-spacing:-.055em;white-space:nowrap}
h1 span{display:block}
h1 .accent{color:${accent}}
`;
  return `<!doctype html><html lang="${escape(lang)}"><head><meta charset="utf-8"><style>${css}</style></head><body><div class="card"><div class="dots"></div><div class="glow"></div><div class="floor"></div><img class="sat" src="${sat}" alt=""><div class="brand">${logo('wordmark-on-dark.svg')}</div><h1><span>${escape(line1)}</span><span class="accent">${escape(line2)}</span></h1></div></body></html>`;
}
