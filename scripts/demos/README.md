# bitcode CLI walkthroughs

The current gallery contains exactly three scenarios: `installation`,
`configuration`, and `features`. The hero reuses `features`. Commands type into
an xterm terminal; output, colors, prompts and command menus come from the actual
bitcode CLI running in a PTY. This replaces the earlier static event cards.

```bash
node scripts/demos/record-cli.mjs /tmp/bitcode-cli-recordings
node scripts/demos/render-cli.mjs /tmp/bitcode-cli-recordings
node scripts/demos/publish.mjs
```

Capture needs Python 3 (POSIX PTY), Node.js 22+, npm and the local Ollama tag
`qwen3.8:27b`. It installs the working-tree snapshot in a temporary directory.
Only the feature scenario contacts the model and public mainnet fee endpoint.
Append `features` to the capture command to retry only that scenario.

Rendering needs FFmpeg, ffprobe, Playwright, `@xterm/xterm`, `@xterm/headless`
and JetBrains Mono regular/semibold TTFs in an external tooling directory.
`BITCODE_VIDEO_TOOLS` defaults to `/tmp/bitcode-video-tools`; its `node_modules`
contains those packages and its font files are `JetBrainsMono.ttf` and
`JetBrainsMono-SemiBold.ttf`. `BITCODE_CHROMIUM` optionally selects an installed
Chromium executable. Rendering also accepts a single scenario as its last arg.
No rendering packages are added to bitcode's runtime dependencies.

The renderer decodes ANSI at the original 92-column capture width before
recomposing cells for each export. This preserves terminal state through menu
redraws while wrapping content for the portrait viewport. Commands are animated,
waits shortened, and output progressively revealed. H.264 exports are 30 fps;
presentation is sampled at 15 fps. Both variants have burned-in instructional
captions, with WebVTT and a textual transcript for the web player.

Provenance is explicit: clone/cd are instructional command animations; install
and diagnostic output are real; login uses a fake example key and makes no API
request; the feature demo uses a real local model and a recorded mainnet snapshot.
Home paths are normalized. Login does not validate provider access.
Raw PTY captures stay outside the static site. `publish.mjs` only integrates the
three complete media sets into local HTML and does not deploy anything.

The approved captures are also retained locally under
`.demo-archive/2026-09-11-cli/captures/` (ignored by Git and excluded from the
deployment). To regenerate the same sessions without calling any model:

```bash
node scripts/demos/render-cli.mjs .demo-archive/2026-09-11-cli/captures
node scripts/demos/publish.mjs
node scripts/demos/verify-cli.mjs
```

`verify-cli.mjs` checks media metadata and full decoding, responsive layouts,
playback, single-player behavior, captions, downloads, keyboard menu dismissal,
reduced motion, 200% text, no-JavaScript access and video-load errors.
The feature command includes `Reply in at most 50 words. No tables.` as a visible
argument, after an earlier verbose response hit the local model's output limit.

## Previous event-card pipeline

The following describes the earlier `code-review`, `bitcoin-fees`, and
`mcp-skills` recordings. Their recorder and renderer are retained for reference;
the current publisher requires the new three-scenario manifest (version 2).

These scripts run the production `runAgent`, built-in tools and MCP client against
a disposable fixture and a real model. The MP4s are editorial replays of captured
agent events, not terminal screen recordings. They shorten waits and show selected
excerpts; complete tool output is retained in the public transcripts.

The code fixture has an intentional rounding bug. Its test is expected to fail
before the agent repairs the disposable copy. It is not part of the main test suite.
The MCP demo uses a real local stdio server restricted to `RELEASE.md` in that copy.
Bitcoin tools read public mainnet data and cannot move funds in this recording setup.

## Capture

Requires Node.js 22+, the project dependencies, and a working configured provider.
The initial recordings used the installed Ollama tag `qwen3.8:27b`. This tag is not
an assertion that the deployment is Qwen3.8-Flash-Next.

```bash
node scripts/demos/record.mjs /tmp/bitcode-demo-recordings ollama/qwen3.8:27b
```

Run a single scenario by appending `code-review`, `bitcoin-fees` or `mcp-skills`.
Use individual scenarios on environments that limit command execution duration.
For example, after configuring the corresponding provider:

```bash
node scripts/demos/record.mjs /tmp/astra-demo openai/gpt-6-astra mcp-skills
```

Each run creates its own temporary fixture and isolated bitcode state. Raw JSON
captures and incremental `.partial.json` files stay outside the public site.
Only completed captures can be rendered. A completed loop still requires human
review of the evidence; it is not proof of correctness by itself.

## Render and integrate

Requires FFmpeg, ffprobe and Playwright with Chromium. Use an existing Playwright
installation via `BITCODE_PLAYWRIGHT_MODULE`, or install it in a separate tooling
environment. The renderer loads the same Google Fonts used by the site.

```bash
node scripts/demos/render.mjs /tmp/bitcode-demo-recordings
node scripts/demos/publish.mjs
```

The renderer emits 1920×1080 and 1080×1920 H.264 MP4s at 30 fps, posters, English
WebVTT, transcripts and a manifest under `assets/demos`. Vertical scenes are
recomposed, rather than cropped from the horizontal export. Captions are burned
into both variants; WebVTT also exposes the narration to accessible video players.
The publisher requires all three complete sets before updating `index.html`.
Its name refers to local HTML integration: it does not deploy or upload anything.

Before delivery, inspect representative frames, check all MP4s with ffprobe and
full FFmpeg decoding, and test the page's players, captions and downloads in a browser.
