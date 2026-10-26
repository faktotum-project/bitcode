import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HIDDEN_ARG, autostartEntry, autostartFile, createCrashPolicy, restoreBounds, trayModel } from '../core/shell.mjs';

test('renderer crashes reload twice in a row, then stop; unrelated exits and old crashes do not count', () => {
  let now = 0; const p = createCrashPolicy({ now: () => now });
  assert.equal(p.next('clean-exit'), 'ignore');
  assert.deepEqual(['crashed', 'oom', 'crashed'].map(r => p.next(r)), ['reload', 'reload', 'stop']);
  now += 121_000; assert.equal(p.next('crashed'), 'reload');
  p.reset(); assert.equal(p.next('abnormal-exit'), 'reload');
});

test('saved window bounds are restored only while they stay on a display', () => {
  const work = [{ x: 0, y: 0, width: 1920, height: 1080 }];
  assert.deepEqual(restoreBounds({ x: 100, y: 50, width: 1200, height: 800, maximized: true }, work), { x: 100, y: 50, width: 1200, height: 800, maximized: true });
  assert.equal(restoreBounds({ x: 2500, y: 50, width: 1200, height: 800 }, work), null);
  assert.equal(restoreBounds({ x: 'a', y: 0, width: 1, height: 1 }, work), null);
  assert.equal(restoreBounds(null, work), null);
  assert.deepEqual(restoreBounds({ x: 0, y: 0, width: 10, height: 10 }, work), { x: 0, y: 0, width: 980, height: 620, maximized: false });
});

test('tray summary lists approvals for navigation and caps long lists', () => {
  const pending = Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, kind: 'write_file', subject: { project: `progetto-${i}` } }));
  const m = trayModel({ runs: [{ runId: 'r1', prompt: 'fix\nthe   build' }], pending });
  assert.equal(m.state, 'attention'); assert.equal(m.approvals.length, 8); assert.equal(m.moreApprovals, 2);
  assert.equal(m.approvals[0].label, 'progetto-0 · write_file'); assert.equal(m.runs[0].label, 'fix the build');
  assert.match(m.tooltip, /1 run · 10 requests/);
  assert.match(trayModel({ runs: [{ runId: 'r1', prompt: 'x' }], pending, lang: 'it' }).tooltip, /1 attività · 10 richieste/);
  assert.equal(trayModel({}).state, 'idle');
});

test('autostart entry follows XDG paths and quotes the executable for Desktop Entry Exec', () => {
  assert.equal(autostartFile({ env: {}, home: '/home/u' }), '/home/u/.config/autostart/bitcode-desktop.desktop');
  assert.equal(autostartFile({ env: { XDG_CONFIG_HOME: '/cfg' }, home: '/home/u' }), '/cfg/autostart/bitcode-desktop.desktop');
  assert.equal(autostartFile({ env: { XDG_CONFIG_HOME: 'relative' }, home: '/home/u' }), '/home/u/.config/autostart/bitcode-desktop.desktop');
  assert.match(autostartEntry({ executable: '/opt/bitcode/bitcode-desktop' }), new RegExp(`^Exec=/opt/bitcode/bitcode-desktop ${HIDDEN_ARG}$`, 'm'));
  assert.match(autostartEntry({ executable: '/home/u/My Apps/Bit$code 100%.AppImage' }), /^Exec="\/home\/u\/My Apps\/Bit\\\\\$code 100%%\.AppImage" --hidden$/m);
  assert.throws(() => autostartEntry({ executable: 'relative/bin' }), /absolute/);
  assert.throws(() => autostartEntry({ executable: '/a\nExec=evil' }), /absolute/);
});
