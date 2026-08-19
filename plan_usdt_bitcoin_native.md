# Plan: USDT on Bitcoin con sicurezza nativa

## 1. Opzioni valutate

| Opzione | Layer | Custodian | Verificabile | Note |
|---------|-------|-----------|--------------|------|
| **Taproot Assets** | Bitcoin mainnet (native) | Self-custodial | ✅ On-chain | Già in LND/tapd; immediatamente disponibile |
| **RGB** | Bitcoin mainnet (smart contracts) | Self-custodial | ✅ On-chain | Native Bitcoin contracts; isomòrfo a Bitcoin security |
| **Liquid** | Sidechain federato | Self-custodial (ma sidechain risk) | ✅ Federazione | Blocco centrale; non "tutta la sicurezza di Bitcoin" |
| **Stacks** | App chain su Bitcoin | Self-custodial | ✅ Finality da Bitcoin | Architettura PoX; buona; Proof of Transfer |
| **Lightning + Cashu** | Layer 2 ecash | Self-custodial (Cashu) | ❌ Offchain | Veloce; privacy; ma rischio di mint |

**Scelta consigliata:** **RGB** + **mantenere Taproot Assets come fallback**
- RGB è "Bitcoin contract layer" → massima sicurezza
- Taproot Assets è "UTXO-based asset" → già live, backward-compatible

---

## 2. Architettura schematica

```
┌─ bitcode agent ─────────────────┐
│                                 │
│  usdt_balance      (read)       │
│  usdt_quote        (read)       │
│  usdt_receive      (write)      │
│  usdt_send         (write)      │
│  usdt_history      (read)       │
│                                 │
└──────────┬──────────────────────┘
           │
    ┌──────┴──────┐
    │             │
┌───▼────┐   ┌───▼─────┐
│ RGB    │   │ Taproot │
│ client │   │ Assets  │
│        │   │ (LND)   │
└─────────┘   └─────────┘
    │             │
    └──────┬──────┘
           │
      Bitcoin mainnet
```

---

## 3. Fasi di implementazione

### Fase 1: Fondazione (settimane 1-2)
**Dipendenza da esterno:** `@rgbfw/rgb` SDK (spedisce luglio 2026?)

- [ ] Ricerca: SDK ufficiale RGB; stabilità API v0.1.0
- [ ] Architecture: transport abstraction (come Wavelength)
- [ ] Prototipo: `src/rgb/client.mjs` con facade methods
- [ ] Test: mock transport, vettori di test da spec

### Fase 2: Ricezione (settimana 3)
- [ ] `usdt_receive` → genera indirizzo RGB per USDT
- [ ] `usdt_address_list` → storico indirizzi generati
- [ ] Disclosure: "USDT su RGB è on-chain verificabile; niente terze parti"

### Fase 3: Lettura (settimana 4)
- [ ] `usdt_balance` → bilancio confermato/pendente
- [ ] `usdt_history` → transazioni recenti
- [ ] `usdt_quote` → prepareSend (fee, tempo, cambio)

### Fase 4: Pagamento (settimana 5)
- [ ] Pre-flight: validazione indirizzo ricevente (RGB o address standard)
- [ ] `usdt_send` → sendPrepared → post-commit flow
- [ ] Conferma multi-step: amount, recipient, fee (come ln_invoice_pay)

### Fase 5: Fallback Taproot Assets (settimana 6)
- [ ] Detect: LND tapd configurato?
- [ ] Alias: `usdt_send` su Taproot Assets se RGB non disponibile
- [ ] Messaggi distintivi: "USDT via RGB" vs "USDT via Taproot Assets"

---

## 4. Guardrail di sicurezza

| ID | Guardrail | Implementazione |
|----|-----------|-----------------|
| G1 | Niente mnemonic export | SDK mantiene seed off-chain; solo backup crittografato |
| G2 | Fee sempre esplicito | Utente approva fee Bitcoin + fee RGB prima di send |
| G3 | Indirizzo validato | Checksum RGB; niente typo-sent USDT |
| G4 | Transazione reversibile fino a ~6 block | Messaggio di rischio "pending for 1h" |
| G5 | No mainnet senza allowMainnet:true | Come config.wavelength.allowMainnet |
| G6 | TLS verificato | SDK usa certificati pinned; niente mitm |
| G7 | Rete Bitcoin primaria | RGB finalizza su Bitcoin mainnet, non sidechain |
| G8 | Audit log | Tutte usdt_send loggono hash txn + timestamp (locale, mai esterno) |

---

## 5. Configurazione utente (config.usdt)

```javascript
config.usdt = {
  enabled: true,              // opt-in
  network: "mainnet",         // mainnet | testnet | signet
  allowMainnet: true,         // required for mainnet
  backend: "rgb",             // rgb | taproot-assets
  fallback: "taproot-assets", // fallback if rgb unavailable
  dataDir: "~/.bitcode/usdt",
  confirmationBlocks: 6,
  maxSendSat: 10_000_000,     // ~$300 USD cap
};
```

---

## 6. Stack tecnico

**Fondazioni:**
- RGB SDK @rgbfw/rgb (quando stabile)
- Bitcoin Core RPC (per broadcast)
- Electrum servers (per verificazione SPV rapida)

**bitcode adeguamenti:**
- `src/usdt/` module (client.mjs, tools.mjs, network.mjs)
- Transport abstraction (pluggable RGB client)
- Test harness con vettori da spec RGB

**No dipendenze runtime aggiuntive:**
- Tutto vendored (come Wavelength/Cashu)
- Zero npm creep

---

## 7. Bloccanti e rischi

| Blocco | Impatto | Mitigazione |
|--------|---------|-------------|
| **SDK non stabile** | RGB non rilascia @rgbfw/rgb v1.0 | Aspettare; fallback su Taproot Assets completo |
| **Performance** | Proof generation lento | Async background; progress bar durante send |
| **Indirizzi lunghi** | UX confusa | QR code; validazione automatica |
| **Rollback Bitcoin** | RGB transazione invalidata | Richiedi +6 confirmazioni; warn se < 3 |

---

## 8. Comunicazione all'agente

Aggiungere al system prompt:

```
"- USDT/stablecoin su Bitcoin native (self-custodial RGB contracts): 
   usdt_balance, usdt_receive, usdt_send, usdt_quote, usdt_history.
   USDT è on-chain verificabile. Prima di usdt_send: conferma 
   indirizzo, importo, fee Bitcoin e ask user."
```

---

## 9. Roadmap (post-Wavelength)

1. **Luglio 2026**: RGB SDK stabile? → Fase 1
2. **Agosto-settembre 2026**: Fasi 2-4 (ricezione, pagamento)
3. **Settembre 2026**: Live su signet; test mainnet readiness
4. **Ottobre 2026**: Mainnet launch (solo se LND tapd è backup live)
5. **Q1 2027**: Integrazione asset aggiuntivi (EUROC, altri)

---

## 10. Riferimenti

- RGB spec: https://github.com/rgb-wg/spec
- Taproot Assets (fallback): LND/lnd#taproots
- Bitcoin Core: RPC + indexer
- Electrum: SPV verificazione
