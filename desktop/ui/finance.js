// Bitcoin area: one tab per protocol. Every state shown comes from the backend
// (environment proof, balances, proposals); disabled buttons are only a
// reflection — the finance service enforces test-only, human-confirmed spends.
export function createFinanceView({ h, fill, api, toast, guard, t, icon, rerender }) {
  const PROTOS = [['bitcoin', 'Bitcoin'], ['lightning', 'Lightning'], ['cashu', 'Cashu'], ['liquid', 'Liquid'], ['taproot', 'Taproot Assets']];
  const V = { tab: 'bitcoin', data: {}, conns: null, loading: {}, panel: null, proposal: null, showEvidence: false, sendForm: { to: '', amountSats: '', feeRate: '' }, editPolicy: false };
  const sats = n => (n == null ? '—' : Number(n).toLocaleString(document.documentElement.lang === 'en' ? 'en-US' : 'it-IT'));
  const btc = n => (n == null ? '—' : (Number(n) / 1e8).toFixed(8));
  const short = s => s ? `${s.slice(0, 10)}…${s.slice(-6)}` : '';
  const copy = (text, label) => { navigator.clipboard?.writeText(text); toast(`${label || t('copied')}`); };
  const envDot = env => h('span', { class: `edot ${env?.status === 'connected' ? env.environment : env?.status || 'none'}` });
  const envChip = env => !env ? null : env.status === 'not_configured' ? h('span', { class: 'chip' }, t('fin_notConfigured'))
    : env.status === 'error' ? h('span', { class: 'chip err' }, t('fin_error'))
    : env.environment === 'test' ? h('span', { class: 'chip ok' }, `${t('fin_test')} · ${env.network}`)
    : env.environment === 'production' ? h('span', { class: 'chip info' }, `${t('fin_production')} · ${env.network}`)
    : h('span', { class: 'chip warn' }, `${t('fin_unverified')} · ${env.network || '?'}`);

  async function load(protocol = V.tab, { quiet = false } = {}) {
    V.loading[protocol] = true; if (!quiet) rerender();
    try { V.data[protocol] = await api('finance.overview', { protocol }); V.data[protocol].error = null; }
    catch (e) { V.data[protocol] = { ...(V.data[protocol] || {}), error: e.message }; }
    finally { V.loading[protocol] = false; }
    try { V.conns = await api('finance.connections'); } catch {}
    rerender();
  }
  // Current tab first, so it renders as soon as its own backend answers; the
  // others (and their tab dots) fill in behind it.
  const loadAll = guard(async () => { const first = V.tab; await load(first); await load('lightning', { quiet: true }); await Promise.all(PROTOS.filter(([p]) => p !== first && p !== 'lightning').map(([p]) => load(p, { quiet: true }))); });

  function evidence(env) {
    if (!env?.evidence?.length) return null;
    return h('div', { class: 'evidence' }, h('button', { class: 'linkbtn', onClick: () => { V.showEvidence = !V.showEvidence; rerender(); } }, `${V.showEvidence ? '▾' : '▸'} ${t('fin_proof')}`),
      V.showEvidence ? h('dl', { class: 'kv' }, env.evidence.map(e => [h('dt', {}, e.source), h('dd', { class: 'mono' }, e.value)]), h('dt', {}, t('fin_checked')), h('dd', { class: 'mono' }, new Date(env.at).toLocaleTimeString())) : null);
  }
  function connectionForm(protocol, fields, help) {
    const conn = V.conns?.[protocol]?.fields || {};
    const values = { ...conn };
    const input = (k, kind) => kind === 'select'
      ? h('select', { onChange: e => { values[k] = e.target.value; } }, fields[k].map(o => h('option', { value: o, selected: (conn[k] || fields[k][0]) === o }, o)))
      : h('input', { type: 'text', class: 'mono', value: conn[k] || '', placeholder: fields[k], onInput: e => { values[k] = e.target.value; } });
    return h('div', { class: 'card' }, h('h3', {}, icon('settings', { size: 15 }), t('fin_connection')), help ? h('p', {}, help) : null,
      h('div', { class: 'form tight' }, Object.keys(fields).map(k => [h('label', { class: 'mono' }, k), input(k, Array.isArray(fields[k]) ? 'select' : 'text')])),
      h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn primary', onClick: guard(async () => {
        const send = Object.fromEntries(Object.keys(fields).map(k => [k, values[k] ?? (Array.isArray(fields[k]) ? fields[k][0] : '')]));
        const r = await api('finance.configure', { protocol, fields: send }); toast(`${t('fin_saved')} · ${r.status}`); await load(protocol);
      }) }, t('fin_saveVerify')), h('span', { class: 'status' }, t('fin_sharedConfig'))));
  }
  const blockerText = b => t(`fin_block_${b}`);

  // ---------- Bitcoin ----------
  function bitcoinTab(d) {
    const env = d.env;
    const top = h('div', { class: 'fgrid' },
      h('div', { class: 'card balance' },
        h('div', { class: 'brow' }, h('span', { class: 'blabel' }, `${t('fin_balance')} · ${d.network}`), envChip(env)),
        d.wallet?.exists ? [h('div', { class: 'bbig num' }, btc(d.balance?.confirmedSats), h('span', { class: 'unit' }, d.network === 'mainnet' ? 'BTC' : 'tBTC')),
          h('div', { class: 'bsub num' }, `${sats(d.balance?.confirmedSats)} sat`, d.balance?.pendingSats ? h('span', { class: d.balance.pendingSats > 0 ? 'up' : 'down' }, ` · ${d.balance.pendingSats > 0 ? '+' : ''}${sats(d.balance.pendingSats)} ${t('fin_inMempool')}`) : null)]
          : h('div', { class: 'bempty' }, t('fin_noWallet')),
        h('div', { class: 'row', style: 'margin-top:16px' },
          d.wallet?.exists ? [h('button', { class: `btn ${V.panel === 'receive' ? 'primary' : ''}`, onClick: () => { V.panel = V.panel === 'receive' ? null : 'receive'; rerender(); } }, t('fin_receive')),
            h('button', { class: `btn ${V.panel === 'send' ? 'primary' : ''}`, onClick: () => { V.panel = V.panel === 'send' ? null : 'send'; rerender(); } }, t('fin_send'))]
            : env?.environment === 'test' ? h('button', { class: 'btn primary', onClick: guard(async () => { if (!confirm(t('fin_createConfirm'))) return; const r = await api('finance.bitcoin.createWallet'); toast(`${t('fin_created')} · ${r.file}`); await load('bitcoin'); }) }, t('fin_createWallet')) : null,
          h('button', { class: 'btn ghost', onClick: () => load('bitcoin') }, V.loading.bitcoin ? '…' : `↻ ${t('refresh')}`)),
        evidence(env)),
      h('div', { class: 'card' }, h('h3', {}, t('fin_fees')),
        d.fees ? h('div', { class: 'feegrid num' }, [['fastestFee', 'fin_fast'], ['halfHourFee', 'fin_30m'], ['hourFee', 'fin_1h'], ['economyFee', 'fin_eco']].map(([k, l]) => h('div', {}, h('div', { class: 'fv' }, d.fees[k]), h('div', { class: 'fl' }, t(l))))) : h('p', {}, t('unavailable')),
        h('div', { class: 'status num', style: 'margin-top:10px' }, `${t('fin_height')} ${env?.tip ?? '—'} · sat/vB`)));
    const panels = [];
    if (V.panel === 'receive' && d.receive) panels.push(h('div', { class: 'card' }, h('h3', {}, t('fin_receive')),
      h('div', { class: 'addr mono', title: t('copy'), onClick: () => copy(d.receive.address, t('fin_addrCopied')) }, d.receive.address, h('span', { class: 'copyic' }, '⧉')),
      h('p', {}, `${t('fin_addrNote')} m/84'/1'/0'/0/${d.receive.index}`), d.network !== 'mainnet' ? h('p', { class: 'status' }, t('fin_faucet')) : null));
    if (V.panel === 'send') panels.push(sendPanel(d));
    const policy = h('div', { class: 'card' }, h('div', { class: 'brow' }, h('h3', {}, t('fin_policy')), d.policy && !V.editPolicy ? h('button', { class: 'btn sm ghost', onClick: () => { V.editPolicy = true; rerender(); } }, t('fin_edit')) : null),
      d.policy && !V.editPolicy ? h('div', { class: 'feegrid num' }, [['maxPaymentSats', 'fin_pMax'], ['dailyLimitSats', 'fin_pDay'], ['maxFeeSats', 'fin_pFee'], ['minReserveSats', 'fin_pReserve']].map(([k, l]) => h('div', {}, h('div', { class: 'fv' }, sats(d.policy[k])), h('div', { class: 'fl' }, t(l)))))
        : policyForm(d.policy));
    const proposals = d.proposals?.length ? h('div', { class: 'card flush' }, h('h3', { class: 'pad' }, t('fin_proposals')), h('table', { class: 'list' },
      h('tr', {}, h('th', {}, 'id'), h('th', {}, t('fin_to')), h('th', {}, t('fin_amount')), h('th', {}, t('fin_fee')), h('th', {}, t('state')), h('th', {})),
      d.proposals.map(p => h('tr', {}, h('td', { class: 'num' }, p.id.slice(0, 10)), h('td', { class: 'num', title: p.to }, short(p.to)), h('td', { class: 'num' }, sats(p.amountSats)), h('td', { class: 'num' }, sats(p.feeSats)),
        h('td', {}, h('span', { class: `chip ${p.status === 'confirmed' ? 'ok' : ['unknown', 'rejected'].includes(p.status) ? 'err' : 'warn'}` }, t(`fin_st_${p.status}`))),
        h('td', {}, ['submitted', 'unknown', 'executing'].includes(p.status) && p.txid ? h('button', { class: 'btn sm', onClick: guard(async () => { const r = await api('finance.bitcoin.reconcile', { proposalId: p.id }); toast(`${t('fin_reconciled')} · ${t(`fin_st_${r.status}`)}`); await load('bitcoin'); }) }, t('fin_reconcile')) : null))))) : null;
    const txs = d.wallet?.exists ? h('div', { class: 'card flush' }, h('h3', { class: 'pad' }, t('fin_txs')),
      d.transactions?.length ? h('table', { class: 'list' }, h('tr', {}, h('th', {}, 'txid'), h('th', {}, t('fin_amount')), h('th', {}, t('state')), h('th', {}, t('fin_height')), h('th', {}, t('fin_date'))),
        d.transactions.slice(0, 50).map(x => h('tr', {}, h('td', { class: 'num', title: x.txid, style: 'cursor:copy', onClick: () => copy(x.txid) }, short(x.txid)),
          h('td', { class: `num ${x.deltaSats >= 0 ? 'up' : 'down'}` }, `${x.deltaSats >= 0 ? '+' : ''}${sats(x.deltaSats)} sat`),
          h('td', {}, h('span', { class: `chip ${x.confirmed ? 'ok' : 'warn'}` }, x.confirmed ? t('fin_confirmed') : t('fin_inMempool'))),
          h('td', { class: 'num' }, x.height ?? '—'), h('td', { class: 'num' }, x.time ? new Date(x.time).toLocaleString() : '—'))))
        : h('p', { class: 'pad status' }, t('fin_noTxs'))) : null;
    const conn = connectionForm('bitcoin', { network: ['signet', 'testnet4', 'testnet', 'mainnet'], esploraUrl: 'http://127.0.0.1:3002/api' }, t('fin_btcHelp'));
    return [top, panels, policy, proposals, txs, conn];
  }
  function policyForm(current) {
    const v = { maxPaymentSats: current?.maxPaymentSats ?? '', dailyLimitSats: current?.dailyLimitSats ?? '', maxFeeSats: current?.maxFeeSats ?? '', minReserveSats: current?.minReserveSats ?? '' };
    return h('div', {}, h('p', {}, t('fin_policyHelp')), h('div', { class: 'form tight' }, [['maxPaymentSats', 'fin_pMax'], ['dailyLimitSats', 'fin_pDay'], ['maxFeeSats', 'fin_pFee'], ['minReserveSats', 'fin_pReserve']].map(([k, l]) =>
      [h('label', {}, t(l)), h('input', { type: 'number', min: 0, class: 'num', value: v[k], onInput: e => { v[k] = e.target.value; } })])),
      h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn primary', onClick: guard(async () => { await api('finance.bitcoin.policy', Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x)]))); V.editPolicy = false; toast(t('fin_policySaved')); await load('bitcoin'); }) }, t('save')),
        current ? h('button', { class: 'btn ghost', onClick: () => { V.editPolicy = false; rerender(); } }, t('cancel')) : null));
  }
  function sendPanel(d) {
    if (!d.canSpend) return h('div', { class: 'card warnc' }, h('h3', {}, t('fin_send')), h('p', {}, t('fin_cannotSend')), h('ul', { class: 'blockers' }, d.spendBlockers.map(b => h('li', {}, blockerText(b)))));
    if (V.proposal) {
      const p = V.proposal;
      return h('div', { class: 'card review' }, h('h3', {}, '✋ ', t('fin_review')),
        h('dl', { class: 'kv big' }, [[t('fin_network'), p.network], [t('fin_to'), p.to], [t('fin_amount'), `${sats(p.amountSats)} sat`], [t('fin_fee'), `${sats(p.feeSats)} sat · ${p.feeRate} sat/vB`],
          [t('fin_total'), `${sats(p.amountSats + p.feeSats)} sat`], [t('fin_expires'), new Date(p.expiresAt).toLocaleTimeString()], ['id', p.id]].map(([k, val]) => [h('dt', {}, k), h('dd', { class: 'mono' }, val)])),
        h('p', { class: 'status' }, t('fin_reviewNote')),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', onClick: guard(async () => {
          if (!confirm(`${t('fin_confirmSend')} ${sats(p.amountSats)} sat → ${p.to}?`)) return;
          const r = await api('finance.bitcoin.execute', { proposalId: p.id, confirmedId: p.id }); V.proposal = null; toast(`${t('fin_st_' + r.status)} · ${r.txid || ''}`); await load('bitcoin');
        }) }, t('fin_confirmSendBtn')), h('button', { class: 'btn', onClick: () => { V.proposal = null; rerender(); } }, t('cancel'))));
    }
    const f = V.sendForm;
    return h('div', { class: 'card' }, h('h3', {}, t('fin_send')),
      h('div', { class: 'form tight' },
        h('label', {}, t('fin_to')), h('input', { type: 'text', class: 'mono', value: f.to, placeholder: 'tb1q…', onInput: e => { f.to = e.target.value.trim(); } }),
        h('label', {}, t('fin_amountSats')), h('input', { type: 'number', min: 1, class: 'num', value: f.amountSats, onInput: e => { f.amountSats = e.target.value; } }),
        h('label', {}, t('fin_feeRate')), h('input', { type: 'number', min: 1, class: 'num', value: f.feeRate, placeholder: String(d.fees?.halfHourFee ?? ''), onInput: e => { f.feeRate = e.target.value; } })),
      h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn primary', onClick: guard(async () => {
        V.proposal = await api('finance.bitcoin.prepare', { to: f.to, amountSats: Number(f.amountSats), feeRate: f.feeRate === '' ? null : Number(f.feeRate) }); rerender();
      }) }, t('fin_prepare')), h('span', { class: 'status' }, t('fin_prepareNote'))));
  }

  // ---------- other protocols ----------
  function lightningTab(d) {
    const out = [];
    if (d.env?.status === 'connected' && d.node) out.push(h('div', { class: 'fgrid' },
      h('div', { class: 'card balance' }, h('div', { class: 'brow' }, h('span', { class: 'blabel' }, `${t('fin_channels')} · ${d.node.alias || ''}`), envChip(d.env)),
        h('div', { class: 'bbig num' }, sats(d.balance.localSats), h('span', { class: 'unit' }, 'sat')),
        h('div', { class: 'bsub num' }, `${t('fin_remote')} ${sats(d.balance.remoteSats)} · on-chain ${sats(d.balance.onchainSats)}`), evidence(d.env)),
      h('div', { class: 'card' }, h('h3', {}, t('fin_node')), h('dl', { class: 'kv' }, [['pubkey', short(d.node.pubkey)], ['synced', String(d.node.synced)], [t('fin_height'), d.node.height], ['peers', d.node.peers], [t('fin_activeCh'), d.node.active]].map(([k, v]) => [h('dt', {}, k), h('dd', { class: 'mono' }, v)])))),
      d.channels?.length ? h('div', { class: 'card flush' }, h('h3', { class: 'pad' }, t('fin_channels')), h('table', { class: 'list' }, h('tr', {}, h('th', {}, 'peer'), h('th', {}, t('fin_capacity')), h('th', {}, t('fin_local')), h('th', {}, t('fin_remote')), h('th', {}, t('state'))),
        d.channels.map(c => h('tr', {}, h('td', { class: 'num' }, short(c.peer)), h('td', { class: 'num' }, sats(c.capacity)), h('td', { class: 'num up' }, sats(c.local)), h('td', { class: 'num' }, sats(c.remote)), h('td', {}, h('span', { class: `chip ${c.active ? 'ok' : ''}` }, c.active ? 'active' : 'inactive')))))) : null,
      h('p', { class: 'status' }, t('fin_readOnlyNow')));
    else out.push(statusCard(d, 'lightning'));
    out.push(connectionForm('lightning', { lndRestUrl: 'https://127.0.0.1:8080', lndMacaroonPath: '~/.lnd/data/chain/bitcoin/signet/readonly.macaroon', tlsCertPath: '~/.lnd/tls.cert' }, t('fin_lnHelp')));
    return out;
  }
  function taprootTab(d) {
    const out = [];
    if (d.env?.status === 'connected') out.push(h('div', { class: 'card flush' }, h('div', { class: 'brow pad' }, h('h3', {}, t('fin_assets')), envChip(d.env)),
      d.assets?.length ? h('table', { class: 'list' }, h('tr', {}, h('th', {}, t('fin_asset')), h('th', {}, 'id'), h('th', {}, t('fin_balance'))), d.assets.map(a => h('tr', {}, h('td', {}, a.name), h('td', { class: 'num' }, short(a.id)), h('td', { class: 'num' }, a.balance))))
        : h('p', { class: 'pad status' }, t('fin_noAssets')), h('div', { class: 'pad' }, evidence(d.env))));
    else out.push(statusCard(d, 'taproot'));
    out.push(connectionForm('taproot', { tapdRestUrl: 'https://127.0.0.1:8089', tapdMacaroonPath: '~/.tapd/data/signet/readonly.macaroon' }, t('fin_tapHelp')));
    return out;
  }
  function liquidTab(d) {
    const out = [];
    if (d.env?.status === 'connected') out.push(h('div', { class: 'fgrid' },
      h('div', { class: 'card balance' }, h('div', { class: 'brow' }, h('span', { class: 'blabel' }, `Liquid · ${d.env.network}`), envChip(d.env)), h('div', { class: 'bempty' }, t('fin_liquidNoWallet')), evidence(d.env)),
      h('div', { class: 'card flush' }, h('h3', { class: 'pad' }, t('fin_blocks')), h('table', { class: 'list' }, h('tr', {}, h('th', {}, t('fin_height')), h('th', {}, 'tx'), h('th', {}, t('fin_date'))),
        (d.blocks || []).map(b => h('tr', {}, h('td', { class: 'num' }, b.height), h('td', { class: 'num' }, b.txs), h('td', { class: 'num' }, new Date(b.time).toLocaleTimeString())))))));
    else out.push(statusCard(d, 'liquid'));
    out.push(connectionForm('liquid', { network: ['testnet', 'mainnet'], esploraUrl: 'https://blockstream.info/liquidtestnet/api' }, t('fin_liquidHelp')));
    return out;
  }
  function cashuTab(d) {
    const out = [];
    if (d.env?.status === 'connected') {
      const allowed = d.allowList?.includes(d.mintUrl);
      out.push(h('div', { class: 'fgrid' },
        h('div', { class: 'card balance' }, h('div', { class: 'brow' }, h('span', { class: 'blabel' }, d.env.mint?.name || 'Mint'), envChip(d.env)),
          h('div', { class: 'bempty mono' }, d.mintUrl), h('p', {}, d.env.mint?.description || ''), h('p', { class: 'status' }, t('fin_cashuWallet')), evidence(d.env)),
        h('div', { class: 'card' }, h('h3', {}, t('fin_cashuTest')), h('p', {}, t('fin_cashuRule')),
          h('div', { class: 'row' }, h('button', { class: `btn ${allowed ? '' : 'primary'}`, onClick: guard(async () => { if (!allowed && !confirm(`${t('fin_allowConfirm')} ${d.mintUrl}?`)) return; await api('finance.cashuAllow', { mintUrl: d.mintUrl, allowed: !allowed }); await load('cashu'); }) }, allowed ? t('fin_disallow') : t('fin_allow'))),
          h('div', { class: 'status', style: 'margin-top:8px' }, `NUTs: ${(d.env.mint?.nuts || []).join(', ')}`))));
    } else out.push(statusCard(d, 'cashu'));
    out.push(connectionForm('cashu', { network: ['testnet', 'regtest', 'mainnet'], mintUrl: 'https://testnut.cashu.space' }, t('fin_cashuHelp')));
    return out;
  }
  function statusCard(d, protocol) {
    if (!d) return h('div', { class: 'card' }, h('p', {}, '…'));
    if (d.env?.status === 'error' || d.error) return h('div', { class: 'card warnc' }, h('h3', {}, t('fin_error')), h('p', { class: 'mono' }, d.env?.error || d.error));
    return h('div', { class: 'card' }, h('h3', {}, t('fin_notConfigured')), h('p', {}, t(`fin_${protocol}Intro`)));
  }

  function page() {
    if (!V.started) { V.started = true; loadAll(); }
    const d = V.data[V.tab];
    const tabs = h('div', { class: 'ftabs', role: 'tablist' }, PROTOS.map(([id, label]) => h('button', { class: `ftab${V.tab === id ? ' on' : ''}`, role: 'tab', 'aria-selected': V.tab === id ? 'true' : 'false',
      onClick: () => { V.tab = id; V.panel = null; V.proposal = null; V.showEvidence = false; if (!V.data[id]) load(id); rerender(); } }, envDot(V.data[id]?.env), label)));
    const verifiedCount = PROTOS.filter(([id]) => V.data[id]?.env?.status === 'connected').length;
    const body = !d ? h('div', { class: 'card' }, h('span', { class: 'typing' }, h('i'), h('i'), h('i')), ' ', t('fin_loading'))
      : V.tab === 'bitcoin' ? (d.env ? bitcoinTab(d) : statusCard(d, 'bitcoin')) : V.tab === 'lightning' ? lightningTab(d) : V.tab === 'taproot' ? taprootTab(d) : V.tab === 'liquid' ? liquidTab(d) : cashuTab(d);
    return h('div', { class: 'page fin' },
      h('div', { class: 'fhead' }, h('div', {}, h('h1', {}, t('bitcoin')), h('p', { class: 'lead' }, t('bitcoinLead'))),
        h('div', { class: 'fsum' }, h('div', {}, h('div', { class: 'n num' }, `${verifiedCount} / 5`), h('div', { class: 'l' }, t('connected'))),
          h('button', { class: 'btn', onClick: loadAll }, `↻ ${t('fin_verifyAll')}`))),
      tabs, h('div', { class: 'fbody' }, body));
  }
  return { page, onEvent: payload => { if (payload.type === 'environment.changed') toast(`${payload.protocol}: ${payload.from} → ${payload.to}`, payload.to !== 'test'); } };
}
