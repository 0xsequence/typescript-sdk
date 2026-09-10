import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFile, mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function validateReleasePackages(workspaces, changesetsConfig) {
  const releasePackages = workspaces.filter((workspace) => workspace.private !== true);
  assert(releasePackages.length > 0, 'No publishable workspace packages were found.');
  assert.equal(
    changesetsConfig.fixed.length,
    1,
    'Staged publishing expects one Changesets fixed group containing every publishable package.'
  );

  const fixedNames = [...changesetsConfig.fixed[0]].sort();
  const releaseNames = releasePackages.map((workspace) => workspace.name).sort();
  assert.deepEqual(
    releaseNames,
    fixedNames,
    'Every publishable package must belong to the single Changesets fixed group.'
  );

  const versions = new Set(releasePackages.map((workspace) => workspace.version));
  assert.equal(versions.size, 1, 'Packages in the Changesets fixed group must have one version.');

  const packagesByName = new Map(releasePackages.map((workspace) => [workspace.name, workspace]));
  return changesetsConfig.fixed[0].map((name) => packagesByName.get(name));
}

export function findWorkspaceReferences(value, currentPath = 'package.json') {
  if (typeof value === 'string') {
    return value.startsWith('workspace:') ? [currentPath] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findWorkspaceReferences(item, `${currentPath}[${index}]`)
    );
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) =>
      findWorkspaceReferences(item, `${currentPath}.${key}`)
    );
  }
  return [];
}

export function assertTrustedPublishingEnvironment(environment) {
  assert.equal(
    environment.GITHUB_ACTIONS,
    'true',
    'Staged publishing is CI-only and must run in GitHub Actions.'
  );
  assert(
    environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN && environment.ACTIONS_ID_TOKEN_REQUEST_URL,
    'GitHub Actions OIDC is unavailable; the job needs id-token: write permission.'
  );
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    ...options
  });
  if (result.error) throw result.error;
  return result;
}

function runChecked(command, args, options = {}) {
  const result = run(command, args, options);
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with exit code ${result.status}.\n${result.stderr ?? ''}`
    );
  }
  return result;
}

function hasGitTag(tag) {
  const result = run('git', ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`]);
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`Unable to check git tag ${tag}.`);
  }
  return result.status === 0;
}

function isPublished({ name, version }) {
  const packageSpec = `${name}@${version}`;
  const result = run('npm', ['view', packageSpec, 'version', '--json']);
  if (result.status === 0) {
    return JSON.parse(result.stdout) === version;
  }
  if (/E404|404 Not Found/.test(`${result.stdout}\n${result.stderr}`)) {
    return false;
  }
  throw new Error(`Unable to determine whether ${packageSpec} is published.\n${result.stderr}`);
}

function tarballName({ name, version }) {
  return `${name.replace(/^@/, '').replaceAll('/', '-')}-${version}.tgz`;
}

async function packPackage(releasePackage, outputDirectory) {
  const tarballPath = path.join(outputDirectory, tarballName(releasePackage));
  runChecked('pnpm', ['--dir', releasePackage.path, 'pack', '--out', tarballPath], {
    stdio: 'inherit'
  });

  const manifestResult = runChecked('tar', ['-xOf', tarballPath, 'package/package.json']);
  const packedManifest = JSON.parse(manifestResult.stdout);
  assert.equal(
    packedManifest.name,
    releasePackage.name,
    'Packed package name changed unexpectedly.'
  );
  assert.equal(
    packedManifest.version,
    releasePackage.version,
    'Packed package version changed unexpectedly.'
  );
  assert.deepEqual(
    findWorkspaceReferences(packedManifest),
    [],
    `pnpm did not rewrite every workspace: reference in ${releasePackage.name}.`
  );
  return tarballPath;
}

async function writeSummary(lines) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`, 'utf8');
}

async function main() {
  assertTrustedPublishingEnvironment(process.env);
  const distTag = process.env.NPM_STAGE_TAG || 'latest';
  const createGitTags = process.env.NPM_STAGE_CREATE_GIT_TAGS !== 'false';

  const workspacesResult = runChecked('pnpm', ['--recursive', 'list', '--depth', '-1', '--json']);
  const changesetsConfig = JSON.parse(
    await readFile(path.join(repositoryRoot, '.changeset/config.json'), 'utf8')
  );
  const releasePackages = validateReleasePackages(
    JSON.parse(workspacesResult.stdout),
    changesetsConfig
  );

  const releaseStates = releasePackages.map((releasePackage) => {
    const tag = `${releasePackage.name}@${releasePackage.version}`;
    const tagged = createGitTags && hasGitTag(tag);
    const published = tagged ? false : isPublished(releasePackage);
    return { releasePackage, tag, tagged, published };
  });
  const packagesToStage = releaseStates.filter((state) => !state.tagged && !state.published);

  if (packagesToStage.length === 0) {
    console.log('No unstaged package versions were found.');
    await writeSummary(['### npm staged publishing', '', 'No package versions needed staging.']);
    return;
  }

  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'oms-wallet-npm-stage-'));
  const stagedPackages = [];
  for (const { releasePackage } of packagesToStage) {
    const tarballPath = await packPackage(releasePackage, outputDirectory);
    runChecked(
      'npm',
      ['stage', 'publish', tarballPath, '--tag', distTag, '--access', 'public', '--provenance'],
      { stdio: 'inherit' }
    );
    stagedPackages.push(releasePackage);
    // changesets/action v1 creates this package's tag and GitHub Release from this line,
    // even if a later package fails. A retry can then skip the already-staged package by tag.
    if (createGitTags) {
      console.log(`New tag: ${releasePackage.name}@${releasePackage.version}`);
    }
  }

  await writeSummary([
    '### npm staged publishing',
    '',
    ...stagedPackages.map(
      ({ name, version }) => `- \`${name}@${version}\` is staged under \`${distTag}\`.`
    ),
    '',
    'A maintainer must approve every staged package on npm with 2FA before it is installable.'
  ]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
