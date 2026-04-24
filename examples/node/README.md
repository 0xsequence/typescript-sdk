# Node Example

This example consumes the SDK as a workspace package:

```ts
import { MemoryStorageManager, OMSClient } from 'typescript-sdk'
```

Run it from the repository root:

```bash
pnpm install
pnpm build
pnpm node-example
```

The example prompts for an email address, sends an OTP code, then prompts for the code.

You can also run the example directly:

```bash
pnpm dev:node-example
pnpm build:node-example
```
