---
description: CoinJoin via temporary wallet (Fase 1 — risk disclosure, temp wallet, deposit, contract; JoinMarket rounds land in Fase 2)
argument-hint: "<destination-address> <amount-btc>"
---
Details: $ARGUMENTS (destination address — a virgin address the user holds the keys for — and amount in BTC). Follow this flow exactly, in order. Do not skip or reorder steps, and do not proceed past a gate without the user's explicit input.

0. RISK DISCLOSURE — print this verbatim before anything else:

   ⚠️ RISCHIO CUSTODIA TEMPORANEA
   Per automatizzare il CoinJoin, bitcode genera un wallet temporaneo e ne
   custodisce il seed per la durata dell'operazione. Durante questa finestra,
   bitcode ha il controllo dei fondi. Dopo l'invio dei fondi puliti
   all'indirizzo fornito, wallet e seed vengono DISTRUTTI definitivamente.
   bitcode non è un wallet di custodia: non farci affidamento per conservare
   fondi. Se non accetti questo rischio, annulla l'operazione.

   Ask the user to type exactly "I ACCEPT" to proceed. If they decline or type anything else, stop — no tools are called, no funds move.

1. On "I ACCEPT", call cj_risk_consent with accepted_text, amount_sats (BTC arg × 1e8), and to_address (the destination). This logs consent to ~/.bitcode/cj-consent.log.

2. Verify prerequisites: amount must be ≥ 0.01 BTC (cj_wallet_create enforces this — if it errors, report why and stop). Note: JoinMarket integration (actual CoinJoin rounds) is not implemented yet in this build — say so plainly once, don't hide it.

3. Call cj_wallet_create with amount_sats. Show the user the deposit address it returns and tell them to send exactly that amount there.

4. Call cj_wallet_status to check for the deposit. If balance is still 0, tell the user to send the funds and re-run cj_wallet_status (either by asking them to say "check" or by re-invoking this command) — do not loop or poll indefinitely in one turn.

5. Once funds are confirmed, show a contract summary before doing anything else: amount received, current fee rates (via btc_fees), and the destination address. Since JoinMarket rounds aren't wired up yet, tell the user directly: CoinJoin execution isn't available yet (Fase 2) — offer to either leave the funds parked in the temp wallet for later, or call cj_wallet_drain now to sweep everything straight to their destination address (skipping the mix, but not losing custody of funds). Wait for their explicit choice — do not call cj_wallet_drain without it.

6. If they choose to drain: call cj_wallet_drain with broadcast=true only after they confirm the amount/fee shown. Then call cj_wallet_destroy to tear down the temp wallet, and confirm to the user that bitcode no longer holds their funds.

Never call cj_wallet_drain or cj_wallet_destroy without an explicit go-ahead in the current conversation. Never fabricate a "CoinJoin completed" result — that flow doesn't exist yet.
