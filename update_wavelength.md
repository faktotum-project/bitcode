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

## 2. Punti aperti da verificare (Fase 0)

L'annuncio è di pochi giorni fa e la documentazione completa non è ancora
stata verificata da questo ambiente (accesso di rete al sito bloccato dal
proxy). Prima di scrivere codice va confermato:

| # | Da verificare | Impatto |
|---|---|---|
| V1 | Nome esatto e licenza del pacchetto SDK npm (non ancora indicizzato su registry.npmjs.org alla data odierna) | Sceglie tra opzione vendored SDK e client REST (Sezione 4) |
| V2 | Esiste un'API REST/gRPC documentata sotto l'SDK, o l'SDK è l'unica superficie? | Il client "zero-dependency" è possibile solo con un'API di rete documentata |
| V3 | Modello di autenticazione (API key? macaroon? firma con chiave locale?) | Gestione segreti in config |
| V4 | Reti supportate al lancio (solo signet? mainnet?) | Default di sicurezza |
| V5 | Dove vive il seed/chiave del wallet engine e in che formato (mnemonic? descriptor?) | Custodia e backup (Sezione 5) |
| V6 | Modello di fee e condizioni del servizio (l'operatore Ark firma i batch: quali trust assumption esatte?) | Disclosure all'utente |
| V7 | Meccanica di unilateral exit (uscita on-chain senza cooperazione dell'operatore) | Requisito minimo per definirlo davvero self-custodial |
| V8 | Server MCP ufficiale di Wavelength: se esiste, bitcode può usarlo via `src/mcp.mjs` senza scrivere un client | Potrebbe ridurre la Fase 2 a pura configurazione |

**Azione Fase 0:** da una macchina senza restrizioni di rete, leggere
https://wavelength.lightning.engineering/ (docs + quickstart), annotare le
risposte V1–V8 in questo file e aggiornare le sezioni successive.

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
    "network": "signet",          // default prudente; "mainnet" esplicito
    "walletPath": "~/.bitcode/wavelength/", // stato+chiavi del wallet engine
    "maxPaySats": 50000,           // tetto per singolo pagamento (G3)
    "endpoint": null               // override endpoint operatore, se documentato
  }
}
```

Coesistenza con LND: i due backend non si escludono. Se entrambi sono
configurati, i tool `ln_*` (nodo proprio) e `wl_*` (Wavelength) convivono e
il system prompt (`src/agent.mjs`) descrive entrambi. Va aggiornata la nota
"no public fallback exists for Lightning" in `src/lightning/tools.mjs`, che
con Wavelength non è più vera.

### Vincolo zero-dependency

bitcode è "zero-dependency: no build step, no node_modules". Due strade,
con precedente nel repo:

- **Opzione A — client REST puro** (stile `src/lightning/lnd.mjs`): se V2
  conferma un'API di rete documentata, si scrive un client su
  `src/http.mjs`. Preferita: coerente con la filosofia del progetto.
- **Opzione B — SDK vendored** (stile `deps/cdk` + `scripts/build-cdk.sh`
  usato per Cashu): se l'SDK TypeScript è l'unica superficie supportata, lo
  si vendorizza con uno script `scripts/build-wavelength.sh` che produce un
  bundle ESM senza `node_modules` a runtime.

Decisione rinviata alla fine della Fase 0; il resto del piano è identico in
entrambi i casi perché `engine.mjs` fa da confine.

---

## 4. Superficie tool proposta

| Tool | Mutating | Descrizione |
|---|---|---|
| `wl_info` | no | Stato del wallet engine: rete, connessione all'operatore, altezza round |
| `wl_balance` | no | Saldo self-custodial (VTXO + eventuale on-chain in transito, e stablecoin se supportate) |
| `wl_receive` | no | Crea invoice/indirizzo unificato per ricevere (amount, memo, expiry) |
| `wl_pay` | **sì** | Paga un'invoice unificata (BOLT11/Ark/on-chain). Irreversibile: stessa disclosure e conferma esplicita di `ln_invoice_pay` e `wallet_send` |
| `wl_history` | no | Pagamenti inviati/ricevuti recenti |
| `wl_exit` | **sì** | Unilateral exit on-chain (uscita di sicurezza dall'operatore) — se V7 lo espone via API |

Il decoder `ln_decode_invoice` (bolt11, già presente e senza dipendenze)
resta il pre-flight obbligatorio di `wl_pay`: prima di pagare, l'agente
decodifica e mostra importo/destinazione all'utente.

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
| **0 — Ricognizione** | Verifiche V1–V8 sulla doc ufficiale; scelta Opzione A/B; aggiornamento di questo piano | Sezioni 3–4 senza incognite |
| **1 — Read-only su signet** | `network.mjs` + `engine.mjs` + `wl_info`/`wl_balance`; test unit con engine mockato (pattern di `tests/tools.test.mjs`) | `wl_info` verde su signet in CI locale |
| **2 — Ricezione** | `wl_receive` + `wl_history`; `/wl:setup` con disclosure e backup seed | Invoice creata e pagata su signet da un wallet esterno |
| **3 — Pagamento** | `wl_pay` con guardrail G2/G3, pre-flight `ln_decode_invoice` | Pagamento signet end-to-end con conferma utente |
| **4 — Mainnet + stablecoin** | Abilitazione mainnet esplicita; supporto stablecoin se disponibile; `wl_exit` | Disclosure completa; exit testata su signet |
| **5 — Documentazione** | README (sezione accanto a Lightning/LND), `update_stack.md`, system prompt in `src/agent.mjs` | `/doctor` riporta lo stato Wavelength |

Ogni fase è un commit autonomo su questo branch; niente fase N+1 finché la
N non ha test verdi (`node --test tests/`).

---

## 7. Fonti

- https://wavelength.lightning.engineering/ — sito e documentazione ufficiale
- https://lightning.engineering/blog/ — annuncio Lightning Labs
- Copertura del lancio: [Bitcoin News](https://x.com/BitcoinNewsCom/status/2079654926548951487), [bitcoin++ insider](https://x.com/btcinsider__/status/2079627295573061692)
- Precedenti interni: `src/lightning/` (pattern client REST opt-in), `deps/cdk` + `scripts/build-cdk.sh` (pattern SDK vendored), `update_cj.md` (pattern disclosure custodia)
