// The 59-second storyboard. Times are in seconds; everything on screen is the real
// Bitcode Desktop UI driven through the same DOM events a user would produce.
(() => {
  const E = window.engine;
  const { $, at, cam, cur, tap, ease } = E;
  const F = () => document.getElementById('app').contentWindow;
  const clamp01 = v => Math.min(1, Math.max(0, v));
  const emit = (channel, payload) => F().__emit(channel, payload);
  const demo = () => F().__demo;
  const el = (css, text, nth) => () => $(css, text, nth);
  const click = (css, text, nth) => () => $(css, text, nth).click();
  const D = () => document.getElementById('app').contentDocument;
  const textBox = node => { const r = D().createRange(); r.selectNodeContents(node); return r.getBoundingClientRect(); };
  const union = (...rs) => { const l = Math.min(...rs.map(r => r.left)), t = Math.min(...rs.map(r => r.top)), rr = Math.max(...rs.map(r => r.right)), b = Math.max(...rs.map(r => r.bottom));
    return { getBoundingClientRect: () => ({ left: l, top: t, right: rr, bottom: b, width: rr - l, height: b - t }) }; };
  const sandboxBadge = () => { const dd = $('.approval dd', 'bwrap'); return union(textBox(dd), dd.previousElementSibling.getBoundingClientRect()); };
  const fire = (node, type, init) => node.dispatchEvent(new (type.startsWith('key') ? F().KeyboardEvent : F().Event)(type, { bubbles: true, ...init }));

  // ---- stage effects: black hook, logo glow, window rise, closing dissolve ----
  E.tl.fx = t => {
    const f = { black: 0, win: { o: 1, y: 0, s: 1, rx: 0, blur: 0 }, logo: { o: 0, s: 1, glow: 0 }, cursor: 0 };
    f.black = t < 1.9 ? 1 : 1 - ease.sine(clamp01((t - 1.9) / 1.3));
    // logo: fades in out of black, assembles (engine), flares, then dissolves as the window arrives
    f.logo.o = clamp01((t - .25) / .35) * (1 - ease.sine(clamp01((t - 2.1) / 1.0)));
    f.logo.glow = ease.sine(clamp01((t - .9) / 1.0)) * (1 - clamp01((t - 2.1) / 1.0)) * (.75 + .25 * Math.sin(t * 5));
    f.logo.s = 1 + .22 * ease.sine(clamp01((t - 1.9) / 1.4));
    const r = ease.quint(clamp01((t - 1.8) / 2.1));
    f.win = { o: ease.sine(clamp01((t - 1.8) / 1.2)), y: 96 * (1 - r), s: .93 + .07 * r, rx: 11 * (1 - r), blur: 12 * (1 - r) };
    // closing: dissolve into the gradient
    const c = ease.sine(clamp01((t - 56.6) / 1.9));
    if (t > 56.6) f.win = { o: 1 - c, y: 22 * c, s: 1 - .05 * c, rx: 0, blur: 8 * c };
    f.end = ease.sine(clamp01((t - 56.0) / 2.9));
    f.cursor = clamp01((t - 3.0) / .5) * (1 - clamp01((t - 54.0) / .6));
    return f;
  };

  // ---- helpers ----
  function typeText(t0, cps, target, text) {
    at(t0 - .05, () => target().focus(), 0);
    for (let i = 1; i <= text.length; i++) at(t0 + (i - 1) / cps, () => { const e = target(); e.value = text.slice(0, i); fire(e, 'input'); }, 0);
  }
  function stream(t0, cps, agentId, text) {
    const step = 3;
    for (let i = 0; i < text.length; i += step) at(t0 + i / cps, () => emit('session', { sessionId: 's_new', type: 'message.delta', data: { runId: 'run_01', agentId, text: text.slice(i, i + step) } }), 0);
  }
  const satState = (t, satId, state) => at(t, () => emit('sat', { sessionId: 's_new', satId, state }), 0);
  const setSelect = (t, getEl, value) => at(t, () => { const e = getEl(); e.value = value; fire(e, 'change'); }, 80);
  const ptyPrompt = '\x1b[1;32mdev@bitcode\x1b[0m:\x1b[1;34m~/btc-invoice-api\x1b[0m$ ';
  const ptyOut = (t, s) => at(t, () => demo().ptyWrite(s), 0);

  // =========================================================================
  // 0-4 s  Hook: logo glow, window rises on "Benvenuto in Bitcode Desktop"
  // =========================================================================
  cam(0, 4.0, { view: { z: .96 } }, 'sine');
  cur(3.0, 3.9, el('.btn.primary.pill'));
  tap(3.95, click('.btn.primary.pill'), 260);

  // =========================================================================
  // 4-10 s  Home: push in on the composer, type a request, zoom 2x on the input
  // =========================================================================
  cam(4.0, 5.4, { el: el('.composer'), fit: [.5, .4], ay: 520 }, 'sine');
  cur(4.4, 5.3, el('#prompt'));
  tap(5.45, () => $('#prompt').focus(), 0);
  cam(5.4, 6.7, { el: el('#prompt'), z: 1.95, ay: 500 });
  const REQUEST = 'Aggiungi la verifica HMAC ai webhook dei pagamenti e scrivi i test';
  typeText(5.9, 19, el('#prompt'), REQUEST);
  cam(6.7, 9.5, { el: el('#prompt'), z: 2.15, ay: 500 }, 'sine');
  cur(8.9, 9.6, el('.composer .send'));
  tap(9.75, click('.composer .send'), 320);

  // =========================================================================
  // 10-18 s  The four Sats at work, then the Sat info dialog
  // =========================================================================
  at(10.0, () => emit('run', demo().run('running')), 40);
  cam(9.8, 11.3, { el: el('.satrow'), z: 3.4, dx: -4 });
  satState(10.05, 'merkle', 'planning');
  satState(11.0, 'node', 'reading');
  satState(11.8, 'script', 'writing');
  satState(12.6, 'hash', 'reading');
  satState(13.3, 'node', 'thinking');
  stream(10.3, 22, 'merkle', 'Leggo src/webhooks.js e i test esistenti. Poi propongo la verifica HMAC-SHA256 con confronto a tempo costante e il controllo del timestamp.');
  cam(11.3, 14.0, { el: el('.satrow'), z: 3.7, dx: 6 }, 'sine');
  cur(12.8, 13.9, el('button[aria-label="Sat info Node"]'));
  tap(14.1, click('button[aria-label="Sat info Node"]'), 250);
  cam(14.2, 15.2, { el: el('dialog.sat-info'), fit: [.6, .74] });
  cam(15.2, 16.3, { el: el('.sat-info .row', 'filesystem'), fit: [.9, .5] });
  cam(16.3, 17.7, { el: el('.sat-info .row', 'filesystem'), fit: [.97, .6] }, 'sine');
  cur(16.9, 17.6, el('.sat-info .iconbtn'));
  tap(17.8, click('.sat-info .iconbtn'), 120);

  // =========================================================================
  // 18-26 s  Coding: tree -> editor -> diff -> git -> terminal
  // =========================================================================
  cur(17.9, 18.4, el('button[aria-label="File"]'));
  cam(17.8, 18.5, 'full');
  tap(18.5, click('button[aria-label="File"]'), 200);
  at(18.7, () => $('.titem', 'src').click(), 150);
  cam(18.55, 19.3, { el: el('.tree'), z: 2.1, py: .16, ax: 900 });
  cur(19.2, 19.9, el('.titem', 'webhooks.js'));
  tap(20.0, click('.titem', 'webhooks.js'), 250);
  cam(19.9, 21.0, { el: el('.editor'), z: 1.55, py: .32 });
  cur(20.5, 21.1, el('button[aria-label="Git"]'));
  tap(21.2, click('button[aria-label="Git"]'), 200);
  cam(21.25, 21.95, { el: el('.gitpane'), z: 1.75, py: .24 });
  cur(21.5, 22.1, el('.gitrow .p', 'src/webhooks.js'));
  tap(22.15, click('.gitrow .p', 'src/webhooks.js'), 250);
  cam(22.25, 23.1, { el: el('.editor pre.diff'), z: 1.7, py: .3 });
  cur(22.6, 23.2, el('button[aria-label="Git"]'));
  tap(23.3, click('button[aria-label="Git"]'), 200);
  cam(23.4, 24.15, { el: el('.gitpane input[type=text]'), z: 2.1, py: 1.6 });
  cur(23.7, 24.15, el('.gitpane input[type=text]'));
  tap(24.2, () => $('.gitpane input[type=text]').focus(), 0);
  typeText(24.3, 46, el('.gitpane input[type=text]'), 'feat(webhooks): verifica firma HMAC-SHA256');
  cur(24.95, 25.4, el('button[aria-label="Terminale"]'));
  tap(25.5, click('button[aria-label="Terminale"]'), 350);
  cam(25.2, 26.1, { el: el('.panel'), z: 1.65, py: .16 });
  ptyOut(25.75, ptyPrompt);
  '$ npm test'.slice(2).split('').forEach((c, i) => ptyOut(25.95 + i * .05, c));
  ptyOut(26.4, '\r\n> btc-invoice-api@0.4.2 test\r\n> node --test tests/\r\n\r\n');
  ptyOut(26.55, '\x1b[32m✔\x1b[0m verifica firma HMAC valida \x1b[90m(2.1ms)\x1b[0m\r\n');
  ptyOut(26.7, '\x1b[32m✔\x1b[0m rifiuta firma non valida \x1b[90m(0.8ms)\x1b[0m\r\n');
  ptyOut(26.85, '\x1b[32m✔\x1b[0m rifiuta timestamp scaduto \x1b[90m(0.6ms)\x1b[0m\r\n');
  ptyOut(27.0, '\x1b[32m✔\x1b[0m webhook di pagamento confermato \x1b[90m(1.9ms)\x1b[0m\r\n\r\n\x1b[36mℹ\x1b[0m tests 4\r\n\x1b[36mℹ\x1b[0m pass 4\r\n\x1b[36mℹ\x1b[0m fail 0\r\n' + ptyPrompt);

  // =========================================================================
  // 26-33 s  Control: modes, approval card, sandbox badge
  // =========================================================================
  at(27.0, () => emit('approval', demo().approval()), 60);
  satState(27.0, 'script', 'waiting_approval');
  cur(27.2, 27.65, el('.ptab[aria-label="close"]'));
  tap(27.75, click('.ptab[aria-label="close"]'), 200);
  cam(27.2, 28.1, { el: el('.composer .bar select', null, 1), z: 2.7, ay: 500, dx: 150 });
  cur(27.9, 28.3, el('.composer .bar select', null, 1));
  tap(28.35, null, 0); setSelect(28.4, el('.composer .bar select', null, 1), 'manual');
  tap(28.9, null, 0); setSelect(28.95, el('.composer .bar select', null, 1), 'unattended');
  tap(29.4, null, 0); setSelect(29.45, el('.composer .bar select', null, 1), 'assisted');
  cam(28.1, 29.7, { el: el('.composer .bar select', null, 1), z: 2.8, ay: 500, dx: 150 }, 'sine');
  cam(29.7, 30.7, { el: el('.approval'), fit: [.5, .7], ay: 480 });
  cur(29.7, 30.5, el('.approval .btn.primary'));
  cam(30.7, 31.5, { el: sandboxBadge, fit: [.6, .4], ay: 480 });
  cam(31.5, 32.7, { el: sandboxBadge, fit: [.66, .44], ay: 480 }, 'sine');
  cam(32.7, 33.4, { el: el('.approval'), fit: [.52, .72], ay: 480 });
  cur(32.6, 33.3, el('.approval .btn.primary'));
  tap(33.45, click('.approval .btn.primary'), 120);
  at(33.7, () => { demo().finish(); emit('run', demo().run('success', { endedAt: 1 })); }, 120);
  ['node', 'script', 'hash', 'merkle'].forEach((s, i) => satState(33.75 + i * .05, s, 'success'));

  // =========================================================================
  // 33-39 s  Models: picker, local models of this machine, fit badges
  // =========================================================================
  cam(33.7, 34.5, { el: el('.modelbtn'), z: 3.0, ay: 520, dx: 40 });
  cur(33.9, 34.6, el('.modelbtn'));
  tap(34.7, click('.modelbtn'), 300);
  cam(34.8, 35.5, { el: el('.modelpop'), fit: [.5, .78], ay: 500 });
  cam(35.5, 36.7, { el: el('.mlist'), z: 2.5, py: .1, ay: 440 });
  cam(36.7, 38.3, { el: el('.mlist'), z: 2.6, py: .34, ay: 440 }, 'sine');
  cur(35.4, 36.2, el('.mitem', 'qwen3-coder'));
  cur(36.2, 37.6, el('.mitem', 'llama3.3'), 'sine', .06);
  at(38.4, () => fire($('#modelfilter'), 'keydown', { key: 'Escape' }), 80);

  // =========================================================================
  // 39-49 s  Bitcoin area: balance, fees, policy, proposal flow
  // =========================================================================
  cur(38.4, 39.0, el('.sact', 'Bitcoin'));
  tap(39.1, click('.sact', 'Bitcoin'), 350);
  cam(39.2, 39.9, { el: el('.page.fin'), fit: [.8, .85], py: .4 });
  cam(39.9, 41.0, { el: el('.card.balance'), fit: [.55, .6] });
  cam(41.0, 41.9, { el: el('.fgrid .card', null, 1), fit: [.46, .55] });
  cam(41.9, 42.8, { el: el('.card', 'Policy di spesa'), fit: [.72, .5] });
  cur(41.6, 42.8, el('.card.balance .btn', 'Invia'));
  tap(42.9, click('.card.balance .btn', 'Invia'), 250);
  cam(42.98, 43.9, { el: el('.card', 'Prepara proposta'), fit: [.7, .6] });
  cur(43.0, 43.5, el('.card .form.tight input', null, 0));
  typeText(43.55, 70, el('.card .form.tight input', null, 0), 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx');
  typeText(44.2, 14, el('.card .form.tight input', null, 1), '20000');
  typeText(44.6, 10, el('.card .form.tight input', null, 2), '8');
  cam(43.9, 44.9, { el: el('.status', 'Niente viene firmato'), z: 4.4, px: .5 });
  cam(44.9, 46.9, { el: el('.status', 'Niente viene firmato'), z: 4.7, px: .5 }, 'sine');
  cur(44.7, 46.8, el('.btn.primary', 'Prepara proposta'));
  tap(47.0, click('.btn.primary', 'Prepara proposta'), 250);
  cam(47.1, 47.9, { el: el('.card.review'), fit: [.62, .72] });
  cur(47.5, 48.5, el('.card.review .btn.primary'));
  tap(48.6, click('.card.review .btn.primary'), 300);
  cam(48.6, 49.2, { el: el('.page.fin'), fit: [.78, .85], py: .5 });

  // =========================================================================
  // 49-54 s  Protocols
  // =========================================================================
  const tabs = [['Lightning', 49.25], ['Taproot Assets', 50.45], ['Liquid', 51.65], ['Cashu', 52.85]];
  tabs.forEach(([name, t], i) => {
    cur(t - .55, t - .08, el('.ftab', name));
    tap(t, click('.ftab', name), 250);
    cam(t + .06, t + 1.05, { el: el('.fbody'), fit: [.74, .72], py: .22, dx: (i % 2 ? 40 : -40) }, 'cubic');
  });

  // =========================================================================
  // 54-59 s  Closing pull-back
  // =========================================================================
  cam(54.1, 56.4, { view: { z: .84, cx: 960, cy: 540, ay: 480 } }, 'sine');
  cam(56.4, 59.0, { view: { z: .76, cx: 960, cy: 540, ay: 480 } }, 'sine');
})();
