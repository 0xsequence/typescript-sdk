# React Example

This example consumes the SDK as a workspace package:

```ts
import { OMSWallet } from '@polygonlabs/oms-wallet'
```

Run it from the repository root:

```bash
pnpm install
pnpm build
pnpm dev:example
```

The dev server runs at `http://localhost:5173`.

## Privy wallet import

The wallet-management panel can migrate an Ethereum server wallet from Privy to OMS without
returning its plaintext private key to the browser. Configure the local-only export middleware:

```bash
cp examples/react/.env.example examples/react/.env.local
```

Then set `PRIVY_APP_ID` and `PRIVY_APP_SECRET` in `.env.local`. For an owner-controlled Privy wallet,
also set `PRIVY_AUTHORIZATION_PRIVATE_KEY` to the base64 PKCS8 private key for a satisfying
authorization-key owner. Restart the dev server after changing these values. Do not use `VITE_`
prefixes: these credentials belong to the local server and must not be included in browser code.
Keep the dev server bound to localhost while it holds these credentials.

After signing in, open **Wallet management**. Choose **Create test wallet** to create an
owned Ethereum test wallet and fill its wallet ID automatically, or enter the ID of an existing
wallet controlled by `PRIVY_AUTHORIZATION_PRIVATE_KEY`. Disposable wallet authorization keys are
kept in memory and work until the local dev server restarts. Then choose **Import Privy wallet**. The
example performs three visible steps:

1. The browser asks OMS for an HPKE recipient key and verifies its enclave attestation.
2. The local middleware calls [Privy's wallet export API](https://docs.privy.io/api-reference/wallets/export)
   with that recipient public key.
3. The browser sends Privy's ciphertext and encapsulated key to OMS, which imports and activates the
   wallet.

The static GitHub Pages deployment cannot hold a Privy app secret, so it shows the flow but keeps
the Privy import action disabled. The private-key import beside it remains available for disposable
test keys.

The deployed example is available at `https://0xpolygon.github.io/oms-wallet-typescript-sdk/react-example/`.

The Amoy-only "ERC20 example" panel includes a WalletKit Dollar example using
the demo WKUSD contract deployed on Polygon Amoy.

Google redirect sign-in uses the SDK default Google client id. Apple redirect sign-in uses the SDK default Apple Services ID.

Build it from the repository root:

```bash
pnpm build
pnpm build:example
```
