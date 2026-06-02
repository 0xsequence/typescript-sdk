# AGENTS.md

Single source of truth for agents working in this repo. `CLAUDE.md` imports this file via
`@AGENTS.md`, so Claude Code, Codex, and any other agent that reads `AGENTS.md` share the same
instructions.

---

## Behavioral Guidelines

Behavioral guidelines to reduce common LLM coding mistakes. (Adapted from Andrej Karpathy's
[CLAUDE.md](https://github.com/multica-ai/andrej-karpathy-skills/blob/main/CLAUDE.md).)

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding
**Don't assume. Don't hide confusion. Surface tradeoffs.**
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First
**Minimum code that solves the problem. Nothing speculative.**
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes
**Touch only what you must. Clean up only your own mess.**
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- Remove imports/variables YOUR changes made unused; leave pre-existing dead code unless asked.

The test: every changed line should trace directly to the request.

### 4. Goal-Driven Execution
**Define success criteria. Loop until verified.**
- "Add validation" → "Write tests for invalid inputs, then make them pass."
- "Fix the bug" → "Write a test that reproduces it, then make it pass."

For multi-step tasks, state a brief plan with a verify step for each item.

---

## Third-Party Library Docs

For **any third-party library** (`viem`, `vitest`, etc.), use the **context7** MCP to fetch
up-to-date documentation rather than relying on training data, which lags real library APIs. If
the context7 MCP server is not available, set it up: https://context7.com/install

---

## Project Overview

This repository is a pnpm workspace for the OMS TypeScript SDK. The root package exports the `@0xsequence/typescript-sdk` library used by the React and Node examples. The SDK covers wallet authentication, OIDC redirect auth, signed WaaS requests, wallet/session storage, transaction submission, signing, access management, and indexer balance queries.

## Setup and Tooling

- Use Node `22`. `.nvmrc` and GitHub Actions target that major version.
- Use pnpm `11.1.3`, matching the `packageManager` field and GitHub Actions setup.
- Install dependencies from the repo root with `pnpm install --frozen-lockfile` when validating CI parity.
- Run workspace commands from the repo root unless you are intentionally working inside a package-specific script.

## Repository Layout

- `src/index.ts`: Public SDK export surface. Keep public API changes intentional and reflected in docs and type tests when applicable.
- `src/omsClient.ts`: Top-level `OMSClient` composition for wallet and indexer clients.
- `src/clients/walletClient.ts`: Main wallet/auth/signing/transaction/access implementation.
- `src/clients/indexerClient.ts`: Indexer balance client and HTTP error wrapping.
- `src/generated/waas.gen.ts`: Generated WaaS client and types.
- `src/credentialSigner.ts`, `src/signedFetch.ts`, `src/storageManager.ts`: Credential, request-signing, and persistence boundaries.
- `src/utils/` and `src/types/`: Shared SDK helpers and exported type definitions.
- `tests/`: Vitest coverage for wallet, OIDC, transactions, signing, access, indexer, and errors.
- `type-tests/`: Compile-time API tests.
- `examples/react/`: Vite React demo that consumes the SDK through the workspace.
- `examples/node/`: Interactive Node OTP/signing example.
- `scripts/write-esm-package.cjs`: Writes `dist/esm/package.json` during the root build.

## Commands

- `pnpm install --frozen-lockfile`: Install dependencies in CI-compatible mode.
- `pnpm exec tsc --noEmit`: Typecheck SDK source.
- `pnpm test`: Run Vitest and type tests.
- `pnpm test:types`: Compile `type-tests/oidcProviderTypes.ts`; useful for public type/API changes.
- `pnpm build`: Build CJS and ESM SDK output under `dist/`.
- `pnpm build:example`: Build the React example for Vite/GitHub Pages output after `pnpm build` has produced SDK output.
- `pnpm build:node-example`: Typecheck the Node example.
- `pnpm dev:example`: Start the React demo dev server.
- `pnpm dev:node-example`: Run the interactive Node OTP example.
- `pnpm test:watch`: Run Vitest in watch mode during local development.

## Verification Workflow

1. Run the smallest relevant Vitest file or type check for the changed behavior.
2. Run `pnpm test` for SDK behavior changes.
3. Run `pnpm exec tsc --noEmit` before handing off source or public type changes.
4. Run `pnpm test:types` directly when changing public generics, overloads, exported types, OIDC provider typing, or `src/index.ts`.
5. Run `pnpm build:node-example` when SDK exports, module resolution, or Node example usage changes.
6. Run `pnpm build` before release/build-output work, package entrypoint changes, or React example builds from a clean tree.
7. Run `pnpm build:example` after `pnpm build` when changing the React example, Vite config, public browser API shape, or Pages deployment assumptions.

## Coding and Architecture Rules

- Source files under `src/` use explicit `.js` extensions in relative imports so emitted JavaScript resolves correctly. Preserve that pattern in SDK source.
- Treat `src/index.ts` as the public API gate. Export new public types or clients there intentionally, and update `API.md`, `README.md`, and type tests when public behavior changes.
- Route wallet API calls through `WalletClient`, generated WaaS types, `createSignedFetch`, and `CredentialSigner` instead of duplicating signing or header logic.
- Use `StorageManager` abstractions for persistence-sensitive code. Browser storage and memory fallback behavior are part of the SDK contract.
- Preserve typed SDK error classes and `toOmsSdkError` behavior when wrapping network, generated-client, validation, session, and transaction-status failures.
- Keep supported network metadata and chain ID lookup going through `src/networks.ts`, `Networks`, `supportedNetworks`, `findNetworkById`, and `findNetworkByName` instead of ad hoc conversion.
- The TypeScript compiler is the enforced style gate. There is no separate lint or formatter command in the root scripts, so avoid broad formatting churn and match the local file style.

## Testing

See **[TESTING.md](./TESTING.md)** for testing conventions, unit vs. integration boundaries, and
execution commands.

### Testing Guidance

- Test promises, not implementation. Use `Promise -> Risk -> Evidence -> Cost -> Action` for non-trivial changes.
- Prefer the lowest reliable evidence level: TypeScript checks for impossible states, Vitest tests for SDK behavior, type tests for public API constraints, and example builds for consumer compatibility.
- Existing tests stub network boundaries while asserting public wallet/indexer behavior, request payloads, error mapping, OIDC state handling, pagination, transaction status behavior, and type-level API promises. Keep that behavior focus.
- Some existing tests seed private wallet state through `(wallet as any)`. Use that only as local compatibility in existing test areas; prefer public methods or small fixtures for new coverage.
- Bug fixes should include regression evidence when feasible.
- For auth, signing, transaction execution, access revocation, storage persistence, and error classification, add focused tests that would fail if the externally visible promise breaks.

## Generated Files and External Artifacts

- `src/generated/waas.gen.ts` is generated by Webrpc and marked `DO NOT EDIT`. Update the generated-client source of truth rather than hand-editing this file as normal source.
- The generated WaaS header references `schema/waas.ridl`; if regenerating the client, document the schema source and command used.
- `pnpm-lock.yaml` is the dependency lockfile. Update it through pnpm, not by hand.
- `dist/`, `examples/react/dist/`, and `*.tsbuildinfo` files are build outputs and should not be edited as source.

## Security and Configuration

- Do not commit real secrets. `.env.local` and `.env.*.local` files are ignored for local overrides.
- The React example uses `examples/react/.env.example` for `VITE_OMS_PUBLISHABLE_KEY` and `VITE_OMS_PROJECT_ID`; keep local overrides in `examples/react/.env.local`.
- Treat credential signing, nonce handling, OIDC redirect state cleanup, session persistence, transaction execution/status polling, and access revocation as high-risk paths. Prefer focused regression tests for changes in these areas.
- GitHub Pages currently reads the existing `OMS_PUBLIC_API_KEY` secret and exposes it as `VITE_OMS_PUBLISHABLE_KEY` for deployed examples. Do not require those secrets for ordinary local unit tests unless the test explicitly needs an external boundary.

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
| Public API in `src/index.ts` | `API.md`, `README.md`, `type-tests/oidcProviderTypes.ts` |
| Test commands (`package.json` scripts) | `TESTING.md`, `.github/workflows/tests.yml`, `AGENTS.md` Commands section |
| Node or pnpm version | `.nvmrc`, `package.json#packageManager`, `.github/workflows/*.yml` |
| New third-party dependency | `package.json`, `pnpm-lock.yaml`, context7 instruction in `AGENTS.md` |
| `src/generated/waas.gen.ts` (regenerated) | Document schema source + regen command in PR description |
| Repo structure (new top-level dirs) | `AGENTS.md` Repository Layout section |
| Examples added or renamed | `pnpm-workspace.yaml`, root `package.json` scripts, `pages.yml` |
