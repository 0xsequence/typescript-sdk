import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const changesetDirectory = path.join(repositoryRoot, '.changeset');

export function validateSnapshotTag(tag) {
  assert(tag, 'SNAPSHOT_TAG is required.');
  assert.notEqual(tag, 'latest', "The snapshot tag must not be 'latest'.");
  assert(
    /^[a-z][a-z0-9._-]*$/.test(tag),
    'The snapshot tag must start with a lowercase letter and contain only lowercase letters, numbers, dots, underscores, or hyphens.'
  );
  assert(
    !/^v?\d+(?:\.\d+){0,2}(?:[-+].*)?$/.test(tag),
    'The snapshot tag must not look like a release version.'
  );
}

export function changesetHasRelease(content) {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return false;
  const frontmatterEnd = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (frontmatterEnd === -1) return false;
  return lines
    .slice(1, frontmatterEnd)
    .some((line) => /^\s*(?:"[^"]+"|'[^']+'|[^:#][^:]*):\s*(?:major|minor|patch)\s*$/.test(line));
}

export function assertSnapshotVersions(before, after, tag) {
  assert.equal(after.length, before.length, 'The publishable package set changed unexpectedly.');
  assert(after.length > 0, 'No publishable packages were found.');

  const versions = new Set(after.map(({ version }) => version));
  assert.equal(versions.size, 1, 'Snapshot packages must have one fixed-group version.');

  for (const currentPackage of after) {
    const previousPackage = before.find(({ name }) => name === currentPackage.name);
    assert(
      previousPackage,
      `Snapshot package ${currentPackage.name} was not present before versioning.`
    );
    assert.notEqual(
      currentPackage.version,
      previousPackage.version,
      `Snapshot versioning did not change ${currentPackage.name}.`
    );
    assert(
      currentPackage.version.includes(`-${tag}-`),
      `${currentPackage.name} did not receive the requested '${tag}' snapshot version.`
    );
  }
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: 'inherit',
    ...options
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.`);
  }
}

async function readReleasePackages() {
  const config = JSON.parse(await readFile(path.join(changesetDirectory, 'config.json'), 'utf8'));
  assert.equal(
    config.fixed.length,
    1,
    'Snapshot versioning expects one Changesets fixed group containing every publishable package.'
  );

  return Promise.all(
    config.fixed[0].map(async (name) => {
      const packageDirectory = name.replace('@polygonlabs/', '');
      const manifest = JSON.parse(
        await readFile(
          path.join(repositoryRoot, 'packages', packageDirectory, 'package.json'),
          'utf8'
        )
      );
      assert.equal(manifest.name, name, `Could not resolve the package manifest for ${name}.`);
      return { name, version: manifest.version };
    })
  );
}

async function hasVersionedChangeset() {
  const entries = await readdir(changesetDirectory);
  const changesets = entries.filter((entry) => entry.endsWith('.md') && entry !== 'README.md');
  const contents = await Promise.all(
    changesets.map((entry) => readFile(path.join(changesetDirectory, entry), 'utf8'))
  );
  return contents.some(changesetHasRelease);
}

async function main() {
  const tag = process.env.SNAPSHOT_TAG;
  validateSnapshotTag(tag);

  const before = await readReleasePackages();
  let temporaryChangeset;
  if (!(await hasVersionedChangeset())) {
    temporaryChangeset = path.join(changesetDirectory, `ci-snapshot-${process.pid}.md`);
    await writeFile(
      temporaryChangeset,
      `---\n"${before[0].name}": patch\n---\n\nCreate a temporary CI snapshot release.\n`,
      { encoding: 'utf8', flag: 'wx' }
    );
    console.log('No versioned changesets found; created a temporary snapshot changeset.');
  }

  try {
    runChecked('pnpm', ['exec', 'changeset', 'version', '--snapshot', tag]);
  } finally {
    if (temporaryChangeset) {
      await unlink(temporaryChangeset).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }

  const after = await readReleasePackages();
  assertSnapshotVersions(before, after, tag);
  console.log(`Prepared fixed-group snapshot ${after[0].version}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
