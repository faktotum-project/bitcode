// Human-readable Sat states shared by the CLI and the desktop app.
// Tone: calm, one verb, the breath as metaphor; never hype. Every state keeps its
// plain technical word ("oggi") next to the wellbeing label so nothing is lost.
// Pure data and functions: no I/O, safe to bundle into the renderer.

// Visual states are the ones the avatars animate; event states come from sat-events.mjs.
export const VISUAL_STATES = Object.freeze(['idle', 'thinking', 'reading', 'running', 'drafting', 'waiting', 'happy', 'concerned']);
const EVENT_TO_VISUAL = { writing: 'drafting', waiting_approval: 'waiting', success: 'happy', error: 'concerned', planning: 'thinking', delegating: 'running' };
export const visualState = state => EVENT_TO_VISUAL[state] || (VISUAL_STATES.includes(state) ? state : 'thinking');

const BASE = {
  it: { idle: 'respiro', thinking: 'inspira', reading: 'ascolta', running: 'espira', drafting: 'dà forma', waiting: 'aspetta il tuo sì', happy: 'in equilibrio', concerned: 'si ferma e respira' },
  en: { idle: 'breathing', thinking: 'inhaling', reading: 'listening', running: 'exhaling', drafting: 'shaping', waiting: 'waiting for your yes', happy: 'in balance', concerned: 'pausing to breathe' }
};
const PLAIN = {
  it: { idle: 'riposo', thinking: 'pensa', reading: 'legge', running: 'esegue', drafting: 'scrive', waiting: 'attende la tua conferma', happy: 'fatto', concerned: 'problema' },
  en: { idle: 'idle', thinking: 'thinking', reading: 'reading', running: 'running', drafting: 'writing', waiting: 'awaiting your confirmation', happy: 'done', concerned: 'problem' }
};
// One nuance per Sat, tied to its role: Node = infrastructure, Script = implementation, Hash = security, Merkle = orchestration.
const NUANCE = {
  it: {
    node: { thinking: 'segue il respiro della rete', reading: 'ascolta la rete', running: 'lascia scorrere i blocchi', happy: 'la rete respira' },
    script: { drafting: 'intreccia il codice', running: 'esegue con calma', waiting: 'aspetta il tuo sì prima di eseguire' },
    hash: { reading: 'osserva con cura', thinking: 'pesa ogni dettaglio', concerned: 'ha trovato qualcosa: guardiamo insieme' },
    merkle: { thinking: 'raccoglie i rami', running: 'affida il lavoro ai Sats', happy: 'tutto in armonia' }
  },
  en: {
    node: { thinking: 'following the network’s breath', reading: 'listening to the network', running: 'letting the blocks flow', happy: 'the network is breathing' },
    script: { drafting: 'weaving the code', running: 'running, unhurried', waiting: 'waiting for your yes before running' },
    hash: { reading: 'looking closely', thinking: 'weighing every detail', concerned: 'found something: let’s look together' },
    merkle: { thinking: 'gathering the branches', running: 'handing work to the Sats', happy: 'all in harmony' }
  }
};
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

// -> { state, label, plain, text }  e.g. { label: 'intreccia il codice', plain: 'scrive', text: 'intreccia il codice · scrive' }
export function satStateLabel(satId, state, lang = 'it') {
  const l = pick(lang), v = visualState(state);
  const label = NUANCE[l][satId]?.[v] ?? BASE[l][v], plain = PLAIN[l][v];
  return { state: v, label, plain, text: `${label} · ${plain}` };
}
export const satStateTable = (satId, lang = 'it') => VISUAL_STATES.map(v => satStateLabel(satId, v, lang));

// Lines for a Sat's permissions: only what its manifest actually enforces.
export function satEthics(permissions = {}, lang = 'it') {
  const l = pick(lang), lines = [];
  if (permissions.wallet === 'deny') lines.push(ETHICS[l].wallet);
  if (permissions.network === 'deny') lines.push(ETHICS[l].network);
  return lines;
}
export const testSendNote = (lang = 'it') => ETHICS[pick(lang)].testSend;
