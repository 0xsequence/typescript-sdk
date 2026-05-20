# OMS SDK

A TypeScript SDK for the OMS (Open Money Stack) platform. Provides email and OIDC redirect wallet authentication, on-chain transaction submission, message signing, and token balance queries — with automatic session persistence.

## Usage

Install the published SDK package in your application:

```bash
pnpm add @0xsequence/typescript-sdk@alpha
```

For npm or yarn projects:

```bash
npm install @0xsequence/typescript-sdk@alpha
yarn add @0xsequence/typescript-sdk@alpha
```

Then initialize the client with your OMS project credentials:

```typescript
import { OMSClient } from '@0xsequence/typescript-sdk'

const oms = new OMSClient({
  publicApiKey: 'your-public-api-key',
  projectId: 'your-project-id',
})
```

In Vite browser apps, keep those values in local environment variables:

```typescript
function requiredEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing ${name}`)
  }
  return value
}

const oms = new OMSClient({
  publicApiKey: requiredEnv('VITE_OMS_PUBLIC_API_KEY', import.meta.env.VITE_OMS_PUBLIC_API_KEY),
  projectId: requiredEnv('VITE_OMS_PROJECT_ID', import.meta.env.VITE_OMS_PROJECT_ID),
})
```

If your app imports utilities from `viem`, such as the `parseUnits` helper used in the quick start below, install it as a direct dependency too:

```bash
pnpm add viem
```

For local development in this repository, install dependencies and build the workspace package:

From the repository root:

```bash
pnpm install
pnpm build
```

## React Example

A deployed React example is available at [https://0xsequence.github.io/typescript-sdk/react-example/](https://0xsequence.github.io/typescript-sdk/react-example/).

To run it locally from the repository root:

```bash
cp examples/react/.env.example examples/react/.env.local
# Fill VITE_OMS_PUBLIC_API_KEY and VITE_OMS_PROJECT_ID in examples/react/.env.local
pnpm dev:example
```

## Quick Start

```typescript
import { Networks, OMSClient, WalletType } from '@0xsequence/typescript-sdk'
import { parseUnits } from 'viem'

const oms = new OMSClient({
  publicApiKey: 'your-public-api-key',
  projectId: 'your-project-id',
})

// 1. Send a one-time code to the user's email
await oms.wallet.startEmailAuth({ email: 'user@example.com' })

// 2. User enters the code — verifies it and sets up the wallet automatically
const { walletAddress, credential } = await oms.wallet.completeEmailAuth({ code: '123456' })

// 3. The wallet is ready
console.log('Wallet address:', walletAddress)
console.log('Credential:', credential.credentialId)

// 4. Send a transaction
const tx = await oms.wallet.sendTransaction({
  network: Networks.polygon,
  to: '0xRecipient',
  value: parseUnits('1', 18), // 1 POL
})
console.log(tx.txnHash ?? tx.txnId)
```

## Overview

`OMSClient` exposes two sub-clients:

| Property | Type | Description |
|---|---|---|
| `oms.wallet` | `WalletClient` | Authentication, signing, and transaction submission. |
| `oms.indexer` | `IndexerClient` | Read token balances and on-chain state. |

## Authentication Flow

OMS supports email-based OTP and OIDC authorization-code PKCE redirect auth.

### Email OTP Auth

Email OTP is a two-step flow:

1. **`startEmailAuth({ email })`** — clears any active session and sends a one-time code to the user's inbox.
2. **`completeEmailAuth({ code })`** — verifies the code, then automatically loads an existing wallet or creates a new one if none exists. Returns `{ walletAddress, wallet, wallets, credential }`.

Use manual wallet selection when the app needs to present wallet choices:

```typescript
const selection = await oms.wallet.completeEmailAuth({
  code: '123456',
  walletType: WalletType.Ethereum,
  walletSelection: 'manual',
})

await selection.selectWallet({ walletId: selection.wallets[0].id })
// or:
await selection.createAndSelectWallet({ reference: 'main' })
```

The returned pending selection is bound to the verified auth flow and signer. Hold that object and complete selection through it instead of saving `{ wallets }` and later calling global wallet activation methods.

### OIDC Redirect Auth

Google redirect auth is configured on the default environment. The redirect auth APIs are provider-neutral, so custom environments can add or replace providers.

```typescript
const oms = new OMSClient({
  publicApiKey: 'your-public-api-key',
  projectId: 'your-project-id',
})
```

For routers such as React Router or Next.js, use the explicit start/complete methods:

```typescript
const { url } = await oms.wallet.startOidcRedirectAuth({
  provider: 'google',
  redirectUri: `${window.location.origin}/auth/callback`,
})

window.location.assign(url)

// On the callback route:
const { walletAddress, wallet, wallets, credential } = await oms.wallet.completeOidcRedirectAuth({
  callbackUrl: window.location.href,
  cleanUrl: true,
})
```

OIDC redirect auth also supports manual wallet selection by passing `walletSelection: 'manual'` to `completeOidcRedirectAuth`.

For simple browser apps, use the one-call convenience method from a sign-in action and from the callback page:

```typescript
void oms.wallet.signInWithOidcRedirect({ provider: 'google' })
```

Pending redirect state is stored in `sessionStorage` by default. Final wallet session metadata continues to use the configured SDK storage.

### Session State

Email and OIDC auth both persist the active wallet session in the configured SDK storage. Browser storage defaults to `localStorage` when available; non-browser runtimes fall back to in-memory storage unless you provide a custom `StorageManager`. Browser signing defaults to a non-extractable WebCrypto P-256 credential using `ecdsa-p256-sha256`, so the private session key is not written to `localStorage`. Completed auth requests ask WaaS for a one-week session lifetime.

Use `oms.wallet.walletAddress` when you only need the active wallet address. Use `oms.wallet.session` when you also need credential expiry, login type, or the email returned by the wallet API.

```typescript
const walletAddress = oms.wallet.walletAddress
const { expiresAt, loginType, sessionEmail } = oms.wallet.session
```

Pending email OTP and OIDC redirect state are not exposed through `session`; use the auth method results to drive pending UI.

To end the session, call:

```typescript
await oms.wallet.signOut()
```

## Networks

The SDK exports `Networks`, `supportedNetworks`, `findNetworkById(id)`, and `findNetworkByName(name)` for the networks currently configured by OMS. Each network has `id`, `name`, `nativeTokenSymbol`, and `explorerUrl`.

The `network` parameter on all transaction and signing methods accepts a `Network` from the SDK registry:

```typescript
import { Networks, findNetworkById, supportedNetworks } from '@0xsequence/typescript-sdk'

await oms.wallet.signMessage({ network: Networks.polygon, message: 'some message to sing' })

console.log(supportedNetworks)
console.log(findNetworkById(80002)) // Networks.amoy
```

| Key | id | name | native token | explorerUrl |
|---|---:|---|---|---|
| `Networks.mainnet` | 1 | `mainnet` | ETH | `https://etherscan.io` |
| `Networks.sepolia` | 11155111 | `sepolia` | ETH | `https://sepolia.etherscan.io` |
| `Networks.polygon` | 137 | `polygon` | POL | `https://polygonscan.com` |
| `Networks.amoy` | 80002 | `amoy` | POL | `https://amoy.polygonscan.com` |
| `Networks.arbitrum` | 42161 | `arbitrum` | ETH | `https://arbiscan.io` |
| `Networks.arbitrumSepolia` | 421614 | `arbitrum-sepolia` | ETH | `https://sepolia.arbiscan.io` |
| `Networks.optimism` | 10 | `optimism` | ETH | `https://optimistic.etherscan.io` |
| `Networks.optimismSepolia` | 11155420 | `optimism-sepolia` | ETH | `https://sepolia-optimism.etherscan.io` |
| `Networks.base` | 8453 | `base` | ETH | `https://basescan.org` |
| `Networks.baseSepolia` | 84532 | `base-sepolia` | ETH | `https://sepolia.basescan.org` |
| `Networks.bsc` | 56 | `bsc` | BNB | `https://bscscan.com` |
| `Networks.bscTestnet` | 97 | `bsc-testnet` | BNB | `https://testnet.bscscan.com` |
| `Networks.arbitrumNova` | 42170 | `arbitrum-nova` | ETH | `https://nova.arbiscan.io` |
| `Networks.avalanche` | 43114 | `avalanche` | AVAX | `https://subnets.avax.network/c-chain` |
| `Networks.avalancheTestnet` | 43113 | `avalanche-testnet` | AVAX | `https://subnets-test.avax.network/c-chain` |
| `Networks.katana` | 747474 | `katana` | ETH | `https://katanascan.com` |

## Sending Transactions

`sendTransaction` has three overloaded signatures to cover the most common patterns.

### Native Token Transfer

```typescript
import { parseUnits } from 'viem'

const tx = await oms.wallet.sendTransaction({
  network: Networks.polygon,
  to: '0xRecipient',
  value: parseUnits('1', 18), // 1 POL
})
```

### Raw Data Transaction

```typescript
const tx = await oms.wallet.sendTransaction({
  network: Networks.polygon,
  to: '0xContract',
  data: '0xa9059cbb000000000000000000000000...',
})
```

### ABI-Encoded Contract Call (via viem)

Pass an ABI and function name — the SDK encodes the calldata automatically using viem.

```typescript
import { parseUnits } from 'viem'

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
  network: Networks.polygon,
  to: '0xTokenContract',
  abi: erc20Abi,
  functionName: 'transfer',
  args: ['0xRecipient', parseUnits('1', 18)],
})
```

`sendTransaction` prepares and executes the transaction, then polls WaaS for
the latest transaction status. The response includes `txnId`, `status`, and `txnHash`
when the transaction has been published.

To return immediately after execute without status polling, pass
`waitForStatus: false`. You can then call `getTransactionStatus` with the
returned `txnId`.

```typescript
import { parseUnits } from 'viem'

const tx = await oms.wallet.sendTransaction({
  network: Networks.polygon,
  to: '0xRecipient',
  value: parseUnits('0.001', 18),
  waitForStatus: false,
})

const status = await oms.wallet.getTransactionStatus({ txnId: tx.txnId })
```

To tune polling, pass `statusPolling`:

```typescript
import { parseUnits } from 'viem'

await oms.wallet.sendTransaction({
  network: Networks.polygon,
  to: '0xRecipient',
  value: parseUnits('0.001', 18),
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
  network: Networks.polygon,
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
  publicApiKey: 'your-public-api-key',
  projectId: 'your-project-id',
  environment: {
    walletApiUrl: 'https://staging-wallet.example.com',
    indexerUrlTemplate: 'https://staging-indexer.example.com/{value}',
  },
})
```

For indexer requests, `{value}` is replaced with the selected `Network.name`, such as `polygon` or `amoy`.

### Custom Storage and Signing

The default storage backend is browser `localStorage` when available, otherwise in-memory storage for wallet metadata only. The default browser signer stores its non-extractable key reference separately through WebCrypto-compatible browser storage. Provide a custom `StorageManager` for persistent Node.js, React Native, or testing sessions:

```typescript
import { MemoryStorageManager, OMSClient } from '@0xsequence/typescript-sdk'

const oms = new OMSClient({
  publicApiKey: 'your-public-api-key',
  projectId: 'your-project-id',
  storage: new MemoryStorageManager(),
})
```

OIDC redirect auth uses separate transient storage for verifier/state data. In browsers it defaults to `sessionStorage`; pass `redirectAuthStorage` to override it. Final wallet session metadata continues to use the configured `storage`.

## More Examples

### Sign and Validate Message

```typescript
const signature = await oms.wallet.signMessage({
  network: Networks.polygon,
  message: 'some message to sing',
})

const isValid = await oms.wallet.isValidMessageSignature({
  network: Networks.polygon,
  walletAddress: oms.wallet.walletAddress,
  message: 'some message to sing',
  signature,
})
```

### Sign and Validate Typed Data

```typescript
const signature = await oms.wallet.signTypedData({
  network: Networks.polygon,
  typedData,
})

const isValid = await oms.wallet.isValidTypedDataSignature({
  network: Networks.polygon,
  walletAddress: oms.wallet.walletAddress,
  typedData,
  signature,
})
```

### Call a Contract (method string + args)

```typescript
import { parseUnits } from 'viem'

const tx = await oms.wallet.callContract({
  network: Networks.polygon,
  contractAddress: '0xTokenContract',
  method: 'transfer(address,uint256)',
  args: [
    { type: 'address', value: '0xRecipient' },
    { type: 'uint256', value: parseUnits('1', 18).toString() },
  ],
})
```

### Query Token and Native Balances

```typescript
const { walletAddress } = oms.wallet
if (!walletAddress) throw new Error('No active wallet session')

const result = await oms.indexer.getTokenBalances({
  network: Networks.polygon,
  walletAddress,
  includeMetadata: true,
})

for (const b of result.balances) {
  console.log(b.contractInfo?.symbol, b.balance, b.contractInfo?.decimals)
}

const nativeBalance = await oms.indexer.getNativeTokenBalance({
  network: Networks.polygon,
  walletAddress,
})

console.log(nativeBalance?.balance)
```

Pass `contractAddress` to filter balances to one token contract. With `includeMetadata: true`, ERC-20 decimals are available as `contractInfo.decimals`. The response is paginated; pass `page` when requesting later pages.

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

## API Reference

See [API.md](./API.md) for the full method and type reference.
