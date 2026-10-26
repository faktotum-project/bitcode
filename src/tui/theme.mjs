// Color roles for the full-screen UI, derived from the brand tokens
// (brand/tokens/tokens.json via design-tokens.mjs). Components use roles, never hex.
import { BRAND, SAT, THEME } from "../design-tokens.mjs";
import { terminalScheme } from "../theme.mjs";

const mix = (a, b, amount) => {
  const parse = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [parse(a), parse(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * amount).toString(16).padStart(2, "0")).join("");
};

export const SAT_GLYPH = Object.freeze({ node: "●", script: "■", hash: "⬢", merkle: "◆" });
export const SAT_IDS = Object.freeze(["node", "script", "hash", "merkle"]);

export function createTheme(scheme = terminalScheme()) {
  const t = THEME[scheme] || THEME.dark;
  const dark = scheme !== "light";
  return Object.freeze({
    scheme,
    background: t.canvas,
    panel: t.surface,
    element: t.card,
    elevated: t.elevated,
    border: t.hairline,
    borderStrong: t.hairlineStrong,
    text: t.text,
    strong: t.ink,
    muted: t.body,
    faint: t.muted,
    accent: BRAND.accent,
    onAccent: BRAND.onAccent,
    success: t.up,
    error: t.down,
    warning: "#f0b90b",
    info: t.info,
    diffAdd: t.up,
    diffDel: t.down,
    diffAddBg: mix(t.canvas, t.up, dark ? 0.14 : 0.12),
    diffDelBg: mix(t.canvas, t.down, dark ? 0.14 : 0.1),
    modeBuild: BRAND.accent,
    modePlan: SAT.merkle,
    sat: SAT,
  });
}
