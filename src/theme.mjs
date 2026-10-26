// Terminal theme — a faithful translation of the design system (brand/design-system.html,
// values from brand/tokens/tokens.json) into 24-bit ANSI.
// Token names and hex values are taken verbatim from that design doc.

const COLOR = process.stdout.isTTY && process.env.NO_COLOR == null;

// Design tokens (name → hex), straight from the design system.
import { TOKEN, STAGE, THEME, stageForTool } from "./design-tokens.mjs";
export { TOKEN, stageForTool };

// Text colors follow the terminal background: dark unless BITCODE_THEME=light or
// COLORFGBG reports a light background (rxvt/Konsole convention "fg;bg", bg 7 or 15).
export function terminalScheme(env = process.env) {
  const forced = String(env.BITCODE_THEME || "").toLowerCase();
  if (forced === "light" || forced === "dark") return forced;
  const bg = String(env.COLORFGBG || "").split(";").pop();
  return bg === "7" || bg === "15" ? "light" : "dark";
}
const SCHEME = THEME[terminalScheme()];

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, n >> 8 & 255, n & 255];
}

function relLuminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// Foreground in a hex color.
export function fg(hex, s) {
  if (!COLOR) return s;
  const [r, g, b] = hexToRgb(hex);
  return `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`;
}

export function bold(s) {
  return COLOR ? `\x1b[1m${s}\x1b[0m` : s;
}

// A filled pill: hex background with auto-contrasting text, echoing the
// rounded uppercase chips in the design.
export function pill(hex, label) {
  const text = label.toUpperCase();
  if (!COLOR) return `[${text}]`;
  const [r, g, b] = hexToRgb(hex);
  const [tr, tg, tb] = hexToRgb(relLuminance(hex) < 0.6 ? TOKEN.onPrimary : TOKEN.ink);
  return `\x1b[48;2;${r};${g};${b}m\x1b[38;2;${tr};${tg};${tb}m\x1b[1m ${text} \x1b[0m`;
}

// Brand-named convenience foregrounds.
export const accent = (s) => fg(TOKEN.bitcoinOrange, s);
export const ink = (s) => fg(SCHEME.ink, s);
export const body = (s) => fg(SCHEME.text, s);
export const muted = (s) => fg(SCHEME.body, s);
export const faint = (s) => fg(SCHEME.muted, s);
export const ok = (s) => fg(SCHEME.up, s);
export const danger = (s) => fg(SCHEME.down, s);

// Uppercase, spaced section label (the design's "REASONING" / "CAPABILITIES").
export function label(text) {
  return faint(text.toUpperCase().split("").join(" "));
}

// The five-stage legend, shown once at startup.
export function stageLegend() {
  const seq = [
    [STAGE.pending, "thinking"],
    [STAGE.relayed, "running"],
    [STAGE.mempool, "reading"],
    [STAGE.confirming, "drafting"],
    [STAGE.confirmed, "done"],
  ];
  return seq.map(([hex, name]) => fg(hex, "●") + " " + faint(name)).join(faint("  →  "));
}

export const BOLT = "⚡";

// Network badge: mainnet is highlighted in Bitcoin orange (real funds);
// test networks are calm green.
function networkBadge(network) {
  if (!network) return "";
  const colored = network === "mainnet" ? accent(network) : ok(network);
  return faint("· ") + colored + "  ";
}

// One-line wordmark: ⚡ bitcode  agent · <model> · <network>   ● ready
export function wordmark(modelSpec, network) {
  return (
    accent(BOLT) +
    " " +
    bold("bitcode") +
    "  " +
    faint("agent · ") +
    body(modelSpec) +
    "  " +
    networkBadge(network) +
    ok("●") +
    " " +
    faint("ready")
  );
}
