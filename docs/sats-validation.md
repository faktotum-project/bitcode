# Sats implementation and validation record

Validated on 2026-10-03, Linux, Node 22.22.1 / 24.18.0 and Chromium, with Playwright 1.62.1
and sharp 0.35.4. All provider traffic used deterministic loopback fixtures;
no paid model calls, real-node mutations, signatures or payments were made.

## Plan review and implementation decisions

The supplied plan was written against `e79a7073d8fb7533928ecb7ebb6d2ef2c0b6f5da`.
This workspace starts at `06158fd4ee6acd64c89e81d8892e96e9225c46c9`, version 0.2.0,
with additional uncommitted financial changes. Those existing changes were
preserved. Sats were adapted to the current runtime rather than replacing it
with the older loop in the intermediate worktree.

The current runtime already has schema validation, parallel read batches,
mutation barriers, cancellation, provider fallbacks, checkpointing and a shared
delegation budget. These mechanisms remain active. The implementation adds the
four bundled personas/policies, the shared manual/autonomous runner, typed
outcomes, a bounded event/state projection, `--sats`, and the authenticated local
observer. It also fixes pending approval input after interruption and closes
readline on `/exit`, which previously kept pipe-driven CLI processes alive.
`--no-session` supplies the plan's transcript-free verification mode.

An existing Sats worktree was found in `/tmp`, containing a prior implementation
and complete character assets, but also unresolved merges with the newer CLI.
Only the relevant personas/assets/supporting modules were reused and adapted.
The browser control feature from that worktree was deliberately excluded:
P7 remains a separate release as specified. No controller module, composer,
approval buttons or control API routes are shipped.

## Observed checks

| Check | Observed result |
| --- | --- |
| `npm run check` | 101 JavaScript files pass syntax checks; 145 tests pass, 0 fail |
| Node 22 compatibility suite | 145 tests pass, 0 fail |
| `npm run test:browser` | 13 grouped full-flow/browser/asset checks pass |
| Browser requests/errors | 0 external requests; 0 unexpected page/console errors |
| Layout | 360, 768, 1180 and 590 CSS pixels; no horizontal overflow; controls ≥44px |
| CLI lifecycle | Manual/autonomous delegation, allowlists, approve/deny, provider failure, limit, SIGINT, resume/reset, NO_COLOR, no-session and clean exit |
| HTTP | Loopback attach/cookie, Host/Origin/JSON boundaries, private bootstrap, SSE/replay/snapshot, heartbeat, client limit and symlink/traversal rejection |
| npm archive smoke | Passed from a foreign directory; four personas and all runtime UI/assets/fonts load; 54 Sats asset/report files included |
| Runtime dependencies | No new production dependencies |
| Asset decode | 24 alpha WebP poses, 24 alpha 1024px masters and all four 48-frame GIFs decode |
| Asset size | Initial four idle WebP: 165,650 bytes; all runtime WebP: 977,926 bytes |
| `git diff --check` | Clean |

The npm smoke extracts the real archive and uses the existing installed
dependencies. It does not perform an independent registry installation or run
optional wallet postinstall builds. Its archive measured about 13.34 MB, including
the existing package contents; sources/masters/GIFs/brand images and local plan
materials are excluded. Persona, registry and static asset paths are package-relative.

| Working GIF | Bytes | Format |
| --- | ---: | --- |
| Node | 1,290,111 | 512×512, 48 frames, 3000ms |
| Script | 1,712,317 | 512×512, 48 frames, 3000ms |
| Hash | 1,790,167 | 512×512, 48 frames, 3000ms |
| Merkle | 1,212,281 | 512×512, 48 frames, 3000ms |

Each runtime WebP is ≤100 KiB; initial idle total is ≤400 KiB; all poses are
≤2 MiB; every GIF is ≤2 MiB. PNG fallbacks/fonts are additional bytes. Non-idle
masters are resampled from 512px atlas cells, as documented in the asset report.

## Acceptance evidence

| Plan IDs | Evidence |
| --- | --- |
| A01–A03 | Bundled order, user override preserving policy, custom persona, explicit unknown-name error; actual CLI listing from foreign cwd |
| A04–A05 | Exact schema filtering and forced unavailable calls; invoice creation blocked even with non-mutating adapter label |
| A06–A08 | Manual and tool-driven delegates share the runner/gate; no nested recursion; child fresh history; only the selected card updates |
| A09–A10 | Recoverable tool failure records a warning; provider failure and 50-step exhaustion emit exactly one non-success finish |
| A11 | Throwing/rejecting observers remain isolated; approval callback failure denies; primary async hooks remain awaited |
| A12–A13 | Actual SSE live/replay/out-of-buffer snapshot; historical success does not celebrate on reload; unauthorized APIs, origins, traversal and symlinks refused |
| A14 | No raw prompt/output/commands/keys in snapshots; hostile filename renders as literal text, not an image element |
| A15 | Browser/subscriber/server closure leaves execution independent; event/run/activity buffers and client count bounded; slow SSE writes have a 64 KiB disconnect guard |
| A16–A17 | Actual CLI subprocesses with/without observer, pipe/NO_COLOR, no-session, resume/reset; existing `/plan`/`/build`, session and cancellation regression tests pass |
| A18 | Real reduced-motion and offscreen checks; visibility-change handler tested with a hidden-state fixture; browser-local motion switch |
| A19–A20 | Chromium screenshots at three requested widths plus 590px zoom-equivalent; keyboard focus/selection, ≥44px controls; poses inspected on cream/Ink and at small sizes |
| A21–A22 | Actual npm extraction and foreign-cwd smoke; all UI requests constrained to loopback, local fonts, images and manifest load without external services |

Screenshots and the machine-readable browser report are generated under
`artifacts/sats/`. A checked-in overview is [sats-preview.png](sats-preview.png);
the visual pose review is [sats-poses.png](sats-poses.png).

The CI workflow retains the Node 22/24 Linux matrix and adds Chromium, asset and
archive checks. A configured workflow is not evidence of a completed remote run.
Native Windows/macOS, Firefox/Safari, screen-reader speech, native browser zoom,
native background-tab lifecycle and live paid/provider/node integrations have
not been certified here. The zoom check uses equivalent CSS viewport geometry;
the visibility check exercises the handler rather than a native background tab.
Slow-client protection is code-inspected and client limits are integration-tested;
a sustained OS-level slow-reader stress test was not performed.

The observer is local; configured model providers still receive their normal
prompts/tool results. Cancellation does not roll back completed changes and does
not guarantee termination of detached shell descendants. “Completato” describes
the agent loop's completion, not proof that code is correct or secure.
