const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const generator = path.join(__dirname, 'generate-api-docs.cjs');
const fixturesRoot = path.join(__dirname, 'fixtures', 'api-docs');

test('expands generic support types in configured members and exported declarations', () => {
  const result = runFixture('support-expansion');
  assert.equal(result.status, 0, result.stderr);

  const api = fs.readFileSync(result.outputPath, 'utf8');
  assert.match(
    api,
    /run\(params: Omit<RunParams, "walletSelection"> & \{\s+walletSelection: "manual";\s+\}\): void;/
  );
  assert.match(
    api,
    /constructor\(params: \{\s+value: number;\s+provider: BrandedProvider;\s+\}\);/
  );
  assert.match(
    api,
    /execute\(params: Omit<RunParams, "walletSelection"> & \{\s+walletSelection\?: "automatic";\s+\}\): void;/
  );
  assert.match(
    api,
    /configure\(params: \{\s+value: string;\s+provider: BrandedProvider;\s+\}\): void;/
  );
  assert.match(
    api,
    /DefaultConfiguration: \{\s+value: boolean;\s+provider: BrandedProvider;\s+\};/
  );
  assert.equal(api.match(/\bPrimaryConfiguration\b/g)?.length, 2);
  assert.equal(api.match(/\bSecondaryConfiguration\b/g)?.length, 2);
  assert.match(api, /code\?: "FIXTURE_ONE" \| "FIXTURE_TWO";/);

  for (const inaccessibleName of [
    'ManualSelection',
    'AutomaticSelection',
    'ConstructorParams',
    'ErrorParams',
    'PrivateErrorCode',
    'providerBrand',
    'hiddenState'
  ]) {
    assert.doesNotMatch(api, new RegExp(`\\b${inaccessibleName}\\b`));
  }
});

test('omits opaque unique-symbol brands while documenting usable provider values', () => {
  const result = runFixture('support-expansion');
  assert.equal(result.status, 0, result.stderr);

  const api = fs.readFileSync(result.outputPath, 'utf8');
  assert.match(api, /Obtain values from Providers; object literals are invalid\./);
  assert.match(
    api,
    /export interface BrandedProvider[\s\S]*?readonly provider: Provider;[\s\S]*?\n\}/
  );
  assert.doesNotMatch(api, /\[providerBrand\]/);
});

test('rejects an indirect support-type reference into generated declarations', () => {
  const result = runFixture('generated-boundary');
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /Non-exported support declaration GeneratedPayload in PublicApi resolves to internal generated declaration declarations\/generated\/client\.d\.ts\./
  );
});

function runFixture(name) {
  const fixtureRoot = path.join(fixturesRoot, name);
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), `api-docs-${name}-`));
  const outputPath = path.join(temporaryRoot, 'API.md');
  const result = spawnSync(process.execPath, [generator], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      API_DOCS_PROJECT_ROOT: fixtureRoot,
      API_DOCS_DECLARATION_ENTRY: path.join(fixtureRoot, 'declarations', 'index.d.ts'),
      API_DOCS_CONFIG: path.join(fixtureRoot, 'api-docs.config.json'),
      API_DOCS_OUTPUT: outputPath
    }
  });
  test.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  return { ...result, outputPath };
}
