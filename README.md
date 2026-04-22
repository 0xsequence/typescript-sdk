# OMS TypeScript SDK

A TypeScript SDK for interacting with the OMS WaaS (Wallet-as-a-Service) API. Handles email-based authentication, wallet creation, message signing, and on-chain transactions — with session persistence built in.

## Installation

```bash
npm install ethers
```

Copy `oms-wallet-sdk.ts` (or the compiled output) into your project along with the generated `waas.gen.ts` client file.

## Quick Start

```typescript
import { OmsWallet } from './OmsWallet'

const sdk = new OmsWallet({ projectAccessKey: 'your-project-access-key' })

// 1. Start email sign-in — sends a one-time code to the user
await sdk.signInWithEmail('user@example.com')

// 2. User enters the code from their email
await sdk.completeEmailSignIn('123456')

// 3. Sign a message
const signature = await sdk.signMessage('polygon', '0xdeadbeef')

// 4. Send a transaction
const txHash = await sdk.sendTransaction('polygon', '0xRecipient...', '1000000000000000000')
```

## Authentication Flow

OmsWallet uses email-based OTP authentication. The flow is always:

1. Call `signInWithEmail(email)` — sends a code to the user's inbox.
2. User enters the code in your UI.
3. Call `completeEmailSignIn(code)` — verifies the code and establishes a session.
4. The session is automatically persisted to storage, so the user stays signed in across page loads.

To sign out or switch accounts, call `clearSession()`.

## Configuration

### Custom Environment

By default the SDK points to the production OMS WaaS endpoint. Override this for staging or local development:

```typescript
import { OmsWallet } from './OmsWallet'
import { OmsEnvironment } from './omsEnvironment'

const sdk = new OmsWallet({
  projectAccessKey: 'your-key',
  environment: { apiRpcUrl: 'https://staging.waas.example.com' },
})
```

### Custom Storage

By default sessions are stored in `localStorage` (browser). Provide a custom `StorageManager` for Node.js, React Native, or any other environment:

```typescript
import { OmsWallet } from './OmsWallet'
import { StorageManager } from './storageManager'

class SecureStorage implements StorageManager {
  get(key: string) { /* ... */ }
  set(key: string, value: string) { /* ... */ }
  delete(key: string) { /* ... */ }
}

const sdk = new OmsWallet({
  projectAccessKey: 'your-key',
  storage: new SecureStorage(),
})
```

## Examples

### Sign a Message

```typescript
const signature = await sdk.signMessage('polygon', '0xdeadbeef')
console.log('Signature:', signature)
```

### Send a Native Token Transfer

```typescript
// Value is in the network's base unit (e.g. wei for Ethereum/Polygon)
const txHash = await sdk.sendTransaction(
  'polygon',
  '0xRecipientAddress',
  '1000000000000000000' // 1 MATIC
)
console.log('Transaction hash:', txHash)
```

### Call a Smart Contract

```typescript
import { TransactionMode } from './generated/waas.gen'

const txHash = await sdk.callContract({
  network: 'polygon',
  walletId: sdk.wallet.walletId,
  contractAddress: '0xContractAddress',
  method: 'transfer(address,uint256)',
  args: [
    { type: 'address', value: '0xRecipient' },
    { type: 'uint256', value: '1000000000000000000' },
  ],
  mode: TransactionMode.Relayer,
})
```

### Manage Access

```typescript
// List all credentials with access to this wallet
const credentials = await sdk.listAccess()
console.log(credentials)

// Revoke a specific credential
await sdk.revokeAccess(credentials[0].credentialId)
```

### Sign Out

```typescript
await sdk.clearSession()
// Redirect to sign-in screen
```

## API Reference

See [API.md](./API.md) for the full method reference.