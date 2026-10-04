# Piano operativo — index.html e demo bitcode

Data: 10 settembre 2026. Base: bitcode 0.2 e le otto decisioni concordate in conversazione.

## Consegna completata — 13 settembre 2026

Implementata e verificata la revisione approvata: **tre walkthrough CLI** in
`index.html`, con la demo funzionalità riutilizzata nella hero.

| Demo | MP4 1920×1080 | MP4 1080×1920 |
| --- | --- | --- |
| Installazione | 30 s | 27 s |
| Configurazione / login | 17 s | 15 s |
| Funzionalità: comando e risposta | 39 s | 35 s |

Ogni demo include digitazione animata, output ANSI catturato dalla CLI, poster,
sottotitoli WebVTT, trascrizione e download verticale. La configurazione usa una
chiave di esempio mascherata; la risposta funzionalità proviene dalla sessione
locale realmente registrata. Il clone è una sequenza illustrativa, mentre gli
output di installazione, diagnostica e versione sono registrati. I dettagli di
provenienza sono conservati nel manifest e dichiarati nella pagina.

Verifica finale: decodifica completa dei sei MP4 H.264, dimensioni e durata;
nessun overflow a 360, 390, 768, 1280 e 1440 px; riproduzione, pausa reciproca,
sottotitoli, download, menu via Escape, movimento ridotto, testo al 200%,
JavaScript disabilitato e fallback video assente. Nessun MP4 richiesto al primo
caricamento e nessun errore console. `npm run lint`: 74 file verificati.
Ispezionati anche i fotogrammi e il layout della pagina; la risposta finale è
interamente visibile in entrambi i formati.

Le vecchie demo sono conservate in `.demo-archive/2026-09-10-events/`, fuori
dagli asset pubblici. Catture della nuova produzione e report di verifica sono
in `.demo-archive/2026-09-11-cli/`. Rigenerazione e verifica sono documentate in
`scripts/demos/README.md`. Pubblicazione online non eseguita.

## Revisione approvata — 11 settembre 2026

La nuova richiesta sostituisce le tre demo a schede con **tre walkthrough CLI**:
installazione, configurazione, funzionalità (comando e risposta). La hero riusa
la terza demo. I risultati e le spunte riportati più sotto documentano la versione
precedente e non certificano questa nuova produzione.

- `installation`: digitazione di clone e cd; output reale di installazione del
  core, `doctor` e `--version` su una copia temporanea del working tree.
- `configuration`: `login openai`, input mascherato di una chiave di esempio,
  avvio con `-m`, `/setting`. Nessuna chiamata al provider e nessuna verifica
  dell'accesso all'account è rappresentata.
- `features`: avvio read-only, menu reale, `/btc:fees`, chiamata al tool,
  risposta del modello locale effettivamente utilizzato e snapshot mainnet.

Vincolo visivo: il terminale deve usare prompt, wordmark, colori ANSI, menu,
stati e output della vera CLI. I comandi vengono digitati progressivamente;
l'output viene rivelato mantenendo sequenza e contenuto. Le attese sono abbreviate.
Il verticale ricompone le celle del terminale, senza stirare il formato web.
L'input segreto resta mascherato. Font monospace JetBrains Mono, sfondo chiaro,
accenti del tema bitcode. Restano MP4 web/9:16, poster, WebVTT e transcript.

Pipeline nuova: `capture-pty.py`, `record-cli.mjs`, `render-cli.mjs`,
`publish.mjs` in `scripts/demos/`. La pubblicazione online resta fuori ambito.
La configurazione reale dei provider e le registrazioni con gli altri modelli
restano rimandate come richiesto dall'utente.

## Obiettivo e stato

Completare la revisione di `index.html` mantenendo il design system, dimostrare le
funzioni effettive dell'agente e consegnare ogni video anche in formato verticale
9:16 per le storie Instagram.

Implementazione eseguita il 10 settembre 2026: pagina aggiornata, tre sessioni
reali registrate con il tag locale `ollama/qwen3.8:27b`, sei video esportati,
sottotitoli, trascrizioni e download integrati. I video sono replay editoriali dei
log del runtime bitcode, con estratti e tempi abbreviati; non sono catture dello
schermo del terminale.

Rimane da configurare l'accesso ai tre modelli richiesti per registrare versioni
aggiuntive con quei provider. Le loro etichette non sono state attribuite alle
sessioni Ollama. Pubblicazione online e caricamento su Instagram non eseguiti.

Per riprendere il lavoro, eseguire solo le voci ancora aperte; mantenere gli asset
verificati finché non sono pronte registrazioni sostitutive autentiche.

Aggiornamento 11 settembre 2026: l'utente rimanda la configurazione degli accessi
e le registrazioni con gli altri modelli. Per questa fase richiede solo il comando
CLI di login dell'agente: implementati `bitcode login [provider]` e
`/login [provider]`, con scelta del provider e inserimento mascherato della API key.
Le registrazioni aggiuntive restano rinviate a una richiesta successiva.

## Le otto decisioni

1. **Design / identità.** Conservare logo pixel, arancione `#f7931a`, canvas
   `#f7f7f4`, ink `#26251e`, Inter, JetBrains Mono, bordi sottili, superfici bianche
   e i cinque colori degli stati. Hero a due colonne su desktop, impilata su mobile.
2. **Design / demo.** Una preview breve nella hero e tre video contestuali alle
   funzionalità. Anteprime con titolo, modello realmente utilizzato e durata reale;
   accesso diretto alla trascrizione e al file verticale scaricabile.
3. **Animazione / intensità.** Transizioni di 150–250 ms; feedback chiaro su copia
   e navigazione; eventuale entrata del logo una sola volta. Niente layout shift;
   rispettare `prefers-reduced-motion` anche se cambia durante la sessione.
4. **Animazione / riproduzione.** Avvio esplicito su clic, controlli nativi, pausa,
   replay e fullscreen. Un solo video in riproduzione; pausa degli altri al cambio
   demo. Nessun autoplay. Poster immediati, video caricati quando richiesti.
5. **Demo / contenuti.** Tre sessioni reali: codice, Bitcoin, MCP con skill locale.
   Conservare richiesta, chiamate ai tool, risultati ed evidenze di verifica.
6. **Demo / modelli.** Utilizzare GPT-6 Astra, Claude Fable 5.1 e Qwen3.8-Flash-Next
   quando l'endpoint effettivamente disponibile supera una prova di tool calling.
   Mostrare provider e ID reali; registrare eventuali fallback e non attribuire
   l'esecuzione a un modello diverso da quello che ha risposto.
7. **Testi / destinatario.** Inglese, pubblico principale sviluppatori e operatori
   Bitcoin. Terminologia precisa e istruzioni eseguibili. Sottotitoli inglesi;
   trascrizioni leggibili anche senza riprodurre i video.
8. **Testi / promessa.** “Your code. Your Bitcoin. One agent.” Ogni capacità deve
   corrispondere a codice funzionante. Chiarire dipendenze opzionali, modalità
   read-only, provider esterni e condizioni di approvazione.

## MCP: capacità già presente

`src/mcp.mjs` usa `@modelcontextprotocol/client` v2. Supporta discovery ed esecuzione
di tool, risorse, prompt, trasporti stdio e Streamable HTTP, timeout e cancellazione.
I tool scoperti vengono aggiunti al catalogo dell'agente con nomi `mcp_<server>_<tool>`.
L'agente esegue l'integrazione: il modello deve supportare il normale tool calling,
senza bisogno di un client MCP nativo del provider.

Esempio di configurazione da integrare nel proprio `config.json`, adattando il
percorso a un server MCP esistente. Il percorso seguente è illustrativo e non
identifica un server già installato:

```json
{
  "mcp": {
    "project": {
      "command": "node",
      "args": ["/percorso/assoluto/server-mcp.mjs"],
      "timeoutMs": 30000
    }
  }
}
```

Verificare la connessione con `node bitcode.mjs mcp`, poi il catalogo con `/tools mcp`
in una sessione interattiva. Usare un server locale limitato alla cartella della
demo. `allowedTools` restringe i tool esposti. Le annotazioni read-only esterne
non sono considerate attendibili per default; abilitare `trustReadOnlyAnnotations`
solo dopo aver verificato il server. L'accesso OAuth interattivo non è implementato.

Verifica eseguita: `node --test --test-timeout=30000 tests/mcp.test.mjs`, **6/6 passati**.
Copre HTTP moderno e legacy, risorse/prompt, errori, timeout, nomi e cancellazione.
Non equivale a una registrazione end-to-end con un provider di produzione.

## Modelli: fonti e verifica runtime

| Modello richiesto | Identificazione | Uso previsto nella demo |
| --- | --- | --- |
| GPT-6 Astra | `openai/gpt-6-astra`, via Responses; ID confermato dalla documentazione OpenAI | MCP e skill locale |
| Claude Fable 5.1 | `anthropic/claude-fable-5-1`; ID confermato da Anthropic | Revisione, correzione e test |
| Qwen3.8-Flash-Next | Modello confermato da Qwen; endpoint e ID del deployment da risolvere | Fee e mempool in read-only |

Questa assegnazione è editoriale, non una classifica comparativa. La pubblicazione
di un modello non dimostra l'accesso dell'account né la compatibilità del deployment.
Qwen distingue i pesi Flash-Next dal servizio di produzione Qwen3.8-Flash: non
scambiare i due nomi e non inventare un ID OpenRouter/Ollama.

Prima delle riprese: verificare configurazioni e disponibilità senza esporre chiavi;
fare una richiesta breve e una chiamata reale a un tool per modello; controllare
streaming, risposta e policy. Usare limiti espliciti di passi/tool. Conservare le
configurazioni personali; isolare lo stato delle demo con `BITCODE_HOME` e `--cwd`.
Se manca accesso a un modello, proseguire con UI, fixture e montaggio preparatorio;
lasciare la sua registrazione in sospeso senza simulare un'esecuzione riuscita.

Fonti consultate il 10 settembre 2026:

- [OpenAI — GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)
- [Anthropic — Claude Fable, ID API 5.1](https://www.anthropic.com/claude/fable)
- [Qwen — Qwen3.8-Flash-Next](https://qwen.ai/blog?id=qwen3.8-flash-next)

## Sequenza di implementazione

### 1. Completare la review dell'HTML

- Verificare il diff rispetto al design system e ai cambiamenti dell'agente 0.2.
- Controllare leggibilità: correggere etichette e terminale troppo piccoli nella
  bozza; puntare a corpo 16 px e controlli 14 px senza ridurre il testo per farlo stare.
- Verificare contrasto di testo, focus, arancione e pill degli stati; preservare i
  colori del brand scegliendo sfondi e foreground leggibili.
- Provare menu mobile, ordine di focus, Escape, tab con frecce/Home/End, copy con
  successo ed errore, modalità senza JavaScript e preferenze di movimento.
- Allineare statistiche ai cataloghi effettivi della configurazione di default;
  distinguere strumenti disponibili da quelli che richiedono servizi o binari.
- Conservare lo stack statico. Nessuna migrazione di framework necessaria.

### 2. Preparare tre scenari riproducibili

| ID | Richiesta e sequenza reale | Prova di completamento |
| --- | --- | --- |
| `code-review` | In una piccola fixture pubblicabile con un bug intenzionale dichiarato: `/repo:review`, lettura del diff, correzione autorizzata e test | Test inizialmente fallito, patch effettiva, test finale superato |
| `bitcoin-fees` | `/btc:fees` con consultazione di `btc_fees` e `btc_mempool`; spiegazione dei dati registrati | Risposte reali, fonte e timestamp; nessuna transazione o previsione garantita |
| `mcp-skills` | Collegare un server MCP locale verificato che espone documentazione della fixture; caricare una skill locale di review e applicarla | Discovery, tool MCP chiamato, risultato e uso della skill visibili nel log |

La fixture MCP deve fare un'operazione utile su file reali della demo, con nome,
provenienza e permessi espliciti. Una risposta simulata del test non costituisce
la demo di un'integrazione. I test MCP esistenti restano verifiche di sviluppo.

### 3. Registrare le sessioni e conservarne la provenienza

- Acquisire stdout/stderr e tempi della sessione reale, con transcript e output
  dei tool. Usare una cattura terminale riproducibile o una registrazione video.
- Registrare versione bitcode, commit di base e stato/diff locale, data, comando,
  provider, modello richiesto/effettivo se comunicato, risultato ed exit status.
- Usare dati della fixture e dati pubblici; escludere segreti e configurazioni
  personali dalle riprese e dai file pubblicati.
- Montare solo materiale effettivamente registrato. Dichiarare tagli, accelerazioni
  e mascheramenti; preservare il significato e la sequenza dei risultati.
- Nessuna voce o musica necessaria: la demo deve essere comprensibile senza audio.
- Se una sessione non completa il compito, correggere la causa e ripetere la
  registrazione; conservare l'evidenza dei tentativi senza inventare l'esito.

### 4. Produrre web e Stories dalla stessa registrazione

| Output per scenario | Specifica di produzione scelta |
| --- | --- |
| Video web | MP4 H.264, 1920×1080, 16:9, 30 fps, `yuv420p`, faststart; circa 30–60 secondi |
| Video Stories | MP4 H.264, **1080×1920, 9:16**, 30 fps; montaggio dedicato di circa 15–30 secondi |
| Accessibilità web | Sottotitoli WebVTT, trascrizione testuale e poster |
| Accessibilità Stories | Sottotitoli impressi nel video, leggibili su smartphone |
| Provenienza | Manifest con durata effettiva, modello, registrazione sorgente e trasformazioni |

Le durate sono scelte editoriali, non limiti dichiarati di Instagram. Per il 9:16
ricomporre la scena con titolo breve, regione del terminale leggibile e risultato
finale. Non stirare il 16:9 né tagliare comandi o output importanti. Usare inizialmente
margini di progetto di circa 250 px in alto, 300 px in basso e 72 px ai lati,
da verificare nell'anteprima effettiva dell'app: non sono una garanzia ufficiale
di safe area. Se una scena è troppo densa, suddividerla in clip numerate.

Struttura prevista dei deliverable:

```text
assets/demos/
  code-review-16x9.mp4
  code-review-9x16.mp4
  code-review.en.vtt
  code-review-transcript.txt
  code-review-poster.webp
  bitcoin-fees-16x9.mp4
  bitcoin-fees-9x16.mp4
  bitcoin-fees.en.vtt
  bitcoin-fees-transcript.txt
  bitcoin-fees-poster.webp
  mcp-skills-16x9.mp4
  mcp-skills-9x16.mp4
  mcp-skills.en.vtt
  mcp-skills-transcript.txt
  mcp-skills-poster.webp
  manifest.json
```

Conservare catture integrali e materiale di lavoro in una directory non pubblica,
fuori dall'output statico. Inserire in `assets/demos` solo gli export verificati.
Pipeline implementata in `scripts/demos/`: `record.mjs`, `render.mjs` e
`publish.mjs`. Quest'ultimo aggiorna soltanto l'HTML locale. I file MP4, poster,
WebVTT, transcript e manifest sono presenti in `assets/demos`.

Originali archiviati fuori dal sito in
`~/.bitcode/demo-recordings/2026-09-10-index`, insieme al diff del runtime.
La ripresa MCP finale usa una nuova copia della fixture con il difetto iniziale:
la review individua il difetto senza modificarlo.

### 5. Integrare le demo in index.html

- Usare `<video controls playsinline preload="none" poster="…">` con `<track>` per
  i sottotitoli e fallback testuale; creare le sorgenti solo per asset esistenti.
- Mostrare durata letta dal manifest, modello effettivo, data e contesto della demo.
- Consentire download dei file 9:16; non richiedere connessione a Instagram.
- Preservare la preview illustrativa attuale fino alla disponibilità di una
  registrazione valida, mantenendo esplicita la sua natura illustrativa.
- Una sola riproduzione alla volta; nessuna ripartenza automatica al cambio scheda.
- Aggiungere stati di caricamento ed errore utili con link a file e trascrizione.
- Consolidare i testi: nessun dato “live” simulato, promessa di privacy assoluta,
  funzione non implementata o ragionamento interno presentato come log dei tool.

### 6. Verificare e consegnare

- Preview browser a 360, 390, 768, 1280 e 1440 px; zoom 200%, tastiera, reduced
  motion, JavaScript disabilitato. Nessuno scroll orizzontale o focus irraggiungibile.
- Provare tab/menu/copia, playback, pausa fra video, sottotitoli, fullscreen,
  download verticali e comportamento con errore di caricamento.
- Ispezionare primo frame, frame centrale e ultimo frame di tutti e sei i video.
- Verificare con ffprobe dimensioni, rapporto, codec, durata e decodifica integrale
  con FFmpeg. Controllare leggibilità del 9:16 a dimensione smartphone.
- Controllare che il caricamento iniziale non scarichi i tre video integrali,
  che i poster abbiano dimensioni riservate e che non ci siano URL mancanti.
- Verificare ogni affermazione contro codice/log e ogni registrazione contro il
  transcript. Eseguire i test pertinenti se cambiano runtime o integrazioni.
- Consegnare pagina, **3 MP4 web + 3 MP4 verticali**, poster, sottotitoli,
  trascrizioni e manifest. Pubblicazione su sito o Instagram fuori da questa fase.

## Checklist di completamento

- [x] Supporto MCP verificato nel codice e nei sei test pertinenti.
- [x] Identità visiva e otto decisioni consolidate.
- [x] Formato 9:16 incluso per ciascuna demo.
- [x] Fonti ufficiali dei modelli individuate; ID OpenAI/Anthropic confermati.
- [x] Sintassi dello script inline corrente verificata con Node.
- [ ] Configurare accesso e registrare versioni con GPT-6 Astra, Claude Fable 5.1 e Qwen3.8-Flash-Next; credenziali/deployment attualmente assenti.
- [x] Tool calling reale verificato con il tag disponibile `ollama/qwen3.8:27b`.
- [x] Review visiva e funzionale della pagina completata.
- [x] Tre sessioni reali registrate e verificate.
- [x] Sei video esportati e controllati.
- [x] Media, sottotitoli, trascrizioni e download integrati nella pagina.
- [x] Verifiche finali desktop/mobile superate.

## Risultati di verifica

- Catalogo dell'agente: 62 tool, inclusa delegazione; catalogo CLI: 61; comandi: 45.
- Demo codice: errore riprodotto, `edit_file` eseguito, 2 test finali superati.
- Demo Bitcoin: `btc_fees` e `btc_mempool` hanno letto dati mainnet reali.
- Demo MCP: server stdio con file reale, chiamata al tool e caricamento della skill
  eseguiti dal modello; il test automatico del client resta separato dalla demo.
- Sei MP4 H.264, `yuv420p`, 30 fps: dimensioni corrette e decodifica integrale riuscita.
  Verificati primo frame, frame centrale e ultimo frame di ogni export.
- Durate web / verticale: codice 42 / 28 s; Bitcoin 24 / 16 s; MCP 36 / 24 s.
- Browser Chromium: 360, 390, 768, 1280, 1440 px senza overflow orizzontale;
  testo al 200%, reduced motion e navigazione senza JavaScript verificati.
- Menu/Escape/focus, copia riuscita/negata, riproduzione reale, pausa degli altri
  player, tracce sottotitoli e download verticali verificati.
- Zero richieste MP4 al caricamento iniziale. Errore HTTP 404 di un video gestito
  con messaggio e accesso a transcript/download. Target degli anchor interni validi.
- `npm run lint`: 70 file validi. Test MCP: 6/6 superati.
- Nessun test end-to-end eseguito nell'app Instagram: gli MP4 verticali sono stati
  controllati localmente e sono pronti per il caricamento manuale.
