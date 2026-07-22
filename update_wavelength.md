# Piano di Integrazione Wavelength ↔ bitcode
## Pagamenti Bitcoin/Lightning/Ark self-custodial senza nodo, via API

> **Priorità:** Colmare il gap "Lightning senza nodo" mantenendo la self-custody
> **Principio chiave:** le chiavi restano sul dispositivo dell'utente; bitcode non diventa un wallet di custodia
> **Stato:** Proposta
> **Data:** 2026-07-22

---

## 1. Cos'è Wavelength

[Wavelength](https://wavelength.lightning.engineering/) è il nuovo toolkit di
Lightning Labs (annunciato a luglio 2026) per aggiungere pagamenti Bitcoin
**self-custodial** a qualsiasi applicazione:

- **Un'unica API coerente** su Bitcoin on-chain, Lightning e Ark, con la
  stessa invoice familiare per ogni pagamento.
- **Nessun nodo da gestire**: niente canali, niente liquidità da procurare,
  niente LND da amministrare. Il layer di settlement è di tipo Ark
  (VTXO — virtual UTXO — che si regolano on-chain in batch).
- **Self-custodial**: le chiavi restano sul dispositivo che esegue il wallet
  engine, non presso Lightning Labs.
- **Pensato per gli agenti AI**: supporto dichiarato per tool call MCP, così
  che software autonomo possa pagare API, data feed e servizi in Bitcoin.
- SDK web/mobile (TypeScript) con configurazione di default su **signet**
  per lo sviluppo.

### Perché è rilevante per bitcode

Oggi il modulo `src/lightning/` è dichiaratamente opt-in: i tool `ln_*`
esistono solo se l'utente configura un **proprio nodo LND**
(`config.lightning.lndRestUrl`), perché — come annota `src/lightning/tools.mjs` —
*"no public fallback exists for Lightning the way mempool.space covers
Bitcoin"*. Wavelength cambia esattamente questa premessa: pagamenti
Lightning self-custodial **senza** un nodo proprio. Per bitcode significa:

1. **Lightning per tutti gli utenti**, non solo per chi amministra un LND.
2. **Pagamenti machine-to-machine**: l'agente può pagare invoice (API a
   pagamento, L402, servizi) e riceverne, il caso d'uso nativo di un coding
   agent Bitcoin.
3. **Stablecoin**: Wavelength dichiara supporto a pagamenti in stablecoin
   (Taproot Assets), complementare ai tool `taproot_asset_*` esistenti.

---

## 2. Punti aperti della Fase 0 — stato (2026-07-22)

Il sito docs resta bloccato dal proxy di questo ambiente, ma i tarball npm
ufficiali (`@lightninglabs/wavelength-core@0.1.0` e `wavelength-web@0.1.0`)
contengono l'intero contratto TypeScript dell'SDK, con JSDoc estese. Le
verifiche sono state fatte **sul codice pubblicato**, non su fonti
secondarie:

| # | Verifica | Esito |
|---|---|---|
| V1 | Pacchetti/licenza | ✅ Monorepo `lightninglabs/wavelength-sdk`, MIT: `wavelength-core` / `-web` (WASM) / `-react` / `-react-native`, v0.1.0 del 2026-07-21 |
| V2 | Superficie API | ✅ **L'SDK non è un client REST sottile**: incapsula il daemon Go `wavewalletdk` (WASM nel browser, nativo su mobile) che parla lui col mondo — operatore Ark e swap server via REST gateway (web) o gRPC (nativo), chain via Esplora. Gateway pubblici: `https://signet.wavelength-rest.lightning.finance` (+ testnet/testnet4, swap su `*.swapd-rest.lightning.finance`, Esplora su `*.lightningcluster.com`). La logica wallet (chiavi, firma VTXO, round) vive nel daemon: un client REST zero-dep significherebbe reimplementare il protocollo Ark → non percorribile |
| V3 | Autenticazione | ✅ Nessuna API key: self-custodial puro. Il wallet si sblocca con password locale (o passkey WebAuthn/PRF su web). Nessun segreto verso terzi |
| V4 | Reti | ✅ `mainnet\|testnet\|testnet4\|signet\|regtest`; endpoint pubblici solo per testnet/testnet4/signet. **Mainnet non ha ancora un deployment pubblico** e l'SDK rifiuta config mainnet senza `allowMainnet: true` esplicito → il nostro default signet (G1) è confermato e per ora obbligato |
| V5 | Seed | ✅ BIP-39 mnemonic (+ passphrase opzionale), generata da `createWallet` o fornita per il restore (`recoverState` + `recoveryWindow`, ricostruzione via indexer dell'operatore). Stato in `dataDir` (filesystem; OPFS su web) |
| V6 | Fee | ✅ (parziale) `maxOperatorFeeSat` limita la fee dell'operatore per round; `maxFeeSat` per singolo invio; il flusso `prepareSend` → quote → `sendPrepared` separa preventivo e invio. Listino dell'operatore: da leggere sul sito docs |
| V7 | Unilateral exit | ✅ Esiste: `exit()` con percorso cooperativo o unroll unilaterale (richiede l'ack letterale `I_KNOW_WHAT_I_AM_DOING`), più `getExitPlan`/`exitStatus`/`exitSummary`/`sweepWallet` per pianificare e monitorare |
| V8 | MCP ufficiale | ⏳ Aperto. Esiste `@lightninglabs/lightning-mcp-server`, ma è orientato a LND/L402; un eventuale MCP Wavelength-nativo va verificato sul sito docs |

**Residuo Fase 0** (richiede il sito docs da rete non filtrata): listino fee
dell'operatore (V6), MCP nativo (V8), e come vengono distribuiti i runtime
asset del daemon (Sezione 2-bis).

### 2-bis. Architettura reale dell'SDK (dai tarball)

```
app (JS)
  └─ WalletEngine / WavelengthClient   (wavelength-core: contratto tipato)
       └─ transport                    (web: Worker + WASM; RN: modulo nativo)
            └─ daemon wavewalletdk     (Go; chiavi, VTXO, round, swap Lightning)
                 ├─ Ark operator       REST/gRPC (round, settlement, mailbox)
                 ├─ swap server        REST/gRPC (Lightning send/receive via swap)
                 └─ Esplora            REST (stato chain, backend lwwallet)
```

Fatti rilevanti per bitcode:

- **Runtime da hostare**: il transport web carica un set di asset
  (`wavewalletdk.wasm`, `wasm_exec.js`, SQLite WASM + proxy **OPFS**) da un
  `runtimeBaseUrl` che l'app hosta da sé; si ottengono dalle release del
  repo `wavelength` o con `make wasm-wallet`. Lo storage SQLite è costruito
  su OPFS/Worker **del browser**: il transport web così com'è non gira in
  Node.
- **Contratto client completo** (`WavelengthClient`): `start/stop`,
  `createWallet/unlockWallet/openWalletFromPasskey`, `balance`, `deposit`
  (indirizzo on-chain), `receive(amountSat, memo)` → invoice unificata,
  `prepareSend`/`sendPrepared`/`send`, `list` (activity | vtxos | onchain,
  paginata), `exit*`, `sweepWallet`, eventi via `subscribe` +
  `startActivity`.
- **Rail di invio**: `SendRequest` è un'unione discriminata `invoice`
  (BOLT11) | `onchainAddress`; il daemon sceglie il rail (`InArk`,
  `Lightning`, `Onchain`, `Credit`, `Mixed`). **v1 richiede invoice con
  importo** (niente zero-amount), il che semplifica il nostro pre-flight.
- **Niente stablecoin nell'API v0.1.0**: nessun riferimento a Taproot
  Assets nei tipi. Il supporto stablecoin annunciato arriverà dopo: la
  Fase 4 è ridimensionata di conseguenza.

---

## 3. Architettura proposta

Nuovo modulo `src/wavelength/`, gemello strutturale di `src/lightning/`:

```
src/wavelength/
  network.mjs   — risolve config.wavelength (rete, endpoint, percorso chiavi);
                  ritorna null se non configurato → tool non registrati
  engine.mjs    — wrapper del wallet engine (SDK vendored o client REST,
                  a seconda dell'esito di V1/V2)
  tools.mjs     — definizione dei tool wl_* per l'agente
```

Registrazione in `src/tools.mjs` (`buildTools`) accanto agli altri moduli:

```js
...(wavelength ? wavelengthTools(wavelength) : []),
```

Config in `~/.bitcode/config.json`:

```jsonc
{
  "wavelength": {
    "network": "signet",            // preset pubblici: signet|testnet|testnet4
    "dataDir": "~/.bitcode/wavelength/", // stato del daemon (RuntimeConfig.dataDir)
    "maxPaySats": 50000,            // tetto per singolo pagamento (G3)
    "maxOperatorFeeSat": 1000,      // cap fee operatore per round (RuntimeConfig)
    "arkServerAddress": null,       // override endpoint operatore (default: preset di rete)
    "swapServerAddress": null       // override swap server (default: preset di rete)
  }
}
```

Coesistenza con LND: i due backend non si escludono. Se entrambi sono
configurati, i tool `ln_*` (nodo proprio) e `wl_*` (Wavelength) convivono e
il system prompt (`src/agent.mjs`) descrive entrambi. Va aggiornata la nota
"no public fallback exists for Lightning" in `src/lightning/tools.mjs`, che
con Wavelength non è più vera.

### Vincolo zero-dependency — decisione aggiornata

bitcode è "zero-dependency: no build step, no node_modules". L'analisi dei
tarball (Sezione 2-bis) elimina l'ipotesi del client REST puro: i gateway
pubblici parlano il protocollo dell'operatore Ark, non un'API wallet — la
logica di firma e i round vivono nel daemon `wavewalletdk`, e
reimplementarli a mano sarebbe un wallet Ark da zero. Strade rimaste:

- **Opzione B (preferita) — daemon vendored** sul modello esatto di
  `deps/cdk` + `scripts/build-cdk.sh` (Cashu): uno script
  `scripts/build-wavelength.sh` compila il daemon Go dal repo `wavelength`
  di Lightning Labs (lo stesso da cui `make wasm-wallet` produce il runtime
  WASM) e `engine.mjs` lo pilota come processo locale, come
  `src/cashu/wallet.mjs` fa con `cdk-cli`. Nessun `node_modules` a runtime.
  Prerequisito da confermare sul repo: esistenza di un target di build
  nativo con interfaccia CLI o gRPC/REST locale (i log del daemon citano il
  sottosistema `ROND`, che suggerisce un server daemon).
- **Opzione C (fallback) — runtime WASM in Node**: `wasm_exec.js` (runtime
  Go) gira anche in Node, ma lo storage SQLite del transport web è
  costruito su OPFS/Worker del browser; servirebbe uno shim Node (es.
  `node:sqlite`) al posto del layer OPFS. Fattibile ma più fragile agli
  aggiornamenti dell'SDK: da tentare solo se l'Opzione B si rivela
  impraticabile.

In entrambi i casi `engine.mjs` resta il confine: i tool `wl_*` non sanno
quale opzione c'è sotto.

---

## 4. Superficie tool proposta

Allineata al contratto reale `WavelengthClient` (Sezione 2-bis):

| Tool | Mutating | Mappa su | Descrizione |
|---|---|---|---|
| `wl_info` | no | `getInfo` + `status` | Stato del wallet engine: rete, fase runtime, connessione all'operatore |
| `wl_balance` | no | `balance` | Saldo self-custodial (confermato + inbound pendente) |
| `wl_receive` | no | `receive({amountSat, memo})` | Invoice unificata per ricevere |
| `wl_deposit` | no | `deposit` | Indirizzo on-chain di deposito (boarding) |
| `wl_quote` | no | `prepareSend` | Preventivo di un pagamento: fee, rail, `sendIntentId` monouso — senza muovere fondi |
| `wl_pay` | **sì** | `sendPrepared` | Esegue il pagamento preventivato da `wl_quote`. Irreversibile: stessa disclosure e conferma esplicita di `ln_invoice_pay`/`wallet_send`. Il flusso a due passi quote → conferma utente → invio è nativo dell'SDK, non una nostra sovrastruttura |
| `wl_history` | no | `list` | Attività recente (send/receive/deposit/exit), VTXO e on-chain |
| `wl_exit` | **sì** | `getExitPlan` → `exit` | Uscita on-chain: preview del piano, poi exit cooperativo; l'unroll unilaterale richiede l'ack letterale `I_KNOW_WHAT_I_AM_DOING`, che il tool esige ripetuto dall'utente, mai auto-fornito dall'agente |

Il decoder `ln_decode_invoice` (bolt11, già presente e senza dipendenze)
resta il pre-flight obbligatorio di `wl_quote`/`wl_pay`: prima di pagare,
l'agente decodifica e mostra importo/destinazione all'utente (v1 accetta
solo invoice con importo, quindi il confronto è sempre possibile).

Comandi bundled: nuova cartella `commands/wl/` sul modello di
`commands/btc/`: `/wl:setup` (onboarding guidato: crea wallet, mostra
disclosure, backup del seed), `/wl:balance`, `/wl:receive`, `/wl:pay
<invoice>` (stesso approval gate di `/btc:send`).

---

## 5. Guardrail

| # | Regola | Dettaglio |
|---|---|---|
| G1 | **Signet di default** | Mainnet solo con `"network": "mainnet"` esplicito in config, mai inferito. |
| G2 | **Conferma esplicita sui pagamenti** | `wl_pay` e `wl_exit` sono `mutating: true`: stesso approval gate di `wallet_send`/`ln_invoice_pay`. L'agente mostra importo, destinazione e fee stimata prima di chiedere conferma. |
| G3 | **Tetto per pagamento** | `maxPaySats` (default 50k sats) applicato in `engine.mjs`, non solo nel prompt: un pagamento oltre soglia fallisce lato codice. |
| G4 | **Custodia del seed dichiarata** | Il wallet engine è self-custodial ma le chiavi vivono sulla macchina dove gira bitcode. Al primo `/wl:setup`: disclosure obbligatoria (modello Sezione 0 di `update_cj.md` + `legal_contract.md`), backup del seed mostrato una sola volta, consenso loggato. bitcode non è un posto dove tenere fondi significativi. |
| G5 | **Seed mai nel contesto del modello** | Il seed è letto/scritto solo da `engine.mjs`; nessun tool lo ritorna, nessun log lo contiene (stessa best practice di `update_stack.md`: "non esporre mai la seed all'AI"). |
| G6 | **File chiavi con permessi 0600** | `~/.bitcode/wavelength/` creato con permessi restrittivi, come i wallet esistenti. |
| G7 | **Trust assumption esplicita** | La disclosure spiega che il settlement Ark dipende dalla liveness dell'operatore tra un round e l'altro e documenta la procedura di unilateral exit (V7). Non vendere Wavelength come equivalente a un nodo proprio. |
| G8 | **TLS mai disabilitato** | Come per LND: cert pinning o CA di sistema, mai `rejectUnauthorized: false`. |

---

## 6. Fasi di lavoro

| Fase | Contenuto | Exit criteria |
|---|---|---|
| **0 — Ricognizione** | ~~Verifiche V1–V8~~ **chiusa al 90% il 2026-07-22 via tarball npm** (Sezione 2). Residuo: fee operatore, MCP nativo, distribuzione runtime asset — e conferma del target di build nativo del daemon (Opzione B) sul repo `wavelength` | Sezioni 3–4 senza incognite ✅ (salvo residuo) |
| **1 — Engine + read-only su signet** | `scripts/build-wavelength.sh` (Opzione B) o shim Node (Opzione C); `network.mjs` + `engine.mjs` + `wl_info`/`wl_balance`; test unit con engine mockato (pattern di `tests/tools.test.mjs`) | `wl_info` verde su signet in CI locale |
| **2 — Ricezione** | `wl_receive` + `wl_deposit` + `wl_history`; `/wl:setup` con disclosure, password wallet e backup mnemonic | Invoice creata e pagata su signet da un wallet esterno |
| **3 — Pagamento** | `wl_quote` + `wl_pay` (flusso nativo prepareSend/sendPrepared) con guardrail G2/G3, pre-flight `ln_decode_invoice` | Pagamento signet end-to-end con conferma utente |
| **4 — Exit + (poi) mainnet** | `wl_exit` con preview `getExitPlan`; mainnet **solo quando Lightning Labs apre il deployment pubblico** (oggi inesistente, `allowMainnet` richiesto); stablecoin rinviate a quando compariranno nell'API dell'SDK | Exit cooperativa testata su signet; disclosure completa |
| **5 — Documentazione** | README (sezione accanto a Lightning/LND), `update_stack.md`, system prompt in `src/agent.mjs` | `/doctor` riporta lo stato Wavelength |

Ogni fase è un commit autonomo su questo branch; niente fase N+1 finché la
N non ha test verdi (`node --test tests/`).

---

## 7. Fonti ufficiali

### Wavelength

- https://wavelength.lightning.engineering/ — sito e documentazione ufficiale
  (quickstart, guide, indice `llms.txt` per agenti; non raggiungibile dal
  proxy di questo ambiente, da consultare in Fase 0)
- https://github.com/lightninglabs/wavelength-sdk — monorepo ufficiale
  dell'SDK (MIT): `packages/core`, `packages/web`, `packages/react`,
  `packages/react-native`
- Pacchetti npm (tutti v0.1.0, 2026-07-21; maintainer Lightning Labs —
  roasbeef et al.):
  - [`@lightninglabs/wavelength-core`](https://www.npmjs.com/package/@lightninglabs/wavelength-core) — contratto transport/framework-agnostic
  - [`@lightninglabs/wavelength-web`](https://www.npmjs.com/package/@lightninglabs/wavelength-web) — transport browser (WebAssembly)
  - [`@lightninglabs/wavelength-react`](https://www.npmjs.com/package/@lightninglabs/wavelength-react) — provider e hook React
  - [`@lightninglabs/wavelength-react-native`](https://www.npmjs.com/package/@lightninglabs/wavelength-react-native) — transport React Native

### Contorno Lightning Labs (utile per L402/MCP e riferimenti API)

- https://lightning.engineering/api-docs/ — API reference generata (LND,
  Loop, Pool, Faraday, Taproot Assets)
- https://docs.lightning.engineering/ — Builder's Guide
- [`@lightninglabs/lightning-mcp-server`](https://www.npmjs.com/package/@lightninglabs/lightning-mcp-server)
  (repo [lightning-agent-tools](https://github.com/lightninglabs/lightning-agent-tools)) —
  MCP server ufficiale con pagamenti L402
- [`@lightninglabs/l402`](https://www.npmjs.com/package/@lightninglabs/l402) /
  [`@lightninglabs/l402-ai`](https://www.npmjs.com/package/@lightninglabs/l402-ai)
  (repo [L402sdk](https://github.com/lightninglabs/L402sdk)) — client L402
- https://lightning.engineering/blog/ — annuncio del lancio

### Copertura del lancio e precedenti interni

- [Bitcoin News](https://x.com/BitcoinNewsCom/status/2079654926548951487), [bitcoin++ insider](https://x.com/btcinsider__/status/2079627295573061692)
- Precedenti interni: `src/lightning/` (pattern client REST opt-in), `deps/cdk` + `scripts/build-cdk.sh` (pattern SDK vendored), `update_cj.md` (pattern disclosure custodia)
