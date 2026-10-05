# Ollama: risposta interrotta con `length`

`finish_reason: length` segnala che la generazione non è terminata normalmente.
Può essere raggiunto un limite di output o di contesto; il solo evento non
permette di distinguere le due cause.

Bitcode conserva ora il testo parziale nella sessione, marca il turno come
incompleto e scarta tutte le chiamate a tool di quel turno, anche se il loro
JSON sembra completo. Non ripete automaticamente la richiesta. In modalità
`--json` lo stato è `incomplete` e il codice di uscita è 2.

Il budget di output e il controllo del ragionamento sono configurabili anche
per i provider Chat Completions. Esempi, da eseguire dentro la CLI Bitcode:

```text
/config set providers.ollama.maxOutputTokens 4096
/config set providers.ollama.reasoningEffort none
```

Riavviare Bitcode per ricaricare il provider. `none` è opzionale e disattiva
il ragionamento solo sui modelli che lo supportano; non è impostato
automaticamente. Un budget di output maggiore **non aumenta il contesto**.

Controllare il contesto effettivamente caricato con `ollama ps` nel terminale.
Per ampliarlo, Ollama documenta un modello derivato tramite Modelfile:

```text
FROM gemma4:26b
PARAMETER num_ctx 16384
```

Salvare questo testo in `Modelfile.bitcode`, quindi, nel terminale:

```bash
ollama create gemma4-bitcode:26b -f Modelfile.bitcode
bitcode -m ollama/gemma4-bitcode:26b
```

Un contesto più grande può richiedere più RAM/VRAM e rallentare l'inferenza.
Questa modifica non viene applicata da Bitcode senza una scelta dell'utente.
Alternative: `/compact`, `/reset`, richieste più brevi e selezione di un Sat
con meno tool. Non basta il contesto massimo teorico dichiarato dal modello:
conta il valore caricato da Ollama.

Per analisi blockchain usare `/profile bitcoin` e verificare la rete attiva.
Il tool `btc_address` rifiuta indirizzi invalidi o incompatibili prima della
richiesta di rete. Non vengono inventate attribuzioni, classificazioni ufficiali
o risultati investigativi in sostituzione di dati verificati.

Riferimento: https://docs.ollama.com/api/openai-compatibility
