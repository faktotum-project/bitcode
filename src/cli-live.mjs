// The live work line, in the spirit of Claude's asterisk: a breathing glyph, a calm
// rotating phrase and ONE datum at a time (time, tokens, speed, local memory, current
// action). It never interleaves with other output: the line is erased before any other
// write to stdout/stderr and only returns after a quiet moment, at the start of a line.
// When the run ends it leaves one fixed closing line. Outside a capable terminal there is
// no animation: just that closing line, and only on a terminal.
import * as t from './theme.mjs';
import { satGlyph } from './cli-brand.mjs';
import { createWorkMeter, workText, closingText, actionText, word } from './work-meter.mjs';
import { createMemoryProbe } from './local-memory.mjs';

const QUIET_MS = 350;
const strip = s => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
// A Sat is named in bold; plain Bitcode work carries no name, only the dot.
const label = id => (id ? `${t.bold(id[0].toUpperCase() + id.slice(1))} ${t.faint('·')} ` : '');

// subject: { satId|null, runId, baseURL?, providerName?, model? }; the caller feeds it bus events and model hooks.
export function createLiveLine({ caps, registry, lang = 'it', subject = {}, stdout = process.stdout, stderr = process.stderr, now = Date.now, interval = 125, memoryProbe, memoryRead }) {
  const origOut = stdout.write, origErr = stderr.write;
  const raw = (stream, text) => (stream === stdout ? origOut : origErr).call(stream, text);
  const meter = createWorkMeter({ now });
  const probe = memoryProbe || createMemoryProbe({ providerName: subject.providerName, baseURL: subject.baseURL, model: subject.model }, memoryRead ? { read: memoryRead } : {});
  const startedAt = now();
  let satId = subject.satId || null, state = 'working', shown = false, atLineStart = true, lastWrite = now(), timer = null, patched = false, finished = null;
  const animate = caps.level === 'full' && caps.tty;

  const erase = () => { if (shown) { raw(stderr, '\r\x1b[2K\x1b[?25h'); shown = false; } };
  const foreign = chunk => { erase(); lastWrite = now(); const s = typeof chunk === 'string' ? chunk : chunk?.toString?.() ?? ''; if (s) atLineStart = s.endsWith('\n'); };
  const patch = () => {
    if (patched) return; patched = true;
    stdout.write = function (chunk, ...a) { foreign(chunk); return origOut.call(this, chunk, ...a); };
    stderr.write = function (chunk, ...a) { foreign(chunk); return origErr.call(this, chunk, ...a); };
    process.once('exit', () => { if (shown) origErr.call(stderr, '\x1b[?25h'); });
  };
  const unpatch = () => { if (!patched) return; patched = false; stdout.write = origOut; stderr.write = origErr; };

  const body = (ms, glyphLevel) => {
    const g = satGlyph(satId || 'bitcode', state === 'waiting' ? 'waiting' : 'thinking', ms, { level: glyphLevel });
    if (state === 'waiting') return `${g} ${label(satId)}${t.body(word('waiting', lang))}`;
    meter.setMemory(probe.get());
    const { phrase, datum } = workText({ id: satId || 'bitcode', snap: meter.snapshot(), ms, lang });
    return `${g} ${label(satId)}${t.body(phrase + '…')}  ${t.faint(datum)}`;
  };
  function draw() {
    const text = body(now() - startedAt, 'full'), plain = strip(text), width = Math.max(20, (stderr.columns || 80) - 1);
    raw(stderr, `\r\x1b[2K\x1b[?25l${plain.length > width ? t.faint(plain.slice(0, width - 1) + '…') : text}`); // never wrap: a wrapped line cannot be erased
    shown = true;
  }
  function tick() { if (!finished && animate && now() - lastWrite >= QUIET_MS && atLineStart) draw(); }
  if (animate) { patch(); if (interval > 0) { timer = setInterval(tick, interval); timer.unref?.(); } }

  return {
    tick, meter,
    hooks: { onDelta: piece => meter.onDelta(piece), onUsage: usage => meter.onUsage(usage) }, // merged into the run's hooks by the caller
    // Bus events of this run (and of Sats it delegates to).
    onEvent(event) {
      if (finished) return;
      const known = registry.some(s => s.id === event.agentId);
      if (known) satId = event.agentId; else if (!subject.satId) satId = null;
      if (event.type === 'approval.requested') state = 'waiting';
      else if (['approval.resolved', 'model.started', 'tool.started'].includes(event.type)) state = 'working';
      if (event.type === 'tool.started') meter.setAction(actionText(event.data, lang));
      if (event.type === 'tool.finished' || event.type === 'model.started') meter.setAction(null);
      tick();
    },
    stop(outcome = 'ok') {
      if (finished) return; finished = { outcome };
      if (timer) clearInterval(timer); probe.stop(); meter.setMemory(probe.get());
      erase(); unpatch();
      if (!caps.tty) return;
      const snap = meter.snapshot(), line = closingText({ outcome, snap, lang });
      const sat = satId || 'bitcode', glyph = satGlyph(sat, outcome === 'ok' ? 'happy' : 'concerned', 0, { level: caps.level === 'text' ? 'text' : 'reduced' });
      raw(stderr, `${glyph} ${label(satId)}${t.faint(line)}\n`);
    }
  };
}
