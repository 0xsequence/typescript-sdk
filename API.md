# OMS SDK — API Reference

## Table of Contents

- [OMSClient](#omsclient)
  - [Constructor](#constructor)
  - [supportedNetworks](#supportednetworks)
- [WalletClient](#walletclient)
  - [walletAddress](#walletaddress)
  - [session](#session)
  - [startEmailAuth](#startemailauth)
  - [completeEmailAuth](#completeemailauth)
  - [startOidcRedirectAuth](#startoidcredirectauth)
  - [completeOidcRedirectAuth](#completeoidcredirectauth)
  - [signInWithOidcRedirect](#signinwithoidcredirect)
  - [signOut](#signout)
  - [listWallets](#listwallets)
  - [useWallet](#usewallet)
  - [createWallet](#createwallet)
  - [signMessage](#signmessage)
  - [signTypedData](#signtypeddata)
  - [isValidMessageSignature](#isvalidmessagesignature)
  - [isValidTypedDataSignature](#isvalidtypeddatasignature)
  - [getTransactionStatus](#gettransactionstatus)
  - [sendTransaction](#sendtransaction)
    - [Native token transfer](#native-token-transfer)
    - [Raw data transaction](#raw-data-transaction)
    - [ABI-encoded contract call](#abi-encoded-contract-call)
  - [callContract](#callcontract)
  - [listAccess](#listaccess)
  - [listAccessPages](#listaccesspages)
  - [revokeAccess](#revokeaccess)
- [IndexerClient](#indexerclient)
  - [getTokenBalances](#gettokenbalances)
  - [getNativeTokenBalance](#getnativetokenbalance)
- [Errors](#errors)
- [Types](#types)
  - [Network](#network)
  - [OmsEnvironment](#omsenvironment)
  - [OidcProviderConfig](#oidcproviderconfig)
  - [StorageManager](#storagemanager)
  - [CredentialSigner](#credentialsigner)
  - [OmsWallet](#omswallet)
  - [WalletCredential](#walletcredential)
  - [AccessGrant](#accessgrant)
  - [ListAccessParams](#listaccessparams)
  - [AccessGrantPage](#accessgrantpage)
  - [SendNativeTransactionParams](#sendnativetransactionparams)
  - [SendDataTransactionParams](#senddatatransactionparams)
  - [SendContractTransactionParams](#sendcontracttransactionparams)
  - [SendTransactionResponse](#sendtransactionresponse)
  - [TransactionStatusPollingOptions](#transactionstatuspollingoptions)
  - [FeeOptionSelector](#feeoptionselector)
  - [TokenBalancesResult](#tokenbalancesresult)
  - [TokenBalancesPage](#tokenbalancespage)
  - [TokenBalance](#tokenbalance)
  - [TokenContractInfo](#tokencontractinfo)
  - [TokenMetadata](#tokenmetadata)
  - [TokenMetadataAsset](#tokenmetadataasset)
  - [AbiArg](#abiarg)
  - [WalletType](#wallettype)

---

## OMSClient

The top-level entry point for the SDK.

```typescript
import { OMSClient } from '@0xsequence/typescript-sdk'

const oms = new OMSClient({
  publicApiKey: 'your-public-api-key',
  projectId: 'your-project-id',
})
```

### Constructor

```typescript
new OMSClient(params: {
  publicApiKey: string
  projectId: string
  environment?: OmsEnvironment
  storage?: StorageManager
  redirectAuthStorage?: StorageManager
  credentialSigner?: CredentialSigner
})
```

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `publicApiKey` | `string` | Yes | Your OMS public API key. |
| `projectId` | `string` | Yes | Your OMS project ID. Used as the WaaS signing scope for wallet requests and OIDC redirect state. |
| `environment` | `OmsEnvironment` | No | API endpoint configuration. Defaults to the SDK's configured OMS endpoints. |
| `storage` | `StorageManager` | No | Storage backend for wallet metadata. Defaults to `LocalStorageManager` when browser `localStorage` is available, otherwise `MemoryStorageManager`. |
| `redirectAuthStorage` | `StorageManager` | No | Transient storage for OIDC redirect verifier/state. Defaults to `sessionStorage` when available. |
| `credentialSigner` | `CredentialSigner` | No | Request credential signer. Defaults to a non-extractable WebCrypto P-256 signer (`ecdsa-p256-sha256`) where WebCrypto is available. |

**Properties**

| Name | Type | Description |
|---|---|---|
| `wallet` | `WalletClient` | Handles authentication, signing, and transactions. |
| `indexer` | `IndexerClient` | Queries on-chain state and token balances. |
| `supportedNetworks` | `readonly Network[]` | Networks configured by the SDK. Same value as the exported `supportedNetworks`. |

### supportedNetworks

```typescript
oms.supportedNetworks: readonly Network[]
```

Returns the supported network registry. Each entry has `id`, `name`, `nativeTokenSymbol`, and `explorerUrl`.

## WalletClient

Accessed via `oms.wallet`. Manages the full wallet lifecycle: authentication, session persistence, signing, and transaction submission.

### walletAddress

```typescript
walletAddress: Address | undefined
```

The on-chain address of the active wallet (`Address` is the viem/abitype hex address type). Undefined until email or OIDC auth completes successfully, or a persisted session is restored.

### session

```typescript
type OMSClientSessionLoginType = 'email' | 'google-auth' | 'oidc'

interface OMSClientSessionState {
  walletAddress: Address | undefined
  expiresAt: string | undefined
  loginType: OMSClientSessionLoginType | undefined
  sessionEmail: string | undefined
}

wallet.session: OMSClientSessionState
```

Completed wallet sessions persist `walletAddress`, credential expiry, login type, and returned email in the configured `storage`. Pending email OTP and OIDC redirect state are not exposed through `session`; use the auth method results to drive pending UI.

---

### startEmailAuth

```typescript
startEmailAuth(params: { email: string }): Promise<void>
```

Sends a one-time passcode to the provided email address to begin authentication. If a wallet session is already active, it is cleared before the new auth attempt starts.

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
  autoActivate?: boolean
}): Promise<
  | { walletAddress: Address; wallet: OmsWallet; wallets: OmsWallet[]; credential: WalletCredential }
  | { wallets: OmsWallet[]; credential: WalletCredential }
>
```

Verifies the OTP code and activates a wallet. Must be called after [`startEmailAuth`](#startemailauth).

This method verifies the code with a one-week WaaS session lifetime, loads all wallet pages, then automatically selects an existing wallet matching `walletType`, or creates a new one if none exists. Wallet metadata is persisted to storage. Pass `autoActivate: false` to return `{ wallets, credential }` without selecting or creating a wallet; then call [`useWallet`](#usewallet) or [`createWallet`](#createwallet).

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `code` | `string` | Yes | The one-time passcode entered by the user. |
| `walletType` | `WalletType` | No | The wallet type to load or create. Defaults to `WalletType.Ethereum`. |
| `autoActivate` | `boolean` | No | Defaults to `true`. Set to `false` to let the app choose an existing wallet or create a new one. |

**Returns** `Promise<{ walletAddress: Address; wallet: OmsWallet; wallets: OmsWallet[]; credential: WalletCredential }>` by default, or `Promise<{ wallets: OmsWallet[]; credential: WalletCredential }>` when `autoActivate` is `false`.

**Throws** if the code is incorrect, expired, or the network request fails.

**Example**

```typescript
try {
  const { walletAddress, credential } = await oms.wallet.completeEmailAuth({ code: '123456' })
  console.log('Wallet ready:', walletAddress, credential.credentialId)
} catch (err) {
  // Handle wrong or expired code
}
```

---

### startOidcRedirectAuth

```typescript
startOidcRedirectAuth(params: {
  provider: string | OidcProviderConfig
  redirectUri: string
  walletType?: WalletType
  relayRedirectUri?: string
  authorizeParams?: Record<string, string>
}): Promise<{ url: string; state: string; challenge: string }>
```

Starts an OIDC authorization-code PKCE flow and returns the provider authorization URL. If a wallet session is already active, it is cleared before the new auth attempt starts. The pending verifier/state is stored in transient redirect auth storage so the callback can complete after a full-page redirect.

If `provider` is a string, it must match a configured `environment.auth.oidcProviders` key. Passing an `OidcProviderConfig` object directly is also supported.

In direct mode, `redirect_uri` is `redirectUri`. In relay mode, `redirect_uri` is `relayRedirectUri`, and the encoded state includes the final app `redirect_uri`.

```typescript
const { url } = await oms.wallet.startOidcRedirectAuth({
  provider: 'google',
  redirectUri: `${window.location.origin}/auth/callback`,
})

window.location.assign(url)
```

---

### completeOidcRedirectAuth

```typescript
completeOidcRedirectAuth(params: {
  callbackUrl: string
  cleanUrl?: boolean
  replaceUrl?: (url: string) => void
  autoActivate?: boolean
}): Promise<
  | { walletAddress: Address; wallet: OmsWallet; wallets: OmsWallet[]; credential: WalletCredential }
  | { wallets: OmsWallet[]; credential: WalletCredential }
>
```

Completes an OIDC redirect flow by validating the persisted state nonce, exchanging the authorization code with WaaS using a one-week session lifetime, and activating an existing wallet or creating one. Pass `autoActivate: false` to return `{ wallets, credential }` for app-driven wallet selection. `cleanUrl` removes OAuth query parameters after successful completion; outside a browser, pass `replaceUrl`.

```typescript
const { walletAddress, credential } = await oms.wallet.completeOidcRedirectAuth({
  callbackUrl: window.location.href,
  cleanUrl: true,
})
```

---

### signInWithOidcRedirect

```typescript
signInWithOidcRedirect(params: {
  provider: string | OidcProviderConfig
  redirectUri?: string
  walletType?: WalletType
  autoActivate?: boolean
  relayRedirectUri?: string
  authorizeParams?: Record<string, string>
  cleanUrl?: boolean
  currentUrl?: string
  assignUrl?: (url: string) => void
  replaceUrl?: (url: string) => void
}): Promise<{ walletAddress: Address; wallet: OmsWallet; wallets: OmsWallet[]; credential: WalletCredential } | { wallets: OmsWallet[]; credential: WalletCredential } | void>
```

Browser convenience method for regular web apps. If the current URL has OIDC callback params, it completes auth and returns the same result as [`completeOidcRedirectAuth`](#completeoidcredirectauth). Otherwise it starts auth, redirects with `window.location.assign`, and returns `void`. For router-driven apps, prefer [`startOidcRedirectAuth`](#startoidcredirectauth) and [`completeOidcRedirectAuth`](#completeoidcredirectauth).

```typescript
void oms.wallet.signInWithOidcRedirect({ provider: 'google' })
```

---

### signOut

```typescript
signOut(): Promise<void>
```

Clears the wallet session metadata from storage and clears the active credential signer where supported. After calling this, `walletAddress` and `session` metadata are no longer available and the user must authenticate again via [`startEmailAuth`](#startemailauth).

**Returns** `Promise<void>`

**Example**

```typescript
await oms.wallet.signOut()
```

---

### listWallets

```typescript
listWallets(): Promise<OmsWallet[]>
```

Returns all wallets available to the authenticated credential. This can be used after completing auth with `autoActivate: false` to show a wallet picker.

---

### useWallet

```typescript
useWallet(params: { walletId: string }): Promise<{ walletAddress: Address; wallet: OmsWallet }>
```

Activates an existing wallet by server-side wallet id and persists it as the current wallet session.

---

### createWallet

```typescript
createWallet(params?: { type?: WalletType; reference?: string }): Promise<{ walletAddress: Address; wallet: OmsWallet }>
```

Creates a new wallet, activates it, and persists it as the current wallet session. `type` defaults to `WalletType.Ethereum`.

---

### signMessage

```typescript
signMessage(params: {
  network: Network
  message: string
}): Promise<string>
```

Signs an arbitrary message using the active wallet session credential.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `network` | `Network` | The network for the signing context. Use an exported registry value such as `Networks.polygon`. See [Network](#network). |
| `message` | `string` | The message to sign. |

**Returns** `Promise<string>` — a hex-encoded signature.

**Example**

```typescript
import { Networks } from '@0xsequence/typescript-sdk'
const sigFromNetwork = await oms.wallet.signMessage({ network: Networks.polygon, message: 'some message to sing' })
```

---

### signTypedData

```typescript
signTypedData(params: {
  network: Network
  typedData: any
}): Promise<string>
```

Signs EIP-712 typed data using the active wallet session credential.

**Returns** `Promise<string>` — a hex-encoded signature.

---

### isValidMessageSignature

```typescript
isValidMessageSignature(params: {
  network?: Network
  walletAddress?: Address
  walletId?: string
  message: string
  signature: string
}): Promise<boolean>
```

Validates a message signature through the WaaS public wallet RPC. If neither `walletAddress` nor `walletId` is provided, the active wallet session id is used when available.

---

### isValidTypedDataSignature

```typescript
isValidTypedDataSignature(params: {
  network?: Network
  walletAddress?: Address
  walletId?: string
  typedData: any
  signature: string
}): Promise<boolean>
```

Validates an EIP-712 typed data signature through the WaaS public wallet RPC. If neither `walletAddress` nor `walletId` is provided, the active wallet session id is used when available.

---

### getTransactionStatus

```typescript
getTransactionStatus(params: { txnId: string }): Promise<TransactionStatusResponse>
```

Fetches the latest WaaS status for a prepared/executed transaction. This is useful after calling [`sendTransaction`](#sendtransaction) with `waitForStatus: false`.

---

### sendTransaction

`sendTransaction` is overloaded with three signatures depending on the type of transaction.

#### Native Token Transfer

```typescript
sendTransaction(params: SendNativeTransactionParams): Promise<SendTransactionResponse>
```

Sends native tokens (ETH, POL, etc.) to an address.

```typescript
import { parseUnits } from 'viem'

const tx = await oms.wallet.sendTransaction({
  network: Networks.polygon,
  to: '0xRecipient',
  value: parseUnits('1', 18), // 1 POL
})
```

#### Raw Data Transaction

```typescript
sendTransaction(params: SendDataTransactionParams): Promise<SendTransactionResponse>
```

Sends a transaction with arbitrary calldata as a hex string. Use this when you have pre-encoded calldata.

```typescript
const tx = await oms.wallet.sendTransaction({
  network: Networks.polygon,
  to: '0xContract',
  data: '0xa9059cbb000000000000000000000000...',
})
```

#### ABI-Encoded Contract Call

```typescript
sendTransaction<abi, functionName>(params: SendContractTransactionParams<abi, functionName>): Promise<SendTransactionResponse>
```

Sends a contract interaction with fully-typed ABI encoding via viem. The calldata is encoded automatically from `abi`, `functionName`, and `args`.

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

All three variants share the following optional base fields:

| Name | Type | Description |
|---|---|---|
| `value` | `bigint` | Native token value to attach (in wei). |
| `mode` | `TransactionMode` | Transaction execution mode. Defaults to `TransactionMode.Relayer`. |
| `selectFeeOption` | `FeeOptionSelector` | Optional callback for choosing a WaaS fee option. |
| `waitForStatus` | `boolean` | Set to `false` to return immediately after execute without polling WaaS transaction status. |
| `statusPolling` | `TransactionStatusPollingOptions` | Optional post-execute polling configuration. |

**Returns** `Promise<SendTransactionResponse>` — the prepared transaction ID, latest status, and transaction hash when available.

**Throws** if no session is active, the transaction reverts, or the request fails.

When fee options are returned, `selectFeeOption` receives `FeeOptionWithBalance[]`.
Each entry includes the generated `FeeOption` plus the selected wallet's balance
for that fee token when the indexer can load it.

---

### callContract

```typescript
callContract(params: {
  network: Network
  contractAddress: Address
  method: string
  args?: AbiArg[]
  mode?: TransactionMode
  selectFeeOption?: FeeOptionSelector
  waitForStatus?: boolean
  statusPolling?: TransactionStatusPollingOptions
}): Promise<SendTransactionResponse>
```

Calls a state-changing smart contract function using a method signature string and loosely-typed argument list. For fully-typed ABI encoding, prefer the ABI overload of [`sendTransaction`](#abi-encoded-contract-call).

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `network` | `Network` | Yes | Network identifier. See [Network](#network). |
| `contractAddress` | `Address` | Yes | Address of the target contract. |
| `method` | `string` | Yes | ABI function signature, e.g. `"transfer(address,uint256)"`. |
| `args` | `AbiArg[]` | No | Ordered list of typed arguments. See [AbiArg](#abiarg). |
| `mode` | `TransactionMode` | No | Transaction execution mode. Defaults to `TransactionMode.Relayer`. |
| `selectFeeOption` | `FeeOptionSelector` | No | Optional callback for choosing a WaaS fee option. |
| `waitForStatus` | `boolean` | No | Set to `false` to return immediately after execute without polling WaaS transaction status. |
| `statusPolling` | `TransactionStatusPollingOptions` | No | Optional post-execute polling configuration. |

**Returns** `Promise<SendTransactionResponse>` — the prepared transaction ID, latest status, and transaction hash when available.

**Example**

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

---

### listAccess

```typescript
listAccess(params?: ListAccessParams): Promise<AccessGrant[]>
```

Returns all credentials that currently have access to this wallet. The SDK follows WaaS cursors internally and flattens all pages into one array.

**Returns** `Promise<AccessGrant[]>` — see [AccessGrant](#accessgrant).

**Example**

```typescript
const grants = await oms.wallet.listAccess()
console.log(grants.filter(g => g.isCaller)) // current session
```

---

### listAccessPages

```typescript
listAccessPages(params?: ListAccessParams): AsyncIterable<AccessGrantPage>
```

Yields credential pages for callers that want page-at-a-time rendering or explicit backpressure.

**Example**

```typescript
for await (const page of oms.wallet.listAccessPages({ pageSize: 25 })) {
  console.log(page.grants)
}
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
  network: Network
  contractAddress?: string
  walletAddress: string
  includeMetadata: boolean
  page?: {
    page?: number
    pageSize?: number
  }
}): Promise<TokenBalancesResult>
```

Fetches token balances for a wallet on a given network. Omit `contractAddress` to query balances across contracts; provide it to filter to one token contract. The default request returns page `0` with up to `40` entries. When `includeMetadata` is `true`, token display data is returned on `contractInfo` and `tokenMetadata`; ERC-20 decimals are available as `contractInfo.decimals`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `network` | `Network` | The network to query. Use an exported registry value such as `Networks.polygon`. |
| `contractAddress` | `string` | Optional token contract filter. Omit to query balances across contracts. |
| `walletAddress` | `string` | The wallet address whose balances to fetch. Use `oms.wallet.walletAddress` after checking it is defined. |
| `includeMetadata` | `boolean` | When `true`, the response includes token metadata such as name, symbol, and decimals. |
| `page` | `{ page?: number; pageSize?: number }` | Optional pagination request. Defaults to `{ page: 0, pageSize: 40 }`. |

**Returns** `Promise<TokenBalancesResult>` — see [TokenBalancesResult](#tokenbalancesresult).

**Example**

```typescript
const { walletAddress } = oms.wallet
if (!walletAddress) throw new Error('No active wallet session')

const result = await oms.indexer.getTokenBalances({
  network: Networks.polygon,
  walletAddress,
  includeMetadata: true,
})

for (const b of result.balances) {
  console.log(b.contractAddress, b.balance, b.tokenId)
}
```

---

### getNativeTokenBalance

```typescript
getNativeTokenBalance(params: {
  network: Network
  walletAddress: string
}): Promise<TokenBalance | undefined>
```

Fetches the native token balance for a wallet. This is also used internally to enrich transaction fee options.

---

## Errors

Public methods throw `OmsSdkError` subclasses for SDK-level failures.

```typescript
class OmsSdkError extends Error {
  code: OmsSdkErrorCode
  operation?: string
  status?: number
  txnId?: string
  retryable?: boolean
  cause?: unknown
}
```

```typescript
type OmsSdkErrorCode =
  | 'OMS_HTTP_ERROR'
  | 'OMS_INVALID_RESPONSE'
  | 'OMS_REQUEST_FAILED'
  | 'OMS_AUTH_COMMITMENT_CONSUMED'
  | 'OMS_SESSION_MISSING'
  | 'OMS_TRANSACTION_STATUS_LOOKUP_FAILED'
  | 'OMS_VALIDATION_ERROR'
```

`OMS_AUTH_COMMITMENT_CONSUMED` means the OTP/OIDC auth commitment has already been used. Restart the auth flow before retrying.

| Class | Typical use |
|---|---|
| `OmsSessionError` | Missing or stale wallet session. |
| `OmsRequestError` | Network, fetch, or non-2xx HTTP failures. |
| `OmsResponseError` | Invalid JSON or malformed API responses. |
| `OmsTransactionError` | Transaction was submitted but status polling failed; includes `txnId`. |
| `OmsValidationError` | SDK-side validation failures before a request is sent. |

Use `isOmsSdkError(err)` or `err instanceof OmsSdkError` to branch on structured error fields.

---

## Types

### Network

```typescript
interface Network {
  readonly id: number
  readonly name: string
  readonly nativeTokenSymbol: string
  readonly explorerUrl: string
}
```

A supported OMS network entry. The SDK exports `Networks`, `supportedNetworks`, `findNetworkById(id)`, and `findNetworkByName(name)`.

```typescript
findNetworkById(id: number): Network | undefined
findNetworkByName(name: string): Network | undefined
```

| Key | id | name | nativeTokenSymbol | explorerUrl |
|---|---:|---|---|---|
| `Networks.mainnet` | 1 | `mainnet` | `ETH` | `https://etherscan.io` |
| `Networks.sepolia` | 11155111 | `sepolia` | `ETH` | `https://sepolia.etherscan.io` |
| `Networks.polygon` | 137 | `polygon` | `POL` | `https://polygonscan.com` |
| `Networks.amoy` | 80002 | `amoy` | `POL` | `https://amoy.polygonscan.com` |
| `Networks.arbitrum` | 42161 | `arbitrum` | `ETH` | `https://arbiscan.io` |
| `Networks.arbitrumSepolia` | 421614 | `arbitrum-sepolia` | `ETH` | `https://sepolia.arbiscan.io` |
| `Networks.optimism` | 10 | `optimism` | `ETH` | `https://optimistic.etherscan.io` |
| `Networks.optimismSepolia` | 11155420 | `optimism-sepolia` | `ETH` | `https://sepolia-optimism.etherscan.io` |
| `Networks.base` | 8453 | `base` | `ETH` | `https://basescan.org` |
| `Networks.baseSepolia` | 84532 | `base-sepolia` | `ETH` | `https://sepolia.basescan.org` |
| `Networks.bsc` | 56 | `bsc` | `BNB` | `https://bscscan.com` |
| `Networks.bscTestnet` | 97 | `bsc-testnet` | `BNB` | `https://testnet.bscscan.com` |
| `Networks.arbitrumNova` | 42170 | `arbitrum-nova` | `ETH` | `https://nova.arbiscan.io` |
| `Networks.avalanche` | 43114 | `avalanche` | `AVAX` | `https://subnets.avax.network/c-chain` |
| `Networks.avalancheTestnet` | 43113 | `avalanche-testnet` | `AVAX` | `https://subnets-test.avax.network/c-chain` |
| `Networks.katana` | 747474 | `katana` | `ETH` | `https://katanascan.com` |

### OmsEnvironment

```typescript
interface OmsEnvironment {
  walletApiUrl: string
  indexerUrlTemplate: string
  auth?: {
    oidcProviders?: Record<string, OidcProviderConfig>
  }
}
```

| Field | Type | Description |
|---|---|---|
| `walletApiUrl` | `string` | Base URL of the WaaS Wallet RPC host. |
| `indexerUrlTemplate` | `string` | URL template for the Indexer API. `{value}` is replaced with the selected network name, e.g. `"https://indexer.example.com/{value}"`. |
| `auth.oidcProviders` | `Record<string, OidcProviderConfig>` | OIDC provider configurations addressable by provider key. |

The default is exported as `defaultOmsEnvironment` and includes the `google` OIDC provider.

Use `defineOmsEnvironment` to preserve typed custom OIDC provider keys:

```typescript
const environment = defineOmsEnvironment({
  ...defaultOmsEnvironment,
  auth: {
    ...defaultOmsEnvironment.auth,
    oidcProviders: {
      ...defaultOmsEnvironment.auth?.oidcProviders,
      custom: customOidcProvider,
    },
  },
})
```

---

### OidcProviderConfig

```typescript
type OidcProviderConfig = {
  clientId: string
  issuer: string
  authorizationUrl: string
  scopes?: string[]
  relayRedirectUri?: string
  authorizeParams?: Record<string, string>
}
```

Google can be configured with the `googleOidcProvider` helper:

```typescript
// Uses the SDK default Google client id and relay redirect URI.
googleOidcProvider()

// Override defaults when needed.
googleOidcProvider({
  clientId: 'your-google-client-id',
  relayRedirectUri: 'http://localhost:8090/callback',
})
```

---

### StorageManager

```typescript
interface StorageManager {
  get(key: string): string | null
  set(key: string, value: string): void
  delete(key: string): void
}
```

Interface for wallet metadata storage. Implement this to use a custom backend. The SDK defaults to `LocalStorageManager` when browser `localStorage` is available and `MemoryStorageManager` otherwise; raw default session private keys are not stored here.

---

### CredentialSigner

```typescript
interface CredentialSigner {
  readonly signingAlgorithm: 'ecdsa-p256k-eip191' | 'ecdsa-p256-sha256'
  credentialId(): Promise<string>
  nextNonce(): Promise<string>
  sign(preimage: string): Promise<string>
  hasCredential?(): Promise<boolean>
  clear?(): Promise<void>
}
```

Interface for request credential signing. The default implementation is `WebCryptoP256CredentialSigner`, which uses `ecdsa-p256-sha256` and a non-extractable WebCrypto private key.

---

### OmsWallet

```typescript
interface OmsWallet {
  id: string
  type: WalletType
  address: Address
  reference?: string
}
```

Wallet metadata returned by auth and wallet listing APIs.

---

### WalletCredential

```typescript
interface WalletCredential {
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

`AccessGrant` has the same shape and represents a credential with access to the active wallet.

---

### AccessGrant

```typescript
type AccessGrant = WalletCredential
```

---

### ListAccessParams

```typescript
interface ListAccessParams {
  pageSize?: number
}
```

| Field | Type | Description |
|---|---|---|
| `pageSize` | `number` | Requested page size for WaaS calls. The server applies its own default and maximum. |

---

### AccessGrantPage

```typescript
interface AccessGrantPage {
  grants: AccessGrant[]
}
```

| Field | Type | Description |
|---|---|---|
| `grants` | `AccessGrant[]` | Credentials yielded for this page. |

---

### SendNativeTransactionParams

```typescript
type SendNativeTransactionParams = {
  network: Network
  to: Address
  value: bigint        // required — amount in wei
  mode?: TransactionMode
  selectFeeOption?: FeeOptionSelector
  waitForStatus?: boolean
  statusPolling?: TransactionStatusPollingOptions
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
  mode?: TransactionMode
  selectFeeOption?: FeeOptionSelector
  waitForStatus?: boolean
  statusPolling?: TransactionStatusPollingOptions
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
  mode?: TransactionMode
  selectFeeOption?: FeeOptionSelector
  waitForStatus?: boolean
  statusPolling?: TransactionStatusPollingOptions
}
```

Used for fully-typed ABI-encoded contract calls. `abi` and `functionName` are required; `args` types are inferred from the ABI. `data` must not be set. Calldata is encoded automatically using viem's `encodeFunctionData`.

---

### SendTransactionResponse

```typescript
type SendTransactionResponse = {
  txnId: string
  status: TransactionStatus
  txnHash?: string
}
```

`txnHash` is present once WaaS reports a published transaction. If polling times out while the transaction is still pending, use `txnId` to check status later.

---

### TransactionStatusPollingOptions

```typescript
type TransactionStatusPollingOptions = {
  timeoutMs?: number
  intervalMs?: number
  fastIntervalMs?: number
  fastPollCount?: number
}
```

Controls how `sendTransaction` polls WaaS transaction status after execute when `waitForStatus` is not `false`.

---

### FeeOptionSelector

```typescript
type FeeOptionSelector = (
  feeOptions: FeeOptionWithBalance[]
) => FeeOptionSelection | undefined | Promise<FeeOptionSelection | undefined>

type FeeOptionWithBalance = {
  feeOption: FeeOption
  balance?: TokenBalance
  available?: string
  availableRaw?: string
  decimals?: number
}
```

When no selector is provided, the SDK uses the first required fee option, or no fee option for sponsored transactions.

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
  balanceUSD?: string
  priceUSD?: string
  priceUpdatedAt?: string
  blockHash?: string
  blockNumber?: number
  chainId?: number
  uniqueCollectibles?: string
  isSummary?: boolean
  contractInfo?: TokenContractInfo
  tokenMetadata?: TokenMetadata
}
```

| Field | Type | Description |
|---|---|---|
| `contractType` | `string` | Token standard, e.g. `"ERC20"`, `"ERC721"`, `"ERC1155"`. |
| `contractAddress` | `string` | Address of the token contract. |
| `accountAddress` | `string` | Wallet address this balance belongs to. |
| `tokenId` | `string` | For ERC-721/ERC-1155 tokens, the token ID. |
| `balance` | `string` | Balance in the token's smallest denomination. |
| `balanceUSD` | `string` | USD value when returned by the Indexer. |
| `priceUSD` | `string` | Token price in USD when returned by the Indexer. |
| `priceUpdatedAt` | `string` | Timestamp for the returned USD price. |
| `blockHash` | `string` | Block hash at which this balance was recorded. |
| `blockNumber` | `number` | Block number at which this balance was recorded. |
| `chainId` | `number` | Numeric chain ID. |
| `uniqueCollectibles` | `string` | Number of unique collectibles represented by a summary row. |
| `isSummary` | `boolean` | Whether the row represents an aggregated collection summary. |
| `contractInfo` | `TokenContractInfo` | Contract display metadata. ERC-20 decimals are exposed as `contractInfo.decimals`. |
| `tokenMetadata` | `TokenMetadata` | Token-level metadata for NFT/collection entries when returned. |

---

### TokenContractInfo

```typescript
interface TokenContractInfo {
  chainId?: number
  address?: string
  source?: string
  name?: string
  type?: string
  symbol?: string
  decimals?: number
  logoURI?: string
  deployed?: boolean
  bytecodeHash?: string
  extensions?: Record<string, unknown>
  updatedAt?: string
  queuedAt?: string | null
  status?: string
}
```

Contract-level metadata returned by the Indexer when `includeMetadata` is `true`.

---

### TokenMetadata

```typescript
interface TokenMetadata {
  chainId?: number
  contractAddress?: string
  tokenId?: string
  source?: string
  name?: string
  description?: string
  image?: string
  video?: string
  audio?: string
  properties?: Record<string, unknown>
  attributes?: Record<string, unknown>[]
  image_data?: string
  external_url?: string
  background_color?: string
  animation_url?: string
  decimals?: number
  updatedAt?: string
  assets?: TokenMetadataAsset[]
  status?: string
  queuedAt?: string | null
  lastFetched?: string
}
```

Token-level metadata returned by the Indexer when available.

---

### TokenMetadataAsset

```typescript
interface TokenMetadataAsset {
  id?: number
  collectionId?: number
  tokenId?: string
  url?: string
  metadataField?: string
  name?: string
  filesize?: number
  mimeType?: string
  width?: number
  height?: number
  updatedAt?: string
}
```

Media asset metadata associated with token metadata when returned.

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
