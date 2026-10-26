// DOM, IPC and formatting helpers used by every view.
import { t, errorText } from './i18n.js';
import { satStateLabel } from '../../src/sat-states.mjs';
import { S } from './state.js';

// ---------- helpers ----------
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v; else if (k === 'style') el.style.cssText = v; else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
export const fill = (el, ...c) => el && el.replaceChildren(...c.flat(Infinity).filter(x => x != null && x !== false));
export const $ = id => document.getElementById(id);
export async function api(method, params = {}) {
  const r = await window.bitcode.invoke(method, params);
  if (!r.ok) throw Object.assign(new Error(r.error.message), { code: r.error.code });
  return r.result;
}
export function toast(text, err = false) {
  const el = h('div', { class: `toast${err ? ' err' : ''}` }, text);
  $('toasts').append(el); setTimeout(() => el.remove(), err ? 7000 : 3000);
}
export const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { toast(errorText(e), true); } };
export const fmtTime = ms => new Date(ms).toLocaleString(document.documentElement.lang === 'en' ? 'en-GB' : 'it-IT', { dateStyle: 'short', timeStyle: 'short' });
export const project = () => S.projects.find(p => p.projectId === S.projectId);
export const satName = s => s[0].toUpperCase() + s.slice(1);
export const satLabel = (id, state) => satStateLabel(id, state, document.documentElement.lang);

export const modKey = /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl';
// ---------- live work line: rotating phrase + one measured datum, like the CLI ----------
export const wlang = () => (document.documentElement.lang === 'en' ? 'en' : 'it');
export function applyTheme() { document.documentElement.dataset.theme = S.settings?.theme || 'dark'; }
export const isDark = () => (S.settings?.theme || 'dark') === 'dark' || (S.settings?.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
export const activeRun = sessionId => [...S.runs.values()].find(r => r.sessionId === sessionId && !r.endedAt);


export const ago = ms => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return t('now'); if (m < 60) return `${m} min`; const hh = Math.round(m / 60); if (hh < 24) return `${hh} h`;
  const d = Math.round(hh / 24); return d === 1 ? t('yesterday') : d < 7 ? `${d} ${t('daysShort')}` : new Date(ms).toLocaleDateString(document.documentElement.lang, { day: 'numeric', month: 'short' });
};
export const fmt = (key, vars) => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), t(key));
