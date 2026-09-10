# AGENTS.md

Single source of truth for agents working in this repo. `CLAUDE.md` imports this file via
`@AGENTS.md`, so Claude Code, Codex, and any other agent that reads `AGENTS.md` share the same
instructions.

---

## Working Principles

- State assumptions when ambiguity affects implementation, public API, security, or release behavior.
- Keep changes surgical and traceable to the request. Avoid speculative abstractions, broad refactors, and formatting churn.
- Preserve user work in the tree and match the local style of the files you touch.
- Define success criteria for non-trivial work and choose verification proportional to the risk.

---

## Third-Party Library Docs

For non-trivial or version-sensitive third-party library questions (`viem`, `vitest`, `@auth0/auth0-react`, etc.),
prefer context7 or official documentation over training-data recall. If context7 is unavailable,
use official docs or local package types and note the fallback; do not block ordinary repo work just
to install extra tooling.

---

## Project Overview

This repository is a pnpm workspace for the OMS Wallet TypeScript SDK. The workspace root is a private, non-published package that only orchestrates the workspace; the publishable `@polygonlabs/oms-wallet` library lives in `packages/oms-wallet` and is used by the React and Node examples. The SDK covers wallet authentication, OIDC redirect auth, signed WaaS requests, wallet/session storage, transaction submission, signing, access management, and indexer balance queries.

## Skills

Repo-local agent skills live under `.agents/skills/` (agent-neutral); `.claude/skills` is a symlink to it so Claude Code auto-registers them. Codex and other agents that read this file should consult them directly:

- **[`.agents/skills/changeset-commit/SKILL.md`](.agents/skills/changeset-commit/SKILL.md)** — decide whether a change needs a changeset, compose it as a user-facing changelog entry, and land it in the same commit as the code. Consult it before running `git commit`; the release flow itself is in `PUBLISHING.md`.

## Setup and Tooling

- Use Node `22`. `.nvmrc` and GitHub Actions target that major version.
- Use pnpm `11.1.3`, matching the `packageManager` field and GitHub Actions setup.
- Install dependencies from the repo root with `pnpm install --frozen-lockfile` when validating CI parity.
- Run workspace commands from the repo root. SDK-scoped scripts (build, test, type checks, API checks) live in `packages/oms-wallet` and are run from the root with `pnpm --filter @polygonlabs/oms-wallet <script>` (or from inside that package). The root `build` and `test` scripts delegate to the SDK package for convenience.

## Repository Layout

- `packages/oms-wallet/`: The publishable `@polygonlabs/oms-wallet` SDK package (source, tests, type tests, docs, API baseline, and SDK build scripts).
- `packages/oms-wallet/src/index.ts`: Public SDK export surface. Keep public API changes intentional and reflected in docs and type tests when applicable.
- `packages/oms-wallet/src/omsWallet.ts`: Top-level `OMSWallet` composition for wallet and indexer clients.
- `packages/oms-wallet/src/clients/walletClient.ts`: Main wallet/auth/signing/transaction/access implementation.
- `packages/oms-wallet/src/clients/indexerClient.ts`: Indexer balance client and HTTP error wrapping.
- `packages/oms-wallet/src/generated/waas.gen.ts`: Generated WaaS client and types.
- `packages/oms-wallet/src/credentialSigner.ts`, `packages/oms-wallet/src/signedFetch.ts`, `packages/oms-wallet/src/storageManager.ts`: Credential, request-signing, and persistence boundaries.
- `packages/oms-wallet/src/utils/` and `packages/oms-wallet/src/types/`: Shared SDK helpers and exported type definitions.
- `packages/oms-wallet-wagmi-connector/`: ESM-only `@polygonlabs/oms-wallet-wagmi-connector` package for using an
  active OMS Wallet SDK instance as a wagmi connector.
- `packages/oms-wallet/tests/`: Vitest coverage for wallet, OIDC, transactions, signing, access, indexer, and errors.
- `packages/oms-wallet/type-tests/`: Compile-time API tests.
- `examples/react/`: Vite React demo that consumes the SDK through the workspace.
- `examples/custom-google-redirect/`: Local-only Vite React demo for Google as a custom OIDC provider with a localhost redirect URI.
- `examples/custom-auth0-id-token/`: Local-only Vite React demo that passes an Auth0-issued ID token to OMS Wallet.
- `examples/wagmi/`: Vite React wagmi demo using the OMS Wallet connector and MetaMask connector.
- `examples/trails-actions/`: Vite React demo for Trails swap, Earn deposit, and Earn withdrawal flows.
- `examples/node/`: Interactive Node OTP/signing example.
- `examples/node-contract-deploy-example/`: Interactive Node ERC-20 deployment example.
- `examples/privy-import-worker/`: Cloudflare Worker used by the local and deployed React examples
  to create and immediately HPKE-export disposable Privy wallets without exposing Privy secrets.
- `examples/shared/`: Private `oms-example-shared` workspace package — shared browser-example design tokens, base styles, components, utilities, and Vite aliases. Declares its own `@polygonlabs/oms-wallet` and `react` dependencies so its source resolves inside each example build.
- `examples/smart-session/`: Cloudflare Worker, D1 migrations, wallet-owner approval app, and admin dashboard demonstrating isolated backend-owned RACs with Polygon Amoy and mainnet smart sessions.
- `packages/oms-wallet/docs/error-contracts.md`: Public error contract matrix and expectations.
- `packages/oms-wallet/docs/session-expiry-flow.md`: Session expiry, reauthentication, and related wallet behavior notes.
- `packages/oms-wallet/scripts/write-esm-package.cjs`: Writes `dist/esm/package.json` during the SDK build.
- `packages/oms-wallet/scripts/check-public-api.cjs`: Compares built public declarations with the committed baseline and rejects generated WaaS type leaks.
- `.github/workflows/ci-trigger.yml`: CI on PRs — the shared `ci` composite (lint/typecheck/test), a build job (`pnpm build` + `pnpm check:exports`/publint), and a drift-check job (`codegen-drift-check`). Verification runs through standard named scripts, not a bespoke script.
- `scripts/stage-npm-packages.mjs`: CI-only staged-publishing helper that validates the fixed package set, packs with pnpm, checks packed manifests, and stages tarballs with npm OIDC.
- `.changeset/`: changesets config. The `fixed` group keeps `@polygonlabs/oms-wallet` and `@polygonlabs/oms-wallet-wagmi-connector` on the same version; releases are automated by the changesets release workflow.

## Commands

- `pnpm install --frozen-lockfile`: Install dependencies in CI-compatible mode.
- `pnpm exec changeset`: Add a changeset describing a change. Any PR that changes files inside a workspace package needs one (use `pnpm exec changeset add --empty` for changes with no consumer impact). The `fixed` group versions both publishable packages together.
- `pnpm --filter @polygonlabs/oms-wallet check:public-api`: Compare built declarations with the committed baseline and reject generated WaaS type leaks.
- `pnpm build`: Build both packages (dual CJS+ESM) and every example — the consumer-compatibility gate (examples resolve the workspace from source). Delegates via `pnpm -r --if-present run build`.
- `pnpm check:exports`: Run `publint` against both publishable packages to validate their `exports`/`main`/`module`/`types` resolve and are correctly formatted for npm consumers.
- `pnpm run typecheck` (or `pnpm --filter <pkg> typecheck`): Typecheck via `tsc -b` (source + SDK type-tests).
- `pnpm test`: Run the staged-publishing helper tests plus the SDK and connector test suites.
- `pnpm test:release`: Run the staged-publishing helper's fixed-group and manifest-validation tests.
- `pnpm --filter @polygonlabs/oms-wallet test:types`: Compile `type-tests/oidcProviderTypes.ts`; useful for public type/API changes.
- `pnpm build`: Build CJS and ESM SDK output under `packages/oms-wallet/dist/` (delegates to `@polygonlabs/oms-wallet`).
- `pnpm --filter @polygonlabs/oms-wallet-wagmi-connector build`: Build the wagmi connector package.
- `pnpm --filter @polygonlabs/oms-wallet-wagmi-connector test`: Run the wagmi connector package tests.
- `pnpm build:example`: Build the React example for Vite/GitHub Pages output after `pnpm build` has produced SDK output.
- `pnpm build:custom-google-redirect-example`: Build the local-only custom Google redirect React example.
- `pnpm build:custom-auth0-id-token-example`: Build the local-only Auth0 ID-token React example.
- `pnpm build:trails-actions-example`: Build the Trails Actions React example.
- `pnpm build:wagmi-example`: Build the wagmi React example.
- `pnpm build:node-example`: Typecheck the Node example.
- `pnpm build:node-contract-deploy-example`: Typecheck the Node contract deploy example.
- `pnpm build:privy-import-worker`: Typecheck and dry-run the Privy import Worker deployment.
- `pnpm build:smart-session-example`: Typecheck and build the smart-session client and dashboard assets.
- `pnpm dev:example`: Start the React demo dev server.
- `pnpm dev:custom-google-redirect-example`: Start the local custom Google redirect React demo dev server on port `5173`.
- `pnpm dev:custom-auth0-id-token-example`: Start the local Auth0 ID-token React demo dev server on port `5173`.
- `pnpm dev:trails-actions-example`: Start the Trails Actions React demo dev server.
- `pnpm dev:wagmi-example`: Start the wagmi React demo dev server.
- `pnpm dev:node-example`: Run the interactive Node OTP example.
- `pnpm dev:node-contract-deploy-example`: Run the interactive Node contract deploy example.
- `pnpm dev:privy-import-worker`: Run the Privy import Worker locally on port `8788`.
- `pnpm deploy:privy-import-worker`: Validate and deploy the Privy import Worker.
- `pnpm dev:smart-session-example`: Run the smart-session Worker, client app, and dashboard on ports `8787`, `5173`, and `5174`.
- `pnpm test:watch`: Run Vitest in watch mode during local development.

## Verification Workflow

For README/API/docs-only edits, use source-backed spot checks plus `git diff --check`; run compilers
or example builds only when the docs claim changed source behavior, public API shape, or runnable
example code.

1. Run the smallest relevant Vitest file or type check for the changed behavior.
2. Run `pnpm test` for SDK behavior changes.
3. Run `pnpm run typecheck` (`tsc -b`) before handing off source or public type changes.
4. Run `pnpm --filter @polygonlabs/oms-wallet test:types` directly when changing public generics, overloads, exported types, OIDC provider typing, or `packages/oms-wallet/src/index.ts`.
5. Run `pnpm --filter @polygonlabs/oms-wallet-wagmi-connector test` and `pnpm --filter @polygonlabs/oms-wallet-wagmi-connector build` when changing the wagmi connector package.
6. Run `pnpm build:node-example` when SDK exports, module resolution, or Node example usage changes.
7. Run `pnpm build` before release/build-output work or package entrypoint changes, and `pnpm check:exports` (publint) after it when entrypoints, `exports`, or the `files` set change. Example builds do not require a prior `pnpm build` — examples resolve the SDK from source via the `@polygonlabs/source` condition.
8. Run `pnpm --filter @polygonlabs/oms-wallet check:public-api` after `pnpm build` when changing SDK exports or public declarations.
9. Run `pnpm build:example` when changing the React example, Vite config, public browser API shape, or Pages deployment assumptions.
10. Run `pnpm build:custom-google-redirect-example` when changing the custom Google redirect example, OIDC redirect provider configuration, or browser callback assumptions.
11. Run `pnpm build:custom-auth0-id-token-example` when changing the Auth0 ID-token example, OIDC ID-token parameters, or Auth0 browser callback assumptions.
12. Run `pnpm build:trails-actions-example` when changing the Trails Actions example, shared browser example utilities, or Pages deployment assumptions.
13. Run `pnpm build:wagmi-example` when changing the wagmi example, connector browser usage, or Pages deployment assumptions.
14. Run `pnpm build:node-contract-deploy-example` when SDK exports, transaction APIs, module resolution, or the Node contract deploy example changes.

## Coding and Architecture Rules

- Source files under `packages/oms-wallet/src/` use explicit `.js` extensions in relative imports so emitted JavaScript resolves correctly. Preserve that pattern in SDK source.
- Treat `packages/oms-wallet/src/index.ts` and exported types as the public API gate. Export new public types or clients intentionally, and update `API.md`, `README.md`, and type tests when public behavior changes.
- Route wallet API calls through `WalletClient`, generated WaaS types, `createSignedFetch`, and `CredentialSigner` instead of duplicating signing or header logic.
- Use `StorageManager` abstractions for persistence-sensitive code. Browser storage and memory fallback behavior are part of the SDK contract.
- Preserve typed SDK error classes and `toOMSWalletError` behavior when wrapping network, generated-client, validation, session, and transaction-status failures.
- Keep supported network metadata and chain ID lookup going through `packages/oms-wallet/src/networks.ts`, `Networks`, `findNetworkById`, and `findNetworkByName` instead of ad hoc conversion.
- The TypeScript compiler is the enforced style gate. There is no separate lint or formatter command in the root scripts, so avoid broad formatting churn and match the local file style.
- **Build-free workspace consumption.** Both `@polygonlabs/oms-wallet` and `@polygonlabs/oms-wallet-wagmi-connector` expose their TypeScript source through the `@polygonlabs/source` export condition (alongside the compiled `dist/` targets), and each package's `publishConfig.exports` omits that condition so published npm packages expose only `dist/`. Workspace consumers resolve dependencies from source, not a built `dist/`:
  - **tsc** — the consumer's `tsconfig.lib.json` (connector) or `tsconfig.json` (examples) sets `customConditions: ["@polygonlabs/source"]`. This is why the connector no longer rebuilds the SDK first, and the examples no longer rebuild the connector — **do not reintroduce a `pnpm --dir ../oms-wallet build` / `pnpm --filter …connector build &&` prefix.**
  - **Vitest** — `ssr.resolve.conditions: ["@polygonlabs/source"]`.
  - **Vite (browser examples)** — `resolve.conditions: ["@polygonlabs/source", ...defaultClientConditions]`, importing `defaultClientConditions` from `vite`. rolldown-vite replaces rather than appends `resolve.conditions`, so the defaults must be preserved alongside the source condition; spreading Vite's exported defaults keeps the mode-sensitive `development`/`production` condition (a hardcoded list drops it, so dev builds get production bundles of deps like Lit).
  - Consumers compile the SDK's source, so their `lib` must satisfy the SDK's needs (the generated WaaS client uses `Error.cause` → `lib` must include `ES2022`). External npm consumers are unaffected (they use `dist`).
- **TypeScript is configured as the Nx three-tier `tsconfig` pattern**, adapted for this repo: `tsconfig.base.json` at the root owns the shared `compilerOptions`; the root `tsconfig.json` is a solution hub; each package has a hub `tsconfig.json` plus `tsconfig.lib.json` (build/typecheck). The SDK keeps its dual CJS + ESM emit (`tsconfig.lib.json` = CJS, `tsconfig.esm.json` = ESM) and a `tsconfig.spec.json` for its compile-time type-tests. **Deviations from the team template, driven by this repo:** the base does **not** extend `@tsconfig/node-ts` (its `erasableSyntaxOnly` rejects the enums in the generated Webrpc client, which can't be regenerated here) and does **not** set `declarationMap`; `customConditions` lives in the consumer configs, not the base (a CJS/`node10` config can't carry it). The vitest test files are run by Vitest (esbuild) and are **not** yet `tsc`-clean, so they are excluded from the `tsc` typecheck surface — `pnpm run typecheck` (`tsc -b`) covers source + the SDK type-tests. Bringing the tests to `tsc`-clean is a tracked follow-up.

## Example App Styling

- The browser examples (`examples/react`, `examples/custom-google-redirect`, `examples/custom-auth0-id-token`, `examples/wagmi`, `examples/trails-actions`) share one set of design tokens in `examples/shared/oms-tokens.css`, mirrored from `oms-sdk-design-system`'s `omsTokens`. Each example's `styles.css` imports it via `@import url("../../shared/oms-tokens.css")`.
- Reference the `--oms-*` CSS variables (colors, radius, typography, focus rings) for any example styling. Do not hardcode new hex/radius values in the per-app `styles.css` files; if a token is missing, add it to `examples/shared/oms-tokens.css` so all examples stay in sync. (The `.burn-button` fire gradient in the React example is an intentional decorative-effect exception, not a token.)
- When tokens change in `oms-sdk-design-system`, update `examples/shared/oms-tokens.css` to match rather than editing each example.

## Testing

See **[TESTING.md](./TESTING.md)** for testing conventions, unit vs. integration boundaries, and
execution commands.

### Testing Guidance

- Use `TESTING.md` as the source of truth for test boundaries and public error contract rules.
- Test promises, not implementation. Choose the cheapest reliable evidence for the risk.
- Prefer TypeScript checks for impossible states, Vitest tests for SDK behavior, type tests for public API constraints, and example builds for consumer compatibility.
- For auth, signing, transaction execution, access revocation, storage persistence, and error classification, add focused regression tests when externally visible behavior changes.

### Public Error Contract Tests

- Follow `TESTING.md` before adding or updating public error contract tests.
- Exercise public runtime APIs and mock only external boundaries.
- Snapshot stable public fields only; do not snapshot raw `cause`, stacks, generated internals, headers, timestamps, or full backend payloads.

## Generated Files and External Artifacts

- `packages/oms-wallet/src/generated/waas.gen.ts` is generated by Webrpc and marked `DO NOT EDIT`. Update the generated-client source of truth rather than hand-editing this file as normal source.
- The generated WaaS header records the upstream schema path and generation command. This repo does not currently include that schema; if regenerating the client, document the schema source and exact command used.
- The wagmi connector's SDK peer dependency is intentionally `workspace:^` in source and its SDK dev dependency is intentionally `workspace:*`. Release with pnpm so the published peer gets the compatible release range; do not hand-edit that peer to a literal version.
- `pnpm-lock.yaml` is the dependency lockfile. Update it through pnpm, not by hand.
- `dist/`, `examples/react/dist/`, `examples/custom-google-redirect/dist/`, `examples/custom-auth0-id-token/dist/`, `examples/wagmi/dist/`, `examples/trails-actions/dist/`, and `*.tsbuildinfo` files are build outputs and should not be edited as source.

## Security and Configuration

- Do not commit real secrets. `.env.local` and `.env.*.local` files are ignored for local overrides.
- The React example checks in its selectable sandbox publishable keys and defaults to Development. The custom Google redirect, wagmi, and Trails Actions examples use the same checked-in Development sandbox key.
- The wagmi React example uses its checked-in Trails API key.
- The Node contract deploy example uses `examples/node-contract-deploy-example/.env.example` for `OMS_PUBLISHABLE_KEY`; keep local overrides in `examples/node-contract-deploy-example/.env.local`.
- Treat credential signing, nonce handling, OIDC redirect state cleanup, session persistence, transaction execution/status polling, and access revocation as high-risk paths. Prefer focused regression tests for changes in these areas.
- GitHub Pages uses the checked-in example keys and does not require example-key secrets.

## Agent Workflow Rules

- Inspect the relevant source, tests, and docs before editing.
- Keep changes narrowly scoped; do not reformat or reorganize unrelated files.
- Preserve user changes in the working tree. Check `git status --short` before editing and before final handoff.
- Prefer approved repo patterns and public helpers, not merely repeated code.
- Use local legacy patterns only when needed for compatibility in the same area.
- Search before adding new exported types, utilities, storage keys, error codes, or API wrappers.
- Update tests and docs when public SDK behavior changes.
- Treat prompts, issues, docs, and examples as inputs to verify against code and tests.
- Do not claim success without running the relevant verification commands or explaining why a command was not run.

## Git Branch Naming

- Do not add a `codex/` prefix when creating git branches.
- Use plain, descriptive branch names such as `fix-login-timeout` or `add-wallet-tests`.
- Only use a branch prefix when the user explicitly asks for that exact prefix.

---

## Maintenance Matrix

| When this changes… | Also update… |
|---|---|
| Public API exported through `packages/oms-wallet/src/index.ts` or exported public types | `packages/oms-wallet/API.md`, `packages/oms-wallet/README.md`, `packages/oms-wallet/type-tests/oidcProviderTypes.ts` |
| Test commands (`package.json` scripts) | `TESTING.md`, `.github/workflows/ci-trigger.yml`, `AGENTS.md` Commands section |
| Node or pnpm version | `.nvmrc`, `package.json#packageManager`, `.github/workflows/*.yml` |
| New third-party dependency | `package.json`, `pnpm-lock.yaml`, third-party docs guidance in `AGENTS.md` |
| Publishable package versioning or workspace peer protocol | `PUBLISHING.md`, `.changeset/config.json`, `pnpm-lock.yaml` |
| `packages/oms-wallet/src/generated/waas.gen.ts` (regenerated) | Document schema source + regen command in PR description |
| Repo structure (new top-level dirs) | `AGENTS.md` Repository Layout section |
| Examples added or renamed | `pnpm-workspace.yaml`, root `package.json` scripts, `pages.yml` when deployed |
| Design tokens (`oms-sdk-design-system`) | `examples/shared/oms-tokens.css` (single source; examples import it — never hardcode hex/radius in per-app `styles.css`) |
