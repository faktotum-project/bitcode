// The full-screen terminal UI: transcript, prompt, footer, Sats sidebar, dialogs and
// approvals on the alternate screen. The CLI drives it through the methods returned by
// createApp(); it never touches the agent loop itself.
import { createScreen } from "./screen.mjs";
import { parseKeys } from "./keys.mjs";
import { seg, wrapLine } from "./text.mjs";
import { stringWidth, truncate, truncateStart } from "./width.mjs";
import { createEditor, edit, layoutEditor, remember, setText } from "./editor.mjs";
import { renderBlock, groupBlocks, needsGap, SPINNER, formatTokens } from "./blocks.mjs";
import { SAT_GLYPH, SAT_IDS } from "./theme.mjs";
import { strings } from "./strings.mjs";
import { fuzzyFiles } from "./files.mjs";
import { satForTool } from "../sats/roles.mjs";
import { satStateLabel, visualState } from "../sat-states.mjs";
import { phrasesFor, PHRASE_MS, fmtElapsed } from "../work-meter.mjs";

const SIDEBAR_WIDTH = 36;
const SIDEBAR_AUTO_COLS = 120;
const MAX_EDITOR_ROWS = 8;
const MAX_MENU_ROWS = 8;
const PROMPT_MAX_WIDTH = 76;
const TICK_MS = 80;
const LOGO = ["█▀█ ", "█▀ █", "▀▀  "];

const satName = (id) => id[0].toUpperCase() + id.slice(1);

export function createApp({
  input = process.stdin, output = process.stdout, theme, lang = "en", caps = {},
  status = () => ({}), commands = [], argChoices = () => [], files = () => [], sessions = () => [],
  history = [], mouse = true,
}) {
  const words = strings(lang);
  const screen = createScreen({ output: { write: (s) => rawWrite(s) }, truecolor: caps.truecolor !== false, color: caps.color !== false });
  const originalStdout = output.write.bind(output);
  const originalStderr = process.stderr.write.bind(process.stderr);
  const rawWrite = (s) => originalStdout(s);

  const state = {
    blocks: [], editor: createEditor(history), mode: "build", busy: null, scroll: 0, sidebar: null, expanded: false,
    dialog: null, approval: null, question: null, inputWaiter: null, toast: null, frame: 0, interruptArmedAt: 0,
    satActivity: {}, activeSat: null, usage: { inputTokens: 0, outputTokens: 0 }, files: new Map(),
    menuIndex: 0, menuDismissed: false, newBelow: false,
  };
  const tools = new Map();
  const renderCache = new WeakMap();
  let running = false, timer = null, scheduled = null, onInterrupt = () => {}, onExitRequest = () => {};
  let fileList = null;

  // ---------- output capture: stray writes become transcript notes instead of tearing the screen
  const capture = (chunk, encoding, callback) => {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    appendNote(text);
    if (typeof encoding === "function") encoding();
    else if (typeof callback === "function") callback();
    return true;
  };
  function appendNote(text) {
    const last = state.blocks.at(-1);
    if (last?.kind === "note" && last.open) { last.text += text; last.v++; }
    else push({ kind: "note", text, open: true });
    const block = state.blocks.at(-1);
    block.text = block.text.replace(/\n{3,}/g, "\n\n");
    if (block.text.endsWith("\n")) { block.text = block.text.replace(/\n+$/, ""); block.open = false; }
    requestRender();
  }

  function push(block) {
    const previous = state.blocks.at(-1);
    if (previous?.kind === "note") previous.open = false;
    block.v = 1;
    state.blocks.push(block);
    if (state.scroll > 0) state.newBelow = true;
    requestRender();
    return block;
  }
  const touch = (block) => { block.v++; requestRender(); };

  // ---------- lifecycle
  function start() {
    if (running) return;
    running = true;
    screen.resize(output.columns || 80, output.rows || 24);
    rawWrite("\x1b[?1049h\x1b[?25l\x1b[?2004h" + (mouse ? "\x1b[?1000h\x1b[?1006h" : ""));
    if (input.isTTY) input.setRawMode(true);
    input.setEncoding("utf8");
    input.on("data", onData);
    input.resume();
    output.on("resize", onResize);
    output.write = capture;
    process.stderr.write = capture;
    process.on("exit", restoreTerminal);
    timer = setInterval(tick, TICK_MS);
    timer.unref?.();
    render();
  }
  function restoreTerminal() {
    originalStdout("\x1b[0m\x1b[?1000l\x1b[?1006l\x1b[?2004l\x1b[?25h\x1b[?1049l");
  }
  function stop() {
    if (!running) return;
    running = false;
    clearInterval(timer);
    clearTimeout(scheduled);
    input.off("data", onData);
    output.off("resize", onResize);
    if (input.isTTY) input.setRawMode(false);
    input.pause();
    output.write = originalStdout;
    process.stderr.write = originalStderr;
    process.removeListener("exit", restoreTerminal);
    restoreTerminal();
  }
  function onResize() {
    screen.resize(output.columns || 80, output.rows || 24);
    render();
  }
  function tick() {
    const animating = state.busy || state.dialog?.loading || [...tools.values()].some((b) => b.status === "running");
    if (state.toast && Date.now() > state.toast.until) { state.toast = null; requestRender(); }
    if (animating) { state.frame++; requestRender(); }
  }
  function requestRender() {
    if (!running || scheduled) return;
    scheduled = setTimeout(() => { scheduled = null; render(); }, 16);
  }

  // ---------- completion
  function menuItems() {
    if (state.menuDismissed || state.question || state.approval) return null;
    const text = state.editor.text;
    const slash = /^\/(\S*)$/.exec(text);
    if (slash) {
      const q = slash[1].toLowerCase();
      const rows = commands.filter((c) => c.name.toLowerCase().startsWith(q))
        .concat(q ? commands.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q)) : []);
      return rows.length ? rows.map((c) => ({ label: "/" + c.name, hint: c.hint, group: c.group, insert: c.args && !c.optional ? `/${c.name} ` : `/${c.name}`, submit: !c.args || c.optional, completeWith: c.args ? `/${c.name} ` : `/${c.name}` })) : null;
    }
    const arg = /^\/(\S+) (\S*)$/.exec(text);
    if (arg) {
      const choices = argChoices(arg[1]) || [];
      const rows = choices.filter((c) => c.value.toLowerCase().startsWith(arg[2].toLowerCase()));
      return rows.length ? rows.map((c) => ({ label: c.value, hint: c.hint, insert: `/${arg[1]} ${c.value}`, submit: true })) : null;
    }
    const mention = /(?:^|\s)@(\S*)$/.exec(text.slice(0, state.editor.cursor));
    if (mention) {
      fileList ??= files();
      const rows = fuzzyFiles(fileList, mention[1]);
      const head = text.slice(0, state.editor.cursor - mention[1].length);
      return rows.length ? rows.map((f) => ({ label: "@" + f, hint: "", insert: head + f + " " + text.slice(state.editor.cursor), submit: false, keepCursor: (head + f + " ").length })) : null;
    }
    return null;
  }
  function acceptMenu(item) {
    setText(state.editor, item.insert);
    if (item.keepCursor != null) state.editor.cursor = item.keepCursor;
    state.menuIndex = 0;
    if (item.submit) return submit();
    requestRender();
  }

  // ---------- input handling
  function onData(data) {
    for (const key of parseKeys(data)) handleKey(key);
  }

  function handleKey(key) {
    if (key.name === "mouse") return handleMouse(key);
    if (state.dialog) return dialogKey(key);
    if (state.approval) return approvalKey(key);
    if (key.name === "ctrl-c") return ctrlC();
    if (key.name === "ctrl-d" && !state.editor.text && !state.question) return finishInput(null);
    if (key.name === "escape" && state.busy && !state.question) return escapeInterrupt();
    if (key.name === "pageup") return scrollBy(Math.floor((screen.rows - 8) / 2));
    if (key.name === "pagedown") return scrollBy(-Math.floor((screen.rows - 8) / 2));
    if (key.name === "ctrl-b") { state.sidebar = !sidebarVisible(); return render(); }
    if (key.name === "ctrl-o") { state.expanded = !state.expanded; return render(); }
    if (key.name === "ctrl-p" && !state.question) return openPalette();
    if (key.name === "ctrl-l" && !state.question) return openSessions();

    const items = menuItems();
    if (items) {
      if (key.name === "up" || key.name === "down") {
        state.menuIndex = (state.menuIndex + (key.name === "up" ? -1 : 1) + items.length) % items.length;
        return render();
      }
      if (key.name === "tab") { const item = items[state.menuIndex]; return acceptMenu({ ...item, insert: item.completeWith || item.insert, submit: false }); }
      if (key.name === "enter" && !key.alt && !key.shift) return acceptMenu(items[state.menuIndex]);
      if (key.name === "escape") { state.menuDismissed = true; return render(); }
    }
    if ((key.name === "tab" || key.name === "backtab") && !state.question) return toggleMode();
    if (key.name === "enter") {
      if (key.alt || key.shift) return editorKey({ name: "newline" });
      if (state.editor.text.endsWith("\\") && !state.question) { state.editor.text = state.editor.text.slice(0, -1); state.editor.cursor = state.editor.text.length; return editorKey({ name: "newline" }); }
      return submit();
    }
    if (key.name === "ctrl-j") return editorKey({ name: "newline" });
    if (key.name === "escape") return;
    editorKey(key);
  }

  function editorKey(key) {
    if (edit(state.editor, key)) {
      state.menuDismissed = false;
      if (["text", "paste", "backspace", "delete", "ctrl-u", "ctrl-k", "ctrl-w", "newline"].includes(key.name)) state.menuIndex = 0;
      render();
    }
  }

  function handleMouse(key) {
    if (!key.press) return;
    if (key.button === 64) return state.dialog ? moveDialog(-1) : scrollBy(3);
    if (key.button === 65) return state.dialog ? moveDialog(1) : scrollBy(-3);
  }

  function scrollBy(delta) {
    state.scroll = Math.max(0, state.scroll + delta);
    if (state.scroll === 0) state.newBelow = false;
    render();
  }

  function ctrlC() {
    if (state.question) return answerQuestion("");
    if (state.busy) return onInterrupt();
    if (state.editor.text) { setText(state.editor, ""); return render(); }
    finishInput(null);
  }

  function escapeInterrupt() {
    const now = Date.now();
    if (now - state.interruptArmedAt < 2000) { state.interruptArmedAt = 0; onInterrupt(); }
    else state.interruptArmedAt = now;
    render();
  }

  function toggleMode() {
    state.mode = state.mode === "build" ? "plan" : "build";
    render();
  }

  function submit() {
    if (state.question) return answerQuestion(state.editor.text);
    const text = state.editor.text.trim();
    if (!text) return;
    if (!state.inputWaiter) { toast(words.working + "…", "info"); return; }
    remember(state.editor, text);
    setText(state.editor, "");
    state.scroll = 0;
    state.newBelow = false;
    const line = state.mode === "plan" && !text.startsWith("/") ? `/plan ${text}` : text;
    finishInput(line, text);
  }

  function finishInput(line, typed = line) {
    const waiter = state.inputWaiter;
    if (!waiter) { if (line === null) onExitRequest(); return; }
    state.inputWaiter = null;
    waiter({ line, typed });
    render();
  }

  // ---------- dialogs (palette, sessions, pickers)
  // items may be a promise (e.g. models fetched from a provider): the dialog shows a loading row meanwhile.
  function openDialog({ title, subtitle, items, onPick }) {
    return new Promise((resolve) => {
      const dialog = { title, subtitle, items: Array.isArray(items) ? items : [], loading: !Array.isArray(items), filter: "", index: 0,
        resolve: (item) => { state.dialog = null; render(); resolve(item); onPick?.(item); } };
      state.dialog = dialog;
      if (dialog.loading) Promise.resolve(items).then((list) => {
        dialog.items = list || [];
        dialog.loading = false;
        const current = dialog.items.findIndex((i) => i.current);
        if (current >= 0) dialog.index = current;
        requestRender();
      }, (err) => { dialog.loading = false; dialog.error = err.message; requestRender(); });
      else {
        const current = dialog.items.findIndex((i) => i.current);
        if (current >= 0) dialog.index = current;
      }
      render();
    });
  }
  function dialogRows() {
    const d = state.dialog, q = d.filter.toLowerCase();
    return q ? d.items.filter((i) => `${i.label} ${i.hint || ""}`.toLowerCase().includes(q)) : d.items;
  }
  function moveDialog(delta) {
    const rows = dialogRows();
    if (!rows.length) return;
    state.dialog.index = (state.dialog.index + delta + rows.length) % rows.length;
    render();
  }
  function dialogKey(key) {
    const d = state.dialog;
    if (key.name === "escape" || key.name === "ctrl-c" || (key.name === "ctrl-p" && d.title === words.palette)) return d.resolve(null);
    if (key.name === "up") return moveDialog(-1);
    if (key.name === "down" || key.name === "tab") return moveDialog(1);
    if (key.name === "enter") { const item = dialogRows()[d.index]; return item ? d.resolve(item) : undefined; }
    if (key.name === "left" && !d.filter) return d.resolve(null);
    if (key.name === "backspace") { d.filter = d.filter.slice(0, -1); d.index = 0; return render(); }
    if (key.name === "text" || key.name === "paste") { d.filter += key.text; d.index = 0; return render(); }
  }
  function openPalette() {
    const items = [
      ...commands.map((c) => ({ label: "/" + c.name, hint: c.hint, group: c.group, command: c })),
      { label: "Tab", hint: `${words.mode}: build ⇄ plan`, action: "mode" },
      { label: "Ctrl+B", hint: words.sidebar, action: "sidebar" },
      { label: "Ctrl+O", hint: "expand / collapse tool output", action: "expand" },
    ];
    openDialog({ title: words.palette, items, onPick: (item) => {
      if (!item) return;
      if (item.action === "mode") return toggleMode();
      if (item.action === "sidebar") { state.sidebar = !sidebarVisible(); return render(); }
      if (item.action === "expand") { state.expanded = !state.expanded; return render(); }
      setText(state.editor, item.command.args ? `/${item.command.name} ` : `/${item.command.name}`);
      if (!item.command.args) submit(); else render();
    } });
  }
  function openSessions() {
    const items = sessions();
    if (!items.length) return toast(lang === "it" ? "nessuna sessione salvata" : "no saved sessions", "info");
    openDialog({ title: words.session, items, onPick: (item) => {
      if (!item) return;
      setText(state.editor, `/session load ${item.id}`);
      submit();
    } });
  }

  // ---------- approvals and questions
  function approvalKey(key) {
    const a = state.approval;
    const choice = key.name === "text" ? key.text.toLowerCase() : key.name;
    if (choice === "y") return a.resolve("once");
    if (choice === "a" && !a.financial) return a.resolve("always");
    if (["n", "escape", "ctrl-c"].includes(choice)) return a.resolve("deny");
    if (key.name === "pageup") return scrollBy(5);
    if (key.name === "pagedown") return scrollBy(-5);
  }
  function answerQuestion(value) {
    const q = state.question;
    state.question = null;
    setText(state.editor, q.draft);
    render();
    q.resolve(value);
  }

  // ---------- rendering
  const sidebarVisible = () => state.sidebar ?? screen.cols >= SIDEBAR_AUTO_COLS;

  function blockLines(block, ctx) {
    const running = block.kind === "tool" && block.status === "running";
    const key = `${block.v}|${ctx.width}|${state.expanded}|${running ? state.frame : ""}|${state.mode}`;
    const cached = renderCache.get(block);
    if (cached?.key === key) return cached.lines;
    const lines = renderBlock(block, ctx);
    renderCache.set(block, { key, lines });
    return lines;
  }

  function transcriptLines(width) {
    const ctx = { theme, width, words, frame: state.frame, expanded: state.expanded, modeColor: modeColor() };
    const lines = [];
    let previous = null;
    for (const block of groupBlocks(state.blocks)) {
      const rendered = block.kind === "group" ? renderBlock(block, ctx) : blockLines(block, ctx);
      if (!rendered.length) continue;
      if (needsGap(previous, block)) lines.push([]);
      lines.push(...rendered);
      previous = block;
    }
    return lines;
  }

  const modeColor = () => (state.mode === "plan" ? theme.modePlan : theme.modeBuild);

  function render() {
    if (!running) return;
    const cols = screen.cols, rows = screen.rows;
    screen.begin();
    screen.fill(0, 0, cols, rows, { bg: theme.background });
    const sideW = sidebarVisible() && cols >= 80 && state.blocks.length ? SIDEBAR_WIDTH : 0;
    const mainW = cols - sideW;
    const padX = mainW >= 60 ? 2 : 1;
    const contentW = Math.max(10, mainW - padX * 2);
    const home = !state.blocks.length;

    const promptW = home ? Math.min(contentW, PROMPT_MAX_WIDTH) : contentW;
    const promptX = home ? Math.floor((mainW - promptW) / 2) : padX;
    const panel = state.approval ? approvalPanel(promptW) : promptPanel(promptW);
    const panelH = panel.lines.length;
    const footerY = rows - 1;
    const metaY = footerY - 1;
    let panelY = metaY - panelH;
    if (home) panelY = Math.min(panelY, Math.max(LOGO.length + 6, Math.floor(rows / 2)));

    if (home) drawHome(mainW, panelY);
    else drawTranscript(padX, contentW, panelY - 1);

    drawPanel(promptX, panelY, promptW, panel);
    drawMeta(promptX, home ? panelY + panelH : metaY, promptW);
    drawFooter(mainW);
    if (sideW) drawSidebar(mainW, sideW, rows);
    if (!state.approval && !state.dialog) drawMenu(promptX, panelY, promptW);
    if (state.dialog) drawDialog(cols, rows);
    if (state.toast) drawToast(mainW);
    screen.flush();
  }

  function drawHome(mainW, panelY) {
    const top = Math.max(1, panelY - LOGO.length - 5);
    const logoW = 4;
    const x = Math.floor((mainW - logoW - 9) / 2);
    LOGO.forEach((row, i) => screen.text(x, top + i, row, { fg: theme.accent, bold: true }));
    screen.text(x + logoW + 2, top + 1, "bitcode", { fg: theme.strong, bold: true });
    const tag = words.tagline;
    screen.text(Math.floor((mainW - stringWidth(tag)) / 2), top + LOGO.length + 1, tag, { fg: theme.muted });
    const sats = SAT_IDS.map((id) => [seg(SAT_GLYPH[id], { fg: theme.sat[id] }), seg(` ${satName(id)} `, { fg: theme.text }), seg(words.roles[id], { fg: theme.faint })]);
    const line = sats.flatMap((s, i) => (i ? [seg("   "), ...s] : s));
    const width = line.reduce((w, s) => w + stringWidth(s.text), 0);
    if (width < mainW - 2) screen.line(Math.floor((mainW - width) / 2), top + LOGO.length + 3, line);
  }

  function drawTranscript(padX, width, bottom) {
    const top = 1;
    const height = Math.max(1, bottom - top);
    const lines = transcriptLines(width);
    const maxScroll = Math.max(0, lines.length - height);
    state.scroll = Math.min(state.scroll, maxScroll);
    const end = lines.length - state.scroll;
    const visible = lines.slice(Math.max(0, end - height), end);
    const startY = top + Math.max(0, height - visible.length);
    visible.forEach((line, i) => {
      const y = startY + i;
      if (line.rowBg) screen.fill(padX + (line.rowBgFrom || 0), y, width - (line.rowBgFrom || 0), 1, { bg: line.rowBg });
      screen.line(padX, y, line, padX + width);
    });
    if (state.scroll > 0) {
      const label = state.newBelow ? ` ${words.newMessages} ` : ` ↓ ${state.scroll} `;
      screen.text(padX + width - stringWidth(label), bottom - 1, label, { fg: theme.onAccent, bg: theme.accent });
    }
  }

  function promptPanel(width) {
    const inner = Math.max(4, width - 4);
    const q = state.question;
    const shown = q?.secret ? "•".repeat(Math.min(state.editor.text.length, inner - 1)) : state.editor.text;
    const cursor = q?.secret ? shown.length : state.editor.cursor;
    const layout = layoutEditor(shown, cursor, inner);
    let rowsShown = layout.rows, cursorRow = layout.cursorRow;
    if (rowsShown.length > MAX_EDITOR_ROWS) {
      const start = Math.max(0, Math.min(cursorRow - MAX_EDITOR_ROWS + 1, rowsShown.length - MAX_EDITOR_ROWS));
      rowsShown = rowsShown.slice(start, start + MAX_EDITOR_ROWS);
      cursorRow -= start;
    }
    const lines = [[]];
    if (q) lines.push(...wrapLine([seg(q.prompt.replace(/\x1b\[[0-9;]*m/g, "").trim(), { fg: theme.accent, bold: true })], inner));
    const placeholder = !state.editor.text && !q;
    for (const row of rowsShown) lines.push([seg(row, { fg: theme.strong })]);
    if (placeholder) lines[lines.length - 1] = [seg(state.mode === "plan" ? words.placeholderPlan : words.placeholder, { fg: theme.faint })];
    lines.push([]);
    const cursorLine = 1 + (q ? lines.length - rowsShown.length - 2 : 0) + cursorRow;
    return { lines, bar: q ? theme.accent : modeColor(), cursor: { row: cursorLine, col: layout.cursorCol } };
  }

  function approvalPanel(width) {
    const a = state.approval, inner = Math.max(10, width - 4);
    const sat = a.sat;
    const lines = [[]];
    lines.push([
      seg(sat ? SAT_GLYPH[sat] : "●", { fg: sat ? theme.sat[sat] : theme.accent }), seg(" "),
      seg(sat ? satName(sat) : "bitcode", { bold: true, fg: theme.strong }), seg(` ${words.wantsToUse} `, { fg: theme.muted }),
      seg(a.tool, { bold: true, fg: theme.strong }), seg(`  · ${a.financial ? words.youSign : words.waitingYes}`, { fg: theme.faint }),
    ]);
    if (a.readback) lines.push(...wrapLine([seg(a.readback, { bold: true, fg: theme.text })], inner));
    for (const l of a.detail.slice(0, 14)) lines.push(l.map((s) => ({ ...s, text: truncate(s.text, inner) })));
    if (a.detail.length > 14) lines.push([seg(`… ${a.detail.length - 14} ${words.more}`, { fg: theme.faint })]);
    lines.push([]);
    const key = (k, label, color) => [seg(` ${k} `, { fg: theme.onAccent, bg: color, bold: true }), seg(` ${label}   `, { fg: theme.text })];
    lines.push([...key("y", words.allow, theme.success), ...(a.financial ? [] : key("a", words.always, theme.info)), ...key("n", words.deny, theme.error)]);
    lines.push([]);
    return { lines, bar: a.financial ? theme.accent : theme.warning };
  }

  function drawPanel(x, y, width, panel) {
    screen.fill(x, y, width, panel.lines.length, { bg: theme.panel });
    for (let i = 0; i < panel.lines.length; i++) {
      screen.text(x, y + i, "┃", { fg: panel.bar, bg: theme.panel });
      screen.line(x + 2, y + i, panel.lines[i], x + width - 1, { bg: theme.panel });
    }
    if (panel.cursor && !state.dialog) screen.setCursor(x + 2 + panel.cursor.col, y + panel.cursor.row);
  }

  function drawMeta(x, y, width) {
    const s = status();
    const sat = state.activeSat || s.satId;
    if (state.busy) {
      const elapsed = Date.now() - state.busy.startedAt;
      const phrases = phrasesFor(state.busy.sat || "bitcode", lang);
      const phrase = phrases[Math.floor(elapsed / PHRASE_MS) % phrases.length];
      const color = state.busy.sat ? theme.sat[state.busy.sat] : theme.accent;
      const tokens = state.usage.outputTokens ? ` · ↓${formatTokens(state.usage.outputTokens)}` : "";
      let at = screen.text(x, y, SPINNER[state.frame % SPINNER.length], { fg: color });
      at = screen.text(at + 1, y, phrase + "…", { fg: theme.text });
      screen.text(at + 1, y, `${fmtElapsed(elapsed)}${tokens}`, { fg: theme.faint });
      const armed = Date.now() - state.interruptArmedAt < 2000;
      const hint = armed ? words.interruptAgain : words.interrupt;
      screen.text(x + width - stringWidth(hint), y, hint, { fg: armed ? theme.warning : theme.faint });
      return;
    }
    let at = screen.text(x, y, sat ? SAT_GLYPH[sat] : "●", { fg: sat ? theme.sat[sat] : theme.accent });
    at = screen.text(at + 1, y, sat ? satName(sat) : "bitcode", { fg: theme.text, bold: true });
    at = screen.text(at + 1, y, `· ${s.model || ""}`, { fg: theme.muted }, x + width);
    const hint = state.mode === "plan" ? "tab → build" : "tab → plan";
    if (at + stringWidth(hint) + 2 < x + width) screen.text(x + width - stringWidth(hint), y, hint, { fg: theme.faint });
  }

  function drawFooter(mainW) {
    const s = status(), y = screen.rows - 1;
    const label = state.mode === "plan" ? " PLAN " : " BUILD ";
    let x = screen.text(1, y, label, { fg: theme.onAccent, bg: modeColor(), bold: true });
    const where = s.cwd ? s.cwd.split("/").filter(Boolean).pop() + (s.branch ? `:${s.branch}` : "") : "";
    const facts = [where, s.profile, s.network, s.permission].filter(Boolean).join(" · ");
    const right = `ctrl+p ${words.commands}`;
    x = screen.text(x + 2, y, truncate(facts, Math.max(0, mainW - x - stringWidth(right) - 6)), { fg: theme.faint });
    if (x + stringWidth(right) + 2 < mainW) screen.text(mainW - stringWidth(right) - 1, y, right, { fg: theme.faint });
  }

  function drawSidebar(x0, width, rows) {
    screen.fill(x0, 0, width, rows, { bg: theme.panel });
    const s = status();
    const x = x0 + 2, w = width - 4, maxX = x0 + width - 2;
    let y = 1;
    const heading = (text) => { y++; screen.text(x, y++, text.toUpperCase(), { fg: theme.faint, bold: true }); };
    screen.text(x, y++, truncate(s.sessionName || words.newSession, w), { fg: theme.strong, bold: true });
    if (s.cwd) screen.text(x, y++, truncateStart(s.cwd, w), { fg: theme.faint });
    if (s.branch) screen.text(x, y++, truncate("⎇ " + s.branch, w), { fg: theme.faint });

    heading(words.sats);
    for (const id of SAT_IDS) {
      const activity = state.satActivity[id];
      const working = activity && visualState(activity) !== "idle";
      const glyph = working ? SPINNER[state.frame % SPINNER.length] : SAT_GLYPH[id];
      let at = screen.text(x, y, glyph, { fg: theme.sat[id] });
      at = screen.text(at + 1, y, satName(id).padEnd(7), { fg: working || s.satId === id ? theme.strong : theme.text, bold: s.satId === id });
      const label = working ? satStateLabel(id, activity, lang).label : words.roles[id];
      screen.text(at + 1, y++, truncate(label, maxX - at - 1), { fg: working ? theme.sat[id] : theme.faint });
    }

    heading(words.context);
    const used = state.usage.inputTokens || s.estimatedTokens || 0;
    screen.text(x, y++, `${formatTokens(used)} ${words.tokens}`, { fg: theme.text });
    if (state.usage.outputTokens) screen.text(x, y++, `↓ ${formatTokens(state.usage.outputTokens)} ${lang === "it" ? "generati" : "generated"}`, { fg: theme.faint });

    const steps = s.plan || [];
    if (steps.length && y < rows - 6) {
      heading(words.plan);
      for (const step of steps) {
        if (y >= rows - 4) break;
        const mark = step.status === "completed" ? "☑" : step.status === "in_progress" ? "◐" : "☐";
        const color = step.status === "in_progress" ? theme.warning : step.status === "completed" ? theme.faint : theme.text;
        screen.text(x, y++, truncate(`${mark} ${step.step}`, w), { fg: color, strike: step.status === "completed" });
      }
    }
    if (state.files.size && y < rows - 5) {
      heading(words.files);
      for (const [file, stat] of [...state.files].slice(-8)) {
        if (y >= rows - 3) break;
        const counts = `+${stat.added} -${stat.removed}`;
        screen.text(x, y, truncate(file, w - counts.length - 1), { fg: theme.text });
        const cx = maxX - counts.length;
        screen.text(cx, y, `+${stat.added}`, { fg: theme.diffAdd });
        screen.text(cx + String(stat.added).length + 2, y++, `-${stat.removed}`, { fg: theme.diffDel });
      }
    }
    const mcp = s.mcp || [];
    if (mcp.length && y < rows - 4) {
      heading(words.mcp);
      for (const server of mcp) {
        if (y >= rows - 2) break;
        const at = screen.text(x, y, "●", { fg: server.ok ? theme.success : theme.error });
        screen.text(at + 1, y++, truncate(server.name, w - 2), { fg: theme.text });
      }
    }
    if (s.version) screen.text(x, rows - 2, `bitcode ${s.version}`, { fg: theme.faint });
  }

  function drawMenu(x, panelY, width) {
    const items = menuItems();
    if (!items) return;
    state.menuIndex = Math.min(state.menuIndex, items.length - 1);
    const count = Math.min(items.length, MAX_MENU_ROWS);
    const start = Math.max(0, Math.min(state.menuIndex - count + 1, items.length - count));
    const shown = items.slice(start, start + count);
    const top = panelY - count - 1;
    const labelW = Math.min(Math.max(...shown.map((i) => stringWidth(i.label))) + 2, Math.floor(width * 0.6));
    screen.fill(x, top, width, count + 1, { bg: theme.element });
    shown.forEach((item, i) => {
      const selected = start + i === state.menuIndex;
      const y = top + i;
      if (selected) screen.fill(x, y, width, 1, { bg: theme.elevated });
      screen.text(x + 1, y, selected ? "›" : " ", { fg: theme.accent });
      screen.text(x + 3, y, truncate(item.label, labelW), { fg: selected ? theme.strong : theme.text, bold: selected });
      if (item.hint) screen.text(x + 3 + labelW + 1, y, truncate(item.hint, width - labelW - 6), { fg: theme.faint });
    });
    const more = items.length > count ? ` · ${items.length - count} more` : "";
    screen.text(x + 3, top + count, `↑↓ · tab · ⏎ · esc${more}`, { fg: theme.faint });
  }

  function drawDialog(cols, rows) {
    const d = state.dialog, list = dialogRows();
    const width = Math.min(72, cols - 4), height = Math.min(18, rows - 4);
    const x = Math.floor((cols - width) / 2), y = Math.max(1, Math.floor((rows - height) / 3));
    screen.fill(x, y, width, height, { bg: theme.element });
    const titleEnd = screen.text(x + 2, y + 1, d.title, { fg: theme.strong, bold: true });
    if (d.subtitle) screen.text(titleEnd + 2, y + 1, truncate(d.subtitle, width - (titleEnd - x) - 10), { fg: theme.faint });
    screen.text(x + width - 5, y + 1, "esc", { fg: theme.faint });
    const filter = d.filter || words.filter;
    screen.text(x + 2, y + 2, "› ", { fg: theme.accent });
    const end = screen.text(x + 4, y + 2, filter, { fg: d.filter ? theme.strong : theme.faint });
    screen.setCursor(d.filter ? end : x + 4, y + 2);
    const visible = height - 6;
    const footer = lang === "it" ? "↑↓ muovi · ⏎ scegli · ← esc indietro · scrivi per filtrare" : "↑↓ move · ⏎ select · ← esc back · type to filter";
    screen.text(x + 2, y + height - 1, truncate(footer, width - 4), { fg: theme.faint });
    if (d.loading || d.error || !list.length) {
      const message = d.loading ? `${SPINNER[state.frame % SPINNER.length]} ${lang === "it" ? "carico…" : "loading…"}` : d.error || (lang === "it" ? "nessun risultato" : "no matches");
      screen.text(x + 2, y + 4, message, { fg: d.error ? theme.error : theme.faint });
      return;
    }
    d.index = Math.min(d.index, Math.max(0, list.length - 1));
    const start = Math.max(0, Math.min(d.index - visible + 1, list.length - visible));
    const labelW = Math.min(34, Math.max(8, ...list.map((i) => stringWidth(i.label) + (i.sat ? 2 : 0))) + 2);
    list.slice(start, start + visible).forEach((item, i) => {
      const row = y + 4 + i, selected = start + i === d.index;
      if (selected) screen.fill(x + 1, row, width - 2, 1, { bg: theme.elevated });
      screen.text(x + 2, row, selected ? "›" : item.current ? "●" : " ", { fg: item.current && !selected ? theme.success : theme.accent });
      let at = x + 4;
      if (item.sat) at = screen.text(at, row, SAT_GLYPH[item.sat] + " ", { fg: theme.sat[item.sat] });
      screen.text(at, row, truncate(item.label, labelW - (at - x - 4)), { fg: item.muted ? theme.faint : selected ? theme.strong : theme.text, bold: selected });
      if (item.hint) screen.text(x + 4 + labelW + 1, row, truncate(item.hint, width - labelW - 8), { fg: item.hintColor ? theme[item.hintColor] : theme.faint });
    });
  }

  function drawToast(mainW) {
    const t = state.toast;
    const text = ` ${t.text} `;
    const color = t.kind === "error" ? theme.error : t.kind === "success" ? theme.success : theme.info;
    const x = Math.max(0, mainW - stringWidth(text) - 2);
    screen.text(x - 1, 1, "▎", { fg: color, bg: theme.element });
    screen.text(x, 1, truncate(text, mainW - 2), { fg: theme.text, bg: theme.element });
  }

  // Approval details: coloured diff lines, or arguments as "key  value" rows instead of raw JSON.
  function diffDetail(diff) {
    return diff.split("\n").map((l) => {
      const style = l.startsWith("+") ? { fg: theme.diffAdd, bg: theme.diffAddBg } : l.startsWith("-") ? { fg: theme.diffDel, bg: theme.diffDelBg } : { fg: theme.faint };
      return [seg(l, style)];
    });
  }
  function argsDetail(args) {
    const keyWidth = Math.min(14, Math.max(0, ...Object.keys(args).map((k) => k.length)) + 2);
    return Object.entries(args).flatMap(([key, value]) => {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      return text.split("\n").map((line, i) => [seg((i ? "" : key).padEnd(keyWidth), { fg: theme.faint }), seg(line, { fg: theme.text })]);
    });
  }

  // ---------- public API used by the CLI presenter
  function toast(text, kind = "info", ms = 3500) {
    state.toast = { text, kind, until: Date.now() + ms };
    requestRender();
  }

  return {
    start, stop, toast, render,
    get running() { return running; },
    get mode() { return state.mode; },
    setMode(mode) { state.mode = mode; requestRender(); },
    onInterrupt(fn) { onInterrupt = fn; },
    onExitRequest(fn) { onExitRequest = fn; },
    readInput() {
      return new Promise((resolve) => { state.inputWaiter = resolve; requestRender(); });
    },
    ask(prompt, { secret = false, signal } = {}) {
      if (signal?.aborted) return Promise.resolve("");
      return new Promise((resolve) => {
        const abort = () => { if (state.question?.resolve === done) answerQuestion(""); };
        const done = (value) => { signal?.removeEventListener("abort", abort); resolve(value); };
        state.question = { prompt: String(prompt), secret, resolve: done, draft: state.editor.text };
        signal?.addEventListener("abort", abort, { once: true });
        setText(state.editor, "");
        requestRender();
      });
    },
    approve({ tool, sat, financial = false, readback, diff = "", args = {} }) {
      const detail = diff ? diffDetail(diff) : argsDetail(args);
      return new Promise((resolve) => {
        state.approval = { tool, sat, financial, readback, detail, resolve: (choice) => { state.approval = null; render(); resolve(choice); } };
        state.scroll = 0;
        render();
      });
    },
    select({ title, subtitle, items }) { return openDialog({ title, subtitle, items }); },
    user(text) { push(text.startsWith("/") ? { kind: "command", text } : { kind: "user", text, modeColor: modeColor() }); },
    note(text) { push({ kind: "note", text: String(text).replace(/\n+$/, "") }); },
    error(text) { push({ kind: "error", text: String(text) }); },
    assistantDelta(piece) {
      const last = state.blocks.at(-1);
      if (last?.kind === "assistant" && last.streaming) { last.text += piece; touch(last); }
      else push({ kind: "assistant", text: piece, streaming: true });
    },
    assistantEnd() {
      const last = state.blocks.at(-1);
      if (last?.kind === "assistant") { last.streaming = false; last.text = last.text.replace(/\s+$/, ""); touch(last); }
    },
    toolStart(id, { name, label, preview, sat }) {
      const block = push({ kind: "tool", name, label: label || name, preview, sat: sat || satForTool(name, { activeSatId: state.activeSat }), status: "running" });
      tools.set(id, block);
    },
    toolEnd(id, { status, result, output, diff, stat }) {
      const block = tools.get(id);
      if (!block) return;
      Object.assign(block, { status, result, output, diff, stat });
      tools.delete(id);
      touch(block);
    },
    runStart({ sat } = {}) {
      state.busy = { startedAt: Date.now(), sat };
      state.usage.outputTokens = 0;
      state.interruptArmedAt = 0;
      requestRender();
    },
    runEnd({ outcome = "ok", model, sat } = {}) {
      const durationMs = state.busy ? Date.now() - state.busy.startedAt : undefined;
      state.busy = null;
      state.satActivity = {};
      for (const block of tools.values()) { block.status = outcome === "cancelled" ? "denied" : "error"; touch(block); }
      tools.clear();
      push({ kind: "turn", sat, model, durationMs, outcome, files: [], inputTokens: state.usage.inputTokens, outputTokens: state.usage.outputTokens });
    },
    turnFiles(files = []) {
      if (!files.length) return;
      for (const f of files) {
        const prev = state.files.get(f.path) || { added: 0, removed: 0 };
        state.files.set(f.path, { added: prev.added + f.added, removed: prev.removed + f.removed });
      }
      const turn = state.blocks.findLast((b) => b.kind === "turn");
      if (turn) { turn.files = files; touch(turn); }
    },
    // Runtime bus events light up the Sat doing the work and keep token totals.
    busEvent(event) {
      const agent = SAT_IDS.includes(event.agentId) ? event.agentId : null;
      if (event.type === "run.started" && agent && event.parentRunId) state.activeSat = agent;
      if (event.type === "run.finished" && agent && event.parentRunId) state.activeSat = null;
      if (event.type === "model.usage") {
        state.usage.inputTokens = event.data.inputTokens ?? state.usage.inputTokens;
        state.usage.outputTokens += event.data.outputTokens || 0;
      }
      const sat = event.data?.tool ? satForTool(event.data.tool, { activeSatId: agent || state.activeSat }) : agent;
      if (sat) {
        if (event.type === "tool.started") state.satActivity[sat] = event.data.stage || "running";
        if (event.type === "approval.requested") state.satActivity[sat] = "waiting_approval";
        if (event.type === "tool.finished") delete state.satActivity[sat];
        if (event.type === "model.started" && agent) state.satActivity[agent] = "thinking";
      }
      if (event.type === "run.finished" && !event.parentRunId) state.satActivity = {};
      requestRender();
    },
    clear() { state.blocks = []; state.files.clear(); state.usage = { inputTokens: 0, outputTokens: 0 }; requestRender(); },
    snapshot() { render(); return screen.snapshot(); },
  };
}
