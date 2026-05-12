# OMS SDK

A TypeScript SDK for the OMS (Open Money Stack) platform. Provides email and OIDC redirect wallet authentication, on-chain transaction submission, message signing, and token balance queries — with automatic session persistence.

## Usage

This SDK is not published as an npm package yet. In this repository it is consumed as the local pnpm workspace package `typescript-sdk`.

From the repository root:

```bash
pnpm install
pnpm build
```

## React Example

A deployed React example is available at [https://0xsequence.github.io/typescript-sdk/react-example/](https://0xsequence.github.io/typescript-sdk/react-example/).

To run it locally from the repository root:

```bash
pnpm dev:example
```

## Quick Start

```typescript
import { OMSClient } from 'typescript-sdk'

const oms = new OMSClient({ projectAccessKey: 'your-project-access-key' })

// 1. Send a one-time code to the user's email
await oms.wallet.startEmailAuth({ email: 'user@example.com' })

// 2. User enters the code — verifies it and sets up the wallet automatically
const { walletAddress, credential } = await oms.wallet.completeEmailAuth({ code: '123456' })

// 3. The wallet is ready
console.log('Wallet address:', walletAddress)
console.log('Credential:', credential.credentialId)

// 4. Send a transaction
const tx = await oms.wallet.sendTransaction({
  network: 'polygon',
  to: '0xRecipient',
  value: 1_000_000_000_000_000_000n, // 1 MATIC
})
console.log(tx.txHash ?? tx.txnId)
```

## Overview

`OMSClient` exposes two sub-clients:

| Property | Type | Description |
|---|---|---|
| `oms.wallet` | `WalletClient` | Authentication, signing, and transaction submission. |
| `oms.indexer` | `IndexerClient` | Read token balances and on-chain state. |

## Authentication Flow

OMS supports email-based OTP and OIDC authorization-code PKCE redirect auth.

Email OTP is a two-step flow:

1. **`startEmailAuth({ email })`** — sends a one-time code to the user's inbox.
2. **`completeEmailAuth({ code })`** — verifies the code, then automatically loads an existing wallet or creates a new one if none exists. Returns `{ walletAddress, credential }`.

The session stores wallet metadata in the configured storage, including the wallet address, credential expiry, login type, and email returned by the wallet API. Browser storage defaults to `localStorage` when available; non-browser runtimes fall back to in-memory storage unless you provide a custom `StorageManager`. Browser signing defaults to a non-extractable WebCrypto P-256 credential (`webcrypto-secp256r1`), so the private session key is not written to `localStorage`. Completed auth requests ask WaaS for a one-week session lifetime.

To end the session, call `await oms.wallet.signOut()`.

```typescript
const { walletAddress, expiresAt, loginType, sessionEmail } = oms.wallet.session
```

### OIDC Redirect Auth

Google redirect auth is configured on the default environment. The redirect auth APIs are provider-neutral, so custom environments can add or replace providers.

```typescript
const oms = new OMSClient({ projectAccessKey: 'your-key' })
```

For routers such as React Router or Next.js, use the explicit start/complete methods:

```typescript
const { url } = await oms.wallet.startOidcRedirectAuth({
  provider: 'google',
  redirectUri: `${window.location.origin}/auth/callback`,
})

window.location.assign(url)

// On the callback route:
const { walletAddress, credential } = await oms.wallet.completeOidcRedirectAuth({
  callbackUrl: window.location.href,
  cleanUrl: true,
})
```

For simple browser apps, use the one-call convenience method from a sign-in action and from the callback page:

```typescript
void oms.wallet.signInWithOidcRedirect({ provider: 'google' })
```

Pending redirect state is stored in `sessionStorage` by default. Final wallet session metadata continues to use the configured SDK storage.

## Networks

The `network` parameter on all transaction and signing methods accepts any of three forms:

```typescript
// Chain name string
await oms.wallet.signMessage({ network: 'polygon', message: '0xdeadbeef' })

// Chain ID as bigint
await oms.wallet.signMessage({ network: 137n, message: '0xdeadbeef' })

// viem Chain object
import { polygon } from 'viem/chains'
await oms.wallet.signMessage({ network: polygon, message: '0xdeadbeef' })
```

## Sending Transactions

`sendTransaction` has three overloaded signatures to cover the most common patterns.

### Native Token Transfer

```typescript
const tx = await oms.wallet.sendTransaction({
  network: 'polygon',
  to: '0xRecipient',
  value: 1_000_000_000_000_000_000n, // 1 MATIC in wei
})
```

### Raw Data Transaction

```typescript
const tx = await oms.wallet.sendTransaction({
  network: 'polygon',
  to: '0xContract',
  data: '0xa9059cbb000000000000000000000000...',
})
```

### ABI-Encoded Contract Call (via viem)

Pass an ABI and function name — the SDK encodes the calldata automatically using viem.

```typescript
const erc20Abi = [
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
  },
] as const

const tx = await oms.wallet.sendTransaction({
  network: 'polygon',
  to: '0xTokenContract',
  abi: erc20Abi,
  functionName: 'transfer',
  args: ['0xRecipient', 1_000_000_000_000_000_000n],
})
```

`sendTransaction` prepares and executes the transaction, then polls WaaS for
the latest transaction status. The response includes `txnId`, `status`, and `txHash`
when the transaction has been published.

To return immediately after execute without status polling, pass
`waitForStatus: false`. You can then call `getTransactionStatus` with the
returned `txnId`.

```typescript
const tx = await oms.wallet.sendTransaction({
  network: 'polygon',
  to: '0xRecipient',
  value: 1n,
  waitForStatus: false,
})

const status = await oms.wallet.getTransactionStatus({ txnId: tx.txnId })
```

To tune polling, pass `statusPolling`:

```typescript
await oms.wallet.sendTransaction({
  network: 'polygon',
  to: '0xRecipient',
  value: 1n,
  statusPolling: {
    timeoutMs: 30_000,
    intervalMs: 1_000,
  },
})
```

If WaaS returns fee options, pass a selector to choose one. The selector receives
fee options enriched with the current wallet balance for each token when
available.

```typescript
const tx = await oms.wallet.sendTransaction({
  network: 'polygon',
  to: '0xTokenContract',
  data: '0xa9059cbb000000000000000000000000...',
  selectFeeOption: async (feeOptions) => {
    const selected = feeOptions.find(option => option.feeOption.token.symbol === 'USDC')
    return selected ? { token: selected.feeOption.token.symbol } : undefined
  },
})
```

## Configuration

### Custom Environment

```typescript
const oms = new OMSClient({
  projectAccessKey: 'your-key',
  environment: {
    walletApiUrl: 'https://staging-wallet.example.com',
    indexerUrlTemplate: 'https://staging-indexer.example.com/{value}',
    auth: {
      waasAuthScope: 'proj_1',
    },
  },
})
```

### Custom Storage and Signing

The default storage backend is browser `localStorage` when available, otherwise in-memory storage for wallet metadata only. The default browser signer stores its non-extractable key reference separately through WebCrypto-compatible browser storage. Provide a custom `StorageManager` for persistent Node.js, React Native, or testing sessions:

```typescript
import { MemoryStorageManager, OMSClient } from 'typescript-sdk'

const oms = new OMSClient({
  projectAccessKey: 'your-key',
  storage: new MemoryStorageManager(),
})
```

OIDC redirect auth uses separate transient storage for verifier/state data. In browsers it defaults to `sessionStorage`; pass `redirectAuthStorage` to override it. Final wallet session metadata continues to use the configured `storage`.

## More Examples

### Sign a Message

```typescript
const signature = await oms.wallet.signMessage({
  network: 'polygon',
  message: '0xdeadbeef',
})
```

### Sign and Validate Typed Data

```typescript
const signature = await oms.wallet.signTypedData({
  network: 'polygon',
  typedData,
})

const isValid = await oms.wallet.isValidTypedDataSignature({
  network: 'polygon',
  walletAddress: oms.wallet.walletAddress,
  typedData,
  signature,
})
```

### Call a Contract (method string + args)

```typescript
const tx = await oms.wallet.callContract({
  network: 'polygon',
  contractAddress: '0xTokenContract',
  method: 'transfer(address,uint256)',
  args: [
    { type: 'address', value: '0xRecipient' },
    { type: 'uint256', value: '1000000000000000000' },
  ],
})
```

### Query Token Balances

```typescript
const { walletAddress } = oms.wallet
if (!walletAddress) throw new Error('No active wallet session')

const result = await oms.indexer.getTokenBalances({
  chainId: '137',
  contractAddress: '0xTokenContract',
  walletAddress,
  includeMetadata: true,
})

for (const b of result.balances) {
  console.log(b.contractAddress, b.balance)
}
```

### Manage Access

```typescript
const grants = await oms.wallet.listAccess()

for (const grant of grants) {
  console.log(grant.credentialId, grant.expiresAt, grant.isCaller)
}

for await (const page of oms.wallet.listAccessPages({ pageSize: 25 })) {
  console.log('Page:', page.grants)
}

await oms.wallet.revokeAccess({ targetCredentialId: grants[0].credentialId })
```

### Sign Out

```typescript
await oms.wallet.signOut()
// Redirect to sign-in screen
```

### Handle SDK Errors

```typescript
import { OmsSdkError } from 'typescript-sdk'

try {
  await oms.wallet.signMessage({ network: 'polygon', message: '0xdeadbeef' })
} catch (err) {
  if (err instanceof OmsSdkError) {
    if (err.code === 'OMS_AUTH_COMMITMENT_CONSUMED') {
      // Restart the auth flow; this OTP/OIDC commitment has already been used.
    }
    console.error(err.code, err.operation, err.status, err.txnId, err.retryable)
  }
}
```

## API Reference

See [API.md](./API.md) for the full method and type reference.
