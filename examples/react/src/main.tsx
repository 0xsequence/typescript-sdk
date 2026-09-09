import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { isAddress } from 'viem';
import {
  Networks,
  WalletType,
  OmsRelayOidcProviders,
  type FeeOptionSelection,
  type FeeOptionWithBalance,
  type AccessGrant,
  type Network,
  type OMSWalletSessionExpiredEvent,
  type WalletAccount,
  type PendingWalletSelection,
  type WalletActivationResult
} from '@polygonlabs/oms-wallet';
import './styles.css';
import {
  EmailCodeForm,
  EmailLoginForm,
  FeeOptionsPanel,
  OidcButtons,
  SessionExpiredDialog,
  SessionOptions,
  WalletSelectionPanel
} from '../../shared/example-components';
import {
  formatCount,
  formatOidcProvider,
  formatSessionAuth,
  formatSessionExpiry,
  formatWalletType,
  hasOidcCallbackParams,
  isPendingWalletSelection,
  sameAddress,
  type OidcRedirectProvider
} from '../../shared/example-utils';
import { useSessionPreferences } from '../../shared/use-session-preferences';
import {
  DEMO_ENVIRONMENTS,
  SELECTED_DEMO_ENVIRONMENT,
  selectDemoEnvironment,
  type DemoEnvironmentId
} from './config';
import { TEST_SESSION_LIFETIME_SECONDS, omsWallet } from './omsWallet';
import { WalletKitDollarExample } from './WalletKitDollarExample';
import { SolanaExample } from './SolanaExample';

type Step = 'email' | 'code' | 'wallet-selection' | 'wallet';
type WalletTab = 'ethereum' | 'solana';
type FeeSelectionController = {
  resolve: (selection: FeeOptionSelection) => void;
  reject: (error: Error) => void;
};

const DEFAULT_MESSAGE = 'test';
const DEFAULT_TX_TO = '0xE5E8B483FfC05967FcFed58cc98D053265af6D99';
const MANUAL_WALLET_SELECTION_KEY = 'oms-demo-manual-wallet-selection';
const SESSION_LIFETIME_SECONDS_KEY = 'oms-demo-session-lifetime-seconds-v2';
const supportedNetworks = Object.values(Networks);

function App() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [selectedNetworkId, setSelectedNetworkId] = useState<number>(Networks.amoy.id);
  const [transactionTo, setTransactionTo] = useState(DEFAULT_TX_TO);
  const [transactionValue, setTransactionValue] = useState('0');
  const [walletAddress, setWalletAddress] = useState('');
  const [walletTab, setWalletTab] = useState<WalletTab>('ethereum');
  const [lastSignature, setLastSignature] = useState('');
  const [lastIdToken, setLastIdToken] = useState('');
  const [lastTransactionHash, setLastTransactionHash] = useState('');
  const [lastTransactionExplorerUrl, setLastTransactionExplorerUrl] = useState('');
  const [feeOptions, setFeeOptions] = useState<FeeOptionWithBalance[]>([]);
  const [managedWallets, setManagedWallets] = useState<WalletAccount[]>([]);
  const [walletInventoryLoaded, setWalletInventoryLoaded] = useState(false);
  const [walletInventoryError, setWalletInventoryError] = useState('');
  const [newWalletType, setNewWalletType] = useState<WalletType>(WalletType.Ethereum);
  const [newWalletReference, setNewWalletReference] = useState('');
  const [importWalletType, setImportWalletType] = useState<WalletType>(WalletType.Ethereum);
  const [importWalletReference, setImportWalletReference] = useState('');
  const [importPrivateKey, setImportPrivateKey] = useState('');
  const [accessGrants, setAccessGrants] = useState<AccessGrant[]>([]);
  const [pendingWalletSelection, setPendingWalletSelection] =
    useState<PendingWalletSelection | null>(null);
  const [emailAuthStatus, setEmailAuthStatus] = useState('Enter an email to start.');
  const [redirectStatus, setRedirectStatus] = useState('');
  const [walletStatus, setWalletStatus] = useState('');
  const [activeWalletStatus, setActiveWalletStatus] = useState('');
  const [accessStatus, setAccessStatus] = useState('');
  const [sessionExpiredPrompt, setSessionExpiredPrompt] =
    useState<OMSWalletSessionExpiredEvent | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const oidcCallbackStarted = useRef(false);
  const feeSelection = useRef<FeeSelectionController | null>(null);

  const selectedNetwork =
    supportedNetworks.find((network) => network.id === selectedNetworkId) ?? Networks.amoy;
  const activeWalletType = isAddress(walletAddress) ? WalletType.Ethereum : WalletType.Solana;
  const hasEvmWallet = managedWallets.some((wallet) => wallet.type === WalletType.Ethereum);
  const hasSolanaWallet = managedWallets.some((wallet) => wallet.type === WalletType.Solana);
  const session = omsWallet.wallet.session;
  const {
    useManualWalletSelection,
    setUseManualWalletSelection,
    sessionLifetimeSeconds,
    updateSessionLifetime,
    saveSessionPreferences,
    walletSelection
  } = useSessionPreferences({
    manualWalletSelectionKey: MANUAL_WALLET_SELECTION_KEY,
    sessionLifetimeSecondsKey: SESSION_LIFETIME_SECONDS_KEY,
    defaultSessionLifetimeSeconds: TEST_SESSION_LIFETIME_SECONDS
  });

  useEffect(() => {
    return omsWallet.wallet.onSessionExpired(showSessionExpired);
  }, []);

  useEffect(() => {
    if (omsWallet.wallet.walletAddress) {
      setWalletAddress(omsWallet.wallet.walletAddress);
      setWalletTab(isAddress(omsWallet.wallet.walletAddress) ? 'ethereum' : 'solana');
      setStep('wallet');
      setWalletStatus('Wallet session restored.');
      return;
    }

    if (hasOidcCallbackParams()) {
      if (oidcCallbackStarted.current) return;
      oidcCallbackStarted.current = true;
      void completeOidcRedirect();
    }
  }, [omsWallet]);

  useEffect(() => {
    if (step !== 'wallet' || !walletAddress) {
      setWalletInventoryLoaded(false);
      setWalletInventoryError('');
      return;
    }

    let cancelled = false;
    setWalletInventoryLoaded(false);
    setWalletInventoryError('');
    void omsWallet.wallet
      .listWallets()
      .then((wallets) => {
        if (cancelled) return;
        setManagedWallets(wallets);
        setWalletInventoryLoaded(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setWalletInventoryError(message);
        setActiveWalletStatus(message);
      });

    return () => {
      cancelled = true;
    };
  }, [step, walletAddress]);

  useEffect(() => {
    feeSelection.current?.reject(new Error('Network changed'));
    feeSelection.current = null;
    setFeeOptions([]);
    setLastSignature('');
    setLastIdToken('');
    setLastTransactionHash('');
    setLastTransactionExplorerUrl('');
    if (step === 'wallet') {
      setWalletStatus('');
    }
  }, [selectedNetworkId, step]);

  async function run(
    label: string,
    setActiveStatus: (message: string) => void,
    action: () => Promise<void>
  ) {
    setIsBusy(true);
    setActiveStatus(label);
    try {
      await action();
    } catch (error) {
      setActiveStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function startEmailAuth() {
    if (!email.trim()) return;
    await run('Sending code...', setEmailAuthStatus, async () => {
      setPendingWalletSelection(null);
      await omsWallet.wallet.startEmailAuth({
        email: email.trim(),
        sessionLifetimeSeconds
      });
      setStep('code');
      setEmailAuthStatus('Code sent. Check your email.');
    });
  }

  async function completeEmailAuth() {
    if (!code.trim()) return;
    await run('Completing sign-in...', setEmailAuthStatus, async () => {
      const result = await omsWallet.wallet.completeEmailAuth({
        code: code.trim(),
        walletSelection
      });
      handleAuthCompletion(result, 'Email login complete.');
    });
  }

  async function startOidcRedirect(provider: OidcRedirectProvider) {
    const label = formatOidcProvider(provider);
    await run(`Redirecting to ${label}...`, setRedirectStatus, async () => {
      saveSessionPreferences();
      setPendingWalletSelection(null);
      await omsWallet.wallet.signInWithOidcRedirect({
        provider:
          provider === 'google' ? OmsRelayOidcProviders.google : OmsRelayOidcProviders.apple,
        walletSelection,
        sessionLifetimeSeconds
      });
    });
  }

  async function completeOidcRedirect() {
    await run('Completing redirect sign-in...', setRedirectStatus, async () => {
      const result = await omsWallet.wallet.completeOidcRedirectAuth();
      if (result) {
        handleAuthCompletion(result, 'Redirect login complete.');
        return;
      }

      const restoredAddress = omsWallet.wallet.walletAddress ?? '';
      setWalletAddress(restoredAddress);
      if (restoredAddress) {
        setWalletTab(isAddress(restoredAddress) ? 'ethereum' : 'solana');
      }
      setStep(restoredAddress ? 'wallet' : 'email');
      setWalletStatus(restoredAddress ? 'Wallet ready.' : '');
    });
  }

  function handleAuthCompletion(
    result: PendingWalletSelection | WalletActivationResult,
    status: string
  ) {
    if (isPendingWalletSelection(result)) {
      setPendingWalletSelection(result);
      setStep('wallet-selection');
      setEmailAuthStatus('');
      setRedirectStatus('');
      return;
    }

    setPendingWalletSelection(null);
    setLastIdToken('');
    clearManagementState();
    setWalletAddress(result.walletAddress);
    setWalletTab(result.wallet.type);
    setStep('wallet');
    setWalletStatus(status);
  }

  function showSessionExpired(event: OMSWalletSessionExpiredEvent) {
    feeSelection.current?.reject(new Error('Session expired'));
    feeSelection.current = null;
    setFeeOptions([]);
    setPendingWalletSelection(null);
    setWalletAddress('');
    setLastSignature('');
    setLastIdToken('');
    setLastTransactionHash('');
    setLastTransactionExplorerUrl('');
    clearManagementState();
    setCode('');
    setStep('email');
    setEmailAuthStatus(
      event.session.auth?.email
        ? `Session expired for ${event.session.auth.email}.`
        : 'Session expired. Enter an email to continue.'
    );
    setRedirectStatus('');
    setWalletStatus('');
    if (event.session.auth?.email) {
      setEmail(event.session.auth.email);
    }
    setSessionExpiredPrompt(event);
  }

  async function reauthenticateExpiredSession() {
    if (!sessionExpiredPrompt) return;

    const expiredSession = sessionExpiredPrompt.session;
    const auth = expiredSession.auth;
    if (auth?.type === 'oidc' && auth.provider === 'google') {
      await run('Redirecting to Google...', setRedirectStatus, async () => {
        setSessionExpiredPrompt(null);
        saveSessionPreferences();
        setPendingWalletSelection(null);
        await omsWallet.wallet.signInWithOidcRedirect({
          provider: OmsRelayOidcProviders.google,
          walletSelection,
          sessionLifetimeSeconds
        });
      });
      return;
    }

    if (auth?.type === 'oidc' && auth.provider === 'apple') {
      await run('Redirecting to Apple...', setRedirectStatus, async () => {
        setSessionExpiredPrompt(null);
        saveSessionPreferences();
        setPendingWalletSelection(null);
        await omsWallet.wallet.signInWithOidcRedirect({
          provider: OmsRelayOidcProviders.apple,
          walletSelection,
          sessionLifetimeSeconds
        });
      });
      return;
    }

    if (auth?.type === 'email' && auth.email) {
      const email = auth.email;
      await run('Sending code...', setEmailAuthStatus, async () => {
        setSessionExpiredPrompt(null);
        setPendingWalletSelection(null);
        setEmail(email);
        await omsWallet.wallet.startEmailAuth({ email });
        setStep('code');
        setEmailAuthStatus('Code sent. Check your email.');
      });
      return;
    }

    setSessionExpiredPrompt(null);
    setStep('email');
    setEmailAuthStatus('Enter an email to start.');
  }

  function dismissSessionExpiredPrompt() {
    setSessionExpiredPrompt(null);
    setStep('email');
  }

  function changeDemoEnvironment(id: DemoEnvironmentId) {
    if (id === SELECTED_DEMO_ENVIRONMENT.id) return;
    selectDemoEnvironment(id);
    window.location.reload();
  }

  async function selectPendingWallet(wallet: WalletAccount) {
    if (!pendingWalletSelection) return;
    await run('Selecting wallet...', setEmailAuthStatus, async () => {
      const result = await pendingWalletSelection.selectWallet({ walletId: wallet.id });
      handleAuthCompletion(result, 'Wallet selected.');
    });
  }

  async function createPendingWallet() {
    if (!pendingWalletSelection) return;
    await run('Creating wallet...', setEmailAuthStatus, async () => {
      const result = await pendingWalletSelection.createAndSelectWallet({ reference: 'main' });
      handleAuthCompletion(result, 'Wallet created.');
    });
  }

  async function cancelPendingWalletSelection() {
    await run('Cancelling wallet selection...', setEmailAuthStatus, async () => {
      await omsWallet.wallet.signOut();
      setPendingWalletSelection(null);
      setWalletAddress('');
      setCode('');
      setStep('email');
      setEmailAuthStatus('Enter an email to start.');
    });
  }

  async function signMessage() {
    await run('Signing message...', setWalletStatus, async () => {
      const signature = await omsWallet.wallet.signMessage({
        network: selectedNetwork,
        message
      });
      setLastSignature(signature);
      setWalletStatus('Message signed.');
    });
  }

  async function sendTransaction() {
    await run('Sending transaction...', setWalletStatus, async () => {
      setFeeOptions([]);
      setLastTransactionExplorerUrl('');
      try {
        const tx = await omsWallet.wallet.sendTransaction({
          network: selectedNetwork,
          to: transactionTo as `0x${string}`,
          value: BigInt(transactionValue || '0'),
          selectFeeOption: waitForFeeOptionSelection
        });
        setLastTransactionHash(tx.txnHash ?? tx.txnId);
        setLastTransactionExplorerUrl(
          tx.txnHash ? transactionExplorerUrl(selectedNetwork, tx.txnHash) : ''
        );
        setWalletStatus('Transaction sent.');
      } finally {
        feeSelection.current = null;
        setFeeOptions([]);
      }
    });
  }

  async function loadManagedWallets() {
    setWalletInventoryError('');
    await run('Loading wallets...', setActiveWalletStatus, async () => {
      try {
        const wallets = await omsWallet.wallet.listWallets();
        setManagedWallets(wallets);
        setWalletInventoryLoaded(true);
        setActiveWalletStatus(`Loaded ${formatCount(wallets.length, 'wallet')}.`);
      } catch (error) {
        setWalletInventoryError(error instanceof Error ? error.message : String(error));
        throw error;
      }
    });
  }

  async function useManagedWallet(wallet: WalletAccount) {
    await run('Switching wallet...', setActiveWalletStatus, async () => {
      const result = await omsWallet.wallet.useWallet({ walletId: wallet.id });
      setWalletAddress(result.walletAddress);
      setWalletTab(result.wallet.type);
      clearWalletOperationResults();
      setAccessGrants([]);
      setAccessStatus('');
      setManagedWallets((current) =>
        current.map((item) => (item.id === result.wallet.id ? result.wallet : item))
      );
      setActiveWalletStatus(
        `Using ${result.wallet.reference ?? formatWalletType(result.wallet.type)}.`
      );
    });
  }

  async function createManagedWallet(type: WalletType) {
    await run(`Creating ${formatWalletType(type)} wallet...`, setActiveWalletStatus, async () => {
      const reference = newWalletReference.trim();
      const result = await omsWallet.wallet.createWallet({
        type,
        reference: reference || undefined
      });
      setWalletAddress(result.walletAddress);
      setWalletTab(result.wallet.type);
      clearWalletOperationResults();
      setAccessGrants([]);
      setAccessStatus('');
      setManagedWallets((current) => {
        const withoutCreated = current.filter((wallet) => wallet.id !== result.wallet.id);
        return [...withoutCreated, result.wallet];
      });
      setWalletInventoryLoaded(true);
      setNewWalletReference('');
      setActiveWalletStatus(
        `Created and activated ${result.wallet.reference ?? formatWalletType(result.wallet.type)}.`
      );
    });
  }

  async function importManagedWallet() {
    if (!importPrivateKey.trim()) return;
    await run(
      `Importing ${formatWalletType(importWalletType)} wallet...`,
      setActiveWalletStatus,
      async () => {
        const result = await omsWallet.wallet.importWallet({
          type: importWalletType,
          privateKey: importPrivateKey.trim(),
          reference: importWalletReference.trim() || undefined
        });
        setWalletAddress(result.walletAddress);
        setWalletTab(result.wallet.type);
        clearWalletOperationResults();
        setAccessGrants([]);
        setAccessStatus('');
        setManagedWallets((current) => [
          ...current.filter((wallet) => wallet.id !== result.wallet.id),
          result.wallet
        ]);
        setWalletInventoryLoaded(true);
        setImportPrivateKey('');
        setImportWalletReference('');
        setActiveWalletStatus(
          `Imported and activated ${result.wallet.reference ?? formatWalletType(result.wallet.type)}.`
        );
      }
    );
  }

  async function activateWalletType(type: WalletType) {
    await run(`Activating ${formatWalletType(type)} wallet...`, setActiveWalletStatus, async () => {
      const wallets = await omsWallet.wallet.listWallets();
      const existing = wallets.find((wallet) => wallet.type === type);
      const result = existing
        ? await omsWallet.wallet.useWallet({ walletId: existing.id })
        : await omsWallet.wallet.createWallet({ type });

      setWalletAddress(result.walletAddress);
      setWalletTab(result.wallet.type);
      clearWalletOperationResults();
      setAccessGrants([]);
      setAccessStatus('');
      setManagedWallets(
        existing
          ? wallets
          : [...wallets.filter((wallet) => wallet.id !== result.wallet.id), result.wallet]
      );
      setWalletInventoryLoaded(true);
      setActiveWalletStatus(
        existing
          ? `Using ${existing.reference ?? formatWalletType(existing.type)}.`
          : `Created and activated ${formatWalletType(result.wallet.type)} wallet.`
      );
    });
  }

  function selectWalletTab(tab: WalletTab) {
    setWalletTab(tab);
    setActiveWalletStatus('');
  }

  async function loadAccess() {
    await run('Loading access...', setAccessStatus, async () => {
      const grants = await omsWallet.wallet.listAccess();
      setAccessGrants(grants);
      setAccessStatus(`Loaded ${formatCount(grants.length, 'access grant')}.`);
    });
  }

  async function revokeAccess(grant: AccessGrant) {
    if (grant.isCaller) {
      setAccessStatus('The current session access grant cannot be revoked here.');
      return;
    }

    await run('Revoking access...', setAccessStatus, async () => {
      await omsWallet.wallet.revokeAccess({ credentialId: grant.credentialId });
      setAccessGrants((current) =>
        current.filter((item) => item.credentialId !== grant.credentialId)
      );
      setAccessStatus('Access grant revoked.');
    });
  }

  async function getIdToken() {
    await run('Getting ID token...', setWalletStatus, async () => {
      const idToken = await omsWallet.wallet.getIdToken();
      setLastIdToken(idToken);
      setWalletStatus('ID token issued.');
    });
  }

  function waitForFeeOptionSelection(options: FeeOptionWithBalance[]): Promise<FeeOptionSelection> {
    setFeeOptions(options);
    setWalletStatus('Choose a fee token to continue.');
    return new Promise((resolve, reject) => {
      feeSelection.current = { resolve, reject };
    });
  }

  function chooseFeeOption(option: FeeOptionWithBalance) {
    feeSelection.current?.resolve(option.selection);
    feeSelection.current = null;
    setFeeOptions([]);
    setWalletStatus(`Selected ${option.feeOption.token.symbol}. Sending transaction...`);
  }

  function cancelFeeSelection() {
    feeSelection.current?.reject(new Error('Fee option selection cancelled'));
    feeSelection.current = null;
    setFeeOptions([]);
  }

  async function signOut() {
    await run('Signing out...', setWalletStatus, async () => {
      await omsWallet.wallet.signOut();
      setCode('');
      setPendingWalletSelection(null);
      setWalletAddress('');
      setLastSignature('');
      setLastIdToken('');
      setLastTransactionHash('');
      setLastTransactionExplorerUrl('');
      setFeeOptions([]);
      clearManagementState();
      setStep('email');
      setEmailAuthStatus('Enter an email to start.');
      setRedirectStatus('');
      setWalletStatus('');
    });
  }

  function clearWalletOperationResults() {
    feeSelection.current?.reject(new Error('Active wallet changed'));
    feeSelection.current = null;
    setFeeOptions([]);
    setLastSignature('');
    setLastIdToken('');
    setLastTransactionHash('');
    setLastTransactionExplorerUrl('');
    setWalletStatus('');
  }

  function clearManagementState() {
    setManagedWallets([]);
    setWalletInventoryLoaded(false);
    setWalletInventoryError('');
    setAccessGrants([]);
    setActiveWalletStatus('');
    setAccessStatus('');
  }

  return (
    <main className="shell">
      <section className="panel">
        <header>
          <p className="eyebrow">OMS Wallet TypeScript SDK</p>
          <h1>Wallet Demo</h1>
          {step === 'wallet' && (
            <span className="environment-badge">{SELECTED_DEMO_ENVIRONMENT.label}</span>
          )}
          {step === 'email' && (
            <>
              <label className="environment-option">
                Environment
                <span className="select-control">
                  <select
                    aria-label="Environment"
                    value={SELECTED_DEMO_ENVIRONMENT.id}
                    onChange={(event) =>
                      changeDemoEnvironment(event.target.value as DemoEnvironmentId)
                    }
                    disabled={isBusy}
                  >
                    {DEMO_ENVIRONMENTS.map((environment) => (
                      <option key={environment.id} value={environment.id}>
                        {environment.label}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
              <SessionOptions
                useManualWalletSelection={useManualWalletSelection}
                sessionLifetimeSeconds={sessionLifetimeSeconds}
                disabled={isBusy}
                onManualWalletSelectionChange={setUseManualWalletSelection}
                onSessionLifetimeChange={updateSessionLifetime}
              />
            </>
          )}
        </header>

        {step === 'email' && (
          <div className="stack">
            <h2 className="section-title">Login Options</h2>
            <OidcButtons
              providers={['google', 'apple']}
              disabled={isBusy}
              status={redirectStatus}
              onStart={(provider) => void startOidcRedirect(provider)}
            />
            <div className="divider">or</div>
            <EmailLoginForm
              email={email}
              disabled={isBusy}
              status={emailAuthStatus}
              onEmailChange={setEmail}
              onSubmit={() => void startEmailAuth()}
            />
          </div>
        )}

        {step === 'code' && (
          <EmailCodeForm
            code={code}
            disabled={isBusy}
            status={emailAuthStatus}
            onCodeChange={setCode}
            onSubmit={() => void completeEmailAuth()}
            onBack={() => setStep('email')}
          />
        )}

        {step === 'wallet-selection' && pendingWalletSelection && (
          <WalletSelectionPanel
            pendingWalletSelection={pendingWalletSelection}
            authStatus={emailAuthStatus}
            disabled={isBusy}
            onSelectWallet={(wallet) => void selectPendingWallet(wallet)}
            onCreateWallet={() => void createPendingWallet()}
            onCancel={() => void cancelPendingWalletSelection()}
          />
        )}

        {step === 'wallet' && (
          <div className="stack">
            <div className="wallet">
              <span>Wallet</span>
              <code>{walletAddress}</code>
            </div>

            <div className="session-info">
              <div>
                <span>Auth</span>
                <strong>{formatSessionAuth(session.auth)}</strong>
              </div>
              <div>
                <span>Account</span>
                <strong>{session.auth?.email ?? 'Unknown'}</strong>
              </div>
              <div>
                <span>Expires</span>
                <strong>{formatSessionExpiry(session.expiresAt)}</strong>
              </div>
            </div>

            <div className="wallet-tabs" role="tablist" aria-label="Wallet operations">
              <button
                type="button"
                role="tab"
                aria-selected={walletTab === 'ethereum'}
                className={walletTab === 'ethereum' ? 'wallet-tab wallet-tab-active' : 'wallet-tab'}
                onClick={() => selectWalletTab('ethereum')}
                disabled={isBusy}
              >
                EVM
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={walletTab === 'solana'}
                className={walletTab === 'solana' ? 'wallet-tab wallet-tab-active' : 'wallet-tab'}
                onClick={() => selectWalletTab('solana')}
                disabled={isBusy}
              >
                Solana
              </button>
            </div>

            {walletTab === 'ethereum' && activeWalletType !== WalletType.Ethereum && (
              <section className="tool wallet-type-prompt">
                <h2>
                  {!walletInventoryLoaded
                    ? walletInventoryError
                      ? 'Unable to load wallets'
                      : 'Loading wallets'
                    : hasEvmWallet
                      ? 'Use an EVM wallet'
                      : 'Create an EVM wallet'}
                </h2>
                <button
                  type="button"
                  onClick={() =>
                    void (walletInventoryLoaded
                      ? activateWalletType(WalletType.Ethereum)
                      : loadManagedWallets())
                  }
                  disabled={isBusy || (!walletInventoryLoaded && !walletInventoryError)}
                >
                  {!walletInventoryLoaded
                    ? walletInventoryError
                      ? 'Retry loading wallets'
                      : 'Loading wallets...'
                    : hasEvmWallet
                      ? 'Use EVM wallet'
                      : 'Create EVM wallet'}
                </button>
                {activeWalletStatus && <output>{activeWalletStatus}</output>}
              </section>
            )}

            {walletTab === 'ethereum' && activeWalletType === WalletType.Ethereum && (
              <>
                <section className="tool network-tool">
                  <div className="tool-header">
                    <h2>Network</h2>
                    <span className="network-meta">{selectedNetwork.nativeTokenSymbol}</span>
                  </div>
                  <span className="select-control">
                    <select
                      aria-label="Network"
                      value={selectedNetworkId}
                      onChange={(event) => setSelectedNetworkId(Number(event.target.value))}
                      disabled={isBusy}
                    >
                      {supportedNetworks.map((network) => (
                        <option key={network.id} value={network.id}>
                          {network.displayName} ({network.id})
                        </option>
                      ))}
                    </select>
                  </span>
                </section>

                <section className="tool">
                  <h2>Sign message</h2>
                  <label>
                    Message
                    <input value={message} onChange={(event) => setMessage(event.target.value)} />
                  </label>
                  <button type="button" onClick={signMessage} disabled={isBusy || !message.trim()}>
                    Sign message
                  </button>
                  {lastSignature && (
                    <p className="result labeled-result">
                      <span className="result-label">Signature</span>
                      <code className="result-value">{lastSignature}</code>
                    </p>
                  )}
                </section>

                <section className="tool">
                  <h2>Send transaction</h2>
                  <label>
                    To
                    <input
                      value={transactionTo}
                      onChange={(event) => setTransactionTo(event.target.value)}
                    />
                  </label>
                  <label>
                    Value
                    <input
                      inputMode="numeric"
                      value={transactionValue}
                      onChange={(event) => setTransactionValue(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={sendTransaction}
                    disabled={isBusy || !transactionTo.trim()}
                  >
                    Send transaction
                  </button>
                  {lastTransactionHash && (
                    <div className="result-block">
                      <p className="result labeled-result">
                        <span className="result-label">
                          {lastTransactionExplorerUrl ? 'Transaction hash' : 'Transaction ID'}
                        </span>
                        <code className="result-value">{lastTransactionHash}</code>
                      </p>
                      {lastTransactionExplorerUrl && (
                        <a href={lastTransactionExplorerUrl} target="_blank" rel="noreferrer">
                          View on explorer
                        </a>
                      )}
                    </div>
                  )}
                </section>

                {selectedNetwork.id === Networks.amoy.id && (
                  <details className="tool collapsible-tool">
                    <summary>ERC20 example</summary>
                    <div className="collapsible-content">
                      <WalletKitDollarExample key={walletAddress} />
                    </div>
                  </details>
                )}
              </>
            )}

            {walletTab === 'solana' && activeWalletType !== WalletType.Solana && (
              <section className="tool wallet-type-prompt">
                <h2>
                  {!walletInventoryLoaded
                    ? walletInventoryError
                      ? 'Unable to load wallets'
                      : 'Loading wallets'
                    : hasSolanaWallet
                      ? 'Use a Solana wallet'
                      : 'Create a Solana wallet'}
                </h2>
                <button
                  type="button"
                  onClick={() =>
                    void (walletInventoryLoaded
                      ? activateWalletType(WalletType.Solana)
                      : loadManagedWallets())
                  }
                  disabled={isBusy || (!walletInventoryLoaded && !walletInventoryError)}
                >
                  {!walletInventoryLoaded
                    ? walletInventoryError
                      ? 'Retry loading wallets'
                      : 'Loading wallets...'
                    : hasSolanaWallet
                      ? 'Use Solana wallet'
                      : 'Create Solana wallet'}
                </button>
                {activeWalletStatus && <output>{activeWalletStatus}</output>}
              </section>
            )}

            {walletTab === 'solana' && activeWalletType === WalletType.Solana && (
              <SolanaExample key={walletAddress} walletAddress={walletAddress} />
            )}

            <details className="tool collapsible-tool">
              <summary>Wallet management</summary>
              <div className="collapsible-content">
                <div className="actions">
                  <button type="button" onClick={loadManagedWallets} disabled={isBusy}>
                    Load wallets
                  </button>
                </div>
                <div className="inline-field-action">
                  <label>
                    Wallet type
                    <span className="select-control">
                      <select
                        value={newWalletType}
                        onChange={(event) => setNewWalletType(event.target.value as WalletType)}
                        disabled={isBusy}
                      >
                        <option value={WalletType.Ethereum}>Ethereum</option>
                        <option value={WalletType.Solana}>Solana</option>
                      </select>
                    </span>
                  </label>
                  <label>
                    New wallet reference
                    <input
                      value={newWalletReference}
                      onChange={(event) => setNewWalletReference(event.target.value)}
                      placeholder="Optional label"
                    />
                  </label>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void createManagedWallet(newWalletType)}
                    disabled={isBusy}
                  >
                    Create wallet
                  </button>
                </div>

                <>
                  <div className="inline-field-action wallet-import-fields">
                    <label>
                      Import wallet type
                      <span className="select-control">
                        <select
                          value={importWalletType}
                          onChange={(event) =>
                            setImportWalletType(event.target.value as WalletType)
                          }
                          disabled={isBusy}
                        >
                          <option value={WalletType.Ethereum}>Ethereum</option>
                          <option value={WalletType.Solana}>Solana</option>
                        </select>
                      </span>
                    </label>
                    <label>
                      Private key
                      <input
                        type="password"
                        value={importPrivateKey}
                        onChange={(event) => setImportPrivateKey(event.target.value)}
                        placeholder="Hex or base58 private key"
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      Imported wallet reference
                      <input
                        value={importWalletReference}
                        onChange={(event) => setImportWalletReference(event.target.value)}
                        placeholder="Optional label"
                      />
                    </label>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void importManagedWallet()}
                      disabled={isBusy || !importPrivateKey.trim()}
                    >
                      Import wallet
                    </button>
                  </div>
                  <p className="field-hint">
                    The SDK encrypts the key to an attested WaaS enclave before sending it. Use a
                    test key in this example.
                  </p>
                </>

                {managedWallets.length > 0 ? (
                  <div className="management-list">
                    {managedWallets.map((wallet) => {
                      const isActiveWallet = sameAddress(wallet.address, walletAddress);

                      return (
                        <article
                          key={wallet.id}
                          className={
                            isActiveWallet
                              ? 'management-card management-card-active'
                              : 'management-card'
                          }
                        >
                          <div className="management-card-header">
                            <span>
                              <strong>{wallet.reference ?? 'Unlabeled wallet'}</strong>
                              <small>
                                {formatWalletType(wallet.type)} · {formatWalletKeyOrigin(wallet)} ·{' '}
                                {wallet.id}
                              </small>
                            </span>
                            {isActiveWallet ? (
                              <span className="metadata-pill">Active</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void useManagedWallet(wallet)}
                                disabled={isBusy}
                              >
                                Use
                              </button>
                            )}
                          </div>
                          <code>{wallet.address}</code>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <p className="field-hint">
                    Load wallets to switch or create another wallet for this account.
                  </p>
                )}
                {activeWalletStatus && <output>{activeWalletStatus}</output>}
              </div>
            </details>

            <details className="tool collapsible-tool">
              <summary>Access management</summary>
              <div className="collapsible-content">
                <div className="actions">
                  <button type="button" onClick={loadAccess} disabled={isBusy}>
                    Show access grants
                  </button>
                </div>

                {accessGrants.length > 0 ? (
                  <div className="management-list">
                    {accessGrants.map((grant) => (
                      <article
                        key={grant.credentialId}
                        className={
                          grant.isCaller
                            ? 'management-card management-card-active'
                            : 'management-card'
                        }
                      >
                        <div className="management-card-header">
                          <span>
                            <strong>
                              {grant.isCaller ? 'Current session grant' : 'Access grant'}
                            </strong>
                            <small>Credential ID: {grant.credentialId}</small>
                          </span>
                          {grant.isCaller ? (
                            <span className="metadata-pill">Caller</span>
                          ) : (
                            <button
                              type="button"
                              className="danger"
                              onClick={() => void revokeAccess(grant)}
                              disabled={isBusy}
                            >
                              Revoke
                            </button>
                          )}
                        </div>
                        <dl className="management-meta">
                          <div>
                            <dt>Expires</dt>
                            <dd>{formatSessionExpiry(grant.expiresAt)}</dd>
                          </div>
                        </dl>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="field-hint">
                    Show access grants to review or revoke grants for other credentials.
                  </p>
                )}
                {accessStatus && <output>{accessStatus}</output>}
              </div>
            </details>

            <details className="tool collapsible-tool">
              <summary>Other operations</summary>
              <div className="collapsible-content">
                <button type="button" onClick={getIdToken} disabled={isBusy}>
                  Get ID token
                </button>
                {lastIdToken && <code className="result">{lastIdToken}</code>}
              </div>
            </details>

            <button type="button" className="secondary" onClick={signOut} disabled={isBusy}>
              Sign out
            </button>
          </div>
        )}

        {step === 'wallet' && walletStatus && <output>{walletStatus}</output>}
      </section>

      {feeOptions.length > 0 && (
        <FeeOptionsPanel
          feeOptions={feeOptions}
          onCancel={cancelFeeSelection}
          onChoose={chooseFeeOption}
        />
      )}

      {sessionExpiredPrompt && (
        <SessionExpiredDialog
          event={sessionExpiredPrompt}
          disabled={isBusy}
          onReauthenticate={() => void reauthenticateExpiredSession()}
          onDismiss={dismissSessionExpiredPrompt}
        />
      )}
    </main>
  );
}

function formatWalletKeyOrigin(wallet: WalletAccount): string {
  return wallet.keyOrigin === 'imported' ? 'Imported key' : 'Enclave key';
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

function transactionExplorerUrl(network: Network, txnHash: string): string {
  return `${network.explorerUrl.replace(/\/+$/, '')}/tx/${txnHash}`;
}
