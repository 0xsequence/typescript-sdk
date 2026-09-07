# Smart Session Example

This example demonstrates multiple independently administered backend-owned Remote Access
Credentials (RACs), each serving smart sessions approved by multiple OMS wallets. The demo is
configured for POL and USDC transfers on Polygon Amoy; POL, USDC, and USDT transfers on Polygon
mainnet; and ETH and USDC transfers on Base and Base Sepolia.

The Worker accepts only this checked-in network and asset allowlist:

| Network | Assets |
| --- | --- |
| Polygon Amoy | Native POL, [USDC](https://amoy.polygonscan.com/token/0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582) |
| Polygon mainnet | Native POL, [USDC](https://polygonscan.com/token/0x3c499c542cef5e3811e1192ce70d8cc03d5c3359), [USDT](https://polygonscan.com/token/0xc2132d05d31c914a87c6611c10748aeb04b58e8f) |
| Base | Native ETH, [USDC](https://basescan.org/token/0x833589fcd6edb6e08f4c7c32d4f71b54bdA02913) |
| Base Sepolia | Native ETH, [USDC](https://sepolia.basescan.org/token/0x036cbd53842c5426634e7929541ec2318f3dcf7e) |

Polygon and Base mainnet assets have real value. Keep Polygon Amoy selected unless you intend to
create and execute a real mainnet permission.

Native permissions allow one specific receiver. ERC-20 permissions can allow one receiver,
multiple receivers through separate grants, or any receiver by omitting the grant's `to` field. For
specific ERC-20 receivers, the configured cumulative allowance applies separately to each receiver;
for any receiver, one cumulative allowance is shared across all transfers.

The workspace contains:

- a Cloudflare Worker API that owns the RACs, signs WaaS requests, and serves both frontends;
- a D1 database containing each RAC's approval workflow, minimal session associations, transaction
  records, and monotonic request nonces;
- a wallet-owner React app at `/` that approves and revokes smart sessions; and
- an admin React app that creates approval links, lists the authenticated RAC's active, revoked,
  and expired session records, dismisses terminal records from the session list, and submits
  permitted transactions. Local development serves it at `/dashboard/`; a Cloudflare deployment
  serves it at the root of its own dashboard hostname.

The owner app uses the Indexer to show the authenticated wallet's positive native and ERC-20
balances across all indexed mainnets and testnets, including indexed token icons and USD values when
available. It uses WaaS `ListAccess` to show every active remote session for that wallet. The
dashboard only shows sessions completed through this backend. The Worker uses the RAC's
`ListSessions`, `GetSession`, and `GetSessionUsage` APIs for authoritative live session details and
remaining allowances; D1 retains the approval and transaction history. WaaS and the on-chain
session contracts remain the final authority for transaction execution. The wallet address posted
by the owner app is retained only for dashboard display and Indexer balance lookup; transactions use
the authoritative wallet ID returned by `GetSession`.

The wallet settings menu also includes a one-time Trails automation. Enabling **Auto-convert USDT**
immediately checks the wallet and then watches for a positive Polygon USDT balance. Once detected,
it quotes and attempts to convert the wallet's full available Polygon USDT balance to Base USDC,
shows the route and transaction progress, and turns itself off after that first attempt whether it
succeeds or fails. Re-enable it for another conversion. The owner app must remain open and signed in
while it is armed or running. This uses mainnet assets with real value, and small balances can be
rejected when the route fees exceed the amount being converted.

## Local setup

From the repository root:

```bash
pnpm install
cd examples/smart-session
```

No local secrets are required. On first use in each browser profile, the dashboard generates an
admin token and persists it in browser local storage while the Worker stores only its hash in D1.
That token identifies an independent backend RAC and scopes all of its approval requests, smart
sessions, and transactions. The authenticated dashboard then asks the Worker to generate that RAC's
key, which this demo stores in local D1.

The checked-in Development sandbox publishable key is configured in `wrangler.jsonc`. Replace it
there when testing another WaaS project or environment.

Start all three processes. The `predev` hook initializes or updates local D1 before building the
apps:

```bash
pnpm dev
```

If you initialized D1 with an older version of the example schema, delete the example's local
`.wrangler/state/v3/d1` directory before running `pnpm dev` again. Remote schema changes require a
new migration after deployment. Network and asset additions do not change the schema: the Worker's
runtime configuration is the allowlist, while D1 stores the validated identifiers as text.

Open:

- client approval app: <http://localhost:5173/> (normally opened through an approval link);
- admin dashboard: <http://localhost:5174/dashboard/>; and
- Worker API and production-style static routes: <http://localhost:8787/>.

The Vite apps proxy `/api/*` to the Worker on port `8787`.
The client route also works without an approval link: it restores the current wallet session, shows
its non-zero native and ERC-20 balances across indexed EVM networks, lists approved smart sessions,
and allows the owner to copy the full wallet address or sign out. Wallet owners can sign in with
Google, Apple, or an email verification code, matching the main React example.

## Test the flow

1. Open the dashboard and select **Initialize admin + RAC**. The browser persists its generated
   admin access while the Worker persists the generated RAC key in D1 and registers its RAC
   credential ID with WaaS.
2. Select a network and asset, create an approval request, and copy its generated link. Native ETH
   is available on Base and Base Sepolia, USDC is available on all four configured networks, and
   USDT is available only on Polygon mainnet. Pending requests retain a **Copy link** action after the
   dashboard refreshes.
3. Open the link in the client app, sign in to an Ethereum wallet, review the exact permission, and
   approve or reject it.
4. Return to the dashboard. While a non-expired request is pending, it refreshes the overview every
   10 seconds when visible. A rejected request is recorded without creating a session. Once approved,
   the new wallet/session association, authoritative grants and usage, and current selected-asset
   balance appear under backend smart sessions.
5. Fund that smart wallet with the selected asset if needed, then submit a transfer from the session
   card.
6. The dashboard polls pending transactions and links executed transactions to the selected
   network's explorer.
7. The wallet owner can revoke an active session directly through WaaS. The dashboard observes the
   revocation through the backend RAC's session APIs and preserves the local association as history
   without offering transaction controls. Revoked and expired session cards can be dismissed from
   the session list without removing their approval or transaction history.

The RAC registration lasts 30 days. Session requests cannot extend beyond that credential expiry.
The Worker registers the persisted RAC key again after its current credential expires. Existing
sessions remain bound to the previous credential and are no longer shown as usable.
Use **Rotate backend RAC** in the dashboard to revoke that dashboard's current credential and
immediately generate and register a new one. Rotation makes sessions authorized for the previous
credential unusable and clears only that RAC's stored approval requests, smart sessions,
transaction records, and nonce. Other dashboard administrators and their RACs are unaffected.

## Deploy to Cloudflare

The deployment uses one Worker and one D1 database behind two Cloudflare custom domains. The wallet
hostname serves the public owner app and approval APIs; the dashboard hostname serves the
RAC-scoped admin app and admin APIs. The Worker rejects each surface's APIs on the other hostname
and does not expose a `workers.dev` or preview URL.

From a checkout of the branch, install the pinned workspace dependencies and enter this example:

```bash
pnpm install --frozen-lockfile
cd examples/smart-session
```

Create the D1 database once:

```bash
pnpm db:create:remote
```

Copy the deployment environment template. Replace the two example origins and zero database ID
with the HTTPS custom domains and the D1 UUID returned by Wrangler:

```bash
cp .env.cloudflare.example .env.cloudflare.local
```

The local file is ignored by Git and contains no application secret. `pnpm deploy:prepare`
validates all three values and generates an ignored Wrangler configuration containing the D1
binding and both custom-domain routes. Placeholder domains, non-HTTPS origins, paths, duplicate
origins, and the zero D1 ID are rejected.

Build and inspect the complete Worker upload without changing Cloudflare, apply the initial schema,
and deploy:

```bash
pnpm deploy:dry-run
pnpm db:migrate:remote
pnpm deploy
```

For subsequent manual deployments from the same machine, pull the branch, install dependencies if
the lockfile changed, and run `pnpm deploy` again. The existing D1 data, bindings, and custom
domains remain in place. Run `pnpm db:migrate:remote` first only when the branch adds a new D1
migration. On a fresh machine, recreate `.env.cloudflare.local` with the same two origins and D1
database ID before deploying.

The deploy command attaches both custom domains to the same Worker, so they must belong to a zone
available to the deployer's Cloudflare account and must not conflict with existing DNS records.
After deployment, open the configured wallet and dashboard origins and check `/health` on either
hostname.

Each browser profile that opens the public dashboard can initialize its own admin access and
independent RAC. It cannot access another browser's RAC without that browser's random admin token,
but an untrusted visitor can still consume D1 storage and WaaS API quota by creating its own RAC and
approval requests. Add Cloudflare Access later if that operational exposure becomes undesirable.
The plaintext RAC storage is appropriate only for this demo; a production backend must use
encrypted key storage or a managed secret store. Approval-request tokens are bearer credentials,
and this demo also stores them in plaintext so the dashboard can redisplay approval links. A
production backend should store only their hashes and return each link once, or encrypt the tokens
at rest and strictly limit access to them.
See Cloudflare's official
[static assets](https://developers.cloudflare.com/workers/static-assets/),
[D1](https://developers.cloudflare.com/d1/), and deployment documentation for account and
environment configuration.
