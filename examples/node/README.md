# Node Example

This example consumes the SDK as a workspace package:

```ts
import { MemoryStorageManager, OMSClient } from 'typescript-sdk'
```

Run it from the repository root:

```bash
pnpm install
pnpm build
pnpm dev:node-example
```

The example prompts for an email address, sends an OTP code, then prompts for the code.

You can typecheck the example directly:

```bash
pnpm build:node-example
```
