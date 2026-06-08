import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type {
  FeeOptionSelection,
  FeeOptionWithBalance,
  OMSClientSessionExpiredEvent,
  OMSClientSessionState,
  OmsWallet,
  PendingWalletSelection,
  SendTransactionResponse,
  WalletActivationResult,
} from '@0xsequence/typescript-sdk'
import { TEST_SESSION_LIFETIME_SECONDS, oms } from './omsClient'
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
  type PreparedYieldTransactions,
} from './trailsActions'
import './styles.css'

type AuthStep = 'email' | 'code'
type TransactionResult = {
  value: string
  explorerUrl?: string
}
type FeeSelectionController = {
  resolve: (selection: FeeOptionSelection) => void
  reject: (error: Error) => void
}

const MANUAL_WALLET_SELECTION_KEY = 'oms-trails-actions-manual-wallet-selection'
const SESSION_LIFETIME_SECONDS_KEY = 'oms-trails-actions-session-lifetime-seconds'
const NO_EARN_POSITIONS_STATUS = 'No deposited earn positions.'
const POST_SEND_REFRESH_ATTEMPTS = 24
const POST_SEND_REFRESH_DELAY_MS = 2500

type SignedInDataRefresh = {
  balances: BalanceState | null
  positions: EarnPosition[] | null
}

function App() {
  const [session, setSession] = useState<OMSClientSessionState>(oms.wallet.session)
  const [authStep, setAuthStep] = useState<AuthStep>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [pendingWalletSelection, setPendingWalletSelection] = useState<PendingWalletSelection | null>(null)
  const [useManualWalletSelection, setUseManualWalletSelection] = useState(readManualWalletSelectionPreference)
  const [sessionLifetimeSeconds, setSessionLifetimeSeconds] = useState(readSessionLifetimePreference)
  const [authStatus, setAuthStatus] = useState('Enter an email to start.')
  const [redirectStatus, setRedirectStatus] = useState('')
  const [sessionExpiredPrompt, setSessionExpiredPrompt] = useState<OMSClientSessionExpiredEvent | null>(null)
  const [balances, setBalances] = useState<BalanceState>(SIGNED_OUT_BALANCES)
  const [earnPositions, setEarnPositions] = useState<EarnPosition[]>([])
  const [earnPositionsStatus, setEarnPositionsStatus] = useState('Sign in to load earn positions.')
  const [swapPolAmount, setSwapPolAmount] = useState(DEFAULT_SWAP_POL_AMOUNT)
  const [depositUsdcAmount, setDepositUsdcAmount] = useState(DEFAULT_DEPOSIT_USDC_AMOUNT)
  const [earnPolAmount, setEarnPolAmount] = useState(DEFAULT_EARN_POL_AMOUNT)
  const [preparedSwap, setPreparedSwap] = useState<PreparedTrailsTransaction | null>(null)
  const [preparedDeposit, setPreparedDeposit] = useState<PreparedYieldTransactions | null>(null)
  const [preparedEarn, setPreparedEarn] = useState<PreparedTrailsTransaction | null>(null)
  const [swapStatus, setSwapStatus] = useState('Swap status: waiting to prepare.')
  const [depositStatus, setDepositStatus] = useState('Deposit status: waiting to prepare.')
  const [earnStatus, setEarnStatus] = useState('Swap and Deposit status: waiting to prepare.')
  const [lastSwapTransaction, setLastSwapTransaction] = useState<TransactionResult | null>(null)
  const [lastDepositTransaction, setLastDepositTransaction] = useState<TransactionResult | null>(null)
  const [lastEarnTransaction, setLastEarnTransaction] = useState<TransactionResult | null>(null)
  const [withdrawStatuses, setWithdrawStatuses] = useState<Record<string, string>>({})
  const [lastWithdrawTransactions, setLastWithdrawTransactions] = useState<Record<string, TransactionResult>>({})
  const [feeOptions, setFeeOptions] = useState<FeeOptionWithBalance[]>([])
  const [logLines, setLogLines] = useState(['Ready.'])
  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const [walletCopyLabel, setWalletCopyLabel] = useState<'Copy' | 'Copied'>('Copy')
  const oidcCallbackStarted = useRef(false)
  const feeSelection = useRef<FeeSelectionController | null>(null)
  const selectedFeeOption = useRef<FeeOptionWithBalance | null>(null)
  const walletCopyReset = useRef<number | null>(null)

  const walletAddress = session.walletAddress
  const isSignedIn = walletAddress != null
  const isBusy = loadingAction != null
  const hasVisibleWithdrawStatus = earnPositions.some((position) => withdrawStatuses[position.id])
  const showEarnPositionsStatus = !hasVisibleWithdrawStatus
    && (earnPositions.length > 0 || earnPositionsStatus !== NO_EARN_POSITIONS_STATUS)

  const appendLog = useCallback((line: string) => {
    setLogLines((current) => [...current, line].slice(-80))
  }, [])

  const refreshSession = useCallback(() => {
    const nextSession = oms.wallet.session
    setSession(nextSession)
    return nextSession
  }, [])

  const runAction = useCallback(
    async (label: string, action: () => Promise<void>, onFailure?: (error: unknown) => void) => {
      appendLog(`> ${label}`)
      setLoadingAction(label)
      try {
        await action()
      } catch (error) {
        onFailure?.(error)
        appendLog(`! ${describeError(error)}`)
      } finally {
        setLoadingAction(null)
      }
    },
    [appendLog],
  )

  const refreshBalances = useCallback(
    async (address: `0x${string}`, status = 'Loading Polygon balances...') => {
      setBalances((current) => ({ ...current, status }))
      try {
        const nextBalances = await getPolygonBalances(address)
        setBalances(nextBalances)
        return nextBalances
      } catch (error) {
        const message = `Balance status: ${describeError(error)}`
        setBalances((current) => ({ ...current, status: message }))
        appendLog(`! ${message}`)
        return null
      }
    },
    [appendLog],
  )

  const refreshEarnPositions = useCallback(
    async (address: `0x${string}`, status = 'Loading Polygon earn positions...') => {
      setEarnPositionsStatus(status)
      try {
        const result = await getPolygonEarnPositions(address)
        setEarnPositions(result.positions)
        if (result.errors.length > 0) {
          setEarnPositionsStatus(`Earn positions loaded with ${result.errors.length} API error(s).`)
          result.errors.forEach((error) => appendLog(`! Earn balance error: ${error}`))
        } else {
          setEarnPositionsStatus(result.positions.length > 0 ? 'Earn positions updated.' : NO_EARN_POSITIONS_STATUS)
        }
        return result.positions
      } catch (error) {
        const message = `Earn positions status: ${describeError(error)}`
        setEarnPositionsStatus(message)
        appendLog(`! ${message}`)
        return null
      }
    },
    [appendLog],
  )

  const refreshSignedInData = useCallback(async (): Promise<SignedInDataRefresh> => {
    if (!walletAddress) {
      return {
        balances: null,
        positions: null,
      }
    }

    const [nextBalances, nextPositions] = await Promise.all([
      refreshBalances(walletAddress, 'Refreshing Polygon balances...'),
      refreshEarnPositions(walletAddress, 'Refreshing Polygon earn positions...'),
    ])

    return {
      balances: nextBalances,
      positions: nextPositions,
    }
  }, [refreshBalances, refreshEarnPositions, walletAddress])

  useEffect(() => {
    window.sessionStorage.setItem(MANUAL_WALLET_SELECTION_KEY, useManualWalletSelection ? 'true' : 'false')
  }, [useManualWalletSelection])

  useEffect(() => {
    window.sessionStorage.setItem(SESSION_LIFETIME_SECONDS_KEY, sessionLifetimeSeconds.toString())
  }, [sessionLifetimeSeconds])

  useEffect(() => {
    return oms.wallet.onSessionExpired(showSessionExpired)
  }, [])

  useEffect(() => {
    return () => {
      if (walletCopyReset.current !== null) {
        window.clearTimeout(walletCopyReset.current)
      }
    }
  }, [])

  useEffect(() => {
    if (oms.wallet.walletAddress) {
      const restored = refreshSession()
      setAuthStatus('Wallet session restored.')
      appendLog(`Wallet ready: ${restored.walletAddress}`)
      return
    }

    const params = new URLSearchParams(window.location.search)
    if (params.has('code') || params.has('state') || params.has('error')) {
      if (oidcCallbackStarted.current) return
      oidcCallbackStarted.current = true
      void completeOidcRedirect()
    }
  }, [appendLog, refreshSession])

  useEffect(() => {
    if (!walletAddress) {
      setBalances(SIGNED_OUT_BALANCES)
      setEarnPositions([])
      setEarnPositionsStatus('Sign in to load earn positions.')
      setWithdrawStatuses({})
      setLastWithdrawTransactions({})
      return
    }

    void refreshBalances(walletAddress)
    void refreshEarnPositions(walletAddress)
  }, [refreshBalances, refreshEarnPositions, walletAddress])

  const sessionDetails = useMemo(
    () => [
      { label: 'Login', value: formatLoginType(session.loginType) },
      { label: 'Email', value: session.sessionEmail ?? 'Unavailable' },
      { label: 'Expires', value: formatSessionExpiry(session.expiresAt) },
    ],
    [session.expiresAt, session.loginType, session.sessionEmail],
  )

  function startEmailAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void runAction(
      'Start email sign-in',
      async () => {
        const normalizedEmail = email.trim()
        if (!normalizedEmail) throw new Error('Email is required.')
        setSessionExpiredPrompt(null)
        setPendingWalletSelection(null)
        setAuthStatus('Requesting email code...')
        await oms.wallet.startEmailAuth({ email: normalizedEmail })
        setEmail('')
        setAuthStep('code')
        setAuthStatus(`Code requested for ${normalizedEmail}`)
      },
      (error) => {
        setAuthStatus(`Sign-in error: ${describeError(error)}`)
      },
    )
  }

  function completeEmailAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void runAction(
      'Complete email sign-in',
      async () => {
        const normalizedCode = code.trim()
        if (!normalizedCode) throw new Error('Code is required.')
        setAuthStatus('Verifying code...')
        const result = await oms.wallet.completeEmailAuth({
          code: normalizedCode,
          walletSelection: useManualWalletSelection ? 'manual' : 'automatic',
          sessionLifetimeSeconds,
        })
        setCode('')
        setAuthStep('email')
        handleAuthCompletion(result, 'Email login complete.')
      },
      (error) => {
        setAuthStatus(`Verify error: ${describeError(error)}`)
      },
    )
  }

  function startOidcRedirect() {
    void runAction(
      'Start Google sign-in',
      async () => {
        window.sessionStorage.setItem(MANUAL_WALLET_SELECTION_KEY, useManualWalletSelection ? 'true' : 'false')
        window.sessionStorage.setItem(SESSION_LIFETIME_SECONDS_KEY, sessionLifetimeSeconds.toString())
        setSessionExpiredPrompt(null)
        setPendingWalletSelection(null)
        setRedirectStatus('Redirecting to provider...')
        await oms.wallet.signInWithOidcRedirect({
          provider: 'google',
          loginHint: email.trim() || oms.wallet.session.sessionEmail,
          sessionLifetimeSeconds,
        })
      },
      (error) => {
        setRedirectStatus(`Google sign-in error: ${describeError(error)}`)
      },
    )
  }

  function completeOidcRedirect() {
    void runAction(
      'Complete Google sign-in',
      async () => {
        const result = await oms.wallet.signInWithOidcRedirect({
          provider: 'google',
          walletSelection: readManualWalletSelectionPreference() ? 'manual' : 'automatic',
          sessionLifetimeSeconds: readSessionLifetimePreference(),
        })
        if (result) {
          handleAuthCompletion(result, 'Google login complete.')
          return
        }

        const restored = refreshSession()
        if (restored.walletAddress) {
          setRedirectStatus('Google login complete.')
          appendLog(`Wallet ready: ${restored.walletAddress}`)
        } else {
          setAuthStatus('Enter an email to start.')
        }
      },
      (error) => {
        setRedirectStatus(`Google redirect error: ${describeError(error)}`)
      },
    )
  }

  function handleAuthCompletion(result: PendingWalletSelection | WalletActivationResult, status: string) {
    setSessionExpiredPrompt(null)
    if (isPendingWalletSelection(result)) {
      setPendingWalletSelection(result)
      setAuthStatus('Choose a wallet to continue.')
      setRedirectStatus('')
      return
    }

    setPendingWalletSelection(null)
    setAuthStatus(status)
    setRedirectStatus('')
    setSession(oms.wallet.session)
    appendLog(`Wallet ready: ${result.walletAddress}`)
  }

  function showSessionExpired(event: OMSClientSessionExpiredEvent) {
    feeSelection.current?.reject(new Error('Session expired'))
    feeSelection.current = null
    selectedFeeOption.current = null
    setPendingWalletSelection(null)
    setSession(oms.wallet.session)
    setAuthStep('email')
    setCode('')
    setAuthStatus(
      event.session.sessionEmail
        ? `Session expired for ${event.session.sessionEmail}.`
        : 'Session expired. Enter an email to continue.',
    )
    setRedirectStatus('')
    clearPreparedState()
    setBalances(SIGNED_OUT_BALANCES)
    setEarnPositions([])
    setEarnPositionsStatus('Sign in to load earn positions.')
    setWithdrawStatuses({})
    setLastWithdrawTransactions({})
    if (event.session.sessionEmail) {
      setEmail(event.session.sessionEmail)
    }
    setSessionExpiredPrompt(event)
    appendLog('Session expired.')
  }

  function reauthenticateExpiredSession() {
    if (!sessionExpiredPrompt) return

    const expiredSession = sessionExpiredPrompt.session
    if (expiredSession.loginType === 'google-auth') {
      void runAction(
        'Reauthenticate with Google',
        async () => {
          setSessionExpiredPrompt(null)
          window.sessionStorage.setItem(MANUAL_WALLET_SELECTION_KEY, useManualWalletSelection ? 'true' : 'false')
          window.sessionStorage.setItem(SESSION_LIFETIME_SECONDS_KEY, sessionLifetimeSeconds.toString())
          setPendingWalletSelection(null)
          setRedirectStatus('Redirecting to Google...')
          await oms.wallet.signInWithOidcRedirect({
            provider: 'google',
            loginHint: expiredSession.sessionEmail,
            sessionLifetimeSeconds,
          })
        },
        (error) => {
          setRedirectStatus(`Google reauth error: ${describeError(error)}`)
        },
      )
      return
    }

    if (expiredSession.loginType === 'email' && expiredSession.sessionEmail) {
      void runAction(
        'Send reauth code',
        async () => {
          setSessionExpiredPrompt(null)
          setPendingWalletSelection(null)
          setEmail(expiredSession.sessionEmail ?? '')
          setAuthStatus('Requesting email code...')
          await oms.wallet.startEmailAuth({ email: expiredSession.sessionEmail ?? '' })
          setAuthStep('code')
          setAuthStatus('Code sent. Check your email.')
        },
        (error) => {
          setAuthStatus(`Reauth error: ${describeError(error)}`)
        },
      )
      return
    }

    setSessionExpiredPrompt(null)
    setAuthStep('email')
    setAuthStatus('Enter an email to start.')
  }

  function dismissSessionExpiredPrompt() {
    setSessionExpiredPrompt(null)
    setAuthStep('email')
  }

  function updateSessionLifetime(value: string) {
    const next = Math.floor(Number(value))
    if (!Number.isFinite(next)) return
    setSessionLifetimeSeconds(Math.max(1, next))
  }

  function selectPendingWallet(wallet: OmsWallet) {
    if (!pendingWalletSelection) return
    void runAction(
      'Selecting wallet',
      async () => {
        const result = await pendingWalletSelection.selectWallet({ walletId: wallet.id })
        handleAuthCompletion(result, 'Wallet selected.')
      },
      (error) => {
        setAuthStatus(`Wallet selection error: ${describeError(error)}`)
      },
    )
  }

  function createPendingWallet() {
    if (!pendingWalletSelection) return
    void runAction(
      'Creating wallet',
      async () => {
        const result = await pendingWalletSelection.createAndSelectWallet({ reference: 'trails-actions' })
        handleAuthCompletion(result, 'Wallet created.')
      },
      (error) => {
        setAuthStatus(`Wallet creation error: ${describeError(error)}`)
      },
    )
  }

  function cancelPendingWalletSelection() {
    void runAction('Cancel wallet selection', async () => {
      await oms.wallet.signOut()
      setSessionExpiredPrompt(null)
      setPendingWalletSelection(null)
      setSession(oms.wallet.session)
      setAuthStep('email')
      setCode('')
      setAuthStatus('Enter an email to start.')
      setRedirectStatus('')
      clearPreparedState()
    })
  }

  function signOut() {
    void runAction('Sign out', async () => {
      await oms.wallet.signOut()
      setSessionExpiredPrompt(null)
      setPendingWalletSelection(null)
      setSession(oms.wallet.session)
      setAuthStep('email')
      setCode('')
      setAuthStatus('Signed out.')
      setRedirectStatus('')
      clearPreparedState()
      setBalances(SIGNED_OUT_BALANCES)
      setEarnPositions([])
      setEarnPositionsStatus('Sign in to load earn positions.')
      setWithdrawStatuses({})
      setLastWithdrawTransactions({})
    })
  }

  function copyWalletAddress() {
    if (!walletAddress) return
    void navigator.clipboard.writeText(walletAddress)
      .then(() => {
        setWalletCopyLabel('Copied')
        if (walletCopyReset.current !== null) {
          window.clearTimeout(walletCopyReset.current)
        }
        walletCopyReset.current = window.setTimeout(() => {
          setWalletCopyLabel('Copy')
          walletCopyReset.current = null
        }, 1500)
        appendLog('Copied wallet address.')
      })
      .catch((error) => {
        appendLog(`! Copy wallet address: ${describeError(error)}`)
      })
  }

  function updateSwapPolAmount(value: string) {
    feeSelection.current?.reject(new Error('Amount changed'))
    feeSelection.current = null
    setFeeOptions([])
    setSwapPolAmount(normalizeAmountInput(value))
    setPreparedSwap(null)
    setLastSwapTransaction(null)
    setSwapStatus('Swap status: waiting to prepare.')
  }

  function updateDepositUsdcAmount(value: string) {
    feeSelection.current?.reject(new Error('Amount changed'))
    feeSelection.current = null
    setFeeOptions([])
    setDepositUsdcAmount(normalizeAmountInput(value))
    setPreparedDeposit(null)
    setLastDepositTransaction(null)
    setDepositStatus('Deposit status: waiting to prepare.')
  }

  function updateEarnPolAmount(value: string) {
    feeSelection.current?.reject(new Error('Amount changed'))
    feeSelection.current = null
    setFeeOptions([])
    setEarnPolAmount(normalizeAmountInput(value))
    setPreparedEarn(null)
    setLastEarnTransaction(null)
    setEarnStatus('Swap and Deposit status: waiting to prepare.')
  }

  function prepareSwap() {
    void runAction(
      'Prepare swap',
      async () => {
        const prepared = await prepareSwapPolToUsdc({
          walletAddress: requireWalletAddress(walletAddress),
          polAmount: swapPolAmount,
        })
        setPreparedSwap(prepared)
        setSwapStatus(`Swap status: prepared ${prepared.callCount} destination calls.`)
      },
      (error) => {
        setSwapStatus(`Swap status: ${describeError(error)}`)
      },
    )
  }

  function prepareDeposit() {
    void runAction(
      'Prepare deposit',
      async () => {
        const prepared = await prepareDepositUsdc({
          walletAddress: requireWalletAddress(walletAddress),
          usdcAmount: depositUsdcAmount,
        })
        setPreparedDeposit(prepared)
        setDepositStatus(
          `Deposit status: prepared ${prepared.transactions.length} wallet transaction${prepared.transactions.length === 1 ? '' : 's'}.`,
        )
      },
      (error) => {
        setDepositStatus(`Deposit status: ${describeError(error)}`)
      },
    )
  }

  function prepareEarn() {
    void runAction(
      'Prepare swap and deposit',
      async () => {
        const prepared = await prepareSwapAndEarnUsdc({
          walletAddress: requireWalletAddress(walletAddress),
          polAmount: earnPolAmount,
        })
        setPreparedEarn(prepared)
        setEarnStatus(`Swap and Deposit status: prepared ${prepared.callCount} destination calls.`)
      },
      (error) => {
        setEarnStatus(`Swap and Deposit status: ${describeError(error)}`)
      },
    )
  }

  function sendSwap() {
    void runAction(
      'Send swap',
      async () => {
        const prepared = requirePreparedTransaction(preparedSwap)
        const initialBalances = balances
        feeSelection.current = null
        selectedFeeOption.current = null
        setFeeOptions([])
        try {
          setSwapStatus('Swap status: sending...')
          const tx = await oms.wallet.sendTransaction({
            network: POLYGON_NETWORK,
            to: prepared.to,
            value: BigInt(prepared.value),
            data: prepared.data,
            selectFeeOption: waitForFeeOptionSelection,
          })
          const result = transactionResult(tx)
          setLastSwapTransaction(result)
          setSwapStatus(`Swap status: sent ${shortHash(result.value)}. Refreshing balances...`)
          await waitForPostSendRefresh({
            initialBalances,
            initialEarnPositions: earnPositions,
            expectation: prepared.postSendExpectation,
            selectedFeeOption: selectedFeeOption.current,
            setStatus: setSwapStatus,
            pendingStatus: `Swap status: sent ${shortHash(result.value)}. Waiting for expected USDC balance`,
            successStatus: `Swap status: sent ${shortHash(result.value)}. USDC balance updated.`,
            staleStatus: `Swap status: sent ${shortHash(result.value)}. USDC balance has not reached the expected swap output yet.`,
          })
        } finally {
          feeSelection.current = null
          selectedFeeOption.current = null
          setFeeOptions([])
        }
      },
      (error) => {
        setSwapStatus(`Swap status: ${describeError(error)}`)
      },
    )
  }

  function sendDeposit() {
    void runAction(
      'Send deposit',
      async () => {
        const prepared = requirePreparedYieldTransactions(preparedDeposit)
        let lastResult: TransactionResult | null = null
        const initialBalances = balances
        const initialEarnPositions = earnPositions
        feeSelection.current = null
        selectedFeeOption.current = null
        setFeeOptions([])

        try {
          for (const [index, transaction] of prepared.transactions.entries()) {
            const label = prepared.transactions.length === 1 ? 'transaction' : `transaction ${index + 1}/${prepared.transactions.length}`
            setDepositStatus(`Deposit status: sending ${label}...`)
            const tx = await oms.wallet.sendTransaction({
              network: POLYGON_NETWORK,
              to: transaction.to,
              value: transaction.value,
              data: transaction.data,
              selectFeeOption: waitForFeeOptionSelection,
            })
            lastResult = transactionResult(tx)
            setLastDepositTransaction(lastResult)
            setDepositStatus(`Deposit status: sent ${label} ${shortHash(lastResult.value)}.`)
          }

          if (!lastResult) throw new Error('Deposit did not send a transaction.')
          setDepositStatus(`Deposit status: sent ${shortHash(lastResult.value)}. Refreshing balances and earn positions...`)
          await waitForPostSendRefresh({
            initialBalances,
            initialEarnPositions,
            expectation: prepared.postSendExpectation,
            setStatus: setDepositStatus,
            pendingStatus: `Deposit status: sent ${shortHash(lastResult.value)}. Waiting for earn position update`,
            successStatus: `Deposit status: sent ${shortHash(lastResult.value)}. Earn position updated.`,
            staleStatus: `Deposit status: sent ${shortHash(lastResult.value)}. Earn position has not updated yet.`,
          })
        } finally {
          feeSelection.current = null
          selectedFeeOption.current = null
          setFeeOptions([])
        }
      },
      (error) => {
        setDepositStatus(`Deposit status: ${describeError(error)}`)
      },
    )
  }

  function sendEarn() {
    void runAction(
      'Send swap and deposit',
      async () => {
        const prepared = requirePreparedTransaction(preparedEarn)
        const initialBalances = balances
        const initialEarnPositions = earnPositions
        feeSelection.current = null
        selectedFeeOption.current = null
        setFeeOptions([])
        try {
          setEarnStatus('Swap and Deposit status: sending...')
          const tx = await oms.wallet.sendTransaction({
            network: POLYGON_NETWORK,
            to: prepared.to,
            value: BigInt(prepared.value),
            data: prepared.data,
            selectFeeOption: waitForFeeOptionSelection,
          })
          const result = transactionResult(tx)
          setLastEarnTransaction(result)
          setEarnStatus(`Swap and Deposit status: sent ${shortHash(result.value)}. Refreshing balances and earn positions...`)
          await waitForPostSendRefresh({
            initialBalances,
            initialEarnPositions,
            expectation: prepared.postSendExpectation,
            setStatus: setEarnStatus,
            pendingStatus: `Swap and Deposit status: sent ${shortHash(result.value)}. Waiting for earn position update`,
            successStatus: `Swap and Deposit status: sent ${shortHash(result.value)}. Earn position updated.`,
            staleStatus: `Swap and Deposit status: sent ${shortHash(result.value)}. Earn position has not updated yet.`,
          })
        } finally {
          feeSelection.current = null
          selectedFeeOption.current = null
          setFeeOptions([])
        }
      },
      (error) => {
        setEarnStatus(`Swap and Deposit status: ${describeError(error)}`)
      },
    )
  }

  function withdrawEarnPosition(position: EarnPosition) {
    void runAction(
      `Withdraw ${position.marketName}`,
      async () => {
        const address = requireWalletAddress(walletAddress)
        const initialBalances = balances
        const initialEarnPositions = earnPositions
        let lastResult: TransactionResult | null = null
        feeSelection.current = null
        selectedFeeOption.current = null
        setFeeOptions([])
        setWithdrawStatuses((current) => ({
          ...current,
          [position.id]: `Withdraw status: preparing ${position.marketName}...`,
        }))
        setEarnPositionsStatus(`Withdraw status: preparing ${position.marketName}...`)
        setLastWithdrawTransactions((current) => {
          const next = { ...current }
          delete next[position.id]
          return next
        })

        try {
          const prepared = await prepareWithdrawEarnPosition({
            walletAddress: address,
            position,
          })

          for (const [index, transaction] of prepared.transactions.entries()) {
            const label = prepared.transactions.length === 1
              ? 'transaction'
              : `transaction ${index + 1}/${prepared.transactions.length}`
            setWithdrawStatuses((current) => ({
              ...current,
              [position.id]: `Withdraw status: sending ${label}...`,
            }))
            setEarnPositionsStatus(`Withdraw status: sending ${label}...`)
            const tx = await oms.wallet.sendTransaction({
              network: POLYGON_NETWORK,
              to: transaction.to,
              value: transaction.value,
              data: transaction.data,
              selectFeeOption: waitForFeeOptionSelection,
            })
            const result = transactionResult(tx)
            lastResult = result
            setLastWithdrawTransactions((current) => ({
              ...current,
              [position.id]: result,
            }))
            setWithdrawStatuses((current) => ({
              ...current,
              [position.id]: `Withdraw status: sent ${label} ${shortHash(result.value)}.`,
            }))
            setEarnPositionsStatus(`Withdraw status: sent ${label} ${shortHash(result.value)}.`)
          }

          if (!lastResult) throw new Error('Withdraw did not send a transaction.')
          const sentResult = lastResult
          await waitForPostSendRefresh({
            initialBalances,
            initialEarnPositions,
            expectation: prepared.postSendExpectation,
            setStatus: (status) => {
              setWithdrawStatuses((current) => ({ ...current, [position.id]: status }))
              setEarnPositionsStatus(status)
            },
            pendingStatus: `Withdraw status: sent ${shortHash(sentResult.value)}. Waiting for earn position update`,
            successStatus: `Withdraw status: sent ${shortHash(sentResult.value)}. Earn position updated.`,
            staleStatus: `Withdraw status: sent ${shortHash(sentResult.value)}. Earn position has not updated yet.`,
          })
        } finally {
          feeSelection.current = null
          selectedFeeOption.current = null
          setFeeOptions([])
        }
      },
      (error) => {
        setWithdrawStatuses((current) => ({
          ...current,
          [position.id]: `Withdraw status: ${describeError(error)}`,
        }))
        setEarnPositionsStatus(`Withdraw status: ${describeError(error)}`)
      },
    )
  }

  function waitForFeeOptionSelection(options: FeeOptionWithBalance[]): Promise<FeeOptionSelection> {
    setFeeOptions(options)
    appendLog('Choose a fee token to continue.')
    return new Promise((resolve, reject) => {
      feeSelection.current = { resolve, reject }
    })
  }

  function chooseFeeOption(option: FeeOptionWithBalance) {
    if (!canAffordFeeOption(option)) {
      appendLog(`! Insufficient ${option.feeOption.token.symbol} balance for fee.`)
      return
    }

    selectedFeeOption.current = option
    feeSelection.current?.resolve(option.selection)
    feeSelection.current = null
    setFeeOptions([])
    appendLog(`Selected ${option.feeOption.token.symbol}.`)
  }

  function cancelFeeSelection() {
    feeSelection.current?.reject(new Error('Fee option selection cancelled'))
    feeSelection.current = null
    selectedFeeOption.current = null
    setFeeOptions([])
  }

  function clearPreparedState() {
    feeSelection.current?.reject(new Error('Transaction state cleared'))
    feeSelection.current = null
    selectedFeeOption.current = null
    setFeeOptions([])
    setPreparedSwap(null)
    setPreparedDeposit(null)
    setPreparedEarn(null)
    setLastSwapTransaction(null)
    setLastDepositTransaction(null)
    setLastEarnTransaction(null)
    setLastWithdrawTransactions({})
    setWithdrawStatuses({})
    setSwapStatus('Swap status: waiting to prepare.')
    setDepositStatus('Deposit status: waiting to prepare.')
    setEarnStatus('Swap and Deposit status: waiting to prepare.')
  }

  async function waitForPostSendRefresh({
    initialBalances,
    initialEarnPositions,
    expectation,
    selectedFeeOption,
    setStatus,
    pendingStatus,
    successStatus,
    staleStatus,
  }: {
    initialBalances: BalanceState
    initialEarnPositions: EarnPosition[]
    expectation: PostSendExpectation
    selectedFeeOption?: FeeOptionWithBalance | null
    setStatus: (status: string) => void
    pendingStatus: string
    successStatus: string
    staleStatus: string
  }) {
    for (let attempt = 1; attempt <= POST_SEND_REFRESH_ATTEMPTS; attempt += 1) {
      const suffix = attempt === 1 ? '...' : ` (${attempt}/${POST_SEND_REFRESH_ATTEMPTS})...`
      setStatus(`${pendingStatus}${suffix}`)
      const refreshed = await refreshSignedInData()

      if (hasPostSendDataUpdate({
        initialBalances,
        initialEarnPositions,
        expectation,
        selectedFeeOption,
        refreshed,
      })) {
        setStatus(successStatus)
        return
      }

      if (attempt < POST_SEND_REFRESH_ATTEMPTS) {
        await sleep(POST_SEND_REFRESH_DELAY_MS)
      }
    }

    setStatus(`${staleStatus} Use Refresh to check again.`)
  }

  return (
    <main className="shell">
      <section className="panel trails-panel">
        <header>
          <p className="eyebrow">OMS Client TypeScript SDK</p>
          <h1>Trails Actions</h1>
          {!isSignedIn && !pendingWalletSelection && authStep === 'email' && (
            <div className="header-options">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={useManualWalletSelection}
                  onChange={(event) => setUseManualWalletSelection(event.target.checked)}
                  disabled={isBusy}
                />
                <span>Use manual wallet selection</span>
              </label>
              <label className="session-lifetime-option">
                <span className="session-lifetime-copy">
                  <strong>Session lifetime</strong>
                  <small>Shorten this to test session expiry easier.</small>
                </span>
                <span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={sessionLifetimeSeconds}
                    onChange={(event) => updateSessionLifetime(event.target.value)}
                    disabled={isBusy}
                  />
                  <small>seconds</small>
                </span>
              </label>
            </div>
          )}
        </header>

        {!isSignedIn && !pendingWalletSelection && authStep === 'email' && (
          <form className="stack" onSubmit={startEmailAuth}>
            <h2 className="section-title">Login Options</h2>
            <div className="field-stack">
              <button
                type="button"
                className="secondary"
                onClick={startOidcRedirect}
                disabled={isBusy}
                aria-describedby="google-status"
              >
                Continue with Google
              </button>
              {redirectStatus && <p id="google-status" className="field-hint">{redirectStatus}</p>}
            </div>
            <div className="divider">or</div>
            <div className="field-stack">
              <label>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="user@example.com"
                  aria-describedby="email-status"
                  disabled={isBusy}
                />
              </label>
              <p id="email-status" className="field-hint">{authStatus}</p>
            </div>
            <button type="submit" disabled={isBusy || !email.trim()}>
              Send code
            </button>
          </form>
        )}

        {!isSignedIn && !pendingWalletSelection && authStep === 'code' && (
          <form className="stack" onSubmit={completeEmailAuth}>
            <div className="field-stack">
              <label>
                Code
                <input
                  autoFocus
                  inputMode="numeric"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="123456"
                  aria-describedby="code-status"
                  disabled={isBusy}
                />
              </label>
              <p id="code-status" className="field-hint">{authStatus}</p>
            </div>
            <div className="actions">
              <button type="submit" disabled={isBusy || !code.trim()}>
                Complete sign-in
              </button>
              <button type="button" className="secondary" onClick={() => setAuthStep('email')} disabled={isBusy}>
                Back
              </button>
            </div>
          </form>
        )}

        {!isSignedIn && pendingWalletSelection && (
          <div className="stack">
            <section className="tool wallet-selection">
              <div className="tool-header">
                <h2>Choose wallet</h2>
                <span className="metadata-pill">{formatWalletType(pendingWalletSelection.walletType)}</span>
              </div>
              <h3>Existing wallets</h3>
              {pendingWalletSelection.wallets.length > 0 ? (
                <div className="wallet-option-list">
                  {pendingWalletSelection.wallets.map((wallet) => (
                    <button
                      key={wallet.id}
                      type="button"
                      className="wallet-option"
                      onClick={() => selectPendingWallet(wallet)}
                      disabled={isBusy}
                    >
                      <span>
                        <strong>{wallet.reference ?? `${formatWalletType(wallet.type)} wallet`}</strong>
                        <small>{wallet.id}</small>
                      </span>
                      <code>{wallet.address}</code>
                      <span className="wallet-option-action">Use wallet</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="field-hint">No existing {formatWalletType(pendingWalletSelection.walletType)} wallets.</p>
              )}

              <h3>Create new wallet</h3>
              <button type="button" onClick={createPendingWallet} disabled={isBusy}>
                Create wallet
              </button>

              <button type="button" className="secondary subtle" onClick={cancelPendingWalletSelection} disabled={isBusy}>
                Cancel
              </button>
            </section>
            {authStatus && <output>{authStatus}</output>}
          </div>
        )}

        {isSignedIn && (
          <div className="stack">
            <div className="wallet">
              <span>Wallet</span>
              <div className="wallet-address-row">
                <code>{walletAddress}</code>
                <button type="button" className="wallet-copy" onClick={copyWalletAddress} disabled={isBusy}>
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
              <input aria-label="Network" value={`${POLYGON_NETWORK.displayName} (${POLYGON_NETWORK.id})`} disabled readOnly />
            </section>

            <section className="tool">
              <div className="tool-header">
                <h2>Polygon balances</h2>
                <button type="button" className="secondary subtle" onClick={refreshSignedInData} disabled={isBusy}>
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
                      <div>
                        <strong>{position.marketName}</strong>
                        <small>{position.provider}</small>
                      </div>
                      <div>
                        <strong>
                          {position.amountDisplay} {position.tokenSymbol}
                        </strong>
                        <small>{position.amountUsd ?? 'USD unavailable'}</small>
                      </div>
                      <div>
                        <strong>{position.apy}</strong>
                        <small>APY</small>
                      </div>
                      <div className="position-action">
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => withdrawEarnPosition(position)}
                          disabled={isBusy || !position.canWithdraw}
                        >
                          Withdraw
                        </button>
                        <small>{position.canWithdraw ? 'All' : 'Unavailable'}</small>
                      </div>
                      {withdrawStatuses[position.id] ? (
                        <p className="position-status field-hint compact-hint">{withdrawStatuses[position.id]}</p>
                      ) : null}
                      <TransactionOutput result={lastWithdrawTransactions[position.id] ?? null} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="field-hint compact-hint">{NO_EARN_POSITIONS_STATUS}</p>
              )}
              {showEarnPositionsStatus ? <p className="field-hint compact-hint">{earnPositionsStatus}</p> : null}
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
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="session-expired-title"
          >
            <h2 id="session-expired-title">Session expired</h2>
            <p>
              Your wallet session has expired. Reauthenticate to continue using this wallet.
            </p>
            {sessionExpiredPrompt.session.sessionEmail && (
              <p className="modal-detail">
                Account <strong>{sessionExpiredPrompt.session.sessionEmail}</strong>
              </p>
            )}
            <p className="modal-hint">
              {sessionExpiredPrompt.session.loginType === 'google-auth'
                ? 'You will be redirected to Google with the same account selected.'
                : sessionExpiredPrompt.session.loginType === 'email' && sessionExpiredPrompt.session.sessionEmail
                  ? 'A new sign-in code will be sent to the same email address.'
                  : 'Sign in again to continue.'}
            </p>
            <div className="modal-actions">
              <button type="button" onClick={reauthenticateExpiredSession} disabled={isBusy}>
                Reauthenticate
              </button>
              <button type="button" className="secondary" onClick={dismissSessionExpiredPrompt} disabled={isBusy}>
                Not now
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

function TrailsActionCard({
  amountLabel,
  amountValue,
  onAmountChange,
  onPrepare,
  onSend,
  prepared,
  preparedYield,
  result,
  disabled,
  sendDisabled,
  status,
  title,
}: {
  amountLabel: string
  amountValue: string
  onAmountChange: (value: string) => void
  onPrepare: () => void
  onSend: () => void
  prepared?: PreparedTrailsTransaction | null
  preparedYield?: PreparedYieldTransactions | null
  result: TransactionResult | null
  disabled: boolean
  sendDisabled: boolean
  status: string
  title: string
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
        <button type="button" className="secondary" onClick={onSend} disabled={disabled || sendDisabled}>
          Send
        </button>
      </div>
      <p className="field-hint compact-hint">{status}</p>
      {prepared ? <PreparedSummary prepared={prepared} /> : null}
      {preparedYield ? <PreparedYieldSummary prepared={preparedYield} /> : null}
      <TransactionOutput result={result} />
    </section>
  )
}

function FeeOptionsPanel({
  feeOptions,
  onCancel,
  onChoose,
}: {
  feeOptions: FeeOptionWithBalance[]
  onCancel: () => void
  onChoose: (option: FeeOptionWithBalance) => void
}) {
  return (
    <div className="fee-modal-backdrop">
      <section className="tool fee-options" role="dialog" aria-modal="true" aria-labelledby="fee-options-title">
        <h2 id="fee-options-title">Fee option</h2>
        <div className="fee-option-list">
          {feeOptions.map((option) => {
            const canAfford = canAffordFeeOption(option)

            return (
              <button
                key={`${option.feeOption.token.symbol}-${option.feeOption.value}`}
                type="button"
                className="fee-option"
                onClick={() => onChoose(option)}
                disabled={!canAfford}
              >
                <span>
                  <strong>{option.feeOption.token.symbol}</strong>
                  <small>{option.feeOption.displayValue || option.feeOption.value}</small>
                </span>
                <span>{canAfford ? option.available ?? 'Balance unavailable' : 'Insufficient balance'}</span>
              </button>
            )
          })}
        </div>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel transaction
        </button>
      </section>
    </div>
  )
}

function BalancePanel({ label, value }: { label: string; value: string }) {
  return (
    <div className="balance-panel">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
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
  )
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
  )
}

function TransactionOutput({ result }: { result: TransactionResult | null }) {
  if (!result) return null

  return (
    <div className="result-block">
      <p className="result labeled-result">
        <span className="result-label">{result.explorerUrl ? 'Transaction hash' : 'Transaction ID'}</span>
        <code className="result-value">{result.value}</code>
      </p>
      {result.explorerUrl ? (
        <a href={result.explorerUrl} target="_blank" rel="noreferrer">
          View on explorer
        </a>
      ) : null}
    </div>
  )
}

function transactionResult(tx: SendTransactionResponse): TransactionResult {
  const value = tx.txnHash ?? tx.txnId
  return {
    value,
    explorerUrl: tx.txnHash ? explorerUrlFor(tx.txnHash) : undefined,
  }
}

function formatLoginType(loginType: OMSClientSessionState['loginType']): string {
  switch (loginType) {
    case 'email':
      return 'Email'
    case 'google-auth':
      return 'Google'
    case 'oidc':
      return 'OIDC'
    default:
      return 'Unknown'
  }
}

function formatSessionExpiry(expiresAt: string | undefined): string {
  if (!expiresAt) return 'Unknown'

  const date = new Date(expiresAt)
  return Number.isNaN(date.getTime()) ? expiresAt : date.toLocaleString()
}

function formatWalletType(walletType: string): string {
  return walletType
    .split(/[-_]/)
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : part)
    .join(' ')
}

function isPendingWalletSelection(
  result: PendingWalletSelection | WalletActivationResult,
): result is PendingWalletSelection {
  return 'selectWallet' in result
}

function hasPostSendDataUpdate({
  initialBalances,
  initialEarnPositions,
  expectation,
  selectedFeeOption,
  refreshed,
}: {
  initialBalances: BalanceState
  initialEarnPositions: EarnPosition[]
  expectation: PostSendExpectation
  selectedFeeOption?: FeeOptionWithBalance | null
  refreshed: SignedInDataRefresh
}): boolean {
  if (expectation.type === 'usdcIncrease') {
    return hasUsdcIncrease({
      initialBalances,
      minIncreaseRaw: expectation.minIncreaseRaw,
      selectedFeeOption,
      refreshedBalances: refreshed.balances,
    })
  }

  if (expectation.type === 'earnMarketIncrease') {
    return hasEarnMarketIncrease({
      initialEarnPositions,
      marketId: expectation.marketId,
      refreshedPositions: refreshed.positions,
    })
  }

  return hasEarnMarketDecrease({
    initialEarnPositions,
    marketId: expectation.marketId,
    refreshedPositions: refreshed.positions,
  })
}

function hasUsdcIncrease({
  initialBalances,
  minIncreaseRaw,
  selectedFeeOption,
  refreshedBalances,
}: {
  initialBalances: BalanceState
  minIncreaseRaw: string
  selectedFeeOption?: FeeOptionWithBalance | null
  refreshedBalances: BalanceState | null
}): boolean {
  if (!refreshedBalances) return false

  try {
    const initialUsdc = BigInt(initialBalances.usdcRaw)
    const nextUsdc = BigInt(refreshedBalances.usdcRaw)
    const expectedIncrease = BigInt(minIncreaseRaw) - getSelectedUsdcFeeRaw(selectedFeeOption)
    return expectedIncrease > 0n ? nextUsdc >= initialUsdc + expectedIncrease : nextUsdc !== initialUsdc
  } catch {
    return false
  }
}

function canAffordFeeOption(option: FeeOptionWithBalance): boolean {
  if (option.availableRaw === undefined) return false

  try {
    return BigInt(option.availableRaw) >= BigInt(option.feeOption.value)
  } catch {
    return false
  }
}

function getSelectedUsdcFeeRaw(option?: FeeOptionWithBalance | null): bigint {
  if (option?.feeOption.token.symbol.toUpperCase() !== 'USDC') return 0n

  try {
    return BigInt(option.feeOption.value)
  } catch {
    return 0n
  }
}

function hasEarnMarketIncrease({
  initialEarnPositions,
  marketId,
  refreshedPositions,
}: {
  initialEarnPositions: EarnPosition[]
  marketId: string
  refreshedPositions: EarnPosition[] | null
}): boolean {
  if (!refreshedPositions) return false

  const previousPosition = findEarnPosition(initialEarnPositions, marketId)
  const nextPosition = findEarnPosition(refreshedPositions, marketId)
  if (!nextPosition) return false

  try {
    const previousAmount = previousPosition ? BigInt(previousPosition.amountRaw) : 0n
    return BigInt(nextPosition.amountRaw) > previousAmount
  } catch {
    return nextPosition.amount !== previousPosition?.amount
  }
}

function hasEarnMarketDecrease({
  initialEarnPositions,
  marketId,
  refreshedPositions,
}: {
  initialEarnPositions: EarnPosition[]
  marketId: string
  refreshedPositions: EarnPosition[] | null
}): boolean {
  if (!refreshedPositions) return false

  const previousPosition = findEarnPosition(initialEarnPositions, marketId)
  if (!previousPosition) return false

  const nextPosition = findEarnPosition(refreshedPositions, marketId)
  if (!nextPosition) return true

  try {
    return BigInt(nextPosition.amountRaw) < BigInt(previousPosition.amountRaw)
  } catch {
    return nextPosition.amount !== previousPosition.amount
  }
}

function findEarnPosition(positions: EarnPosition[], marketId: string): EarnPosition | undefined {
  return positions.find((position) => position.marketId === marketId || position.id === marketId)
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

function readManualWalletSelectionPreference(): boolean {
  return window.sessionStorage.getItem(MANUAL_WALLET_SELECTION_KEY) === 'true'
}

function readSessionLifetimePreference(): number {
  const stored = window.sessionStorage.getItem(SESSION_LIFETIME_SECONDS_KEY)
  if (!stored) return TEST_SESSION_LIFETIME_SECONDS

  const parsed = Number(stored)
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : TEST_SESSION_LIFETIME_SECONDS
}

export default App
