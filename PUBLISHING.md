# Publishing

> **Publishing is CI-only. Never publish or stage from a local machine.** Do not run
> `changeset version`, `changeset publish`, `npm publish`, `npm stage publish`, `pnpm publish`, or
> the internal `ci:stage-release` script yourself. A local release bypasses the signed release
> commit and npm OIDC trusted publishing. Your job as a contributor is to land a changeset (see
> "Day-to-day") and let CI prepare the release; an npm maintainer performs the final 2FA approval.

Releases are driven by [changesets](https://github.com/changesets/changesets). The SDK
(`@polygonlabs/oms-wallet`) and the wagmi connector (`@polygonlabs/oms-wallet-wagmi-connector`)
release **in lockstep**: they are declared as a `fixed` group in `.changeset/config.json`, so any
release bumps both to the same new version regardless of which one changed.

The connector source manifest keeps `@polygonlabs/oms-wallet` as `workspace:^` in
`peerDependencies` and `workspace:*` in `devDependencies`. Do not replace those with literal
versions in source — changesets rewrites them to the published semver range at release time
(`bumpVersionsWithWorkspaceProtocolOnly: false`).

## Day-to-day: add a changeset

Every PR that changes files inside a workspace package must include a changeset. From the repo
root:

```bash
pnpm exec changeset
```

Pick the bump type and write a user-facing changelog entry. Because both packages are a `fixed`
group, selecting either one bumps both. For changes with no consumer impact (internal refactors,
chores), record an empty changeset instead:

```bash
pnpm exec changeset add --empty
```

Commit the changeset in the same commit as the code. The `Changeset check` CI job fails a PR that
touches a package without one.

## Release flow (automated)

1. Merging PRs with changesets into `master` triggers the `Release` workflow
   (`.github/workflows/npm-release-trigger.yml`), which opens or updates a
   **`changesets: Release / Deploy`** PR. That PR applies the pending changesets, bumps both package
   versions in lockstep, and updates each `CHANGELOG.md`.
2. Review and merge that Release PR.
3. On merge, the same workflow uses npm `11.15.0` and runs the full release gates. It then packs
   each package with pnpm, which rewrites the connector's `workspace:^` SDK peer range to the fixed
   release version. The workflow inspects every packed manifest and fails if any `workspace:` range
   remains.
4. The workflow sends the pnpm-created tarballs to `npm stage publish` via **OIDC trusted
   publishing** (no `NPM_TOKEN`). After both packages stage successfully, Changesets pushes a
   package tag and creates a GitHub Release from each package's `CHANGELOG.md` entry.
5. An npm maintainer inspects and approves both staged packages with 2FA. Approve
   `@polygonlabs/oms-wallet` first, then `@polygonlabs/oms-wallet-wagmi-connector`; only approved
   packages become publicly installable.

Version-bump commits are signed by GitHub's GPG key (`commitMode: github-api`) to satisfy branch
protection. The package tags and GitHub Releases record that CI staged the exact release artifacts;
they do not mean npm approval has finished.

### Approve a staged release

To inspect and approve a staged release:

```bash
npm stage list @polygonlabs/oms-wallet
npm stage list @polygonlabs/oms-wallet-wagmi-connector
npm stage view <stage-id>
npm stage approve <stage-id> # prompts for 2FA; approve both package stage IDs
```

If one tarball stages and a later tarball fails, do not merge another release. The workflow creates
the successful package's tag before failing; after fixing the cause, rerun that workflow and the
release helper will skip the tagged stage. If staging succeeded but its package tag was not created,
reject that partial stage with `npm stage reject <stage-id>` before retrying because staging reserves
the package version.

## Local verification

Run the same gates CI runs before handing off release-affecting changes:

```bash
pnpm install --frozen-lockfile
pnpm lint      # eslint + markdownlint + prettier + typecheck
pnpm test      # release helper + SDK + connector test suites
pnpm build     # build packages (dual CJS+ESM) + all examples
pnpm check:exports   # publint — validates the publishable packages' exports/types
```

These are the same standard scripts the CI workflow runs (`.github/workflows/ci-trigger.yml`): the
shared `ci` composite runs lint/typecheck/test, a build job runs `build` + `check:exports`, and a
drift-check job runs each package's `codegen-drift-check`. The release helper additionally verifies
the fixed-package invariant and the pnpm-packed manifests immediately before staging.

## Prerelease / snapshot builds

To prepare a throwaway prerelease under a non-`latest` npm dist-tag (e.g. for a downstream service
to consume ahead of a real release), manually dispatch the repo's **Release** workflow — this is
still CI, not a local release:

1. GitHub → **Actions** → **Release** → **Run workflow**.
2. Set the **`snapshot_tag`** input to a non-semver dist-tag (e.g. `canary`, `pre-0.3.0`).

The workflow runs `changeset version --snapshot <tag>` on the runner (never committed), then packs
and stages both temporary versions. The snapshot path skips git tags and GitHub Releases, so
**`snapshot_tag` must not be a semver-shaped value** (`0.3.0`, `v0.3.0`, `0.3.0-beta.1`, …). The
workflow validates the input and aborts on a semver-shaped value. An npm maintainer must approve
both stages before consumers can install the result with
`pnpm add @polygonlabs/oms-wallet@<tag>`.
