# React Example

This example consumes the SDK as a workspace package:

```ts
import { OMSClient } from '@0xsequence/typescript-sdk'
```

Run it from the repository root:

```bash
pnpm install
pnpm build
cp examples/react/.env.example examples/react/.env.local
# Fill VITE_OMS_PUBLIC_API_KEY and VITE_OMS_PROJECT_ID
pnpm dev:example
```

The dev server runs at `http://localhost:5173`.

The deployed example is available at `https://0xsequence.github.io/typescript-sdk/react-example`.

The example requires a public API key and project ID. Configure them locally before running the dev server:

```bash
cp examples/react/.env.example examples/react/.env.local
# Fill VITE_OMS_PUBLIC_API_KEY and VITE_OMS_PROJECT_ID
```

The Amoy-only "ERC20 example" panel includes a WalletKit Dollar example using
the demo WKUSD contract deployed on Polygon Amoy.

Google/OIDC redirect sign-in uses the SDK default Google client id.

Build it from the repository root:

```bash
pnpm build
pnpm build:example
```
