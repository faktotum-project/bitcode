# Bitcode Desktop — piano di prodotto e implementazione

Stato: **requisiti di prodotto consolidati; specifica tecnica proposta**.
Data: 2026-10-03. Baseline: commit `a98fb95`.
Questo documento distingue scelte dell'utente, proposte e decisioni ancora aperte.
Non certifica funzionalità desktop o sicurezza che non sono ancora implementate.
Le conferme riguardano il prodotto descritto nella sezione 1. Le scelte tecniche
e i dettagli operativi successivi sono il piano per realizzarlo, non funzionalità
già disponibili. L'attività corrente rimane di pianificazione.

## 1. Scelte confermate

- Piattaforma coding + Bitcoin, con entrambe le aree centrali.
- Editor e terminale integrati, utilizzabili senza avviare separatamente la CLI.
- Editor v1: schede, evidenziazione, ricerca, diff e Git.
- Bitcoin on-chain, Lightning, Cashu, Liquid e Taproot Assets nel perimetro v1.
- Ambienti di test operativi; produzione/mainnet inizialmente in sola lettura.
- Modelli locali e cloud, con scelta esplicita dell'utente.
- Ogni Sat eredita il modello della sessione, con possibilità di assegnargli
  esplicitamente un modello diverso.
- Connessione guidata a nodi e servizi esistenti; creazione di wallet di test
  esplicita, senza installazione automatica di nodi completi.
- Nessun account Bitcode obbligatorio, nessuna telemetria predefinita;
  cronologia locale gestibile ed esportabile.
- Tre livelli di lavoro: manuale, automatico e automatico senza supervisione.
- Approvazioni sia dei comandi da eseguire, sia tramite comandi di controllo
  inseriti dall'utente; pulsanti nell'interfaccia per le stesse operazioni.
- Stile Bitcode/Sats crema e Ink, tema scuro, interfaccia italiano/inglese.
- Più esecuzioni simultanee, anche fra progetti diversi.
- Chiusura della finestra: attività continuano nell'area di notifica.
- Distribuzione ad altri utenti dalla prima release.
- Piattaforme da certificare: Ubuntu/Debian, x86_64.
  Versioni e desktop environment della matrice non ancora fissati.
- Decisioni D0 del 2026-10-03:
  - shell desktop Electron, editor CodeMirror 6, terminale xterm.js;
  - Cashu «di test»: solo mint ammessi esplicitamente dall'utente, con pagamenti
    verso un nodo Lightning di test verificato;
  - worker dell'agente di coding in sandbox `bwrap`, senza accesso ai dati
    finanziari né al portachiavi.
- Questionario sicurezza/privacy/funzionamento, risposte registrate:
  - **1A:** worktree Git separato per ogni attività senza supervisione;
    integrazione esplicita dopo revisione del diff.
  - **2A:** rete dei comandi limitata a destinazioni autorizzate per progetto;
    altre destinazioni richiedono consenso.
  - **3A:** conferma umana per ogni operazione finanziaria di test, indipendente
    dalla modalità di autonomia del coding.
  - **4A:** conversazioni e output conservati automaticamente per 30 giorni,
    con possibilità di conservare esplicitamente singole sessioni.
  - **5A:** se il portachiavi non è disponibile/sicuro, credenziali soltanto
    in memoria fino alla chiusura completa dell'app.
  - **6A:** tre attività attive, massimo una inferenza locale alla volta
    complessivamente, con limiti modificabili nelle impostazioni.
  - **7A:** notifica degli aggiornamenti e installazione scelta dall'utente.

## 2. Schermate proposte

1. **Avvio guidato:** scelta modello locale/cloud, credenziali, primo progetto,
   connessioni opzionali a nodi/wallet, diagnosi delle dipendenze.
2. **Coding:** progetti e file, editor a schede, chat, allegati/riferimenti ai file,
   terminale PTY, diff, stato Git, cronologia e checkpoint.
3. **Bitcoin:** dashboard distinta per protocollo, asset e ambiente; connessioni,
   stato reale o «non disponibile», saldi, operazioni e proposte autorizzabili.
4. **Sats:** selezione Node/Script/Hash/Merkle, attività reale, esiti e approvazioni;
   componente condiviso fra le due aree, non quattro motori indipendenti.
5. **Attività:** esecuzioni correnti, richieste in attesa, cancellazione, risultati.
   Ogni attività identifica progetto, sessione, agente e modello.
6. **Impostazioni:** modelli, permessi, connessioni, privacy, lingua/tema,
   diagnostica, aggiornamenti e gestione dei dati.

Layout proposto: navigazione a sinistra, contenuto centrale, chat/Sats laterali,
terminale e diff in pannelli ridimensionabili. Non ancora approvato visivamente.
Temi chiaro crema/Ink e scuro con token condivisi; font Inter/JetBrains Mono
e identità dei quattro Sats mantenuti. Tradurre UI, errori e approvazioni senza
tradurre nomi di tool, comandi, identificativi o contenuto dei file.

## 3. Autonomia — livelli confermati, policy proposta

| Modalità | Modifiche al progetto | Comandi dell'agente |
| --- | --- | --- |
| Manuale | L'agente propone; l'utente applica/approva | Autorizzazione esplicita |
| Automatica assistita | Modifiche automatiche entro il progetto autorizzato | Approvazione quando non già autorizzati |
| Senza supervisione | Modifiche automatiche entro il progetto autorizzato | Solo entro una policy preautorizzata; fuori policy il task attende |

I tre livelli e i canali di approvazione sono confermati. La tabella propone
il dettaglio operativo delle autorizzazioni, ancora da finalizzare.
Le modalità del coding non autorizzano pagamenti né ampliano le policy dei Sats.
Il modello non può approvare le proprie richieste o cambiare i limiti.

Pulsanti e comandi umani devono invocare la stessa API di autorizzazione.
Esempi di UX proposti, non comandi già implementati: `/approve <request-id>`,
`/deny <request-id>`, `/cancel <run-id>`, `/mode <modalita>`.
Una richiesta mostra comando/argomenti o diff effettivi, progetto, sessione e
agente. ID, stato e scadenza impediscono che due run concorrenti si scambino
autorizzazioni. Doppio clic, consenso scaduto o comando modificato non autorizzano
una nuova azione. Nessuna approvazione globale implicita o «approva tutto».
Gli input di controllo devono provenire dal canale umano fidato: output del
modello, output shell, tool e plugin non possono diventare comandi di approvazione.

Proposte trasversali:

- Permessi versionati per progetto/run, scadenza, budget e limiti di tempo/tool.
- Cambi di modalità espliciti; niente escalation silenziosa se manca la sandbox.
- Approvazioni riferite all'azione concreta, monouso; nessun consenso dedotto
  dal testo del modello. UI e comandi condividono le stesse verifiche backend.
- Diff e stato Git distinti dagli artefatti delle dipendenze; checkpoint che
  preservano i symlink e non includono segreti/stato finanziario.
- «Annulla» ferma il lavoro residuo: non annulla pagamenti o modifiche già avvenuti.
- Il terminale dell'utente e i comandi dell'agente devono essere distinguibili.
- Rete dei comandi: destinazioni esplicite per progetto, controllate anche per
  i subprocessi. Un semplice flag di accesso alla rete o variabile proxy non
  soddisfa il requisito 2A. Collegamenti ai provider gestiti separatamente.

## 4. Contratto per gli ambienti finanziari

Il vincolo concordato deve essere applicato nel backend, non mediante pulsanti
disabilitati. Una semplice stringa «testnet» nella configurazione non è prova
che un nodo, wallet o mint appartenga a un ambiente di test.

- **Bitcoin:** selezione esplicita della rete; verifica di backend, indirizzi,
  wallet e proposta. Mainnet senza firma, invio o RPC finanziarie mutanti.
- **Lightning:** ambiente coerente con il nodo verificato e le invoice;
  operazioni di test con limiti e conferme separati. Mainnet consultazione.
- **Liquid:** ambiente e asset espliciti; implementare un adapter wallet di test.
  Il codice corrente offre soltanto interrogazioni, non un wallet operativo.
- **Taproot Assets:** verificare ambiente del backend e identità dell'asset;
  gestire trasferimenti, evidenze e stati incompleti nell'ambiente di test.
- **Cashu:** proposta di mints di test ammessi esplicitamente, wallet/state
  separati e verifica dei metodi di pagamento. Niente classificazione di sicurezza
  dal nome/URL del mint. Token reali esclusi dalle operazioni attive della v1.
  Confermato (2026-10-03): ammessi solo mint scelti esplicitamente, con pagamenti
  verso un nodo Lightning di test verificato.

Proposte di sicurezza: credenziali di sola lettura in produzione, nessuna
importazione automatica di seed, token o wallet reali; stato finanziario escluso
da undo/Git; segreti e bearer token esclusi da chat, feed e log generali.
L'agente di coding non deve poter recuperare credenziali finanziarie attraverso
shell, ambiente, file o plugin. Un processo separato con lo stesso utente NON
costituisce da solo un confine di sicurezza: serve isolamento OS verificato.

Confermata l'autorizzazione umana per ogni operazione finanziaria di test (3A).
I limiti di spesa sono controlli aggiuntivi, non un'autorizzazione automatica.
Flusso previsto: preparazione, controllo deterministico,
revisione dei campi concreti, autorizzazione umana, registrazione durevole,
esecuzione, riconciliazione dell'esito. Nessun nuovo pagamento automatico dopo
timeout ambiguo. Inizialmente niente bridge, peg-in/out, scambi automatici o
retry cross-protocollo salvo esplicita estensione del perimetro.

## 5. Modelli, dati e privacy — proposte

- Confermati: scelta locale/cloud, override per Sat, assenza di account Bitcode
  obbligatorio e telemetria predefinita, cronologia locale gestibile/esportabile.
  I dettagli di gestione sotto riportati costituiscono la specifica proposta.
- Modello/provider visibili per sessione; nessun fallback locale → cloud implicito.
- Nessun account Bitcode obbligatorio, nessuna telemetria predefinita.
- Modello della sessione come default dei Sats; override opzionale per ciascun
  Sat. Mostrare il modello effettivo prima dell'avvio e nell'attività. Catturare
  la configurazione per run: una modifica nelle impostazioni vale per i nuovi
  run, senza cambiare silenziosamente quelli in corso.
- Passare da inferenza locale a un Sat cloud richiede una scelta esplicita
  visibile: la delegazione può trasmettere il contesto del progetto al provider.
  La modalità esclusivamente locale rifiuta override e fallback cloud.
- Registrare utilizzo per run e totale della sessione, includendo i figli senza
  doppio conteggio. Prezzi/costi non disponibili vanno indicati come tali.
- Modalità inferenza locale distinta da «offline»: nodi, mints, MCP, shell e
  download possono fare rete; una vera modalità offline necessita blocchi propri.
- Credenziali tramite secret store del sistema; se indisponibile o non sicuro,
  credenziali solo in memoria fino all'uscita completa (5A). Nascondere la
  finestra nel tray non chiude l'app. Non dichiarare sicuro `basic_text`.
- Coesistenza con `BITCODE_HOME` e sessioni CLI; migrazioni esplicite, backup,
  gestione dei lock e prevenzione di scritture concorrenti.
- Storico, esportazione, cancellazione e conservazione configurabili. Esportare
  una sessione non significa esportare wallet o materiale di recupero finanziario.
- Conservazione predefinita di conversazioni e output: 30 giorni (4A), con
  sessioni esplicitamente conservate. Specifica tecnica: contare dall'ultima
  attività, escludere run attivi dalla pulizia e includere copie di ripristino e
  cache della cronologia. Non eliminare file del progetto o registri finanziari.
  L'importazione di cronologia CLI preesistente deve esplicitare questa regola;
  non cancellare retroattivamente sessioni mai gestite dal desktop.

### Connessioni e onboarding confermati

La prima configurazione deve poter terminare aprendo un progetto e scegliendo
un provider disponibile, senza richiedere alcun nodo Bitcoin. Ogni connessione
finanziaria si aggiunge separatamente con indirizzo, credenziali, prova di
connessione e verifica dell'ambiente. Mostrare le capacità effettive del backend.
Nessun download o avvio automatico di nodi completi. La creazione di un wallet
di test è un'azione esplicita con percorso di archiviazione e recupero dichiarati.
Per i provider cloud può essere necessaria la credenziale del relativo servizio:
l'assenza di account Bitcode non elimina i requisiti dei provider scelti.

## 6. Background — requisito e proposte operative

La finestra si nasconde senza interrompere un'esecuzione. Menu dell'area di
notifica: riapri, stato, richieste in attesa, annulla attività, esci realmente.
Le approvazioni non diventano automatiche perché la finestra è nascosta.
Proposta: notifiche di completamento/errore/approvazione senza contenuti sensibili;
nessun avvio al login predefinito. Definire comportamento su logout, sospensione,
crash e riavvio; nessuna ripresa automatica di pagamenti o shell incerti.

Su Linux il comportamento tray varia per desktop environment. Certificare il
percorso supportato e una via di riapertura quando l'icona non è visibile;
non lasciare l'utente senza accesso ai controlli di un task in background.

## 7. Architettura candidata, non ancora deliberata

Conservare il runtime Node.js e i provider esistenti. Estrarre dalla CLI il
controller di sessione, che diventa comune a CLI e desktop. Non controllare il
motore tramite parsing di stdout o una seconda implementazione di runAgent.

Electron è la shell scelta (D0, 2026-10-03), con CodeMirror 6 e xterm.js.
Queste librerie, il PTY e il packaging
devono essere selezionati/pinnati con verifica licenze e build Linux.

Se Electron: renderer senza Node, context isolation e sandbox, UI locale/CSP,
bridge con API ristrette e validazione di mittente/payload; controller e worker
separati dalla UI. L'isolamento renderer non sostituisce quello delle shell.
I nuovi canali chat/approvazioni hanno un contratto privato distinto dal feed
Sats di sola osservazione, che oggi non contiene prompt, output o argomenti raw.
Preservare compatibilità CLI e policy dei quattro Sats.

Il bus corrente supporta un root run e un figlio autorizzato. La v1 desktop deve
supportare più run concorrenti senza rimuovere indiscriminatamente quel vincolo:
proposta di worker e bus distinti per sessione, con un controller globale che
aggrega viste, pianifica risorse e applica vincoli condivisi. Politiche dei Sats
e limiti di delegazione restano validi per ogni esecuzione.

### Concorrenza — requisito confermato, coordinamento proposto

- Sessioni isolate per progetto, messaggi, tool, cancellazione e approvazioni.
- Numero di worker attivi configurabile, coda visibile, limite delle richieste
  al provider e delle risorse locali. Default confermati (6A): tre attività attive
  e una sola inferenza locale complessiva; le richieste eccedenti attendono in coda.
- Chat/editor a schede e pannello Attività globale; Sats mostrati per la sessione
  selezionata, con riepilogo delle attività delle altre sessioni.
- Stesso progetto: letture concorrenti; scritture/versioni e operazioni Git
  coordinate. Niente sovrascrittura silenziosa di buffer manuali o modifiche di
  altri agenti. Se il file cambia, nuova valutazione/diff prima dell'applicazione.
- Operazioni multi-file, Git/undo e shell mutanti richiedono un coordinamento
  a livello progetto: un semplice lock del singolo file non basta. I run senza
  supervisione lavorano in worktree Git separati (1A), con integrazione esplicita
  delle modifiche. Per le altre modalità il worktree è opzionale.
- Shell non classificabili conservativamente mutanti: non lasciare che
  bypassino il coordinamento attraverso subprocessi o background jobs.
- Budget/prenotazioni finanziari condivisi per wallet, account e policy;
  atomicità fra worker, CLI e processi, non un limite separato per ogni chat.
- CLI esterne ed editor non partecipanti ai lock: rilevare cambiamenti/versioni,
  rifiutare scritture obsolete; non dichiarare i lock efficaci su altri programmi.
- Fine/crash di una sessione non cancella le altre. Pagamenti o processi incerti
  richiedono riconciliazione, non riavvio automatico dell'azione.

## 8. Distribuzione e criteri di accettazione proposti

- Pacchetto `.deb` come primo candidato; formato portabile aggiuntivo da valutare.
- Utente finale senza installazione manuale di Node, npm o toolchain Rust.
  Backend e binari opzionali inclusi/verificati oppure connessione a servizi
  esistenti: non installare silenziosamente nodi e modelli.
- Manifest con hash/firma, licenze/SBOM, istruzioni di installazione/rimozione,
  diagnostica redatta e procedura di aggiornamento/rollback applicativo.
- Se Electron, aggiornamenti Linux progettati tramite packaging: il modulo
  `autoUpdater` non fornisce supporto Linux integrato.
- Aggiornamenti (7A): notifica di disponibilità e installazione scelta dall'utente;
  nessun download del pacchetto o riavvio automatico. Verificare autenticità e
  compatibilità dei dati prima di applicare l'aggiornamento; gestire i run attivi.
- Matrice versioni Ubuntu/Debian, GNOME/KDE, X11/Wayland da fissare.
- Test installer su sistemi puliti, core condiviso/CLI, editor/Git/PTY,
  approvazioni/cancellazione/tray, riavvio e recupero, payload ostili,
  isolamento shell/credenziali, blocco backend delle mutazioni in produzione.
- Test concorrenti: progetti distinti, scritture concorrenti e buffer manuali
  nello stesso progetto, Git/undo/shell, approvazioni indirizzate alla sessione
  sbagliata, doppio consenso, consumo condiviso di budget, crash di un solo worker.
- Test temi chiaro/scuro, italiano/inglese, tastiera, contrasto e reduced motion.
- E2E reali per ciascun adapter di test; fixture non sufficienti per dichiarare
  integrazioni operative. Test mainnet senza movimenti di fondi.
- Release pubblica solo dopo questi gate; non presentare adapter incompleti
  come operativi. Fissare requisiti hardware e budget RAM/dimensioni da misurare.

## 9. Sequenza di implementazione proposta

1. **D0 — Specifica:** chiudere decisioni aperte, workflow, mockup e threat model.
2. **D1 — Core condiviso:** controller/sessioni, API eventi e controllo,
   approvazioni, worker/coda, lock, concorrenza, lifecycle e regressioni CLI.
3. **D2 — Desktop coding:** shell applicativa, progetti, editor/Git/PTY, chat e Sats.
4. **D3 — Autonomia e background:** policy, isolamento OS, tray e recupero.
5. **D4 — Area finanziaria:** dashboard/read-only produzione, poi adapter
   operativi di test separatamente verificati per tutti i cinque protocolli.
6. **D5 — Release:** secret store, onboarding, installer, matrice Linux,
   verifiche di sicurezza, documentazione e artefatti di distribuzione.

Nessuna stima calendariale definitiva prima di chiudere D0 e verificare gli adapter.
LSP/debugger e marketplace di estensioni non sono requisiti confermati della v1.

### Consegne verificabili per fase

| Fase | Consegna | Criterio di completamento |
| --- | --- | --- |
| D0 | Specifica eseguibile, contratti API, layout e matrice piattaforme/backend | Ogni requisito ha un test di accettazione e una fase assegnata; adapter e librerie hanno una verifica di fattibilità |
| D1 | Controller comune a desktop/CLI, worker e autorizzazioni | Due sessioni indipendenti eseguono task senza incrociare messaggi, permessi o cancellazioni; regressioni CLI superate |
| D2 | App coding con editor, Git, PTY, chat e Sats | Da cartella aperta a modifica, revisione diff e test del progetto completamente nell'app |
| D3 | Tre modalità, concorrenza sul progetto e tray | Le modifiche manuali non vengono perse; chiusura/riapertura mantiene i run; controlli e limiti restano attivi |
| D4 | Cinque protocolli nell'area Bitcoin | Per ogni protocollo, un flusso di test completo e riconciliato; le corrispondenti operazioni mutanti di produzione sono rifiutate dal backend |
| D5 | Release installabile e documentata | Installazione, aggiornamento e rimozione su macchine pulite della matrice, conservando i dati secondo le scelte dell'utente |

Tutte le fasi contribuiscono alla v1 concordata. Eventuali build intermedie sono
anteprime di sviluppo e non riducono il perimetro della prima release completa.
Gestione delle credenziali e confini di sicurezza vanno progettati in D0/D1;
D5 ne verifica l'integrazione e la distribuzione, non ne rinvia l'introduzione.

### Operazioni finanziarie v1 proposte per la specifica eseguibile

| Protocollo | Flusso operativo nell'ambiente di test | Consultazione in produzione |
| --- | --- | --- |
| Bitcoin | Ricezione, preparazione PSBT con commissioni, conferma, firma/invio e verifica esito | Rete, indirizzi, UTXO, transazioni e saldi osservabili |
| Lightning | Creazione invoice, pagamento con limite commissioni e verifica stato su nodo esistente | Informazioni nodo, saldi, canali e stato operazioni |
| Cashu | Mint di test, emissione, ricezione/invio token e pagamento tramite mint con riconciliazione | Metadati e informazioni autorizzate del wallet/mint, senza esposizione dei bearer token |
| Liquid | Wallet di test, ricezione/invio di asset supportati, commissioni e verifica esito | Transazioni/asset e dati del wallet effettivamente disponibili con credenziali di consultazione |
| Taproot Assets | Ricezione/invio di asset di test, identificazione asset e verifica del trasferimento tramite backend | Inventario e saldi degli asset disponibili dal backend |

Questa tabella definisce il target tecnico proposto; non estende la v1 a emissione
di nuovi asset, amministrazione dei canali, bridge o trading. D0 deve fissare
versioni, reti di test e backend che rendono eseguibile ogni riga. Dati mancanti,
output confidenziali non leggibili e funzionalità assenti non diventano valori
inventati o saldi zero. La creazione di indirizzi/invoice o l'importazione di token
non va classificata come lettura solo perché non è un pagamento in uscita.

## 9.1 Stato di implementazione (anteprima di sviluppo, 2026-10-03)

Codice in `desktop/`. Anteprima D1/D2, non una release. Verificato con
`npm run test:desktop` (7 test, incluso un run reale del worker in `bwrap`) e
con l'avvio dell'app, sia in sviluppo sia pacchettizzata (`npm --prefix desktop run pack`).

Implementato:
- Controller (`desktop/core/controller.mjs`): progetti, sessioni condivise con
  la CLI (`src/session.mjs`), coda con limite di attività e una sola inferenza
  locale per volta (6A), RunConfig congelato per run, approvazioni monouso
  legate a sessione e digest, comandi `/approve` `/deny` `/cancel` `/mode`
  `/pending` sullo stesso backend dei pulsanti, policy per progetto versionata
  (comandi argv e destinazioni di rete), lease di progetto, `STALE_VERSION`
  per buffer e patch, consenso `egress` locale→cloud, `localOnly`, worktree
  separato per i run senza supervisione con integrazione esplicita (1A),
  retention di 30 giorni con «Conserva» (4A), registro `approvals.jsonl`.
- Worker dell'agente in `bwrap` (D-7), senza rete né home dell'host; le chiamate
  ai modelli e le mutazioni passano dal controller, e il worker non riceve
  credenziali dei provider.
- Shell Electron: renderer in sandbox senza Node, CSP, bridge con due sole funzioni
  e origine assegnata dal main, tray con richieste/annulla/esci, chiusura nel tray,
  notifiche senza contenuti sensibili, chiavi dei provider via `safeStorage` o
  solo in memoria (5A).
- UI: progetti, sessioni, albero file, editor CodeMirror con banner «modificato su
  disco», diff Git, stage/commit, terminale PTY dell'utente (xterm.js), pannello
  Agente, chat con Sats e card di approvazione, Attività, Impostazioni, IT/EN e
  tema chiaro/scuro/sistema.

Non ancora implementato (non presentare come disponibile):
- area Bitcoin: solo una schermata che indica gli adapter come non disponibili (D4);
- gateway di rete con enforcement OS per i comandi (2A): oggi i comandi non hanno
  rete; `network_fetch` passa dal controller con allowlist e consenso, senza
  redirect automatici né verifica degli IP risolti;
- socket di controllo per la CLI (`--attach`), lock di sessione fra processi,
  checkpoint/restore, aggiornamenti (7A), `.deb` verificato sulla matrice.

Nota di sviluppo: su Ubuntu 24.04 l'avvio con `npm run desktop` richiede che
`node_modules/electron/dist/chrome-sandbox` sia `root:root` con modo `4755`; in
alternativa, solo per sviluppo, si può avviare con `--no-sandbox`. Nel `.deb` lo
script post-installazione di electron-builder dovrebbe configurarlo: da verificare in D5.

## 10. Dettagli tecnici da finalizzare in D0

Bozza D0 in corso: contratti in [`desktop-d0-contracts.md`](desktop-d0-contracts.md),
mockup in [`design/desktop-mockups.html`](../design/desktop-mockups.html).

1. Policy granulari dei tre livelli, limiti, coordinamento delle mutazioni.
2. Layout e mockup; stile/temi/lingue già confermati.
3. Limiti di risorse e accodamento delle esecuzioni simultanee; override dei
   modelli per Sat già confermato.
4. Versioni distro/desktop, formato installer, framework/librerie.
5. Operazioni precise per protocollo di test, backend supportati, backup/restore.
6. Secret store, conservazione dati, budget e aggiornamenti; account, telemetria
   predefinita e cronologia locale già definiti.

Questi punti sono verifiche e scelte di realizzazione. Non richiedono di riaprire
le decisioni di prodotto già confermate; eventuali incompatibilità concrete vanno
riportate con impatto e alternativa prima di modificare il perimetro.

## Fonti tecniche

- Baseline locale: `docs/sats.md`, `src/permissions.mjs`, `src/session.mjs`,
  `src/finance/`, `src/liquid/tools.mjs`, `src/cashu/wallet.mjs`,
  `src/lightning/lnd.mjs`, `src/lightning/tapd.mjs`.
- [Cashu NUT-00](https://github.com/cashubtc/nuts/blob/main/00.md),
  [informazioni mint](https://github.com/cashubtc/nuts/blob/main/06.md),
  [melting](https://github.com/cashubtc/nuts/blob/main/05.md).
- [Electron security](https://github.com/electron/electron/blob/main/docs/tutorial/security.md),
  [tray Linux](https://www.electronjs.org/docs/latest/api/tray),
  [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage),
  [autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater).
- [Distribuzione Tauri](https://v2.tauri.app/distribute/).
