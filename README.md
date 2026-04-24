# OMS SDK

A TypeScript SDK for the OMS (Open Mobile Stack) platform. Provides email-based wallet authentication, on-chain transaction submission, message signing, and token balance queries — with automatic session persistence.

## Installation

```bash
npm install ethers viem
```

Copy the SDK source files into your project alongside the generated `waas.gen.ts` client.

## Quick Start

```typescript
import { OMSClient } from './OMSClient'

const oms = new OMSClient({ projectAccessKey: 'your-project-access-key' })

// 1. Send a one-time code to the user's email
await oms.wallet.startEmailAuth({ email: 'user@example.com' })

// 2. User enters the code — verifies it and sets up the wallet automatically
await oms.wallet.completeEmailAuth({ code: '123456' })

// 3. The wallet is ready
console.log('Wallet address:', oms.wallet.walletAddress)

// 4. Send a transaction
const txHash = await oms.wallet.sendTransaction({
  network: 'polygon',
  to: '0xRecipient',
  value: 1_000_000_000_000_000_000n, // 1 MATIC
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

The session (wallet ID, address, and signing key) is persisted to storage after step 2, so on subsequent loads no sign-in is required.

To end the session, call `oms.wallet.signOut()`.

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
const txHash = await oms.wallet.sendTransaction({
  network: 'polygon',
  to: '0xRecipient',
  value: 1_000_000_000_000_000_000n, // 1 MATIC in wei
})
```

### Raw Data Transaction

```typescript
const txHash = await oms.wallet.sendTransaction({
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

const txHash = await oms.wallet.sendTransaction({
  network: 'polygon',
  to: '0xTokenContract',
  abi: erc20Abi,
  functionName: 'transfer',
  args: ['0xRecipient', 1_000_000_000_000_000_000n],
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
  },
})
```

### Custom Storage

The default is `localStorage` (browser). Provide a custom `StorageManager` for Node.js, React Native, or testing:

```typescript
class InMemoryStorage implements StorageManager {
  private store: Record<string, string> = {}
  get(key: string) { return this.store[key] ?? null }
  set(key: string, value: string) { this.store[key] = value }
  delete(key: string) { delete this.store[key] }
}

const oms = new OMSClient({ projectAccessKey: 'your-key', storage: new InMemoryStorage() })
```

## More Examples

### Sign a Message

```typescript
const signature = await oms.wallet.signMessage({
  network: 'polygon',
  message: '0xdeadbeef',
})
```

### Call a Contract (method string + args)

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
  chainId: '137',
  contractAddress: '0xTokenContract',
  walletAddress: oms.wallet.walletAddress,
  includeMetadata: true,
})

for (const b of result.balances) {
  console.log(b.contractAddress, b.balance)
}
```

### Manage Access

```typescript
const grants = await oms.wallet.listAccess()
await oms.wallet.revokeAccess({ targetCredentialId: grants[0].credentialId })
```

### Sign Out

```typescript
oms.wallet.signOut()
```

## API Reference

See [API.md](./API.md) for the full method and type reference.