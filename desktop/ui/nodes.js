export function createNodesView({ h, api, guard, toast, copyText, runInTerminal, assist }) {
  const english = () => document.documentElement.lang === 'en';
  const label = (it, en) => english() ? en : it;
  const warningText = code => ({ EXPERIMENTAL_MUTINYNET: label('Mutinynet è una rete sperimentale.', 'Mutinynet is an experimental network.'), CURATED_SOURCE_HASH_NOT_GUIX_ATTESTED: label('Compilazione locale da sorgenti fissate; nessuna attestazione Guix multi-builder.', 'Local build from pinned source; no Guix multi-builder attestation.'), BUILD_HAS_NO_WALLET: label('Questo nodo Mutinynet non include funzioni wallet.', 'This Mutinynet node has no wallet functionality.') })[code] || code;
  const state = { instances: [], jobs: [], status: {}, loaded: false, preview: null, error: null, busy: false, selected: null,
    input: { id: 'mainnet', network: 'mainnet', profile: 'full', explorer: false, datadir: '', rpcPort: '', p2pPort: '' } };
  const button = (text, click) => h('button', { class: 'btn', type: 'button', onClick: guard(click) }, text);
  const values = () => Object.fromEntries(Object.entries(state.input).filter(([, v]) => v !== ''));
  async function refresh() {
    const [instances, jobs, environment, candidates, commands] = await Promise.all([api('node.list'), api('node.jobs'), api('node.environment'), api('node.discover'), api('node.commands', values())]);
    state.candidates = candidates.filter(c => !instances.some(i => i.datadir === c.datadir)); state.instances = instances; state.jobs = jobs; state.commands = commands; state.environment = environment; state.loaded = true;
    for (const i of instances) { try { state.status[i.id] = await api('node.status', { id: i.id }); } catch (e) { state.status[i.id] = { error: { message: e.message } }; } }
  }
  function updateCommands(redraw) { state.commands = null; api('node.commands', values()).then(commands => { state.commands = commands; redraw(); }).catch(error => { state.error = error.message; redraw(); }); }
  async function execute(action, input, redraw) {
    await api('node.execute', { action, input, confirmed: true }); state.preview = null; await refresh(); redraw();
  }
  function page(redraw) {
    const root = h('section', { class: 'node-page' }, h('h1', {}, label('Nodo Bitcoin', 'Bitcoin node')),
      h('p', {}, label('Installa e gestisci il tuo nodo. Il wizard funziona anche senza AI.', 'Install and manage your node. The wizard also works without AI.')));
    if (!state.loaded) { refresh().then(redraw).catch(e => { state.error = e.message; state.loaded = true; redraw(); }); return h('section', { class: 'node-page' }, root, label('Caricamento…', 'Loading…')); }
    root.append(h('div', { class: 'row' }, button(label('Aggiorna stato', 'Refresh'), async () => { await refresh(); redraw(); }),
      button(label('Assistenza Merkle', 'Merkle assistance'), () => assist('Use the bitcoin-fullnode skill. Coordinate NODE, SCRIPT and HASH to inspect my local node installation. Read status before proposing changes.'))));
    if (state.error) root.append(h('p', { role: 'alert' }, state.error));
    for (const candidate of state.candidates || []) root.append(h('article', { class: 'node-card' }, h('h2', {}, label('Nodo rilevato', 'Detected node')), h('p', {}, `${candidate.network} · ${candidate.datadir}`), h('p', {}, label('Candidato da verificare tramite RPC; nessuna modifica eseguita.', 'Candidate to verify using RPC; no changes made.')), button(label('Prepara collegamento', 'Prepare connection'), () => { state.input = { ...state.input, id: `${candidate.network}-existing`, network: candidate.network, datadir: candidate.datadir, rpcPort: candidate.rpcPort }; state.preview = null; updateCommands(redraw); redraw(); })));
    for (const i of state.instances) {
      const s = state.status[i.id] || {}; const card = h('article', { class: 'node-card' }, h('h2', {}, `${i.id} · ${i.network}`),
        h('p', {}, `${i.mode} · ${s.ready ? label('Pronto', 'Ready') : i.phase}`),
        h('p', {}, s.core?.blocks != null ? `Core: ${s.core.blocks} / ${s.core.headers}` : label('Core non raggiungibile', 'Core unavailable')),
        h('p', {}, s.explorerStatus?.enabled ? `electrs: ${s.explorerStatus.indexedHeight ?? '…'} · API: ${s.explorerStatus.apiHeight ?? '…'}` : label('Explorer disabilitato', 'Explorer disabled')),
        h('p', { class: 'mono' }, i.datadir));
      if (s.error) card.append(h('p', { role: 'status' }, s.error.message));
      card.append(button(label('Usa per RPC bitcode', 'Use for bitcode RPC'), () => { state.preview = { action: 'use', input: { id: i.id }, detail: { id: i.id, network: i.network, changes: i.explorer ? label('Cambia la rete Bitcoin di bitcode e usa RPC ed explorer locali.', 'Changes the Bitcoin network in bitcode and uses local RPC and explorer.') : label('Cambia la rete Bitcoin e la connessione RPC di bitcode. Le consultazioni tramite explorer usano il servizio predefinito della rete.', 'Changes the Bitcoin network and RPC connection in bitcode. Explorer lookups use the network default service.') } }; redraw(); }));
      if (i.phase === 'error' || i.phase === 'interrupted') card.append(button(label('Diagnosi interruzione', 'Interruption diagnosis'), async () => { const detail = await api('node.doctor', { id: i.id }); state.preview = { action: 'recover', input: { id: i.id }, detail }; redraw(); }));
      if (i.mode === 'installing') card.append(button(label('Riprendi installazione', 'Resume installation'), async () => { state.preview = { action: 'install', input: i, detail: await api('node.plan', i), resume: true }; redraw(); }));
      if (['managed', 'adopted'].includes(i.mode)) for (const action of ['start', 'stop', 'restart', 'update', 'uninstall']) card.append(button(action, () => { state.preview = { action, input: { id: i.id }, detail: { action, id: i.id, dataPreserved: true } }; redraw(); }));
      if (s.explorerStatus?.ready) {
        card.append(button(label('Explorer nel Desktop', 'Explorer in Desktop'), () => { state.selected = i; redraw(); }), button(label('Apri nel browser', 'Open in browser'), () => api('app.openExternal', { url: s.explorerStatus.url })));
      }
      root.append(card);
    }
    if (state.selected) root.append(h('section', {}, button(label('Chiudi explorer', 'Close explorer'), () => { state.selected = null; redraw(); }),
      h('iframe', { class: 'node-explorer', title: 'bitcode Bitcoin explorer', src: `http://127.0.0.1:${state.selected.ports.web}/${english() ? '' : 'it/'}`, sandbox: 'allow-scripts allow-same-origin allow-forms', referrerpolicy: 'no-referrer' })));
    const form = h('section', { class: 'node-card' }, h('h2', {}, label('Nuovo nodo o nodo esistente', 'New or existing node')));
    function field(title, key, items) {
      const control = items ? h('select', { 'aria-label': title, onChange: e => { if (key === 'network' && state.input.id === state.input.network) state.input.id = e.target.value; state.input[key] = e.target.value; if (key === 'profile' && e.target.value === 'pruned') state.input.explorer = false; updateCommands(redraw); redraw(); } }, items.map(value => h('option', { value, selected: value === state.input[key] }, key === 'network' && value === 'testnet' ? label('Testnet3 · solo collegamento', 'Testnet3 · connection only') : value)))
        : h('input', { 'aria-label': title, value: state.input[key], onInput: e => { state.input[key] = e.target.value; state.preview = null; } });
      form.append(h('label', {}, title, control));
    }
    field(label('Nome istanza', 'Instance name'), 'id'); field(label('Rete', 'Network'), 'network', ['mainnet', 'signet', 'testnet4', 'mutinynet', 'testnet']);
    field(label('Archivio', 'Storage'), 'profile', ['full', 'pruned']); field(label('Porta RPC (vuota = predefinita)', 'RPC port (empty = default)'), 'rpcPort'); field(label('Porta P2P (vuota = predefinita)', 'P2P port (empty = default)'), 'p2pPort'); field(label('Cartella dati assoluta (vuota = predefinita)', 'Absolute data directory (empty = default)'), 'datadir');
    form.append(h('label', {}, h('input', { type: 'checkbox', checked: state.input.explorer, disabled: state.input.profile === 'pruned', onChange: e => { state.input.explorer = e.target.checked; state.preview = null; updateCommands(redraw); } }), label('Explorer mempool con tema bitcode', 'mempool explorer with bitcode theme')));
    for (const action of ['install', 'connect', 'adopt']) form.append(button({ install: label('Prepara installazione', 'Prepare installation'), connect: label('Collega', 'Connect'), adopt: label('Adotta gestione', 'Adopt management') }[action], async () => {
      const input = values(); if (action === 'adopt' && input.explorer) input.services = ['bitcoind', 'electrs', 'mempool-backend']; const detail = action === 'install' ? await api('node.plan', input) : { action, ...input, dataPreserved: true, services: action === 'adopt' ? input.services || ['bitcoind'] : undefined };
      state.preview = { action, input, detail }; redraw();
    }));
    root.append(form);
    if (state.preview) {
      const p = state.preview;
      const review = h('section', { class: 'node-card' }, h('h2', {}, label('Riepilogo da approvare', 'Review changes')), h('p', {}, `${p.action} · ${p.input.id || p.input.network || ''}`), h('p', {}, p.input.datadir || label('Cartella dati predefinita', 'Default data directory')), p.detail.reserveGB ? h('p', {}, `${label('Spazio previsto', 'Estimated storage')}: ${p.detail.reserveGB} GB + 10%`) : null, ...(Array.isArray(p.detail.changes) ? p.detail.changes : p.detail.changes ? [p.detail.changes] : []).map(change => h('p', {}, change)), ...(p.detail.warnings || []).map(warning => h('p', { role: 'status' }, warningText(warning))), ...(p.detail.errors || []).map(error => h('p', { role: 'alert' }, error)), h('details', {}, h('summary', {}, label('Dettagli tecnici', 'Technical details')), h('pre', {}, JSON.stringify(p.detail, null, 2))));
      if (!p.detail.errors?.length || p.resume) review.append(button(label('Conferma operazione', 'Confirm operation'), () => execute(p.action, p.input, redraw)));
      review.append(button(label('Annulla', 'Cancel'), () => { state.preview = null; redraw(); })); root.append(review);
    }
    const commands = state.commands;
    root.append(h('section', { class: 'node-card' }, h('h2', {}, label('Preparazione amministrativa · Terminale', 'Administrative setup · Terminal')),
      h('p', {}, label('Installa prima l’helper, poi le dipendenze. Controlla i comandi: l’autenticazione avviene nel sistema.', 'Install the helper first, then dependencies. Review the commands: authentication takes place in the operating system.')),
      ...Object.entries(commands || {}).map(([name, command]) => h('div', {}, h('strong', {}, name), h('pre', {}, command), button(label('Copia', 'Copy'), () => copyText(command)), h('button', { class: 'btn', type: 'button', onClick: event => runInTerminal(command, event.currentTarget, event) }, label('Esegui nel Terminale', 'Run in Terminal')))),
      button(label('Installa dipendenze con autenticazione di sistema', 'Install dependencies with system authentication'), () => execute('dependencies', values(), redraw))));
    if (state.jobs.length) root.append(h('section', { class: 'node-card' }, h('h2', {}, label('Operazioni', 'Operations')), ...state.jobs.map(j => h('p', { role: 'status' }, `${j.action} · ${j.id} · ${j.status}${j.error ? ' · ' + j.error.message : ''}`))));
    clearInterval(state.timer);
    state.timer = setInterval(async () => { if (!root.isConnected) { clearInterval(state.timer); return; } if (state.polling) return; state.polling = true; try { await refresh(); if (root.isConnected && !state.selected && !state.preview && !root.querySelector('input:focus,select:focus,textarea:focus')) redraw(); } catch (error) { state.error = error.message; } finally { state.polling = false; } }, 10_000);
    return root;
  }
  return { page, refresh, invalidate: () => { state.loaded = false; } };
}
