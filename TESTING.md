# TESTING.md

How testing works in this repo. `AGENTS.md` points here so agents know how to verify changes.

> The SDK lives in `packages/oms-wallet`. Paths below (`tests/`, `type-tests/`, `src/`) are relative
> to that package, and SDK-scoped commands (`vitest`, `tsc --noEmit`, `test:types`) run either from
> inside `packages/oms-wallet` or from the repo root with `pnpm --filter @polygonlabs/oms-wallet …`.
> The root `pnpm test` runs the release-helper unit tests, then delegates to both publishable
> packages.

## Frameworks & tools

- **Test runner:** [Vitest](https://vitest.dev/) v4+
- **Type tests:** `tsc --noEmit` (compile-time API assertions in `type-tests/`)
- **Packaged API check:** TypeScript AST comparison of built declarations with a committed public API baseline
- **No coverage enforcement** currently — focus is on behavioral correctness
- **Environment:** `dotenv` loaded via `vitest.config.ts`; tests run serially (`fileParallelism: false`)

## Unit tests

- **Scope:** SDK behavior with stubbed/mocked network boundaries. Tests assert public wallet/indexer
  behavior, request payloads, error mapping, OIDC state handling, pagination, transaction status,
  and type-level API contracts — not internal implementation details.
- **Location:** `tests/**/*.ts`
- **Run:** `pnpm exec vitest run` (or `pnpm test` which runs this then type tests)
- **Package tests:** `packages/oms-wallet-wagmi-connector/tests/**/*.ts` run from that package with
  `pnpm --filter @polygonlabs/oms-wallet-wagmi-connector test`
- **Release helper:** `scripts/stage-npm-packages.test.mjs` uses Node's built-in test runner to
  validate fixed-package and packed-manifest safeguards without contacting npm

## Integration / type tests

- **Scope:** Compile-time API contract tests — verify that exported TypeScript types match
  expected shapes. These catch public API regressions that runtime tests cannot.
- **Location:** `type-tests/oidcProviderTypes.ts`
- **Run:** `pnpm test:types`
- **Note:** A few existing tests in `tests/` seed private wallet state via `(wallet as any)` to
  exercise established session fixtures. Use public methods or small fixtures for new coverage.

## When to run what

| Scenario | Command |
|---|---|
| Any change inside a workspace package | `pnpm exec changeset` (or `--empty` if non-shippable) |
| Verifying a release-affecting change | `pnpm lint && pnpm test && pnpm build && pnpm check:exports` |
| Changed staged-publishing logic | `pnpm test:release` plus a local `pnpm pack` manifest inspection |
| Changed SDK behavior | `pnpm --filter @polygonlabs/oms-wallet exec vitest run` |
| Changed wagmi connector behavior | `pnpm --filter @polygonlabs/oms-wallet-wagmi-connector test` |
| Changed wagmi connector types/build | `pnpm --filter @polygonlabs/oms-wallet-wagmi-connector build` |
| Changed React example | `pnpm build:example` |
| Changed Trails Actions example | `pnpm build:trails-actions-example` |
| Changed wagmi React example | `pnpm build:wagmi-example` |
| Changed Node example | `pnpm build:node-example` |
| Changed Node contract deploy example | `pnpm build:node-contract-deploy-example` |
| Changed public types / `src/index.ts` | `pnpm test:types` |
| Changed built declarations or package exports | `pnpm build && pnpm check:public-api` |
| Full pre-handoff check | `pnpm exec tsc --noEmit && pnpm test` |
| Watch mode during development | `pnpm test:watch` |
| High-risk paths (auth, signing, tx, storage) | Add a focused regression test, then `pnpm test` |

## Conventions

- Test filenames should make their public behavior area clear. Broad clients may be split across focused files such as `walletSession.test.ts`, `walletTransactions.test.ts`, `walletSigning.test.ts`, and `walletAccess.test.ts`.
- Bug fixes should include a regression test that would have caught the bug
- Do not add tests that assert private implementation — test the externally visible promise
- Network boundaries are stubbed; don't require live secrets for `pnpm test`

### Public error contract tests

- Use `docs/error-contracts.md` as the audit matrix for public SDK/connector error surfaces,
  recovery semantics, `upstreamError` expectations, and owning tests.
- Exercise real public runtime APIs such as `omsWallet.wallet.*`, `omsWallet.indexer.*`, exported storage
  managers, signers, or wagmi connector/provider methods.
- Do not snapshot manually constructed `OMSWalletError` subclasses unless the error class or helper
  is the unit under test.
- Mock only external boundaries: `fetch`, browser globals, storage availability, signer behavior,
  timers, or backend responses.
- Snapshot only stable public fields: `name`, `code`, `operation`, `message`, `status`,
  `retryable`, `txnId`, and `upstreamError`.
- Do not snapshot `stack`, raw `cause`, generated WebRPC internals, request headers, timestamps,
  or full backend payloads.
- Keep backend/upstream mapping tests representative rather than exhaustive per method; cover
  each transport family through real public calls.
- Include `upstreamError` only when the tested path truthfully crosses a remote service or
  transport boundary; SDK-local failures should assert no `upstreamError`.
- Snapshot changes are not automatically regressions. Decide whether the new error shape is the
  intended public contract: if correct, update the snapshot and any related docs/type tests; if
  accidental, fix the implementation. Never update snapshots blindly.
- Treat `code` and `operation` as stronger contract fields than `message`. Message changes are
  allowed when intentional, but they should be reviewed as user-visible API/UX changes.
- `upstreamError` is normalized diagnostic detail from a remote OMS service response or transport
  failure. Application logic should usually branch on the SDK-level `code`.
- `retryable` describes the failed SDK operation, not the whole user intent. A retryable status
  lookup failure does not mean a transaction write should be blindly resent.

## Execution summary

| Goal | Command |
|---|---|
| Run unit tests | `pnpm exec vitest run` |
| Run type tests | `pnpm test:types` |
| Run everything | `pnpm test` |
| Run release-helper tests | `pnpm test:release` |
| Typecheck (no emit) | `pnpm exec tsc --noEmit` |
| Check packaged declarations | `pnpm check:public-api` |
| Watch mode | `pnpm test:watch` |
