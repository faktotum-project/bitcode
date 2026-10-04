// Terminal theme — a faithful translation of the design system (design/system)
// ("design/system/Bitcoin Design System.dc.html") into 24-bit ANSI.
// Token names and hex values are taken verbatim from that design doc.

const COLOR = process.stdout.isTTY && process.env.NO_COLOR == null;

// Design tokens (name → hex), straight from the design system.
import { TOKEN, STAGE, stageForTool } from "./design-tokens.mjs";
export { TOKEN, stageForTool };

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
export const ink = (s) => fg(TOKEN.ink, s);
export const body = (s) => fg(TOKEN.body, s);
export const muted = (s) => fg(TOKEN.muted, s);
export const faint = (s) => fg(TOKEN.mutedSoft, s);
export const ok = (s) => fg(TOKEN.success, s);
export const danger = (s) => fg(TOKEN.error, s);

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
