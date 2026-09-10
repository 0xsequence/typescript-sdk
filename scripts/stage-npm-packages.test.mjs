import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertTrustedPublishingEnvironment,
  findWorkspaceReferences,
  validateReleasePackages
} from './stage-npm-packages.mjs';

const releasePackages = [
  { name: '@polygonlabs/oms-wallet', version: '1.2.3', path: '/repo/packages/oms-wallet' },
  {
    name: '@polygonlabs/oms-wallet-wagmi-connector',
    version: '1.2.3',
    path: '/repo/packages/oms-wallet-wagmi-connector'
  }
];
const fixed = [releasePackages.map(({ name }) => name)];

test('orders every publishable package by the Changesets fixed group', () => {
  const workspaces = [
    { name: 'private-example', version: '0.0.0', private: true },
    ...releasePackages
  ];
  assert.deepEqual(validateReleasePackages(workspaces, { fixed }), releasePackages);
});

test('rejects fixed-package version drift', () => {
  const workspaces = [releasePackages[0], { ...releasePackages[1], version: '1.2.4' }];
  assert.throws(
    () => validateReleasePackages(workspaces, { fixed }),
    /fixed group must have one version/
  );
});

test('rejects a publishable package outside the fixed group', () => {
  assert.throws(
    () =>
      validateReleasePackages([...releasePackages, { name: 'extra', version: '1.2.3' }], {
        fixed
      }),
    /Every publishable package must belong/
  );
});

test('finds nested workspace protocol references in packed manifests', () => {
  assert.deepEqual(
    findWorkspaceReferences({
      peerDependencies: { sdk: 'workspace:^' },
      publishConfig: { dependencies: { sdk: '^1.2.3' } }
    }),
    ['package.json.peerDependencies.sdk']
  );
});

test('requires GitHub Actions OIDC before staging', () => {
  assert.throws(() => assertTrustedPublishingEnvironment({}), /CI-only/);
  assert.throws(
    () => assertTrustedPublishingEnvironment({ GITHUB_ACTIONS: 'true' }),
    /OIDC is unavailable/
  );
  assert.doesNotThrow(() =>
    assertTrustedPublishingEnvironment({
      GITHUB_ACTIONS: 'true',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'token',
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.test/oidc'
    })
  );
});
