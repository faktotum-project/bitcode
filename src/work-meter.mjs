// What a run is doing right now, in words: a calm rotating phrase plus ONE measured
// datum at a time (seconds, tokens, speed, local memory, current action).
// Pure: no I/O, no timers. Shared by the CLI live line and the desktop chat.

export const PHRASE_MS = 7000; // the phrase changes slowly...
export const DATUM_MS = 3500; // ...the datum rotates twice as often, so the line stays readable

const PHRASES = {
  it: {
    bitcode: ['Ragiona con calma', 'Mette in ordine le idee', 'Cerca il filo', 'Pesa le parole'],
    node: ['Ascolta la rete', 'Segue il respiro dei blocchi', 'Lascia scorrere i blocchi', 'Osserva la mempool'],
    script: ['Intreccia il codice', 'Dà forma', 'Lavora con calma', 'Cura ogni riga'],
    hash: ['Osserva con cura', 'Pesa ogni dettaglio', 'Cerca ciò che non torna', 'Controlla due volte'],
    merkle: ['Raccoglie i rami', 'Affida il lavoro ai Sats', 'Tiene insieme il disegno', 'Cerca l’equilibrio']
  },
  en: {
    bitcode: ['Thinking it through', 'Putting ideas in order', 'Looking for the thread', 'Weighing the words'],
    node: ['Listening to the network', 'Following the blocks’ breath', 'Letting the blocks flow', 'Watching the mempool'],
    script: ['Weaving the code', 'Shaping it', 'Working unhurried', 'Caring for every line'],
    hash: ['Looking closely', 'Weighing every detail', 'Looking for what doesn’t add up', 'Checking twice'],
    merkle: ['Gathering the branches', 'Handing work to the Sats', 'Holding the design together', 'Seeking balance']
  }
};
const WORDS = {
  it: { waiting: 'Aspetta il tuo sì', done: 'Fatto', problem: 'Si ferma e respira', cancelled: 'Interrotto', token: 'token' },
  en: { waiting: 'Waiting for your yes', done: 'Done', problem: 'Pausing to breathe', cancelled: 'Stopped', token: 'tokens' }
};
const pick = lang => (lang === 'en' ? 'en' : 'it');
export const phrasesFor = (id, lang = 'it') => PHRASES[pick(lang)][id] || PHRASES[pick(lang)].bitcode;
export const word = (key, lang = 'it') => WORDS[pick(lang)][key];

// ---- formatting ----
export function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}
export function fmtCount(n, lang = 'it') {
  if (n < 1000) return String(Math.round(n));
  const v = n / 1000, text = (v < 10 ? v.toFixed(1) : String(Math.round(v)));
  return `${pick(lang) === 'it' ? text.replace('.', ',') : text}k`;
}
export function fmtBytes(b, lang = 'it') {
  const gb = b / 1024 ** 3;
  const text = gb >= 10 ? String(Math.round(gb)) : gb >= 1 ? gb.toFixed(1) : null;
  if (!text) return `${Math.max(1, Math.round(b / 1024 ** 2))} MB`;
  return `${pick(lang) === 'it' ? text.replace('.', ',') : text} GB`;
}

// ---- the meter ----
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
export function createWorkMeter({ now = Date.now } = {}) {
  const m = { startedAt: now(), exactIn: 0, exactOut: 0, callChars: 0, callStart: null, callLast: 0, speed: null, action: null, memory: null };
  return {
    onDelta(piece) {
      const t = now(); if (m.callStart == null) m.callStart = t;
      m.callLast = t; m.callChars += String(piece ?? '').length;
      const secs = (t - m.callStart) / 1000;
      if (secs >= 1) m.speed = Math.max(1, Math.round(Math.ceil(m.callChars / 4) / secs));
    },
    onUsage(u = {}) { // exact numbers replace the running estimate of that call
      const out = num(u.output_tokens ?? u.completion_tokens), inn = num(u.input_tokens ?? u.prompt_tokens);
      m.exactOut += out; m.exactIn += inn;
      if (out && m.callStart != null && m.callLast > m.callStart) m.speed = Math.max(1, Math.round(out / ((m.callLast - m.callStart) / 1000)));
      m.callChars = 0; m.callStart = null; m.callLast = 0;
    },
    setAction(text) { m.action = text || null; },
    setMemory(mem) { m.memory = mem || null; },
    snapshot() { return { elapsed: now() - m.startedAt, inTokens: m.exactIn, outTokens: m.exactOut + Math.ceil(m.callChars / 4), speed: m.speed, action: m.action, memory: m.memory }; }
  };
}

// Data available right now, in a stable order.
export function datums(snap, lang = 'it') {
  const list = [fmtElapsed(snap.elapsed)];
  if (snap.outTokens > 0) list.push(`${snap.inTokens > 0 ? `↑ ${fmtCount(snap.inTokens, lang)} ` : ''}↓ ${fmtCount(snap.outTokens, lang)} ${word('token', lang)}`);
  if (snap.speed) list.push(`${snap.speed} tok/s`);
  if (snap.memory?.bytes) list.push(memoryText(snap.memory, lang));
  return list;
}
export const memoryText = (mem, lang = 'it') => (mem.vram && mem.vram >= mem.bytes * 0.5 ? `${fmtBytes(mem.vram, lang)} GPU` : `${fmtBytes(mem.bytes, lang)} RAM`);

// The line for a working run at `ms` since it started. An action in progress is shown fixed (with the time);
// otherwise the datum rotates every DATUM_MS and the phrase every PHRASE_MS.
export function workText({ id, snap, ms, lang = 'it' }) {
  const phrases = phrasesFor(id, lang), seed = [...(id || 'bitcode')].reduce((a, c) => a + c.charCodeAt(0), 0);
  const phrase = phrases[(Math.floor(ms / PHRASE_MS) + seed) % phrases.length];
  const list = datums(snap, lang);
  const datum = snap.action ? `${snap.action} · ${list[0]}` : list[Math.floor(ms / DATUM_MS) % list.length];
  return { phrase, datum };
}

// The fixed closing line: "Fatto · 14s · ↑ 3,1k ↓ 1,2k token · 17 GB GPU".
export function closingText({ outcome, snap, lang = 'it' }) {
  const key = outcome === 'ok' || outcome === 'done' ? 'done' : outcome === 'cancelled' ? 'cancelled' : 'problem';
  const list = datums(snap, lang);
  const tokens = list.find(x => x.includes(word('token', lang))), speed = list.find(x => x.endsWith('tok/s'));
  return [word(key, lang), list[0], tokens, speed, snap.memory?.bytes ? memoryText(snap.memory, lang) : null].filter(Boolean).join(' · ');
}

// A short readable action from a public tool summary ("read_file · src/a.js" -> "legge src/a.js").
const ACTIONS = {
  it: { read_file: 'legge', list_dir: 'esplora', write_file: 'scrive', edit_file: 'modifica', patch: 'applica una modifica a', bash: 'esegue un comando', exec_command: 'esegue un comando' },
  en: { read_file: 'reading', list_dir: 'browsing', write_file: 'writing', edit_file: 'editing', patch: 'patching', bash: 'running a command', exec_command: 'running a command' }
};
export function actionText(data = {}, lang = 'it') {
  const verb = ACTIONS[pick(lang)][data.tool]; if (!verb) return data.tool ? data.tool.replace(/_/g, ' ') : null;
  const target = String(data.summary || '').split(' · ')[1];
  return target ? `${verb} ${target}` : verb;
}
