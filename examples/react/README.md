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

The wallet-management panel creates and migrates a disposable Ethereum server wallet from Privy to
OMS without returning its plaintext private key to the browser. It uses the deployed
`oms-privy-import-example` Cloudflare Worker from both localhost and GitHub Pages, so local Privy
credentials are not required.

After signing in, open **Wallet management** and choose **Create and import test wallet**. The
example performs three visible steps:

1. The browser asks OMS for an HPKE recipient key and verifies its enclave attestation.
2. The test Worker creates a disposable Privy wallet and immediately calls
   [Privy's wallet export API](https://docs.privy.io/api-reference/wallets/export) with that recipient
   public key. Its generated authorization private key exists only for this request.
3. The browser sends Privy's ciphertext and encapsulated key to OMS, which imports and activates the
   wallet.

The Worker holds the Privy credentials as Cloudflare secrets, restricts browser origins to this
local example and the repository's GitHub Pages origin, and rate-limits disposable-wallet creation.
Its source and deployment instructions are in `examples/privy-import-worker`.

The deployed example is available at `https://0xpolygon.github.io/oms-wallet-typescript-sdk/react-example/`.

The Amoy-only "ERC20 example" panel includes a WalletKit Dollar example using
the demo WKUSD contract deployed on Polygon Amoy.

Google redirect sign-in uses the SDK default Google client id. Apple redirect sign-in uses the SDK default Apple Services ID.

Build it from the repository root:

```bash
pnpm build
pnpm build:example
```
