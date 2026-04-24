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
    - [Native token transfer](#native-token-transfer)
    - [Raw data transaction](#raw-data-transaction)
    - [ABI-encoded contract call](#abi-encoded-contract-call)
  - [callContract](#callcontract)
  - [listAccess](#listaccess)
  - [revokeAccess](#revokeaccess)
- [IndexerClient](#indexerclient)
  - [getTokenBalances](#gettokenbalances)
- [Types](#types)
  - [Network](#network)
  - [OmsEnvironment](#omsenvironment)
  - [StorageManager](#storagemanager)
  - [AccessGrant](#accessgrant)
  - [SendNativeTransactionParams](#sendnativetransactionparams)
  - [SendDataTransactionParams](#senddatatransactionparams)
  - [SendContractTransactionParams](#sendcontracttransactionparams)
  - [TokenBalancesResult](#tokenbalancesresult)
  - [TokenBalancesPage](#tokenbalancespage)
  - [TokenBalance](#tokenbalance)
  - [AbiArg](#abiarg)
  - [WalletType](#wallettype)

---

## OMSClient

The top-level entry point for the SDK.

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
| `storage` | `StorageManager` | No | Session storage backend. Defaults to `LocalStorageManager` (`window.localStorage`). |

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
walletAddress: Address
```

The on-chain address of the active wallet (`Address` is the viem/abitype hex address type). Defaults to `'0x00'` until `completeEmailAuth` resolves successfully. Persisted across sessions.

---

### startEmailAuth

```typescript
startEmailAuth(params: { email: string }): Promise<void>
```

Sends a one-time passcode to the provided email address to begin authentication.

After this resolves, display an OTP input and pass the code to [`completeEmailAuth`](#completeemailauth).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `email` | `string` | The email address to send the one-time passcode to. |

**Returns** `Promise<void>`

**Throws** if the network request fails or the email is invalid.

**Example**

```typescript
await oms.wallet.startEmailAuth({ email: 'user@example.com' })
```

---

### completeEmailAuth

```typescript
completeEmailAuth(params: {
  code: string
  walletType?: WalletType
}): Promise<void>
```

Verifies the OTP code and activates a wallet. Must be called after [`startEmailAuth`](#startemailauth).

Automatically selects an existing wallet of `walletType` from the user's account, or creates a new one if none exists. The wallet ID, address, and session key are persisted to storage.

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

Clears the wallet session from storage synchronously. After this, `walletAddress` resets to `'0x00'` and the user must authenticate again.

**Returns** `void`

**Example**

```typescript
oms.wallet.signOut()
```

---

### signMessage

```typescript
signMessage(params: {
  network: Network
  message: string
}): Promise<string>
```

Signs an arbitrary message using the wallet's session key.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `network` | `Network` | The network for the signing context. Accepts a chain name string, chain ID bigint, or viem `Chain` object. See [Network](#network). |
| `message` | `string` | The message to sign. |

**Returns** `Promise<string>` — a hex-encoded signature.

**Example**

```typescript
const sig = await oms.wallet.signMessage({ network: 'polygon', message: '0xdeadbeef' })

// Using a viem Chain object
import { polygon } from 'viem/chains'
const sig = await oms.wallet.signMessage({ network: polygon, message: '0xdeadbeef' })
```

---

### sendTransaction

`sendTransaction` is overloaded with three signatures depending on the type of transaction.

#### Native Token Transfer

```typescript
sendTransaction(params: SendNativeTransactionParams): Promise<string>
```

Sends native tokens (ETH, MATIC, etc.) to an address.

```typescript
const txHash = await oms.wallet.sendTransaction({
  network: 'polygon',
  to: '0xRecipient',
  value: 1_000_000_000_000_000_000n, // 1 MATIC in wei
})
```

#### Raw Data Transaction

```typescript
sendTransaction(params: SendDataTransactionParams): Promise<string>
```

Sends a transaction with arbitrary calldata as a hex string. Use this when you have pre-encoded calldata.

```typescript
const txHash = await oms.wallet.sendTransaction({
  network: 'polygon',
  to: '0xContract',
  data: '0xa9059cbb000000000000000000000000...',
})
```

#### ABI-Encoded Contract Call

```typescript
sendTransaction<abi, functionName>(params: SendContractTransactionParams<abi, functionName>): Promise<string>
```

Sends a contract interaction with fully-typed ABI encoding via viem. The calldata is encoded automatically from `abi`, `functionName`, and `args`.

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

All three variants share the following optional base fields:

| Name | Type | Description |
|---|---|---|
| `value` | `bigint` | Native token value to attach (in wei). |
| `feeCeiling` | `bigint` | Maximum fee the caller is willing to pay (in wei). |
| `nonce` | `bigint` | Override the transaction nonce. |

**Returns** `Promise<string>` — the transaction hash.

**Throws** if no session is active, the transaction reverts, or the request fails.

---

### callContract

```typescript
callContract(params: {
  network: Network
  contractAddress: Address
  method: string
  args?: AbiArg[]
  value?: bigint
  feeCeiling?: bigint
  nonce?: bigint
}): Promise<string>
```

Calls a state-changing smart contract function using a method signature string and loosely-typed argument list. For fully-typed ABI encoding, prefer the ABI overload of [`sendTransaction`](#abi-encoded-contract-call).

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `network` | `Network` | Yes | Network identifier. See [Network](#network). |
| `contractAddress` | `Address` | Yes | Address of the target contract. |
| `method` | `string` | Yes | ABI function signature, e.g. `"transfer(address,uint256)"`. |
| `args` | `AbiArg[]` | No | Ordered list of typed arguments. See [AbiArg](#abiarg). |
| `value` | `bigint` | No | Native token value to attach (in wei). |
| `feeCeiling` | `bigint` | No | Maximum fee to pay (in wei). |
| `nonce` | `bigint` | No | Override the transaction nonce. |

**Returns** `Promise<string>` — the transaction hash.

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
  value: 0n,
})
```

---

### listAccess

```typescript
listAccess(): Promise<AccessGrant[]>
```

Returns all credentials that currently have access to this wallet.

**Returns** `Promise<AccessGrant[]>` — see [AccessGrant](#accessgrant).

**Example**

```typescript
const grants = await oms.wallet.listAccess()
console.log(grants.filter(g => g.isCaller)) // current session
```

---

### revokeAccess

```typescript
revokeAccess(params: { targetCredentialId: string }): Promise<void>
```

Permanently revokes a credential's access to this wallet. Cannot be undone.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `targetCredentialId` | `string` | The ID of the credential to revoke. Obtain from [`listAccess`](#listaccess). |

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

Fetches token balances for a wallet on a given chain and contract (first page, up to 40 entries).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `chainId` | `string` | Numeric chain ID as a string, e.g. `"137"` for Polygon, `"1"` for Ethereum mainnet. |
| `contractAddress` | `string` | The token contract address to query. |
| `walletAddress` | `string` | The wallet whose balances to fetch. Pass `oms.wallet.walletAddress` for the active wallet. |
| `includeMetadata` | `boolean` | When `true`, includes token metadata (name, symbol, decimals) in the response. |

**Returns** `Promise<TokenBalancesResult>` — see [TokenBalancesResult](#tokenbalancesresult).

**Example**

```typescript
const result = await oms.indexer.getTokenBalances({
  chainId: '137',
  contractAddress: '0xTokenContract',
  walletAddress: oms.wallet.walletAddress,
  includeMetadata: true,
})

for (const b of result.balances) {
  console.log(b.contractAddress, b.balance, b.tokenId)
}
```

---

## Types

### Network

```typescript
type Network = string | bigint | Chain
```

Accepted by all transaction and signing methods. The SDK resolves the appropriate chain name regardless of which form you pass:

| Form | Example |
|---|---|
| Chain name string | `'polygon'`, `'mainnet'`, `'arbitrum'` |
| Chain ID as bigint | `137n`, `1n`, `42161n` |
| viem `Chain` object | `polygon`, `mainnet` (from `viem/chains`) |

---

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
| `indexerUrlTemplate` | `string` | URL template for the Indexer API. `{value}` is replaced with the chain ID at request time, e.g. `"https://indexer.example.com/{value}"`. |

The default is exported as `defaultOmsEnvironment`.

---

### StorageManager

```typescript
interface StorageManager {
  get(key: string): string | null
  set(key: string, value: string): void
  delete(key: string): void
}
```

Interface for session key/value persistence. `LocalStorageManager` is the default browser implementation backed by `window.localStorage`.

---

### AccessGrant

```typescript
interface AccessGrant {
  credentialId: string
  expiresAt: string
  isCaller: boolean
}
```

| Field | Type | Description |
|---|---|---|
| `credentialId` | `string` | Unique identifier. Pass to `revokeAccess` to remove this credential. |
| `expiresAt` | `string` | ISO 8601 timestamp for credential expiry. |
| `isCaller` | `boolean` | `true` if this credential belongs to the current active session. |

---

### SendNativeTransactionParams

```typescript
type SendNativeTransactionParams = {
  network: Network
  to: Address
  value: bigint        // required — amount in wei
  feeCeiling?: bigint
  nonce?: bigint
}
```

Used when sending a native token transfer. `value` is required and `data`/`abi` must not be set.

---

### SendDataTransactionParams

```typescript
type SendDataTransactionParams = {
  network: Network
  to: Address
  data: Hex            // required — pre-encoded calldata
  value?: bigint
  feeCeiling?: bigint
  nonce?: bigint
}
```

Used when sending a transaction with raw calldata. `abi` must not be set.

---

### SendContractTransactionParams

```typescript
type SendContractTransactionParams<
  abi extends Abi | readonly unknown[],
  functionName extends ContractFunctionName<abi> | undefined
> = {
  network: Network
  to: Address
  abi: abi
  functionName: functionName
  args?: ...           // inferred from abi + functionName
  value?: bigint
  feeCeiling?: bigint
  nonce?: bigint
}
```

Used for fully-typed ABI-encoded contract calls. `abi` and `functionName` are required; `args` types are inferred from the ABI. `data` must not be set. Calldata is encoded automatically using viem's `encodeFunctionData`.

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
| `balances` | `TokenBalance[]` | Array of token balance entries for the requested address. |

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
| `pageSize` | `number` | Number of entries per page (up to 40). |
| `more` | `boolean` | `true` if additional pages are available. |

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
| `tokenId` | `string` | For ERC-721/ERC-1155 tokens, the token ID. |
| `balance` | `string` | Balance in the token's smallest denomination. |
| `blockHash` | `string` | Block hash at which this balance was recorded. |
| `blockNumber` | `number` | Block number at which this balance was recorded. |
| `chainId` | `number` | Numeric chain ID. |

---

### AbiArg

```typescript
interface AbiArg {
  type: string
  value: any
}
```

A loosely-typed ABI argument used by [`callContract`](#callcontract). For fully-typed encoding, use the ABI overload of [`sendTransaction`](#abi-encoded-contract-call) instead.

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

Identifies the wallet type to load or create. Passed as the optional `walletType` parameter to [`completeEmailAuth`](#completeemailauth). Defaults to `WalletType.Ethereum`.