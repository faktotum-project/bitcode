# Aggiornamenti Bitcoin per AI Agent (2026)

## Stack consigliato

-   Bitcoin Core
-   Bitcoin Dev Kit (BDK)
-   rust-bitcoin
-   rust-miniscript
-   Descriptor Wallet
-   PSBT
-   Model Context Protocol (MCP)

## Novità principali

### Bitcoin Dev Kit (BDK)

BDK è lo standard moderno per costruire wallet Bitcoin descriptor-based.
Consente sincronizzazione, gestione UTXO, creazione di PSBT, coin
selection e integrazione con Bitcoin Core.

### rust-bitcoin

Libreria di riferimento per implementare il protocollo Bitcoin in Rust.
Costituisce la base di gran parte dell'ecosistema moderno.

### rust-miniscript

Permette di definire e verificare policy di spesa in modo sicuro,
semplificando multisig e script complessi.

### Descriptor Wallet

Bitcoin Core evolve verso wallet basati su descriptor. I nuovi progetti
dovrebbero adottarli invece dei wallet legacy.

### PSBT

Le Partially Signed Bitcoin Transactions sono il formato raccomandato
per separare la costruzione della transazione dalla firma.

### MCP

Gli AI agent possono esporre strumenti Bitcoin tramite Model Context
Protocol, ad esempio:

-   get_balance()
-   list_utxos()
-   generate_address()
-   create_psbt()
-   estimate_fee()
-   broadcast_transaction()

## Architettura consigliata

``` text
AI Agent
    │
    ▼
MCP Server
    │
    ▼
Bitcoin Dev Kit
    │
    ▼
Bitcoin Core RPC
    │
    ▼
Nodo Bitcoin
```

## Repository ufficiali

-   https://github.com/bitcoin/bitcoin
-   https://github.com/bitcoindevkit
-   https://github.com/rust-bitcoin/rust-bitcoin
-   https://github.com/rust-bitcoin/rust-miniscript
-   https://github.com/lightningdevkit/ldk
-   https://github.com/ElementsProject/lightning
-   https://github.com/btcpayserver/btcpayserver

## Best practice

-   Non esporre mai la seed all'AI.
-   Usare descriptor wallet.
-   Generare PSBT e firmare separatamente.
-   Preferire SDK ufficiali e ampiamente adottati.
