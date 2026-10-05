// What this terminal can safely show. One decision, made once, so every visual
// feature degrades the same way: full (24-bit colour + motion) -> reduced
// (static visuals) -> text (plain, exactly as before).
export function detectCaps({ env = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  const forced = String(env.BITCODE_UI || '').toLowerCase();
  const tty = Boolean(stdout?.isTTY && stderr?.isTTY);
  const color = tty && env.NO_COLOR == null && env.TERM !== 'dumb';
  const locale = String(env.LC_ALL || env.LC_CTYPE || env.LANG || '');
  // The Linux virtual console has no block/shape glyphs; everything else on UTF-8 does.
  const unicode = /utf-?8/i.test(locale) && env.TERM !== 'linux';
  const truecolor = color && (/truecolor|24bit/i.test(env.COLORTERM || '') || /direct|kitty|wezterm|ghostty/i.test(env.TERM || '')
    || ['iTerm.app', 'vscode', 'WezTerm', 'ghostty', 'Hyper'].includes(env.TERM_PROGRAM) || Boolean(env.WT_SESSION || env.KITTY_WINDOW_ID));
  const calm = Boolean(env.CI) || env.BITCODE_MOTION === '0' || env.BITCODE_REDUCE_MOTION != null;
  let level = !color || !unicode ? 'text' : truecolor && !calm ? 'full' : 'reduced';
  if (['full', 'reduced', 'text'].includes(forced)) level = forced === 'full' && !color ? 'text' : forced; // never animate into a non-terminal
  return { level, color, unicode, truecolor, tty, columns: Math.max(20, stderr?.columns || stdout?.columns || 80) };
}
