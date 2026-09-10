import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  findNetworkById,
  Networks,
  OMSWallet,
  OmsRelayOidcProviders,
  type ContractTokenBalance,
  type NativeTokenBalance,
  type PendingWalletSelection,
  type RemoteAccessGrant,
  type SmartSessionGrant,
  type WalletAccount,
  type WalletActivationResult
} from '@polygonlabs/oms-wallet';
import { formatUnits, type Address } from 'viem';

import {
  EmailCodeForm,
  EmailLoginForm,
  OidcButtons,
  WalletSelectionPanel
} from '../../../shared/example-components';
import {
  formatOidcProvider,
  hasOidcCallbackParams,
  isPendingWalletSelection,
  type OidcRedirectProvider
} from '../../../shared/example-utils';
import type { ApiError, ApprovalRequest, ClientConfig, RecipientScope } from '../../shared/api';
import {
  BASE_USDC,
  getSmartSessionAsset,
  getSmartSessionNetwork,
  SMART_SESSION_NETWORKS
} from '../../shared/networks';
import { createSmartSessionGrants } from '../../shared/permissions';
import polygonPolIconUrl from './assets/polygon-pol.svg';
import polygonUsdtIconUrl from './assets/polygon-usdt.svg';
import { resolveBalanceUsd } from './portfolio';
import {
  AUTO_CONVERT_POLL_INTERVAL_MS,
  convertPolygonUsdtToBaseUsdc,
  getPolygonUsdtBalance,
  IDLE_AUTO_CONVERT_PROGRESS,
  isAbortError,
  trailsAutoConvertErrorMessage,
  type TrailsAutoConvertPhase,
  type TrailsAutoConvertProgress
} from './trailsAutoConvert';
import '../../shared/styles.css';

type SignInStep = 'email' | 'code' | 'wallet-selection' | 'wallet';
type ApprovedSession = RemoteAccessGrant & { chainId?: number };
type ApprovalAction = 'authorizing' | 'confirming' | 'rejecting' | null;

interface PortfolioAssetBalance {
  key: string;
  networkName: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: string;
  balanceUsd?: number;
  iconUrl?: string;
}

interface WalletPortfolio {
  assets: PortfolioAssetBalance[];
  totalBalanceUsd?: number;
}

const PENDING_APPROVAL_TOKEN_KEY = 'oms-smart-session-pending-approval-token';
const PORTFOLIO_REFRESH_INTERVAL_MS = 5_000;
const SUCCESS_STATUS_DURATION_MS = 5_000;
const PERMISSION_APPROVED_STATUS = 'Permission approved. The new smart session is ready to use.';
const PERMISSION_REJECTED_STATUS = 'Permission rejected. No new smart-session access was granted.';
const SESSION_REVOKED_STATUS = 'Session revoked.';
const TRANSIENT_OWNER_STATUSES = new Set([
  PERMISSION_APPROVED_STATUS,
  PERMISSION_REJECTED_STATUS,
  'This smart-session request has already been approved.',
  'This smart-session request was rejected.'
]);

function App() {
  const initialApprovalToken = useMemo(() => {
    const requestToken = new URLSearchParams(window.location.search).get('request');
    if (requestToken) return requestToken;
    return hasOidcCallbackParams()
      ? (sessionStorage.getItem(PENDING_APPROVAL_TOKEN_KEY) ?? '')
      : '';
  }, []);
  const [approvalToken, setApprovalToken] = useState(initialApprovalToken);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [omsWallet, setOmsWallet] = useState<OMSWallet | null>(null);
  const [step, setStep] = useState<SignInStep>('email');
  const [pendingWalletSelection, setPendingWalletSelection] =
    useState<PendingWalletSelection | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [approvedSessions, setApprovedSessions] = useState<ApprovedSession[]>([]);
  const [approvedSessionsStatus, setApprovedSessionsStatus] = useState('');
  const [approvedSessionsLoading, setApprovedSessionsLoading] = useState(false);
  const [portfolio, setPortfolio] = useState<WalletPortfolio | null>(null);
  const [portfolioStatus, setPortfolioStatus] = useState('');
  const [addressCopyStatus, setAddressCopyStatus] = useState('');
  const [walletSettingsOpen, setWalletSettingsOpen] = useState(false);
  const [autoConvertArmed, setAutoConvertArmed] = useState(false);
  const [autoConvertProgress, setAutoConvertProgress] = useState<TrailsAutoConvertProgress>(
    IDLE_AUTO_CONVERT_PROGRESS
  );
  const [sessionPendingRevocation, setSessionPendingRevocation] = useState('');
  const [status, setStatus] = useState(initialApprovalToken ? 'Loading approval request…' : '');
  const [approvalAction, setApprovalAction] = useState<ApprovalAction>(null);
  const [isBusy, setIsBusy] = useState(false);
  const initializationStarted = useRef(false);
  const walletAddress = omsWallet?.wallet.walletAddress ?? '';
  const sessionAuth = omsWallet?.wallet.session.auth;
  const loginMethod =
    sessionAuth?.type === 'email'
      ? 'Email'
      : (sessionAuth?.providerLabel ?? sessionAuth?.provider ?? 'OIDC');
  const loginIdentity = sessionAuth
    ? [loginMethod, sessionAuth.email].filter(Boolean).join(' — ')
    : '';

  useEffect(() => {
    if (initializationStarted.current) return;
    initializationStarted.current = true;
    void initializeClient();
  }, []);

  useEffect(() => {
    if (!autoConvertArmed || !omsWallet || !walletAddress) return;

    const controller = new AbortController();
    void (async () => {
      setAutoConvertProgress({
        phase: 'watching',
        message: 'Watching Polygon for a USDT balance…'
      });
      try {
        while (!controller.signal.aborted) {
          const balance = await getPolygonUsdtBalance(omsWallet, walletAddress as Address);
          if (controller.signal.aborted) return;

          if (balance > 0n) {
            setAutoConvertProgress({
              phase: 'watching',
              message: 'Polygon USDT detected. Starting the one-time conversion…',
              inputAmountRaw: balance.toString()
            });
            await convertPolygonUsdtToBaseUsdc({
              amount: balance,
              onProgress: setAutoConvertProgress,
              signal: controller.signal,
              wallet: omsWallet,
              walletAddress: walletAddress as Address
            });
            await loadPortfolio(omsWallet);
            return;
          }

          setAutoConvertProgress({
            phase: 'watching',
            message: `No Polygon USDT detected. Last checked ${new Date().toLocaleTimeString()}.`
          });
          await waitForAutoConvertPoll(controller.signal);
        }
      } catch (error) {
        if (isAbortError(error)) return;
        setAutoConvertProgress((current) => ({
          ...current,
          phase: 'error',
          message: trailsAutoConvertErrorMessage(error)
        }));
      } finally {
        setAutoConvertArmed(false);
      }
    })();

    return () => controller.abort();
  }, [autoConvertArmed, omsWallet, walletAddress]);

  useEffect(() => {
    if (addressCopyStatus !== 'Copied') return;
    const timeout = window.setTimeout(() => setAddressCopyStatus(''), 2_000);
    return () => window.clearTimeout(timeout);
  }, [addressCopyStatus]);

  useEffect(() => {
    if (!TRANSIENT_OWNER_STATUSES.has(status)) return;
    const timeout = window.setTimeout(() => setStatus(''), SUCCESS_STATUS_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [status]);

  useEffect(() => {
    if (approvedSessionsStatus !== SESSION_REVOKED_STATUS) return;
    const timeout = window.setTimeout(
      () => setApprovedSessionsStatus(''),
      SUCCESS_STATUS_DURATION_MS
    );
    return () => window.clearTimeout(timeout);
  }, [approvedSessionsStatus]);

  useEffect(() => {
    if (!omsWallet || !walletAddress) return;

    let refreshInProgress = false;
    const interval = window.setInterval(() => {
      if (refreshInProgress) return;
      refreshInProgress = true;
      void loadPortfolio(omsWallet, { background: true }).finally(() => {
        refreshInProgress = false;
      });
    }, PORTFOLIO_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [omsWallet, walletAddress]);

  async function initializeClient() {
    try {
      const config = await api<ClientConfig>('/api/client-config');
      const nextWallet = new OMSWallet({ publishableKey: config.publishableKey });
      setOmsWallet(nextWallet);

      let redirectResult: PendingWalletSelection | WalletActivationResult | void = undefined;
      if (hasOidcCallbackParams()) {
        setIsBusy(true);
        setStatus('Completing redirect sign-in…');
        try {
          redirectResult = await nextWallet.wallet.completeOidcRedirectAuth({
            replaceUrl: (cleanUrl) => restoreApprovalRequestUrl(cleanUrl, approvalToken)
          });
        } finally {
          setIsBusy(false);
        }
      }

      const nextApproval = approvalToken
        ? await api<ApprovalRequest>(`/api/approvals/${encodeURIComponent(approvalToken)}`)
        : null;
      setApproval(nextApproval);

      if (nextApproval && nextApproval.status !== 'pending') {
        clearApprovalRequest();
        if (nextWallet.wallet.walletAddress) {
          setStep('wallet');
          await Promise.all([
            loadPortfolio(nextWallet),
            loadApprovedSessions(nextWallet, {
              loadingLabel: 'Refreshing approved smart sessions…'
            })
          ]);
        }
        setStatus(
          nextApproval.status === 'approved'
            ? 'This smart-session request has already been approved.'
            : 'This smart-session request was rejected.'
        );
        return;
      }

      if (redirectResult) {
        await handleAuthCompletion(redirectResult, nextWallet);
        return;
      }

      if (!approvalToken) {
        if (nextWallet.wallet.walletAddress) {
          setStep('wallet');
          setStatus('');
          await Promise.all([loadPortfolio(nextWallet), loadApprovedSessions(nextWallet)]);
        } else {
          setStatus('');
        }
        return;
      }

      if (nextWallet.wallet.walletAddress) {
        setStep('wallet');
        setStatus('');
        await loadPortfolio(nextWallet);
      } else {
        setStatus('');
      }
    } catch (error) {
      setStatus(messageFrom(error));
    }
  }

  async function run(label: string, action: () => Promise<void>) {
    setIsBusy(true);
    setStatus(label);
    try {
      await action();
    } catch (error) {
      setStatus(messageFrom(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function sendCode() {
    if (!omsWallet || !email.trim()) return;
    await run('Sending verification code…', async () => {
      setPendingWalletSelection(null);
      await omsWallet.wallet.startEmailAuth({ email: email.trim() });
      setStep('code');
      setStatus('Code sent. Check your email.');
    });
  }

  async function completeSignIn() {
    if (!omsWallet || !code.trim()) return;
    await run('Signing in…', async () => {
      const result = await omsWallet.wallet.completeEmailAuth({ code: code.trim() });
      await handleAuthCompletion(result);
    });
  }

  async function startOidcLogin(provider: OidcRedirectProvider) {
    if (!omsWallet) return;
    const label = formatOidcProvider(provider);
    await run(`Redirecting to ${label}…`, async () => {
      setPendingWalletSelection(null);
      if (approvalToken) {
        sessionStorage.setItem(PENDING_APPROVAL_TOKEN_KEY, approvalToken);
      }
      await omsWallet.wallet.signInWithOidcRedirect({
        provider:
          provider === 'google' ? OmsRelayOidcProviders.google : OmsRelayOidcProviders.apple,
        omsRelayReturnUri: new URL('/', window.location.origin).toString()
      });
    });
  }

  async function handleAuthCompletion(
    result: PendingWalletSelection | WalletActivationResult,
    wallet = omsWallet
  ): Promise<void> {
    if (isPendingWalletSelection(result)) {
      setPendingWalletSelection(result);
      setStep('wallet-selection');
      setStatus('');
      return;
    }

    setPendingWalletSelection(null);
    setStep('wallet');
    setStatus('');
    await loadPortfolio(wallet);
    if (!approvalToken) await loadApprovedSessions(wallet);
  }

  async function selectPendingWallet(wallet: WalletAccount) {
    if (!pendingWalletSelection) return;
    await run('Selecting wallet…', async () => {
      const result = await pendingWalletSelection.selectWallet({ walletId: wallet.id });
      await handleAuthCompletion(result);
    });
  }

  async function createPendingWallet() {
    if (!pendingWalletSelection) return;
    await run('Creating wallet…', async () => {
      const result = await pendingWalletSelection.createAndSelectWallet({
        reference: 'smart-session-owner'
      });
      await handleAuthCompletion(result);
    });
  }

  async function cancelPendingWalletSelection() {
    if (!omsWallet) return;
    await run('Cancelling wallet selection…', async () => {
      await omsWallet.wallet.signOut();
      setPendingWalletSelection(null);
      setCode('');
      setStep('email');
      setStatus('');
    });
  }

  async function approve() {
    if (!omsWallet || !approval || !walletAddress) return;
    setApprovalAction('authorizing');
    try {
      await run('Authorizing smart session…', async () => {
        const network = getSmartSessionNetwork(approval.networkId);
        const asset = getSmartSessionAsset(approval.networkId, approval.assetId);
        const { sessionId } = await omsWallet.wallet.authorizeRemoteAccess({
          credentialId: approval.credentialId,
          network: network.network,
          grants: createSmartSessionGrants(
            asset,
            approval.recipientScope,
            BigInt(approval.allowance)
          ),
          expiresAt: approval.expiresAt
        });
        setApprovalAction('confirming');
        setStatus('Confirming permission with the backend…');
        await api(`/api/approvals/${encodeURIComponent(approvalToken)}/approve`, {
          method: 'POST',
          body: JSON.stringify({
            walletAddress,
            sessionId
          })
        });
        setApproval({ ...approval, status: 'approved' });
        clearApprovalRequest();
        setStatus(PERMISSION_APPROVED_STATUS);
        await loadApprovedSessions(omsWallet, {
          loadingLabel: 'Refreshing approved smart sessions…'
        });
      });
    } finally {
      setApprovalAction(null);
    }
  }

  async function rejectApproval() {
    if (!approval) return;
    setApprovalAction('rejecting');
    try {
      await run('Rejecting permission…', async () => {
        await api(`/api/approvals/${encodeURIComponent(approvalToken)}/reject`, {
          method: 'POST'
        });
        setApproval({ ...approval, status: 'rejected' });
        clearApprovalRequest();
        setStatus(PERMISSION_REJECTED_STATUS);
        await loadApprovedSessions(omsWallet, {
          loadingLabel: 'Refreshing approved smart sessions…'
        });
      });
    } finally {
      setApprovalAction(null);
    }
  }

  async function signOut() {
    if (!omsWallet) return;
    await run('Signing out…', async () => {
      await omsWallet.wallet.signOut();
      setApprovedSessions([]);
      setApprovedSessionsStatus('');
      setPortfolio(null);
      setPortfolioStatus('');
      setAddressCopyStatus('');
      setWalletSettingsOpen(false);
      setAutoConvertArmed(false);
      setAutoConvertProgress(IDLE_AUTO_CONVERT_PROGRESS);
      setSessionPendingRevocation('');
      setPendingWalletSelection(null);
      setStep('email');
      setCode('');
      setStatus('');
    });
  }

  async function loadPortfolio(
    wallet = omsWallet,
    { background = false }: { background?: boolean } = {}
  ): Promise<void> {
    const address = wallet?.wallet.walletAddress;
    if (!wallet || !address) {
      setPortfolio(null);
      setPortfolioStatus('');
      return;
    }

    if (!background) {
      setPortfolio(null);
      setPortfolioStatus('Loading balances…');
    }
    try {
      const result = await wallet.indexer.getBalances({
        walletAddress: address,
        networkType: 'ALL',
        includeMetadata: true
      });
      const balances = [
        ...result.nativeBalances.filter(hasPositiveBalance).map(nativePortfolioAsset),
        ...result.balances
          .filter(
            (balance) =>
              balance.contractType.toUpperCase() === 'ERC20' && hasPositiveBalance(balance)
          )
          .map(contractPortfolioAsset)
      ].sort(comparePortfolioAssets);
      const pricedBalances = balances
        .map((balance) => balance.balanceUsd)
        .filter((balance): balance is number => balance !== undefined);
      setPortfolio({
        assets: balances,
        totalBalanceUsd: pricedBalances.length
          ? pricedBalances.reduce((total, balance) => total + balance, 0)
          : undefined
      });
      setPortfolioStatus('');
    } catch (error) {
      if (!background) setPortfolio(null);
      setPortfolioStatus(`Balances unavailable: ${messageFrom(error)}`);
    }
  }

  async function copyWalletAddress() {
    if (!walletAddress) return;
    try {
      await navigator.clipboard.writeText(walletAddress);
      setAddressCopyStatus('Copied');
    } catch (error) {
      setAddressCopyStatus('Copy failed');
      setStatus(messageFrom(error));
    }
  }

  function setOneTimeAutoConvert(enabled: boolean) {
    if (isAutoConvertProcessing(autoConvertProgress.phase)) return;
    setAutoConvertArmed(enabled);
    setAutoConvertProgress(
      enabled
        ? { phase: 'watching', message: 'Watching Polygon for a USDT balance…' }
        : IDLE_AUTO_CONVERT_PROGRESS
    );
  }

  async function loadApprovedSessions(
    wallet = omsWallet,
    { loadingLabel = 'Loading approved smart sessions…' }: { loadingLabel?: string } = {}
  ): Promise<boolean> {
    if (!wallet?.wallet.walletAddress) {
      setApprovedSessions([]);
      setApprovedSessionsStatus('');
      setApprovedSessionsLoading(false);
      return false;
    }

    setApprovedSessionsLoading(true);
    setApprovedSessionsStatus(loadingLabel);
    try {
      const access = await wallet.wallet.listAccess({ type: 'remote' });
      const remoteAccess = access.filter(
        (grant): grant is RemoteAccessGrant => grant.type === 'remote'
      );
      const sessions: ApprovedSession[] = [];
      let missingChainDetails = 0;
      // These signed wallet reads share one credential nonce and must remain ordered.
      for (const grant of remoteAccess) {
        try {
          const session = await wallet.wallet.getRemoteAccessSession({
            sessionId: grant.sessionId
          });
          sessions.push({ ...grant, chainId: session.chainId });
        } catch {
          sessions.push(grant);
          missingChainDetails += 1;
        }
      }
      setApprovedSessions(sessions);
      setApprovedSessionsStatus(
        missingChainDetails
          ? `${missingChainDetails} smart session${missingChainDetails === 1 ? '' : 's'} could not load network details.`
          : remoteAccess.length
            ? ''
            : 'No approved smart sessions for this wallet.'
      );
      return true;
    } catch (error) {
      setApprovedSessionsStatus(messageFrom(error));
      return false;
    } finally {
      setApprovedSessionsLoading(false);
    }
  }

  async function revokeSession(session: ApprovedSession) {
    if (!omsWallet) return;

    setIsBusy(true);
    setApprovedSessionsStatus('Revoking smart session…');
    try {
      await omsWallet.wallet.revokeAccess({
        credentialId: session.credentialId,
        sessionId: session.sessionId
      });
      setApprovedSessions((current) =>
        current.filter((candidate) => sessionKey(candidate) !== sessionKey(session))
      );

      if (!(await loadApprovedSessions(omsWallet))) return;
      setApprovedSessionsStatus(SESSION_REVOKED_STATUS);
    } catch (error) {
      setApprovedSessionsStatus(messageFrom(error));
    } finally {
      setSessionPendingRevocation('');
      setIsBusy(false);
    }
  }

  function clearApprovalRequest() {
    sessionStorage.removeItem(PENDING_APPROVAL_TOKEN_KEY);
    setApprovalToken('');
    window.history.replaceState(null, '', new URL('/', window.location.origin));
  }

  return (
    <main className="shell wallet-owner-shell">
      <section className="panel approval-panel wallet-owner-panel">
        <header className="wallet-owner-topbar">
          <div className="wallet-owner-brand">
            <span className="wallet-owner-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M4 7.5A3.5 3.5 0 0 1 7.5 4H18v4H7.5A3.5 3.5 0 0 0 4 11.5v-4Z" />
                <path d="M4 10.5h16v9H7.5A3.5 3.5 0 0 1 4 16v-5.5Z" />
                <path d="M16 13.5h4v3h-4a1.5 1.5 0 0 1 0-3Z" />
              </svg>
            </span>
            <strong>OMS Wallet</strong>
          </div>
          {walletAddress ? (
            <div className="wallet-owner-account">
              {!approvalToken ? (
                <div className="wallet-settings">
                  <button
                    type="button"
                    className="secondary subtle wallet-settings-trigger"
                    aria-label="Wallet settings"
                    aria-expanded={walletSettingsOpen}
                    onClick={() => setWalletSettingsOpen((open) => !open)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3.08 14H3v-4h.08A1.7 1.7 0 0 0 4.6 8.97a1.7 1.7 0 0 0-.34-1.88l-.06-.06L7.03 4.2l.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 10 3.08V3h4v.08a1.7 1.7 0 0 0 1.03 1.52 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z" />
                    </svg>
                  </button>
                  {walletSettingsOpen ? (
                    <aside className="wallet-settings-popover" aria-label="Wallet settings panel">
                      <div className="wallet-settings-heading">
                        <strong>Wallet settings</strong>
                        <small>Optional one-time actions</small>
                      </div>
                      <div className="wallet-setting-row">
                        <div>
                          <strong>Auto-convert USDT</strong>
                          <small>Polygon USDT → Base USDC. Turns off after one attempt.</small>
                        </div>
                        <label className="wallet-switch">
                          <input
                            type="checkbox"
                            checked={autoConvertArmed}
                            disabled={isAutoConvertProcessing(autoConvertProgress.phase)}
                            onChange={(event) => setOneTimeAutoConvert(event.target.checked)}
                          />
                          <span aria-hidden="true" />
                          <span className="sr-only">Enable one-time USDT conversion</span>
                        </label>
                      </div>
                    </aside>
                  ) : null}
                </div>
              ) : null}
              <button
                type="button"
                className="secondary subtle wallet-sign-out"
                onClick={() => void signOut()}
                disabled={isBusy}
              >
                Sign out
              </button>
            </div>
          ) : null}
        </header>

        {loginIdentity ? (
          <div className="wallet-login-identity">
            <span>Signed in with</span>
            <strong>{loginIdentity}</strong>
          </div>
        ) : null}

        {walletAddress ? (
          <div className="wallet-address-card">
            <div>
              <span>Wallet address</span>
              <code>{walletAddress}</code>
            </div>
            <button
              type="button"
              className="secondary subtle wallet-address-copy"
              onClick={() => void copyWalletAddress()}
              disabled={addressCopyStatus === 'Copied'}
            >
              {addressCopyStatus || 'Copy'}
            </button>
          </div>
        ) : null}

        {!walletAddress ? (
          (!approvalToken || approval?.status === 'pending') && omsWallet ? (
            <section className="wallet-auth-card" aria-label="Login options">
              {step === 'email' ? (
                <div className="wallet-auth-step">
                  <header className="wallet-auth-heading">
                    <h2 className="section-title">Log in or sign up</h2>
                    <p>
                      {approvalToken
                        ? 'Sign in to review this permission request.'
                        : 'Access your wallet with your preferred method.'}
                    </p>
                  </header>
                  <OidcButtons
                    providers={['google', 'apple']}
                    disabled={isBusy}
                    buttonClassName="wallet-auth-option"
                    onStart={(provider) => void startOidcLogin(provider)}
                  />
                  <div className="divider">or continue with email</div>
                  <EmailLoginForm
                    email={email}
                    disabled={isBusy}
                    onEmailChange={setEmail}
                    onSubmit={() => void sendCode()}
                  />
                </div>
              ) : null}

              {step === 'code' ? (
                <div className="wallet-auth-step">
                  <header className="wallet-auth-heading">
                    <h2 className="section-title">Check your email</h2>
                    <p>Enter the verification code sent to {email}.</p>
                  </header>
                  <EmailCodeForm
                    code={code}
                    disabled={isBusy}
                    onCodeChange={setCode}
                    onSubmit={() => void completeSignIn()}
                    onBack={() => setStep('email')}
                  />
                </div>
              ) : null}

              {step === 'wallet-selection' && pendingWalletSelection ? (
                <WalletSelectionPanel
                  pendingWalletSelection={pendingWalletSelection}
                  disabled={isBusy}
                  onSelectWallet={(wallet) => void selectPendingWallet(wallet)}
                  onCreateWallet={() => void createPendingWallet()}
                  onCancel={() => void cancelPendingWalletSelection()}
                />
              ) : null}
            </section>
          ) : null
        ) : (
          <WalletPortfolioCard
            portfolio={portfolio}
            status={portfolioStatus}
            onRefresh={() => void loadPortfolio()}
          />
        )}

        {walletAddress && !approvalToken && autoConvertProgress.phase !== 'idle' ? (
          <AutoConvertProgressCard progress={autoConvertProgress} />
        ) : null}

        {approval?.status === 'pending' && walletAddress ? (
          <PermissionRequestCard
            approval={approval}
            walletAddress={walletAddress}
            isBusy={isBusy}
            action={approvalAction}
            onApprove={() => void approve()}
            onReject={() => void rejectApproval()}
          />
        ) : null}

        {status ? (
          <output
            className={`${approval?.status === 'approved' ? 'success-output' : ''} ${!walletAddress ? 'wallet-auth-status' : ''}`.trim()}
          >
            {status}
          </output>
        ) : null}

        {walletAddress && !approvalToken ? (
          <section
            className="permission-card wallet-sessions-card"
            aria-label="Active approved smart sessions"
          >
            <div className="tool-header">
              <div>
                <h2>Active approved smart sessions</h2>
                <p className="section-note">Remote permissions approved by this wallet.</p>
              </div>
              <button
                type="button"
                className="secondary subtle"
                onClick={() => void loadApprovedSessions()}
                disabled={approvedSessionsLoading || isBusy}
              >
                {approvedSessionsLoading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>

            {approvedSessions.length ? (
              <div className="card-list compact-list">
                {approvedSessions.map((session) => {
                  const key = sessionKey(session);
                  return (
                    <article className="session-card" key={key}>
                      <div className="tool-header">
                        <div>
                          <strong>{session.metadata.appName || 'Remote application'}</strong>
                          {session.metadata.appUrl ? (
                            <small>{session.metadata.appUrl}</small>
                          ) : null}
                        </div>
                        <div className="row-actions">
                          <span className="status-badge success-badge">Approved</span>
                          {sessionPendingRevocation === key ? (
                            <>
                              <button
                                type="button"
                                className="subtle"
                                onClick={() => void revokeSession(session)}
                                disabled={isBusy}
                              >
                                Confirm revoke
                              </button>
                              <button
                                type="button"
                                className="secondary subtle"
                                onClick={() => setSessionPendingRevocation('')}
                                disabled={isBusy}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="secondary subtle"
                              onClick={() => setSessionPendingRevocation(key)}
                              disabled={isBusy}
                            >
                              Revoke
                            </button>
                          )}
                        </div>
                      </div>
                      <dl className="detail-grid compact-details">
                        <Detail label="Session ID" value={session.sessionId} code />
                        <Detail
                          label="Permission expires"
                          value={new Date(session.expiresAt).toLocaleString()}
                        />
                        <Detail label="RAC credential ID" value={session.credentialId} code />
                        <Detail
                          label="Permission"
                          value={session.grants
                            .map((grant) => formatApprovedGrant(grant, session.chainId))
                            .join('; ')}
                        />
                      </dl>
                    </article>
                  );
                })}
              </div>
            ) : null}

            {approvedSessionsStatus ? (
              <output className="section-status">{approvedSessionsStatus}</output>
            ) : null}
          </section>
        ) : null}
      </section>
    </main>
  );
}

function WalletPortfolioCard({
  portfolio,
  status,
  onRefresh
}: {
  portfolio: WalletPortfolio | null;
  status: string;
  onRefresh: () => void;
}) {
  return (
    <section className="wallet-portfolio" aria-label="Wallet balances">
      <header className="wallet-total-balance">
        <div>
          <span>Total balance</span>
          <strong>
            {portfolio?.totalBalanceUsd === undefined ? '—' : formatUsd(portfolio.totalBalanceUsd)}
          </strong>
        </div>
        <button
          type="button"
          className="secondary subtle"
          onClick={onRefresh}
          disabled={status === 'Loading balances…'}
        >
          Refresh
        </button>
      </header>

      <div className="wallet-assets-heading">
        <h2>Assets</h2>
      </div>
      {portfolio?.assets.length ? (
        <div className="wallet-asset-list">
          {portfolio.assets.map((asset) => (
            <article className="wallet-asset-row" key={asset.key}>
              <span className="wallet-asset-icon" aria-hidden="true">
                <svg className="wallet-asset-icon-fallback" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="8" />
                  <path d="M9 9.5h4.5a2 2 0 0 1 0 4H10.5a2 2 0 0 0 0 4H15M12 7v2.5M12 17.5V20" />
                </svg>
                {asset.iconUrl ? (
                  <img
                    src={asset.iconUrl}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={(event) => {
                      event.currentTarget.hidden = true;
                    }}
                  />
                ) : null}
              </span>
              <span className="wallet-asset-identity">
                <strong title={asset.name}>{asset.symbol}</strong>
                <small>{asset.networkName}</small>
              </span>
              <span className="wallet-asset-value">
                <strong>
                  {formatTokenBalance(asset.balance, asset.decimals)} {asset.symbol}
                </strong>
                <small>{formatAssetUsd(asset)}</small>
              </span>
            </article>
          ))}
        </div>
      ) : portfolio ? (
        <p className="wallet-assets-empty">No asset balances found on supported networks.</p>
      ) : (
        <div className="wallet-balance-loading" aria-live="polite">
          {status === 'Loading balances…' ? (
            <span className="dashboard-loading-spinner" aria-hidden="true" />
          ) : null}
          <span>{status || 'Loading balances…'}</span>
        </div>
      )}
      {portfolio && status ? <output className="section-status">{status}</output> : null}
    </section>
  );
}

const AUTO_CONVERT_STEPS = [
  'Detect USDT',
  'Quote route',
  'Send on Polygon',
  'Bridge to Base',
  'Receive USDC'
] as const;

function AutoConvertProgressCard({ progress }: { progress: TrailsAutoConvertProgress }) {
  const activeStep = autoConvertActiveStep(progress);
  const complete = progress.phase === 'complete';
  const failed = progress.phase === 'error';

  return (
    <section
      className={`wallet-auto-convert ${complete ? 'is-complete' : ''} ${failed ? 'is-error' : ''}`}
      aria-label="Automatic USDT conversion progress"
      aria-live="polite"
    >
      <header className="wallet-auto-convert-heading">
        <div>
          <span className="wallet-card-kicker">One-time automation</span>
          <h2>Polygon USDT → Base USDC</h2>
        </div>
        <span className="wallet-auto-convert-state">
          {complete
            ? 'Complete'
            : failed
              ? 'Failed'
              : progress.phase === 'watching'
                ? 'Armed'
                : 'Running'}
        </span>
      </header>

      <ol className="wallet-auto-convert-steps">
        {AUTO_CONVERT_STEPS.map((step, index) => {
          const isComplete = complete || index < activeStep;
          const isCurrent = !complete && !failed && index === activeStep;
          return (
            <li
              className={`${isComplete ? 'is-complete' : ''} ${isCurrent ? 'is-current' : ''}`}
              key={step}
            >
              <span aria-hidden="true">{isComplete ? '✓' : index + 1}</span>
              <small>{step}</small>
            </li>
          );
        })}
      </ol>

      <p className="wallet-auto-convert-message">{progress.message}</p>

      {progress.inputAmountRaw || progress.intentId ? (
        <dl className="wallet-auto-convert-details">
          {progress.inputAmountRaw ? (
            <Detail
              label="Converting"
              value={`${formatTokenBalance(progress.inputAmountRaw, 6)} USDT on Polygon`}
            />
          ) : null}
          {progress.quotedOutputRaw ? (
            <Detail
              label={complete ? 'Quoted output' : 'Estimated output'}
              value={`${formatTokenBalance(progress.quotedOutputRaw, 6)} USDC on Base`}
            />
          ) : null}
          {progress.receivedOutputRaw ? (
            <Detail
              label="Received"
              value={`${formatTokenBalance(progress.receivedOutputRaw, 6)} USDC on Base`}
            />
          ) : null}
          {progress.routeProviders?.length ? (
            <Detail label="Trails route" value={progress.routeProviders.join(' → ')} />
          ) : null}
          {progress.totalFeeUsd !== undefined ? (
            <Detail label="Estimated route fee" value={formatUsd(progress.totalFeeUsd)} />
          ) : null}
          {progress.estimatedDurationSeconds !== undefined ? (
            <Detail
              label="Estimated time"
              value={`${Math.max(1, Math.ceil(progress.estimatedDurationSeconds))} seconds`}
            />
          ) : null}
          {progress.intentId ? (
            <Detail label="Trails intent" value={progress.intentId} code />
          ) : null}
        </dl>
      ) : null}

      {progress.originTransactionHash || progress.destinationTransactionHash ? (
        <div className="wallet-auto-convert-links">
          {progress.originTransactionHash ? (
            <a
              href={`${SMART_SESSION_NETWORKS.polygon.network.explorerUrl}/tx/${progress.originTransactionHash}`}
              target="_blank"
              rel="noreferrer"
            >
              View on {SMART_SESSION_NETWORKS.polygon.explorerName}
            </a>
          ) : null}
          {progress.destinationTransactionHash ? (
            <a
              href={`${SMART_SESSION_NETWORKS.base.network.explorerUrl}/tx/${progress.destinationTransactionHash}`}
              target="_blank"
              rel="noreferrer"
            >
              View on {SMART_SESSION_NETWORKS.base.explorerName}
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function PermissionRequestCard({
  approval,
  walletAddress,
  isBusy,
  action,
  onApprove,
  onReject
}: {
  approval: ApprovalRequest;
  walletAddress: string;
  isBusy: boolean;
  action: ApprovalAction;
  onApprove: () => void;
  onReject: () => void;
}) {
  const network = getSmartSessionNetwork(approval.networkId);
  const asset = getSmartSessionAsset(approval.networkId, approval.assetId);
  return (
    <section className="permission-card wallet-permission-card" aria-label="Requested permission">
      <div className="wallet-card-heading">
        <div>
          <p className="wallet-card-kicker">Permission request</p>
          <h2>Smart-session access</h2>
        </div>
        <span className={`status-badge ${approval.status === 'approved' ? 'success-badge' : ''}`}>
          {approval.status}
        </span>
      </div>
      <dl className="permission-review-list">
        <Detail label="Network" value={network.name} />
        <Detail
          label="Action"
          value={asset.kind === 'native' ? `Send native ${asset.symbol}` : `Send ${asset.symbol}`}
        />
        <Detail
          label={
            asset.kind === 'erc20' && approval.recipientScope.mode === 'specific'
              ? 'Cumulative allowance per receiver'
              : 'Total cumulative allowance'
          }
          value={`${formatUnits(BigInt(approval.allowance), asset.decimals)} ${asset.symbol}`}
        />
        <Detail
          label={approval.recipientScope.mode === 'any' ? 'Receiver scope' : 'Receivers'}
          value={formatRecipientScope(approval.recipientScope)}
          code={approval.recipientScope.mode === 'specific'}
        />
        <Detail label="Permission expires" value={new Date(approval.expiresAt).toLocaleString()} />
        <Detail label="RAC credential ID" value={approval.credentialId} code />
      </dl>
      {approval.status === 'pending' && walletAddress ? (
        <div className="permission-actions">
          <button type="button" onClick={onApprove} disabled={isBusy}>
            {action === 'authorizing'
              ? 'Authorizing…'
              : action === 'confirming'
                ? 'Confirming…'
                : 'Approve permission'}
          </button>
          <button type="button" className="secondary subtle" onClick={onReject} disabled={isBusy}>
            {action === 'rejecting' ? 'Rejecting…' : 'Reject'}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function formatApprovedGrant(grant: SmartSessionGrant, chainId?: number): string {
  const network = chainId === undefined ? undefined : findNetworkById(chainId);
  const configuredNetwork = Object.values(SMART_SESSION_NETWORKS).find(
    (candidate) => candidate.network.id === chainId
  );
  const chain = network
    ? `${network.displayName} (chain ${chainId})`
    : chainId === undefined
      ? 'an unknown chain'
      : `chain ${chainId}`;

  if (grant.kind === 'nativeTransfer') {
    const nativeAsset = configuredNetwork?.assetIds
      .map((assetId) => getSmartSessionAsset(configuredNetwork.id, assetId))
      .find((asset) => asset.kind === 'native');
    const allowance = network
      ? `${formatUnits(grant.limit, nativeAsset?.decimals ?? 18)} ${network.nativeTokenSymbol}`
      : `${grant.limit.toString()} native-token units`;
    return `Send up to ${allowance} on ${chain} to ${shortAddress(grant.to)}`;
  }

  const asset = configuredNetwork?.assetIds
    .map((assetId) => getSmartSessionAsset(configuredNetwork.id, assetId))
    .find(
      (candidate) =>
        candidate.kind === 'erc20' &&
        candidate.tokenAddress.toLowerCase() === grant.token.toLowerCase()
    );
  const recipient = grant.to ? ` to ${shortAddress(grant.to)}` : ' to any receiver';
  return asset
    ? `Transfer up to ${formatUnits(grant.limit, asset.decimals)} ${asset.symbol} on ${chain}${recipient}`
    : `Transfer up to ${grant.limit.toString()} units of ${shortAddress(grant.token)} on ${chain}${recipient}`;
}

function formatRecipientScope(scope: RecipientScope): string {
  return scope.mode === 'any' ? 'Any receiver' : scope.recipients.join(', ');
}

function hasPositiveBalance(balance: { balance: string }): boolean {
  return BigInt(balance.balance) > 0n;
}

function nativePortfolioAsset(balance: NativeTokenBalance): PortfolioAssetBalance {
  return {
    key: `${balance.chainId}:native`,
    networkName: networkDisplayName(balance.chainId),
    symbol: balance.symbol,
    name: balance.name,
    decimals: 18,
    balance: balance.balance,
    iconUrl:
      balance.chainId === Networks.polygon.id || balance.chainId === Networks.amoy.id
        ? polygonPolIconUrl
        : undefined,
    balanceUsd: resolveBalanceUsd({
      balance: balance.balance,
      balanceUsd: balance.balanceUSD,
      decimals: 18,
      priceUsd: balance.priceUSD
    })
  };
}

function contractPortfolioAsset(balance: ContractTokenBalance): PortfolioAssetBalance {
  const symbol = balance.contractInfo?.symbol?.trim() || shortAddress(balance.contractAddress);
  const decimals = balance.contractInfo?.decimals ?? balance.tokenMetadata?.decimals ?? 0;
  return {
    key: `${balance.chainId}:${balance.contractAddress.toLowerCase()}`,
    networkName: networkDisplayName(balance.chainId),
    symbol,
    name: balance.contractInfo?.name?.trim() || balance.tokenMetadata?.name?.trim() || symbol,
    decimals,
    balance: balance.balance,
    balanceUsd: resolveBalanceUsd({
      balance: balance.balance,
      balanceUsd: balance.balanceUSD,
      decimals,
      // The Development Indexer currently reports a stale price for canonical Base USDC.
      // Keep this demo total useful without overriding prices for any other asset.
      priceOverrideUsd: isBaseUsdc(balance) ? 1 : undefined,
      priceUsd: balance.priceUSD
    }),
    iconUrl: indexerAssetImage(balance)
  };
}

function networkDisplayName(chainId: number): string {
  return findNetworkById(chainId)?.displayName ?? `Chain ${chainId}`;
}

function indexerAssetImage(balance: ContractTokenBalance): string | undefined {
  const polygonUsdt = getSmartSessionAsset('polygon', 'usdt');
  if (
    balance.chainId === SMART_SESSION_NETWORKS.polygon.network.id &&
    polygonUsdt.kind === 'erc20' &&
    balance.contractAddress.toLowerCase() === polygonUsdt.tokenAddress.toLowerCase()
  ) {
    return polygonUsdtIconUrl;
  }

  const candidate =
    balance.contractInfo?.logoURI ??
    balance.tokenMetadata?.image ??
    balance.tokenMetadata?.assets?.find((asset) => asset.mimeType?.startsWith('image/'))?.url;
  if (!candidate) return undefined;
  if (candidate.startsWith('ipfs://')) {
    return `https://ipfs.io/ipfs/${candidate.slice('ipfs://'.length)}`;
  }
  return /^(https?:|data:)/.test(candidate) ? candidate : undefined;
}

function comparePortfolioAssets(left: PortfolioAssetBalance, right: PortfolioAssetBalance): number {
  const usdDifference = (right.balanceUsd ?? -1) - (left.balanceUsd ?? -1);
  if (usdDifference !== 0) return usdDifference;
  return `${left.networkName}:${left.symbol}`.localeCompare(`${right.networkName}:${right.symbol}`);
}

function formatTokenBalance(balance: string, decimals: number): string {
  const [whole, fraction = ''] = formatUnits(BigInt(balance), decimals).split('.');
  const visibleFraction = fraction.slice(0, 6).replace(/0+$/, '');
  return visibleFraction ? `${whole}.${visibleFraction}` : whole;
}

function formatUsd(value: number): string {
  return Number.isFinite(value)
    ? new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(value)
    : 'Price unavailable';
}

function formatAssetUsd(asset: PortfolioAssetBalance): string {
  if (asset.balanceUsd !== undefined) return formatUsd(asset.balanceUsd);
  return 'Price unavailable';
}

function isBaseUsdc(balance: ContractTokenBalance): boolean {
  return (
    balance.chainId === Networks.base.id &&
    balance.contractAddress.toLowerCase() === BASE_USDC.toLowerCase()
  );
}

function isAutoConvertProcessing(phase: TrailsAutoConvertPhase): boolean {
  return ['quoting', 'committing', 'submitting', 'bridging', 'settling'].includes(phase);
}

function autoConvertActiveStep(progress: TrailsAutoConvertProgress): number {
  if (progress.phase === 'complete') return AUTO_CONVERT_STEPS.length;
  if (progress.phase === 'settling' || progress.destinationTransactionHash) return 4;
  if (progress.phase === 'bridging' || progress.originTransactionHash) return 3;
  if (progress.phase === 'submitting' || progress.phase === 'committing' || progress.intentId)
    return 2;
  if (progress.phase === 'quoting' || progress.inputAmountRaw) return 1;
  return 0;
}

function waitForAutoConvertPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('The USDT watcher was cancelled.', 'AbortError'));
      return;
    }

    const timeout = window.setTimeout(done, AUTO_CONVERT_POLL_INTERVAL_MS);
    signal.addEventListener('abort', abort, { once: true });

    function done() {
      signal.removeEventListener('abort', abort);
      resolve();
    }

    function abort() {
      window.clearTimeout(timeout);
      reject(new DOMException('The USDT watcher was cancelled.', 'AbortError'));
    }
  });
}

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function sessionKey(session: RemoteAccessGrant): string {
  return `${session.credentialId}:${session.sessionId}`;
}

function Detail({ label, value, code = false }: { label: string; value: string; code?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{code ? <code>{value}</code> : value}</dd>
    </div>
  );
}

async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers }
  });
  const body = (await response.json()) as T | ApiError;
  if (!response.ok)
    throw new Error('error' in (body as ApiError) ? (body as ApiError).error : 'Request failed');
  return body as T;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function restoreApprovalRequestUrl(cleanUrl: string, token: string): void {
  const url = new URL(cleanUrl);
  url.pathname = '/';
  if (token) url.searchParams.set('request', token);
  window.history.replaceState(null, '', url);
  if (token) sessionStorage.removeItem(PENDING_APPROVAL_TOKEN_KEY);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
