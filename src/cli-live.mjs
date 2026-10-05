// The live Sat line: a breathing glyph + state label on ONE line below the output.
// It never interleaves with anything else: before any other write to stdout/stderr
// the line is erased, and it only reappears after a quiet moment, at the start of a
// line. Outside a capable terminal it degrades to one static line per state change.
import * as t from './theme.mjs';
import { satLine } from './cli-brand.mjs';
import { visualState } from './sat-states.mjs';

const QUIET_MS = 350;
const strip = s => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

export function createLiveLine({ caps, registry, lang = 'it', stdout = process.stdout, stderr = process.stderr, now = Date.now, interval = 125 }) {
  const origOut = stdout.write, origErr = stderr.write;
  const raw = (stream, text) => (stream === stdout ? origOut : origErr).call(stream, text);
  let current = null, shown = false, atLineStart = true, lastWrite = now(), timer = null, patched = false, lastStatic = '';

  const erase = () => { if (shown) { raw(stderr, '\r\x1b[2K\x1b[?25h'); shown = false; } };
  const foreign = chunk => {
    erase(); lastWrite = now();
    const s = typeof chunk === 'string' ? chunk : chunk?.toString?.() ?? '';
    if (s) atLineStart = s.endsWith('\n');
  };
  const patch = () => {
    if (patched) return; patched = true;
    stdout.write = function (chunk, ...a) { foreign(chunk); return origOut.call(this, chunk, ...a); };
    stderr.write = function (chunk, ...a) { foreign(chunk); return origErr.call(this, chunk, ...a); };
    process.once('exit', () => { if (shown) origErr.call(stderr, '\x1b[?25h'); });
  };
  const unpatch = () => { if (!patched) return; patched = false; stdout.write = origOut; stderr.write = origErr; };

  function draw() {
    if (!current) return;
    const text = satLine(current.satId, current.state, now() - current.since, { level: 'full', lang });
    const width = Math.max(20, (stderr.columns || 80) - 1);
    const plain = strip(text);
    const fitted = plain.length > width ? plain.slice(0, width - 1) + '…' : null; // never wrap: a wrapped line cannot be erased
    raw(stderr, `\r\x1b[2K\x1b[?25l${fitted ? t.faint(fitted) : text}`);
    shown = true;
  }
  function tick() {
    if (!current) return;
    if (now() - lastWrite >= QUIET_MS && atLineStart) draw();
  }

  return {
    tick, // exposed for tests
    onSatEvent(event) {
      if (event.type !== 'sat:state' || !caps.tty) return;
      const sat = registry.find(s => s.id === event.satId); if (!sat) return;
      const state = visualState(event.state);
      if (caps.level !== 'full') { // static: one line per change
        const text = strip(satLine(sat.id, state, 0, { level: caps.level === 'text' ? 'text' : 'reduced', lang }));
        if (text !== lastStatic) { lastStatic = text; process.stderr.write(caps.color ? `${satLine(sat.id, state, 0, { level: 'reduced', lang })}\n` : `${text}\n`); }
        return;
      }
      if (!current || current.satId !== sat.id || current.state !== state) current = { satId: sat.id, state, since: now() };
      patch();
      if (!timer && interval > 0) { timer = setInterval(tick, interval); timer.unref?.(); }
      tick();
    },
    stop() {
      if (timer) { clearInterval(timer); timer = null; }
      const last = current; erase(); unpatch(); current = null;
      // Leave one calm line behind when a Sat finished or hit a problem.
      if (last && caps.level === 'full' && ['happy', 'concerned'].includes(last.state)) {
        raw(stderr, `${satLine(last.satId, last.state, 0, { level: 'reduced', lang })}\n`);
      }
    }
  };
}
