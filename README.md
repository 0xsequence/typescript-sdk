# OMS SDK

A TypeScript SDK for the OMS (Open Mobile Stack) platform. Provides email-based wallet authentication, on-chain transaction submission, message signing, and token balance queries — with automatic session persistence.

## Installation

```bash
npm install ethers
```

Copy the SDK source files into your project alongside the generated `waas.gen.ts` client.

## Quick Start

```typescript
import { OMSClient } from './OMSClient'

const oms = new OMSClient({ projectAccessKey: 'your-project-access-key' })

// 1. Send a one-time code to the user's email
await oms.wallet.startEmailAuth({ email: 'user@example.com' })

// 2. User enters the code — this verifies it and sets up the wallet automatically
await oms.wallet.completeEmailAuth({ code: '123456' })

// 3. The wallet is ready — walletAddress is now populated
console.log('Wallet address:', oms.wallet.walletAddress)

// 4. Send a transaction
const txHash = await oms.wallet.sendTransaction({
  network: 'polygon',
  to: '0xRecipient...',
  value: '1000000000000000000', // 1 MATIC in wei
})
```

## Overview

`OMSClient` exposes two sub-clients:

| Property | Type | Description |
|---|---|---|
| `oms.wallet` | `WalletClient` | Authentication, signing, and transaction submission. |
| `oms.indexer` | `IndexerClient` | Read token balances and on-chain state. |

## Authentication Flow

OMS uses email-based OTP. The two-step flow is:

1. **`startEmailAuth({ email })`** — sends a one-time code to the user's inbox.
2. **`completeEmailAuth({ code })`** — verifies the code, then automatically loads an existing wallet or creates a new one if none exists.

The session (wallet ID, address, and signing key) is persisted to storage after step 2. On subsequent app loads, the session is restored automatically and no sign-in is required.

To end the session, call `oms.wallet.signOut()`.

## Configuration

### Custom Environment

Point the SDK at a non-production endpoint:

```typescript
const oms = new OMSClient({
  projectAccessKey: 'your-key',
  environment: {
    walletApiUrl: 'https://staging-wallet.example.com',
    indexerUrlTemplate: 'https://staging-indexer.example.com/{value}',
  },
})
```

### Custom Storage

The default storage backend is `localStorage` (browser). Provide a custom `StorageManager` for Node.js, React Native, or testing:

```typescript
import { StorageManager } from './storageManager'

class InMemoryStorage implements StorageManager {
  private store: Record<string, string> = {}
  get(key: string) { return this.store[key] ?? null }
  set(key: string, value: string) { this.store[key] = value }
  delete(key: string) { delete this.store[key] }
}

const oms = new OMSClient({
  projectAccessKey: 'your-key',
  storage: new InMemoryStorage(),
})
```

## Examples

### Sign a Message

```typescript
const signature = await oms.wallet.signMessage({
  network: 'polygon',
  message: '0xdeadbeef',
})
```

### Send a Native Token Transfer

```typescript
const txHash = await oms.wallet.sendTransaction({
  network: 'polygon',
  to: '0xRecipientAddress',
  value: '1000000000000000000', // 1 MATIC
})
```

### Call a Smart Contract

```typescript
const txHash = await oms.wallet.callContract({
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
const result = await oms.indexer.getTokenBalances({
  chainId: '137',           // Polygon
  contractAddress: '0xTokenContract',
  walletAddress: oms.wallet.walletAddress,
  includeMetadata: true,
})

for (const balance of result.balances) {
  console.log(balance.contractAddress, balance.balance)
}
```

### Manage Wallet Access

```typescript
// List all credentials with access
const grants = await oms.wallet.listAccess()

// Revoke a specific one
await oms.wallet.revokeAccess({ targetCredentialId: grants[0].credentialId })
```

### Sign Out

```typescript
oms.wallet.signOut()
// Redirect to sign-in screen
```

## API Reference

See [API.md](./API.md) for the full method and type reference.