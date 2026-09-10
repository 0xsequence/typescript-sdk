import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { formatUnits, isAddress, parseUnits } from 'viem';

import type {
  AdminOverview,
  AdminSmartSessionGrant,
  AdminSmartSession,
  AdminTransaction,
  ApiError,
  CreatedApproval,
  RecipientScope
} from '../../shared/api';
import type { SmartSessionAssetId, SmartSessionNetworkId } from '../../shared/networks';
import {
  getSmartSessionAsset,
  getSmartSessionNetwork,
  SMART_SESSION_ASSETS,
  SMART_SESSION_NETWORKS
} from '../../shared/networks';
import { MAX_SMART_SESSION_GRANTS, validateRecipientScope } from '../../shared/permissions';
import '../../shared/styles.css';

const ADMIN_TOKEN_KEY = 'oms-smart-session-admin-token';
const DEFAULT_RECIPIENT = '0x120117a430b5bf1ba6752732196cb86976701d53';
const SUCCESS_STATUS_DURATION_MS = 5_000;

function App() {
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem(ADMIN_TOKEN_KEY) ?? '');
  const [recipientMode, setRecipientMode] = useState<RecipientScope['mode']>('specific');
  const [recipients, setRecipients] = useState([DEFAULT_RECIPIENT]);
  const [networkId, setNetworkId] = useState<SmartSessionNetworkId>('polygon-amoy');
  const [assetId, setAssetId] = useState<SmartSessionAssetId>('pol');
  const [allowance, setAllowance] = useState<string>(SMART_SESSION_ASSETS.pol.defaultAllowance);
  const [lifetimeMinutes, setLifetimeMinutes] = useState('8640');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [approvalLink, setApprovalLink] = useState('');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [transactionRecipients, setTransactionRecipients] = useState<Record<string, string>>({});
  const [isConfirmingRotation, setIsConfirmingRotation] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, string>>({
    backend: ''
  });
  const [pendingActions, setPendingActions] = useState<Set<string>>(() => new Set());
  const [isLoadingOverview, setIsLoadingOverview] = useState(Boolean(adminToken));
  const statusResetTimers = useRef<Record<string, number>>({});
  const pendingApprovals =
    overview?.approvals.filter((approval) => approval.status === 'pending') ?? [];
  const pendingApprovalsKey = pendingApprovals
    .map((approval) => `${approval.id}:${approval.expiresAt}`)
    .join('|');
  const usableSessionsKey =
    overview?.sessions
      .filter((session) => session.status === 'usable')
      .map((session) => session.id)
      .join('|') ?? '';
  const selectedNetwork = getSmartSessionNetwork(networkId);
  const selectedAsset = getSmartSessionAsset(networkId, assetId);

  useEffect(() => {
    if (adminToken) void restoreAdmin(adminToken);
  }, []);

  useEffect(
    () => () => {
      Object.values(statusResetTimers.current).forEach((timer) => window.clearTimeout(timer));
    },
    []
  );

  useEffect(() => {
    if (!overview?.transactions.some(shouldAutoRefreshTransaction)) return;
    const timer = window.setInterval(() => void refreshPendingTransactions(), 4000);
    return () => window.clearInterval(timer);
  }, [overview, adminToken]);

  useEffect(() => {
    if (!adminToken || (pendingApprovals.length === 0 && !usableSessionsKey)) return;

    let isPolling = false;
    const pollOverview = async () => {
      if (document.visibilityState !== 'visible' || isPolling) return;
      isPolling = true;
      try {
        setOverview(await adminApi<AdminOverview>('/api/admin/overview', adminToken));
      } catch {
        // The manual refresh remains available if a background status check fails.
      } finally {
        isPolling = false;
      }
    };
    const pollWhenVisible = () => void pollOverview();
    const timer = window.setInterval(pollWhenVisible, 10_000);
    document.addEventListener('visibilitychange', pollWhenVisible);
    window.addEventListener('focus', pollWhenVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', pollWhenVisible);
      window.removeEventListener('focus', pollWhenVisible);
    };
  }, [pendingApprovalsKey, usableSessionsKey, adminToken]);

  function updateStatus(key: string, message: string) {
    window.clearTimeout(statusResetTimers.current[key]);
    delete statusResetTimers.current[key];
    setStatuses((current) => ({ ...current, [key]: message }));
  }

  function updateTransientStatus(key: string, message: string) {
    updateStatus(key, message);
    statusResetTimers.current[key] = window.setTimeout(() => {
      delete statusResetTimers.current[key];
      setStatuses((current) => (current[key] === message ? { ...current, [key]: '' } : current));
    }, SUCCESS_STATUS_DURATION_MS);
  }

  function isActionPending(key: string): boolean {
    return pendingActions.has(key);
  }

  async function run(
    actionKey: string,
    label: string,
    action: () => Promise<void>,
    statusKey = actionKey
  ) {
    setPendingActions((current) => new Set(current).add(actionKey));
    updateStatus(statusKey, label);
    try {
      await action();
    } catch (error) {
      updateStatus(statusKey, messageFrom(error));
    } finally {
      setPendingActions((current) => {
        const next = new Set(current);
        next.delete(actionKey);
        return next;
      });
    }
  }

  async function initializeBackend() {
    await run('backend', 'Initializing browser admin access and backend RAC…', async () => {
      const token = localStorage.getItem(ADMIN_TOKEN_KEY) ?? randomToken();
      await bootstrapAdmin(token);
      localStorage.setItem(ADMIN_TOKEN_KEY, token);
      await generateRac(token);
      await loadOverview(token);
      setAdminToken(token);
      updateStatus('backend', '');
    });
  }

  async function restoreAdmin(token: string) {
    await run('backend', 'Restoring browser admin access and backend RAC…', async () => {
      await bootstrapAdmin(token);
      await generateRac(token);
      await loadOverview(token);
      updateStatus('backend', '');
    });
  }

  async function refresh() {
    await run(
      'refresh',
      'Loading backend records…',
      async () => {
        await loadOverview(adminToken);
        updateTransientStatus('backend', 'Backend records refreshed.');
      },
      'backend'
    );
  }

  async function rotateRac() {
    await run(
      'rac-rotation',
      'Rotating backend RAC…',
      async () => {
        await adminApi('/api/admin/rac/rotate', adminToken, { method: 'POST' });
        setIsConfirmingRotation(false);
        await loadOverview(adminToken);
        updateTransientStatus(
          'backend',
          'Backend RAC rotated. Its approval requests, sessions, and transaction history were cleared.'
        );
      },
      'backend'
    );
  }

  function selectNetwork(nextNetworkId: SmartSessionNetworkId) {
    const nextNetwork = getSmartSessionNetwork(nextNetworkId);
    setNetworkId(nextNetworkId);
    setApprovalLink('');
    if (!(nextNetwork.assetIds as ReadonlyArray<SmartSessionAssetId>).includes(assetId)) {
      const nextAssetId = nextNetwork.assetIds[0];
      const nextAsset = getSmartSessionAsset(nextNetworkId, nextAssetId);
      setAssetId(nextAssetId);
      setAllowance(nextAsset.defaultAllowance);
      if (nextAsset.kind === 'native') {
        setRecipientMode('specific');
        setRecipients((current) => [current[0] ?? DEFAULT_RECIPIENT]);
      }
    }
  }

  function selectAsset(nextAssetId: SmartSessionAssetId) {
    const nextAsset = getSmartSessionAsset(networkId, nextAssetId);
    setAssetId(nextAssetId);
    setAllowance(nextAsset.defaultAllowance);
    setApprovalLink('');
    if (nextAsset.kind === 'native') {
      setRecipientMode('specific');
      setRecipients((current) => [current[0] ?? DEFAULT_RECIPIENT]);
    }
  }

  function updateRecipient(index: number, recipient: string) {
    setRecipients((current) =>
      current.map((currentRecipient, currentIndex) =>
        currentIndex === index ? recipient : currentRecipient
      )
    );
    setApprovalLink('');
  }

  function addRecipient() {
    setRecipients((current) =>
      current.length < MAX_SMART_SESSION_GRANTS ? [...current, ''] : current
    );
    setApprovalLink('');
  }

  function removeRecipient(index: number) {
    setRecipients((current) => current.filter((_, currentIndex) => currentIndex !== index));
    setApprovalLink('');
  }

  async function createApproval() {
    await run('approval-request', 'Creating approval request…', async () => {
      const recipientScope = validateRecipientScope(
        recipientMode === 'any' ? { mode: 'any' } : { mode: 'specific', recipients },
        selectedAsset.kind
      );
      const lifetime = Number(lifetimeMinutes);
      if (!Number.isFinite(lifetime) || lifetime <= 0) throw new Error('Choose a valid lifetime.');
      const created = await adminApi<CreatedApproval>('/api/admin/approvals', adminToken, {
        method: 'POST',
        body: JSON.stringify({
          recipientScope,
          allowance: parseUnits(allowance, selectedAsset.decimals).toString(),
          networkId,
          assetId,
          expiresAt: new Date(Date.now() + lifetime * 60_000).toISOString()
        })
      });
      setApprovalLink(created.approvalUrl);
      await loadOverview();
      updateTransientStatus(
        'approval-request',
        'Approval link created. Send it to the wallet owner.'
      );
    });
  }

  async function sendTransaction(session: AdminSmartSession) {
    const statusKey = `session:${session.id}`;
    await run(statusKey, 'Preparing and executing through the backend RAC…', async () => {
      const asset = getSmartSessionAsset(session.networkId, session.assetId);
      const amount = amounts[session.id] ?? asset.defaultTransferAmount;
      const recipient = transactionRecipients[session.id] ?? defaultTransactionRecipient(session);
      if (!isAddress(recipient)) throw new Error('Enter a valid Ethereum receiver address.');
      const transaction = await adminApi<AdminTransaction>(
        `/api/admin/sessions/${encodeURIComponent(session.id)}/transactions`,
        adminToken,
        {
          method: 'POST',
          body: JSON.stringify({
            recipient,
            amount: parseUnits(amount, asset.decimals).toString()
          })
        }
      );
      await loadOverview();
      updateTransientStatus(
        statusKey,
        transaction.txnHash
          ? 'Transaction executed. Its hash and explorer link are shown below.'
          : 'Transaction submitted. Its status will refresh automatically below.'
      );
    });
  }

  async function dismissSession(session: AdminSmartSession) {
    const statusKey = `session:${session.id}`;
    await run(statusKey, 'Dismissing smart session…', async () => {
      await adminApi(`/api/admin/sessions/${encodeURIComponent(session.id)}`, adminToken, {
        method: 'DELETE'
      });
      await loadOverview();
    });
  }

  async function refreshTransaction(transaction: AdminTransaction) {
    const statusKey = `transaction:${transaction.id}`;
    await run(statusKey, 'Refreshing transaction status…', async () => {
      const refreshed = await adminApi<AdminTransaction>(
        `/api/admin/transactions/${encodeURIComponent(transaction.id)}`,
        adminToken
      );
      await loadOverview();
      updateTransientStatus(
        statusKey,
        refreshed.txnHash
          ? 'Transaction hash loaded.'
          : `Transaction status refreshed: ${refreshed.status}.`
      );
    });
  }

  async function refreshPendingTransactions() {
    if (!overview) return;
    const pending = overview.transactions.filter(shouldAutoRefreshTransaction);
    // Each route uses this dashboard's RAC, whose signed WaaS requests must remain ordered.
    for (const transaction of pending) {
      try {
        await adminApi(`/api/admin/transactions/${encodeURIComponent(transaction.id)}`, adminToken);
      } catch {
        // Keep refreshing the remaining transactions when one status lookup fails.
      }
    }
    await loadOverview();
  }

  async function loadOverview(token = adminToken) {
    setIsLoadingOverview(true);
    try {
      setOverview(await adminApi<AdminOverview>('/api/admin/overview', token));
    } finally {
      setIsLoadingOverview(false);
    }
  }

  async function copyApprovalLink() {
    const statusKey = 'approval-request';
    updateStatus(statusKey, 'Copying approval link…');
    try {
      await navigator.clipboard.writeText(approvalLink);
      updateTransientStatus(statusKey, 'Approval link copied.');
    } catch (error) {
      updateStatus(statusKey, messageFrom(error));
    }
  }

  async function copyStoredApprovalLink(approvalId: string) {
    const statusKey = `approval:${approvalId}`;
    updateStatus(statusKey, 'Loading owner approval link…');
    try {
      const approval = await adminApi<CreatedApproval>(
        `/api/admin/approvals/${encodeURIComponent(approvalId)}/link`,
        adminToken,
        { method: 'POST' }
      );
      const link = approval.approvalUrl;
      await navigator.clipboard.writeText(link);
      updateTransientStatus(statusKey, 'Owner approval link copied.');
    } catch (error) {
      updateStatus(statusKey, messageFrom(error));
    }
  }

  async function copySessionWalletAddress(session: AdminSmartSession) {
    const statusKey = `session-wallet:${session.id}`;
    updateStatus(statusKey, 'Copying wallet address…');
    try {
      await navigator.clipboard.writeText(session.walletAddress);
      updateTransientStatus(statusKey, 'Wallet address copied.');
    } catch (error) {
      updateStatus(statusKey, messageFrom(error));
    }
  }

  if (!adminToken) {
    return (
      <main className="dashboard-shell onboarding-shell">
        <section className="panel onboarding-panel">
          <header className="onboarding-topline">
            <p className="eyebrow">OMS Wallet TypeScript SDK</p>
            <span className="network-meta">Polygon</span>
          </header>

          <div className="onboarding-intro">
            <span className="onboarding-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M12 3 19 6v5c0 4.6-2.9 8.2-7 10-4.1-1.8-7-5.4-7-10V6l7-3Z" />
                <path d="M9.5 12h5M12 9.5v5" />
              </svg>
            </span>
            <div>
              <h1>Create your backend controller</h1>
              <p className="lede">
                Create an isolated backend RAC for this browser. Then request narrowly scoped
                permissions from wallet owners and execute only what they approve.
              </p>
            </div>
          </div>

          <ol className="onboarding-flow" aria-label="Smart-session flow">
            <li>
              <span>1</span>
              <div>
                <strong>Create a link</strong>
                <small>Define the receiver scope, allowance, and expiry.</small>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Owner approves</strong>
                <small>The wallet owner reviews the exact permission.</small>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Use the session</strong>
                <small>Submit only transactions allowed by that approval.</small>
              </div>
            </li>
          </ol>

          {isActionPending('backend') ? (
            <div className="onboarding-progress" aria-live="polite">
              <span className="dashboard-loading-spinner" aria-hidden="true" />
              <div>
                <strong>{statuses.backend}</strong>
                <small>Generating and registering a 30-day credential…</small>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="onboarding-action"
              onClick={() => void initializeBackend()}
            >
              Initialize backend RAC
            </button>
          )}

          {!isActionPending('backend') && statuses.backend ? (
            <output className="onboarding-status">{statuses.backend}</output>
          ) : null}

          <p className="onboarding-footnote">
            Admin access stays in this browser profile. The Worker stores the demo RAC key in D1.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <section className="dashboard-panel">
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">OMS Wallet TypeScript SDK</p>
            <h1>Smart-session administration</h1>
            <p className="lede">
              This browser profile administers one backend RAC and only its approval requests, smart
              sessions, and transactions.
            </p>
          </div>
          <div className="dashboard-header-actions">
            <span className="network-meta">RAC-scoped</span>
            <button
              type="button"
              className="secondary subtle"
              onClick={() => void refresh()}
              disabled={isActionPending('refresh')}
            >
              {isActionPending('refresh') ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </header>

        {statuses.backend ? <output className="section-status">{statuses.backend}</output> : null}

        {!overview && (isLoadingOverview || isActionPending('backend')) ? (
          <section className="dashboard-loading" aria-live="polite">
            <span className="dashboard-loading-spinner" aria-hidden="true" />
            <div>
              <strong>Loading smart-session dashboard</strong>
              <p>Preparing backend access and loading owner-approved permissions…</p>
            </div>
          </section>
        ) : null}

        {overview ? (
          <div className="credential-banner">
            <span>
              <strong>RAC credential ID</strong>
              <code>{overview.credential.id}</code>
            </span>
            <span>
              <strong>RAC credential expires</strong>
              <span>{new Date(overview.credential.expiresAt).toLocaleString()}</span>
            </span>
            <button
              type="button"
              className="secondary subtle"
              onClick={() => setIsConfirmingRotation(true)}
              disabled={isActionPending('rac-rotation')}
            >
              Rotate backend RAC
            </button>
          </div>
        ) : null}

        {isConfirmingRotation ? (
          <section className="rotation-confirmation">
            <p>
              Rotating revokes this dashboard's RAC credential. Every smart session authorized for
              that credential will become unusable, and the demo will delete only this RAC's
              approval requests, stored sessions, and transaction history.
            </p>
            <div className="actions">
              <button
                type="button"
                onClick={() => void rotateRac()}
                disabled={isActionPending('rac-rotation')}
              >
                {isActionPending('rac-rotation') ? 'Rotating…' : 'Confirm rotation'}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setIsConfirmingRotation(false)}
                disabled={isActionPending('rac-rotation')}
              >
                Cancel
              </button>
            </div>
          </section>
        ) : null}

        {overview ? (
          <div className="dashboard-grid">
            <section className="dashboard-card">
              <div className="tool-header">
                <h2>Request smart-session permission</h2>
                <span className="metadata-pill">
                  {selectedAsset.kind === 'native'
                    ? `Native ${selectedAsset.symbol}`
                    : selectedAsset.symbol}
                </span>
              </div>
              <p className="field-hint compact-hint">
                The wallet owner will review the receivers, allowance, network, and expiry before
                granting this backend RAC access.
              </p>
              <label>
                Network
                <span className="select-control">
                  <select
                    value={networkId}
                    onChange={(event) => selectNetwork(event.target.value as SmartSessionNetworkId)}
                  >
                    {Object.values(SMART_SESSION_NETWORKS).map((network) => (
                      <option key={network.id} value={network.id}>
                        {network.name}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
              <label>
                Asset
                <span className="select-control">
                  <select
                    value={assetId}
                    onChange={(event) => selectAsset(event.target.value as SmartSessionAssetId)}
                  >
                    {selectedNetwork.assetIds.map((availableAssetId) => {
                      const asset = SMART_SESSION_ASSETS[availableAssetId];
                      return (
                        <option key={asset.id} value={asset.id}>
                          {asset.symbol}
                        </option>
                      );
                    })}
                  </select>
                </span>
              </label>
              {selectedAsset.kind === 'erc20' ? (
                <p className="field-hint compact-hint">
                  {selectedAsset.name} contract: <code>{selectedAsset.tokenAddress}</code>
                </p>
              ) : null}
              {selectedAsset.kind === 'erc20' ? (
                <div className="recipient-scope-field">
                  <span className="field-label">Receivers</span>
                  <div className="recipient-scope-options" role="group" aria-label="Receiver scope">
                    <button
                      type="button"
                      className={recipientMode === 'specific' ? '' : 'secondary'}
                      aria-pressed={recipientMode === 'specific'}
                      onClick={() => {
                        setRecipientMode('specific');
                        setRecipients((current) =>
                          current.length ? current : [DEFAULT_RECIPIENT]
                        );
                        setApprovalLink('');
                      }}
                    >
                      Specific receivers
                    </button>
                    <button
                      type="button"
                      className={recipientMode === 'any' ? '' : 'secondary'}
                      aria-pressed={recipientMode === 'any'}
                      onClick={() => {
                        setRecipientMode('any');
                        setApprovalLink('');
                      }}
                    >
                      Any receiver
                    </button>
                  </div>
                  {recipientMode === 'specific' ? (
                    <div className="recipient-list">
                      {recipients.map((currentRecipient, index) => (
                        <div className="recipient-row" key={index}>
                          <label>
                            Receiver {index + 1}
                            <input
                              value={currentRecipient}
                              onChange={(event) => updateRecipient(index, event.target.value)}
                            />
                          </label>
                          {recipients.length > 1 ? (
                            <button
                              type="button"
                              className="secondary subtle recipient-remove"
                              aria-label={`Remove receiver ${index + 1}`}
                              onClick={() => removeRecipient(index)}
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                      ))}
                      <button
                        type="button"
                        className="secondary recipient-add"
                        onClick={addRecipient}
                        disabled={recipients.length >= MAX_SMART_SESSION_GRANTS}
                      >
                        + Add receiver
                      </button>
                    </div>
                  ) : (
                    <p className="field-hint compact-hint">
                      Transfers may be sent to any valid address. The allowance is cumulative across
                      all receivers.
                    </p>
                  )}
                </div>
              ) : (
                <label>
                  Receiver
                  <input
                    value={recipients[0] ?? ''}
                    onChange={(event) => updateRecipient(0, event.target.value)}
                  />
                  <small className="inline-field-hint">
                    Native permissions support exactly one receiver.
                  </small>
                </label>
              )}
              <label>
                {selectedAsset.kind === 'erc20' && recipientMode === 'specific'
                  ? `Cumulative allowance per receiver (${selectedAsset.symbol})`
                  : `Total cumulative allowance (${selectedAsset.symbol})`}
                <input
                  inputMode="decimal"
                  value={allowance}
                  onChange={(event) => setAllowance(event.target.value)}
                />
                {selectedAsset.kind === 'erc20' && recipientMode === 'specific' ? (
                  <small className="inline-field-hint">
                    Each receiver gets its own cumulative allowance.
                  </small>
                ) : null}
              </label>
              <label>
                Expires after
                <span className="select-control">
                  <select
                    value={lifetimeMinutes}
                    onChange={(event) => setLifetimeMinutes(event.target.value)}
                  >
                    <option value="30">30 minutes</option>
                    <option value="60">1 hour</option>
                    <option value="1440">1 day</option>
                    <option value="8640">6 days</option>
                  </select>
                </span>
              </label>
              <button
                type="button"
                onClick={() => void createApproval()}
                disabled={isActionPending('approval-request') || !overview}
              >
                {isActionPending('approval-request')
                  ? 'Creating approval link…'
                  : 'Create owner approval link'}
              </button>
              {approvalLink ? (
                <div className="approval-link">
                  <code>{approvalLink}</code>
                  <button
                    type="button"
                    className="secondary subtle copy-feedback-button"
                    onClick={() => void copyApprovalLink()}
                    disabled={statuses['approval-request'] === 'Copying approval link…'}
                  >
                    {statuses['approval-request'] === 'Copying approval link…'
                      ? 'Copying…'
                      : statuses['approval-request'] === 'Approval link copied.'
                        ? 'Copied'
                        : 'Copy'}
                  </button>
                </div>
              ) : null}
              {statuses['approval-request'] &&
              statuses['approval-request'] !== 'Copying approval link…' &&
              statuses['approval-request'] !== 'Approval link copied.' ? (
                <output className="section-status">{statuses['approval-request']}</output>
              ) : null}
            </section>

            <section className="dashboard-card wide-card">
              <div className="tool-header">
                <div>
                  <h2>Backend smart sessions</h2>
                  <p className="section-note">
                    Active, revoked, and expired sessions known to this backend RAC.
                  </p>
                </div>
                <span className="metadata-pill">{overview?.sessions.length ?? 0}</span>
              </div>
              <div className="card-list">
                {overview?.sessions.length ? (
                  overview.sessions.map((session) => (
                    <article className="session-card" key={session.id}>
                      <div className="tool-header">
                        <div>
                          <div className="session-wallet-address">
                            <strong>{shortAddress(session.walletAddress)}</strong>
                            <button
                              type="button"
                              className="secondary subtle"
                              onClick={() => void copySessionWalletAddress(session)}
                              disabled={
                                statuses[`session-wallet:${session.id}`] ===
                                'Copying wallet address…'
                              }
                              aria-label={`Copy wallet address ${session.walletAddress}`}
                            >
                              {statuses[`session-wallet:${session.id}`] ===
                              'Copying wallet address…'
                                ? 'Copying…'
                                : statuses[`session-wallet:${session.id}`] ===
                                    'Wallet address copied.'
                                  ? 'Copied'
                                  : statuses[`session-wallet:${session.id}`]
                                    ? 'Retry'
                                    : 'Copy'}
                            </button>
                          </div>
                          <small>Wallet owner</small>
                        </div>
                        <div className="row-actions">
                          <span
                            className={`status-badge ${session.status === 'usable' ? 'success-badge' : session.status === 'revoked' ? 'revoked-badge' : ''}`}
                          >
                            {session.status}
                          </span>
                          {session.status !== 'usable' ? (
                            <button
                              type="button"
                              className="secondary subtle"
                              onClick={() => void dismissSession(session)}
                              disabled={isActionPending(`session:${session.id}`)}
                            >
                              {isActionPending(`session:${session.id}`) ? 'Dismissing…' : 'Dismiss'}
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <dl className="detail-grid compact-details">
                        {session.status === 'usable' ? (
                          <Detail
                            label={`${recordNetwork(session).shortName} ${recordAsset(session).symbol} balance`}
                            value={
                              session.balance === undefined
                                ? 'Unavailable'
                                : formatAssetAmount(session, session.balance)
                            }
                          />
                        ) : (
                          <Detail
                            label="Session status"
                            value={session.status === 'expired' ? 'Expired' : 'Revoked'}
                          />
                        )}
                        <Detail label="Network" value={recordNetwork(session).name} />
                        {session.grants.map((grant, index) => (
                          <Detail
                            key={`${session.id}:grant:${index}`}
                            label={
                              session.grants.length === 1
                                ? 'Authorized grant'
                                : `Grant ${index + 1}`
                            }
                            value={formatSessionGrant(session, grant)}
                          />
                        ))}
                        <Detail
                          label="Permission expires"
                          value={new Date(session.expiresAt).toLocaleString()}
                        />
                        <Detail label="Smart-session ID" value={session.sessionId} code />
                      </dl>
                      {session.status === 'usable' ? (
                        <div className="send-row">
                          {sessionAllowsAnyRecipient(session) ? (
                            <label>
                              Receiver
                              <input
                                value={transactionRecipients[session.id] ?? ''}
                                onChange={(event) =>
                                  setTransactionRecipients({
                                    ...transactionRecipients,
                                    [session.id]: event.target.value
                                  })
                                }
                              />
                            </label>
                          ) : sessionRecipients(session).length > 1 ? (
                            <label>
                              Receiver
                              <span className="select-control">
                                <select
                                  value={
                                    transactionRecipients[session.id] ??
                                    sessionRecipients(session)[0]
                                  }
                                  onChange={(event) =>
                                    setTransactionRecipients({
                                      ...transactionRecipients,
                                      [session.id]: event.target.value
                                    })
                                  }
                                >
                                  {sessionRecipients(session).map((allowedRecipient) => (
                                    <option key={allowedRecipient} value={allowedRecipient}>
                                      {allowedRecipient}
                                    </option>
                                  ))}
                                </select>
                              </span>
                            </label>
                          ) : null}
                          <label>
                            Send {recordAsset(session).symbol}
                            <input
                              inputMode="decimal"
                              value={
                                amounts[session.id] ?? recordAsset(session).defaultTransferAmount
                              }
                              onChange={(event) =>
                                setAmounts({ ...amounts, [session.id]: event.target.value })
                              }
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => void sendTransaction(session)}
                            disabled={isActionPending(`session:${session.id}`)}
                          >
                            {isActionPending(`session:${session.id}`)
                              ? 'Sending…'
                              : 'Send with smart session'}
                          </button>
                        </div>
                      ) : null}
                      {statuses[`session:${session.id}`] ? (
                        <output className="section-status">
                          {statuses[`session:${session.id}`]}
                        </output>
                      ) : null}
                    </article>
                  ))
                ) : (
                  <p className="empty-state">No smart-session records yet.</p>
                )}
              </div>
            </section>

            <section className="dashboard-card">
              <div className="tool-header">
                <h2>Owner approval requests</h2>
                <span className="metadata-pill">{overview?.approvals.length ?? 0}</span>
              </div>
              <div className="card-list compact-list">
                {overview?.approvals.length ? (
                  overview.approvals.map((approval) => (
                    <article className="list-row" key={approval.id}>
                      <div>
                        <strong>{formatAssetAmount(approval, approval.allowance)}</strong>
                        <small>
                          {recordNetwork(approval).shortName} ·{' '}
                          {formatRecipientScope(approval.recipientScope, true)} ·{' '}
                          {new Date(approval.expiresAt).toLocaleString()}
                        </small>
                        {statuses[`approval:${approval.id}`] &&
                        statuses[`approval:${approval.id}`] !== 'Loading owner approval link…' &&
                        statuses[`approval:${approval.id}`] !== 'Owner approval link copied.' ? (
                          <output className="section-status">
                            {statuses[`approval:${approval.id}`]}
                          </output>
                        ) : null}
                      </div>
                      <div className="row-actions">
                        {approval.status === 'pending' ? (
                          <button
                            type="button"
                            className="secondary subtle copy-feedback-button"
                            onClick={() => void copyStoredApprovalLink(approval.id)}
                            disabled={
                              statuses[`approval:${approval.id}`] === 'Loading owner approval link…'
                            }
                          >
                            {statuses[`approval:${approval.id}`] === 'Loading owner approval link…'
                              ? 'Copying…'
                              : statuses[`approval:${approval.id}`] ===
                                  'Owner approval link copied.'
                                ? 'Copied'
                                : statuses[`approval:${approval.id}`]
                                  ? 'Retry'
                                  : 'Copy link'}
                          </button>
                        ) : null}
                        <span
                          className={`status-badge ${approval.status === 'approved' ? 'success-badge' : ''}`}
                        >
                          {approval.status}
                        </span>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="empty-state">No approval requests yet.</p>
                )}
              </div>
            </section>

            <section className="dashboard-card">
              <div className="tool-header">
                <h2>Backend transactions</h2>
                <span className="metadata-pill">{overview?.transactions.length ?? 0}</span>
              </div>
              <div className="card-list compact-list">
                {overview?.transactions.length ? (
                  overview.transactions.map((transaction) => (
                    <article className="list-row transaction-row" key={transaction.id}>
                      <div>
                        <strong>{formatAssetAmount(transaction, transaction.amount)}</strong>
                        <small
                          title={`Wallet ${transaction.walletAddress}; receiver ${transaction.recipient}`}
                        >
                          {recordNetwork(transaction).shortName} · Wallet{' '}
                          {shortAddress(transaction.walletAddress)} · Receiver{' '}
                          {shortAddress(transaction.recipient)}
                        </small>
                        {transaction.txnHash ? (
                          <>
                            <code>{transaction.txnHash}</code>
                            <a
                              href={`${recordNetwork(transaction).network.explorerUrl}/tx/${transaction.txnHash}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              View on {recordNetwork(transaction).explorerName}
                            </a>
                          </>
                        ) : (
                          <code>{transaction.txnId}</code>
                        )}
                        {transaction.error ? <small>{transaction.error}</small> : null}
                        {statuses[`transaction:${transaction.id}`] ? (
                          <output className="section-status">
                            {statuses[`transaction:${transaction.id}`]}
                          </output>
                        ) : null}
                      </div>
                      <div className="row-actions">
                        <span
                          className={`status-badge ${transaction.status === 'executed' ? 'success-badge' : ''}`}
                        >
                          {transaction.status}
                        </span>
                        {canRefreshTransaction(transaction) ? (
                          <button
                            type="button"
                            className="secondary subtle"
                            onClick={() => void refreshTransaction(transaction)}
                            disabled={isActionPending(`transaction:${transaction.id}`)}
                          >
                            {isActionPending(`transaction:${transaction.id}`)
                              ? 'Refreshing…'
                              : 'Refresh'}
                          </button>
                        ) : null}
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="empty-state">No transactions yet.</p>
                )}
              </div>
            </section>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function Detail({ label, value, code = false }: { label: string; value: string; code?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{code ? <code>{value}</code> : value}</dd>
    </div>
  );
}

interface AssetRecord {
  networkId: SmartSessionNetworkId;
  assetId: SmartSessionAssetId;
}

function recordNetwork(record: AssetRecord) {
  return getSmartSessionNetwork(record.networkId);
}

function recordAsset(record: AssetRecord) {
  return getSmartSessionAsset(record.networkId, record.assetId);
}

function formatAssetAmount(record: AssetRecord, amount: string): string {
  const asset = recordAsset(record);
  return `${formatUnits(BigInt(amount), asset.decimals)} ${asset.symbol}`;
}

function sessionRecipients(session: AdminSmartSession): string[] {
  return session.grants.flatMap((grant) => (grant.to ? [grant.to] : []));
}

function sessionAllowsAnyRecipient(session: AdminSmartSession): boolean {
  return session.grants.some((grant) => grant.kind === 'erc20Transfer' && grant.to === undefined);
}

function defaultTransactionRecipient(session: AdminSmartSession): string {
  return sessionAllowsAnyRecipient(session) ? '' : (sessionRecipients(session)[0] ?? '');
}

function formatSessionGrant(session: AdminSmartSession, grant: AdminSmartSessionGrant): string {
  const receiver = grant.to ? shortAddress(grant.to) : 'Any receiver';
  const limit = formatAssetAmount(session, grant.limit);
  if (grant.used === undefined) {
    return grant.kind === 'erc20Transfer' && grant.cumulative
      ? `${receiver}: ${limit} cumulative allowance`
      : `${receiver}: up to ${limit} per transaction`;
  }
  return `${receiver}: ${formatAssetAmount(session, grant.remaining ?? '0')} remaining of ${limit}`;
}

function formatRecipientScope(scope: RecipientScope, compact = false): string {
  if (scope.mode === 'any') return 'Any receiver';
  if (compact && scope.recipients.length > 1) return `${scope.recipients.length} receivers`;
  if (compact) return shortAddress(scope.recipients[0]);
  return scope.recipients.join(', ');
}

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function isPending(status: string): boolean {
  return status === 'pending' || status === 'quoted';
}

function shouldAutoRefreshTransaction(transaction: AdminTransaction): boolean {
  if (isPending(transaction.status)) return true;
  if (transaction.txnHash || transaction.status === 'failed') return false;
  const createdAt = Date.parse(transaction.createdAt);
  return Number.isFinite(createdAt) && Date.now() - createdAt < 2 * 60_000;
}

function canRefreshTransaction(transaction: AdminTransaction): boolean {
  return isPending(transaction.status) || (!transaction.txnHash && transaction.status !== 'failed');
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function adminApi<T = unknown>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...init?.headers
    }
  });
  const body = (await response.json()) as T | ApiError;
  if (!response.ok) throw new Error(apiErrorMessage(body, 'Request failed'));
  return body as T;
}

async function bootstrapAdmin(token: string): Promise<void> {
  const response = await fetch('/api/admin/bootstrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  });
  const body = (await response.json()) as { ok: true } | ApiError;
  if (!response.ok) {
    throw new Error(apiErrorMessage(body, 'Unable to initialize admin access'));
  }
}

function apiErrorMessage(body: unknown, fallback: string): string {
  if (typeof body !== 'object' || body === null || !('error' in body)) return fallback;
  const error = body as ApiError;
  return error.details?.cause ? `${error.error}: ${error.details.cause}` : error.error;
}

async function generateRac(token: string): Promise<void> {
  await adminApi('/api/admin/rac', token, { method: 'POST' });
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
