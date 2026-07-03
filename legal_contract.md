# Contratto di Utilizzo — CoinJoin via bitcode
## Escussione di Responsabilità e Accettazione dei Rischi

> **Versione:** 1.0  
> **Oggetto:** Comando `/btc:coinjoin` — Integrazione JoinMarket  
> **Parti:** L'utente del software bitcode ("l'Utente") e il software stesso, distribuito dal fondatore di bitcode/opencode ("il Fondatore")

---

## Preambolo

bitcode è un software open-source che fornisce strumenti a riga di comando per
interagire con la rete Bitcoin. Il comando `/btc:coinjoin` integra JoinMarket,
un software di terze parti, per eseguire transazioni CoinJoin.

**Il Fondatore e i contributori di bitcode NON sono:**
- Consulenti finanziari, legali o fiscali
- Custodi di fondi
- Coordinatori di CoinJoin
- Controparti in alcuna transazione

L'Utente opera in completa autonomia e sotto la propria esclusiva responsabilità.

---

## Sezione 1 — Dichiarazione di Comprensione

L'Utente dichiara di aver compreso e accettato quanto segue:

### 1.1 Natura del Wallet Temporaneo

Il comando `/btc:coinjoin` genera un wallet Bitcoin temporaneo per automatizzare
il processo di CoinJoin. bitcode custodisce il seed di questo wallet in memoria
per la durata dell'operazione.

```
☐ [ ] Ho letto e compreso che bitcode genera un wallet temporaneo
      e ne custodisce il seed per la durata dell'operazione.
```

### 1.2 Distruzione del Wallet

Al termine dell'operazione, il wallet temporaneo e il suo seed vengono distrutti.
Eventuali fondi residui non inviati all'indirizzo di destinazione prima della
distruzione potrebbero essere persi irreversibilmente.

```
☐ [ ] Comprendo che dopo il completamento dell'operazione il wallet
      temporaneo viene distrutto e non posso recuperare fondi residui.
```

### 1.3 Controllo dei Fondi

Durante l'operazione, bitcode ha il controllo temporaneo dei fondi depositati
sul wallet temporaneo. L'Utente accetta questo rischio per la durata del
CoinJoin.

```
☐ [ ] Accetto che bitcode abbia il controllo temporaneo dei miei fondi
      per la durata dell'operazione di CoinJoin.
```

### 1.4 Indirizzo di Destinazione

L'Utente è l'unico responsabile di fornire un indirizzo di destinazione valido
di cui possiede le chiavi private. bitcode non verifica la proprietà
dell'indirizzo.

```
☐ [ ] Confermo che l'indirizzo di destinazione è sotto il mio
      controllo esclusivo e che ne possiedo le chiavi private.
```

### 1.5 Assenza di Garanzie

bitcode è fornito "così com'è", senza garanzie di alcun tipo, esplicite o
implicite.

```
☐ [ ] Accetto che bitcode non fornisce alcuna garanzia sul corretto
      funzionamento del CoinJoin o sulla tempestività delle transazioni.
```

---

## Sezione 2 — Rischi Specifici del CoinJoin

L'Utente dichiara di essere consapevole dei seguenti rischi:

### 2.1 Rischi di Rete

- **Fee di rete volatili:** Le commissioni di transazione Bitcoin possono
  variare significativamente durante l'operazione.
- **Conferme ritardate:** Le transazioni possono rimanere non confermate per
  periodi prolungati in caso di congestione della rete.
- **Reorg:** Riorganizzazioni della blockchain possono influenzare lo stato
  delle transazioni.

### 2.2 Rischi di JoinMarket

- **Makers inaffidabili:** I partecipanti al CoinJoin (makers) potrebbero non
  completare il round, causando ritardi o fallimenti.
- **Pool di anonimato limitato:** La qualità dell'anonimato dipende dal numero
  e dalla qualità dei makers disponibili al momento del round.
- **Coordinator JoinMarket:** Il software si affida a coordinatori JoinMarket
  di terze parti per organizzare i round.

### 2.3 Rischi Tecnici

- **Interruzione di connessione:** Una disconnessione durante il round può
  richiedere il riavvio dell'operazione.
- **Crash del sistema:** In caso di crash di bitcode durante l'operazione,
  il seed in memoria viene perso e il wallet temporaneo non è più recuperabile.
  JoinMarket è fail-safe (se non firmi, i fondi non si muovono), ma il recovery
  richiede competenze tecniche avanzate.
- **Bug software:** Nonostante i test, bug imprevisti possono causare perdite.

### 2.4 Privacy e Chain Analysis

Il CoinJoin riduce ma non elimina la tracciabilità delle transazioni. Tecniche
avanzate di chain analysis potrebbero comunque stabilire collegamenti
probabilistici tra input e output.

```
☐ [ ] Comprendo e accetto tutti i rischi sopra elencati.
```

---

## Sezione 3 — Escussione di Responsabilità

### 3.1 Esclusione di Responsabilità del Fondatore

Il Fondatore e i contributori di bitcode NON sono responsabili per:

(a) Perdita di fondi dovuta a errori dell'Utente (indirizzo errato, importo
    errato, perdita delle chiavi private dell'indirizzo di destinazione);

(b) Perdita di fondi dovuta a malfunzionamenti del software, bug, o crash;

(c) Perdita di fondi dovuta a problemi della rete Bitcoin (reorg, fee spike,
    congestione);

(d) Perdita di fondi dovuta a malfunzionamenti di JoinMarket o di coordinatori
    di terze parti;

(e) Danni consequenziali, diretti o indiretti, derivanti dall'uso del comando
    `/btc:coinjoin`;

(f) Azioni legali, investigative o regolatorie da parte di autorità
    governative verso l'Utente o controparti delle transazioni.

### 3.2 Dichiarazione di Non-Custodia

bitcode non è un servizio di custodia. Il wallet temporaneo è un veicolo
tecnico, non un conto di deposito. Nessun rapporto fiduciario viene creato
tra l'Utente e il Fondatore.

### 3.3 Legge Applicabile

Il presente contratto è regolato dalla legge italiana. Foro competente
esclusivo: Milano.

---

## Sezione 4 — Procedura di Accettazione

L'Utente accetta il presente contratto tramite la seguente procedura,
che costituisce FIRMA ELETTRONICA EQUIVALENTE A FIRMA AUTOGRAFA ai sensi
dell'art. 1847 del Codice Civile e del Regolamento eIDAS (UE) n. 910/2014.

### 4.1 Step di Accettazione

A ogni esecuzione del comando `/btc:coinjoin`, bitcode:

**Passo 1** — Mostra l'avviso di sicurezza (estratto della Sezione 1)  
**Passo 2** — Mostra il riepilogo dell'operazione (importo, fee, destinazione)  
**Passo 3** — Richiede la digitazione di `I ACCEPT`  
**Passo 4** — Alla ricezione, registra il consenso in `~/.bitcode/cj-consent.log`  
**Passo 5** — Procede con l'operazione

### 4.2 Registro dei Consensi

Ogni accettazione viene registrata in `~/.bitcode/cj-consent.log` con il
seguente formato:

```
TIMESTAMP_ISO | HASH_ACCETTAZIONE | AMOUNT_BTC | ADDRESS_DEST | SEED_HASH | ESITO
```

Il log è un file di solo-append, non modificabile retroattivamente.
L'Utente può consultarlo in qualsiasi momento.

### 4.3 Mancata Accettazione

Se l'Utente non digita `I ACCEPT` entro 5 minuti, l'operazione viene
annullata automaticamente. Nessun fondo viene movimentato.

---

## Sezione 5 — Dichiarazione Finale

L'Utente riconosce che:

> **"Il Bitcoin è un sistema finanziario decentralizzato. L'Utente è il
>  custode delle proprie chiavi private e l'unico responsabile delle
>  proprie transazioni. bitcode è solo uno strumento. Il Fondatore ha
>  scritto codice, non ha venduto servizi finanziari."**

```
☐ [ ] HO LETTO, COMPRESO E ACCETTATO TUTTI I TERMINI DEL PRESENTE
      CONTRATTO. ACCETTO DI ASSUMERMI OGNI RISCHIO DERIVANTE DALL'USO
      DEL COMANDO /btc:coinjoin DI BITCODE.

      Data: ___________    Firma (I ACCEPT): _______________
```

---

## Appendice A — Storico Versioni

| Versione | Data | Modifiche |
|---|---|---|
| 1.0 | 2026-07-03 | Prima stesura |

---

*Questo documento è distribuito insieme al software bitcode. L'ultima versione
è sempre disponibile su https://github.com/crocs-muni/coinjoin-analysis (ref.
integrazione bitcode).*
