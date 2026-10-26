// Remote access page: SSH and the LAN server.
import { t } from './i18n.js';
import { sat } from './marks.js';
import { word } from '../../src/work-meter.mjs';
import { $, api, guard, h, toast } from './dom.js';
import { save } from './editor.js';
import { renderCenter } from './shell.js';
import { S } from './state.js';
import { openRemoteTerminal } from './terminal.js';

export function lanSection() {
  if (S.lan === undefined) { S.lan = null; api('lan.status').then(x => { S.lan = x; if (S.view === 'remote') renderCenter(); }).catch(() => {}); }
  const l = S.lan; if (!l) return h('p', { class: 'status' }, '…');
  const pass = h('input', { type: 'password', autocomplete: 'new-password', placeholder: t('wb_lanPasswordPh') });
  return [h('div', { class: 'section' }, t('wb_modeLan')),
    h('div', { class: 'form' },
      h('label', {}, t('wb_lanState')), h('span', {}, l.running ? h('span', { class: 'chip ok' }, t('wb_lanRunning')) : h('span', { class: 'chip warn' }, l.error || (l.passwordSet ? t('wb_lanStopped') : t('wb_lanNeedsPassword')))),
      l.url ? [h('label', {}, t('wb_lanUrl')), h('span', { class: 'mono' }, l.url)] : null,
      l.fingerprint ? [h('label', { title: t('wb_lanFingerprintHint') }, t('wb_lanFingerprint')), h('span', { class: 'mono', style: 'font-size:11px;word-break:break-all' }, l.fingerprint)] : null,
      h('label', {}, t('wb_lanAddress')), h('select', { onChange: guard(async e => { S.lan = await api('lan.configure', { host: e.target.value }); renderCenter(); }) }, l.addresses.map(a => h('option', { value: a, selected: a === l.host }, a))),
      h('label', {}, t('wb_lanPort')), h('input', { type: 'number', min: 1024, max: 65535, value: l.port, onChange: guard(async e => { S.lan = await api('lan.configure', { port: Number(e.target.value) }); renderCenter(); }) }),
      h('label', {}, t('wb_lanPassword')), h('span', { class: 'row' }, pass, h('button', { class: 'btn sm', onClick: guard(async () => { S.lan = await api('lan.configure', { password: pass.value }); pass.value = ''; renderCenter(); toast(t('wb_saved')); }) }, t('save')))),
    h('p', { class: 'status' }, t('wb_lanHint'))];
}
export function remotePage() {
  if (S.remote === undefined) { S.remote = null; api('remote.status').then(r => { S.remote = r; if (S.view === 'remote') renderCenter(); }).catch(e => toast(e.message, true)); }
  const r = S.remote, input = h('input', { type: 'text', placeholder: 'utente@server · alias di ~/.ssh/config' });
  return h('div', { class: 'page' }, h('h1', {}, t('wb_remote')), h('p', { class: 'lead' }, t('wb_remoteLead')),
    !r ? h('p', { class: 'status' }, '…') : [
      h('div', { class: 'section' }, t('wb_remoteMode')),
      h('div', { class: 'row' }, h('div', { class: 'seg' }, [['off', 'wb_modeOff'], ['ssh', 'wb_modeSsh'], ['lan', 'wb_modeLan']].map(([m, key]) => h('button', { class: (S.settings?.remoteMode || 'off') === m ? 'on' : '',
          onClick: guard(async () => { S.settings = await api('settings.set', { key: 'remoteMode', value: m }); S.lan = await api('lan.status'); renderCenter(); }) }, t(key)))),
        h('button', { class: 'btn sm', onClick: guard(async e => {
          e.currentTarget.disabled = true; toast(t('wb_askingHash'));
          S.hashAdvice = await api('remote.advice', { facts: { lang: document.documentElement.lang, sshdListening: r.sshd, lanAddresses: r.addresses.length, savedSshHosts: r.hosts.length, localOnly: !!S.settings?.localOnly, lanServerAvailable: true, lanPasswordSet: !!S.lan?.passwordSet, desktopApprovesPayments: true } });
          renderCenter();
        }) }, sat('hash', { size: 18 }), ` ${t('wb_askHash')}`)),
      S.hashAdvice ? h('div', { class: 'card', style: 'margin-top:12px' }, h('div', { class: 'row' }, sat('hash', { size: 28 }), h('b', {}, `Hash: ${t({ off: 'wb_modeOff', ssh: 'wb_modeSsh', lan: 'wb_modeLan' }[S.hashAdvice.mode])}`), h('span', { class: 'spacer' }), h('span', { class: 'status num' }, S.hashAdvice.model)),
        h('ul', {}, S.hashAdvice.reasons.map(x => h('li', {}, x))), S.hashAdvice.risks.length ? [h('p', { class: 'status' }, t('wb_risks')), h('ul', {}, S.hashAdvice.risks.map(x => h('li', {}, x)))] : null,
        h('button', { class: 'btn sm primary', disabled: S.settings?.remoteMode === S.hashAdvice.mode, onClick: guard(async () => { S.settings = await api('settings.set', { key: 'remoteMode', value: S.hashAdvice.mode }); S.lan = await api('lan.status'); renderCenter(); toast(t('wb_saved')); }) }, t('wb_applyHash'))) : null,
      S.settings?.remoteMode === 'lan' ? lanSection() : null,
      S.settings?.remoteMode === 'off' ? h('p', { class: 'status', style: 'margin-top:12px' }, t('wb_modeOffHint')) : null,
      S.settings?.remoteMode !== 'off' ? [
      h('div', { class: 'section' }, t('wb_remoteThis')),
      h('div', { class: 'form' },
        h('label', {}, 'SSH'), h('span', {}, h('span', { class: `chip ${r.sshd ? 'ok' : 'warn'}` }, r.sshd ? t('wb_sshdOn') : t('wb_sshdOff'))),
        h('label', {}, t('wb_remoteCmd')), h('span', { class: 'mono' }, r.addresses.length ? r.addresses.map(a => h('div', {}, `ssh ${r.user}@${a}  →  bitcode`)) : '—')),
      h('p', { class: 'status' }, r.sshd ? t('wb_remoteThisHint') : t('wb_sshdHint')),
      h('div', { class: 'section' }, t('wb_remoteOthers')),
      r.hosts.length ? h('table', { class: 'list' }, r.hosts.map(x => h('tr', {}, h('td', { class: 'mono' }, x), h('td', { class: 'status' }, r.saved.includes(x) ? t('wb_saved') : '~/.ssh/config'),
        h('td', {}, h('div', { class: 'row' }, h('button', { class: 'btn sm primary', onClick: () => openRemoteTerminal(x, 'bitcode') }, t('wb_openRemoteBitcode')), h('button', { class: 'btn sm', onClick: () => openRemoteTerminal(x, 'shell') }, t('wb_openRemoteShell')),
          r.saved.includes(x) ? h('button', { class: 'btn sm danger', onClick: guard(async () => { S.remote = await api('remote.save', { hosts: r.saved.filter(y => y !== x) }); renderCenter(); }) }, t('delete')) : null))))) : h('p', { class: 'status' }, t('none')),
      h('div', { class: 'row', style: 'margin-top:12px' }, input, h('button', { class: 'btn sm', onClick: guard(async () => { const v = input.value.trim(); if (!v) return; S.remote = await api('remote.save', { hosts: [...r.saved, v] }); renderCenter(); }) }, t('wb_add'))),
      h('p', { class: 'status' }, t('wb_remoteSafety'))] : null]);
}
