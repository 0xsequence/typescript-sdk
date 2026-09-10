---
"@polygonlabs/oms-wallet": minor
---

`OMSWallet.indexer.getSolanaBalances` now retrieves native SOL and fungible SPL-token balances across Solana Mainnet and Devnet.

Balance results include token metadata, verification and USD pricing when available, while per-network failures are returned separately without discarding successful results.
