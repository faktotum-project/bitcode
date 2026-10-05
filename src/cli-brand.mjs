// Terminal counterpart of the app's marks: the pixel "b", the four Sats and their
// breathing states. Pure rendering helpers; timing and I/O live in cli-live.mjs.
import * as t from './theme.mjs';
import { visualState } from './sat-states.mjs';

const ACCENT = '#f7931a';
export const SAT_LOOK = Object.freeze({
  node: { color: '#3297ff', glyph: '●' }, script: { color: '#f7931a', glyph: '■' },
  hash: { color: '#b6f500', glyph: '⬢' }, merkle: { color: '#c96bff', glyph: '◆' },
  bitcode: { color: '#f7931a', glyph: '●' }
});
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const mix = (hex, k) => { const [r, g, b] = rgb(hex), f = 0.3 + 0.7 * k; return `\x1b[38;2;${Math.round(r * f)};${Math.round(g * f)};${Math.round(b * f)}m`; };

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

// ---- header: one line, the wordmark with an orange "b" (the network is named here once and nowhere else) ----
export const WORDMARK = 'bitcode';
export function headerLine(modelSpec, network, caps, letters = WORDMARK.length) {
  const shown = WORDMARK.slice(0, letters), mark = caps.color ? t.accent(t.bold(shown.slice(0, 1))) + t.bold(shown.slice(1)) : shown;
  if (letters < WORDMARK.length) return mark;
  const net = network ? t.faint(' · ') + (network === 'mainnet' ? t.accent(network) : t.faint(network)) : '';
  return `${mark}  ${t.faint('agent · ')}${t.body(modelSpec)}${net}`;
}
export function legacyHeader(modelSpec, network) { return t.wordmark(modelSpec, network); }

// ---- /sats cards: name and role, nothing else (a resting Sat has no status) ----
export function satCards(sats, caps) {
  return sats.map(s => `${satGlyph(s.id, 'idle', 0, { level: caps.level === 'text' ? 'text' : 'reduced' })} ${t.bold(s.name || nameOf(s.id))}  ${t.faint(s.role)}`).join('\n');
}

// ---- approval card ----
export function approvalCard({ satId, tool, financial, lang }, caps) {
  const who = satId ? nameOf(satId) : 'Bitcode';
  const verb = lang === 'it' ? 'chiede di usare' : 'wants to use';
  const note = financial ? (lang === 'it' ? 'nessuna fretta: firmi tu' : 'no rush: you sign') : (lang === 'it' ? 'aspetta il tuo sì' : 'waiting for your yes');
  if (caps.level === 'text') return `${who} ${verb} ${tool}`;
  const inner = `${satId ? satGlyph(satId, 'waiting', 0, { level: 'reduced' }) : t.accent('●')} ${t.bold(who)} ${verb} ${t.bold(tool)}  ${t.faint('· ' + note)}`;
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
export function welcomeSats(sats) {
  return sats.map(s => `${satGlyph(s.id, 'idle', 0, { level: 'reduced' })} ${t.body(s.name || nameOf(s.id))}`).join('   ');
}
