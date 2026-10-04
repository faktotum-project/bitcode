# Sat Runtime

I Sats sono un livello del motore Bitcode esistente, non un framework separato.
CLI e desktop usano gli stessi quattro `sats/<id>/SAT.md`, la stessa selezione
dei tool e lo stesso `runAgent`. Non sono richiesti servizi o dipendenze nuovi.

## Uso

Avviare la CLI con `node bitcode.mjs`, oppure il desktop con `npm run desktop`.

```text
/sats
/sat node
/sat script
/sat hash
/sat merkle
/sat info merkle
/sat workspace merkle
```

La selezione si applica ai messaggi successivi e viene conservata nella sessione.
Nella CLI `/reset` torna a Bitcode e azzera la conversazione. Nel desktop è
disponibile anche il selettore Bitcode/Sat; i quattro pulsanti nella barra
superiore aprono manifest, identità, permessi e cronologia del progetto.
I comandi preesistenti per le personas rimangono compatibili, ma non sono il
nuovo Sat Runtime: utilizzare `/sat` per identità persistente e orchestrazione.

| Sat | Compito | Limite applicativo |
| --- | --- | --- |
| Node | Infrastruttura Bitcoin, Lightning, Liquid, Taproot Assets | Tool di lettura disponibili nel processo ospite |
| Script | Codice e implementazione | Scritture e shell soggette alla policy di approvazione |
| Hash | Verifica e sicurezza | Ispezione, senza shell o scritture |
| Merkle | Pianificazione, delegazione, sintesi | Lettura e `sat_delegate`, senza shell o scritture dirette |

Merkle delega sequenzialmente a Node, Script e Hash. Profondità massima: un
livello. I figli hanno conversazioni separate; il genitore riceve la risposta
finale. Budget dei tool, annullamento, registrazione delle modifiche e policy
di approvazione sono condivisi. I permessi invece sono calcolati per ciascun Sat.
Nel desktop restano applicabili scelta del modello per Sat, modalità solo locale
e approvazione del passaggio da un modello locale a un provider cloud.

## Sat Manifest e sicurezza

Il parser supporta deliberatamente un sottoinsieme YAML: scalari, liste di
stringhe e mappe a un livello. Rifiuta duplicati, sintassi avanzata, campi e
permessi sconosciuti. I manifest distribuiti con il programma sono la fonte
delle istruzioni; non si caricano manifest dal progetto non fidato.

I tool effettivi sono l'intersezione fra manifest, limiti nel codice e tool
disponibili nell'host. Aggiungere `bitcoin_rpc`, un tool wallet o `bash` al
manifest di Hash non li abilita. Il runtime elimina le mutazioni se non esiste
un controllo di approvazione; il worker desktop dichiara i tool già protetti
dal controller. Non vengono concessi nuovi privilegi finanziari o mainnet.

Questi sono **permessi applicativi, non una nuova sandbox CLI**. Nella CLI
una shell approvata mantiene i diritti del processo dell'utente, inclusa la
potenziale capacità di rete: `network: deny` filtra i tool di rete, non isola
il sistema operativo. Non approvare shell non fidate. Nel desktop il worker
resta isolato con bubblewrap, senza home dell'utente né rete diretta.

Il desktop espone oggi tool di progetto, non gli adattatori finanziari della
CLI. Il manifest di Node non rende automaticamente operativi Bitcoin, Cashu,
Liquid o Taproot Assets nel desktop: il Sat deve dichiarare le capacità mancanti.

## Sat Workspace, Sat Identity e Sat Memory

```text
~/.bitcode/sats/<id>/workspace/
~/.bitcode/sats/<id>/state/identity.json
~/.bitcode/sats/<id>/state/<hash-progetto>/<esecuzione>.json
```

`BITCODE_HOME` può cambiare la directory base. L'identità UUID viene pubblicata
atomicamente e resta stabile fra processi CLI e desktop. Nuove directory e file
usano rispettivamente permessi 0700 e 0600; link simbolici nei percorsi dei Sats
sono rifiutati. Il Sat Workspace è uno spazio riservato persistente, distinto dal
progetto: non viene montato né esposto automaticamente ai tool del modello.

La memoria essenziale conserva al massimo 50 esiti con data per Sat/progetto,
senza prompt, risposte, argomenti dei tool o credenziali. File distinti evitano
aggiornamenti persi tra esecuzioni simultanee. Non è una memoria semantica e non
viene inviata ai provider. Le normali conversazioni continuano a usare la
persistenza delle sessioni già esistente. `--no-session` disabilita anche la
scrittura automatica della memoria Sat; richieste esplicite `info` e `workspace`
possono inizializzare le directory. `success` indica conclusione del ciclo del
modello, non certificazione del risultato. Budget esauriti sono errori.

Nel desktop solo il controller scrive questa memoria. Un arresto forzato prima
dell'evento finale può lasciare l'esecuzione senza voce nella cronologia Sat;
non sono implementati ripristino del processo o prosecuzione dopo un crash.

## Sat Events

`sat-events.mjs` proietta gli eventi del motore in eventi indipendenti dalla UI:
`sat:start`, `sat:state`, `tool:start`, `tool:end`, `delegation:start`,
`delegation:end`, `approval:required`, `approval:resolved`, `sat:end`, `sat:error`.
Il desktop converte questi stati nelle animazioni vettoriali esistenti.
`planning` è riservato: non viene dedotto dal testo privato del modello.
Gli eventi non contengono prompt, risultati o argomenti dei tool.

## Verifica riproducibile

```bash
npm run check
npm run build:desktop
npm run test:desktop
BITCODE_PLAYWRIGHT_MODULE=/percorso/playwright/index.mjs node desktop/tests/sat-ui-smoke.mjs
```

I test usano provider deterministici locali: nessuna chiamata pagata, invio di
fondi o promessa di validazione live di un nodo. Il test desktop end-to-end
esegue davvero il worker in bubblewrap, controlla l'approvazione di una scrittura
delegata e la persistenza lato host. Il test UI richiede Electron e un display.
