# Publishing

Publish the SDK before the wagmi connector. The connector has an exact peer dependency on the SDK
version, so the SDK package must exist in the npm registry first.

Do not use a recursive workspace publish while the connector's peer dependency is intentionally
lockstep with the SDK version. Publish each package explicitly, in order.

## Before Merging The Release PR

Before publishing a new alpha version, update these values to the same exact version:

- `package.json` `version`
- `packages/oms-wallet-wagmi-connector/package.json` `version`
- `packages/oms-wallet-wagmi-connector/package.json` `peerDependencies["@0xsequence/typescript-sdk"]`

## After The Release PR Is Merged

1. Switch to the latest `master`:

```bash
git checkout master
git pull
pnpm install --frozen-lockfile
```

2. Capture the release version and verify package versions:

```bash
VERSION=$(node -p "require('./package.json').version")
pnpm check:package-versions
```

3. Run release checks:

```bash
pnpm exec tsc --noEmit
pnpm test
pnpm build
pnpm build:node-example
pnpm build:example
pnpm build:trails-actions-example
pnpm --filter @0xsequence/oms-wallet-wagmi-connector test
pnpm --filter @0xsequence/oms-wallet-wagmi-connector build
pnpm build:wagmi-example
```

4. Dry-run the SDK publish:

```bash
pnpm publish --dry-run --no-git-checks --tag alpha --access public
```

5. Dry-run the wagmi connector publish:

```bash
pnpm --filter @0xsequence/oms-wallet-wagmi-connector publish --dry-run --no-git-checks --tag alpha --access public
```

6. Log in to npm if needed:

```bash
pnpm npm login
pnpm npm whoami
```

7. Publish the SDK:

```bash
pnpm publish --tag alpha --access public
pnpm view @0xsequence/typescript-sdk@$VERSION version
```

8. Publish the wagmi connector:

```bash
pnpm --filter @0xsequence/oms-wallet-wagmi-connector publish --tag alpha --access public
pnpm view @0xsequence/oms-wallet-wagmi-connector@$VERSION version
```

9. Verify the alpha dist tags:

```bash
pnpm view @0xsequence/typescript-sdk@alpha version
pnpm view @0xsequence/oms-wallet-wagmi-connector@alpha version
```

Optional: create a git tag and GitHub release for `v$VERSION`.
