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

## Execution summary

| Goal | Command |
|---|---|
| Run unit tests | `pnpm exec vitest run` |
| Run type tests | `pnpm test:types` |
| Run everything | `pnpm test` |
| Typecheck (no emit) | `pnpm exec tsc --noEmit` |
| Watch mode | `pnpm test:watch` |
