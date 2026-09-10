# OMS Wallet TypeScript SDK

Build **non-custodial EVM wallet experiences in TypeScript** with OMS Wallet — email and OIDC
sign-in, session restore, message signing, transaction submission, and token-balance queries —
without your app ever holding a private key. This repository is the source of truth for the OMS
Wallet SDK and its official [wagmi](https://wagmi.sh) connector: it exists so web and Node
applications can integrate an OMS embedded wallet from a single, versioned, typed package set
instead of re-implementing WaaS auth, request signing, and session handling by hand.

It is a **pnpm workspace**. The root is a private orchestrator (not published); the shippable code
lives in `packages/`, and `examples/` holds runnable browser and Node demos that consume the
packages exactly as an external app would.

## Packages

| Package | Published as | What it does |
|---|---|---|
| [`packages/oms-wallet`](packages/oms-wallet) | [`@polygonlabs/oms-wallet`](https://www.npmjs.com/package/@polygonlabs/oms-wallet) | The core SDK — email/OIDC authentication, WaaS request signing, wallet/session storage, transaction submission and status polling, signing, access management, and indexer balance queries. Ships dual CJS + ESM for browser and Node consumers. |
| [`packages/oms-wallet-wagmi-connector`](packages/oms-wallet-wagmi-connector) | [`@polygonlabs/oms-wallet-wagmi-connector`](https://www.npmjs.com/package/@polygonlabs/oms-wallet-wagmi-connector) | Adapts an active `@polygonlabs/oms-wallet` instance as a [wagmi](https://wagmi.sh) connector, so existing wagmi apps can use OMS Wallet as a connection option. |

Both packages release **in lockstep** (a changesets `fixed` group), so they always share a version.

## Getting started (contributors)

```bash
pnpm install --frozen-lockfile
pnpm lint && pnpm test && pnpm build   # the same checks CI runs
```

Common workspace commands (run from the repo root):

```bash
pnpm lint                     # eslint + markdownlint + prettier + typecheck
pnpm typecheck                # tsc -b across the packages
pnpm test                     # SDK + connector test suites (pnpm -r)
pnpm build                    # build packages (dual CJS+ESM) + all examples (pnpm -r)
pnpm check:exports            # publint on the publishable packages
pnpm dev:example              # run a browser example
pnpm build:privy-import-worker # validate the Privy test-wallet Worker
pnpm dev:smart-session-example # run the Worker + approval app + admin dashboard
```

The React example uses the deployed
[`examples/helpers/privy-import-worker`](examples/helpers/privy-import-worker)
Cloudflare Worker to create and HPKE-export disposable Privy wallets from both localhost and GitHub
Pages. Privy credentials remain in Worker secrets and generated wallet authorization keys are never
persisted.

The Cloudflare-deployable [`examples/smart-session`](examples/smart-session) workspace demonstrates
independently administered backend-owned RACs serving smart sessions approved by multiple owner
wallets. It supports native POL transfers on Polygon Amoy and POL, USDC, and USDT transfers on
Polygon mainnet, with recipient-scoped permissions, indexed balances, and a Trails conversion.

Workspace packages resolve each other from **source** (via the `@polygonlabs/source` export
condition), so no package needs to be built before its consumers — `pnpm test` and `pnpm build` run
from a clean checkout with no prior build. See [`AGENTS.md`](AGENTS.md) for the full architecture,
TypeScript setup, and conventions.

## Releases & publishing — CI only

> **Publishing is fully automated in CI. Never publish from a local machine.** Do not run
> `changeset version` or `changeset publish` (or `npm`/`pnpm publish`) yourself — a local publish
> bypasses CI, the signed release commit, and npm OIDC provenance. There are deliberately no
> `release` / `publish` package scripts.

The flow, end to end:

1. Every PR that changes a package includes a **changeset** (`pnpm exec changeset`, or
   `pnpm exec changeset add --empty` for no-release changes) committed alongside the code.
2. Merging changesets to `master` opens a **`changesets: Release / Deploy`** PR that bumps both
   packages and updates their changelogs.
3. Merging that PR triggers CI to **publish to npm via OIDC trusted publishing**, tag the release,
   and create a GitHub Release — no human runs a publish command.

### Snapshot / prerelease publishes

To ship a **throwaway prerelease** under a non-`latest` npm dist-tag — e.g. so a downstream app can
install a build ahead of the real release — trigger the same **Release** workflow manually
(still CI, still no local publish):

1. GitHub → **Actions** → **Release** → **Run workflow**.
2. Set **`snapshot_tag`** to a **non-semver** dist-tag (e.g. `canary`, `pre-0.3.0`). A semver-shaped
   value like `0.3.0` is rejected — the snapshot path skips the git tag and GitHub Release, so a real
   version string must never be used here.
3. CI runs `changeset version --snapshot <tag>` on the runner (never committed) and publishes under
   that dist-tag via OIDC. Consumers install it with `pnpm add @polygonlabs/oms-wallet@<tag>`.

This never creates a git tag or GitHub Release; the normal `master` flow above stays the only way to
cut a real version.

Full details are in [`PUBLISHING.md`](PUBLISHING.md). Changeset authoring guidance lives in the
[`changeset-commit`](.agents/skills/changeset-commit/SKILL.md) agent skill.

## Contributing

- Follow the conventions in [`AGENTS.md`](AGENTS.md) (imported by `CLAUDE.md` for Claude Code; read
  natively by Codex and other agents).
- Every package-touching PR needs a changeset (see above); the `Changeset check` CI job enforces it.
- Testing conventions and commands are in [`TESTING.md`](TESTING.md).
