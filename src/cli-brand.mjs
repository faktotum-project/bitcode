// Terminal counterpart of the app's marks: the pixel "b", the four Sats and their
// breathing states. Pure rendering helpers; timing and I/O live in cli-live.mjs.
import * as t from './theme.mjs';
import { satStateLabel, visualState } from './sat-states.mjs';

const ACCENT = '#f7931a';
export const SAT_LOOK = Object.freeze({
  node: { color: '#3297ff', glyph: '●' }, script: { color: '#f7931a', glyph: '■' },
  hash: { color: '#b6f500', glyph: '⬢' }, merkle: { color: '#c96bff', glyph: '◆' }
});
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const mix = (hex, k) => { const [r, g, b] = rgb(hex), f = 0.3 + 0.7 * k; return `\x1b[38;2;${Math.round(r * f)};${Math.round(g * f)};${Math.round(b * f)}m`; };

// ---- the "b": same pieces as the app's logo (4x5 grid), drawn with half blocks ----
const PIECES = [[0, 0, 1, 4], [1, 0, 2, 1], [2, 1, 1, 1], [1, 2, 1, 1], [3, 2, 1, 2], [0, 4, 2, 1]]; // last one is the orange base
export const LOGO_PIECES = PIECES.length;
export const LOGO_WIDTH = 8;
function grid() {
  const g = Array.from({ length: 5 }, () => Array(4).fill(-1));
  PIECES.forEach(([x, y, w, h], i) => { for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) g[r][c] = i; });
  return g;
}
// `shown` pieces are visible; the newest one flashes orange (the app's drop-in, as a step).
export function logoRows(shown = LOGO_PIECES, { color = true } = {}) {
  const g = grid(), rows = [];
  const pix = (r, c) => { const p = r < 5 ? g[r][c] : -1; return p >= 0 && p < shown ? p : -1; };
  const hue = p => (p === 5 || (shown < LOGO_PIECES && p === shown - 1) ? 'a' : 'i');
  for (let r = 0; r < 5; r += 2) {
    let line = '';
    for (let c = 0; c < 4; c++) {
      const top = pix(r, c), bot = pix(r + 1, c);
      let cell = '  ';
      if (top >= 0 && bot >= 0) cell = hue(top) === hue(bot) ? paint('██', hue(top), color) : paintBg('▀▀', hue(top), hue(bot), color);
      else if (top >= 0) cell = paint('▀▀', hue(top), color);
      else if (bot >= 0) cell = paint('▄▄', hue(bot), color);
      line += cell;
    }
    rows.push(line);
  }
  return rows;
}
const paint = (s, h, color) => (!color ? s : h === 'a' ? t.fg(ACCENT, s) : t.bold(s));
// Two stacked pixels of different hue: the orange one becomes the cell background, the other the default foreground.
const paintBg = (s, top, bot, color) => {
  if (!color) return s;
  const [r, g, b] = rgb(ACCENT);
  return `\x1b[1m\x1b[48;2;${r};${g};${b}m${top === 'a' ? s.replace(/▀/g, '▄') : s}\x1b[0m`;
};

// ---- Sat glyphs that breathe ----
// Cadence per state, in ms: slow for rest, quicker while shaping, firm and steady while waiting for the user.
const CADENCE = { idle: [4200, .5], thinking: [2800, .8], reading: [1900, .7], running: [2300, .8], drafting: [1300, .8], waiting: [1700, 1], happy: [3600, .35], concerned: [3200, .45] };
export function pulse(state, ms) {
  const [period, depth] = CADENCE[visualState(state)];
  return 1 - depth * (0.5 + 0.5 * Math.cos((2 * Math.PI * ms) / period)) * 0.9; // 1 = brightest
}
export function satGlyph(satId, state, ms, { level = 'text' } = {}) {
  const look = SAT_LOOK[satId];
  if (!look || level === 'text') return '*';
  if (level !== 'full') return t.fg(look.color, look.glyph);
  return `${mix(look.color, pulse(state, ms))}${look.glyph}\x1b[0m`;
}
const nameOf = id => id[0].toUpperCase() + id.slice(1);
export function satLine(satId, state, ms, { level, lang }) {
  const l = satStateLabel(satId, state, lang);
  return `${satGlyph(satId, state, ms, { level })} ${t.bold(nameOf(satId))} ${t.faint('·')} ${t.body(l.label)} ${t.faint('· ' + l.plain)}`;
}

// ---- header block: logo + wordmark ----
export function headerRows(modelSpec, network, caps, shown = LOGO_PIECES) {
  const logo = logoRows(shown, { color: caps.color });
  const info = [t.bold('bitcode'), `${t.faint('agent · ')}${t.body(modelSpec)}${network ? t.faint(' · ') + (network === 'mainnet' ? t.accent(network) : t.ok(network)) : ''}`, `${t.ok('●')} ${t.faint('ready')}`];
  return logo.map((row, i) => `${row}  ${info[i]}`);
}
export function legacyHeader(modelSpec, network) { return t.wordmark(modelSpec, network); }

// ---- /sats cards ----
export function satCards(sats, caps, lang) {
  return sats.map(s => {
    const idle = satStateLabel(s.id, 'idle', lang);
    return `${satGlyph(s.id, 'idle', 0, { level: caps.level === 'text' ? 'text' : 'reduced' })} ${t.bold(s.name || nameOf(s.id))}  ${t.faint(s.role)}\n   ${t.body(idle.label)} ${t.faint('· ' + idle.plain)}`;
  }).join('\n');
}

// ---- approval card ----
export function approvalCard({ satId, tool, network, financial, lang }, caps) {
  const who = satId ? nameOf(satId) : 'Bitcode';
  const verb = lang === 'it' ? 'chiede di usare' : 'wants to use';
  const note = financial ? (lang === 'it' ? 'nessuna fretta: firmi tu' : 'no rush: you sign') : (lang === 'it' ? 'aspetta il tuo sì' : 'waiting for your yes');
  if (caps.level === 'text') return `${who} ${verb} ${tool} (${network})`;
  const inner = `${satId ? satGlyph(satId, 'waiting', 0, { level: 'reduced' }) : t.accent('●')} ${t.bold(who)} ${verb} ${t.bold(tool)}  ${t.faint('· ' + network + ' · ' + note)}`;
  return `${t.accent('▎')} ${inner}`;
}

// ---- diff: a coloured gutter bar like the app's tinted rows (no background guessing on light/dark terminals) ----
export function diffLine(line, caps) {
  if (caps.level === 'text') return line;
  if (line.startsWith('+') && !line.startsWith('+++')) return `${t.ok('▎')}${t.ok(line)}`;
  if (line.startsWith('-') && !line.startsWith('---')) return `${t.danger('▎')}${t.danger(line)}`;
  return /^(@@|\+\+\+|---)/.test(line) ? t.faint(line) : line;
}

// ---- boxes ----
const widthOf = s => [...s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')].length;
export function box(title, rows, caps, { accent = false } = {}) {
  if (caps.level === 'text') return [title, ...rows].join('\n');
  const edge = accent ? t.accent : t.faint, inner = Math.max(widthOf(title) + 2, ...rows.map(widthOf)) + 1;
  const pad = s => s + ' '.repeat(Math.max(0, inner - widthOf(s)));
  return [`${edge('╭─ ')}${title} ${edge('─'.repeat(Math.max(1, inner - widthOf(title) - 2)) + '╮')}`,
    ...rows.map(r => `${edge('│')} ${pad(r)}${edge('│')}`), edge('╰' + '─'.repeat(inner + 1) + '╯')].join('\n');
}
const kv = (k, v, w = 11) => `${t.faint(k.padEnd(w))}${v}`;

// Payment review: same facts, same confirmation rule as before; only the presentation changes.
export function reviewCard(p, caps, lang = 'it') {
  const it = lang === 'it', n = x => Number(x).toLocaleString(it ? 'it-IT' : 'en-US');
  return box(`${t.bold(it ? 'Controlla la proposta' : 'Review the proposal')}  ${t.faint(p.network)}`, [
    kv(it ? 'Wallet' : 'Wallet', p.wallet), kv(it ? 'Destinatario' : 'Recipient', p.to),
    kv(it ? 'Importo' : 'Amount', `${t.bold(n(p.amountSats))} sat`), kv(it ? 'Commissione' : 'Fee', `${n(p.feeSats)} sat ${t.faint(`· ${p.feeRate} sat/vB`)}`),
    kv(it ? 'Scade' : 'Expires', p.expiresAt), kv('id', p.id),
    '', t.faint(it ? 'Niente viene firmato finché non confermi. Nessuna fretta: firmi tu.' : 'Nothing is signed until you confirm. No rush: you sign.')
  ], caps, { accent: true });
}

// `finance status` for people: policy limits + recent proposals. Scripts still get JSON (piped or --json).
export function financeBox(state, caps, lang = 'it') {
  const it = lang === 'it', n = x => Number(x).toLocaleString(it ? 'it-IT' : 'en-US'), p = state.policy;
  const policy = p ? [kv(it ? 'Massimo per pagamento' : 'Per payment', `${n(p.maxPaymentSats)} sat`, 24), kv(it ? 'Limite giornaliero' : 'Daily limit', `${n(p.dailyLimitSats)} sat`, 24),
    kv(it ? 'Commissione massima' : 'Max fee', `${n(p.maxFeeSats)} sat`, 24), kv(it ? 'Riserva minima' : 'Min reserve', `${n(p.minReserveSats)} sat`, 24)]
    : [t.faint(it ? 'Nessuna policy: imposta i limiti prima di qualsiasi invio.' : 'No policy yet: set limits before any send.')];
  const recent = (state.proposals || []).slice(-5).map(x => `${t.faint(String(x.id).slice(0, 10))}  ${n(x.amountSats)} sat  ${t.faint(x.status)}`);
  return [box(it ? 'Policy di spesa' : 'Spending policy', policy, caps), ...(recent.length ? [box(it ? 'Proposte' : 'Proposals', recent, caps)] : [])].join('\n');
}

// ---- welcome: the four Sats instead of the five-stage legend ----
export function welcomeSats(sats, caps, lang) {
  const idle = satStateLabel(sats[0]?.id, 'idle', lang).label;
  return `${sats.map(s => `${satGlyph(s.id, 'idle', 0, { level: 'reduced' })} ${t.body(s.name || nameOf(s.id))}`).join('   ')}   ${t.faint('· ' + idle)}`;
}
