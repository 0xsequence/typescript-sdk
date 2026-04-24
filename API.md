# OMS SDK — API Reference

## Table of Contents

- [OMSClient](#omsclient)
  - [Constructor](#constructor)
- [WalletClient](#walletclient)
  - [walletAddress](#walletaddress)
  - [startEmailAuth](#startemailauth)
  - [completeEmailAuth](#completeemailauth)
  - [signOut](#signout)
  - [signMessage](#signmessage)
  - [sendTransaction](#sendtransaction)
  - [callContract](#callcontract)
  - [listAccess](#listaccess)
  - [revokeAccess](#revokeaccess)
- [IndexerClient](#indexerclient)
  - [getTokenBalances](#gettokenbalances)
- [Types](#types)
  - [OmsEnvironment](#omsenvironment)
  - [StorageManager](#storagemanager)
  - [AccessGrant](#accessgrant)
  - [TokenBalancesResult](#tokenbalancesresult)
  - [TokenBalancesPage](#tokenbalancespage)
  - [TokenBalance](#tokenbalance)
  - [AbiArg](#abiarg)
  - [WalletType](#wallettype)

---

## OMSClient

The top-level entry point for the SDK. Instantiate once and reuse across your application.

```typescript
import { OMSClient } from './OMSClient'

const oms = new OMSClient({ projectAccessKey: 'your-key' })
```

### Constructor

```typescript
new OMSClient(params: {
  projectAccessKey: string
  environment?: OmsEnvironment
  storage?: StorageManager
})
```

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `projectAccessKey` | `string` | Yes | Your OMS project access key. |
| `environment` | `OmsEnvironment` | No | API endpoint configuration. Defaults to the production OMS endpoints. |
| `storage` | `StorageManager` | No | Storage backend for session persistence. Defaults to `LocalStorageManager` (`window.localStorage`). |

**Properties**

| Name | Type | Description |
|---|---|---|
| `wallet` | `WalletClient` | Handles authentication, signing, and transactions. |
| `indexer` | `IndexerClient` | Queries on-chain state and token balances. |

---

## WalletClient

Accessed via `oms.wallet`. Manages the full wallet lifecycle: authentication, session persistence, signing, and transaction submission.

### walletAddress

```typescript
walletAddress: string
```

The on-chain address of the active wallet. Empty string until `completeEmailAuth` resolves successfully. Persisted across sessions.

---

### startEmailAuth

```typescript
startEmailAuth(params: { email: string }): Promise<void>
```

Initiates email-based OTP authentication by sending a one-time code to the provided address.

After this resolves, show your OTP input UI and pass the user's code to [`completeEmailAuth`](#completeemailauth).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `email` | `string` | The email address to send the one-time passcode to. |

**Returns** `Promise<void>`

**Throws** if the network request fails or the email is invalid.

**Example**

```typescript
await oms.wallet.startEmailAuth({ email: 'user@example.com' })
// Show OTP input
```

---

### completeEmailAuth

```typescript
completeEmailAuth(params: {
  code: string
  walletType?: WalletType
}): Promise<void>
```

Completes the OTP flow and activates a wallet. Must be called after [`startEmailAuth`](#startemailauth).

This method verifies the code, then automatically selects an existing wallet matching `walletType` from the user's account, or creates a new one if none exists. The wallet ID, address, and session signing key are persisted to storage.

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `code` | `string` | Yes | The one-time passcode entered by the user. |
| `walletType` | `WalletType` | No | The wallet type to load or create. Defaults to `WalletType.Ethereum`. |

**Returns** `Promise<void>`

**Throws** if the code is incorrect, expired, or the network request fails.

**Example**

```typescript
try {
  await oms.wallet.completeEmailAuth({ code: '123456' })
  console.log('Wallet ready:', oms.wallet.walletAddress)
} catch (err) {
  // Handle wrong or expired code
}
```

---

### signOut

```typescript
signOut(): void
```

Clears the wallet session from storage. After calling this, `walletAddress` is no longer available and the user must authenticate again via [`startEmailAuth`](#startemailauth).

**Returns** `void` (synchronous)

**Example**

```typescript
oms.wallet.signOut()
// Navigate to sign-in screen
```

---

### signMessage

```typescript
signMessage(params: {
  network: string
  message: string
}): Promise<string>
```

Signs an arbitrary message using the wallet's session key.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `network` | `string` | The network identifier for the signing context, e.g. `"polygon"`, `"mainnet"`. |
| `message` | `string` | The message to sign. Typically a hex string or UTF-8 text. |

**Returns** `Promise<string>` — a hex-encoded signature.

**Throws** if no session is active or the request fails.

**Example**

```typescript
const signature = await oms.wallet.signMessage({
  network: 'polygon',
  message: '0xdeadbeef',
})
```

---

### sendTransaction

```typescript
sendTransaction(params: {
  network: string
  to: string
  value: string
}): Promise<string>
```

Sends a native token transfer via the OMS relayer. The user does not need to hold gas tokens.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `network` | `string` | Network to submit on, e.g. `"polygon"`, `"mainnet"`. |
| `to` | `string` | Recipient wallet address. |
| `value` | `string` | Amount to send as a string in the network's smallest denomination (e.g. wei). |

**Returns** `Promise<string>` — the transaction hash.

**Throws** if no session is active, the transaction is rejected, or the request fails.

**Example**

```typescript
const txHash = await oms.wallet.sendTransaction({
  network: 'polygon',
  to: '0xRecipient',
  value: '1000000000000000000', // 1 MATIC
})
```

---

### callContract

```typescript
callContract(params: {
  network: string
  contractAddress: string
  method: string
  args?: AbiArg[]
  value?: string
  feeCeiling?: string
  nonce?: string
}): Promise<string>
```

Calls a state-changing smart contract function. The transaction is submitted via the OMS relayer. For read-only queries, call the contract directly.

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `network` | `string` | Yes | Network identifier, e.g. `"polygon"`. |
| `contractAddress` | `string` | Yes | Address of the target contract. |
| `method` | `string` | Yes | ABI function signature, e.g. `"transfer(address,uint256)"`. |
| `args` | `AbiArg[]` | No | Ordered list of ABI-encoded arguments. See [`AbiArg`](#abiarg). |
| `value` | `string` | No | Native token value to attach, in the network's smallest denomination. |
| `feeCeiling` | `string` | No | Maximum fee the caller is willing to pay. |
| `nonce` | `string` | No | Override the transaction nonce. |

**Returns** `Promise<string>` — the transaction hash.

**Throws** if no session is active, the contract call reverts, or the request fails.

**Example**

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

---

### listAccess

```typescript
listAccess(): Promise<AccessGrant[]>
```

Returns all credentials that currently have access to this wallet. Use this to display active sessions in an account management UI.

**Returns** `Promise<AccessGrant[]>` — see [`AccessGrant`](#accessgrant).

**Throws** if no session is active or the request fails.

**Example**

```typescript
const grants = await oms.wallet.listAccess()
for (const grant of grants) {
  console.log(grant.credentialId, 'expires:', grant.expiresAt)
}
```

---

### revokeAccess

```typescript
revokeAccess(params: { targetCredentialId: string }): Promise<void>
```

Revokes access for a specific credential, permanently preventing it from interacting with this wallet. This action cannot be undone.

Call [`listAccess`](#listaccess) first to retrieve available credential IDs.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `targetCredentialId` | `string` | The unique identifier of the credential to revoke. |

**Returns** `Promise<void>`

**Throws** if the credential is not found, no session is active, or the request fails.

**Example**

```typescript
const grants = await oms.wallet.listAccess()
const other = grants.find(g => !g.isCaller)
if (other) {
  await oms.wallet.revokeAccess({ targetCredentialId: other.credentialId })
}
```

---

## IndexerClient

Accessed via `oms.indexer`. Queries on-chain token balances through the OMS Indexer API.

### getTokenBalances

```typescript
getTokenBalances(params: {
  chainId: string
  contractAddress: string
  walletAddress: string
  includeMetadata: boolean
}): Promise<TokenBalancesResult>
```

Fetches token balances for a wallet on a given chain and contract. Returns the first page of results (up to 40 entries).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `chainId` | `string` | The numeric chain ID as a string, e.g. `"137"` for Polygon, `"1"` for Ethereum mainnet. |
| `contractAddress` | `string` | The token contract address to query. |
| `walletAddress` | `string` | The wallet address whose balances to fetch. Use `oms.wallet.walletAddress` for the active wallet. |
| `includeMetadata` | `boolean` | When `true`, the response includes token metadata such as name, symbol, and decimals. |

**Returns** `Promise<TokenBalancesResult>` — see [`TokenBalancesResult`](#tokenbalancesresult).

**Throws** if the network request fails.

**Example**

```typescript
const result = await oms.indexer.getTokenBalances({
  chainId: '137',
  contractAddress: '0xTokenContract',
  walletAddress: oms.wallet.walletAddress,
  includeMetadata: true,
})

console.log(`Found ${result.balances.length} balances`)
for (const b of result.balances) {
  console.log(b.contractAddress, b.balance)
}
```

---

## Types

### OmsEnvironment

```typescript
interface OmsEnvironment {
  walletApiUrl: string
  indexerUrlTemplate: string
}
```

| Field | Type | Description |
|---|---|---|
| `walletApiUrl` | `string` | Base URL of the OMS Wallet API. |
| `indexerUrlTemplate` | `string` | URL template for the Indexer API. The `{value}` placeholder is replaced with the chain ID at request time, e.g. `"https://indexer.example.com/{value}"`. |

The production default is exported as `defaultOmsEnvironment`.

---

### StorageManager

```typescript
interface StorageManager {
  get(key: string): string | null
  set(key: string, value: string): void
  delete(key: string): void
}
```

Interface for session key/value storage. Implement this to use a custom backend. `LocalStorageManager` is the default browser implementation.

---

### AccessGrant

```typescript
interface AccessGrant {
  credentialId: string
  expiresAt: string
  isCaller: boolean
}
```

Represents a credential that has access to the wallet.

| Field | Type | Description |
|---|---|---|
| `credentialId` | `string` | Unique identifier. Pass to `revokeAccess` to remove this credential. |
| `expiresAt` | `string` | ISO 8601 timestamp for when this credential expires. |
| `isCaller` | `boolean` | `true` if this credential belongs to the current active session. |

---

### TokenBalancesResult

```typescript
interface TokenBalancesResult {
  status: number
  page?: TokenBalancesPage
  balances: TokenBalance[]
}
```

| Field | Type | Description |
|---|---|---|
| `status` | `number` | HTTP status code of the indexer response. |
| `page` | `TokenBalancesPage` | Pagination metadata, if present. |
| `balances` | `TokenBalance[]` | Array of token balance entries. |

---

### TokenBalancesPage

```typescript
interface TokenBalancesPage {
  page: number
  pageSize: number
  more: boolean
}
```

| Field | Type | Description |
|---|---|---|
| `page` | `number` | Current page index (zero-based). |
| `pageSize` | `number` | Number of entries per page. |
| `more` | `boolean` | `true` if there are additional pages of results. |

---

### TokenBalance

```typescript
interface TokenBalance {
  contractType?: string
  contractAddress?: string
  accountAddress?: string
  tokenId?: string
  balance?: string
  blockHash?: string
  blockNumber?: number
  chainId?: number
}
```

| Field | Type | Description |
|---|---|---|
| `contractType` | `string` | Token standard, e.g. `"ERC20"`, `"ERC721"`, `"ERC1155"`. |
| `contractAddress` | `string` | Address of the token contract. |
| `accountAddress` | `string` | Wallet address this balance belongs to. |
| `tokenId` | `string` | For NFTs (ERC-721/ERC-1155), the token ID. |
| `balance` | `string` | Token balance as a string in the token's smallest denomination. |
| `blockHash` | `string` | Hash of the block at which this balance was recorded. |
| `blockNumber` | `number` | Block number at which this balance was recorded. |
| `chainId` | `number` | Numeric chain ID this balance is on. |

---

### AbiArg

```typescript
interface AbiArg {
  type: string
  value: any
}
```

A single ABI-encoded argument for a contract call.

| Field | Type | Description |
|---|---|---|
| `type` | `string` | Solidity type string, e.g. `"address"`, `"uint256"`, `"bytes32"`, `"bool"`. |
| `value` | `any` | The argument value. Use a string for large integers to avoid precision loss. |

---

### WalletType

```typescript
enum WalletType {
  Ethereum = 'ethereum'
}
```

Identifies the wallet type to create or load. Pass as the optional `walletType` parameter to [`completeEmailAuth`](#completeemailauth).