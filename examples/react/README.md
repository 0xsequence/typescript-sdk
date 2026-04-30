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

Optional Google/OIDC redirect sign-in:

```bash
OMS_GOOGLE_CLIENT_ID=your-google-client-id pnpm dev:example
```

For relay redirect testing, also set:

```bash
OMS_OIDC_RELAY_REDIRECT_URI=http://localhost:8090/callback
```

Build it from the repository root:

```bash
pnpm build
pnpm build:example
```
