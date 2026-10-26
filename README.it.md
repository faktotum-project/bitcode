<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/logo/wordmark-on-dark.svg">
    <img src="brand/logo/wordmark.svg" alt="bitcode" height="44">
  </picture>
</h1>

**Not your code, not your Sats.**

[![CI](https://github.com/faktotum-project/bitcode/actions/workflows/ci.yml/badge.svg)](https://github.com/faktotum-project/bitcode/actions/workflows/ci.yml)
[![Licenza: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node.js 22+](https://img.shields.io/badge/node-22%2B-339933)

[Sito](https://bitcode-agent.vercel.app/it/) · [Riferimento completo (EN)](docs/reference.md) · [English](README.md)

bitcode è un agente di programmazione per il terminale che sa lavorare anche con
Bitcoin, Lightning e asset RGB. Funziona con modelli cloud o interamente locali e
tratta il denaro diversamente dal codice: per impostazione predefinita lavora su
reti di test, ogni pagamento richiede la tua approvazione esplicita e i limiti di
spesa sono imposti dal codice, non dal prompt. Un'app desktop per Linux offre lo
stesso agente in un ambiente di lavoro completo.

![bitcode desktop](site/public/assets/desktop/desktop-preview.webp)

## Avvio rapido

```bash
git clone https://github.com/faktotum-project/bitcode.git && cd bitcode
npm ci --ignore-scripts
node bitcode.mjs login                       # scegli un provider e inserisci la chiave API
node bitcode.mjs                             # sessione interattiva
node bitcode.mjs -p "fix the failing test"   # comando singolo
```

Nessuna chiave API? Usa un modello locale: `node bitcode.mjs -m ollama/gpt-oss:20b`.

## Installazione

Richiede Node.js **22+** e Bash. Non serve alcuna build.

`npm ci --ignore-scripts` installa solo l'agente di programmazione. I binari
opzionali dei wallet Cashu e Wavelength si compilano a parte, quando servono:

```bash
npm run build:cdk          # Cashu (cdk-cli): toolchain Rust + submodule deps/cdk
npm run build:wavelength   # scarica la release fissata di waved/wavecli
npm link --ignore-scripts  # rende disponibile il comando globale `bitcode`
bitcode doctor             # mostra cosa è configurato e cosa manca
```

Stato e chiavi stanno in `~/.bitcode`, con file leggibili solo dal proprietario;
imposta `BITCODE_HOME` per usare un'altra cartella. Tutte le opzioni sono in
[install and run](docs/reference.md#install-and-run).

## Modelli e provider

Scegli un modello con `-m <provider>/<modello>`, oppure cambialo durante la
sessione con `/model` e `/models`.

| Provider | Esecuzione | Chiave |
|---|---|---|
| `anthropic` | cloud | `ANTHROPIC_API_KEY` |
| `openai` | cloud (Responses API) | `OPENAI_API_KEY` |
| `openrouter` | cloud | `OPENROUTER_API_KEY` |
| `groq` | cloud | `GROQ_API_KEY` |
| `ollama` | locale | nessuna |
| `lmstudio` | locale | nessuna |
| `qvac` | locale | nessuna |

I modelli locali vengono rilevati all'avvio: `/models` elenca quelli installati
sul tuo computer. Puoi aggiungere qualsiasi endpoint compatibile con OpenAI in
`~/.bitcode/config.json`. Dettagli in
[models and providers](docs/reference.md#models-and-providers).

### Inferenza locale con QVAC

```bash
npm --prefix integrations/qvac ci
npm --prefix integrations/qvac start          # server su 127.0.0.1:11435
node bitcode.mjs -m qvac/bitcode-local
```

Vedi [configurazione di QVAC e dei modelli](integrations/qvac/README.md).

## Strumenti

Gli strumenti sono raggruppati in profili. Si cambiano con `--profile` o `/profile`.

| Profilo | Cosa può fare l'agente |
|---|---|
| `code` (predefinito) | file, shell e processi gestiti, Git, lettura web, pianificazione, skill, subagenti, server MCP |
| `bitcoin` | aggiunge query su chain e mempool, wallet BIP84, Lightning/tapd, Cashu, Liquid (sola lettura), Wavelength (sola lettura) |
| `rgb` | gestisce un RGB Lightning Node tramite `kaleido-mcp`: saldi, fatture, trasferimenti |

Puoi estenderlo con [server MCP](docs/reference.md#mcp), skill locali, comandi
slash personalizzati in `content/commands/` e [plugin](docs/reference.md#plugins).
L'elenco completo è in [tools](docs/reference.md#tools).

### Asset RGB

```bash
node bitcode.mjs -m qvac/bitcode-rgb-4b --profile rgb
```

Controlla i saldi, crea fatture e invia asset RGB in linguaggio naturale, con
fondi di test su Signet (Mutinynet). Vedi [configurazione del nodo](integrations/kaleido/README.md).

## Sicurezza e approvazioni

- **Reti di test per impostazione predefinita.** Il percorso protetto
  `bitcode finance` accetta solo signet, testnet e testnet4. Gli strumenti del
  wallet rifiutano le trasmissioni su mainnet, a meno che tu non imposti
  `bitcoin.allowMainnetSpend=true`.
- **Approvi ogni pagamento.** Gli strumenti finanziari chiedono sempre conferma,
  in ogni modalità di permessi. Le esecuzioni a comando singolo li rifiutano se
  non passi `--allow-payments`.
- **Limiti nel codice.** `bitcode finance policy` imposta i limiti per
  pagamento, giornaliero, commissioni e riserva, in satoshi. Un modello può solo
  *preparare* una proposta; `bitcode finance execute` mostra il pagamento esatto
  e ti chiede di digitarne l'ID.
- **Annulla per il codice.** `/diff` e `/undo` ripristinano i file modificati
  dall'ultimo turno dell'agente.
- **Shell isolata.** In `full-auto` i comandi shell girano dentro Bubblewrap,
  senza rete e con scrittura consentita solo nel progetto e in `/tmp`.

I comandi shell e i plugin di cui ti fidi possono comunque accedere al tuo
computer: il controllo sui pagamenti è una regola degli strumenti, non un
sandbox del sistema operativo. Vedi
[execution and approval policy](docs/reference.md#execution-and-approval-policy)
e [financial proposals](docs/reference.md#financial-proposals-phase-1-testnet-path).

## App desktop (Linux)

Lo stesso agente in un ambiente Electron: progetti, editor, Git, terminale, un
worker dell'agente isolato con Bubblewrap, un wallet Bitcoin di test e sessioni
del wallet RGB con approvazione dei pagamenti.

```bash
npm run dist:desktop              # crea desktop/release/bitcode-desktop_<versione>_amd64.deb
sudo apt install ./desktop/release/bitcode-desktop_*_amd64.deb
bitcode-desktop                   # oppure: bitcode desktop
```

Il pacchetto (amd64) installa anche la CLI come `/usr/bin/bitcode`, a meno che
quel percorso non appartenga già a un altro `bitcode`. L'app resta nella barra
di sistema, può avviarsi al login e blocca la sospensione solo mentre un agente
è al lavoro. Vedi [desktop/](desktop/) e il [piano](docs/archive/desktop-plan.md).

## Sats

Quattro subagenti specializzati, ognuno con un ruolo fisso e un elenco di
strumenti consentiti imposto dal codice:

| Sat | Ruolo |
|---|---|
| Node | ricerca e contesto, query di sola lettura sulla chain |
| Script | implementazione |
| Hash | analisi di sicurezza |
| Merkle | revisione |

```text
/sats                       elenca i Sats
/sat merkle                 usa un Sat per i messaggi successivi
node bitcode.mjs --sats     apre il companion animato
```

Vedi [docs/sats.md](docs/sats.md).

## Glossario

| Termine | Significato |
|---|---|
| **RGB** | asset emessi su Bitcoin, validati lato client e trasferiti on-chain o via Lightning |
| **QVAC** | il runtime di IA locale di Tether, usato qui come server compatibile con OpenAI |
| **Cashu** | protocollo di ecash per pagamenti privati, garantito da una mint Lightning |
| **Wavelength** | toolkit di Lightning Labs per pagamenti Bitcoin, Lightning e Ark self-custodial senza gestire un nodo |
| **Signet / Mutinynet** | reti di test di Bitcoin: monete senza valore |
| **MCP** | Model Context Protocol, lo standard per collegare strumenti esterni a un agente |

## Struttura del repository

| Cartella | Contenuto |
|---|---|
| `src/` | Sorgente della CLI (`bitcode.mjs` è il punto di ingresso) |
| `content/` | Markdown caricato a runtime dalla CLI: `agents/`, `commands/`, `sats/` |
| `ui/sats/`, `assets/sats/` | La vista web `/sats` e le immagini dei Sats che serve |
| `desktop/` | App desktop Electron |
| `integrations/`, `deps/` | Integrazioni QVAC e Kaleido; submodule Cashu `cdk` |
| `brand/` | Design system: token, logo, profili dei Sats, kit social ([brand/README.md](brand/README.md)) |
| `site/` | Sito: `src/` template e i18n, `public/` ciò che pubblica Vercel, `scripts/` build e controlli |
| `docs/` | Riferimento e documenti sui Sats; `docs/archive/` contiene i piani completati |
| `scripts/`, `tests/` | Script di build (Cashu, Wavelength, lint, asset dei Sats) e test |

## Sviluppo

```bash
npm run check          # lint + test
npm run test:desktop   # test dell'app desktop
```

La CI gira su Node 22 e 24. Struttura del codice: [ARCHITECTURE.md](ARCHITECTURE.md)
e [development](docs/reference.md#development). Modifiche per versione:
[CHANGELOG.md](CHANGELOG.md).

## Licenza

[MIT](LICENSE)

### Full node personale (versione da collaudare)

`bitcode node install` apre il wizard Bitcoin Core anche senza un modello AI. La pagina **Nodo** del Desktop usa lo stesso installatore, con explorer mempool locale opzionale, collegamento/adozione di nodi esistenti e diagnosi assistita da Merkle. Vedi [installazione e limiti attuali](docs/fullnode.md): restano i collaudi completi sul sistema host e su ARM64; inclusa la procedura sperimentale di compilazione Mutinynet.
