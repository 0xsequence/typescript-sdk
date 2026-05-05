# React Example

This example consumes the SDK as a workspace package:

```ts
import { OMSClient } from 'typescript-sdk'
```

Run it from the repository root:

```bash
pnpm install
pnpm build
pnpm dev:example
```

The dev server runs at `http://localhost:5173`.

The example includes defaults for the demo project access key and Google client id.
To override them locally:

```bash
cp examples/react/.env.example examples/react/.env.local
```

Google/OIDC redirect sign-in uses a local example override for the deployed demo WaaS host.
The SDK default Google client id remains unchanged.

Build it from the repository root:

```bash
pnpm build
pnpm build:example
```
