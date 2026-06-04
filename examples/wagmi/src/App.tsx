import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useAccount,
  useBalance,
  useChainId,
  useConnect,
  useConnectors,
  useDisconnect,
  useSendTransaction,
  useSignMessage,
  useSignTypedData,
  useSwitchChain,
  useWaitForTransactionReceipt,
} from 'wagmi'
import { TrailsWidget } from '0xtrails'
import { formatEther, isAddress, parseEther, type Address, type Hash } from 'viem'
import type { FeeOptionWithBalance, OMSClientSessionLoginType } from '@0xsequence/typescript-sdk'
import { TEST_SESSION_LIFETIME_SECONDS, oms } from './omsClient'
import { useFeeOptionSelection } from './useFeeOptionSelection'
import { TRAILS_API_KEY } from './config'
import { defaultChain, omsWalletChains, omsWalletNetworks, trailsAdapters } from './wagmiConfig'

type Connector = ReturnType<typeof useConnectors>[number]
type DemoStep = 'auth' | 'operations'
type AuthStep = 'email' | 'code'
type OmsWalletChainId = (typeof omsWalletChains)[number]['id']
const DEFAULT_MESSAGE = 'hello from wagmi'
const DEFAULT_TX_TO = '0x000000000000000000000000000000000000dEaD'
const DEFAULT_TX_VALUE = '0'
const DEFAULT_TYPED_DATA_AMOUNT = '0.001'
const DEFAULT_TYPED_DATA_MEMO = 'Approve OMS Wallet wagmi demo payment'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const OMS_WALLET_CONNECTOR_TYPE = 'omsWallet'
const TRAILS_WIDGET_CSS = `
  --trails-primary: #1d4ed8;
  --trails-primary-hover: #1e40af;
  --trails-border-radius-button: 6px;
  --trails-font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
`
const selectableNetworkOptions = omsWalletChains.flatMap((chain) => {
  const network = omsWalletNetworks.find((candidate) => candidate.id === chain.id)
  return network ? [{ chain, network }] : []
})

export function App() {
  const account = useAccount()
  const connectors = useConnectors()
  const chainId = useChainId()
  const connect = useConnect()
  const disconnect = useDisconnect()
  const switchChain = useSwitchChain()
  const signMessage = useSignMessage()
  const signTypedData = useSignTypedData()
  const sendTransaction = useSendTransaction()
  const oidcCallbackStarted = useRef(false)
  const [step, setStep] = useState<DemoStep>(account.status === 'connected' ? 'operations' : 'auth')
  const [authStep, setAuthStep] = useState<AuthStep>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [selectedChainId, setSelectedChainId] = useState<OmsWalletChainId>(defaultChain.id)
  const [message, setMessage] = useState(DEFAULT_MESSAGE)
  const [typedDataRecipient, setTypedDataRecipient] = useState(DEFAULT_TX_TO)
  const [typedDataAmount, setTypedDataAmount] = useState(DEFAULT_TYPED_DATA_AMOUNT)
  const [typedDataMemo, setTypedDataMemo] = useState(DEFAULT_TYPED_DATA_MEMO)
  const [transactionTo, setTransactionTo] = useState(DEFAULT_TX_TO)
  const [transactionValue, setTransactionValue] = useState(DEFAULT_TX_VALUE)
  const [authStatus, setAuthStatus] = useState('')
  const [walletStatus, setWalletStatus] = useState('')
  const [lastSignature, setLastSignature] = useState('')
  const [lastTypedSignature, setLastTypedSignature] = useState('')
  const [lastTransactionHash, setLastTransactionHash] = useState<Hash | undefined>()
  const [lastTransactionChainId, setLastTransactionChainId] = useState<OmsWalletChainId | undefined>()
  const feeOptionSelection = useFeeOptionSelection(() => {
    setWalletStatus('Choose a fee token to continue.')
  })
  const feeOptions = feeOptionSelection.feeOptions
  const omsSession = oms.wallet.session
  const activeOmsSessionAddress = omsSession.walletAddress
  const showGoogleAuth = !activeOmsSessionAddress || omsSession.loginType !== 'google-auth'
  const showEmailAuth = !activeOmsSessionAddress || omsSession.loginType !== 'email'
  const showEmailCodeInput = authStep === 'code' && !activeOmsSessionAddress

  const omsConnector = useMemo(
    () => connectors.find((connector) => connector.type === OMS_WALLET_CONNECTOR_TYPE),
    [connectors],
  )
  const externalWalletConnectors = useMemo(
    () => connectors.filter((connector) => connector.type !== OMS_WALLET_CONNECTOR_TYPE),
    [connectors],
  )
  const selectedChain = useMemo(
    () => omsWalletChains.find((chain) => chain.id === selectedChainId) ?? defaultChain,
    [selectedChainId],
  )
  const selectedNetwork = useMemo(
    () => networkForChainId(selectedChain.id),
    [selectedChain.id],
  )
  const receiptNetwork = useMemo(
    () => networkForChainId(lastTransactionChainId ?? selectedChain.id),
    [lastTransactionChainId, selectedChain.id],
  )
  const typedDataPreview = useMemo(() => ({
    domain: {
      name: 'OMS Wallet Wagmi Example',
      version: '1',
      chainId: selectedChain.id,
      verifyingContract: ZERO_ADDRESS,
    },
    primaryType: 'Payment',
    message: {
      from: account.address ?? 'connected wallet',
      to: typedDataRecipient,
      amount: `${typedDataAmount || '0'} ${selectedNetwork.nativeTokenSymbol}`,
      memo: typedDataMemo,
    },
  }), [account.address, selectedChain.id, selectedNetwork.nativeTokenSymbol, typedDataAmount, typedDataMemo, typedDataRecipient])
  const isConnected = account.status === 'connected'
  const isSelectedChain = chainId === selectedChain.id
  const activeConnectorName = account.connector?.name ?? 'None'
  const balance = useBalance({
    address: account.address,
    chainId: selectedChain.id,
    query: {
      enabled: Boolean(account.address),
    },
  })
  const receipt = useWaitForTransactionReceipt({
    hash: lastTransactionHash,
    chainId: lastTransactionChainId ?? selectedChain.id,
    query: {
      enabled: Boolean(lastTransactionHash),
    },
  })
  const isBusy = connect.isPending
    || disconnect.isPending
    || switchChain.isPending
    || signMessage.isPending
    || signTypedData.isPending
    || sendTransaction.isPending
  const operationDisabled = !isConnected || isBusy

  useEffect(() => {
    setStep(account.status === 'connected' ? 'operations' : 'auth')
  }, [account.status])

  useEffect(() => {
    if (selectableNetworkOptions.some((option) => option.network.id === chainId)) {
      setSelectedChainId(chainId as OmsWalletChainId)
    }
  }, [chainId])

  useEffect(() => {
    return oms.wallet.onSessionExpired(() => {
      setAuthStatus('OMS Wallet session expired.')
      setWalletStatus('Disconnected.')
      setAuthStep('email')
      setStep('auth')
    })
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (!params.has('code') && !params.has('state') && !params.has('error')) return
    if (!omsConnector || oidcCallbackStarted.current) return
    oidcCallbackStarted.current = true
    void completeGoogleRedirect()
  }, [omsConnector])

  async function startEmailAuth() {
    if (!email.trim()) return
    await runAuth('Sending code...', async () => {
      await oms.wallet.startEmailAuth({ email: email.trim() })
      setAuthStep('code')
      setAuthStatus('Code sent. Check your email.')
    })
  }

  async function completeEmailAuth() {
    if (!code.trim()) return
    await runAuth('Completing email sign-in...', async () => {
      await oms.wallet.completeEmailAuth({
        code: code.trim(),
        sessionLifetimeSeconds: TEST_SESSION_LIFETIME_SECONDS,
      })
      setAuthStep('email')
      await connectOmsWallet('Email connected.')
    })
  }

  async function connectActiveOmsSession() {
    await runAuth('Connecting OMS Wallet...', async () => {
      await connectOmsWallet('OMS Wallet connected.')
    })
  }

  async function startGoogleAuth() {
    await runAuth('Redirecting to Google...', async () => {
      await oms.wallet.signInWithOidcRedirect({
        provider: 'google',
        loginHint: email.trim() || oms.wallet.session.sessionEmail,
        sessionLifetimeSeconds: TEST_SESSION_LIFETIME_SECONDS,
      })
    })
  }

  async function completeGoogleRedirect() {
    await runAuth('Completing Google sign-in...', async () => {
      await oms.wallet.signInWithOidcRedirect({
        provider: 'google',
        sessionLifetimeSeconds: TEST_SESSION_LIFETIME_SECONDS,
      })
      await connectOmsWallet('Google connected.')
      window.history.replaceState({}, document.title, window.location.pathname)
    })
  }

  async function connectOmsWallet(status: string) {
    if (!omsConnector) {
      throw new Error('OMS Wallet connector is not configured.')
    }
    const walletAddress = oms.wallet.walletAddress
    if (!walletAddress) {
      throw new Error('OMS sign-in completed without an active wallet.')
    }
    await connect.mutateAsync({ connector: omsConnector, chainId: selectedChain.id })
    setAuthStatus(status)
    setWalletStatus(status)
    setStep('operations')
  }

  async function runAuth(label: string, action: () => Promise<void>) {
    setAuthStatus(label)
    try {
      await action()
    } catch (error) {
      setAuthStatus(describeError(error))
    }
  }

  async function connectWallet(connector: Connector) {
    setWalletStatus(`Connecting ${connector.name}...`)
    setAuthStatus(`Connecting ${connector.name}...`)
    try {
      await connect.mutateAsync({ connector, chainId: selectedChain.id })
      setWalletStatus(`${connector.name} connected.`)
      setAuthStatus(`${connector.name} connected.`)
      setStep('operations')
    } catch (error) {
      const message = describeError(error)
      setWalletStatus(message)
      setAuthStatus(message)
    }
  }

  async function disconnectWallet() {
    setWalletStatus('Disconnecting...')
    try {
      await disconnect.mutateAsync()
      setLastSignature('')
      setLastTypedSignature('')
      setLastTransactionHash(undefined)
      setLastTransactionChainId(undefined)
      feeOptionSelection.clearFeeOptions()
      setWalletStatus('Disconnected.')
      setAuthStatus('')
      setAuthStep('email')
      setStep('auth')
    } catch (error) {
      setWalletStatus(describeError(error))
    }
  }

  async function selectNetwork(nextChainId: OmsWalletChainId) {
    if (nextChainId === selectedChain.id) return
    const nextNetwork = networkForChainId(nextChainId)
    setLastTransactionHash(undefined)
    setLastTransactionChainId(undefined)

    if (!isConnected) {
      setSelectedChainId(nextChainId)
      return
    }

    setWalletStatus(`Switching to ${nextNetwork.displayName}...`)
    try {
      await switchChain.mutateAsync({ chainId: nextChainId })
      setSelectedChainId(nextChainId)
      setWalletStatus(`Network switched to ${nextNetwork.displayName}.`)
    } catch (error) {
      setWalletStatus(describeError(error))
    }
  }

  async function ensureSelectedChain() {
    if (!isConnected) {
      throw new Error('Connect a wallet first.')
    }
    if (!isSelectedChain) {
      await switchChain.mutateAsync({ chainId: selectedChain.id })
    }
  }

  async function signCurrentMessage() {
    setWalletStatus('Signing message...')
    try {
      await ensureSelectedChain()
      const signature = await signMessage.mutateAsync({ message })
      setLastSignature(signature)
      setWalletStatus('Message signed.')
    } catch (error) {
      setWalletStatus(describeError(error))
    }
  }

  async function signCurrentTypedData() {
    setWalletStatus('Signing typed data...')
    try {
      await ensureSelectedChain()
      if (!account.address) {
        throw new Error('Connect a wallet first.')
      }
      if (!isAddress(typedDataRecipient)) {
        throw new Error('Enter a valid typed-data recipient address.')
      }
      const amount = parseEther(typedDataAmount || '0')
      const signature = await signTypedData.mutateAsync({
        domain: {
          name: 'OMS Wallet Wagmi Example',
          version: '1',
          chainId: selectedChain.id,
          verifyingContract: ZERO_ADDRESS,
        },
        types: {
          Payment: [
            { name: 'from', type: 'address' },
            { name: 'to', type: 'address' },
            { name: 'amount', type: 'uint256' },
            { name: 'memo', type: 'string' },
          ],
        },
        primaryType: 'Payment',
        message: {
          from: account.address,
          to: typedDataRecipient as Address,
          amount,
          memo: typedDataMemo,
        },
      })
      setLastTypedSignature(signature)
      setWalletStatus('Typed data signed.')
    } catch (error) {
      setWalletStatus(describeError(error))
    }
  }

  async function sendNativeTransaction() {
    setWalletStatus('Sending transaction...')
    feeOptionSelection.clearFeeOptions()
    try {
      await ensureSelectedChain()
      if (!isAddress(transactionTo)) {
        throw new Error('Enter a valid recipient address.')
      }
      const value = parseEther(transactionValue || '0')
      const hash = await sendTransaction.mutateAsync({
        chainId: selectedChain.id,
        to: transactionTo as Address,
        value,
      })
      setLastTransactionHash(hash)
      setLastTransactionChainId(selectedChain.id)
      setWalletStatus('Transaction submitted.')
    } catch (error) {
      setWalletStatus(describeError(error))
    } finally {
      feeOptionSelection.clearFeeOptions()
    }
  }

  function chooseFeeOption(option: FeeOptionWithBalance) {
    if (!canAffordFeeOption(option)) {
      setWalletStatus(`Insufficient ${option.feeOption.token.symbol} balance for fee.`)
      return
    }

    feeOptionSelection.resolveFeeOption({ token: option.feeOption.token.symbol })
    setWalletStatus(`Selected ${option.feeOption.token.symbol}. Sending transaction...`)
  }

  function cancelFeeSelection() {
    feeOptionSelection.rejectFeeOption(new Error('Fee option selection cancelled.'))
    setWalletStatus('Transaction cancelled.')
  }

  return (
    <main className="shell">
      <section className="panel">
        <header>
          <p className="eyebrow">OMS Client Typescript SDK</p>
          <h1>Wagmi Connector Example</h1>
        </header>

        {step === 'auth' ? (
          <section className="section">
            <div className="tool-header">
              <h2>Connect</h2>
            </div>
            <div className="auth-stack">
              {activeOmsSessionAddress && (
                <button type="button" className="secondary auth-method-button session-auth-button" onClick={() => void connectActiveOmsSession()} disabled={isBusy}>
                  <span>{formatSessionLoginType(omsSession.loginType)}</span>
                  <small>{formatSessionContinuation(activeOmsSessionAddress, omsSession.sessionEmail)}</small>
                </button>
              )}
              {activeOmsSessionAddress && (showGoogleAuth || showEmailAuth) && (
                <div className="divider">
                  <span>or</span>
                </div>
              )}
              {showGoogleAuth && (
                <button type="button" className="secondary auth-method-button" onClick={startGoogleAuth} disabled={isBusy}>
                  Continue with Google
                </button>
              )}
              {showGoogleAuth && showEmailAuth && (
                <div className="divider">
                  <span>or</span>
                </div>
              )}
              {showEmailAuth && (showEmailCodeInput ? (
                <form className="stack" onSubmit={(event) => {
                  event.preventDefault()
                  void completeEmailAuth()
                }}>
                  <div className="field-stack">
                    <label>
                      Code
                      <input
                        autoFocus
                        name="code"
                        type="text"
                        value={code}
                        onChange={(event) => setCode(event.target.value)}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="123456"
                        autoComplete="one-time-code"
                        disabled={isBusy}
                      />
                    </label>
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
              ) : (
                <form className="stack" onSubmit={(event) => {
                  event.preventDefault()
                  void startEmailAuth()
                }}>
                  <div className="field-stack">
                    <label>
                      Email
                      <input
                        name="email"
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="user@example.com"
                        autoComplete="email"
                        autoCapitalize="none"
                        disabled={isBusy}
                        spellCheck={false}
                      />
                    </label>
                  </div>
                  <button type="submit" disabled={isBusy || !email.trim()}>
                    Send code
                  </button>
                </form>
              ))}
              {externalWalletConnectors.map((connector) => (
                <div className="auth-connector" key={connector.uid}>
                  <div className="divider">
                    <span>or</span>
                  </div>
                  <button type="button" className="secondary auth-method-button" onClick={() => void connectWallet(connector)} disabled={isBusy}>
                    Continue with {connector.name}
                  </button>
                </div>
              ))}
            </div>
            {authStatus && <p id="auth-status" className="field-hint" role="status">{authStatus}</p>}
          </section>
        ) : (
          <>
            <section className="section">
              <div className="tool-header">
                <h2>Account</h2>
              </div>
              <div className="summary-grid">
                <div>
                  <span>Connector</span>
                  <strong>{activeConnectorName}</strong>
                </div>
                <div>
                  <span>Account</span>
                  <strong>{account.address ? shortAddress(account.address) : 'None'}</strong>
                </div>
                <div>
                  <span>Balance</span>
                  <strong>{balance.data ? `${formatEther(balance.data.value)} ${balance.data.symbol}` : '-'}</strong>
                </div>
              </div>
              <div className="button-row">
                <button type="button" className="secondary" onClick={disconnectWallet} disabled={!isConnected || isBusy}>
                  Disconnect
                </button>
              </div>
              <div className="network-tool">
                <div className="tool-header">
                  <h2>Network</h2>
                  <span className="network-meta">{selectedNetwork.nativeTokenSymbol}</span>
                </div>
                <select
                  aria-label="Network"
                  value={selectedChainId}
                  onChange={(event) => void selectNetwork(Number(event.target.value) as OmsWalletChainId)}
                  disabled={isBusy}
                >
                  {selectableNetworkOptions.map(({ chain, network }) => (
                    <option key={chain.id} value={chain.id}>
                      {network.displayName} ({chain.id})
                    </option>
                  ))}
                </select>
              </div>
            </section>

            <section className="section">
              <div className="tool-header">
                <h2>Operations</h2>
              </div>
              <div className="operation-example trails-widget-launcher">
                {TRAILS_API_KEY ? (
                  <TrailsWidget
                    apiKey={TRAILS_API_KEY}
                    adapters={trailsAdapters}
                    customCss={TRAILS_WIDGET_CSS}
                    isSmartWallet
                    mode="swap"
                  >
                    <button
                      type="button"
                      className="trails-modal-button w-80 max-w-full px-4 py-3 text-base font-semibold text-center cursor-pointer"
                    >
                      Open Trails Widget
                    </button>
                  </TrailsWidget>
                ) : (
                  <button type="button" className="trails-widget-button" disabled>
                    Add Trails API key
                  </button>
                )}
              </div>
              <div className="field-stack operation-example">
                <label>
                  Message
                  <input value={message} onChange={(event) => setMessage(event.target.value)} />
                </label>
                <button type="button" onClick={signCurrentMessage} disabled={operationDisabled || !message.trim()}>
                  Sign Message
                </button>
                {lastSignature && (
                  <p className="result">
                    <span>Signature</span>
                    <code>{lastSignature}</code>
                  </p>
                )}
              </div>

              <div className="field-stack operation-example">
                <label>
                  Typed Recipient
                  <input value={typedDataRecipient} onChange={(event) => setTypedDataRecipient(event.target.value)} />
                </label>
                <label>
                  Typed Amount
                  <input
                    inputMode="decimal"
                    value={typedDataAmount}
                    onChange={(event) => setTypedDataAmount(event.target.value)}
                  />
                </label>
                <label>
                  Typed Memo
                  <input value={typedDataMemo} onChange={(event) => setTypedDataMemo(event.target.value)} />
                </label>
                <div className="typed-data-preview">
                  <span>Typed data preview</span>
                  <code>{JSON.stringify(typedDataPreview, null, 2)}</code>
                </div>
                <button type="button" onClick={signCurrentTypedData} disabled={operationDisabled || !typedDataRecipient.trim() || !typedDataMemo.trim()}>
                  Sign Typed Data
                </button>
                {lastTypedSignature && (
                  <p className="result">
                    <span>Typed signature</span>
                    <code>{lastTypedSignature}</code>
                  </p>
                )}
              </div>

              <div className="field-stack operation-example">
                <label>
                  Recipient
                  <input value={transactionTo} onChange={(event) => setTransactionTo(event.target.value)} />
                </label>
                <label>
                  Amount
                  <input
                    inputMode="decimal"
                    value={transactionValue}
                    onChange={(event) => setTransactionValue(event.target.value)}
                  />
                </label>
                <button type="button" onClick={sendNativeTransaction} disabled={operationDisabled || !transactionTo.trim()}>
                  Send Transaction
                </button>
                {lastTransactionHash && (
                  <p className="result">
                    <span>Transaction hash</span>
                    <a href={`${receiptNetwork.explorerUrl.replace(/\/+$/, '')}/tx/${lastTransactionHash}`} target="_blank" rel="noreferrer">
                      {shortHash(lastTransactionHash)}
                    </a>
                  </p>
                )}
                {lastTransactionHash && (
                  <output>Receipt status: {receipt.status}</output>
                )}
              </div>
            </section>

            {walletStatus && <output>{walletStatus}</output>}
          </>
        )}
      </section>

      {feeOptions.length > 0 && (
        <FeeOptionsPanel
          feeOptions={feeOptions}
          onCancel={cancelFeeSelection}
          onChoose={chooseFeeOption}
        />
      )}
    </main>
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
      <section className="fee-options" role="dialog" aria-modal="true" aria-labelledby="fee-options-title">
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

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`
}

function formatSessionContinuation(address: string, email: string | undefined): string {
  const label = `Continue as ${shortAddress(address)}`
  return email ? `${label} - ${email}` : label
}

function formatSessionLoginType(loginType: OMSClientSessionLoginType | undefined): string {
  switch (loginType) {
    case 'email':
      return 'Email'
    case 'google-auth':
      return 'Google'
    case 'oidc':
      return 'OIDC'
    default:
      return 'OMS Wallet'
  }
}

function networkForChainId(chainId: number) {
  const network = omsWalletNetworks.find((candidate) => candidate.id === chainId)
  if (network) return network

  const defaultNetwork = omsWalletNetworks.find((candidate) => candidate.id === defaultChain.id)
  if (!defaultNetwork) {
    throw new Error(`OMS network ${defaultChain.id} is not configured.`)
  }
  return defaultNetwork
}

function canAffordFeeOption(option: FeeOptionWithBalance): boolean {
  if (option.availableRaw === undefined) return false

  try {
    return BigInt(option.availableRaw) >= BigInt(option.feeOption.value)
  } catch {
    return false
  }
}
