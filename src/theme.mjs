// Terminal theme — a faithful translation of the bitcode design system
// ("bitcode design system/Bitcoin Design System.dc.html") into 24-bit ANSI.
// Token names and hex values are taken verbatim from that design doc.

const COLOR = process.stdout.isTTY && process.env.NO_COLOR == null;

// Design tokens (name → hex), straight from the design system.
export const TOKEN = {
  bitcoinOrange: "#f7931a",
  orangeActive: "#d97b0f",
  canvas: "#f7f7f4",
  canvasSoft: "#fafaf7",
  surfaceStrong: "#e6e5e0",
  hairlineStrong: "#cfcdc4",
  onPrimary: "#ffffff",
  ink: "#26251e",
  body: "#5a5852",
  muted: "#807d72",
  mutedSoft: "#a09c92",
  success: "#1f8a65",
  error: "#cf2d56",
};

// Bitcoin tx-lifecycle palette, reused by the landing page as the agent's
// five-stage "Reasoning" timeline.
const STAGE = {
  pending: "#dfa88f", // intent / thinking
  relayed: "#9fc9a2", // running a command
  mempool: "#9fbbe0", // reading state
  confirming: "#c0a8dd", // drafting / mutating
  confirmed: "#c08532", // done
};

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

// Map an agent tool to its reasoning stage (color + name), echoing the
// design system's tx-lifecycle palette.
export function stageForTool(name) {
  // chain queries → "querying" (relayed/green)
  if (name === "bash" || name === "btc_tx" || name === "btc_address" || name === "btc_block" || name === "bitcoin_rpc") {
    return { hex: STAGE.relayed, name: name === "bash" ? "running" : "querying" };
  }
  // state reads → "reading" (mempool/blue)
  if (name === "read_file" || name === "list_dir" || name === "btc_fees" || name === "btc_mempool" || name === "wallet_info" || name === "wallet_new_address" || name === "wallet_descriptor") {
    return { hex: STAGE.mempool, name: "reading" };
  }
  // mutations / signing → "drafting" (confirming/purple)
  if (name === "write_file" || name === "edit_file" || name === "wallet_create" || name === "wallet_send" || name === "btc_broadcast") {
    return { hex: STAGE.confirming, name: "drafting" };
  }
  return { hex: STAGE.pending, name: "thinking" };
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

const BOLT = "⚡";

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
