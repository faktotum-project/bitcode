// The phone page served by LAN access: login, chat list, one chat, send box.
// Plain DOM APIs only; text always goes through textContent, never innerHTML.
import { BRAND, THEME } from '../../src/design-tokens.mjs';
const D = THEME.dark;

export const LAN_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>bitcode</title>
<style>
:root { color-scheme: dark; --bg:${D.canvas}; --card:${D.card}; --ink:${D.ink}; --muted:${D.body}; --line:${D.hairline}; --accent:${BRAND.accent}; }
* { box-sizing: border-box; } body { margin:0; font:15px/1.45 system-ui, sans-serif; background:var(--bg); color:var(--ink); }
header { position:sticky; top:0; display:flex; gap:8px; align-items:center; padding:12px 16px; background:var(--bg); border-bottom:1px solid var(--line); }
header b { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; } main { padding:12px 16px 120px; }
button, input, textarea { font:inherit; } button { background:var(--card); color:var(--ink); border:1px solid var(--line); border-radius:8px; padding:8px 12px; }
button.primary { background:var(--accent); color:${BRAND.onAccent}; border:0; font-weight:600; }
input, textarea { width:100%; background:var(--card); color:var(--ink); border:1px solid var(--line); border-radius:8px; padding:10px; }
.row { display:block; width:100%; text-align:left; margin-bottom:8px; } .muted { color:var(--muted); font-size:13px; }
.msg { margin:10px 0; padding:10px 12px; border-radius:10px; white-space:pre-wrap; word-break:break-word; } .user { background:${D.elevated}; margin-left:20%; } .assistant { background:var(--card); }
form.send { position:fixed; left:0; right:0; bottom:0; display:flex; gap:8px; padding:12px 16px; background:var(--bg); border-top:1px solid var(--line); }
.err { color:${D.down}; margin:8px 0; } .note { border:1px solid var(--line); border-radius:10px; padding:10px; margin:10px 0; color:var(--muted); }
</style></head>
<body><header><button id="back" hidden>‹</button><b id="title">bitcode</b><button id="logout" hidden>Esci</button></header><main id="main"></main>
<script src="/app.js"></script></body></html>`;

export const LAN_SCRIPT = `'use strict';
const main = document.getElementById('main'), title = document.getElementById('title'), back = document.getElementById('back'), logoutBtn = document.getElementById('logout');
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); for (const k of kids) n.append(k); return n; };
let current = null, timer = null;
async function call(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') { login(); throw new Error('login'); }
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}
function login(message) {
  clearInterval(timer); current = null; back.hidden = true; logoutBtn.hidden = true; title.textContent = 'bitcode';
  const pass = el('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
  const form = el('form', {}, pass, el('p'), el('button', { className: 'primary', type: 'submit', textContent: 'Sign in' }), message ? el('p', { className: 'err', textContent: message }) : '');
  form.onsubmit = async e => { e.preventDefault(); try { await call('/api/login', { password: pass.value }); list(); } catch (err) { login(err.message); } };
  main.replaceChildren(el('p', { className: 'muted', textContent: 'Local network access. Approvals stay on the desktop.' }), form); pass.focus();
}
async function list() {
  clearInterval(timer); current = null; back.hidden = true; logoutBtn.hidden = false; title.textContent = 'Chat';
  const sessions = await call('/api/sessions');
  main.replaceChildren(...(sessions.length ? sessions.map(s => { const b = el('button', { className: 'row' }, el('div', { textContent: s.name }), el('div', { className: 'muted', textContent: s.active ? 'in esecuzione' : new Date(s.updatedAt).toLocaleString() })); b.onclick = () => open(s.sessionId); return b; }) : [el('p', { className: 'muted', textContent: 'No chats yet. Create them on the desktop.' })]));
}
async function render() {
  const s = await call('/api/session?id=' + encodeURIComponent(current));
  title.textContent = s.name;
  const items = s.messages.filter(m => m.content).map(m => el('div', { className: 'msg ' + m.role, textContent: m.content }));
  if (s.pending) items.push(el('div', { className: 'note', textContent: s.pending + ' richiesta/e in attesa: approva o rifiuta sul desktop.' }));
  if (s.active) items.push(el('div', { className: 'muted', textContent: 'bitcode is working…' }));
  const text = el('textarea', { rows: 2, placeholder: 'Message bitcode…' }), form = el('form', { className: 'send' }, text, el('button', { className: 'primary', type: 'submit', textContent: '↑' }));
  form.onsubmit = async e => { e.preventDefault(); if (!text.value.trim()) return; try { await call('/api/send', { sessionId: current, text: text.value }); text.value = ''; render(); } catch (err) { alert(err.message); } };
  main.replaceChildren(...items, form); window.scrollTo(0, document.body.scrollHeight);
}
function open(id) { current = id; back.hidden = false; render().catch(() => {}); clearInterval(timer); timer = setInterval(() => { if (!document.activeElement || document.activeElement.tagName !== 'TEXTAREA') render().catch(() => {}); }, 4000); }
back.onclick = () => list().catch(() => {});
logoutBtn.onclick = async () => { await call('/api/logout', {}).catch(() => {}); login(); };
list().catch(() => {});
`;
