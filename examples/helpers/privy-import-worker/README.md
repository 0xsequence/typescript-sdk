# Privy Import Worker Example

This Cloudflare Worker creates a disposable Privy Ethereum wallet and immediately exports it with
HPKE to an OMS recipient public key. The operation is stateless: the generated Privy authorization
private key exists only while that request runs.

The Worker accepts requests from the local React example at `http://localhost:5173` and its GitHub
Pages deployment at `https://0xpolygon.github.io`. A Cloudflare rate-limit binding limits each client
to five disposable wallets per minute.

Copy `.dev.vars.example` to `.dev.vars` and add a Privy app ID and secret to run it locally:

```bash
pnpm dev:privy-import-worker
```

Set `PRIVY_APP_ID` and `PRIVY_APP_SECRET` with `wrangler secret put` before deploying:

```bash
pnpm --dir examples/helpers/privy-import-worker exec wrangler secret put PRIVY_APP_ID
pnpm --dir examples/helpers/privy-import-worker exec wrangler secret put PRIVY_APP_SECRET
pnpm deploy:privy-import-worker
```

The deployed URL is intentionally public because the GitHub Pages example calls it from the
browser. Do not use the Worker or its Privy app for real wallets.
