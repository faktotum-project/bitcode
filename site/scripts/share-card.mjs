// Brand compositions for the site OG image and the site icons.
// Development-only: returns an HTML string that Playwright screenshots.
// Rules it follows (brand/README.md): the site's dark canvas, one orange highlight, the official
// wordmark, the untouched 4x5 pixel mark and Inter for text.

const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const px = n => `${Math.round(n * 10) / 10}px`;

// Split the tagline on its first comma so the second clause can carry the orange highlight.
function taglineLines(tokens, lang) {
  const custom = tokens.brand.taglineLines?.[lang];
  if (custom) return custom;
  const [first, ...rest] = tokens.brand.taglines[lang].split(',');
  return [first.trim() + ',', rest.join(',').trim()];
}

// Avatar: the mark alone, safe for circular crops. Kept separate from the card composition.
export function avatarHtml({ size, tokens, logo }) {
  const dark = tokens.color.dark;
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden}body{display:flex;align-items:center;justify-content:center;background:${dark.canvas}}.mark svg{height:${Math.round(size * 0.5)}px;width:auto;display:block}</style></head><body><div class="mark">${logo('mark-on-dark.svg')}</div></body></html>`;
}

// Link preview (OG): a Sat and the tagline, nothing else. Titles and
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
