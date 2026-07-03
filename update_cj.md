# Piano di Integrazione JoinMarket ↔ bitcode
## CoinJoin delegato: utente → wallet temporaneo bitcode → CJ → indirizzo vergine

> **Priorità:** Privacy & Sicurezza dei fondi  
> **Principio chiave:** L'utente è sempre avvisato che bitcode custodisce un seed temporaneo  
> **Stato:** Approvato  
> **Data:** 2026-07-03

---

## 0. Avviso di Sicurezza (mostrato OGNI VOLTA)

> ⚠️ **RISCHIO CUSTODIA TEMPORANEA**
>
> Per automatizzare il CoinJoin, bitcode genera un wallet temporaneo e ne custodisce
> il seed per la durata dell'operazione. Durante questa finestra, bitcode ha il
> controllo dei fondi. Dopo l'invio dei fondi puliti all'indirizzo da te fornito,
> wallet e seed vengono DISTRUTTI definitivamente.
>
> **bitcode non è un wallet di custodia.** Non fare affidamento su questo wallet
> per conservare fondi. È un veicolo temporaneo che esiste solo per il CoinJoin
> e viene cancellato al termine.
>
> Se non accetti questo rischio, annulla l'operazione.
>
> Per maggiori dettagli consulta `legal_contract.md`.

---

## 1. Obiettivo

Creare un comando `/btc:coinjoin` in bitcode che permetta a un utente di:

```
1. Depositare sats nel wallet temporaneo generato da bitcode
2. Eseguire CoinJoin via JoinMarket
3. Ricevere fondi puliti su un indirizzo BTC vergine di cui ha le chiavi private

Nessun UTXO residuo. Nessuna esposizione del seed personale dell'utente.
Massima privacy. Avviso di rischio obbligatorio a ogni operazione.
```

---

## 2. Guardrail (approvati)

| # | Regola | Dettaglio |
|---|---|---|
| G1 | **Wallet temporaneo dedicato** | bitcode crea `wallet.coinjoin.mainnet.json`. Dopo l'operazione, svuotato e cancellato. Separato dal wallet principale di bitcode. |
| G2 | **Importo minimo** | 0.01 BTC. Sotto questa soglia le fee mangiano il vantaggio del CJ. |
| G3 | **Timeout round** | 30 minuti massimo per round. Se scade, aborto e fondi restituiti all'utente. |
| G4 | **Change UTXO azzerato** | Mai lasciare change residuo. O aggregato nell'ultima tx, o rimixato. |
| G5 | **2 round default** | Primo round → Set A makers. Secondo round → Set B makers. Opzioni: 1 (rapido), 3 (massima privacy). |
| G6 | **Makers: 5 default** | Min 3, max 14. Scelti casualmente dal pool JoinMarket. |
| G7 | **Fee massime** | Miner fee: hard block > 100 sat/vB, warning > 50. Commissione makers: max 0.1%. |
| G8 | **Output sintetico** | Log passo-passo compresso. `--verbose` per debug completo. |
| G9 | **Wallet separato obbligatorio** | Il wallet CJ non è mai accessibile ai normali `/btc:send` di bitcode. |
| G10 | **Destinazione sicura** | Solo indirizzo vergine fornito dall'utente. Blocco esplicito verso indirizzi exchange noti. |
| G11 | **Risk Disclosure obbligatorio** | L'avviso di sicurezza (Sezione 0) viene mostrato a ogni operazione. L'utente deve digitare esplicitamente `I ACCEPT` per procedere. Il consenso viene loggato in `~/.bitcode/cj-consent.log`. |
| G12 | **Privacy link** | Le transazioni on-chain tra deposito e invio finale non devono essere collegate (indirizzi diversi, percorsi di deriva diversi, nessun pattern riconoscibile). |

---

## 3. Architettura del Sistema

```
┌─────────────────────────────────────────────────────────────────┐
│                         UTENTE                                    │
│  (fornisce indirizzo vergine di cui ha le chiavi private)         │
│  (legge il risk disclosure e accetta)                             │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  PRIMA: RISK DISCLOSURE + ACCETTAZIONE (§ 0 + legal_contract)   │
│  "bitcode genererà un wallet temporaneo e ne custodirà il seed   │
│   per la durata dell'operazione. Accetti? (I ACCEPT)"            │
└────────────────────────┬────────────────────────────────────────┘
                         │ se I ACCEPT
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                      bitcode                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  /btc:coinjoin <address> <amount> [rounds] [makers]      │   │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│  │  │  1. Mostra RISK DISCLOSURE → attendi I ACCEPT      │  │   │
│  │  │  2. Crea wallet temporaneo (seed in memoria)        │  │   │
│  │  │  3. Mostra indirizzo di deposito                    │  │   │
│  │  │  4. Polling arrivo fondi (30s, timeout 60min)       │  │   │
│  │  │  5. Mostra CONTRATTO (fee, rounds, makers, ecc.)    │  │   │
│  │  │  6. Crea wallet JoinMarket dal seed temporaneo     │  │   │
│  │  │  7. Round 1 CJ (cerca makers, esegui, conferma)     │  │   │
│  │  │  8. Round 2 CJ (stessa logica, makers diversi)      │  │   │
│  │  │  9. Invia TUTTI i fondi puliti a indirizzo utente   │  │   │
│  │  │ 10. Cancella wallet + seed + wallet JM              │  │   │
│  │  │ 11. Mostra riepilogo                                │  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                         │                                        │
│                         ▼                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  joinmarket-clientserver (JSON-RPC locale)                │   │
│  │  wallet.jmdat (temporaneo, dal seed di bitcode)           │   │
│  │  → trova makers → round → firma → broadcast              │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼
              ┌───────────────────────┐
              │   Bitcoin Network      │
              │   (mainnet)            │
              └───────────────────────┘
```

### 3.1 Componenti

| Componente | Ruolo | Linguaggio |
|---|---|---|
| **`commands/btc/coinjoin.md`** | Comando Markdown per bitcode — frontend | Markdown (frontmatter) |
| **`src/coinjoin/orchestrator.mjs`** | Orchestratore del flusso completo | Node.js |
| **`src/coinjoin/wallet.mjs`** | Wallet temporaneo BIP84 (estende `src/bitcoin/wallet.mjs`) | Node.js |
| **`src/coinjoin/joinmarket.mjs`** | Integrazione JoinMarket via JSON-RPC | Node.js |
| **`src/coinjoin/contract.mjs`** | Riepilogo contrattuale + accettazione | Node.js |
| **`src/coinjoin/output.mjs`** | Output compresso / verbose | Node.js |
| **`src/coinjoin/exchange_blacklist.mjs`** | Blocco indirizzi exchange noti | Node.js |
| **`scripts/coinjoin.sh`** | Wrapper CLI per JoinMarket | Bash |
| **`legal_contract.md`** | Documento legale di escussione responsabilità | Markdown |

### 3.2 Flusso completo

```
┌────────────────────────────────────────────────────────────────────┐
│                    FLUSSO /btc:coinjoin                             │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  0. RISK DISCLOSURE (Sezione 0 di questo documento)                 │
│     Stampa avviso: "bitcode custodirà il seed temporaneamente"      │
│     Utente scrive: "I ACCEPT"                                       │
│     bitcode logga in ~/.bitcode/cj-consent.log                      │
│     Se rifiuta → operazione annullata, zero fondi movimentati       │
│                                                                     │
│  1. VERIFICA PREREQUISITI                                           │
│     - JoinMarket installato? (which joinmarket-clientserver)        │
│     - Indirizzo destinazione valido?                                │
│     - Importo ≥ 0.01 BTC?                                           │
│     - Indirizzo non in blacklist exchange?                          │
│                                                                     │
│  2. CREAZIONE WALLET TEMPORANEO                                     │
│     - wallet_create su wallet.coinjoin.mainnet.json                 │
│     - Mostra indirizzo di deposito all'utente + avviso              │
│     - Attendere conferma arrivo fondi (polling 30s, timeout 60min)  │
│                                                                     │
│  3. CONFERMA CONTRATTO                                              │
│     Mostra: importo, round, makers, fee stimate (rete + CJ)         │
│     Mostra: "Ho capito e accetto i termini" → attendi "go"          │
│                                                                     │
│  4. PREPARAZIONE JOINMARKET                                         │
│     - Genera seed per wallet.jmdat (temporaneo, dal wallet CJ)      │
│     - Avvia JoinMarket in background (Tor obbligatorio)             │
│                                                                     │
│  5. ROUND 1 DI COINJOIN                                             │
│     - Cerca makers (min N trovati = minMakers)                      │
│     - Esegui round come taker                                       │
│     - Verifica tx confermata (1 conferma)                           │
│                                                                     │
│  6. (OPZIONALE) ROUND 2-3                                           │
│     - Stessa logica, makers diversi (mai stessi del round prec.)    │
│                                                                     │
│  7. INVIO FONDI PULITI                                              │
│     - wallet_send verso indirizzo vergine utente                    │
│     - Invia TUTTO: fondi CJ + eventuale change (G4)                 │
│                                                                     │
│  8. PULIZIA                                                         │
│     - Cancella wallet.coinjoin.mainnet.json (distruzione sicura)    │
│     - Cancella wallet.jmdat temporaneo                              │
│     - Verifica saldo wallet = 0 (nessun UTXO residuo)               │
│     - Mostra riepilogo finale                                       │
│                                                                     │
│  9. POST-OPERAZIONE                                                 │
│     - Aggiorna cj-consent.log con esito operazione                  │
│     - Mostra messaggio finale di reminder:                          │
│       "Il wallet temporaneo è stato distrutto.                      │
│        I tuoi fondi sono stati inviati a [indirizzo].               │
│        bitcode non ha più alcun controllo sui tuoi fondi."          │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

---

## 4. Fasi di Implementazione

### Fase 0: Documentazione legale
**Task 0.1** — Creare `legal_contract.md`
- Preambolo, step di accettazione, registro consensi, clausola di non-responsabilità
- Vedi file separato `legal_contract.md`

**Task 0.2** — Registro consensi `~/.bitcode/cj-consent.log`
- Formato riga: `ISO_TIMESTAMP | HASH(accettazione) | amount | address_to | SHA256(seed)`

**Dipendenze:** Task 0.2 ← 0.1

---

### Fase 1: Comando `/btc:coinjoin` base
**Task 1.1** — Creare `commands/btc/coinjoin.md`
- Frontmatter con `description` e `argument-hint`
- Prompt che spiega il flusso all'agente bitcode
- Vincoli di sicurezza (G1-G12)

**Task 1.2** — Modulo orchestratore `src/coinjoin/orchestrator.mjs`
- Funzione `verifyPrerequisites(address, amount)`: check installazione JoinMarket, validità indirizzo, blacklist
- Funzione `showRiskDisclosure()`: stampa avviso Sezione 0, attendi I ACCEPT
- Funzione `showContract(details)`: mostra contratto, attendi conferma
- Funzione `createTempWallet()`: wallet separato per coinjoin
- Funzione `waitForDeposit(address, expectedAmount)`: polling UTXO ogni 30s, timeout 60min
- Funzione `runCjFlow(address, amount, rounds, makers)`: orchestratore principale
- Funzione `postCleanup()`: distruzione wallet, verifica saldo zero, log

**Task 1.3** — Modulo wallet CJ: `src/coinjoin/wallet.mjs`
- Estende wallet.mjs esistente ma forza percorso separato `wallet.coinjoin.mainnet.json`
- Metodo `destroy()`: cancella file wallet + zero-overscrittura
- Metodo `drainAll(to)`: svuota TUTTI gli UTXO verso indirizzo (nessun residuo)
- Metodo `verifyEmpty()`: check saldo = 0

**Dipendenze:** Task 1.1 → 1.2 → 1.3

---

### Fase 2: Integrazione JoinMarket JSON-RPC
**Task 2.1** — Modulo `src/coinjoin/joinmarket.mjs`
- Funzione `startJoinMarket()`: avvia joinmarketd in background (via script)
- Funzione `createWalletJM(seed)`: genera wallet JMDAT temporaneo
- Funzione `findMakers(minMakers, maxMakers, excludeList)`: interroga il pool
- Funzione `runCoinjoinRound(makers, amount)`: esegue round come taker
- Funzione `stopJoinMarket()`: ferma joinmarketd

**Task 2.2** — Script helper `scripts/coinjoin.sh`
- Wrapper bash che chiama joinmarket-clientserver
- Gestisce timeout, errori, e output strutturato (JSON)
- Logga ogni passo per debug con `--verbose`

**Task 2.3** — Gestione timeout e retry
- Timeout 30 min per round
- Retry automatico su timeout con makers diversi
- Abort dopo 3 fallimenti consecutivi → fondi restituiti all'utente
- Sezione "Cosa fare se il round fallisce" nell'output

**Dipendenze:** Task 2.1 → 2.2, 2.3 ← 2.1

---

### Fase 3: UX, contratto e blacklist
**Task 3.1** — Modulo riepilogo contratto `src/coinjoin/contract.mjs`
- Mostra: importo, fee stimate (rete + makers), numero round, makers per round, indirizzo destinazione, avviso G11
- Attesa conferma "go" prima di procedere
- Integrazione con `legal_contract.md`

**Task 3.2** — Output utente `src/coinjoin/output.mjs`
- Funzione `printProgress()`: log compresso passo-passo
- Funzione `printVerbose()`: log dettagliato (se `--verbose`)
- Funzione `printRiskWarning()`: avviso formattato obbligatorio

**Task 3.3** — Blocco exchange `src/coinjoin/exchange_blacklist.mjs`
- Blacklist indirizzi exchange noti (Binance, Coinbase, Kraken, ecc.)
- Rifiuta la transazione se la destinazione è in blacklist
- Blocco silenzioso: "destinazione non supportata"

**Dipendenze:** Task 3.1 ← Fase 2, 3.2 ← 3.1, 3.3 ← Fase 2

---

### Fase 4: Sicurezza e finalizzazione
**Task 4.1** — Distruzione wallet temporaneo (sicura)
- Dopo invio, sovrascrive `wallet.coinjoin.mainnet.json` con zeri prima di cancellare
- Cancella `wallet.jmdat` temporaneo
- Cancella seed dalla memoria (riferimento null)
- Verifica che non ci siano UTXO residui

**Task 4.2** — Verifica fondi destinazione
- Dopo broadcast, verifica che l'indirizzo destinazione abbia ricevuto l'importo corretto
- Se discrepanza, alert + recovery guidata con txid di riferimento

**Task 4.3** — Test suite coinjoin
- Test in regtest con Bitcoin Core + JoinMarket locale
- Mock dei makers per test senza fondi reali
- Test timeout, fallimento, retry
- Test risk disclosure e flusso di accettazione/rifiuto

**Dipendenze:** Task 4.1 ← Fase 2, 4.2 ← 4.1, 4.3 ← Fase 1-4

---

## 5. Requisiti lato utente

Prima di usare `/btc:coinjoin`, l'utente deve avere:

- [ ] **JoinMarket installato**: `joinmarket-clientserver` (da GitHub o pip)
- [ ] **Tor in esecuzione** (JoinMarket richiede Tor)
- [ ] **bitcode configurato** con `bitcoin.allowMainnetSpend=true` (già esistente)
- [ ] **Un indirizzo BTC vergine** di cui possiede le chiavi private
- [ ] **Aver letto e accettato** `legal_contract.md` (incluso nel flusso)

### Installa JoinMarket

```bash
# Opzione A: pip (raccomandata)
pip install joinmarket-clientserver

# Opzione B: da sorgente
git clone https://github.com/JoinMarket-Org/joinmarket-clientserver.git
cd joinmarket-clientserver
./install.sh
```

---

## 6. Comando `/btc:coinjoin` — Specifica

### Firma
```
/btc:coinjoin <address> <amount-btc> [rounds=2] [makers=5] [verbose]
```

### Argomenti
| Arg | Obbligatorio | Default | Descrizione |
|---|---|---|---|
| `<address>` | ✅ | — | Indirizzo BTC vergine di destinazione |
| `<amount-btc>` | ✅ | — | Importo in BTC (es. 0.05) |
| `rounds` | ❌ | 2 | Numero round CJ (1-3) |
| `makers` | ❌ | 5 | Numero makers per round (3-14) |
| `verbose` | ❌ | false | Log completo |

### Output tipico
```
⚡ bitcode  agent · mainnet

/btc:coinjoin bc1q... 0.05 rounds=2 makers=5

╔══════════════════════════════════════════════════╗
║  ⚠️ AVVISO DI SICUREZZA                          ║
║                                                  ║
║  bitcode genererà un wallet temporaneo e ne      ║
║  custodirà il seed per la durata dell'operazione.║
║  Dopo l'invio, wallet e seed vengono DISTRUTTI.  ║
║                                                  ║
║  Questo NON è un wallet di custodia.             ║
║  Non fare affidamento su di esso.                ║
║                                                  ║
║  Digita "I ACCEPT" per procedere...              ║
╚══════════════════════════════════════════════════╝

> I ACCEPT
✓ Consenso registrato

┌─ COINJOIN ─────────────────────────────────────┐
│ Deposite su: bc1q... (wallet temporaneo)       │
├─────────────────────────────────────────────────┤
│ In attesa deposito...                           │
│ ✓ Ricevuto 0.05 BTC (tx: abc...)               │
│                                                 │
│ ── Round 1/2 ──                                 │
│ ✓ 5 makers trovati                              │
│ ✓ Round completato (tx: def...)                 │
│                                                 │
│ ── Round 2/2 ──                                 │
│ ✓ 5 makers trovati                              │
│ ✓ Round completato (tx: ghi...)                 │
│                                                 │
│ ✓ Invio a bc1q... (0.05 BTC - fee)              │
│ ✓ Wallet temporaneo distrutto                   │
│ ✓ Seed cancellato dalla memoria                 │
│ ✓ Saldo wallet verificato: 0 sats               │
│                                                 │
│ ✅ COINJOIN COMPLETATO                          │
│ Destinazione: bc1q...                           │
│ Round: 2 · Makers: 5                            │
│ Fee rete: 0.0003 BTC · Fee CJ: 0.00005 BTC     │
│ Tx finale: https://mempool.space/tx/jkl...      │
│                                                 │
│ Il wallet temporaneo è stato distrutto.         │
│ I tuoi fondi sono stati inviati a bc1q...       │
│ bitcode non ha più alcun controllo.             │
└─────────────────────────────────────────────────┘
```

---

## 7. Struttura dei file

```
bitcode/
├── commands/
│   └── btc/
│       └── coinjoin.md                  ← [Task 1.1] Comando /btc:coinjoin
├── src/
│   ├── coinjoin/
│   │   ├── orchestrator.mjs            ← [Task 1.2] Orchestratore del flusso
│   │   ├── wallet.mjs                  ← [Task 1.3] Wallet temporaneo CJ
│   │   ├── joinmarket.mjs              ← [Task 2.1] Integrazione JSON-RPC JoinMarket
│   │   ├── contract.mjs                ← [Task 3.1] Contratto/riepilogo per utente
│   │   ├── output.mjs                  ← [Task 3.2] Output compresso/verbose
│   │   └── exchange_blacklist.mjs      ← [Task 3.3] Blocco exchange
│   └── bitcoin/
│       └── wallet.mjs                  ← (esistente) da estendere per destroy + drainAll
├── scripts/
│   └── coinjoin.sh                     ← [Task 2.2] Wrapper JoinMarket CLI
├── legal_contract.md                   ← [Task 0.1] Documento legale
└── tests/
    └── coinjoin/
        └── test_coinjoin.mjs           ← [Task 4.3] Test suite
```

---

## 8. Rischi e mitigazioni

| Rischio | Probabilità | Impatto | Mitigazione |
|---|---|---|---|
| JoinMarket non installato | Alta | Blocco | Check preventivo con messaggio chiaro + guida installazione |
| Makers insufficienti | Media | Round lento | Timeout + riprova con makers diversi. Se persiste, aborti |
| Fee di rete volatili | Alta | Costo imprevedibile | Blocco duro a 100 sat/vB, mostra fee prima della conferma |
| Wallet non cancellato correttamente | Bassa | UTXO residui | Verifica post-operazione con balance check. Alert se residui |
| Indirizzo exchange in blacklist | Bassa | Blocco utente malevolo | Blocco SILENZIOSO ("destinazione non supportata") |
| Interruzione connessione durante round | Media | Fondi bloccati in wallet JM | JoinMarket è fail-safe: se non firmi, i fondi non si muovono. Recovery guidata via seed rigenerato dallo stesso wallet bitcode CJ |
| Utente perde accesso al wallet bitcode durante operazione | Bassa | Fondi bloccati nel wallet CJ | bitcode ha il seed in memoria. Se crash, l'utente deve rigenerare il wallet usando lo stesso percorso (wallet.coinjoin.mainnet.json) — ma il seed è nel wallet distrutto. **Critico: il seed va conservato in memoria, non su disco.** Se crash durante operazione, operazione fallita e recovery manuale via API JoinMarket. |

---

## 9. Roadmap

| Fase | Task | Dipende da | Tempo stimato |
|---|---|---|---|
| **Fase 0** | Documentazione legale | — | 1 sessione |
| **Fase 1** | Comando base + wallet temporaneo | — | 3-4 sessioni |
| **Fase 2** | Integrazione JoinMarket | Fase 1 | 4-5 sessioni |
| **Fase 3** | UX, contratto, blacklist | Fase 2 | 2-3 sessioni |
| **Fase 4** | Sicurezza, distruzione, test | Fase 1-3 | 2-3 sessioni |

---

## 10. Fonti ufficiali (da consultare in Fase 2)

| Risorsa | URL | Cosa contiene |
|---|---|---|
| JoinMarket GitHub (repo principale) | https://github.com/JoinMarket-Org/joinmarket-clientserver | Codice sorgente, API, esempi |
| Documentazione JoinMarket | https://github.com/JoinMarket-Org/joinmarket-clientserver/tree/master/docs | Setup, API reference, sicurezza |
| JoinMarket JSON-RPC | https://github.com/JoinMarket-Org/joinmarket-clientserver/blob/master/docs/JSON-RPC-API.md | API per controllo da remoto |
| JoinMarket-Qt | https://github.com/JoinMarket-Org/jmqt | Interfaccia Qt, utility wallet |
| Bitcoin CoinJoin docs | https://en.bitcoin.it/wiki/CoinJoin | Specifica tecnica CoinJoin |
| BIP84 (HD wallet) | https://github.com/bitcoin/bips/blob/master/bip-0084.mediawiki | Deriva già usata da bitcode |
| Tor per JoinMarket | https://github.com/JoinMarket-Org/joinmarket-clientserver/blob/master/docs/TOR.md | Configurazione Tor obbligatoria |
| API JoinMarket - sendpayment | https://github.com/JoinMarket-Org/joinmarket-clientserver/blob/master/docs/usage/taker.md | Documentazione taker CLI |
| Wabisator (ricerca CROCS) | https://github.com/crocs-muni/coinjoin-analysis | Strumenti di analisi CJ (repo linkata) |

---

> **Prossimo passo:** Fase 0 — Documentazione legale (`legal_contract.md`) già completata.  
> Pronti per Fase 1 quando lo decidi.
