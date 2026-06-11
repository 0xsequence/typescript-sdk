# Publishing

The SDK and wagmi connector release in lockstep. The connector source manifest keeps
`@0xsequence/typescript-sdk` as `workspace:*` in both `peerDependencies` and `devDependencies`.
This gives local development a workspace link, and `pnpm pack` / `pnpm publish` rewrites the
published peer dependency to the exact release version.

Do not replace the connector's SDK peer with a literal version in source, and do not publish with
`npm publish`. Use pnpm from the workspace root so the `workspace:*` protocol is rewritten before
the package reaches npm.

## Before Merging The Release PR

Before publishing a new alpha version, update these values to the same exact version:

- `package.json` `version`
- `packages/oms-wallet-wagmi-connector/package.json` `version`

Leave these values as `workspace:*`:

- `packages/oms-wallet-wagmi-connector/package.json` `peerDependencies["@0xsequence/typescript-sdk"]`
- `packages/oms-wallet-wagmi-connector/package.json` `devDependencies["@0xsequence/typescript-sdk"]`

## After The Release PR Is Merged

1. Switch to the latest `master`:

```bash
git checkout master
git pull
pnpm install --frozen-lockfile
```

2. Capture the release version and verify package metadata:

```bash
VERSION=$(node -p "require('./package.json').version")
pnpm check:package-versions
```

3. Run release checks:

```bash
pnpm test
pnpm --filter @0xsequence/oms-wallet-wagmi-connector test
pnpm build
pnpm build:node-example
pnpm build:example
pnpm build:trails-actions-example
pnpm build:wagmi-example
```

4. Dry-run the filtered workspace publish:

```bash
pnpm --filter @0xsequence/typescript-sdk \
  --filter @0xsequence/oms-wallet-wagmi-connector \
  publish --dry-run --no-git-checks --tag alpha --access public
```

If the dry run reports no new packages, the version is already published. Stop and verify the
intended release version before continuing.

5. Log in to npm if needed:

```bash
pnpm npm login
pnpm npm whoami
```

6. Publish both workspace packages from the root:

```bash
pnpm --filter @0xsequence/typescript-sdk \
  --filter @0xsequence/oms-wallet-wagmi-connector \
  publish --tag alpha --access public
```

If the filtered publish is interrupted after the SDK is published, rerun the connector publish with
pnpm:

```bash
pnpm --filter @0xsequence/oms-wallet-wagmi-connector publish --tag alpha --access public
```

7. Verify published versions and alpha dist tags:

```bash
pnpm view @0xsequence/typescript-sdk@$VERSION version
pnpm view @0xsequence/oms-wallet-wagmi-connector@$VERSION version
pnpm view @0xsequence/typescript-sdk@alpha version
pnpm view @0xsequence/oms-wallet-wagmi-connector@alpha version
```

Optional: create a git tag and GitHub release for `v$VERSION`.
