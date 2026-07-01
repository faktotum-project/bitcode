---
description: Guided send — checks fees and confirms before broadcasting
argument-hint: "<address> <amount-sats>"
---
I want to send bitcoin. Details: $ARGUMENTS (destination address and amount — figure out which is which). Before calling wallet_send: check current fee rates with btc_fees, then clearly state the network, destination, amount, and estimated fee, and wait for my explicit go-ahead. Only pass broadcast=true after I confirm.
