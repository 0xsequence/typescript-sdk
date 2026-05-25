# Trails Actions React Example

This Vite React app uses the TypeScript SDK wallet client with Trails actions on Polygon:

- Swap POL to USDC
- Deposit USDC using Earn
- Swap POL to USDC and deposit USDC in one prepared Trails transaction

Run it from the repository root:

```bash
pnpm install
pnpm build
cp examples/trails-actions/.env.example examples/trails-actions/.env.local
# Fill VITE_OMS_PUBLIC_API_KEY and VITE_OMS_PROJECT_ID
pnpm dev:trails-actions-example
```

The dev server runs at `http://localhost:5173`.

The deployed example is available at `https://0xsequence.github.io/typescript-sdk/trails-actions-example`.

The OMS project used by the environment values must support Polygon.

Build it from the repository root:

```bash
pnpm build
pnpm build:trails-actions-example
```
