# @0xsequence/oms-wallet-wagmi-connector

Wagmi connector for an active `@0xsequence/typescript-sdk` OMS client.

## Basic setup

```ts
import { createConfig, http } from 'wagmi'
import { polygon } from 'wagmi/chains'
import { FeeOptionSelector, OMSClient } from '@0xsequence/typescript-sdk'
import { omsWalletConnector } from '@0xsequence/oms-wallet-wagmi-connector'

const oms = new OMSClient({
  publishableKey: import.meta.env.VITE_OMS_PUBLISHABLE_KEY,
  projectId: import.meta.env.VITE_OMS_PROJECT_ID,
})

export const wagmiConfig = createConfig({
  chains: [polygon],
  transports: {
    [polygon.id]: http(),
  },
  connectors: [
    omsWalletConnector({
      client: oms,
      networks: oms.supportedNetworks,
      initialChainId: polygon.id,
      transactionOptions: {
        selectFeeOption: FeeOptionSelector.firstAvailable,
      },
    }),
  ],
})
```

## Authentication

The connector does not render authentication UI. Authenticate with the OMS SDK first, then call wagmi `connect` with the OMS Wallet connector once `oms.wallet.walletAddress` is set.

Email example:

```ts
await oms.wallet.startEmailAuth({ email })
await oms.wallet.completeEmailAuth({ code })

if (!oms.wallet.walletAddress) {
  throw new Error('OMS auth completed without an active wallet.')
}

await connect({
  connector: omsConnector,
  chainId: polygon.id,
})
```

For redirect-based OIDC flows such as Google, complete the SDK redirect callback first, then connect through wagmi once the wallet session is active.

## Disconnect

Wagmi `disconnect()` only disconnects the wagmi connector. It does not sign out the OMS Wallet SDK session, and it prevents wagmi from automatically reconnecting the OMS Wallet connector on page refresh until the app calls wagmi `connect()` again.

To sign out completely, disconnect wagmi state and then sign out with the SDK:

```ts
await disconnect()
await oms.wallet.signOut()
```

## Networks

OMS `Network` values are not wagmi chain definitions. Wagmi still needs viem `Chain` objects with RPC transport configuration. Use `wagmi/chains`, `viem/chains`, or custom viem `Chain` objects, then pass the OMS networks to the connector for OMS support validation.

The connector validates `initialChainId`, `switchChain`, and provider chain switches against both the wagmi chain list and the OMS network list. A transaction `chainId` is used for that transaction without switching the connector's current chain, and must be supported by OMS.

## Fee options

Wagmi transaction parameters do not include OMS fee-option preferences. Pass `transactionOptions` to the connector to apply static options or resolve options per transaction request.

```ts
import { TransactionMode } from '@0xsequence/typescript-sdk'

omsWalletConnector({
  client: oms,
  transactionOptions: ({ chainId, request }) => ({
    mode: TransactionMode.Relayer,
    selectFeeOption: async (feeOptions) => {
      const usdc = feeOptions.find(option => option.feeOption.token.symbol === 'USDC')
      return usdc?.selection
    },
  }),
})
```

The SDK calls `selectFeeOption` after preparing the transaction. The selector receives `FeeOptionWithBalance[]`, including each WaaS fee option and wallet balance data when the indexer can load it. Use `FeeOptionSelector.firstAvailable` to choose the first option the wallet can pay, or return `option.selection` from a custom selector. Without a selector, the SDK keeps sponsored transactions fee-free and otherwise chooses the first returned fee option.

For React UI, keep `selectFeeOption` wired in the connector initializer and bridge it into a modal or sheet with app state. The workspace wagmi example shows this as a hook-driven modal; see `examples/wagmi/src/feeOptionSelectionBridge.ts`, `examples/wagmi/src/useFeeOptionSelection.ts`, and the fee option panel in `examples/wagmi/src/App.tsx`.

## Transactions

The connector always waits for an EVM transaction hash because wagmi `sendTransaction` must return a hash. `waitForStatus: false` is not supported through this connector; use the SDK `wallet.sendTransaction` directly when you need to work with OMS `txnId` before a hash is available.

Supported transaction fields:

- `from`: validated against the active OMS Wallet address when present.
- `to`: required; contract deployment is not supported by this connector today.
- `value`
- `data`
- `chainId`

The connector ignores wallet-managed execution fields that OMS Wallet does not accept through this path: `gas`, `gasPrice`, `maxFeePerGas`, `maxPriorityFeePerGas`, `nonce`, `type`, and `accessList`. Unknown transaction fields are rejected.

## Provider Scope

Use this package through wagmi connector APIs. Do not treat `getProvider()` as a general RPC provider.

Supported provider methods are limited to the wallet operations that map to the SDK today: account discovery, local chain switching across configured OMS networks, `personal_sign`, `eth_signTypedData_v4`, `eth_sendTransaction`, and `wallet_sendTransaction`.

Unsupported methods include direct read/RPC methods such as `eth_call`, `eth_estimateGas`, `eth_getBalance`, `eth_getCode`, `eth_getTransactionCount`, `eth_getTransactionReceipt`, and `eth_blockNumber`. Use wagmi public transports for reads, or use `oms.wallet` directly for OMS SDK operations.

Raw byte message signing is not supported because OMS Wallet signs string messages. `eth_sign` and legacy `eth_signTypedData` are not supported; use `personal_sign` and `eth_signTypedData_v4`.

`wallet_getCapabilities` returns no capabilities unless OMS Wallet adds support for capability methods.
