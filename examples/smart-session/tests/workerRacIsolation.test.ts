import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test, vi } from 'vitest';

import {
  OMSWalletRequestError,
  type RemoteAccessSession,
  type SmartSessionGrantUsage
} from '@polygonlabs/oms-wallet';

import type {
  AdminOverview,
  AdminTransaction,
  ApprovalRequest,
  CreateApprovalBody,
  CreatedApproval
} from '../shared/api.js';
import {
  BASE_SEPOLIA_USDC,
  BASE_USDC,
  getSmartSessionAsset,
  getSmartSessionNetwork,
  POLYGON_AMOY_USDC
} from '../shared/networks.js';
import worker from '../worker/index.js';

interface MockSession {
  credentialId: string;
  session: RemoteAccessSession;
  usage: SmartSessionGrantUsage[];
  listed: boolean;
  active: boolean;
}

const mockedWaas = vi.hoisted(() => ({
  activeSessionReads: 0,
  rejectConcurrentSessionReads: false,
  nextTransaction: 0,
  revokedCredentialIds: [] as string[],
  sessions: new Map<string, MockSession>(),
  preparedTransactions: [] as Array<Record<string, unknown>>,
  registeredCredentials: [] as Array<Record<string, unknown>>
}));

vi.mock('../worker/rac.js', () => ({
  RAC_LIFETIME_SECONDS: 30 * 24 * 60 * 60,
  createRacContext: async (_publishableKey: string, privateKey: string) => {
    const racSuffix = privateKey.slice(-12);
    const credentialId = `credential-${racSuffix}`;
    const findSession = (sessionId: string): MockSession => {
      const entry = mockedWaas.sessions.get(sessionId);
      if (!entry?.active || entry.credentialId !== credentialId) {
        throw Object.assign(new Error('Session not found'), { status: 404 });
      }
      return entry;
    };
    const sessionRead = async <T>(operation: string, read: () => T): Promise<T> => {
      if (!mockedWaas.rejectConcurrentSessionReads) return read();
      mockedWaas.activeSessionReads += 1;
      try {
        if (mockedWaas.activeSessionReads > 1) {
          throw new OMSWalletRequestError({
            operation,
            message: 'Precondition failed; try again with a higher nonce value',
            status: 412,
            retryable: false,
            cause: 'nonce replay detected',
            upstreamError: {
              service: 'waas',
              name: 'PreconditionFailed',
              code: 7206,
              message: 'Precondition failed; try again with a higher nonce value',
              status: 412
            }
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
        return read();
      } finally {
        mockedWaas.activeSessionReads -= 1;
      }
    };
    return {
      signerId: `signer-${racSuffix}`,
      client: {
        registerCredential: async (params: Record<string, unknown>) => {
          mockedWaas.registeredCredentials.push(params);
          return { credentialId };
        },
        revokeCredential: async ({ credentialId: revokedId }: { credentialId: string }) => {
          mockedWaas.revokedCredentialIds.push(revokedId);
        },
        listSessions: async () =>
          Array.from(mockedWaas.sessions.values())
            .filter((entry) => entry.credentialId === credentialId && entry.active && entry.listed)
            .map((entry) => entry.session),
        getSession: async ({ sessionId }: { sessionId: string }) =>
          sessionRead('remoteAccess.getSession', () => findSession(sessionId).session),
        getSessionUsage: async ({ sessionId }: { sessionId: string }) =>
          sessionRead('remoteAccess.getSessionUsage', () => findSession(sessionId).usage),
        prepareTransaction: async (params: Record<string, unknown>) => {
          mockedWaas.preparedTransactions.push(params);
          mockedWaas.nextTransaction += 1;
          return {
            txnId: `txn-${mockedWaas.nextTransaction}`,
            status: 'quoted',
            sponsored: true,
            feeOptions: []
          };
        },
        executeTransaction: async () => ({ status: 'pending' }),
        getTransactionStatus: async ({ txnId }: { txnId: string }) => ({
          status: 'executed',
          txnHash: `0x${txnId.replace('txn-', '').padStart(64, '0')}`
        })
      }
    };
  }
}));

interface TestEnv {
  DB: D1Database;
  OMS_PUBLISHABLE_KEY: string;
  WALLET_ORIGIN: string;
  DASHBOARD_ORIGIN: string;
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;
const walletOrigin = 'https://wallet.smart-session.example';
const dashboardOrigin = 'https://dashboard.smart-session.example';
const recipientA = '0x1000000000000000000000000000000000000001';
const recipientB = '0x2000000000000000000000000000000000000002';
const walletA = '0x3000000000000000000000000000000000000003';
const walletB = '0x4000000000000000000000000000000000000004';
const sessionSigner = '0x5000000000000000000000000000000000000005';

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(() => {
  mockedWaas.activeSessionReads = 0;
  mockedWaas.rejectConcurrentSessionReads = false;
  mockedWaas.revokedCredentialIds.length = 0;
  mockedWaas.sessions.clear();
  mockedWaas.preparedTransactions.length = 0;
  mockedWaas.registeredCredentials.length = 0;
});

test('isolates wallet and dashboard APIs by hostname', async () => {
  const token = 'admin-host-isolation-token-at-least-32-characters';
  await requestJson('/api/client-config', { origin: dashboardOrigin }, 404);
  await requestJson(
    '/api/admin/bootstrap',
    { method: 'POST', body: { token }, origin: walletOrigin },
    404
  );
  await requestJson('/api/admin/bootstrap', { method: 'POST', body: { token } }, 201);
  await requestJson('/api/admin/overview', { origin: walletOrigin }, 404);
  await requestJson('/health', { origin: 'https://unknown.smart-session.example' }, 404);
});

test('uses the configured wallet URL and dashboard metadata URL', async () => {
  const token = 'admin-configured-origins-token-at-least-32-characters';
  const created = await createApproval(token, {
    recipientScope: { mode: 'specific', recipients: [recipientA] },
    allowance: '10',
    networkId: 'polygon-amoy',
    assetId: 'pol'
  });

  expect(new URL(created.approvalUrl).origin).toBe(walletOrigin);
  await requestJson(
    `/api/approvals/${encodeURIComponent(created.approvalToken)}`,
    { origin: dashboardOrigin },
    404
  );
  expect(mockedWaas.registeredCredentials).toContainEqual(
    expect.objectContaining({
      metadata: expect.objectContaining({ appUrl: dashboardOrigin })
    })
  );
});

test('serves the frontend selected by hostname', async () => {
  const assetFetch = vi.fn(async (input: RequestInfo | URL) => {
    const requestUrl = input instanceof Request ? input.url : input.toString();
    return new Response(new URL(requestUrl).pathname);
  });
  const staticEnv = {
    DB: testEnv.DB,
    ASSETS: { fetch: assetFetch } as unknown as Fetcher,
    OMS_PUBLISHABLE_KEY: testEnv.OMS_PUBLISHABLE_KEY,
    WALLET_ORIGIN: testEnv.WALLET_ORIGIN,
    DASHBOARD_ORIGIN: testEnv.DASHBOARD_ORIGIN
  };

  const walletAsset = await worker.fetch(new Request(`${walletOrigin}/assets/app.js`), staticEnv);
  const dashboardRoot = await worker.fetch(new Request(`${dashboardOrigin}/`), staticEnv);
  const dashboardAsset = await worker.fetch(
    new Request(`${dashboardOrigin}/assets/app.js`),
    staticEnv
  );
  const hiddenDashboardAsset = await worker.fetch(
    new Request(`${walletOrigin}/dashboard/assets/app.js`),
    staticEnv
  );

  expect(await walletAsset.text()).toBe('/assets/app.js');
  expect(await dashboardRoot.text()).toBe('/dashboard/');
  expect(await dashboardAsset.text()).toBe('/dashboard/assets/app.js');
  expect(hiddenDashboardAsset.status).toBe(404);
});

test('fails safely when deployment origins are invalid', async () => {
  const response = await worker.fetch(new Request(`${walletOrigin}/health`), {
    DB: testEnv.DB,
    ASSETS: { fetch: vi.fn() } as unknown as Fetcher,
    OMS_PUBLISHABLE_KEY: testEnv.OMS_PUBLISHABLE_KEY,
    WALLET_ORIGIN: walletOrigin,
    DASHBOARD_ORIGIN: walletOrigin
  });

  expect(response.status).toBe(500);
  await expect(response.json()).resolves.toEqual({
    error: 'WALLET_ORIGIN and DASHBOARD_ORIGIN must be different'
  });
});

test('rotating one backend RAC removes only its activity', async () => {
  const activityA = await createNativeActivity(
    'admin-a-token-that-is-at-least-32-characters',
    recipientA,
    walletA,
    'session-a'
  );
  const activityB = await createNativeActivity(
    'admin-b-token-that-is-at-least-32-characters',
    recipientB,
    walletB,
    'session-b'
  );

  await adminRequest(
    activityA.token,
    `/api/admin/approvals/${activityB.approvalId}/link`,
    { method: 'POST' },
    404
  );
  await adminRequest(
    activityA.token,
    `/api/admin/sessions/${activityB.sessionRecordId}/transactions`,
    { method: 'POST', body: { recipient: recipientB, amount: '1' } },
    404
  );
  await adminRequest(
    activityA.token,
    `/api/admin/transactions/${activityB.transactionId}`,
    undefined,
    404
  );

  await adminRequest(activityA.token, '/api/admin/rac/rotate', { method: 'POST' });

  const rotatedA = await overview(activityA.token);
  const preservedB = await overview(activityB.token);
  expect(rotatedA.credential.id).not.toBe(activityA.credentialId);
  expect(rotatedA.approvals).toEqual([]);
  expect(rotatedA.sessions).toEqual([]);
  expect(rotatedA.transactions).toEqual([]);
  expect(preservedB.approvals.map(({ id }) => id)).toEqual([activityB.approvalId]);
  expect(preservedB.sessions.map(({ id }) => id)).toEqual([activityB.sessionRecordId]);
  expect(preservedB.transactions.map(({ id }) => id)).toEqual([activityB.transactionId]);
  expect(mockedWaas.revokedCredentialIds).toEqual([activityA.credentialId]);
});

test.each([
  ['network', { chainId: 137 }],
  [
    'grants',
    {
      grants: [
        {
          kind: 'nativeTransfer' as const,
          to: recipientA as `0x${string}`,
          limit: 11n
        }
      ]
    }
  ],
  ['expiry', { expiresAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString() }]
])('rejects an authorized session with mismatched %s', async (field, override) => {
  const token = `admin-mismatch-${field}-token-at-least-32-characters`;
  const approval = await createApproval(token, {
    recipientScope: { mode: 'specific', recipients: [recipientA] },
    allowance: '10',
    networkId: 'polygon-amoy',
    assetId: 'pol'
  });
  const sessionId = `session-mismatch-${field}`;
  mockedWaas.sessions.set(sessionId, {
    credentialId: approval.credentialId,
    session: {
      ...nativeSession(sessionId, 'authoritative-wallet', recipientA, approval.expiresAt),
      ...override
    },
    usage: [],
    listed: true,
    active: true
  });

  await requestJson(
    `/api/approvals/${encodeURIComponent(approval.approvalToken)}/approve`,
    { method: 'POST', body: { walletAddress: walletA, sessionId } },
    409
  );
  expect((await overview(token)).approvals[0]?.status).toBe('pending');
});

test('reconciles list, session fallback, usage, and revocation from WaaS', async () => {
  const token = 'admin-reconcile-token-that-is-at-least-32-characters';
  const created = await createApprovedNativeSession(token, recipientA, walletA, 'session-sync');
  const entry = mockedWaas.sessions.get(created.sessionId);
  if (!entry) throw new Error('Mock session was not created');
  await requestJson(
    `/api/approvals/${encodeURIComponent(created.approvalToken)}/approve`,
    { method: 'POST', body: { walletAddress: walletA, sessionId: created.sessionId } },
    409
  );
  entry.listed = false;
  entry.usage = [{ grant: entry.session.grants[0], used: 4n }];

  const reconciled = (await overview(token)).sessions[0];
  expect(reconciled).toMatchObject({
    status: 'usable',
    sessionId: created.sessionId,
    grants: [{ limit: '10', used: '4', remaining: '6' }]
  });

  entry.active = false;
  expect((await overview(token)).sessions[0]?.status).toBe('revoked');

  await testEnv.DB.prepare('UPDATE approval_requests SET expires_at = ? WHERE id = ?')
    .bind(new Date(Date.now() - 1_000).toISOString(), created.approvalId)
    .run();
  expect((await overview(token)).sessions[0]?.status).toBe('expired');
});

test('reconciles multiple sessions without racing RAC request nonces', async () => {
  const token = 'admin-serial-session-reads-token-at-least-32-characters';
  await createApprovedNativeSession(token, recipientA, walletA, 'session-serial-a');
  await createApprovedNativeSession(token, recipientB, walletB, 'session-serial-b');
  for (const entry of mockedWaas.sessions.values()) entry.listed = false;
  mockedWaas.rejectConcurrentSessionReads = true;

  await expect(overview(token)).resolves.toMatchObject({
    sessions: expect.arrayContaining([
      expect.objectContaining({ sessionId: 'session-serial-a', status: 'usable' }),
      expect.objectContaining({ sessionId: 'session-serial-b', status: 'usable' })
    ])
  });
});

test('dismisses only inactive session records owned by the backend RAC', async () => {
  const revoked = await createNativeActivity(
    'admin-dismiss-revoked-token-at-least-32-characters',
    recipientA,
    walletA,
    'session-dismiss-revoked'
  );
  const active = await createApprovedNativeSession(
    revoked.token,
    recipientB,
    walletB,
    'session-dismiss-active'
  );
  const outsiderToken = 'admin-dismiss-outsider-token-at-least-32-characters';
  await bootstrapAdmin(outsiderToken);

  const revokedEntry = mockedWaas.sessions.get(revoked.sessionId);
  if (!revokedEntry) throw new Error('Mock session was not created');
  revokedEntry.active = false;

  await adminRequest(
    revoked.token,
    `/api/admin/sessions/${active.sessionRecordId}`,
    { method: 'DELETE' },
    409
  );
  await adminRequest(
    outsiderToken,
    `/api/admin/sessions/${revoked.sessionRecordId}`,
    { method: 'DELETE' },
    404
  );
  await adminRequest(revoked.token, `/api/admin/sessions/${revoked.sessionRecordId}`, {
    method: 'DELETE'
  });

  const remaining = await overview(revoked.token);
  expect(remaining.sessions.map(({ id }) => id)).toEqual([active.sessionRecordId]);
  expect(remaining.transactions.map(({ id }) => id)).toEqual([revoked.transactionId]);
  expect(remaining.approvals.map(({ id }) => id)).toEqual(
    expect.arrayContaining([revoked.approvalId, active.approvalId])
  );
});

test('dismisses an expired session record', async () => {
  const token = 'admin-dismiss-expired-token-at-least-32-characters';
  const expired = await createApprovedNativeSession(
    token,
    recipientA,
    walletA,
    'session-dismiss-expired'
  );
  await testEnv.DB.prepare('UPDATE approval_requests SET expires_at = ? WHERE id = ?')
    .bind(new Date(Date.now() - 1_000).toISOString(), expired.approvalId)
    .run();

  await adminRequest(token, `/api/admin/sessions/${expired.sessionRecordId}`, { method: 'DELETE' });

  expect((await overview(token)).sessions).toEqual([]);
});

test('checks per-recipient cumulative usage and uses the authoritative wallet ID', async () => {
  const token = 'admin-usage-token-that-is-at-least-32-characters';
  const created = await createApprovedUsdcSession(
    token,
    [recipientA, recipientB],
    walletA,
    'session-usage'
  );
  const entry = mockedWaas.sessions.get(created.sessionId);
  if (!entry) throw new Error('Mock session was not created');
  entry.usage = [
    { grant: entry.session.grants[0], used: 7n },
    { grant: entry.session.grants[1], used: 1n }
  ];

  await adminRequest(
    token,
    `/api/admin/sessions/${created.sessionRecordId}/transactions`,
    { method: 'POST', body: { recipient: recipientA, amount: '4' } },
    400
  );
  expect(mockedWaas.preparedTransactions).toEqual([]);

  await adminRequest<AdminTransaction>(
    token,
    `/api/admin/sessions/${created.sessionRecordId}/transactions`,
    { method: 'POST', body: { recipient: recipientB, amount: '9' } },
    201
  );
  expect(mockedWaas.preparedTransactions).toEqual([
    expect.objectContaining({
      walletId: 'authoritative-wallet',
      sessionId: created.sessionId,
      to: created.asset.tokenAddress
    })
  ]);
});

test('shares cumulative usage across an unrestricted ERC-20 grant', async () => {
  const token = 'admin-any-recipient-token-that-is-at-least-32-characters';
  const created = await createApprovedUsdcSession(token, 'any', walletA, 'session-any');
  const entry = mockedWaas.sessions.get(created.sessionId);
  if (!entry) throw new Error('Mock session was not created');
  entry.usage = [{ grant: entry.session.grants[0], used: 7n }];

  await adminRequest(
    token,
    `/api/admin/sessions/${created.sessionRecordId}/transactions`,
    { method: 'POST', body: { recipient: recipientB, amount: '4' } },
    400
  );
  await adminRequest(
    token,
    `/api/admin/sessions/${created.sessionRecordId}/transactions`,
    { method: 'POST', body: { recipient: recipientB, amount: '3' } },
    201
  );
});

test.each([
  ['Polygon Amoy', 'polygon-amoy', POLYGON_AMOY_USDC],
  ['Base', 'base', BASE_USDC],
  ['Base Sepolia', 'base-sepolia', BASE_SEPOLIA_USDC]
] as const)(
  'prepares USDC transfers on %s with the configured token contract',
  async (_label, networkId, tokenAddress) => {
    const token = `admin-${networkId}-usdc-token-that-is-at-least-32-characters`;
    const created = await createApprovedUsdcSession(
      token,
      [recipientA],
      walletA,
      `session-${networkId}-usdc`,
      networkId
    );

    await adminRequest<AdminTransaction>(
      token,
      `/api/admin/sessions/${created.sessionRecordId}/transactions`,
      { method: 'POST', body: { recipient: recipientA, amount: '1' } },
      201
    );
    expect(mockedWaas.preparedTransactions).toEqual([
      expect.objectContaining({
        network: getSmartSessionNetwork(networkId).network,
        sessionId: created.sessionId,
        to: tokenAddress
      })
    ]);
  }
);

test.each([
  ['Base', 'base'],
  ['Base Sepolia', 'base-sepolia']
] as const)('prepares native ETH transfers on %s', async (_label, networkId) => {
  const token = `admin-${networkId}-eth-token-that-is-at-least-32-characters`;
  const created = await createApprovedNativeSession(
    token,
    recipientA,
    walletA,
    `session-${networkId}-eth`,
    networkId
  );

  await adminRequest<AdminTransaction>(
    token,
    `/api/admin/sessions/${created.sessionRecordId}/transactions`,
    { method: 'POST', body: { recipient: recipientA, amount: '1' } },
    201
  );
  expect(mockedWaas.preparedTransactions).toEqual([
    expect.objectContaining({
      network: created.network.network,
      sessionId: created.sessionId,
      to: recipientA,
      value: 1n
    })
  ]);
});

test('rejects network and asset pairs outside the runtime allowlist', async () => {
  const token = 'admin-invalid-pair-token-that-is-at-least-32-characters';
  await bootstrapAdmin(token);
  await adminRequest(token, '/api/admin/rac', { method: 'POST' }, 201);

  await adminRequest(
    token,
    '/api/admin/approvals',
    {
      method: 'POST',
      body: {
        recipientScope: { mode: 'specific', recipients: [recipientA] },
        allowance: '10',
        expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        networkId: 'base-sepolia',
        assetId: 'usdt'
      }
    },
    400
  );
  expect((await overview(token)).approvals).toEqual([]);
});

async function createNativeActivity(
  token: string,
  recipient: string,
  walletAddress: string,
  sessionId: string
) {
  const session = await createApprovedNativeSession(token, recipient, walletAddress, sessionId);
  const transaction = await adminRequest<AdminTransaction>(
    token,
    `/api/admin/sessions/${session.sessionRecordId}/transactions`,
    { method: 'POST', body: { recipient, amount: '1' } },
    201
  );
  return { ...session, token, transactionId: transaction.id };
}

async function createApprovedNativeSession(
  token: string,
  recipient: string,
  walletAddress: string,
  sessionId: string,
  networkId: 'polygon-amoy' | 'base' | 'base-sepolia' = 'polygon-amoy'
) {
  const network = getSmartSessionNetwork(networkId);
  const assetId = networkId === 'polygon-amoy' ? 'pol' : 'eth';
  const asset = getSmartSessionAsset(networkId, assetId);
  if (asset.kind !== 'native') throw new Error(`${network.name} ${asset.symbol} must be native`);
  const approval = await createApproval(token, {
    recipientScope: { mode: 'specific', recipients: [recipient] },
    allowance: '10',
    networkId,
    assetId
  });
  mockedWaas.sessions.set(sessionId, {
    credentialId: approval.credentialId,
    session: nativeSession(
      sessionId,
      'authoritative-wallet',
      recipient,
      approval.expiresAt,
      network.network.id
    ),
    usage: [],
    listed: true,
    active: true
  });
  await requestJson(`/api/approvals/${encodeURIComponent(approval.approvalToken)}/approve`, {
    method: 'POST',
    body: { walletAddress, sessionId }
  });
  const approvedOverview = await overview(token);
  const sessionRecord = approvedOverview.sessions.find(
    (candidate) => candidate.sessionId === sessionId
  );
  if (!sessionRecord) throw new Error('Approved session was not returned by the overview');
  return { ...approval, network, sessionId, sessionRecordId: sessionRecord.id };
}

async function createApprovedUsdcSession(
  token: string,
  recipients: string[] | 'any',
  walletAddress: string,
  sessionId: string,
  networkId: 'polygon-amoy' | 'polygon' | 'base' | 'base-sepolia' = 'polygon'
) {
  const network = getSmartSessionNetwork(networkId);
  const asset = getSmartSessionAsset(networkId, 'usdc');
  if (asset.kind !== 'erc20') throw new Error(`${network.name} USDC must be an ERC-20 asset`);
  const approval = await createApproval(token, {
    recipientScope: recipients === 'any' ? { mode: 'any' } : { mode: 'specific', recipients },
    allowance: '10',
    networkId,
    assetId: 'usdc'
  });
  const grants =
    recipients === 'any'
      ? [
          {
            kind: 'erc20Transfer' as const,
            token: asset.tokenAddress,
            limit: 10n,
            cumulative: true
          }
        ]
      : recipients.map((recipient) => ({
          kind: 'erc20Transfer' as const,
          token: asset.tokenAddress,
          to: recipient as `0x${string}`,
          limit: 10n,
          cumulative: true
        }));
  mockedWaas.sessions.set(sessionId, {
    credentialId: approval.credentialId,
    session: {
      sessionId,
      walletId: 'authoritative-wallet',
      signerAddress: sessionSigner,
      grants,
      chainId: network.network.id,
      expiresAt: approval.expiresAt
    },
    usage: [],
    listed: true,
    active: true
  });
  await requestJson(`/api/approvals/${encodeURIComponent(approval.approvalToken)}/approve`, {
    method: 'POST',
    body: { walletAddress, sessionId }
  });
  const approvedOverview = await overview(token);
  const sessionRecord = approvedOverview.sessions.find(
    (candidate) => candidate.sessionId === sessionId
  );
  if (!sessionRecord) throw new Error('Approved session was not returned by the overview');
  return { ...approval, asset, sessionId, sessionRecordId: sessionRecord.id };
}

async function createApproval(token: string, policy: Omit<CreateApprovalBody, 'expiresAt'>) {
  await bootstrapAdmin(token);
  await adminRequest(token, '/api/admin/rac', { method: 'POST' }, 201);
  const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
  const created = await adminRequest<CreatedApproval>(
    token,
    '/api/admin/approvals',
    { method: 'POST', body: { ...policy, expiresAt } },
    201
  );
  const approvalToken = new URL(created.approvalUrl).searchParams.get('request');
  if (!approvalToken) throw new Error('Approval response did not contain a request token');
  const request = await requestJson<ApprovalRequest>(
    `/api/approvals/${encodeURIComponent(approvalToken)}`
  );
  return {
    approvalId: created.id,
    approvalUrl: created.approvalUrl,
    approvalToken,
    credentialId: request.credentialId,
    expiresAt
  };
}

function nativeSession(
  sessionId: string,
  walletId: string,
  recipient: string,
  expiresAt: string,
  chainId = 80002
): RemoteAccessSession {
  return {
    sessionId,
    walletId,
    signerAddress: sessionSigner,
    grants: [
      {
        kind: 'nativeTransfer',
        to: recipient as `0x${string}`,
        limit: 10n
      }
    ],
    chainId,
    expiresAt
  };
}

async function bootstrapAdmin(token: string): Promise<void> {
  await requestJson('/api/admin/bootstrap', { method: 'POST', body: { token } }, 201);
}

function overview(token: string): Promise<AdminOverview> {
  return adminRequest(token, '/api/admin/overview');
}

function adminRequest<T>(
  token: string,
  pathname: string,
  options?: RequestOptions,
  expectedStatus = 200
): Promise<T> {
  return requestJson(
    pathname,
    {
      ...options,
      headers: { ...options?.headers, Authorization: `Bearer ${token}` }
    },
    expectedStatus
  );
}

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  origin?: string;
}

async function requestJson<T = unknown>(
  pathname: string,
  options: RequestOptions = {},
  expectedStatus = 200
): Promise<T> {
  const request = new Request(`${options.origin ?? requestOrigin(pathname)}${pathname}`, {
    method: options.method,
    headers: {
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const response = await worker.fetch(request, testEnv as never);
  expect(response.status, await response.clone().text()).toBe(expectedStatus);
  return (await response.json()) as T;
}

function requestOrigin(pathname: string): string {
  return pathname.startsWith('/api/admin/') ? dashboardOrigin : walletOrigin;
}
