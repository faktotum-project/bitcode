# Bitcode Desktop — D0: contratti tecnici

Stato: **bozza di specifica D0, da revisionare**. Data: 2026-10-03. Baseline: `a98fb95`.
Riferimento di prodotto: [`desktop-plan.md`](desktop-plan.md). Mockup: [`design/desktop-mockups.html`](../design/desktop-mockups.html).

Questo documento traduce le scelte confermate del piano in contratti verificabili.
Niente di quanto descritto è implementato: ogni contratto indica cosa riusa dal codice
attuale, cosa introduce e con quale test di accettazione (§14) verrà chiuso.
Decisioni D0 registrate e ancora aperte: §15.

## 0. Principi trasversali

1. **Un solo backend di autorizzazione.** Pulsanti, comandi `/approve` della chat desktop
   e CLI chiamano lo stesso metodo `approval.resolve` (§5). Nessuna verifica solo in UI.
2. **Il canale umano è determinato dal trasporto, non dal contenuto.** L'origine di un
   messaggio di controllo è assegnata dal processo principale (o dal TTY della CLI), mai
   dal payload. Testo del modello, output shell, tool, plugin e MCP non possono produrre
   messaggi di controllo.
3. **Snapshot per run.** Modello, modalità, policy e limiti sono catturati all'avvio del
   run (`RunConfig`, §8); le modifiche valgono per i run successivi.
4. **Fail closed.** Stato illeggibile, integrità non verificata, ambiente non dimostrato,
   secret store non sicuro, sandbox assente → l'operazione è rifiutata o attende, mai
   degradata in silenzio.
5. **Due flussi di eventi.** Il feed di osservazione Sats (v1, pubblico, già esistente)
   resta invariato; chat, argomenti, diff e output viaggiano su un canale privato per sessione.

## 1. Topologia dei processi (indipendente dal framework)

```
┌──────────────── App shell (Electron main) ──────────────────┐
│  finestre · tray · notifiche · secret store · origine msg   │
└──────┬─────────────────────────────────────────┬────────────┘
       │ bridge ristretto (preload / commands)   │ IPC locale (JSON, §3)
┌──────▼──────┐                          ┌───────▼────────────────────┐
│ Renderer UI │                          │ Controller (Node 22)        │
│ no Node,    │                          │ sessioni · coda · lease     │
│ CSP self    │                          │ approvazioni · policy · log │
└─────────────┘                          └──┬──────────┬──────────┬────┘
                                            │          │          │
                                   ┌────────▼──┐ ┌─────▼─────┐ ┌──▼───────────────┐
                                   │ Worker    │ │ Worker    │ │ Finance service   │
                                   │ sessione A│ │ sessione B│ │ adapter protocolli│
                                   │ runAgent  │ │ runAgent  │ │ credenziali fin.  │
                                   └───────────┘ └───────────┘ └───────────────────┘
```

- **Controller:** estratto da `src/cli.mjs`; unico proprietario di stato sessioni,
  approvazioni, lease di progetto e coda. La CLI lo usa in-process (modalità attuale)
  oppure si collega al controller del desktop (§12).
- **Worker:** un processo figlio per sessione attiva; esegue `runAgent()` con un
  `createEventBus()` proprio. Il vincolo «una root + un figlio» resta **per bus**,
  quindi per sessione; la concorrenza nasce dai worker multipli.
- **Finance service:** processo separato che detiene le credenziali finanziarie.
  Il solo processo separato non è un confine: l'isolamento OS è definito in §11.1 (D-7, decisa).
- **PTY utente:** gestiti dal controller, marcati `owner: "user"`; mai collegati agli
  input dell'agente (§10).

Shell applicativa: **Electron** (D-1, decisa). Il contratto di §3–§11 resta comunque
indipendente dal framework: il bridge preload è l'unico punto specifico di Electron.

## 2. Identificatori

| ID | Formato | Origine |
| --- | --- | --- |
| `projectId` | `p_` + 16 hex di `sha256(realpath(root))` | controller |
| `sessionId` | formato attuale `newSessionId()` | `src/session.mjs` |
| `runId` | UUID v4 | `createRunContext()` |
| `requestId` | `apr_` + 22 caratteri base32 casuali (≥110 bit) | controller |
| `digest` | `sha256` esadecimale del soggetto canonico (§5.2) | controller |
| `proposalId` | `sha256` canonico attuale | `src/finance/store.mjs` |
| `leaseId`, `ptyId`, `msgId` | UUID v4 | controller |

Gli ID non sono segreti, ma un `requestId` è accettato solo insieme al proprio `digest`
e alla propria `sessionId`. I comandi testuali accettano un prefisso univoco (≥6 caratteri)
nella sessione corrente; un prefisso ambiguo è rifiutato.

## 3. API di controllo (UI/CLI → controller)

Trasporto: messaggi JSON su IPC locale (bridge del framework per la UI; socket Unix
`$BITCODE_HOME/run/controller.sock`, permessi `0600`, per la CLI). Schema versionato.

```jsonc
// richiesta
{ "v": 1, "msgId": "uuid", "method": "run.start", "params": { ... } }
// risposta
{ "v": 1, "msgId": "uuid", "ok": true,  "result": { ... } }
{ "v": 1, "msgId": "uuid", "ok": false, "error": { "code": "APPROVAL_EXPIRED", "message": "…", "details": {} } }
```

L'**origine** (`ui:<windowId>` | `cli:<pid>` | `tray`) è aggiunta dal processo che riceve
il messaggio, verificando mittente/frame (Electron `event.senderFrame`) o le credenziali
del peer del socket (`SO_PEERCRED`, stesso uid). Il renderer non può impostarla.
Ogni `params` è validato con JSON Schema (`ajv`, già dipendenza) con
`additionalProperties: false`; payload oltre 1 MiB rifiutati (eccetto `buffer.save`, 16 MiB).

### Metodi v1

| Area | Metodi |
| --- | --- |
| Progetti | `project.open {path}`, `project.list`, `project.close {projectId}` |
| Sessioni | `session.create {projectId, model, mode}`, `session.open {sessionId}`, `session.list {projectId?}`, `session.close`, `session.export {format}`, `session.delete` |
| Run | `run.start {sessionId, prompt, attachments[], agent?}`, `run.cancel {runId}`, `run.list {state?}` |
| Approvazioni | `approval.list {sessionId?}`, `approval.get {requestId}`, `approval.resolve {requestId, digest, decision}` |
| Policy | `policy.get {projectId}`, `policy.propose {projectId, patch}` → crea un'approvazione `kind:"policy"`, `mode.set {sessionId, mode}` |
| File | `fs.tree`, `buffer.open {path}` → `{text, version}`, `buffer.save {path, text, baseVersion}`, `fs.watch` |
| Git | `git.status`, `git.diff {path?, staged?}`, `git.stage`, `git.unstage`, `git.commit {message}`, `git.checkout {path}` (mutanti → lease §7) |
| Terminale | `pty.open {projectId, cwd?}` → `ptyId`, `pty.write`, `pty.resize`, `pty.close` |
| Checkpoint | `checkpoint.list {sessionId}`, `checkpoint.restore {checkpointId}` (crea approvazione in modalità manuale) |
| Finanza | `finance.connections`, `finance.verify {connectionId}`, `finance.read {connectionId, op, args}`, `finance.prepare {…}` (solo agente/utente), `finance.reconcile {proposalId}` |
| Impostazioni | `settings.get`, `settings.set {key, value}`, `secrets.put {name, value}` → handle, `secrets.delete {handle}`, `diagnostics.export` |
| App | `app.status`, `app.quit {cancelRuns}` |

Metodi riservati all'origine umana: `approval.resolve`, `mode.set`, `policy.propose`,
`secrets.*`, `app.quit`, `finance.connections` in scrittura. Un worker non ha accesso
al socket di controllo: comunica col controller tramite un canale proprio (§4.3).

### Codici di errore stabili

`INVALID_PARAMS`, `NOT_FOUND`, `FORBIDDEN_ORIGIN`, `BUSY`, `QUEUE_FULL`, `STALE_VERSION`,
`LEASE_HELD`, `APPROVAL_EXPIRED`, `APPROVAL_CONSUMED`, `APPROVAL_DIGEST_MISMATCH`,
`APPROVAL_WRONG_SESSION`, `POLICY_DENIED`, `SANDBOX_UNAVAILABLE`, `ENV_UNVERIFIED`,
`ENV_READ_ONLY`, `SECRET_STORE_INSECURE`, `PROVIDER_UNAVAILABLE`, `LOCAL_ONLY`,
`STATE_CORRUPT`, `INTERNAL`. I messaggi sono tradotti dalla UI tramite il codice;
il backend non localizza.

## 4. Eventi

### 4.1 Feed di osservazione (invariato)

Formato v1 descritto in `docs/sats.md`: `{v:1,seq,at,type,sessionId,runId,agentId,…,data}`
con proiezione dei soli campi pubblici. Il controller li aggrega da tutti i worker in un
feed globale aggiungendo solo `projectId`. Usato da pannello Sats, Attività e tray.

### 4.2 Canale privato per sessione (nuovo, `v: 2`)

Inviato solo alle finestre che hanno aperto quella sessione. Stesso `seq`/replay del bus
attuale (ring buffer per sessione, recupero con `after`; cursore troppo vecchio → snapshot).

| Tipo | `data` |
| --- | --- |
| `message.delta` / `message.done` | `{messageId, role, text}` |
| `tool.detail` | `{toolCallId, name, args}` (args redatti dal registro segreti §11) |
| `tool.output` | `{toolCallId, chunk, stream}` troncato a 64 KiB per chiamata |
| `approval.requested` | `ApprovalRequest` completa (§5.1) |
| `approval.resolved` / `approval.expired` | `{requestId, status, by}` |
| `diff.updated` | `{files:[{path, added, removed, status}]}` |
| `run.queued` / `run.dequeued` | `{runId, position}` |
| `run.interrupted` | `{runId, reason: "worker_crash"\|"app_exit"\|"suspend"}` |
| `usage` | `{runId, inputTokens, outputTokens, costMicros\|null}` (§8) |
| `file.changed` | `{path, version, by: "agent"\|"user"\|"external"}` |
| `finance.proposal` | proposta pubblica (senza PSBT/token/segreti) e stato |

### 4.3 Worker ↔ controller

Messaggi su `process.send` (o pipe dedicata), mai sul socket umano. Il worker può
**chiedere** (`approval.request`, `lease.acquire`, `finance.prepare`,
`model.request`), mai **risolvere** approvazioni. `model.request` ammette solo
il target catturato nel RunConfig, con streaming e cancellazione; non accetta
URL arbitrari o credenziali dal worker (§11.1).
Il callback `hooks.approve` di `runAgent()` nel worker diventa una richiesta al controller
che si risolve solo con `approval.resolve` di origine umana o con la policy (§6).

## 5. Contratto di approvazione

### 5.1 Richiesta

```jsonc
{
  "requestId": "apr_…", "digest": "sha256…",
  "kind": "command" | "patch" | "tool" | "policy" | "mode" | "egress" | "finance" | "checkpoint",
  "projectId": "p_…", "sessionId": "…", "runId": "…", "agentId": "script", "model": "provider/model",
  "subject": { /* forma canonica per kind, §5.2 */ },
  "reason": "fuori allowlist" ,   // perché la policy non basta
  "createdAt": "ISO", "expiresAt": "ISO",
  "status": "pending" | "approved" | "denied" | "expired" | "cancelled" | "superseded"
}
```

### 5.2 Soggetti canonici

| `kind` | `subject` |
| --- | --- |
| `command` | `{argv?: string[], shell?: string, cwd, envAdded: string[] (nomi), sandbox: "bwrap"\|"none", networkPolicyVersion, networkDestinations: [...]}` |
| `patch` | `{files:[{path, baseVersion, newVersion, op:"modify"\|"create"\|"delete"\|"rename"}], unifiedDiff}` |
| `tool` | `{tool, args}` (args redatti) |
| `policy` / `mode` | `{from, to}` versioni complete |
| `egress` | `{fromLocality:"local", provider, model, agentId}` |
| `finance` | proposta pubblica con `proposalId`, rete, ambiente verificato, importi e commissioni in sats |
| `checkpoint` | `{checkpointId, files:[…]}` |

`digest = sha256(JSON canonico {kind, sessionId, runId, requestId, subject})` con chiavi
ordinate. La UI mostra e rimanda il `digest` ricevuto; la CLI lo rimanda implicitamente
per la richiesta che ha visualizzato.

### 5.3 Risoluzione (`approval.resolve`)

Accettata solo se **tutte** le condizioni valgono, verificate in un'unica transazione
compare-and-set sul registro delle approvazioni:

1. origine umana (§3); 2. `status === "pending"`; 3. `now < expiresAt`;
4. `digest` uguale; 5. la sessione di origine UI coincide con quella della richiesta
(una finestra può risolvere solo richieste delle sessioni che ha aperto; tray e Attività
aprono la sessione prima di mostrare i pulsanti); 6. il soggetto non è cambiato
(per `patch`: versioni base ancora attuali, §7; per `finance`: `assertProposal` attuale).

L'esito è monouso: una seconda risoluzione restituisce `APPROVAL_CONSUMED`.
Solo `decision: "approve" | "deny"`. **Nessun** «approva tutto», «sempre per questa
sessione» o approvazione per classe. Allargare la policy è un'azione separata
(`policy.propose`) che produce a sua volta una richiesta `kind:"policy"`.

Scadenze proposte: comandi/patch/tool 15 min, finanza = scadenza proposta (oggi 15 min),
policy/mode/egress 5 min. La finestra nascosta non cambia scadenze né decisioni.
Alla scadenza il tool riceve `denied` e il run prosegue o attende secondo la modalità.
**[decisione D-3]**

Comandi testuali (solo da input umano della chat desktop o TTY CLI):
`/approve <id>`, `/deny <id>`, `/cancel <runId>`, `/mode manuale|assistita|autonoma`,
`/pending`. Il parser opera sul testo digitato dall'utente prima che diventi un messaggio
per il modello; non viene mai applicato a output del modello, tool o shell.

### 5.4 Registro

`$BITCODE_HOME/desktop/approvals.jsonl`, append-only, `0600`, fsync per voce:
richiesta (senza segreti), decisione, origine, timestamp. Usato per Attività e diagnosi;
non è un meccanismo di undo.

## 6. Policy e modalità

Le tre modalità confermate si appoggiano ai modi esistenti di `src/permissions.mjs`:

| Modalità UI | Modo interno | Note |
| --- | --- | --- |
| Manuale | `suggest` | come oggi |
| Automatica assistita | `auto-edit` | come oggi, con allowlist versionata |
| Senza supervisione | `full-auto` + `ProjectPolicy` | richiede sandbox verificata |

### 6.1 `ProjectPolicy` (versionata, `$BITCODE_HOME/desktop/projects/<projectId>/policy.json`)

```jsonc
{
  "version": 7, "updatedAt": "ISO",
  "writablePaths": ["src/**", "tests/**"],          // dentro la root; mai .git/, mai fuori progetto
  "commands": [ { "argv": ["npm", "test"] }, { "argvPrefix": ["node", "--test"] } ],
  "network": { "mode": "deny" | "allowlist",         // per comandi e subprocessi
    "destinations": [{ "scheme": "https", "host": "registry.npmjs.org", "port": 443 }] },
  "limits": { "maxSteps": 60, "maxToolCalls": 200, "maxDurationMin": 60,
              "maxTokens": 2000000, "maxCostMicros": null },
  "expiresAt": "ISO" | null
}
```

Le regole comando usano argv esatto o prefisso argv; nessuna regex, glob o shell
(coerente con la grammatica volutamente ristretta di `isReadOnlyCommand`). Un comando
con sintassi shell non è mai coperto da policy: richiede sempre approvazione.

Rete confermata (2A, D-9): ogni destinazione va autorizzata esplicitamente per
progetto; la lista dell'esempio non è preautorizzata. Nuove destinazioni passano
da `policy.propose` con origine umana. Lo spike D0 deve definire un gateway di
uscita con enforcement OS: proxy ambientali da soli sono aggirabili e `bwrap`
non applica una lista di domini. Nessun accesso diretto alla rete host; validare
schema/host/porta, redirect e destinazioni risolte, impedire bypass con IP,
DNS alternativo, socket locali e indirizzi privati/loopback non autorizzati.
Servizi locali necessari possono essere ammessi singolarmente, senza aprire
tutta la rete locale. Nessun MITM TLS richiesto dalla specifica.
I comandi senza compatibilità col gateway restano senza rete o richiedono una
soluzione esplicita, mai accesso Internet completo come ripiego. Le connessioni
ai modelli seguono il canale controllato separato di §11.1.

### 6.2 Tabella di decisione

| Azione | Manuale | Assistita | Senza supervisione |
| --- | --- | --- | --- |
| Lettura nel progetto | auto | auto | auto |
| Patch in `writablePaths` | approvazione | auto (con lease) | auto (con lease) |
| Patch fuori `writablePaths`, file esterni | approvazione | approvazione | attende approvazione |
| Comando read-only (`isReadOnlyCommand`) | auto | auto | auto |
| Comando in policy | approvazione | auto | auto in sandbox |
| Comando fuori policy | approvazione | approvazione | attende approvazione |
| Git commit/checkout/reset | approvazione | approvazione | in policy solo se elencato |
| Delegazione a Sat cloud da sessione locale | `egress` | `egress` | `egress` |
| Qualsiasi tool finanziario mutante di test | conferma `finance` per operazione | conferma `finance` per operazione | conferma `finance` per operazione |
| Cambio modalità/policy | solo umano | solo umano | solo umano |

«Attende» = il run resta in `awaiting_approval` e compare in Attività/tray; nessun
fallimento automatico, nessuna escalation. `tool.financial` resta escluso da ogni
auto-approvazione (`mayAutoApprove`). Senza supervisione con `bubblewrapAvailable()`
falso → `run.start` fallisce con `SANDBOX_UNAVAILABLE`; nessun ripiego.

I limiti dei Sats (`src/sats/policy.mjs`) si intersecano con la policy: una modalità non
aggiunge tool a un Sat.

## 7. Coordinamento sul progetto

- **Versione file:** `version = sha256(contenuto)` (link simbolici: `link:<target>`, come
  `fingerprint()` di `checkpoint.mjs`). Ogni scrittura (agente o buffer utente) porta
  `baseVersion`; se il file attuale differisce → `STALE_VERSION`, nessuna scrittura.
- **Buffer utente:** l'editor tiene `baseVersion`; se l'agente cambia il file la scheda
  mostra «modificato su disco» con diff, senza sovrascrivere il buffer. Salvataggio con
  versione obsoleta → dialogo unisci/sovrascrivi/annulla.
- **Lease di progetto:** operazioni multi-file, Git mutante, restore checkpoint e comandi
  shell non read-only acquisiscono un lease esclusivo `{leaseId, projectId, holder:
  runId|"user", ttl: 30 s rinnovabile}`. Letture e patch su file singolo in
  `writablePaths` prendono solo il controllo di versione. Lease occupato → il run
  attende in coda (visibile), l'utente riceve `LEASE_HELD` con il titolare.
- **Processi in background:** un comando con lease non lo rilascia finché il suo
  process group è vivo; `terminate_process` lo libera.
- **Esterni:** CLI non collegate ed editor esterni non partecipano ai lease: rilevati via
  watcher + versione all'applicazione; mai dichiarati coperti.
- **Worktree per task (1A, D-4 decisa):** ogni attività senza supervisione usa un
  worktree distinto (`git worktree add` fuori dal progetto), con integrazione
  esplicita dopo revisione diff. Opzionale nelle modalità manuale/assistita.
  La creazione non scarta modifiche non committate: dichiarare la baseline usata
  e consentire una copia controllata delle modifiche scelte. Se il progetto non
  è Git o il worktree non è creabile, segnalare il requisito e lasciare scegliere
  una modalità assistita; nessuna conversione automatica del repository.
  I metadati Git condivisi restano coordinati; un worktree non è una sandbox.
  Preservare il risultato finché l'utente non lo integra o elimina esplicitamente.

## 8. Modelli, utilizzo e privacy

```jsonc
// RunConfig, catturato a run.start e immutabile per il run
{ "runId": "…", "sessionId": "…", "mode": "assistita", "policyVersion": 7,
  "model": { "provider": "ollama", "id": "qwen3-coder", "locality": "local" },
  "satModels": { "node": null, "script": { "provider": "openai", "id": "…", "locality": "cloud" } },
  "localOnly": false, "limits": { … } }
```

- `locality` deriva dall'endpoint risolto (loopback = `local`), non dal nome del provider.
- `localOnly: true` → override/fallback cloud rifiutati con `LOCAL_ONLY` alla configurazione
  e di nuovo all'avvio della delega.
- Sessione locale + Sat cloud → richiesta `egress` alla prima delega di quel run.
- Nessun fallback implicito locale → cloud: `fallbacks` in `runAgent()` filtrati per
  `locality` quando la sessione è locale.
- `usage` per run; il totale di sessione somma i run root e i figli una sola volta
  (i figli già confluiscono nel padre: il controller conta per `runId` unico). Costo `null`
  se il prezzo è sconosciuto, mostrato «n/d», mai 0.

## 9. Concorrenza e risorse

Confermato 6A (D-5): tre attività attive e massimo una inferenza locale alla
volta, complessivamente fra tutte le sessioni e tutti i Sats. Entrambi i limiti
sono modificabili nelle impostazioni. Gli altri valori della tabella restano
proposte tecniche.

| Parametro | Default / stato | Configurabile |
| --- | --- | --- |
| Worker attivi | 3, confermato | sì; intervallo 1–8 proposto |
| Richieste concorrenti per provider cloud | 2, proposto | sì |
| Inferenze locali simultanee, complessive | 1, confermato | sì |
| Coda | 20 run, FIFO per priorità utente, proposto | sì |
| PTY utente | 8, proposto | no, proposto |

Il limite locale è applicato dal controller anche alle deleghe: due modelli
locali diversi non ottengono uno slot ciascuno per aggirarlo. Le richieste in
attesa mostrano il motivo dell'accodamento; annullarle libera la coda senza
interrompere l'inferenza di un'altra sessione.

Stati run: `queued → starting → (thinking|reading|running|drafting|delegating|
awaiting_approval) → success|error|cancelled|interrupted`. `interrupted` è nuovo:
crash del worker o uscita; nessuna ripresa automatica, l'utente può riavviare da Attività.
Il crash di un worker non tocca gli altri; i suoi lease scadono per TTL, le approvazioni
pendenti diventano `cancelled`. I default confermati sono registrati in D-5.

## 10. Terminale

- PTY utente: `owner:"user"`, mai letto dall'agente salvo allegato esplicito di una
  selezione nella chat. Non soggetto a lease (l'utente agisce consapevolmente) ma le sue
  modifiche sono rilevate come `by:"user"`/`external`.
- Comandi agente: pannello separato «Agente», sola lettura per l'utente, intestazione con
  run, Sat e sandbox. Un comando agente non scrive mai in un PTY utente.
- Terminale: `xterm.js` nel renderer, PTY nel controller (`node-pty`, da verificare
  con licenza, rebuild per l'ABI di Electron e build `.deb`). Editor: CodeMirror 6 (D-1, decisa).

## 11. Segreti e credenziali

- Configurazione e sessioni contengono solo handle `secret://<uuid>`; il valore vive nel
  secret store di sistema (Electron `safeStorage`, backend libsecret).
- Se il backend è `basic_text` o assente → `SECRET_STORE_INSECURE`: nessuna persistenza;
  l'utente può inserire la credenziale solo in memoria fino all'uscita completa
  dell'app (5A, D-12 decisa). La chiusura nel tray non è un'uscita. Il riavvio
  richiede un nuovo inserimento; log, export, cache e crash report applicativi
  non devono contenere copie. Non promettere cancellazione forense della RAM.
- Registro di redazione: ogni valore segreto caricato viene aggiunto a un redattore che
  filtra `tool.detail`, `tool.output`, log, export ed eventi privati.
- Credenziali finanziarie risolte solo nel Finance service. I worker di coding ricevono
  un ambiente ripulito (nessuna variabile `BITCODE_*` finanziaria, nessun accesso al
  socket di controllo né alla directory `finance/`), con isolamento OS secondo §11.1.
- Export sessione: esclude wallet, seed, token Cashu, macaroon e PSBT.

### 11.1 Sandbox del worker di coding (D-7, decisa)

Ogni worker di coding è avviato dal controller dentro `bwrap`, non solo i comandi shell:

- **Filesystem:** root di sistema in sola lettura; progetto montato in lettura/scrittura
  secondo la policy; di `$BITCODE_HOME` solo `sessions/<slug>/`. Non montati:
  `$BITCODE_HOME/finance`, `$BITCODE_HOME/desktop`, `run/controller.sock`, i keyring
  (`~/.local/share/keyrings`, `~/.gnupg`; `~/.ssh` solo per scelta esplicita del progetto),
  la configurazione dei backend finanziari.
- **Portachiavi:** nessun accesso al bus D-Bus di sessione (niente `org.freedesktop.secrets`,
  niente `$XDG_RUNTIME_DIR/bus`); `--unshare-ipc`, `--unshare-pid`, `--die-with-parent`,
  `--new-session`, ambiente ripulito (`--clearenv` + variabili ammesse).
- **Credenziali del modello e rete:** per attuare 2A, il controller media le
  richieste ai provider sul canale §4.3 (`model.request`, streaming/cancel), usando
  soltanto il target e i limiti del RunConfig. Nessuna API di fetch generica e
  nessuna credenziale provider nel worker. Le connessioni ai modelli locali
  passano dallo stesso canale; non richiedono di condividere la rete host.
  Worker e subprocessi non hanno rete host diretta; l'uscita dei comandi usa
  esclusivamente il gateway con policy §6.1. Il gateway non deve esporre API di
  approvazione, credenziali o servizi finanziari. Questo dettaglio architetturale
  richiede uno spike prima di dichiarare l'allowlist applicata correttamente.
- **Fail closed:** `bwrap` assente o user namespace non disponibili → nessun worker di
  coding viene avviato, in nessuna modalità; la UI mostra la diagnosi.
- Il Finance service resta fuori da questa sandbox; utente di sistema dedicato valutato
  per D5. Lo spike D0 deve verificare `bwrap` annidato su Ubuntu 24.04 (restrizioni
  AppArmor sugli user namespace non privilegiati).

## 12. Archiviazione e coesistenza con la CLI

```
$BITCODE_HOME/
  sessions/<slug>/<id>.json      # invariato, condiviso con la CLI
  finance/                        # invariato, fuori dal workspace
  desktop/
    settings.json                 # versione schema, lingua, tema, limiti, provider (handle)
    approvals.jsonl
    projects/<projectId>/policy.json
    leases/                       # file di lease con pid e scadenza
  run/controller.sock             # presente solo con desktop avviato
```

- Una sessione aperta è posseduta da un solo processo (file `sessions/<slug>/<id>.lock`
  con pid). La CLI che apre una sessione già posseduta dal desktop ottiene sola lettura
  oppure si collega al controller (`bitcode --attach`).
- Migrazioni: `schemaVersion` per ciascun file; backup `.bak-<versione>` prima di
  migrare; versione futura sconosciuta → sola lettura, nessuna riscrittura.

### 12.1 Conservazione della cronologia (4A, D-11 decisa)

Conversazioni e output scadono dopo 30 giorni dall'ultima attività; l'utente può
marcare una sessione `keep: true` per conservarla. Il controller applica la pulizia
all'avvio e periodicamente, escludendo sessioni con run attivi. Mostrare scadenza
e comando «Conserva»; esportazione e cancellazione restano disponibili.
Rimuovere anche copie/cache/backup della cronologia gestiti dall'app; chiudere
le viste che potrebbero riscrivere una sessione eliminata. File del progetto,
worktree non integrati, wallet, ledger e registri necessari alla riconciliazione
finanziaria hanno lifecycle distinto e non vengono cancellati da questa regola.
Sessioni CLI precedenti: applicare la retention solo dopo esplicita presa in
gestione, mostrando gli effetti. Le esportazioni create dall'utente rimangono
sotto il suo controllo. Non promettere eliminazione forense da dischi o backup
esterni. Il registro approvazioni conserva metadati minimi; payload con comandi,
diff o contenuto della conversazione seguono la retention del contenuto, salvo
le evidenze finanziarie strettamente necessarie e gestite separatamente.

### 12.2 Aggiornamenti (7A, D-13 decisa)

L'app notifica la disponibilità di una versione; download del pacchetto e
installazione richiedono una scelta dell'utente. Nessuna installazione o riavvio
automatico in background. Verifica autenticità dell'artefatto e compatibilità
dello schema dati; con run attivi proporre di attendere o terminarli esplicitamente.
Preservare buffer e stato prima dell'uscita. Il packaging `.deb` deve integrare
questo flusso con gli strumenti del sistema. La verifica disponibilità versioni
deve essere documentata come traffico di aggiornamento, disattivabile e senza
trasmettere progetto, conversazioni o identificatori univoci dell'installazione.

## 13. Area finanziaria

### 13.1 Interfaccia adapter

```ts
interface FinanceAdapter {
  protocol: "bitcoin" | "lightning" | "cashu" | "liquid" | "taproot-assets";
  verifyEnvironment(conn): Promise<{ environment: "test" | "production" | "unknown",
      network: string, evidence: Array<{ source: string, value: string }> }>;
  capabilities(conn): Promise<string[]>;            // effettive, non dichiarate
  read(conn, op, args): Promise<unknown>;            // solo consultazione
  prepare?(conn, intent): Promise<Proposal>;         // solo environment === "test"
  execute?(conn, proposalId, approval): Promise<Outcome>;
  reconcile?(conn, proposalId): Promise<Outcome>;
}
```

- Il controller registra `prepare/execute/reconcile` **solo** per connessioni la cui
  verifica più recente è `test`. Per `production` e `unknown` i metodi non esistono e
  il backend risponde `ENV_READ_ONLY`/`ENV_UNVERIFIED`; i pulsanti disabilitati sono solo
  un riflesso.
- La verifica si ripete prima di ogni `prepare` ed `execute`; un cambiamento invalida
  le proposte aperte di quella connessione.
- Creazione di indirizzi, invoice e importazione di token sono operazioni `prepare`
  (mutanti), non letture.

### 13.2 Prove d'ambiente proposte

| Protocollo | Prova | Ambiente test ammesso |
| --- | --- | --- |
| Bitcoin | hash del blocco genesi via backend + prefisso degli indirizzi + rete PSBT | signet, testnet4, regtest |
| Lightning (LND) | `GetInfo.chains[].network` + genesi del bitcoind collegato + prefisso invoice | signet, testnet, regtest |
| Taproot Assets | rete di tapd/LND sottostante + universo configurato | come Lightning |
| Liquid | genesi/`chain` di elementsd o Esplora Liquid testnet + prefisso indirizzi | liquidtestnet, elementsregtest |
| Cashu | mint presente nell'allowlist di test dell'utente **e** metodo di melt verso Lightning `test` verificato | solo mint ammessi esplicitamente |

Il nome di rete in configurazione non è prova. Per Cashu nessuna prova crittografica
dell'ambiente esiste: la proposta è «mint ammesso esplicitamente + unità + melt verso
nodo di test». Definizione confermata (D-6): un mint è operativo solo se l'utente lo ha
ammesso esplicitamente nell'allowlist di test e i melt sono diretti a un nodo Lightning la
cui verifica d'ambiente (riga Lightning sopra) risulta `test`. Senza questa seconda
condizione il mint resta in consultazione; nome o URL del mint non contano.

### 13.3 Ciclo di vita della proposta

Si generalizza lo store esistente (`src/finance/store.mjs`), già conforme:

`prepared → executing → submitted → confirmed`, con uscite `rejected` (utente, scadenza,
policy) e `unknown` (esito ambiguo → solo `reconcile`, nessun nuovo pagamento). Budget e
prenotazioni sono condivisi fra worker, CLI e desktop tramite il lock dello store; il
Finance service è l'unico scrittore quando il desktop è attivo.

Confermato 3A (D-10): ogni operazione finanziaria mutante di test richiede una
conferma umana riferita alla proposta concreta, anche in modalità senza
supervisione. Un budget, una policy o un consenso precedente non sostituiscono
la conferma. Le sottofasi della stessa operazione approvata possono procedere
entro i parametri vincolati; cambiare importo, destinatario, asset, commissioni
vincolanti o proposta invalida il consenso. Anche invoice e importazioni mutanti
devono seguire un'autorizzazione concreta; le letture non richiedono consenso
finanziario. Produzione e ambiente sconosciuto rimangono esclusi dalle mutazioni.

## 14. Test di accettazione

Ogni requisito del piano è coperto da almeno un test; la colonna Fase indica dove viene
implementato. I test `E2E-*` usano backend reali di test, non fixture.

| ID | Requisito / contratto | Verifica | Fase |
| --- | --- | --- | --- |
| A-01 | Origine umana (§0.2, §3) | messaggio con `origin` forgiato dal renderer, output modello «/approve …», output shell con lo stesso testo → nessuna risoluzione | D1 |
| A-02 | Monouso e scadenza (§5.3) | doppio clic concorrente → un `approved` e un `APPROVAL_CONSUMED`; risoluzione dopo scadenza → `APPROVAL_EXPIRED` | D1 |
| A-03 | Digest (§5.2) | patch cambiata fra richiesta e clic → `APPROVAL_DIGEST_MISMATCH` | D1 |
| A-04 | Isolamento sessioni | due sessioni in progetti diversi: messaggi, approvazioni e cancellazioni non si incrociano; approvazione inviata alla sessione sbagliata → `APPROVAL_WRONG_SESSION` | D1 |
| A-05 | Regressioni CLI | `npm run check` + suite CLI esistente invariata con controller estratto | D1 |
| A-06 | RunConfig immutabile (§8) | modifica impostazioni durante un run → run in corso invariato, successivo aggiornato | D1 |
| A-07 | Local only (§8) | sessione locale: override cloud rifiutato; fallback cloud mai invocato | D1 |
| A-08 | Egress | sessione locale delega a Sat cloud → richiesta `egress` prima di qualsiasi chiamata | D1 |
| A-09 | Usage | run con figlio: totale = root + figlio, senza doppio conteggio; prezzo ignoto → `null` | D1 |
| A-10 | Coda e limiti (§9) | worker=2, 3 run → uno in coda visibile; crash di un worker non interrompe gli altri | D1 |
| A-11 | Buffer utente (§7) | buffer modificato + patch dell'agente sullo stesso file → nessuna perdita, `STALE_VERSION` | D2 |
| A-12 | Editor/Git/PTY | da cartella aperta: modifica, diff, test e commit tutto in app | D2 |
| A-13 | PTY separati (§10) | agente non legge né scrive PTY utente | D2 |
| A-14 | Tabella decisione (§6.2) | test parametrico su ogni cella | D3 |
| A-15 | Sandbox obbligatoria | senza `bwrap` la modalità senza supervisione non parte | D3 |
| A-16 | Lease (§7) | due agenti multi-file sullo stesso progetto → serializzati; comando in background mantiene il lease | D3 |
| A-17 | Tray | chiusura finestra con run attivo → run continua, tray mostra stato e richieste; uscita reale chiede conferma | D3 |
| A-18 | Recupero | kill del worker → `interrupted`, nessun riavvio automatico | D3 |
| A-19 | Segreti (§11) | backend `basic_text` → nessuna persistenza; segreto mai presente in eventi, log, export | D1/D5 |
| A-20 | Isolamento credenziali (§11.1) | dal worker di coding: env, file, socket, D-Bus e keyring non espongono credenziali finanziarie; senza `bwrap` nessun worker parte | D1/D3 |
| A-21 | Produzione read-only (§13) | per ogni protocollo, `prepare/execute` su connessione mainnet → `ENV_READ_ONLY` dal backend con UI bypassata | D4 |
| A-22 | Prova d'ambiente | configurazione «testnet» con backend mainnet → classificata `production`; mint Cashu non ammesso, o con melt verso nodo non `test`, → sola consultazione | D4 |
| E2E-BTC/LN/CASHU/LIQ/TAP | Flussi §9 del piano | un flusso completo e riconciliato per protocollo su backend di test | D4 |
| A-23 | Ambiguità | timeout broadcast/pagamento → `unknown`, nessun nuovo pagamento fino a riconciliazione | D4 |
| A-24 | i18n/temi/a11y | IT/EN, chiaro/scuro, tastiera, contrasto AA, reduced motion | D2/D5 |
| A-25 | Installazione | `.deb` su macchine pulite della matrice: installa, aggiorna, rimuove, conserva dati | D5 |
| A-26 | Worktree autonomi (1A) | due task autonomi usano directory distinte; modifiche manuali originali preservate; integrazione solo dopo azione umana | D3 |
| A-27 | Rete per destinazione (2A) | destinazione autorizzata raggiungibile; accesso diretto, redirect, DNS/IP alternativi e servizi locali non ammessi bloccati anche da subprocessi | D1/D3 |
| A-28 | Conferma finanza (3A) | nessuna modalità esegue una seconda operazione usando il consenso della prima o il solo budget; dati cambiati invalidano la conferma | D4 |
| A-29 | Retention (4A) | orologio controllato: 30 giorni, sessioni conservate/attive, cache/backup, cronologia CLI non importata e registri finanziari trattati secondo §12.1 | D1/D5 |
| A-30 | Segreti volatili (5A) | portachiavi assente: uso in memoria, tray mantiene il contesto, uscita completa/riavvio richiede credenziale; niente valore nei file applicativi | D1/D5 |
| A-31 | Aggiornamenti (7A) | notifica senza download/installazione automatica; artefatto non autentico rifiutato; nessun riavvio con attività non gestite | D5 |
| A-32 | Default concorrenza (6A) | quattro run: al massimo tre attivi; richieste a modelli locali diversi, anche da Sats, eseguono una alla volta; cancellare una richiesta in coda non interrompe le altre | D1 |

## 15. Decisioni per chiudere D0

| ID | Decisione | Proposta |
| --- | --- | --- |
| D-1 | Shell, editor, terminale | **Decisa 2026-10-03:** Electron + CodeMirror 6 + xterm.js |
| D-2 | Matrice piattaforme | Ubuntu 24.04 LTS + Debian 12, GNOME e KDE, Wayland e X11 |
| D-3 | Scadenze approvazioni | 15 min azioni, 5 min policy/mode/egress |
| D-4 | Worktree per task | **Decisa (1A):** separato per ogni attività senza supervisione, integrazione esplicita dopo diff; opzionale nelle altre modalità |
| D-5 | Default di concorrenza | **Decisa (6A):** tre attività attive e massimo una inferenza locale complessiva alla volta, limiti modificabili; gli altri valori di §9 restano proposti |
| D-6 | «Testnet» per Cashu | **Decisa 2026-10-03:** solo mint ammessi esplicitamente, con pagamenti verso un nodo Lightning di test verificato (§13.2) |
| D-7 | Isolamento OS del worker di coding | **Decisa 2026-10-03:** worker in sandbox `bwrap` senza accesso ai dati finanziari né al portachiavi (§11.1) |
| D-8 | Backend supportati per protocollo | Bitcoin Core/Esplora locale, LND+tapd, elementsd/Esplora Liquid, mint Cashu CDK (versioni da fissare con gli spike D0) |
| D-9 | Rete comandi | **Decisa (2A):** destinazioni autorizzate per progetto; consenso per aggiungerne altre; enforcement oltre `bwrap` |
| D-10 | Autonomia finanziaria di test | **Decisa (3A):** conferma umana per ogni operazione |
| D-11 | Cronologia | **Decisa (4A):** 30 giorni, con sessioni conservabili esplicitamente |
| D-12 | Portachiavi indisponibile | **Decisa (5A):** credenziali solo in memoria fino all'uscita completa |
| D-13 | Aggiornamenti | **Decisa (7A):** notifica e installazione scelta dall'utente |

Chiusura D0: decisioni sopra registrate in `desktop-plan.md` §1, mockup approvati,
spike di fattibilità (packaging, PTY, secret store, un adapter per protocollo) con esito
documentato.
