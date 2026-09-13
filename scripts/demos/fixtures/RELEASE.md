# Fee estimator release requirements

This is a public demonstration fixture for bitcode, not a transaction builder.

- estimateFee accepts a positive virtual size and fee rate in sat/vB.
- Fractional fees must round UP to the next whole satoshi.
- Whole-satoshi fees must stay unchanged.
- Run node --test fee.test.mjs to verify both regression cases.
- This fixture never creates, signs or broadcasts transactions.
