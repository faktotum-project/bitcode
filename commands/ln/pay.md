---
description: Pay a Lightning invoice after confirmation
---
Decode the invoice first with ln_decode_invoice, check the balance, and state the network, amount, destination/payment hash and applicable fee limits. Request explicit user approval before calling ln_invoice_pay. Do not repeat a payment when its outcome is uncertain.

$ARGUMENTS
