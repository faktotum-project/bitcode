# bitcode brand

One source of truth for the bitcode identity on every surface: website, desktop app, CLI, GitHub, npm, LinkedIn, X, Instagram, YouTube.

Everything derived is generated (`npm run build:brand`, `npm run check:brand`, the latter is part of `npm run check`). Edit `tokens/tokens.json`, then run `node brand/build.mjs` (CI: `--check`).

## Where tokens land
| Surface | File (block between `brand:begin` and `brand:end`) | Names |
|---|---|---|
| Website (dark) | `site/public/assets/site/base.css`, `site/src/design-contract.json`, from the `web` block of `tokens.json` | `--orange`, `--canvas`, `--ink`, `--body` |
| Desktop app | `desktop/ui/styles.css` (dark, light, system) | `--accent`, `--body` (reading text), `--mutedStrong` (secondary), `--sat-*` |
| /sats web UI | `ui/sats/styles.css` | camelCase, light only |
| CLI and Node code | `src/design-tokens.mjs` (`TOKEN`, `STAGE`, `SAT`, `BRAND`, `THEME`) | `bitcoinOrange`, `ink`, `body`; `THEME.light/dark` mirror `tokens.json` |
| Desktop (no CSS) | via `THEME`/`BRAND`: window background, xterm theme, LAN phone page, app icon (`desktop/build.mjs`) | |
| Site icons | `site/public/`: `favicon.ico`, `apple-touch-icon.png`, `icon-192/512.png` (`social/build.mjs icons`), `site.webmanifest` (`build.mjs`) | |
| Images and video | site OG (`site/scripts/render-og.mjs`) and the platform kit share `social/design.mjs`; demo and release videos (`site/scripts/demos/`) read `logo/` and the tokens | |

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
| `social/` | `build.mjs` renders every platform asset into `social/export/<platform>/`; `design.mjs` is the one card composition shared with the site OG. |
| `social/releases/` | Release promo videos (rendered by `site/scripts/demos/render-upgrade.mjs`). |
| `logo/masters/` | Original 2000 px raster masters of the mark (orange and ink variants). |
| `mockups/` | Static desktop app mockups. |
| `video/` | Product video pipeline (stage built from the desktop renderer). |

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

## Platform kit
`node brand/social/build.mjs` writes the site icons into `site/public/` (favicon.ico, touch icon, 192, 512) and, into `social/export/`: one avatar (`avatars/`, 400 and 800 for YouTube) used on every profile, LinkedIn (banner 1584x396, post 1200x627), X (header 1500x500, card 1200x675), Instagram (1080 square, 1080x1350, story 1080x1920), GitHub (preview 1280x640), YouTube (banner 2560x1440, thumbnail 1280x720). npm and other app stores use `site/public/icon-512.png`. Avatars show the mark only and are safe for circular crops. Link previews (site OG, LinkedIn post, X card, GitHub preview, YouTube thumbnail) share one composition in `social/design.mjs`: Script, the orange Sat, cheering beside the two-line tagline and the logo, with no other text since titles and descriptions travel with the link. Banners and Instagram use the card composition (wordmark, tagline, tech line, pixel-B specimen) inside each platform's safe area; the LinkedIn and X banners keep their copy clear of the profile photo laid over the lower left. Lockups are EN and IT. The site's OG image is rendered by `site/scripts/render-og.mjs` from that same composition.

## Sats
Secondary to the logo. Follow `mascots/framework.md` (Yuru-chara rules, modules, guardrails).

## Don'ts
No gradients on the mark. No third accent color. No Sat over the logo. No new asset outside `brand/` without a token or generator behind it.
