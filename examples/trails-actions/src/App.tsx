import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  OmsRelayOidcProviders,
  FeeOptionSelector,
  type FeeOptionSelection,
  type FeeOptionWithBalance,
  type OMSWalletSessionExpiredEvent,
  type OMSWalletSessionState,
  type WalletAccount,
  type PendingWalletSelection,
  type SendTransactionResponse,
  type WalletActivationResult
} from '@polygonlabs/oms-wallet';
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
  formatOidcProvider,
  formatSessionAuth,
  formatSessionExpiry,
  formatWalletType,
  hasOidcCallbackParams,
  isPendingWalletSelection,
  type OidcRedirectProvider
} from '../../shared/example-utils';
import { useSessionPreferences } from '../../shared/use-session-preferences';
import { TEST_SESSION_LIFETIME_SECONDS, omsWallet } from './omsWallet';
import {
  DEFAULT_DEPOSIT_USDC_AMOUNT,
  DEFAULT_EARN_POL_AMOUNT,
  DEFAULT_SWAP_POL_AMOUNT,
  POLYGON_NETWORK,
  SIGNED_OUT_BALANCES,
  describeError,
  explorerUrlFor,
  getPolygonBalances,
  getPolygonEarnPositions,
  normalizeAmountInput,
  prepareDepositUsdc,
  prepareSwapAndEarnUsdc,
  prepareSwapPolToUsdc,
  prepareWithdrawEarnPosition,
  requirePreparedTransaction,
  requirePreparedYieldTransactions,
  requireWalletAddress,
  shortHash,
  type BalanceState,
  type EarnPosition,
  type PostSendExpectation,
  type PreparedTrailsTransaction,
  type PreparedYieldTransactions
} from './trailsActions';
import './styles.css';

type AuthStep = 'email' | 'code';
type TransactionResult = {
  value: string;
  explorerUrl?: string;
};
type FeeSelectionController = {
  resolve: (selection: FeeOptionSelection) => void;
  reject: (error: Error) => void;
};
type AutoFeeOptionKey = 'swap' | 'deposit' | 'earn';

const MANUAL_WALLET_SELECTION_KEY = 'oms-trails-actions-manual-wallet-selection';
const SESSION_LIFETIME_SECONDS_KEY = 'oms-trails-actions-session-lifetime-seconds';
const NO_EARN_POSITIONS_STATUS = 'No deposited earn positions.';
const POST_SEND_REFRESH_ATTEMPTS = 24;
const POST_SEND_REFRESH_DELAY_MS = 2500;
const DEFAULT_AUTO_FEE_OPTIONS: Record<AutoFeeOptionKey, boolean> = {
  swap: true,
  deposit: true,
  earn: true
};

type SignedInDataRefresh = {
  balances: BalanceState | null;
  positions: EarnPosition[] | null;
};

function App() {
  const [session, setSession] = useState<OMSWalletSessionState>(omsWallet.wallet.session);
  const [authStep, setAuthStep] = useState<AuthStep>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pendingWalletSelection, setPendingWalletSelection] =
    useState<PendingWalletSelection | null>(null);
  const [authStatus, setAuthStatus] = useState('Enter an email to start.');
  const [redirectStatus, setRedirectStatus] = useState('');
  const [sessionExpiredPrompt, setSessionExpiredPrompt] =
    useState<OMSWalletSessionExpiredEvent | null>(null);
  const [balances, setBalances] = useState<BalanceState>(SIGNED_OUT_BALANCES);
  const [earnPositions, setEarnPositions] = useState<EarnPosition[]>([]);
  const [earnPositionsStatus, setEarnPositionsStatus] = useState('Sign in to load earn positions.');
  const [swapPolAmount, setSwapPolAmount] = useState(DEFAULT_SWAP_POL_AMOUNT);
  const [depositUsdcAmount, setDepositUsdcAmount] = useState(DEFAULT_DEPOSIT_USDC_AMOUNT);
  const [earnPolAmount, setEarnPolAmount] = useState(DEFAULT_EARN_POL_AMOUNT);
  const [preparedSwap, setPreparedSwap] = useState<PreparedTrailsTransaction | null>(null);
  const [preparedDeposit, setPreparedDeposit] = useState<PreparedYieldTransactions | null>(null);
  const [preparedEarn, setPreparedEarn] = useState<PreparedTrailsTransaction | null>(null);
  const [swapStatus, setSwapStatus] = useState('Swap status: waiting to prepare.');
  const [depositStatus, setDepositStatus] = useState('Deposit status: waiting to prepare.');
  const [earnStatus, setEarnStatus] = useState('Swap and Deposit status: waiting to prepare.');
  const [lastSwapTransaction, setLastSwapTransaction] = useState<TransactionResult | null>(null);
  const [lastDepositTransaction, setLastDepositTransaction] = useState<TransactionResult | null>(
    null
  );
  const [lastEarnTransaction, setLastEarnTransaction] = useState<TransactionResult | null>(null);
  const [withdrawStatuses, setWithdrawStatuses] = useState<Record<string, string>>({});
  const [lastWithdrawTransactions, setLastWithdrawTransactions] = useState<
    Record<string, TransactionResult>
  >({});
  const [feeOptions, setFeeOptions] = useState<FeeOptionWithBalance[]>([]);
  const [autoFeeOptions, setAutoFeeOptions] = useState(DEFAULT_AUTO_FEE_OPTIONS);
  const [withdrawAutoFeeOptions, setWithdrawAutoFeeOptions] = useState<Record<string, boolean>>({});
  const [logLines, setLogLines] = useState(['Ready.']);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [walletCopyLabel, setWalletCopyLabel] = useState<'Copy' | 'Copied'>('Copy');
  const oidcCallbackStarted = useRef(false);
  const feeSelection = useRef<FeeSelectionController | null>(null);
  const selectedFeeOption = useRef<FeeOptionWithBalance | null>(null);
  const walletCopyReset = useRef<number | null>(null);

  const walletAddress = session.walletAddress;
  const isSignedIn = walletAddress != null;
  const isBusy = loadingAction != null;
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
  const hasVisibleWithdrawStatus = earnPositions.some((position) => withdrawStatuses[position.id]);
  const showEarnPositionsStatus =
    !hasVisibleWithdrawStatus &&
    (earnPositions.length > 0 || earnPositionsStatus !== NO_EARN_POSITIONS_STATUS);

  const appendLog = useCallback((line: string) => {
    setLogLines((current) => [...current, line].slice(-80));
  }, []);

  const refreshSession = useCallback(() => {
    const nextSession = omsWallet.wallet.session;
    setSession(nextSession);
    return nextSession;
  }, []);

  const runAction = useCallback(
    async (label: string, action: () => Promise<void>, onFailure?: (error: unknown) => void) => {
      appendLog(`> ${label}`);
      setLoadingAction(label);
      try {
        await action();
      } catch (error) {
        onFailure?.(error);
        appendLog(`! ${describeError(error)}`);
      } finally {
        setLoadingAction(null);
      }
    },
    [appendLog]
  );

  const refreshBalances = useCallback(
    async (address: `0x${string}`, status = 'Loading Polygon balances...') => {
      setBalances((current) => ({ ...current, status }));
      try {
        const nextBalances = await getPolygonBalances(address);
        setBalances(nextBalances);
        return nextBalances;
      } catch (error) {
        const message = `Balance status: ${describeError(error)}`;
        setBalances((current) => ({ ...current, status: message }));
        appendLog(`! ${message}`);
        return null;
      }
    },
    [appendLog]
  );

  const refreshEarnPositions = useCallback(
    async (address: `0x${string}`, status = 'Loading Polygon earn positions...') => {
      setEarnPositionsStatus(status);
      try {
        const result = await getPolygonEarnPositions(address);
        setEarnPositions(result.positions);
        if (result.errors.length > 0) {
          setEarnPositionsStatus(
            `Earn positions loaded with ${result.errors.length} API error(s).`
          );
          result.errors.forEach((error) => appendLog(`! Earn balance error: ${error}`));
        } else {
          setEarnPositionsStatus(
            result.positions.length > 0 ? 'Earn positions updated.' : NO_EARN_POSITIONS_STATUS
          );
        }
        return result.positions;
      } catch (error) {
        const message = `Earn positions status: ${describeError(error)}`;
        setEarnPositionsStatus(message);
        appendLog(`! ${message}`);
        return null;
      }
    },
    [appendLog]
  );

  const refreshSignedInData = useCallback(async (): Promise<SignedInDataRefresh> => {
    if (!walletAddress) {
      return {
        balances: null,
        positions: null
      };
    }
    const ethereumWalletAddress = requireWalletAddress(walletAddress);

    const [nextBalances, nextPositions] = await Promise.all([
      refreshBalances(ethereumWalletAddress, 'Refreshing Polygon balances...'),
      refreshEarnPositions(ethereumWalletAddress, 'Refreshing Polygon earn positions...')
    ]);

    return {
      balances: nextBalances,
      positions: nextPositions
    };
  }, [refreshBalances, refreshEarnPositions, walletAddress]);

  useEffect(() => {
    return omsWallet.wallet.onSessionExpired(showSessionExpired);
  }, []);

  useEffect(() => {
    return () => {
      if (walletCopyReset.current !== null) {
        window.clearTimeout(walletCopyReset.current);
      }
    };
  }, []);

  useEffect(() => {
    if (omsWallet.wallet.walletAddress) {
      const restored = refreshSession();
      setAuthStatus('Wallet session restored.');
      appendLog(`Wallet ready: ${restored.walletAddress}`);
      return;
    }

    if (hasOidcCallbackParams()) {
      if (oidcCallbackStarted.current) return;
      oidcCallbackStarted.current = true;
      void completeOidcRedirect();
    }
  }, [appendLog, refreshSession]);

  useEffect(() => {
    if (!walletAddress) {
      setBalances(SIGNED_OUT_BALANCES);
      setEarnPositions([]);
      setEarnPositionsStatus('Sign in to load earn positions.');
      setWithdrawStatuses({});
      setLastWithdrawTransactions({});
      return;
    }
    const ethereumWalletAddress = requireWalletAddress(walletAddress);

    void refreshBalances(ethereumWalletAddress);
    void refreshEarnPositions(ethereumWalletAddress);
  }, [refreshBalances, refreshEarnPositions, walletAddress]);

  const sessionDetails = useMemo(
    () => [
      { label: 'Auth', value: formatSessionAuth(session.auth) },
      { label: 'Account', value: session.auth?.email ?? 'Unavailable' },
      { label: 'Expires', value: formatSessionExpiry(session.expiresAt) }
    ],
    [session.auth, session.expiresAt]
  );

  function startEmailAuth() {
    void runAction(
      'Start email sign-in',
      async () => {
        const normalizedEmail = email.trim();
        if (!normalizedEmail) throw new Error('Email is required.');
        setSessionExpiredPrompt(null);
        setPendingWalletSelection(null);
        setAuthStatus('Requesting email code...');
        await omsWallet.wallet.startEmailAuth({
          email: normalizedEmail,
          sessionLifetimeSeconds
        });
        setEmail('');
        setAuthStep('code');
        setAuthStatus(`Code requested for ${normalizedEmail}`);
      },
      (error) => {
        setAuthStatus(`Sign-in error: ${describeError(error)}`);
      }
    );
  }

  function completeEmailAuth() {
    void runAction(
      'Complete email sign-in',
      async () => {
        const normalizedCode = code.trim();
        if (!normalizedCode) throw new Error('Code is required.');
        setAuthStatus('Verifying code...');
        const result = await omsWallet.wallet.completeEmailAuth({
          code: normalizedCode,
          walletSelection
        });
        setCode('');
        setAuthStep('email');
        handleAuthCompletion(result, 'Email login complete.');
      },
      (error) => {
        setAuthStatus(`Verify error: ${describeError(error)}`);
      }
    );
  }

  function startOidcRedirect(provider: OidcRedirectProvider) {
    const providerLabel = formatOidcProvider(provider);
    void runAction(
      `Start ${providerLabel} sign-in`,
      async () => {
        saveSessionPreferences();
        setSessionExpiredPrompt(null);
        setPendingWalletSelection(null);
        setRedirectStatus(`Redirecting to ${providerLabel}...`);
        await omsWallet.wallet.signInWithOidcRedirect({
          provider:
            provider === 'google' ? OmsRelayOidcProviders.google : OmsRelayOidcProviders.apple,
          walletSelection,
          sessionLifetimeSeconds
        });
      },
      (error) => {
        setRedirectStatus(`${providerLabel} sign-in error: ${describeError(error)}`);
      }
    );
  }

  function completeOidcRedirect() {
    void runAction(
      'Complete redirect sign-in',
      async () => {
        const result = await omsWallet.wallet.completeOidcRedirectAuth();
        if (result) {
          handleAuthCompletion(result, 'Redirect login complete.');
          return;
        }

        const restored = refreshSession();
        if (restored.walletAddress) {
          setRedirectStatus('Redirect login complete.');
          appendLog(`Wallet ready: ${restored.walletAddress}`);
        }
      },
      (error) => {
        setRedirectStatus(`Redirect error: ${describeError(error)}`);
      }
    );
  }

  function handleAuthCompletion(
    result: PendingWalletSelection | WalletActivationResult,
    status: string
  ) {
    setSessionExpiredPrompt(null);
    if (isPendingWalletSelection(result)) {
      setPendingWalletSelection(result);
      setAuthStatus('Choose a wallet to continue.');
      setRedirectStatus('');
      return;
    }

    setPendingWalletSelection(null);
    setAuthStatus(status);
    setRedirectStatus('');
    setSession(omsWallet.wallet.session);
    appendLog(`Wallet ready: ${result.walletAddress}`);
  }

  function showSessionExpired(event: OMSWalletSessionExpiredEvent) {
    clearFeeSelection(new Error('Session expired'));
    setPendingWalletSelection(null);
    setSession(omsWallet.wallet.session);
    setAuthStep('email');
    setCode('');
    setAuthStatus(
      event.session.auth?.email
        ? `Session expired for ${event.session.auth.email}.`
        : 'Session expired. Enter an email to continue.'
    );
    setRedirectStatus('');
    clearPreparedState();
    setBalances(SIGNED_OUT_BALANCES);
    setEarnPositions([]);
    setEarnPositionsStatus('Sign in to load earn positions.');
    setWithdrawStatuses({});
    setLastWithdrawTransactions({});
    if (event.session.auth?.email) {
      setEmail(event.session.auth.email);
    }
    setSessionExpiredPrompt(event);
    appendLog('Session expired.');
  }

  function reauthenticateExpiredSession() {
    if (!sessionExpiredPrompt) return;

    const expiredSession = sessionExpiredPrompt.session;
    const auth = expiredSession.auth;
    if (auth?.type === 'oidc' && auth.provider === 'google') {
      void runAction(
        'Reauthenticate with Google',
        async () => {
          setSessionExpiredPrompt(null);
          saveSessionPreferences();
          setPendingWalletSelection(null);
          setRedirectStatus('Redirecting to Google...');
          await omsWallet.wallet.signInWithOidcRedirect({
            provider: OmsRelayOidcProviders.google,
            walletSelection,
            sessionLifetimeSeconds
          });
        },
        (error) => {
          setRedirectStatus(`Google reauth error: ${describeError(error)}`);
        }
      );
      return;
    }

    if (auth?.type === 'oidc' && auth.provider === 'apple') {
      void runAction(
        'Reauthenticate with Apple',
        async () => {
          setSessionExpiredPrompt(null);
          saveSessionPreferences();
          setPendingWalletSelection(null);
          setRedirectStatus('Redirecting to Apple...');
          await omsWallet.wallet.signInWithOidcRedirect({
            provider: OmsRelayOidcProviders.apple,
            walletSelection,
            sessionLifetimeSeconds
          });
        },
        (error) => {
          setRedirectStatus(`Apple reauth error: ${describeError(error)}`);
        }
      );
      return;
    }

    if (auth?.type === 'email' && auth.email) {
      const email = auth.email;
      void runAction(
        'Send reauth code',
        async () => {
          setSessionExpiredPrompt(null);
          setPendingWalletSelection(null);
          setEmail(email);
          setAuthStatus('Requesting email code...');
          await omsWallet.wallet.startEmailAuth({ email, sessionLifetimeSeconds });
          setAuthStep('code');
          setAuthStatus('Code sent. Check your email.');
        },
        (error) => {
          setAuthStatus(`Reauth error: ${describeError(error)}`);
        }
      );
      return;
    }

    setSessionExpiredPrompt(null);
    setAuthStep('email');
    setAuthStatus('Enter an email to start.');
  }

  function dismissSessionExpiredPrompt() {
    setSessionExpiredPrompt(null);
    setAuthStep('email');
  }

  function selectPendingWallet(wallet: WalletAccount) {
    if (!pendingWalletSelection) return;
    void runAction(
      'Selecting wallet',
      async () => {
        const result = await pendingWalletSelection.selectWallet({ walletId: wallet.id });
        handleAuthCompletion(result, 'Wallet selected.');
      },
      (error) => {
        setAuthStatus(`Wallet selection error: ${describeError(error)}`);
      }
    );
  }

  function createPendingWallet() {
    if (!pendingWalletSelection) return;
    void runAction(
      'Creating wallet',
      async () => {
        const result = await pendingWalletSelection.createAndSelectWallet({
          reference: 'trails-actions'
        });
        handleAuthCompletion(result, 'Wallet created.');
      },
      (error) => {
        setAuthStatus(`Wallet creation error: ${describeError(error)}`);
      }
    );
  }

  function cancelPendingWalletSelection() {
    void runAction('Cancel wallet selection', async () => {
      await omsWallet.wallet.signOut();
      setSessionExpiredPrompt(null);
      setPendingWalletSelection(null);
      setSession(omsWallet.wallet.session);
      setAuthStep('email');
      setCode('');
      setAuthStatus('Enter an email to start.');
      setRedirectStatus('');
      clearPreparedState();
    });
  }

  function signOut() {
    void runAction('Sign out', async () => {
      await omsWallet.wallet.signOut();
      setSessionExpiredPrompt(null);
      setPendingWalletSelection(null);
      setSession(omsWallet.wallet.session);
      setAuthStep('email');
      setCode('');
      setAuthStatus('Signed out.');
      setRedirectStatus('');
      clearPreparedState();
      setBalances(SIGNED_OUT_BALANCES);
      setEarnPositions([]);
      setEarnPositionsStatus('Sign in to load earn positions.');
      setWithdrawStatuses({});
      setLastWithdrawTransactions({});
    });
  }

  function copyWalletAddress() {
    if (!walletAddress) return;
    void navigator.clipboard
      .writeText(walletAddress)
      .then(() => {
        setWalletCopyLabel('Copied');
        if (walletCopyReset.current !== null) {
          window.clearTimeout(walletCopyReset.current);
        }
        walletCopyReset.current = window.setTimeout(() => {
          setWalletCopyLabel('Copy');
          walletCopyReset.current = null;
        }, 1500);
        appendLog('Copied wallet address.');
      })
      .catch((error) => {
        appendLog(`! Copy wallet address: ${describeError(error)}`);
      });
  }

  function updateSwapPolAmount(value: string) {
    clearFeeSelection(new Error('Amount changed'));
    setSwapPolAmount(normalizeAmountInput(value));
    setPreparedSwap(null);
    setLastSwapTransaction(null);
    setSwapStatus('Swap status: waiting to prepare.');
  }

  function updateDepositUsdcAmount(value: string) {
    clearFeeSelection(new Error('Amount changed'));
    setDepositUsdcAmount(normalizeAmountInput(value));
    setPreparedDeposit(null);
    setLastDepositTransaction(null);
    setDepositStatus('Deposit status: waiting to prepare.');
  }

  function updateEarnPolAmount(value: string) {
    clearFeeSelection(new Error('Amount changed'));
    setEarnPolAmount(normalizeAmountInput(value));
    setPreparedEarn(null);
    setLastEarnTransaction(null);
    setEarnStatus('Swap and Deposit status: waiting to prepare.');
  }

  function prepareSwap() {
    void runAction(
      'Prepare swap',
      async () => {
        const prepared = await prepareSwapPolToUsdc({
          walletAddress: requireWalletAddress(walletAddress),
          polAmount: swapPolAmount
        });
        setPreparedSwap(prepared);
        setSwapStatus(`Swap status: prepared ${prepared.callCount} destination calls.`);
      },
      (error) => {
        setSwapStatus(`Swap status: ${describeError(error)}`);
      }
    );
  }

  function prepareDeposit() {
    void runAction(
      'Prepare deposit',
      async () => {
        const prepared = await prepareDepositUsdc({
          walletAddress: requireWalletAddress(walletAddress),
          usdcAmount: depositUsdcAmount
        });
        setPreparedDeposit(prepared);
        setDepositStatus(
          `Deposit status: prepared ${prepared.transactions.length} wallet transaction${prepared.transactions.length === 1 ? '' : 's'}.`
        );
      },
      (error) => {
        setDepositStatus(`Deposit status: ${describeError(error)}`);
      }
    );
  }

  function prepareEarn() {
    void runAction(
      'Prepare swap and deposit',
      async () => {
        const prepared = await prepareSwapAndEarnUsdc({
          walletAddress: requireWalletAddress(walletAddress),
          polAmount: earnPolAmount
        });
        setPreparedEarn(prepared);
        setEarnStatus(`Swap and Deposit status: prepared ${prepared.callCount} destination calls.`);
      },
      (error) => {
        setEarnStatus(`Swap and Deposit status: ${describeError(error)}`);
      }
    );
  }

  function sendSwap() {
    void runAction(
      'Send swap',
      async () => {
        const prepared = requirePreparedTransaction(preparedSwap);
        const initialBalances = balances;
        clearFeeSelection();
        try {
          const result = await sendPreparedTransaction(
            prepared,
            setSwapStatus,
            'Swap status: sending...',
            autoFeeOptions.swap
          );
          setLastSwapTransaction(result);
          setSwapStatus(`Swap status: sent ${shortHash(result.value)}. Refreshing balances...`);
          await waitForPostSendRefresh({
            initialBalances,
            initialEarnPositions: earnPositions,
            expectation: prepared.postSendExpectation,
            selectedFeeOption: selectedFeeOption.current,
            setStatus: setSwapStatus,
            pendingStatus: `Swap status: sent ${shortHash(result.value)}. Waiting for expected USDC balance`,
            successStatus: `Swap status: sent ${shortHash(result.value)}. USDC balance updated.`,
            staleStatus: `Swap status: sent ${shortHash(result.value)}. USDC balance has not reached the expected swap output yet.`
          });
        } finally {
          clearFeeSelection();
        }
      },
      (error) => {
        setSwapStatus(`Swap status: ${describeError(error)}`);
      }
    );
  }

  function sendDeposit() {
    void runAction(
      'Send deposit',
      async () => {
        const prepared = requirePreparedYieldTransactions(preparedDeposit);
        const initialBalances = balances;
        const initialEarnPositions = earnPositions;
        clearFeeSelection();

        try {
          const lastResult = await sendYieldTransactionBatch({
            autoPickFeeOption: autoFeeOptions.deposit,
            emptyError: 'Deposit did not send a transaction.',
            onResult: setLastDepositTransaction,
            setStatus: setDepositStatus,
            statusPrefix: 'Deposit status',
            transactions: prepared.transactions
          });
          setDepositStatus(
            `Deposit status: sent ${shortHash(lastResult.value)}. Refreshing balances and earn positions...`
          );
          await waitForPostSendRefresh({
            initialBalances,
            initialEarnPositions,
            expectation: prepared.postSendExpectation,
            setStatus: setDepositStatus,
            pendingStatus: `Deposit status: sent ${shortHash(lastResult.value)}. Waiting for earn position update`,
            successStatus: `Deposit status: sent ${shortHash(lastResult.value)}. Earn position updated.`,
            staleStatus: `Deposit status: sent ${shortHash(lastResult.value)}. Earn position has not updated yet.`
          });
        } finally {
          clearFeeSelection();
        }
      },
      (error) => {
        setDepositStatus(`Deposit status: ${describeError(error)}`);
      }
    );
  }

  function sendEarn() {
    void runAction(
      'Send swap and deposit',
      async () => {
        const prepared = requirePreparedTransaction(preparedEarn);
        const initialBalances = balances;
        const initialEarnPositions = earnPositions;
        clearFeeSelection();
        try {
          const result = await sendPreparedTransaction(
            prepared,
            setEarnStatus,
            'Swap and Deposit status: sending...',
            autoFeeOptions.earn
          );
          setLastEarnTransaction(result);
          setEarnStatus(
            `Swap and Deposit status: sent ${shortHash(result.value)}. Refreshing balances and earn positions...`
          );
          await waitForPostSendRefresh({
            initialBalances,
            initialEarnPositions,
            expectation: prepared.postSendExpectation,
            setStatus: setEarnStatus,
            pendingStatus: `Swap and Deposit status: sent ${shortHash(result.value)}. Waiting for earn position update`,
            successStatus: `Swap and Deposit status: sent ${shortHash(result.value)}. Earn position updated.`,
            staleStatus: `Swap and Deposit status: sent ${shortHash(result.value)}. Earn position has not updated yet.`
          });
        } finally {
          clearFeeSelection();
        }
      },
      (error) => {
        setEarnStatus(`Swap and Deposit status: ${describeError(error)}`);
      }
    );
  }

  function withdrawEarnPosition(position: EarnPosition) {
    void runAction(
      `Withdraw ${position.marketName}`,
      async () => {
        const address = requireWalletAddress(walletAddress);
        const initialBalances = balances;
        const initialEarnPositions = earnPositions;
        clearFeeSelection();
        setWithdrawStatuses((current) => ({
          ...current,
          [position.id]: `Withdraw status: preparing ${position.marketName}...`
        }));
        setEarnPositionsStatus(`Withdraw status: preparing ${position.marketName}...`);
        setLastWithdrawTransactions((current) => {
          const next = { ...current };
          delete next[position.id];
          return next;
        });

        try {
          const prepared = await prepareWithdrawEarnPosition({
            walletAddress: address,
            position
          });

          const sentResult = await sendYieldTransactionBatch({
            autoPickFeeOption: withdrawAutoFeeOptions[position.id] ?? true,
            emptyError: 'Withdraw did not send a transaction.',
            onResult: (result) => {
              setLastWithdrawTransactions((current) => ({
                ...current,
                [position.id]: result
              }));
            },
            setStatus: (status) => {
              setWithdrawStatuses((current) => ({ ...current, [position.id]: status }));
              setEarnPositionsStatus(status);
            },
            statusPrefix: 'Withdraw status',
            transactions: prepared.transactions
          });
          await waitForPostSendRefresh({
            initialBalances,
            initialEarnPositions,
            expectation: prepared.postSendExpectation,
            setStatus: (status) => {
              setWithdrawStatuses((current) => ({ ...current, [position.id]: status }));
              setEarnPositionsStatus(status);
            },
            pendingStatus: `Withdraw status: sent ${shortHash(sentResult.value)}. Waiting for earn position update`,
            successStatus: `Withdraw status: sent ${shortHash(sentResult.value)}. Earn position updated.`,
            staleStatus: `Withdraw status: sent ${shortHash(sentResult.value)}. Earn position has not updated yet.`
          });
        } finally {
          clearFeeSelection();
        }
      },
      (error) => {
        setWithdrawStatuses((current) => ({
          ...current,
          [position.id]: `Withdraw status: ${describeError(error)}`
        }));
        setEarnPositionsStatus(`Withdraw status: ${describeError(error)}`);
      }
    );
  }

  function waitForFeeOptionSelection(
    options: FeeOptionWithBalance[]
  ): Promise<FeeOptionSelection | undefined> {
    if (options.length === 0) {
      appendLog('Transaction fee is sponsored.');
      return Promise.resolve(undefined);
    }

    setFeeOptions(options);
    appendLog('Choose a fee token to continue.');
    return new Promise((resolve, reject) => {
      feeSelection.current = { resolve, reject };
    });
  }

  async function selectFirstAvailableFeeOption(
    options: FeeOptionWithBalance[]
  ): Promise<FeeOptionSelection | undefined> {
    if (options.length === 0) {
      selectedFeeOption.current = null;
      appendLog('Transaction fee is sponsored.');
      return undefined;
    }

    const selection = await FeeOptionSelector.firstAvailable(options);
    if (!selection) {
      throw new Error('No fee option has enough balance.');
    }

    selectedFeeOption.current =
      options.find((option) => option.selection.token === selection.token) ?? null;
    appendLog(
      `Selected ${selectedFeeOption.current?.feeOption.token.symbol ?? selection.token} fee automatically.`
    );
    return selection;
  }

  function selectFeeOption(autoPickFeeOption: boolean) {
    return autoPickFeeOption ? selectFirstAvailableFeeOption : waitForFeeOptionSelection;
  }

  function chooseFeeOption(option: FeeOptionWithBalance) {
    selectedFeeOption.current = option;
    feeSelection.current?.resolve(option.selection);
    feeSelection.current = null;
    setFeeOptions([]);
    appendLog(`Selected ${option.feeOption.token.symbol}.`);
  }

  function cancelFeeSelection() {
    clearFeeSelection(new Error('Fee option selection cancelled'));
  }

  function clearPreparedState() {
    clearFeeSelection(new Error('Transaction state cleared'));
    setPreparedSwap(null);
    setPreparedDeposit(null);
    setPreparedEarn(null);
    setLastSwapTransaction(null);
    setLastDepositTransaction(null);
    setLastEarnTransaction(null);
    setLastWithdrawTransactions({});
    setWithdrawStatuses({});
    setSwapStatus('Swap status: waiting to prepare.');
    setDepositStatus('Deposit status: waiting to prepare.');
    setEarnStatus('Swap and Deposit status: waiting to prepare.');
  }

  function clearFeeSelection(error?: Error) {
    if (error) {
      feeSelection.current?.reject(error);
    }
    feeSelection.current = null;
    selectedFeeOption.current = null;
    setFeeOptions([]);
  }

  async function sendPreparedTransaction(
    prepared: PreparedTrailsTransaction,
    setStatus: (status: string) => void,
    sendingStatus: string,
    autoPickFeeOption: boolean
  ): Promise<TransactionResult> {
    setStatus(sendingStatus);
    const tx = await omsWallet.wallet.sendTransaction({
      network: POLYGON_NETWORK,
      to: prepared.to,
      value: prepared.value,
      data: prepared.data,
      selectFeeOption: selectFeeOption(autoPickFeeOption)
    });
    return transactionResult(tx);
  }

  async function sendYieldTransactionBatch({
    autoPickFeeOption,
    emptyError,
    onResult,
    setStatus,
    statusPrefix,
    transactions
  }: {
    autoPickFeeOption: boolean;
    emptyError: string;
    onResult: (result: TransactionResult) => void;
    setStatus: (status: string) => void;
    statusPrefix: string;
    transactions: PreparedYieldTransactions['transactions'];
  }): Promise<TransactionResult> {
    let lastResult: TransactionResult | null = null;

    for (const [index, transaction] of transactions.entries()) {
      const label =
        transactions.length === 1
          ? 'transaction'
          : `transaction ${index + 1}/${transactions.length}`;
      setStatus(`${statusPrefix}: sending ${label}...`);
      const tx = await omsWallet.wallet.sendTransaction({
        network: POLYGON_NETWORK,
        to: transaction.to,
        value: transaction.value,
        data: transaction.data,
        selectFeeOption: selectFeeOption(autoPickFeeOption)
      });
      lastResult = transactionResult(tx);
      onResult(lastResult);
      setStatus(`${statusPrefix}: sent ${label} ${shortHash(lastResult.value)}.`);
    }

    if (!lastResult) throw new Error(emptyError);
    return lastResult;
  }

  function updateAutoFeeOption(key: AutoFeeOptionKey, value: boolean) {
    setAutoFeeOptions((current) => ({
      ...current,
      [key]: value
    }));
  }

  function updateWithdrawAutoFeeOption(positionId: string, value: boolean) {
    setWithdrawAutoFeeOptions((current) => ({
      ...current,
      [positionId]: value
    }));
  }

  async function waitForPostSendRefresh({
    initialBalances,
    initialEarnPositions,
    expectation,
    selectedFeeOption,
    setStatus,
    pendingStatus,
    successStatus,
    staleStatus
  }: {
    initialBalances: BalanceState;
    initialEarnPositions: EarnPosition[];
    expectation: PostSendExpectation;
    selectedFeeOption?: FeeOptionWithBalance | null;
    setStatus: (status: string) => void;
    pendingStatus: string;
    successStatus: string;
    staleStatus: string;
  }) {
    for (let attempt = 1; attempt <= POST_SEND_REFRESH_ATTEMPTS; attempt += 1) {
      const suffix = attempt === 1 ? '...' : ` (${attempt}/${POST_SEND_REFRESH_ATTEMPTS})...`;
      setStatus(`${pendingStatus}${suffix}`);
      const refreshed = await refreshSignedInData();

      if (
        hasPostSendDataUpdate({
          initialBalances,
          initialEarnPositions,
          expectation,
          selectedFeeOption,
          refreshed
        })
      ) {
        setStatus(successStatus);
        return;
      }

      if (attempt < POST_SEND_REFRESH_ATTEMPTS) {
        await sleep(POST_SEND_REFRESH_DELAY_MS);
      }
    }

    setStatus(`${staleStatus} Use Refresh to check again.`);
  }

  return (
    <main className="shell">
      <section className="panel trails-panel">
        <header>
          <p className="eyebrow">OMS Wallet TypeScript SDK</p>
          <h1>Trails Actions</h1>
          {!isSignedIn && !pendingWalletSelection && authStep === 'email' && (
            <SessionOptions
              useManualWalletSelection={useManualWalletSelection}
              sessionLifetimeSeconds={sessionLifetimeSeconds}
              disabled={isBusy}
              onManualWalletSelectionChange={setUseManualWalletSelection}
              onSessionLifetimeChange={updateSessionLifetime}
            />
          )}
        </header>

        {!isSignedIn && !pendingWalletSelection && authStep === 'email' && (
          <div className="stack">
            <h2 className="section-title">Login Options</h2>
            <OidcButtons
              providers={['google', 'apple']}
              disabled={isBusy}
              status={redirectStatus}
              onStart={startOidcRedirect}
            />
            <div className="divider">or</div>
            <EmailLoginForm
              email={email}
              disabled={isBusy}
              status={authStatus}
              onEmailChange={setEmail}
              onSubmit={startEmailAuth}
            />
          </div>
        )}

        {!isSignedIn && !pendingWalletSelection && authStep === 'code' && (
          <EmailCodeForm
            code={code}
            disabled={isBusy}
            status={authStatus}
            onCodeChange={setCode}
            onSubmit={completeEmailAuth}
            onBack={() => setAuthStep('email')}
          />
        )}

        {!isSignedIn && pendingWalletSelection && (
          <WalletSelectionPanel
            pendingWalletSelection={pendingWalletSelection}
            authStatus={authStatus}
            disabled={isBusy}
            onSelectWallet={selectPendingWallet}
            onCreateWallet={createPendingWallet}
            onCancel={cancelPendingWalletSelection}
          />
        )}

        {isSignedIn && (
          <div className="stack">
            <div className="wallet">
              <span>Wallet</span>
              <div className="wallet-address-row">
                <code>{walletAddress}</code>
                <button
                  type="button"
                  className="wallet-copy"
                  onClick={copyWalletAddress}
                  disabled={isBusy}
                >
                  {walletCopyLabel}
                </button>
              </div>
            </div>

            <div className="session-info">
              {sessionDetails.map((detail) => (
                <div key={detail.label}>
                  <span>{detail.label}</span>
                  <strong>{detail.value}</strong>
                </div>
              ))}
            </div>

            <section className="tool network-tool">
              <div className="tool-header">
                <h2>Network</h2>
                <span className="network-meta">{POLYGON_NETWORK.nativeTokenSymbol}</span>
              </div>
              <input
                aria-label="Network"
                value={`${POLYGON_NETWORK.displayName} (${POLYGON_NETWORK.id})`}
                disabled
                readOnly
              />
            </section>

            <section className="tool">
              <div className="tool-header">
                <h2>Polygon balances</h2>
                <button
                  type="button"
                  className="secondary subtle"
                  onClick={refreshSignedInData}
                  disabled={isBusy}
                >
                  Refresh
                </button>
              </div>
              <div className="balance-grid">
                <BalancePanel label="POL" value={balances.pol} />
                <BalancePanel label="USDC" value={balances.usdc} />
              </div>
              <p className="field-hint compact-hint">{balances.status}</p>
            </section>

            <section className="trails-action-grid">
              <TrailsActionCard
                amountLabel="POL amount"
                amountValue={swapPolAmount}
                onAmountChange={updateSwapPolAmount}
                onPrepare={prepareSwap}
                onSend={sendSwap}
                autoPickFeeOption={autoFeeOptions.swap}
                onAutoPickFeeOptionChange={(value) => updateAutoFeeOption('swap', value)}
                prepared={preparedSwap}
                result={lastSwapTransaction}
                disabled={isBusy}
                sendDisabled={!preparedSwap}
                status={swapStatus}
                title="Swap POL to USDC"
              />

              <TrailsActionCard
                amountLabel="USDC amount"
                amountValue={depositUsdcAmount}
                onAmountChange={updateDepositUsdcAmount}
                onPrepare={prepareDeposit}
                onSend={sendDeposit}
                autoPickFeeOption={autoFeeOptions.deposit}
                onAutoPickFeeOptionChange={(value) => updateAutoFeeOption('deposit', value)}
                preparedYield={preparedDeposit}
                result={lastDepositTransaction}
                disabled={isBusy}
                sendDisabled={!preparedDeposit}
                status={depositStatus}
                title="Deposit USDC using Earn"
              />

              <TrailsActionCard
                amountLabel="POL amount"
                amountValue={earnPolAmount}
                onAmountChange={updateEarnPolAmount}
                onPrepare={prepareEarn}
                onSend={sendEarn}
                autoPickFeeOption={autoFeeOptions.earn}
                onAutoPickFeeOptionChange={(value) => updateAutoFeeOption('earn', value)}
                prepared={preparedEarn}
                result={lastEarnTransaction}
                disabled={isBusy}
                sendDisabled={!preparedEarn}
                status={earnStatus}
                title="Swap POL to USDC, then deposit"
              />
            </section>

            {feeOptions.length > 0 && (
              <FeeOptionsPanel
                feeOptions={feeOptions}
                onCancel={cancelFeeSelection}
                onChoose={chooseFeeOption}
              />
            )}

            <section className="tool">
              <div className="tool-header">
                <h2>Earn positions</h2>
                <span className="metadata-pill">{earnPositions.length}</span>
              </div>
              {earnPositions.length > 0 ? (
                <div className="position-list">
                  {earnPositions.map((position) => (
                    <div key={position.id} className="position-row">
                      <div className="position-header">
                        <strong>{position.marketName}</strong>
                        <span className="position-provider">{position.provider}</span>
                      </div>
                      <div className="position-metrics">
                        <div className="position-metric">
                          <small>Balance</small>
                          <strong>
                            {position.amountDisplay} {position.tokenSymbol}
                          </strong>
                          <span>{position.amountUsd ?? 'USD unavailable'}</span>
                        </div>
                        <div className="position-metric">
                          <small>APY</small>
                          <strong>{position.apy}</strong>
                        </div>
                      </div>
                      <div className="position-footer">
                        <AutoFeeOptionCheckbox
                          checked={withdrawAutoFeeOptions[position.id] ?? true}
                          disabled={isBusy || !position.canWithdraw}
                          onChange={(value) => updateWithdrawAutoFeeOption(position.id, value)}
                        />
                        <div className="position-action">
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => withdrawEarnPosition(position)}
                            disabled={isBusy || !position.canWithdraw}
                          >
                            {position.canWithdraw ? 'Withdraw all' : 'Unavailable'}
                          </button>
                        </div>
                      </div>
                      {withdrawStatuses[position.id] ? (
                        <p className="position-status field-hint compact-hint">
                          {withdrawStatuses[position.id]}
                        </p>
                      ) : null}
                      <TransactionOutput result={lastWithdrawTransactions[position.id] ?? null} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="field-hint compact-hint">{NO_EARN_POSITIONS_STATUS}</p>
              )}
              {showEarnPositionsStatus ? (
                <p className="field-hint compact-hint">{earnPositionsStatus}</p>
              ) : null}
            </section>

            <details className="tool collapsible-tool">
              <summary>Log</summary>
              <div className="collapsible-content">
                <pre className="log-output">{logLines.join('\n')}</pre>
                {loadingAction ? <output>Running: {loadingAction}</output> : null}
              </div>
            </details>

            <button type="button" className="secondary" onClick={signOut} disabled={isBusy}>
              Sign out
            </button>
          </div>
        )}
      </section>

      {sessionExpiredPrompt && (
        <SessionExpiredDialog
          event={sessionExpiredPrompt}
          disabled={isBusy}
          onReauthenticate={reauthenticateExpiredSession}
          onDismiss={dismissSessionExpiredPrompt}
        />
      )}
    </main>
  );
}

function TrailsActionCard({
  amountLabel,
  amountValue,
  onAmountChange,
  onPrepare,
  onSend,
  autoPickFeeOption,
  onAutoPickFeeOptionChange,
  prepared,
  preparedYield,
  result,
  disabled,
  sendDisabled,
  status,
  title
}: {
  amountLabel: string;
  amountValue: string;
  onAmountChange: (value: string) => void;
  onPrepare: () => void;
  onSend: () => void;
  autoPickFeeOption: boolean;
  onAutoPickFeeOptionChange: (value: boolean) => void;
  prepared?: PreparedTrailsTransaction | null;
  preparedYield?: PreparedYieldTransactions | null;
  result: TransactionResult | null;
  disabled: boolean;
  sendDisabled: boolean;
  status: string;
  title: string;
}) {
  return (
    <section className="tool trails-action-card">
      <h2>{title}</h2>
      <label>
        {amountLabel}
        <input
          inputMode="decimal"
          value={amountValue}
          onChange={(event) => onAmountChange(event.target.value)}
          disabled={disabled}
        />
      </label>
      <div className="actions">
        <button type="button" onClick={onPrepare} disabled={disabled}>
          Prepare
        </button>
        <button
          type="button"
          className="secondary"
          onClick={onSend}
          disabled={disabled || sendDisabled}
        >
          Send
        </button>
      </div>
      <AutoFeeOptionCheckbox
        checked={autoPickFeeOption}
        disabled={disabled}
        onChange={onAutoPickFeeOptionChange}
      />
      <p className="field-hint compact-hint">{status}</p>
      {prepared ? <PreparedSummary prepared={prepared} /> : null}
      {preparedYield ? <PreparedYieldSummary prepared={preparedYield} /> : null}
      <TransactionOutput result={result} />
    </section>
  );
}

function AutoFeeOptionCheckbox({
  checked,
  disabled,
  onChange
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="auto-fee-option">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>Pick first available fee option</span>
    </label>
  );
}

function BalancePanel({ label, value }: { label: string; value: string }) {
  return (
    <div className="balance-panel">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PreparedSummary({ prepared }: { prepared: PreparedTrailsTransaction }) {
  return (
    <dl className="prepared-summary">
      <div>
        <dt>Destination calls</dt>
        <dd>{prepared.callCount}</dd>
      </div>
      {prepared.marketName ? (
        <div>
          <dt>Earn market</dt>
          <dd>{prepared.marketName}</dd>
        </div>
      ) : null}
      <div>
        <dt>To</dt>
        <dd>
          <code>{prepared.to}</code>
        </dd>
      </div>
    </dl>
  );
}

function PreparedYieldSummary({ prepared }: { prepared: PreparedYieldTransactions }) {
  return (
    <dl className="prepared-summary">
      <div>
        <dt>Wallet transactions</dt>
        <dd>{prepared.transactions.length}</dd>
      </div>
      {prepared.marketName ? (
        <div>
          <dt>Earn market</dt>
          <dd>{prepared.marketName}</dd>
        </div>
      ) : null}
      <div>
        <dt>First to</dt>
        <dd>
          <code>{prepared.transactions[0]?.to}</code>
        </dd>
      </div>
    </dl>
  );
}

function TransactionOutput({ result }: { result: TransactionResult | null }) {
  if (!result) return null;

  return (
    <div className="result-block">
      <p className="result labeled-result">
        <span className="result-label">
          {result.explorerUrl ? 'Transaction hash' : 'Transaction ID'}
        </span>
        <code className="result-value">{result.value}</code>
      </p>
      {result.explorerUrl ? (
        <a href={result.explorerUrl} target="_blank" rel="noreferrer">
          View on explorer
        </a>
      ) : null}
    </div>
  );
}

function transactionResult(tx: SendTransactionResponse): TransactionResult {
  const value = tx.txnHash ?? tx.txnId;
  return {
    value,
    explorerUrl: tx.txnHash ? explorerUrlFor(tx.txnHash) : undefined
  };
}

function hasPostSendDataUpdate({
  initialBalances,
  initialEarnPositions,
  expectation,
  selectedFeeOption,
  refreshed
}: {
  initialBalances: BalanceState;
  initialEarnPositions: EarnPosition[];
  expectation: PostSendExpectation;
  selectedFeeOption?: FeeOptionWithBalance | null;
  refreshed: SignedInDataRefresh;
}): boolean {
  if (expectation.type === 'usdcIncrease') {
    return hasUsdcIncrease({
      initialBalances,
      minIncreaseRaw: expectation.minIncreaseRaw,
      selectedFeeOption,
      refreshedBalances: refreshed.balances
    });
  }

  if (expectation.type === 'earnMarketIncrease') {
    return hasEarnMarketIncrease({
      initialEarnPositions,
      marketId: expectation.marketId,
      refreshedPositions: refreshed.positions
    });
  }

  return hasEarnMarketDecrease({
    initialEarnPositions,
    marketId: expectation.marketId,
    refreshedPositions: refreshed.positions
  });
}

function hasUsdcIncrease({
  initialBalances,
  minIncreaseRaw,
  selectedFeeOption,
  refreshedBalances
}: {
  initialBalances: BalanceState;
  minIncreaseRaw: string;
  selectedFeeOption?: FeeOptionWithBalance | null;
  refreshedBalances: BalanceState | null;
}): boolean {
  if (!refreshedBalances) return false;

  try {
    const initialUsdc = BigInt(initialBalances.usdcRaw);
    const nextUsdc = BigInt(refreshedBalances.usdcRaw);
    const expectedIncrease = BigInt(minIncreaseRaw) - getSelectedUsdcFeeRaw(selectedFeeOption);
    return expectedIncrease > 0n
      ? nextUsdc >= initialUsdc + expectedIncrease
      : nextUsdc !== initialUsdc;
  } catch {
    return false;
  }
}

function getSelectedUsdcFeeRaw(option?: FeeOptionWithBalance | null): bigint {
  if (option?.feeOption.token.symbol.toUpperCase() !== 'USDC') return 0n;

  try {
    return BigInt(option.feeOption.value);
  } catch {
    return 0n;
  }
}

function hasEarnMarketIncrease({
  initialEarnPositions,
  marketId,
  refreshedPositions
}: {
  initialEarnPositions: EarnPosition[];
  marketId: string;
  refreshedPositions: EarnPosition[] | null;
}): boolean {
  if (!refreshedPositions) return false;

  const previousPosition = findEarnPosition(initialEarnPositions, marketId);
  const nextPosition = findEarnPosition(refreshedPositions, marketId);
  if (!nextPosition) return false;

  try {
    const previousAmount = previousPosition ? BigInt(previousPosition.amountRaw) : 0n;
    return BigInt(nextPosition.amountRaw) > previousAmount;
  } catch {
    return nextPosition.amount !== previousPosition?.amount;
  }
}

function hasEarnMarketDecrease({
  initialEarnPositions,
  marketId,
  refreshedPositions
}: {
  initialEarnPositions: EarnPosition[];
  marketId: string;
  refreshedPositions: EarnPosition[] | null;
}): boolean {
  if (!refreshedPositions) return false;

  const previousPosition = findEarnPosition(initialEarnPositions, marketId);
  if (!previousPosition) return false;

  const nextPosition = findEarnPosition(refreshedPositions, marketId);
  if (!nextPosition) return true;

  try {
    return BigInt(nextPosition.amountRaw) < BigInt(previousPosition.amountRaw);
  } catch {
    return nextPosition.amount !== previousPosition.amount;
  }
}

function findEarnPosition(positions: EarnPosition[], marketId: string): EarnPosition | undefined {
  return positions.find((position) => position.marketId === marketId || position.id === marketId);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export default App;
