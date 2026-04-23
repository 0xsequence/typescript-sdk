# OmsWallet SDK — API Reference

## Table of Contents

- [OmsWallet](#omswallet)
    - [Constructor](#constructor)
    - [signInWithEmail](#signinwithemail)
    - [completeEmailSignIn](#completeemailsignin)
    - [signMessage](#signmessage)
    - [sendTransaction](#sendtransaction)
    - [callContract](#callcontract)
    - [listAccess](#listaccess)
    - [revokeAccess](#revokeaccess)
    - [clearSession](#clearsession)
- [Types](#types)
    - [OmsEnvironment](#omsenvironment)
    - [StorageManager](#storagemanager)
    - [CallContractRequest](#callcontractrequest)
    - [AbiArg](#abiarg)
    - [CredentialInfo](#credentialinfo)

---

## OmsWallet

The top-level SDK class. Instantiate once and reuse across your application.

```typescript
import { OMSClient } from './omsWallet'

const oms = new OMSClient({ projectAccessKey: 'your-key' })
```

---

### Constructor

```typescript
new OmsWallet(params: {
  projectAccessKey: string
  environment?: OmsEnvironment
  storage?: StorageManager
})
```

Creates a new `OmsWallet` instance. If a persisted session exists in storage the wallet address and session key are restored automatically — no sign-in required.

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `projectAccessKey` | `string` | Yes | Your OMS project access key. |
| `environment` | `OmsEnvironment` | No | API endpoint configuration. Defaults to the production OMS WaaS endpoint. |
| `storage` | `StorageManager` | No | Storage backend for session persistence. Defaults to `LocalStorageManager` (browser `localStorage`). |

**Example**

```typescript
// Minimal
const sdk = new OmsWallet({ projectAccessKey: 'your-key' })

// With custom environment and storage
const sdk = new OmsWallet({
  projectAccessKey: 'your-key',
  environment: { apiRpcUrl: 'https://staging.waas.example.com' },
  storage: new MySecureStorage(),
})
```

---

### signInWithEmail

```typescript
signInWithEmail(email: string): Promise<void>
```

Initiates email-based OTP authentication. Sends a one-time passcode to the provided email address.

After this resolves, display an OTP input in your UI and pass the user's code to [`completeEmailSignIn`](#completeemailsignin).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `email` | `string` | The email address to send the one-time passcode to. |

**Returns** `Promise<void>`

**Throws** if the request fails (e.g. network error or invalid email).

**Example**

```typescript
await sdk.signInWithEmail('user@example.com')
// Show OTP input UI
```

---

### completeEmailSignIn

```typescript
completeEmailSignIn(code: string): Promise<void>
```

Completes the email OTP authentication flow. Must be called after [`signInWithEmail`](#signinwithemail).

Verifies the code, establishes a session, and persists the session to storage. After this resolves, the wallet is ready for use.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `code` | `string` | The one-time passcode entered by the user. |

**Returns** `Promise<void>`

**Throws** if the code is incorrect, expired, or the request fails.

**Example**

```typescript
try {
  await sdk.completeEmailSignIn(userEnteredCode)
  // Session established — proceed to wallet operations
} catch (err) {
  // Handle incorrect or expired code
}
```

---

### signMessage

```typescript
signMessage(network: string, message: string): Promise<string>
```

Signs an arbitrary message using the wallet's session key.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `network` | `string` | The network identifier for the signing context, e.g. `"polygon"`, `"mainnet"`. |
| `message` | `string` | The message to sign. Typically a hex string or plain text. |

**Returns** `Promise<string>` — a hex-encoded signature.

**Throws** if the wallet session is not established or the request fails.

**Example**

```typescript
const signature = await sdk.signMessage('polygon', '0xdeadbeef')
console.log('Signature:', signature)
```

---

### sendTransaction

```typescript
sendTransaction(network: string, to: string, value: string): Promise<string>
```

Sends a native token transfer to the specified address. The transaction is submitted via the OMS relayer, so the user does not need to hold gas tokens.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `network` | `string` | The network to submit the transaction on, e.g. `"polygon"`, `"mainnet"`. |
| `to` | `string` | The recipient wallet address. |
| `value` | `string` | The amount to send as a string in the network's smallest denomination (e.g. wei for Ethereum/Polygon). |

**Returns** `Promise<string>` — the transaction hash.

**Throws** if the wallet session is not established, the transaction is rejected, or the request fails.

**Example**

```typescript
// Send 1 MATIC (1e18 wei)
const txHash = await sdk.sendTransaction(
  'polygon',
  '0xRecipientAddress',
  '1000000000000000000'
)
console.log('Transaction hash:', txHash)
```

---

### callContract

```typescript
callContract(params: CallContractRequest): Promise<string>
```

Calls a smart contract function that writes state (transfers, mints, approvals, etc.). For read-only queries, call the contract directly without this method.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `params` | `CallContractRequest` | Full request object. See [`CallContractRequest`](#callcontractrequest). |

**Returns** `Promise<string>` — the transaction hash.

**Throws** if the wallet session is not established, the contract call reverts, or the request fails.

**Example**

```typescript
import { TransactionMode } from './generated/waas.gen'

const txHash = await sdk.callContract({
  network: 'polygon',
  walletId: sdk.wallet.walletId,
  contractAddress: '0xTokenAddress',
  method: 'transfer(address,uint256)',
  args: [
    { type: 'address', value: '0xRecipient' },
    { type: 'uint256', value: '1000000000000000000' },
  ],
  mode: TransactionMode.Relayer,
})
```

---

### listAccess

```typescript
listAccess(): Promise<CredentialInfo[]>
```

Returns all credentials that currently have access to this wallet. Use this to display active sessions or integrations in an account management UI.

**Returns** `Promise<CredentialInfo[]>` — an array of credential descriptors. See [`CredentialInfo`](#credentialinfo).

**Throws** if the wallet session is not established or the request fails.

**Example**

```typescript
const credentials = await sdk.listAccess()
for (const cred of credentials) {
  console.log(cred.credentialId, 'expires:', cred.expiresAt, 'caller:', cred.isCaller)
}
```

---

### revokeAccess

```typescript
revokeAccess(targetCredentialId: string): Promise<void>
```

Revokes access for a specific credential, permanently preventing it from interacting with this wallet. This action cannot be undone.

Call [`listAccess`](#listaccess) first to retrieve the credential IDs available for revocation.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `targetCredentialId` | `string` | The unique identifier of the credential to revoke. |

**Returns** `Promise<void>`

**Throws** if the credential ID is not found, the wallet session is not established, or the request fails.

**Example**

```typescript
const credentials = await sdk.listAccess()
const staleCredential = credentials.find(c => !c.isCaller)
if (staleCredential) {
  await sdk.revokeAccess(staleCredential.credentialId)
}
```

---

### clearSession

```typescript
clearSession(): Promise<void>
```

Clears the wallet session from storage. After calling this, the user will need to sign in again via [`signInWithEmail`](#signinwithemail).

**Returns** `Promise<void>`

**Example**

```typescript
await sdk.clearSession()
// Redirect to sign-in screen
```

---

## Types

### OmsEnvironment

```typescript
interface OmsEnvironment {
  apiRpcUrl: string
}
```

| Field | Type | Description |
|---|---|---|
| `apiRpcUrl` | `string` | Base URL of the OMS WaaS API endpoint. |

The default production environment is exported as `defaultOmsEnvironment`.

---

### StorageManager

```typescript
interface StorageManager {
  get(key: string): string | null
  set(key: string, value: string): void
  delete(key: string): void
}
```

Interface for session persistence. Implement this to use a custom storage backend (e.g. `AsyncStorage` for React Native, `node-keytar` for Electron, or an in-memory store for testing).

`LocalStorageManager` is the default browser implementation backed by `window.localStorage`.

---

### CallContractRequest

```typescript
interface CallContractRequest {
  network: string
  walletId: string
  contractAddress: string
  method: string
  args?: AbiArg[]
  value?: string
  mode: TransactionMode
  feeCeiling?: string
  nonce?: string
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `network` | `string` | Yes | Network identifier, e.g. `"polygon"`, `"mainnet"`. |
| `walletId` | `string` | Yes | The wallet ID from `sdk.wallet.walletId`. |
| `contractAddress` | `string` | Yes | Address of the contract to call. |
| `method` | `string` | Yes | ABI function signature, e.g. `"transfer(address,uint256)"`. |
| `args` | `AbiArg[]` | No | Ordered list of ABI-encoded arguments. See [`AbiArg`](#abiarg). |
| `value` | `string` | No | Native token value to attach, in the network's smallest denomination. |
| `mode` | `TransactionMode` | Yes | `TransactionMode.Relayer` (gas-free) or `TransactionMode.Native`. |
| `feeCeiling` | `string` | No | Maximum fee the user is willing to pay. |
| `nonce` | `string` | No | Override the transaction nonce. |

---

### AbiArg

```typescript
interface AbiArg {
  type: string
  value: any
}
```

| Field | Type | Description |
|---|---|---|
| `type` | `string` | Solidity type string, e.g. `"address"`, `"uint256"`, `"bytes32"`. |
| `value` | `any` | The argument value. Use a string for large integers. |

---

### CredentialInfo

```typescript
interface CredentialInfo {
  credentialId: string
  expiresAt: string
  isCaller: boolean
}
```

| Field | Type | Description |
|---|---|---|
| `credentialId` | `string` | Unique identifier for this credential. Pass to `revokeAccess` to remove it. |
| `expiresAt` | `string` | ISO 8601 timestamp indicating when this credential expires. |
| `isCaller` | `boolean` | `true` if this credential belongs to the current session. |