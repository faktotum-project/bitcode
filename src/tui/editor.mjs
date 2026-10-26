// Multi-line prompt editing as pure state transitions; the app renders the result.
import { graphemes, graphemeWidth } from "./width.mjs";

export function createEditor(history = []) {
  return { text: "", cursor: 0, history: [...history], historyIndex: history.length, draft: "" };
}

const prevBoundary = (text, at) => {
  const parts = graphemes(text.slice(0, at));
  return at - (parts.at(-1)?.length || 0);
};
const nextBoundary = (text, at) => at + (graphemes(text.slice(at))[0]?.length || 0);
const lineStart = (text, at) => text.lastIndexOf("\n", at - 1) + 1;
const lineEnd = (text, at) => { const n = text.indexOf("\n", at); return n < 0 ? text.length : n; };

export function setText(editor, text) {
  editor.text = text;
  editor.cursor = text.length;
}

export function edit(editor, key) {
  const { text, cursor } = editor;
  switch (key.name) {
    case "text":
    case "paste":
      editor.text = text.slice(0, cursor) + key.text + text.slice(cursor);
      editor.cursor = cursor + key.text.length;
      return true;
    case "newline":
      editor.text = text.slice(0, cursor) + "\n" + text.slice(cursor);
      editor.cursor = cursor + 1;
      return true;
    case "backspace": {
      if (!cursor) return false;
      const at = prevBoundary(text, cursor);
      editor.text = text.slice(0, at) + text.slice(cursor);
      editor.cursor = at;
      return true;
    }
    case "delete":
      if (cursor >= text.length) return false;
      editor.text = text.slice(0, cursor) + text.slice(nextBoundary(text, cursor));
      return true;
    case "left": editor.cursor = prevBoundary(text, cursor); return true;
    case "right": editor.cursor = nextBoundary(text, cursor); return true;
    case "home": editor.cursor = lineStart(text, cursor); return true;
    case "end": editor.cursor = lineEnd(text, cursor); return true;
    case "ctrl-u": {
      const start = lineStart(text, cursor);
      editor.text = text.slice(0, start) + text.slice(cursor);
      editor.cursor = start;
      return true;
    }
    case "ctrl-k":
      editor.text = text.slice(0, cursor) + text.slice(lineEnd(text, cursor));
      return true;
    case "ctrl-w": {
      const head = text.slice(0, cursor).replace(/\S+\s*$|\s+$/, "");
      editor.text = head + text.slice(cursor);
      editor.cursor = head.length;
      return true;
    }
    case "up": return moveVertical(editor, -1);
    case "down": return moveVertical(editor, 1);
    default: return false;
  }
}

function moveVertical(editor, direction) {
  const { text, cursor } = editor;
  const start = lineStart(text, cursor);
  const column = cursor - start;
  if (direction < 0 && start > 0) {
    const prevStart = lineStart(text, start - 1);
    editor.cursor = Math.min(prevStart + column, start - 1);
    return true;
  }
  const end = lineEnd(text, cursor);
  if (direction > 0 && end < text.length) {
    const nextEnd = lineEnd(text, end + 1);
    editor.cursor = Math.min(end + 1 + column, nextEnd);
    return true;
  }
  return browseHistory(editor, direction);
}

function browseHistory(editor, direction) {
  const { history } = editor;
  const index = editor.historyIndex + direction;
  if (index < 0 || index > history.length) return false;
  if (editor.historyIndex === history.length) editor.draft = editor.text;
  editor.historyIndex = index;
  setText(editor, index === history.length ? editor.draft : history[index]);
  return true;
}

export function remember(editor, line) {
  if (line && editor.history.at(-1) !== line) editor.history.push(line);
  editor.historyIndex = editor.history.length;
  editor.draft = "";
}

// Hard-wraps the text to `width` columns -> { rows: string[], cursorRow, cursorCol }.
export function layoutEditor(text, cursor, width) {
  const rows = [""];
  let col = 0, cursorRow = 0, cursorCol = 0, index = 0;
  const parts = graphemes(text);
  for (const g of parts) {
    const w = g === "\n" ? 0 : graphemeWidth(g);
    if (col + w > width) { rows.push(""); col = 0; }
    if (index === cursor) { cursorRow = rows.length - 1; cursorCol = col; }
    if (g === "\n") { rows.push(""); col = 0; index += g.length; continue; }
    rows[rows.length - 1] += g;
    col += w;
    index += g.length;
  }
  if (cursor >= text.length) {
    if (col >= width) { rows.push(""); col = 0; }
    cursorRow = rows.length - 1;
    cursorCol = col;
  }
  return { rows, cursorRow, cursorCol };
}
