import {
  OMSWallet,
  TransactionStatus,
  feeOptionSelection,
  isOMSWalletError
} from '@polygonlabs/oms-wallet';
import type {
  RemoteAccessSession,
  SmartSessionGrant,
  SmartSessionGrantUsage
} from '@polygonlabs/oms-wallet';
import { encodeFunctionData, getAddress, isAddress } from 'viem';
import { generatePrivateKey } from 'viem/accounts';

import type {
  AdminApproval,
  AdminOverview,
  AdminSmartSession,
  AdminSmartSessionGrant,
  AdminTransaction,
  ApiError,
  ApprovalRequest,
  ApprovalStatus,
  ApproveRequestBody,
  ClientConfig,
  CreateApprovalBody,
  CreateTransactionBody,
  CreatedApproval,
  RecipientScope
} from '../shared/api.js';
import type {
  SmartSessionAsset,
  SmartSessionAssetId,
  SmartSessionNetworkId
} from '../shared/networks.js';
import {
  getSmartSessionAsset,
  getSmartSessionNetwork,
  isSmartSessionAssetId,
  isSmartSessionNetworkId
} from '../shared/networks.js';
import { createSmartSessionGrants, validateRecipientScope } from '../shared/permissions.js';
import { serializeWaasError } from './errors.js';
import { createRacContext, RAC_LIFETIME_SECONDS, type RacContext } from './rac.js';

const erc20TransferAbi = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  }
] as const;

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  OMS_PUBLISHABLE_KEY: string;
  WALLET_ORIGIN: string;
  DASHBOARD_ORIGIN: string;
}

interface DeploymentConfig {
  walletOrigin: string;
  dashboardOrigin: string;
}

type RequestSurface = 'wallet' | 'dashboard' | 'local';

interface CredentialRow {
  signer_id: string;
  credential_id: string;
  registered_at: string;
  expires_at: string;
}

interface AdminContext {
  racId: string;
}

interface ApprovalRow {
  id: string;
  rac_id: string;
  credential_id: string;
  network_id: SmartSessionNetworkId;
  asset_id: SmartSessionAssetId;
  recipient_mode: RecipientScope['mode'];
  recipients: string;
  allowance: string;
  expires_at: string;
  created_at: string;
  approved_at: string | null;
  rejected_at: string | null;
}

interface SessionRow {
  id: string;
  rac_id: string;
  wallet_address: string;
  session_id: string;
  approval_id: string;
  created_at: string;
}

interface SessionRecordRow extends SessionRow {
  network_id: SmartSessionNetworkId;
  asset_id: SmartSessionAssetId;
  recipient_mode: RecipientScope['mode'];
  recipients: string;
  allowance: string;
  expires_at: string;
}

interface TransactionRow {
  id: string;
  smart_session_id: string;
  wallet_address: string;
  txn_id: string;
  recipient: string;
  amount: string;
  network_id: SmartSessionNetworkId;
  asset_id: SmartSessionAssetId;
  status: string;
  txn_hash: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: ApiError['details']
  ) {
    super(message);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      const config = requireConfiguration(env);
      const surface = requestSurface(url, config);
      if (!surface) throw new HttpError(404, 'Not found');

      if (url.pathname === '/health') {
        return json({ ok: true });
      }
      if (!url.pathname.startsWith('/api/')) {
        return fetchStaticAsset(request, env, surface);
      }

      if (request.method === 'POST' && url.pathname === '/api/admin/bootstrap') {
        requireSurface(surface, 'dashboard');
        await bootstrapAdmin(env, await readJson<{ token: string }>(request));
        return json({ ok: true }, 201);
      }

      if (request.method === 'GET' && url.pathname === '/api/client-config') {
        requireSurface(surface, 'wallet');
        return json({ publishableKey: env.OMS_PUBLISHABLE_KEY } satisfies ClientConfig);
      }

      const approvalMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)$/);
      if (request.method === 'GET' && approvalMatch) {
        requireSurface(surface, 'wallet');
        return json(await getApproval(env, approvalMatch[1], config.dashboardOrigin));
      }

      const approveMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)\/approve$/);
      if (request.method === 'POST' && approveMatch) {
        requireSurface(surface, 'wallet');
        await approveRequest(
          env,
          approveMatch[1],
          await readJson<ApproveRequestBody>(request),
          config.dashboardOrigin
        );
        return json({ ok: true });
      }

      const rejectMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)\/reject$/);
      if (request.method === 'POST' && rejectMatch) {
        requireSurface(surface, 'wallet');
        await rejectRequest(env, rejectMatch[1], config.dashboardOrigin);
        return json({ ok: true });
      }

      if (url.pathname.startsWith('/api/admin/')) {
        requireSurface(surface, 'dashboard');
        const admin = await requireAdmin(request, env);
        if (request.method === 'GET' && url.pathname === '/api/admin/overview') {
          return json(await getAdminOverview(env, admin.racId, config.dashboardOrigin));
        }
        if (request.method === 'POST' && url.pathname === '/api/admin/rac') {
          await generateBackendRac(env, admin.racId);
          return json({ ok: true }, 201);
        }
        if (request.method === 'POST' && url.pathname === '/api/admin/rac/rotate') {
          await rotateBackendRac(env, admin.racId, config.dashboardOrigin);
          return json({ ok: true });
        }
        if (request.method === 'POST' && url.pathname === '/api/admin/approvals') {
          return json(
            await createApproval(
              env,
              admin.racId,
              config,
              await readJson<CreateApprovalBody>(request)
            ),
            201
          );
        }

        const approvalLinkMatch = url.pathname.match(/^\/api\/admin\/approvals\/([^/]+)\/link$/);
        if (request.method === 'POST' && approvalLinkMatch) {
          return json(await getApprovalLink(env, admin.racId, approvalLinkMatch[1], config));
        }

        const sessionMatch = url.pathname.match(/^\/api\/admin\/sessions\/([^/]+)$/);
        if (request.method === 'DELETE' && sessionMatch) {
          await dismissSession(env, admin.racId, sessionMatch[1], config.dashboardOrigin);
          return json({ ok: true });
        }

        const transactionMatch = url.pathname.match(
          /^\/api\/admin\/sessions\/([^/]+)\/transactions$/
        );
        if (request.method === 'POST' && transactionMatch) {
          return json(
            await createTransaction(
              env,
              admin.racId,
              transactionMatch[1],
              await readJson<CreateTransactionBody>(request),
              config.dashboardOrigin
            ),
            201
          );
        }

        const statusMatch = url.pathname.match(/^\/api\/admin\/transactions\/([^/]+)$/);
        if (request.method === 'GET' && statusMatch) {
          return json(
            await refreshTransaction(env, admin.racId, statusMatch[1], config.dashboardOrigin)
          );
        }
      }

      throw new HttpError(404, 'Not found');
    } catch (error) {
      if (error instanceof HttpError) {
        return json(
          {
            error: error.message,
            ...(error.details === undefined ? {} : { details: error.details })
          } satisfies ApiError,
          error.status
        );
      }
      console.error(error);
      return json({ error: 'Internal server error' }, 500);
    }
  }
} satisfies ExportedHandler<Env>;

async function getApproval(env: Env, token: string, origin: string): Promise<ApprovalRequest> {
  const row = await env.DB.prepare(
    `SELECT id, rac_id, credential_id, network_id, asset_id, recipient_mode, recipients, allowance,
      expires_at, created_at, approved_at, rejected_at
     FROM approval_requests WHERE token_hash = ?`
  )
    .bind(await sha256(token))
    .first<ApprovalRow>();

  if (!row) throw new HttpError(404, 'Approval request not found');
  if (approvalStatus(row) === 'pending' && Date.parse(row.expires_at) <= Date.now()) {
    throw new HttpError(410, 'Approval request has expired');
  }
  const credential = await requireCredential(env, row.rac_id, origin);
  if (row.credential_id !== credential.credential_id) {
    throw new HttpError(409, 'This approval request belongs to a previous backend RAC');
  }

  return {
    id: row.id,
    recipientScope: recipientScopeFromRow(row),
    allowance: row.allowance,
    expiresAt: row.expires_at,
    status: approvalStatus(row),
    credentialId: credential.credential_id,
    networkId: row.network_id,
    assetId: row.asset_id
  };
}

async function createApproval(
  env: Env,
  racId: string,
  config: DeploymentConfig,
  body: CreateApprovalBody
): Promise<CreatedApproval> {
  const { network, asset } = requireSmartSessionConfig(body.networkId, body.assetId);
  const recipientScope = requireRecipientScope(body.recipientScope, asset.kind);
  const allowance = positiveBigInt(body.allowance, 'allowance');
  const expiresAt = validFutureDate(body.expiresAt, 'expiresAt');
  const credential = await requireCredential(env, racId, config.dashboardOrigin);
  if (expiresAt.getTime() > Date.parse(credential.expires_at)) {
    throw new HttpError(400, 'Approval expiry cannot exceed the RAC expiry');
  }

  const id = crypto.randomUUID();
  const token = randomToken();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO approval_requests
      (id, rac_id, token, token_hash, credential_id, network_id, asset_id, recipient_mode,
       recipients, allowance,
       expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      racId,
      token,
      await sha256(token),
      credential.credential_id,
      network.id,
      asset.id,
      recipientScope.mode,
      JSON.stringify(recipientScope.mode === 'specific' ? recipientScope.recipients : []),
      allowance.toString(),
      expiresAt.toISOString(),
      now
    )
    .run();

  return {
    id,
    approvalUrl: approvalUrl(config.walletOrigin, token),
    expiresAt: expiresAt.toISOString()
  };
}

async function getApprovalLink(
  env: Env,
  racId: string,
  id: string,
  config: DeploymentConfig
): Promise<CreatedApproval> {
  const approval = await env.DB.prepare(
    `SELECT id, token, credential_id, expires_at, approved_at, rejected_at
     FROM approval_requests WHERE id = ? AND rac_id = ?`
  )
    .bind(id, racId)
    .first<{
      id: string;
      token: string;
      credential_id: string;
      expires_at: string;
      approved_at: string | null;
      rejected_at: string | null;
    }>();
  if (!approval) throw new HttpError(404, 'Approval request not found');
  if (approval.approved_at || approval.rejected_at) {
    throw new HttpError(409, 'Approval request was already used');
  }
  if (Date.parse(approval.expires_at) <= Date.now()) {
    throw new HttpError(410, 'Approval request has expired');
  }
  const credential = await requireCredential(env, racId, config.dashboardOrigin);
  if (approval.credential_id !== credential.credential_id) {
    throw new HttpError(409, 'This approval request belongs to a previous backend RAC');
  }

  return {
    id: approval.id,
    approvalUrl: approvalUrl(config.walletOrigin, approval.token),
    expiresAt: approval.expires_at
  };
}

async function approveRequest(
  env: Env,
  token: string,
  body: ApproveRequestBody,
  origin: string
): Promise<void> {
  if (!body.sessionId?.trim()) throw new HttpError(400, 'sessionId is required');
  if (!isAddress(body.walletAddress)) throw new HttpError(400, 'walletAddress is invalid');
  const approval = await env.DB.prepare(
    `SELECT id, rac_id, credential_id, network_id, asset_id, recipient_mode, recipients, allowance,
      expires_at, created_at, approved_at, rejected_at
     FROM approval_requests WHERE token_hash = ?`
  )
    .bind(await sha256(token))
    .first<ApprovalRow>();

  if (!approval) throw new HttpError(404, 'Approval request not found');
  if (approval.approved_at || approval.rejected_at) {
    throw new HttpError(409, 'Approval request was already used');
  }
  if (Date.parse(approval.expires_at) <= Date.now()) {
    throw new HttpError(410, 'Approval request has expired');
  }
  const credential = await requireCredential(env, approval.rac_id, origin);
  if (approval.credential_id !== credential.credential_id) {
    throw new HttpError(409, 'The backend RAC changed; reload and approve a new request');
  }
  const rac = await createRac(env, approval.rac_id);
  let session: RemoteAccessSession;
  try {
    session = await getSessionAfterAuthorization(rac, body.sessionId);
  } catch (error) {
    throw waasError('Unable to verify the authorized smart session', error);
  }
  validateAuthorizedSession(approval, session);

  const now = new Date().toISOString();
  const sessionRecordId = crypto.randomUUID();
  try {
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE approval_requests
         SET approved_at = ?, expires_at = ?
         WHERE id = ? AND rac_id = ? AND approved_at IS NULL AND rejected_at IS NULL`
      ).bind(now, session.expiresAt, approval.id, approval.rac_id),
      env.DB.prepare(
        `INSERT INTO smart_sessions
          (id, rac_id, approval_id, wallet_address, session_id, created_at)
         SELECT ?, rac_id, id, ?, ?, ?
         FROM approval_requests WHERE id = ? AND rac_id = ? AND approved_at = ?`
      ).bind(
        sessionRecordId,
        getAddress(body.walletAddress),
        body.sessionId,
        now,
        approval.id,
        approval.rac_id,
        now
      )
    ]);
    if (results.some((result) => result.meta.changes !== 1)) {
      throw new HttpError(409, 'Approval request was already completed');
    }
  } catch {
    throw new HttpError(409, 'Approval request was already completed');
  }
}

async function rejectRequest(env: Env, token: string, origin: string): Promise<void> {
  const approval = await env.DB.prepare(
    `SELECT id, rac_id, credential_id, expires_at, approved_at, rejected_at
     FROM approval_requests WHERE token_hash = ?`
  )
    .bind(await sha256(token))
    .first<
      Pick<
        ApprovalRow,
        'id' | 'rac_id' | 'credential_id' | 'expires_at' | 'approved_at' | 'rejected_at'
      >
    >();

  if (!approval) throw new HttpError(404, 'Approval request not found');
  if (approval.approved_at || approval.rejected_at) {
    throw new HttpError(409, 'Approval request was already used');
  }
  if (Date.parse(approval.expires_at) <= Date.now()) {
    throw new HttpError(410, 'Approval request has expired');
  }
  const credential = await requireCredential(env, approval.rac_id, origin);
  if (approval.credential_id !== credential.credential_id) {
    throw new HttpError(409, 'This approval request belongs to a previous backend RAC');
  }

  const result = await env.DB.prepare(
    `UPDATE approval_requests SET rejected_at = ?
     WHERE id = ? AND rac_id = ? AND approved_at IS NULL AND rejected_at IS NULL`
  )
    .bind(new Date().toISOString(), approval.id, approval.rac_id)
    .run();
  if (result.meta.changes !== 1) {
    throw new HttpError(409, 'Approval request was already completed');
  }
}

async function getAdminOverview(env: Env, racId: string, origin: string): Promise<AdminOverview> {
  const credential = await requireCredential(env, racId, origin);
  const rac = await createRac(env, racId);
  const [approvalResult, sessionResult, transactionResult, remoteSessions] = await Promise.all([
    env.DB.prepare(
      `SELECT id, rac_id, credential_id, network_id, asset_id, recipient_mode, recipients,
        allowance, expires_at, created_at, approved_at, rejected_at
       FROM approval_requests WHERE rac_id = ? ORDER BY created_at DESC LIMIT 50`
    )
      .bind(racId)
      .all<ApprovalRow>(),
    env.DB.prepare(
      `SELECT smart_sessions.id, smart_sessions.rac_id, smart_sessions.approval_id,
        smart_sessions.wallet_address, smart_sessions.session_id, smart_sessions.created_at,
        approval_requests.network_id, approval_requests.asset_id,
        approval_requests.recipient_mode, approval_requests.recipients,
        approval_requests.allowance, approval_requests.expires_at
       FROM smart_sessions
       JOIN approval_requests ON approval_requests.id = smart_sessions.approval_id
       WHERE smart_sessions.rac_id = ? AND approval_requests.credential_id = ?
         AND smart_sessions.dismissed_at IS NULL
       ORDER BY smart_sessions.created_at DESC LIMIT 50`
    )
      .bind(racId, credential.credential_id)
      .all<SessionRecordRow>(),
    env.DB.prepare(
      `SELECT transactions.id, transactions.smart_session_id, smart_sessions.wallet_address,
        approval_requests.network_id, approval_requests.asset_id, transactions.txn_id,
        transactions.recipient, transactions.amount, transactions.status, transactions.txn_hash,
        transactions.error,
        transactions.created_at, transactions.updated_at
       FROM transactions
       JOIN smart_sessions ON smart_sessions.id = transactions.smart_session_id
       JOIN approval_requests ON approval_requests.id = smart_sessions.approval_id
       WHERE smart_sessions.rac_id = ?
       ORDER BY transactions.created_at DESC LIMIT 50`
    )
      .bind(racId)
      .all<TransactionRow>(),
    rac.client
      .listSessions()
      .catch((error) => Promise.reject(waasError('Unable to list smart sessions', error)))
  ]);
  const resolvedSessions = await resolveSessionRecords(rac, sessionResult.results, remoteSessions);
  const sessionBalances = await getSessionBalances(
    env,
    resolvedSessions.filter(({ status }) => status === 'usable').map(({ row }) => row)
  );

  return {
    credential: {
      id: credential.credential_id,
      expiresAt: credential.expires_at
    },
    approvals: approvalResult.results.map(toAdminApproval),
    sessions: resolvedSessions.map(({ row, remote, usage, status }) =>
      toAdminSession(row, remote, usage, status, sessionBalances.get(row.id))
    ),
    transactions: transactionResult.results.map(toAdminTransaction)
  };
}

interface ResolvedSessionRecord {
  row: SessionRecordRow;
  remote?: RemoteAccessSession;
  usage: SmartSessionGrantUsage[];
  status: AdminSmartSession['status'];
}

async function resolveSessionRecords(
  rac: RacContext,
  rows: SessionRecordRow[],
  listedSessions: RemoteAccessSession[]
): Promise<ResolvedSessionRecord[]> {
  const listedById = new Map(listedSessions.map((session) => [session.sessionId, session]));
  const resolved: ResolvedSessionRecord[] = [];
  // WaaS requires signed requests to arrive in nonce order, so keep this RAC's reads sequential.
  for (const row of rows) {
    if (Date.parse(row.expires_at) <= Date.now()) {
      resolved.push({ row, usage: [], status: 'expired' });
      continue;
    }

    let remote = listedById.get(row.session_id);
    if (!remote) {
      try {
        remote = await rac.client.getSession({ sessionId: row.session_id });
      } catch (error) {
        if (isMissingSessionError(error)) {
          resolved.push({ row, usage: [], status: 'revoked' });
          continue;
        }
        throw waasError('Unable to reconcile a smart session', error);
      }
    }
    validateAuthorizedSession(row, remote);
    const network = getSmartSessionNetwork(row.network_id).network;
    let usage: SmartSessionGrantUsage[];
    try {
      usage = await rac.client.getSessionUsage({ sessionId: remote.sessionId, network });
    } catch (error) {
      throw waasError('Unable to load smart-session usage', error);
    }
    resolved.push({ row, remote, usage, status: 'usable' });
  }
  return resolved;
}

async function getSessionBalances(
  env: Env,
  sessions: SessionRecordRow[]
): Promise<Map<string, string | undefined>> {
  if (sessions.length === 0) return new Map();

  const groups = new Map<
    string,
    { walletAddress: string; networkId: SmartSessionNetworkId; sessions: SessionRecordRow[] }
  >();
  for (const session of sessions) {
    const key = `${session.wallet_address.toLowerCase()}:${session.network_id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.sessions.push(session);
    } else {
      groups.set(key, {
        walletAddress: session.wallet_address,
        networkId: session.network_id,
        sessions: [session]
      });
    }
  }

  const indexer = new OMSWallet({ publishableKey: env.OMS_PUBLISHABLE_KEY }).indexer;
  const balances = new Map<string, string | undefined>();
  await Promise.all(
    Array.from(groups.values(), async (group) => {
      const network = getSmartSessionNetwork(group.networkId);
      const tokenAddresses = Array.from(
        new Set(
          group.sessions.flatMap((session) => {
            const asset = getSmartSessionAsset(session.network_id, session.asset_id);
            return asset.kind === 'erc20' ? [asset.tokenAddress] : [];
          })
        )
      );
      try {
        const result = await indexer.getBalances({
          walletAddress: group.walletAddress,
          networks: [network.network],
          contractAddresses: tokenAddresses.length ? tokenAddresses : undefined,
          includeMetadata: false
        });
        for (const session of group.sessions) {
          const asset = getSmartSessionAsset(session.network_id, session.asset_id);
          const balance =
            asset.kind === 'native'
              ? result.nativeBalances.find((candidate) => candidate.chainId === network.network.id)
                  ?.balance
              : result.balances.find(
                  (candidate) =>
                    candidate.chainId === network.network.id &&
                    candidate.contractAddress.toLowerCase() === asset.tokenAddress.toLowerCase()
                )?.balance;
          balances.set(session.id, balance ?? '0');
        }
      } catch {
        for (const session of group.sessions) balances.set(session.id, undefined);
      }
    })
  );
  return balances;
}

async function createTransaction(
  env: Env,
  racId: string,
  sessionRecordId: string,
  body: CreateTransactionBody,
  origin: string
): Promise<AdminTransaction> {
  const amount = positiveBigInt(body.amount, 'amount');
  const session = await requireSessionRecord(env, racId, sessionRecordId);
  if (Date.parse(session.expires_at) <= Date.now()) {
    throw new HttpError(410, 'Smart session has expired');
  }

  const { network, asset } = requireSmartSessionConfig(session.network_id, session.asset_id);
  await requireCredential(env, racId, origin);
  const rac = await createRac(env, racId);
  let remote: RemoteAccessSession;
  let usage: SmartSessionGrantUsage[];
  try {
    remote = await rac.client.getSession({ sessionId: session.session_id });
    validateAuthorizedSession(session, remote);
    usage = await rac.client.getSessionUsage({
      sessionId: remote.sessionId,
      network: network.network
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (isMissingSessionError(error)) throw new HttpError(410, 'Smart session is no longer active');
    throw waasError('Unable to verify the smart session and its usage', error);
  }
  const recipient = requireAuthorizedTransfer(remote.grants, usage, asset, body.recipient, amount);

  try {
    const prepared = await rac.client.prepareTransaction(
      asset.kind === 'native'
        ? {
            walletId: remote.walletId,
            sessionId: remote.sessionId,
            network: network.network,
            to: recipient,
            value: amount
          }
        : {
            walletId: remote.walletId,
            sessionId: remote.sessionId,
            network: network.network,
            to: asset.tokenAddress,
            data: encodeFunctionData({
              abi: erc20TransferAbi,
              functionName: 'transfer',
              args: [recipient, amount]
            })
          }
    );
    const feeOption = prepared.sponsored
      ? undefined
      : prepared.feeOptions[0]
        ? feeOptionSelection(prepared.feeOptions[0], 0)
        : undefined;
    if (!prepared.sponsored && !feeOption) {
      throw new HttpError(502, 'WaaS did not return a usable fee option');
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO transactions
        (id, smart_session_id, txn_id, recipient, amount, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(id, session.id, prepared.txnId, recipient, amount.toString(), prepared.status, now, now)
      .run();

    try {
      const executed = await rac.client.executeTransaction({
        txnId: prepared.txnId,
        feeOption
      });
      let status = executed.status;
      let txnHash: string | undefined;
      const current = await rac.client
        .getTransactionStatus({ txnId: prepared.txnId })
        .catch(() => undefined);
      if (current) {
        status = current.status;
        txnHash = current.txnHash;
      }
      const updatedAt = new Date().toISOString();
      await env.DB.prepare(
        'UPDATE transactions SET status = ?, txn_hash = ?, updated_at = ? WHERE id = ?'
      )
        .bind(status, txnHash ?? null, updatedAt, id)
        .run();
      return {
        id,
        smartSessionId: session.id,
        walletAddress: session.wallet_address,
        txnId: prepared.txnId,
        recipient,
        amount: amount.toString(),
        networkId: session.network_id,
        assetId: session.asset_id,
        status,
        txnHash,
        createdAt: now,
        updatedAt
      };
    } catch (error) {
      const detail = isOMSWalletError(error) ? error.message : 'Execute request failed';
      await env.DB.prepare('UPDATE transactions SET error = ?, updated_at = ? WHERE id = ?')
        .bind(detail, new Date().toISOString(), id)
        .run();
      throw waasError('WaaS transaction execution was not confirmed', error);
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw waasError('WaaS rejected the smart-session transaction', error);
  }
}

async function requireSessionRecord(
  env: Env,
  racId: string,
  sessionRecordId: string
): Promise<SessionRecordRow> {
  const session = await env.DB.prepare(
    `SELECT smart_sessions.id, smart_sessions.rac_id, smart_sessions.approval_id,
      smart_sessions.wallet_address, smart_sessions.session_id, smart_sessions.created_at,
      approval_requests.network_id, approval_requests.asset_id,
      approval_requests.recipient_mode, approval_requests.recipients,
      approval_requests.allowance, approval_requests.expires_at
     FROM smart_sessions
     JOIN approval_requests ON approval_requests.id = smart_sessions.approval_id
     WHERE smart_sessions.id = ? AND smart_sessions.rac_id = ?
       AND smart_sessions.dismissed_at IS NULL`
  )
    .bind(sessionRecordId, racId)
    .first<SessionRecordRow>();
  if (!session) throw new HttpError(404, 'Smart session not found');
  return session;
}

async function dismissSession(
  env: Env,
  racId: string,
  sessionRecordId: string,
  origin: string
): Promise<void> {
  const session = await requireSessionRecord(env, racId, sessionRecordId);
  if (Date.parse(session.expires_at) > Date.now()) {
    await requireCredential(env, racId, origin);
    const rac = await createRac(env, racId);
    const listedSessions = await rac.client
      .listSessions()
      .catch((error) => Promise.reject(waasError('Unable to list smart sessions', error)));
    const [resolved] = await resolveSessionRecords(rac, [session], listedSessions);
    if (resolved?.status === 'usable') {
      throw new HttpError(409, 'Only revoked or expired smart sessions can be dismissed');
    }
  }

  const result = await env.DB.prepare(
    `UPDATE smart_sessions SET dismissed_at = ?
     WHERE id = ? AND rac_id = ? AND dismissed_at IS NULL`
  )
    .bind(new Date().toISOString(), session.id, racId)
    .run();
  if (result.meta.changes !== 1) throw new HttpError(404, 'Smart session not found');
}

async function refreshTransaction(
  env: Env,
  racId: string,
  id: string,
  origin: string
): Promise<AdminTransaction> {
  const row = await env.DB.prepare(
    `SELECT transactions.id, transactions.smart_session_id, smart_sessions.wallet_address,
      approval_requests.network_id, approval_requests.asset_id, transactions.txn_id,
      transactions.recipient, transactions.amount, transactions.status, transactions.txn_hash,
      transactions.error,
      transactions.created_at, transactions.updated_at
     FROM transactions
     JOIN smart_sessions ON smart_sessions.id = transactions.smart_session_id
     JOIN approval_requests ON approval_requests.id = smart_sessions.approval_id
     WHERE transactions.id = ? AND smart_sessions.rac_id = ?`
  )
    .bind(id, racId)
    .first<TransactionRow>();
  if (!row) throw new HttpError(404, 'Transaction not found');
  if (
    row.status === TransactionStatus.Failed ||
    (row.status === TransactionStatus.Executed && row.txn_hash)
  ) {
    return toAdminTransaction(row);
  }

  try {
    await requireCredential(env, racId, origin);
    const status = await (
      await createRac(env, racId)
    ).client.getTransactionStatus({
      txnId: row.txn_id
    });
    const updatedAt = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE transactions SET status = ?, txn_hash = ?, error = NULL, updated_at = ? WHERE id = ?`
    )
      .bind(status.status, status.txnHash ?? null, updatedAt, id)
      .run();
    return {
      ...toAdminTransaction(row),
      status: status.status,
      txnHash: status.txnHash,
      error: undefined,
      updatedAt
    };
  } catch (error) {
    throw waasError('WaaS transaction status lookup failed', error);
  }
}

async function requireCredential(
  env: Env,
  racId: string,
  dashboardOrigin: string
): Promise<CredentialRow> {
  requireConfiguration(env);
  const rac = await createRac(env, racId);
  const existing = await env.DB.prepare(
    `SELECT signer_id, credential_id, registered_at, expires_at
     FROM backend_racs WHERE id = ?`
  )
    .bind(racId)
    .first<Partial<CredentialRow>>();

  if (
    existing?.signer_id === rac.signerId &&
    existing.credential_id &&
    existing.registered_at &&
    existing.expires_at &&
    Date.parse(existing.expires_at) > Date.now()
  ) {
    return existing as CredentialRow;
  }

  try {
    const registered = await rac.client.registerCredential({
      lifetimeSeconds: RAC_LIFETIME_SECONDS,
      metadata: {
        appName: 'OMS Smart Session Admin',
        appUrl: dashboardOrigin,
        appLogoUrl: '',
        custom: { networks: 'polygon-amoy,polygon' }
      }
    });
    const registeredAt = new Date();
    const row: CredentialRow = {
      signer_id: rac.signerId,
      credential_id: registered.credentialId,
      registered_at: registeredAt.toISOString(),
      expires_at: new Date(registeredAt.getTime() + RAC_LIFETIME_SECONDS * 1000).toISOString()
    };
    await env.DB.prepare(
      `UPDATE backend_racs
       SET signer_id = ?, credential_id = ?, registered_at = ?, expires_at = ?
       WHERE id = ?`
    )
      .bind(row.signer_id, row.credential_id, row.registered_at, row.expires_at, racId)
      .run();
    return row;
  } catch (error) {
    throw waasError('Unable to register the backend RAC', error);
  }
}

async function createRac(env: Env, racId: string): Promise<RacContext> {
  requireConfiguration(env);
  const row = await env.DB.prepare('SELECT private_key FROM backend_racs WHERE id = ?')
    .bind(racId)
    .first<{ private_key: string | null }>();
  if (!row?.private_key) {
    throw new HttpError(409, 'Generate a backend RAC from the admin dashboard first');
  }
  return createRacContext(env.OMS_PUBLISHABLE_KEY, row.private_key, env.DB);
}

async function generateBackendRac(env: Env, racId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE backend_racs SET private_key = COALESCE(private_key, ?) WHERE id = ?`
  )
    .bind(generatePrivateKey(), racId)
    .run();
}

async function rotateBackendRac(env: Env, racId: string, origin: string): Promise<void> {
  const existing = await env.DB.prepare(
    `SELECT signer_id, credential_id, registered_at, expires_at
     FROM backend_racs WHERE id = ?`
  )
    .bind(racId)
    .first<Partial<CredentialRow>>();
  if (
    existing?.credential_id &&
    existing.expires_at &&
    Date.parse(existing.expires_at) > Date.now()
  ) {
    const rac = await createRac(env, racId);
    if (existing.signer_id === rac.signerId) {
      try {
        await rac.client.revokeCredential({ credentialId: existing.credential_id });
      } catch (error) {
        throw waasError('Unable to revoke the current backend RAC', error);
      }
    }
  }

  const statements = [
    env.DB.prepare(
      `DELETE FROM transactions
       WHERE smart_session_id IN (SELECT id FROM smart_sessions WHERE rac_id = ?)`
    ).bind(racId),
    env.DB.prepare('DELETE FROM smart_sessions WHERE rac_id = ?').bind(racId),
    env.DB.prepare('DELETE FROM approval_requests WHERE rac_id = ?').bind(racId),
    env.DB.prepare(
      `UPDATE backend_racs
       SET private_key = ?, signer_id = NULL, credential_id = NULL, registered_at = NULL,
         expires_at = NULL
       WHERE id = ?`
    ).bind(generatePrivateKey(), racId)
  ];
  if (existing?.signer_id) {
    statements.push(
      env.DB.prepare('DELETE FROM rac_nonces WHERE signer_id = ?').bind(existing.signer_id)
    );
  }
  await env.DB.batch(statements);
  await requireCredential(env, racId, origin);
}

async function bootstrapAdmin(env: Env, body: { token: string }): Promise<void> {
  const token = body.token?.trim();
  if (!token || token.length < 32) {
    throw new HttpError(400, 'Admin token must contain at least 32 characters');
  }

  const tokenHash = await sha256(token);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO backend_racs (id, token_hash, created_at)
     VALUES (?, ?, ?)`
  )
    .bind(crypto.randomUUID(), tokenHash, new Date().toISOString())
    .run();
}

async function requireAdmin(request: Request, env: Env): Promise<AdminContext> {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    throw new HttpError(401, 'Admin authorization required');
  }
  const token = authorization.slice('Bearer '.length);
  const stored = await env.DB.prepare('SELECT id FROM backend_racs WHERE token_hash = ?')
    .bind(await sha256(token))
    .first<{ id: string }>();
  if (!stored) {
    throw new HttpError(401, 'Admin authorization required');
  }
  return { racId: stored.id };
}

function requireConfiguration(env: Env): DeploymentConfig {
  if (!env.OMS_PUBLISHABLE_KEY?.trim()) throw new HttpError(500, 'OMS_PUBLISHABLE_KEY is missing');
  const walletOrigin = configuredOrigin(env.WALLET_ORIGIN, 'WALLET_ORIGIN');
  const dashboardOrigin = configuredOrigin(env.DASHBOARD_ORIGIN, 'DASHBOARD_ORIGIN');
  if (walletOrigin === dashboardOrigin) {
    throw new HttpError(500, 'WALLET_ORIGIN and DASHBOARD_ORIGIN must be different');
  }
  return { walletOrigin, dashboardOrigin };
}

function configuredOrigin(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new HttpError(500, `${name} is missing`);
  try {
    const url = new URL(value.trim());
    if (
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname)))
    ) {
      throw new Error();
    }
    return url.origin;
  } catch {
    throw new HttpError(500, `${name} must be an HTTPS origin without a path`);
  }
}

function requestSurface(url: URL, config: DeploymentConfig): RequestSurface | undefined {
  if (url.origin === config.walletOrigin) return 'wallet';
  if (url.origin === config.dashboardOrigin) return 'dashboard';
  return isLoopback(url.hostname) ? 'local' : undefined;
}

function requireSurface(surface: RequestSurface, expected: Exclude<RequestSurface, 'local'>): void {
  if (surface !== 'local' && surface !== expected) throw new HttpError(404, 'Not found');
}

function fetchStaticAsset(request: Request, env: Env, surface: RequestSurface): Promise<Response> {
  if (surface === 'local') return env.ASSETS.fetch(request);

  const url = new URL(request.url);
  if (surface === 'wallet') {
    if (url.pathname === '/dashboard' || url.pathname.startsWith('/dashboard/')) {
      throw new HttpError(404, 'Not found');
    }
    return env.ASSETS.fetch(request);
  }

  url.pathname =
    url.pathname === '/'
      ? '/dashboard/'
      : url.pathname === '/dashboard'
        ? '/dashboard/'
        : url.pathname.startsWith('/dashboard/')
          ? url.pathname
          : `/dashboard${url.pathname}`;
  return env.ASSETS.fetch(new Request(url, request));
}

function approvalUrl(walletOrigin: string, token: string): string {
  const url = new URL('/', walletOrigin);
  url.searchParams.set('request', token);
  return url.toString();
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON');
  }
}

function requireSmartSessionConfig(networkId: string, assetId: string) {
  if (!isSmartSessionNetworkId(networkId)) {
    throw new HttpError(400, 'networkId is not supported');
  }
  if (!isSmartSessionAssetId(assetId)) {
    throw new HttpError(400, 'assetId is not supported');
  }
  try {
    return {
      network: getSmartSessionNetwork(networkId),
      asset: getSmartSessionAsset(networkId, assetId)
    };
  } catch {
    throw new HttpError(400, `${assetId.toUpperCase()} is not available on this network`);
  }
}

function requireRecipientScope(
  scope: RecipientScope,
  assetKind: 'native' | 'erc20'
): RecipientScope {
  try {
    return validateRecipientScope(scope, assetKind);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'Recipient scope is invalid');
  }
}

function recipientScopeFromRow(
  row: Pick<ApprovalRow, 'network_id' | 'asset_id' | 'recipient_mode' | 'recipients'>
): RecipientScope {
  try {
    const asset = getSmartSessionAsset(row.network_id, row.asset_id);
    const scope: RecipientScope =
      row.recipient_mode === 'any'
        ? { mode: 'any' }
        : { mode: 'specific', recipients: JSON.parse(row.recipients) as string[] };
    return validateRecipientScope(scope, asset.kind);
  } catch {
    throw new HttpError(500, 'Stored recipient scope is invalid');
  }
}

function expectedSessionGrants(
  row: Pick<ApprovalRow, 'network_id' | 'asset_id' | 'recipient_mode' | 'recipients' | 'allowance'>
): SmartSessionGrant[] {
  const asset = getSmartSessionAsset(row.network_id, row.asset_id);
  return createSmartSessionGrants(asset, recipientScopeFromRow(row), BigInt(row.allowance));
}

function validateAuthorizedSession(
  approval: Pick<
    ApprovalRow,
    'network_id' | 'asset_id' | 'recipient_mode' | 'recipients' | 'allowance' | 'expires_at'
  >,
  session: RemoteAccessSession
): void {
  const expectedChainId = getSmartSessionNetwork(approval.network_id).network.id;
  if (session.chainId !== expectedChainId) {
    throw new HttpError(409, 'Authorized session uses a different network than requested');
  }
  const expectedGrants = expectedSessionGrants(approval);
  if (!sameGrantSet(session.grants, expectedGrants)) {
    throw new HttpError(409, 'Authorized session grants do not match the approval request');
  }
  const expiry = Date.parse(session.expiresAt);
  if (Number.isNaN(expiry) || expiry > Date.parse(approval.expires_at)) {
    throw new HttpError(409, 'Authorized session expiry exceeds the approval request');
  }
}

function requireAuthorizedTransfer(
  grants: ReadonlyArray<SmartSessionGrant>,
  usage: SmartSessionGrantUsage[],
  asset: SmartSessionAsset,
  recipientValue: string,
  amount: bigint
): `0x${string}` {
  if (!isAddress(recipientValue)) throw new HttpError(400, 'Recipient is not a valid address');
  const recipient = getAddress(recipientValue);
  const grant =
    grants.find((candidate) => {
      if (asset.kind === 'native') {
        return candidate.kind === 'nativeTransfer' && sameAddress(candidate.to, recipient);
      }
      return (
        candidate.kind === 'erc20Transfer' &&
        sameAddress(candidate.token, asset.tokenAddress) &&
        candidate.to !== undefined &&
        sameAddress(candidate.to, recipient)
      );
    }) ??
    grants.find(
      (candidate) =>
        asset.kind === 'erc20' &&
        candidate.kind === 'erc20Transfer' &&
        sameAddress(candidate.token, asset.tokenAddress) &&
        candidate.to === undefined
    );
  if (!grant) throw new HttpError(400, 'Recipient is not allowed by this smart session');
  const used = usage.find((entry) => sameGrant(entry.grant, grant))?.used;
  const remaining = used === undefined ? grant.limit : maxRemaining(grant.limit, used);
  if (amount > remaining) {
    throw new HttpError(400, 'Amount exceeds the remaining smart-session allowance');
  }
  return recipient;
}

function sameGrantSet(
  left: ReadonlyArray<SmartSessionGrant>,
  right: ReadonlyArray<SmartSessionGrant>
): boolean {
  if (left.length !== right.length) return false;
  const leftKeys = left.map(grantKey).sort();
  const rightKeys = right.map(grantKey).sort();
  return leftKeys.every((key, index) => key === rightKeys[index]);
}

function sameGrant(left: SmartSessionGrant, right: SmartSessionGrant): boolean {
  return grantKey(left) === grantKey(right);
}

function grantKey(grant: SmartSessionGrant): string {
  return grant.kind === 'nativeTransfer'
    ? `native:${grant.to.toLowerCase()}:${grant.limit}`
    : `erc20:${grant.token.toLowerCase()}:${grant.to?.toLowerCase() ?? '*'}:${grant.limit}:${grant.cumulative === true}`;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function maxRemaining(limit: bigint, used: bigint): bigint {
  return used >= limit ? 0n : limit - used;
}

function isMissingSessionError(error: unknown): boolean {
  if (!isOMSWalletError(error) && (typeof error !== 'object' || error === null)) return false;
  const status = 'status' in error ? error.status : undefined;
  return status === 401 || status === 403 || status === 404;
}

async function getSessionAfterAuthorization(
  rac: RacContext,
  sessionId: string
): Promise<RemoteAccessSession> {
  const retryDelays = [0, 100, 250, 500];
  let lastError: unknown;
  for (const delay of retryDelays) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      return await rac.client.getSession({ sessionId });
    } catch (error) {
      if (!isMissingSessionError(error)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

function positiveBigInt(value: string, field: string): bigint {
  try {
    const parsed = BigInt(value);
    if (parsed <= 0n) throw new Error();
    return parsed;
  } catch {
    throw new HttpError(400, `${field} must be a positive integer string`);
  }
}

function validFutureDate(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
    throw new HttpError(400, `${field} must be a future ISO date`);
  }
  return date;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function waasError(context: string, error: unknown): HttpError {
  const detail = isOMSWalletError(error) ? `: ${error.message}` : '';
  return new HttpError(502, `${context}${detail}`, serializeWaasError(error));
}

function toAdminApproval(row: ApprovalRow): AdminApproval {
  return {
    id: row.id,
    recipientScope: recipientScopeFromRow(row),
    allowance: row.allowance,
    expiresAt: row.expires_at,
    status: approvalStatus(row),
    networkId: row.network_id,
    assetId: row.asset_id,
    createdAt: row.created_at,
    approvedAt: row.approved_at ?? undefined,
    rejectedAt: row.rejected_at ?? undefined
  };
}

function approvalStatus(row: Pick<ApprovalRow, 'approved_at' | 'rejected_at'>): ApprovalStatus {
  if (row.rejected_at) return 'rejected';
  return row.approved_at ? 'approved' : 'pending';
}

function toAdminSession(
  row: SessionRecordRow,
  remote: RemoteAccessSession | undefined,
  usage: SmartSessionGrantUsage[],
  status: AdminSmartSession['status'],
  balance: string | undefined
): AdminSmartSession {
  const grants = remote?.grants ?? expectedSessionGrants(row);
  return {
    id: row.id,
    walletAddress: row.wallet_address,
    sessionId: row.session_id,
    grants: grants.map((grant) => toAdminGrant(grant, usage)),
    networkId: row.network_id,
    assetId: row.asset_id,
    expiresAt: remote?.expiresAt ?? row.expires_at,
    createdAt: row.created_at,
    status,
    balance
  };
}

function toAdminGrant(
  grant: SmartSessionGrant,
  usage: SmartSessionGrantUsage[]
): AdminSmartSessionGrant {
  const used = usage.find((entry) => sameGrant(entry.grant, grant))?.used;
  const remaining = used === undefined ? undefined : maxRemaining(grant.limit, used);
  return {
    ...grant,
    limit: grant.limit.toString(),
    ...(used === undefined ? {} : { used: used.toString() }),
    ...(remaining === undefined ? {} : { remaining: remaining.toString() })
  };
}

function toAdminTransaction(row: TransactionRow): AdminTransaction {
  return {
    id: row.id,
    smartSessionId: row.smart_session_id,
    walletAddress: row.wallet_address,
    txnId: row.txn_id,
    recipient: row.recipient,
    amount: row.amount,
    networkId: row.network_id,
    assetId: row.asset_id,
    status: row.status,
    txnHash: row.txn_hash ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}
