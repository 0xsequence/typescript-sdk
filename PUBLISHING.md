After PR is merged:

1. Switch to latest `master`:

```bash
git checkout master
git pull
pnpm install --frozen-lockfile
```

2. Run release checks:

```bash
pnpm exec tsc --noEmit
pnpm test
pnpm build
pnpm build:node-example
pnpm build:example
```

3. Dry-run publish:

```bash
pnpm publish --dry-run --no-git-checks
```

4. Log in to npm if needed:

```bash
pnpm npm login
```

5. Publish alpha:

```bash
pnpm publish --tag alpha --access public
```

6. Verify package:

```bash
pnpm view @0xsequence/typescript-sdk@alpha version
```

Optional: create a git tag / GitHub release for `v0.1.0-alpha.0`.
