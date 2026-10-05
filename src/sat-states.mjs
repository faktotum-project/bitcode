// Human-readable Sat states shared by the CLI and the desktop app.
import { phrasesFor, word } from './work-meter.mjs';
// Tone: calm, one verb, the breath as metaphor; never hype.
// Pure data and functions: no I/O, safe to bundle into the renderer.

// Visual states are the ones the avatars animate; event states come from sat-events.mjs.
export const VISUAL_STATES = Object.freeze(['idle', 'thinking', 'reading', 'running', 'drafting', 'waiting', 'happy', 'concerned']);
const EVENT_TO_VISUAL = { writing: 'drafting', waiting_approval: 'waiting', success: 'happy', error: 'concerned', planning: 'thinking', delegating: 'running' };
export const visualState = state => EVENT_TO_VISUAL[state] || (VISUAL_STATES.includes(state) ? state : 'thinking');

// Only four states carry words; the avatars still animate all eight. A resting Sat has no label at all.
export const ESSENTIAL = Object.freeze(['working', 'waiting', 'done', 'problem']);
const TO_ESSENTIAL = { thinking: 'working', reading: 'working', running: 'working', drafting: 'working', waiting: 'waiting', happy: 'done', concerned: 'problem' };
export const essentialState = state => TO_ESSENTIAL[visualState(state)] || 'idle';

// Ethical-bitcoin principles, shown only where a real control exists.
const ETHICS = {
  it: { wallet: 'il portafoglio resta chiuso', network: 'lavora al riparo, senza rete', testSend: 'nessuna fretta: firmi tu' },
  en: { wallet: 'the wallet stays closed', network: 'working sheltered, offline', testSend: 'no rush: you sign' }
};

export const satLang = (env = process.env) => {
  const raw = String(env.BITCODE_LANG || env.LC_ALL || env.LANG || '').toLowerCase();
  return raw.startsWith('it') ? 'it' : 'en';
};
const pick = lang => (lang === 'it' ? 'it' : 'en');

// -> { state, label }  e.g. { state: 'waiting', label: 'aspetta il tuo sì' }; idle -> label ''.
// A working Sat shows the first of its own phrases here (the live line rotates through all of them).
export function satStateLabel(satId, state, lang = 'it') {
  const e = essentialState(state), l = pick(lang);
  const label = e === 'idle' ? '' : e === 'working' ? phrasesFor(satId, l)[0] : word(e === 'problem' ? 'problem' : e, l);
  return { state: visualState(state), label: label.toLowerCase(), text: label.toLowerCase() };
}
// The Sat's own voice: the phrases it rotates through while working.
export const satStateTable = (satId, lang = 'it') => phrasesFor(satId, pick(lang)).map(label => ({ state: 'working', label: label.toLowerCase(), text: label.toLowerCase() }));

// Lines for a Sat's permissions: only what its manifest actually enforces.
export function satEthics(permissions = {}, lang = 'it') {
  const l = pick(lang), lines = [];
  if (permissions.wallet === 'deny') lines.push(ETHICS[l].wallet);
  if (permissions.network === 'deny') lines.push(ETHICS[l].network);
  return lines;
}
export const testSendNote = (lang = 'it') => ETHICS[pick(lang)].testSend;
