---
'@polygonlabs/oms-wallet': major
---

Add public smart-session credential inspection, owner-side session management, a signed remote
application client for backend session transactions, and Solana wallet creation, off-chain message
signing and verification, and native SOL and SPL-token transfers. Solana transfers now default to
relayer mode: network fees are sponsored, while fee options are returned for rent when a recipient
token account must be created.

`walletAddress` and `WalletAccount` now represent both Ethereum and Solana addresses. Use the wallet
type discriminator before applying Ethereum-specific address handling.

Ethereum-specific signing, transactions, smart-session authorization, and the wagmi connector now
reject an active Solana wallet explicitly.

Sponsored transactions now invoke an optional fee selector with an empty list before execution, so
applications can acknowledge the free fee or stop the transaction. `FeeOptionSelector.firstAvailable`
continues sponsored execution without sending a fee option and uses Solana indexer balances to pick
an affordable option for non-sponsored Solana transfers.
