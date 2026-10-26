# Changelog

## Desktop 0.3.0 — 2026-10-26

### Desktop

- English is the default language for new installs; Italian stays available
  in Settings. Tray, dialogs and notifications follow the app language; the
  fix prompt, the phone (LAN) page and the `/sats` observer are in English.
  The CLI follows: English unless `BITCODE_LANG=it` or the saved `lang`
  setting (`/settings` → Language).
- The sidebar leads with chats; Stats, Archive, Issues, Remote access,
  Scheduled tasks and Integrations fold under **More**.
- One labeled **Panel** toggle replaces seven glyph buttons; timeline, keep
  and export move to the chat's **…** menu; clicking a Sat in the top bar
  lets you use it in the chat or read about it.
- Composer: a **+** menu (attachments, goal, dictation, model comparison), a
  **Build / Plan** toggle (`Shift+Tab`) in the terminal's mode colors, and
  agent and permission chips instead of drop-downs.
- Tool calls carry the dot of the Sat whose role they serve, with short
  names (read, edit, shell…).
- A first-run checklist covers model, project folder and sandbox.
- The worker runs the CLI's file tools (`read_file` ranges, `edit_file`
  with `edits[]`, `grep`, `glob`) behind the same desktop boundary: checked
  paths, denied paths filtered from search results, writes through the
  controller's lease and approval. `bash` stays sandbox-specific.
- The renderer is split into one module per area; no behavior change.


### CLI

- Full-screen terminal interface: home screen, conversation with Markdown,
  prompt fixed at the bottom with multi-line editing, status bar and a sidebar
  with Sats, context, plan, modified files and MCP servers. `BITCODE_UI=line`
  keeps the line REPL, which pipes and colorless terminals still use.
- Every tool call carries the dot of the Sat whose role it serves (Node,
  Script, Hash, Merkle); consecutive reads collapse to one line and edits show
  a colored diff.
- `Tab` switches BUILD and PLAN; `Esc Esc` interrupts; `Ctrl+P` palette,
  `Ctrl+L` sessions, `Ctrl+B` sidebar, `Ctrl+O` expand; `@` mentions files.
- Approval cards with `y`/`a`/`n`; "always" lasts for the session and never
  applies to payments.
- `/models` picks a provider, then one of the models it reports live;
  `/settings` changes model, profile, permissions, Sat and API keys with the
  arrow keys.
- Copy by dragging, paste with `Ctrl+V`, a right-click Copy/Paste menu, and
  pasted API keys masked as dots.
- `/help` grouped by task; `/status`, `/skills`, `/mcp`, `/commands` and
  `/sat info` print readable text instead of JSON.
- Terminal colors follow a dark background unless `BITCODE_THEME=light` or
  `COLORFGBG` says otherwise.
- MCP stdio server logs go through bitcode instead of writing over the screen.

### Runtime

- Token usage is published on the event bus (`model.usage`).
- Run states from the runtime reducer resolve to the same Sat visual states.

### Brand

- One brand source in `brand/`: tokens generate the site, desktop, `/sats` and
  CLI colors; official logo files, design system page, Sats profiles and the
  social kit. The pixel "b" replaces the lightning bolt in `/sats` and in the
  demo videos.
- The name is always lowercase: **bitcode**. The desktop product name follows,
  so new `.deb` installs go to `/opt/bitcode` instead of `/opt/Bitcode`;
  `bitcode desktop` still finds an existing 0.2 install.
- Site: `favicon.ico`, touch icon, 192/512 px icons and a web manifest.

### Repository

- Runtime Markdown moved to `content/` (agents, commands, Sats); the website
  lives in `site/` and Vercel serves `site/public/`; completed plans are in
  `docs/archive/`.

## CLI 0.3.0 · Desktop 0.2.0 — 2026-10-19

### Desktop (Linux)

- The `.deb` installs the terminal CLI as `/usr/bin/bitcode`, running on the
  Node.js runtime bundled with the app; an existing `/usr/bin/bitcode` from
  another installation is left untouched.
- Package scripts remove links and the AppArmor profile only on a real
  removal, not on upgrade, and refresh the hicolor icon cache.
- Icons for every hicolor size from 16 to 512 px; desktop entry with
  `StartupNotify` and search keywords.
- Start at login (XDG autostart) from Settings → System, starting hidden in
  the tray (`--hidden`).
- Window size, position and maximized state are restored when still on a
  display.
- A crashed window reloads by itself twice in a row, then asks before trying
  again.
- System suspension is blocked only while an agent run is active.
- Tray: a click shows or hides the window; pending requests are listed and
  open the Activity view (approval always happens in the window).
- Clicking a notification opens the related chat or the Activity view.
- `SIGTERM`, `SIGINT` and `SIGHUP` stop workers and terminals before exit.

### CLI

- `bitcode desktop` opens the installed desktop app.
- Full-auto checks that Bubblewrap can actually create its namespaces instead
  of only finding the binary; `bitcode doctor` reports the result, with a hint
  when AppArmor restricts unprivileged user namespaces.
