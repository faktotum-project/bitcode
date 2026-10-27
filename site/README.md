# bitcode site — EN/IT and motion

The public pages are committed static HTML: `/` in English and `/it/` in Italian. Vercel still serves the repository with `framework: null`, no install command and no build command. No framework, animation library or client dependency was added.

## Editing and generation

Use Node.js 22 or later. Edit `site/index.template.html`, `i18n/en.json`, `i18n/it.json` and the shared files in `assets/site/`; regenerate with:

```sh
npm run build:site
npm run test:site
python3 -m http.server 4173 --bind 127.0.0.1
```

The generator has no dependencies. Commit both generated HTML files, sitemap and robots with their source changes. The 358 catalog keys must match exactly; missing keys, extra keys and non-string values fail generation. Existing `text.NNN` keys are stable identifiers: do not renumber them. `ui.*` keys label interactions; `terminal.*.output` contains original recorded output, including in the Italian catalog.

The page is dark: `base.css` holds the tokens (canvas `#0b0e11`, cards `#14171c`, the Bitcoin orange for actions, the four Sat colours as light accents), taken from the dark theme of the Bitcode Instagram design system and the desktop app, plus layout and components. `motion.css` holds motion tokens, entrances, the Sats scene transitions and the pause rules. Inter and JetBrains Mono are served locally with `font-display: swap`; their SIL Open Font Licenses are included. `site/design-contract.json` records the tokens and every colour literal allowed in the site sources; `npm run test:site` fails when either drifts. Change the contract together with `base.css`.

## Desktop first

The page leads with the desktop app. The hero and the desktop section show silent loops recorded from the real app; `#demo` and the three paired walkthroughs in `#demos` open on the desktop recording, with the original CLI recording behind a Desktop/CLI switch. The switch is one choice for the whole page, kept in `localStorage` as a convenience; without JavaScript both views stay visible, each labelled. The RGB walkthrough (two local RGB Lightning Nodes on Mutinynet, QVAC `bitcode-rgb-4b`, a real 5 USDT test transfer) is shown only when its recording exists (`<!--if:player.rgb-->` in the template); its last caption was rewritten after review to match what the RGB tab shows.

Desktop recordings come from `site/scripts/demos/desktop/` (see its README): the real Electron build driven by Playwright, a disposable home and project, a pointer overlay and a `▶▶ N×` badge wherever waits play faster. `site/public/assets/demos/desktop/manifest.json` records model, date, source commit and provenance of each clip; `npm run build:site` turns it into the players. The hero frame leans a few degrees toward a fine pointer and its light turns from orange to green when the loop reaches the approval; one Sat, a different one on every reload (the last one is remembered in `localStorage`), stands beside it with a line about its role. Every video frame shares that lean (toward the copy beside it, flat on touch screens), and the walkthrough most in view plays muted on its own, one at a time, with captions: it stops when it leaves the viewport, the tab is hidden or the global pause is on, never starts with reduced motion or data saving, and a pause by the viewer holds until they press play. Clips fetch metadata only as they approach. The Sats are four compact cards in one row: same names, roles, descriptions and limits as before, in one screen.

## Motion and accessibility

Sections follow the brief: hero, demonstration, capabilities, Sats, how it works and desktop, installation. Scrolling is native. A single passive scroll listener and a single passive resize listener schedule one RAF; geometry is read before anything is written.

Every load opens with a short intro (about 1.5 s, pure SVG and CSS, decorative and `aria-hidden`): the pixel b assembles from falling, turning pieces coloured through the transaction states, the outlined wordmark drops in behind a pixel mask, and the runtime flies the lockup onto the header logo while the canvas clears. It never runs with reduced motion or the global pause, and without JavaScript it simply fades out. Underneath, the hero shows the title, the "Install bitcode" CTA and the poster immediately. After the `load` event the runtime creates a muted, looping, `aria-hidden` video (WebM, then MP4) for each `[data-loop-video]` figure and fades it in once it is actually playing. It is never created with reduced motion, `Save-Data`, the global pause or a hidden tab, and each loop pauses when it leaves the viewport or the tab is hidden. Without JavaScript, or if the video fails, the poster stays; phones get a 720 px poster through `srcset`. The loops are not demo players: the recorded walkthroughs keep their own players and the selector for them is `.recording-player video`.

Entrances run once per element (`[data-reveal]`): 640 ms, 24 px, nothing hidden without JavaScript, and elements already scrolled past are shown at once. Hovers last 180 ms.

Desktop capabilities use one sticky terminal with 180 ms crossfades. At 1023 px and below, each card has an inline terminal, activated at IntersectionObserver threshold 0.18. Players preserve their position when paused offscreen or by a hidden tab, and each recording plays once. The footer control pauses every animation, the typing players and the loops; OS reduced motion always takes precedence.

Terminal allocations are fixed to prevent typing from shifting the document. Screen readers receive complete static output rather than partial animated text. The mobile navigation locks scroll, contains focus and closes with Escape. Installation tabs support arrows, Home, End and Space. Clipboard success is announced only after the write resolves; failure selects the command for manual copying. The logo context menu supports copy/download of the original SVG; Shift preserves the native menu. Typing `/genesis` opens a dismissible historical message; it is, separate from the recorded CLI output.

## Recording provenance and deliberate limits

See [recordings.json](../assets/site/recordings.json) for timestamps, source commits and transcript paths. Every output line is checked against its original transcript. Commands and original output are preserved in both languages; surrounding labels and explanations are translated.

| Capability | Evidence displayed |
| --- | --- |
| Bitcoin | Original `/btc:fees` excerpt, recorded 2026-09-11 with `ollama/qwen3.8:27b`; explicitly historical, not live estimates. |
| Lightning, Liquid, Cashu, Code | Matching entries from a real `node bitcode.mjs commands --json` run. Clearly labeled **command catalog — command not executed**. |
| RGB | Actual `--profile rgb tools --json` output in a disposable configuration: `[]`, with the missing node stated. |
| Local | Actual read-only Ollama `gpt-oss:20b` inference returning `4` for `2 + 2`; this does not claim a QVAC inference run. |
| Extensions | Actual `node bitcode.mjs mcp` output in a disposable configuration: `[]`, with the absence of configured servers stated. |

No wallet was connected and no financial operation was performed. Full recordings of node/wallet commands are still outside this delivery; the public catalog previews do not claim those operations succeeded. The three existing videos keep their original provenance and now include Italian VTT captions and transcript links.

The optional live-chain ticker is omitted entirely, including its request code. No analytics or third-party requests are made during page viewing; the browser tests assert that. External links are normal links. Browser storage contains only language dismissal, motion preference, intro-seen and genesis state. There is no automatic language redirect.

## Verification — 2026-10-24 (desktop first)

Checks ran on localhost using Chromium and Lighthouse 13.4.1. Scores describe the local static server, not a production deployment.

| Page | Device | Performance | Accessibility | Best Practices | SEO | CLS | LCP |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| EN `/` | Mobile | 94 | 100 | 100 | 100 | 0 | 2.93 s |
| EN `/` | Desktop | 99 | 100 | 100 | 100 | 0 | 0.79 s |
| IT `/it/` | Mobile | 93 | 100 | 100 | 100 | 0 | 3.08 s |
| IT `/it/` | Desktop | 99 | 100 | 100 | 100 | 0 | 0.79 s |

Mobile performance varied between 91 and 96 over repeated runs of the same build (simulated LCP 2.55–3.1 s, the hero poster), so the runner's 95 threshold is not met on every run. Both fonts are preloaded: without the JetBrains Mono preload the hero could shift by 0.13 when the font arrived.

[Score summary](../artifacts/site/lighthouse-summary.json). The [browser results](../artifacts/site/browser-results.json) cover both languages at 320/390/800/1023/1024/1440/1920/2560 px; anchors; the capability rail; the four Sats cards in one row and in one screen; the Desktop/CLI switch driving every paired recording and surviving a reload; keyboard tabs and clipboard; mobile focus and scroll locking; language hash preservation; the hero and workspace loops (poster first, playback after load, pause off screen, in a hidden tab and on the global pause, no video with reduced motion, Save-Data or an initially hidden tab); entrances; load CLS 0; separate demo players; blocked storage; no JavaScript (both recording views visible); zero page errors and zero external requests. The axe WCAG A/AA scan of `/` and `/it/#sats` has [zero violations](../artifacts/site/accessibility.json).

Screenshots: [EN hero](../artifacts/site/en-hero-desktop.png), [ultrawide](../artifacts/site/en-hero-ultrawide.png), [IT hero](../artifacts/site/it-hero-desktop.png), [IT mobile](../artifacts/site/it-hero-mobile.png), [Sats](../artifacts/site/en-sats-desktop.png), [Sats on mobile](../artifacts/site/it-sats-mobile.png), [capability rail](../artifacts/site/it-rail-rgb-desktop.png), [mobile navigation](../artifacts/site/it-menu-mobile.png). The OG images (EN and IT) are dark brand cards: wordmark, the two-line tagline with the orange second line, the tech line and the pixel-B specimen, drawn by `site/scripts/render-og.mjs` from the composition in `site/scripts/share-card.mjs`.

The optional browser tools are development-only. Point `SITE_PLAYWRIGHT_MODULE` to an installed Playwright module and `SITE_CHROMIUM` to Chromium; use `SITE_AXE` for a different axe-core path, and `SITE_URL` for a different local server. Run:

```sh
npm run test:site:browser
node scripts/site/render-og.mjs
```

To reproduce the four Lighthouse runs, set `SITE_LIGHTHOUSE_CLI` to an installed `lighthouse/cli/index.js` and `CHROME_PATH` to Chromium, then run `node scripts/site/lighthouse.mjs`. The runner executes audits sequentially and fails if any category is below 95. No test tooling is imported by the website.

References: the requested motion inspiration is [pi.dev](https://pi.dev/), with an independent implementation; lazy video/poster loading follows the [HTML media standard](https://html.spec.whatwg.org/dev/media.html). No pi.dev source, text, branding or assets were reused.
