# TESTING.md

How testing works in this repo. `AGENTS.md` points here so agents know how to verify changes.

## Frameworks & tools

- **Test runner:** [Vitest](https://vitest.dev/) v4+
- **Type tests:** `tsc --noEmit` (compile-time API assertions in `type-tests/`)
- **No coverage enforcement** currently — focus is on behavioral correctness
- **Environment:** `dotenv` loaded via `vitest.config.ts`; tests run serially (`fileParallelism: false`)

## Unit tests

- **Scope:** SDK behavior with stubbed/mocked network boundaries. Tests assert public wallet/indexer
  behavior, request payloads, error mapping, OIDC state handling, pagination, transaction status,
  and type-level API contracts — not internal implementation details.
- **Location:** `tests/**/*.ts`
- **Run:** `pnpm exec vitest run` (or `pnpm test` which runs this then type tests)
- **Package tests:** `packages/oms-wallet-wagmi-connector/tests/**/*.ts` run from that package with
  `pnpm --filter @0xsequence/oms-wallet-wagmi-connector test`

## Integration / type tests

- **Scope:** Compile-time API contract tests — verify that exported TypeScript types match
  expected shapes. These catch public API regressions that runtime tests cannot.
- **Location:** `type-tests/oidcProviderTypes.ts`
- **Run:** `pnpm test:types`
- **Note:** A few tests in `tests/` seed private wallet state via `(wallet as any)` for legacy
  compatibility. Use public methods or small fixtures for any new test coverage.

## When to run what

| Scenario | Command |
|---|---|
| Changed publishable package versions | `pnpm check:package-versions` |
| Changed SDK behavior | `pnpm exec vitest run` |
| Changed wagmi connector behavior | `pnpm --filter @0xsequence/oms-wallet-wagmi-connector test` |
| Changed wagmi connector types/build | `pnpm --filter @0xsequence/oms-wallet-wagmi-connector build` |
| Changed wagmi React example | `pnpm build:wagmi-example` |
| Changed public types / `src/index.ts` | `pnpm test:types` |
| Full pre-handoff check | `pnpm exec tsc --noEmit && pnpm test` |
| Watch mode during development | `pnpm test:watch` |
| High-risk paths (auth, signing, tx, storage) | Add a focused regression test, then `pnpm test` |

## Conventions

- Test filenames match the module they cover: `walletClient.ts` → `walletClient.test.ts`
- Bug fixes should include a regression test that would have caught the bug
- Do not add tests that assert private implementation — test the externally visible promise
- Network boundaries are stubbed; don't require live secrets for `pnpm test`
- Integration tests that need `OMS_PROJECT_ACCESS_KEY` are gated behind the CI secret; they
  may be skipped locally when the env var is absent

### Public error contract tests

- Use `docs/error-contracts.md` as the audit matrix for public SDK/connector error surfaces,
  recovery semantics, `upstreamError` expectations, and owning tests.
- Exercise real public runtime APIs such as `oms.wallet.*`, `oms.indexer.*`, exported storage
  managers, signers, or wagmi connector/provider methods.
- Do not snapshot manually constructed `OmsSdkError` subclasses unless the error class or helper
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
| Typecheck (no emit) | `pnpm exec tsc --noEmit` |
| Watch mode | `pnpm test:watch` |
