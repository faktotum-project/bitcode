# Bitcode — Sats Implementation Plan

## Revisione implementativa — 2026-10-04

Il livello condiviso CLI/desktop è descritto in `docs/sat-runtime.md`.
Miglioramenti applicati rispetto alla bozza:

- Manifest validati e permessi limitati anche nel codice; RPC arbitrarie e tool
  finanziari non sono abilitati dal manifest.
- Merkle delega sequenzialmente con budget, annullamento e approvazioni del
  progetto; nessuna delegazione ricorsiva o eredità automatica dei privilegi.
- Identità locale persistente e cronologia essenziale separata per progetto,
  limitata a 50 esiti, senza prompt o risultati sensibili.
- Il workspace persistente non estende l'accesso ai file del progetto e non
  viene montato nel worker desktop. La memoria è gestita dall'host.
- CLI e desktop condividono il runtime; la disponibilità degli adattatori
  resta quella dell'host. I manifest non creano nuove integrazioni finanziarie.
- La CLI mantiene i permessi del processo utente: il filtro dei tool non è una
  sandbox del sistema operativo. Il desktop conserva l'isolamento bubblewrap.

Persistenza dell'identità non significa ripresa automatica dopo crash o memoria
semantica: queste funzioni non fanno parte dell'aggiornamento.

## Regola fondamentale

Evolvere Bitcode introducendo un sistema proprietario di agenti persistenti chiamati **Sats**.

Tutta l'architettura implementata deve utilizzare esclusivamente la terminologia Bitcode.

Non utilizzare nell'architettura pubblica, UI, CLI, nomi di file, directory, classi, funzioni, documentazione o commenti riferimenti ai progetti utilizzati come fonte tecnica o di ispirazione.

La terminologia ufficiale è:

```text
Bitcode
Sats
Sat Runtime
Sat Registry
Sat Manifest
Sat Identity
Sat Permissions
Sat Workspace
Sat Computer
Sat Events
Sat State
Sat Delegation
Sat Orchestrator
Sat Memory
```

I quattro Sats iniziali sono:

```text
NODE
SCRIPT
HASH
MERKLE
```

### Architettura

```text
                       BITCODE
                          │
                    Agent Engine
                          │
                    SAT RUNTIME
                          │
          ┌───────────────┼───────────────┐
          │               │               │
     Sat Identity   Sat Permissions   Sat Workspace
          │               │               │
          └───────────────┼───────────────┘
                          │
                     Sat Events
                          │
             ┌────────────┼────────────┐
             │            │            │
           NODE         SCRIPT       HASH
                          │
                       MERKLE
                          │
                   Orchestration
```

## Naming

Utilizzare:

```text
src/sats.mjs
src/sat-runtime.mjs
src/sat-permissions.mjs
src/sat-workspace.mjs
src/sat-events.mjs
src/sat-computer.mjs
```

Directory:

```text
sats/
├── node/
│   └── SAT.md
├── script/
│   └── SAT.md
├── hash/
│   └── SAT.md
└── merkle/
    └── SAT.md
```

Runtime locale:

```text
~/.bitcode/sats/
├── node/
│   ├── workspace/
│   └── state/
├── script/
│   ├── workspace/
│   └── state/
├── hash/
│   ├── workspace/
│   └── state/
└── merkle/
    ├── workspace/
    └── state/
```

## CLI

I comandi devono essere esclusivamente:

```text
/sats
/sat node
/sat script
/sat hash
/sat merkle

/sat info <name>
/sat workspace <name>
```

Esempio:

```text
⚡ bitcode

S A T S

● NODE      Bitcoin infrastructure
● SCRIPT    Code & implementation
● HASH      Verification & security
● MERKLE    Orchestration

4 sats · ready
```

## Orchestrazione

**Merkle** è il Sat orchestratore.

```text
USER
 │
 ▼
MERKLE
 │
 ├──── NODE
 │      Bitcoin / Lightning
 │
 ├──── SCRIPT
 │      Coding / implementation
 │
 └──── HASH
        Verification / security

 │
 ▼
MERKLE
 │
 ▼
RESULT
```

Ogni Sat mantiene:

- identità persistente
- system instructions
- capabilities
- tool permissions
- workspace
- state
- execution history essenziale

Un Sat non eredita automaticamente i privilegi di un altro Sat.

## Manifest

Ogni Sat utilizza `SAT.md`:

```yaml
---
id: node
name: Node
version: 1
role: Bitcoin infrastructure specialist

capabilities:
  - bitcoin
  - lightning

tools:
  - bitcoin_rpc
  - btc_block
  - btc_mempool
  - btc_fees

permissions:
  filesystem: read
  shell: approval
  network: allow
  wallet: deny
  delegation: deny

workspace:
  persistent: true

ui:
  avatar: node
---
```

## Stati

Tutti i Sats utilizzano gli stessi stati:

```text
idle
thinking
planning
reading
running
writing
delegating
waiting_approval
success
error
```

Gli stati devono produrre eventi indipendenti dalla UI.

```text
sat:start
sat:state
tool:start
tool:end
delegation:start
delegation:end
approval:required
approval:resolved
sat:end
sat:error
```

Questo permetterà successivamente di collegare gli avatar animati:

```text
SAT RUNTIME
     │
     ▼
SAT STATE
     │
     ├── CLI
     ├── Web UI
     └── Avatar / GIF
```

## Principio architetturale

I Sats non devono diventare un framework separato.

Devono essere un livello sopra l'attuale Bitcode Agent Engine:

```text
LLM Providers
      │
Agent Engine
      │
 Sat Runtime
      │
   Sats
      │
Bitcode Tools
      │
Bitcoin / Lightning / Liquid
```

Riutilizzare il più possibile:

```text
agent.mjs
agents.mjs
tools.mjs
session.mjs
theme.mjs
markdown-config.mjs
plans.mjs
```

Non duplicare funzionalità già presenti.

## Vincoli

Bitcode deve rimanere:

- Bitcoin-native
- local-first
- privacy-first
- terminal-first
- provider agnostic
- self-hostable
- minimal dependency
- zero telemetry
- explicit approval

Il comando:

```bash
node bitcode.mjs
```

deve continuare a funzionare senza richiedere infrastruttura esterna.

## Regola di implementazione

Durante lo sviluppo utilizzare esclusivamente la terminologia **Sat/Sats** per il nuovo agent layer.

Il risultato finale deve apparire come una componente nativa di Bitcode:

> **Sats are persistent Bitcoin-native agents running on the Bitcode agent runtime.**

Non come un'integrazione esterna.
