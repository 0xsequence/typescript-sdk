# Wagmi Example

This Vite React example uses wagmi with the OMS Wallet connector, the MetaMask connector, and the Trails widget.

Run it from the repository root:

```bash
pnpm install
pnpm build
cp examples/wagmi/.env.example examples/wagmi/.env.local
# Fill VITE_OMS_PUBLISHABLE_KEY and VITE_OMS_PROJECT_ID
pnpm dev:wagmi-example
```

The dev server runs at `http://localhost:5173`.

The deployed example is available at `https://0xsequence.github.io/typescript-sdk/wagmi-example`.

The example authenticates OMS Wallet with the SDK, then connects through wagmi. Account state,
balance reads, chain switching, message signing, typed-data signing, transaction sending, fee-option
selection, and transaction receipt polling are all performed with wagmi hooks.

The Trails widget is configured with the same wagmi runtime through `@0xtrails/adapter-wagmi`.

The OMS Wallet connector is configured with a stable `selectFeeOption` callback,
`selectFeeOptionWithAppUi`. The React app subscribes to that callback with
`useFeeOptionSelection`, so fee selection stays in app UI while transaction execution still goes
through wagmi.

If no component has mounted `useFeeOptionSelection`, `selectFeeOptionWithAppUi` falls back to the
first fee option with enough balance and throws when none can pay the fee. In this example,
`App` mounts the hook once and owns the modal.

The fee-option bridge only keeps one listener. If multiple components mount
`useFeeOptionSelection`, the last registered listener is the active one. When the active listener
unmounts, the bridge does not restore an earlier listener; that component must remount or register
again to become active.

Disconnecting in the example disconnects wagmi state only. To fully sign out an OMS Wallet session,
call `oms.wallet.signOut()` from the SDK.

Build it from the repository root:

```bash
pnpm build
pnpm build:wagmi-example
```
