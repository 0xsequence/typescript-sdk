# Node Example

This example consumes the SDK as a workspace package:

```ts
import { MemoryStorageManager, Networks, OMSClient } from '@0xsequence/typescript-sdk'
```

Run it from the repository root:

```bash
pnpm install
pnpm build
OMS_PUBLISHABLE_KEY=your-publishable-key OMS_PROJECT_ID=your-project-id pnpm dev:node-example
```

The example prompts for an email address, sends an OTP code, then prompts for the code.

You can typecheck the example directly:

```bash
pnpm build:node-example
```
