# Wagmi Example

This Vite React example uses wagmi with both the OMS Wallet connector and the MetaMask connector.

Run it from the repository root:

```bash
pnpm install
pnpm build
cp examples/wagmi/.env.example examples/wagmi/.env.local
# Fill VITE_OMS_PUBLISHABLE_KEY and VITE_OMS_PROJECT_ID
# VITE_TRAILS_API_KEY is prefilled with the public Trails demo key
pnpm dev:wagmi-example
```

The dev server runs at `http://localhost:5173`.

The deployed example is available at `https://0xsequence.github.io/typescript-sdk/wagmi-example`.

The example authenticates OMS Wallet with the SDK, then connects through wagmi. Account state,
balance reads, chain switching, message signing, typed-data signing, transaction sending, fee-option
selection, and transaction receipt polling are all performed with wagmi hooks.

The OMS Wallet connector is configured with a stable `selectFeeOption` callback,
`selectFeeOptionWithAppUi`. The React app subscribes to that callback with
`useFeeOptionSelection`, so fee selection stays in app UI while transaction execution still goes
through wagmi.

If no component has mounted `useFeeOptionSelection`, `selectFeeOptionWithAppUi` falls back to the
first fee option with enough balance and throws when none can pay the fee. In this example,
`App` mounts the hook once and owns the modal.

Disconnecting in the example disconnects wagmi state only. To fully sign out an OMS Wallet session,
call `oms.wallet.signOut()` from the SDK.

Build it from the repository root:

```bash
pnpm build
pnpm build:wagmi-example
```
