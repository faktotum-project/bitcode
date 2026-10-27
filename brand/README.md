# bitcode brand

One source of truth for the bitcode identity on every surface: website, desktop app, CLI, GitHub, npm.

Everything derived is generated (`npm run build:brand`, `npm run check:brand`, the latter is part of `npm run check`). Edit `tokens/tokens.json`, then run `node brand/build.mjs` (CI: `--check`).

## Where tokens land
| Surface | File (block between `brand:begin` and `brand:end`) | Names |
|---|---|---|
| Website (dark) | `site/public/assets/site/base.css`, `site/src/design-contract.json`, from the `web` block of `tokens.json` | `--orange`, `--canvas`, `--ink`, `--body` |
| Desktop app | `desktop/ui/styles.css` (dark, light, system) | `--accent`, `--body` (reading text), `--mutedStrong` (secondary), `--sat-*` |
| /sats web UI | `ui/sats/styles.css` | camelCase, light only |
| CLI and Node code | `src/design-tokens.mjs` (`TOKEN`, `STAGE`, `SAT`, `BRAND`, `THEME`) | `bitcoinOrange`, `ink`, `body`; `THEME.light/dark` mirror `tokens.json` |
| Desktop (no CSS) | via `THEME`/`BRAND`: window background, xterm theme, LAN phone page, app icon (`desktop/build.mjs`) | |
| Site icons | `site/public/`: `favicon.ico`, `apple-touch-icon.png`, `icon-192/512.png` (`site/scripts/render-icons.mjs`), `site.webmanifest` (`build.mjs`) | |
| Images and video | site OG (`site/scripts/render-og.mjs`, composition in `site/scripts/share-card.mjs`); demo videos (`site/scripts/demos/`) read `logo/` and the tokens | |

Names differ per surface for historical reasons; values come from one place. Secondary text on dark is `#929aa5`.

## Layout
| Path | What |
|---|---|
| `design-system.html` | The design system as one page: logo, Sats, color, type, spacing, components, rules. Light and dark, copy-on-click. Adapted from the original Bitcoin Design System document. Open it directly in a browser. |
| `tokens/tokens.json` | Colors (light and dark), tx states, Sat colors, fonts, radius. Source. |
| `tokens/tokens.css` | Generated CSS variables, both themes. |
| `logo/` | Mark (pixel "b"), wordmark (pixel b + "bitcode" in Inter 600, the original site lockup), terminal lockup, on-dark and mono variants, ASCII. Type is outlined in `glyphs.json`, so no SVG needs a font. |
| `tools/` | `outline-glyphs.py` regenerates `logo/glyphs.json`; only needed if typeface or weight changes. |
| `mascots/` | Sats: framework, profiles. See `mascots/framework.md`. |
| `logo/masters/` | Original 2000 px raster masters of the mark (orange and ink variants). |
| `mockups/` | Static desktop app mockups. |

## Identity
- Name: **bitcode**, always lowercase, one word. The org is FAKTOTUM.
- Tagline: *Not your code, not your Sats.* The same words in every language, after *not your keys, not your coins*: an agent you cannot run, read and stop yourself is not working for you.
- The mark is a 4x5 pixel "b": orange body, dark base. Never smooth it, rotate it, add effects or change its proportions.
- Clear space: one mark pixel on every side. Minimum size: 16 px (mark), 80 px wide (wordmark).
- Wordmark is the primary lockup. The terminal lockup is secondary: terminals, READMEs, badges, never as avatar or header.

## Logo files
| Use | File |
|---|---|
| Light background | `mark.svg`, `wordmark.svg` |
| Light background, restrained (dark body, orange base) | `mark-ink.svg` |
| Dark background | `mark-on-dark.svg`, `wordmark-on-dark.svg` (orange body, base in the dark theme's ink, white) |
| One color (print, stamps, watermarks) | `*-mono-black.svg`, `*-mono-white.svg` |
| Terminal and README header | `terminal*.svg` (`bitcode_` in JetBrains Mono, orange block cursor) |
| Plain text | `ascii.txt` |

## Color
Orange `#F7931A` is the only brand accent. Use it for the mark, the primary action and one highlight per screen. Everything else is neutral. `up` and `down` are reserved for price and diff semantics, never decoration. Transaction states (pending, relayed, mempool, confirming, confirmed) have fixed colors in every product. Two themes share the same token names, only values change.

## Type
Inter for text, JetBrains Mono for code, numbers and labels. Both are bundled (OFL). Headlines sentence case, tight tracking (-0.03 to -0.045 em).

## Voice
Plain, concrete, short sentences. No hype, no price talk, no emoji in product UI. Italian and English are equal: never machine-translate, rewrite.

## Sats
Secondary to the logo. Follow `mascots/framework.md` (Yuru-chara rules, modules, guardrails).

## Don'ts
No gradients on the mark. No third accent color. No Sat over the logo. No new asset outside `brand/` without a token or generator behind it.
