import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Networks,
  OMSClient,
  supportedNetworks,
  type FeeOptionSelection,
  type FeeOptionWithBalance,
  type Network,
  type OMSClientSessionLoginType,
} from '@0xsequence/typescript-sdk'
import './styles.css'

type Step = 'email' | 'code' | 'wallet'
type FeeSelectionController = {
  resolve: (selection: FeeOptionSelection) => void
  reject: (error: Error) => void
}

const DEFAULT_MESSAGE = 'test'
const DEFAULT_TX_TO = '0xE5E8B483FfC05967FcFed58cc98D053265af6D99'
const PUBLIC_API_KEY = requiredEnv('VITE_OMS_PUBLIC_API_KEY', import.meta.env.VITE_OMS_PUBLIC_API_KEY)
const PROJECT_ID = requiredEnv('VITE_OMS_PROJECT_ID', import.meta.env.VITE_OMS_PROJECT_ID)

function requiredEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing ${name}. Copy examples/react/.env.example to examples/react/.env.local and set it.`)
  }
  return value
}

function App() {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [message, setMessage] = useState(DEFAULT_MESSAGE)
  const [selectedNetworkId, setSelectedNetworkId] = useState<number>(Networks.amoy.id)
  const [transactionTo, setTransactionTo] = useState(DEFAULT_TX_TO)
  const [transactionValue, setTransactionValue] = useState('0')
  const [walletAddress, setWalletAddress] = useState('')
  const [lastSignature, setLastSignature] = useState('')
  const [lastTransactionHash, setLastTransactionHash] = useState('')
  const [lastTransactionExplorerUrl, setLastTransactionExplorerUrl] = useState('')
  const [feeOptions, setFeeOptions] = useState<FeeOptionWithBalance[]>([])
  const [emailAuthStatus, setEmailAuthStatus] = useState('Enter an email to start.')
  const [redirectStatus, setRedirectStatus] = useState('')
  const [walletStatus, setWalletStatus] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const oidcCallbackStarted = useRef(false)
  const feeSelection = useRef<FeeSelectionController | null>(null)

  const oms = useMemo(() => {
    return new OMSClient({
      publicApiKey: PUBLIC_API_KEY,
      projectId: PROJECT_ID,
    })
  }, [])
  const selectedNetwork = supportedNetworks.find(network => network.id === selectedNetworkId) ?? Networks.amoy
  const session = oms.wallet.session

  useEffect(() => {
    if (oms.wallet.walletAddress) {
      setWalletAddress(oms.wallet.walletAddress)
      setStep('wallet')
      setWalletStatus('Wallet session restored.')
      return
    }

    const params = new URLSearchParams(window.location.search)
    if (params.has('code') || params.has('state') || params.has('error')) {
      if (oidcCallbackStarted.current) return
      oidcCallbackStarted.current = true
      void completeOidcRedirect()
    }
  }, [oms])

  useEffect(() => {
    feeSelection.current?.reject(new Error('Network changed'))
    feeSelection.current = null
    setFeeOptions([])
    setLastSignature('')
    setLastTransactionHash('')
    setLastTransactionExplorerUrl('')
    if (step === 'wallet') {
      setWalletStatus('')
    }
  }, [selectedNetworkId, step])

  async function run(
    label: string,
    setActiveStatus: (message: string) => void,
    action: () => Promise<void>,
  ) {
    setIsBusy(true)
    setActiveStatus(label)
    try {
      await action()
    } catch (error) {
      setActiveStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setIsBusy(false)
    }
  }

  async function startEmailAuth() {
    if (!email.trim()) return
    await run('Sending code...', setEmailAuthStatus, async () => {
      await oms.wallet.startEmailAuth({ email: email.trim() })
      setStep('code')
      setEmailAuthStatus('Code sent. Check your email.')
    })
  }

  async function completeEmailAuth() {
    if (!code.trim()) return
    await run('Completing sign-in...', setEmailAuthStatus, async () => {
      const result = await oms.wallet.completeEmailAuth({ code: code.trim() })
      setWalletAddress(result.walletAddress)
      setStep('wallet')
      setWalletStatus('Wallet ready.')
    })
  }

  async function startOidcRedirect() {
    await run('Redirecting to provider...', setRedirectStatus, async () => {
      await oms.wallet.signInWithOidcRedirect({ provider: 'google' })
    })
  }

  async function completeOidcRedirect() {
    await run('Completing redirect sign-in...', setRedirectStatus, async () => {
      const result = await oms.wallet.signInWithOidcRedirect({ provider: 'google' })
      setWalletAddress(result?.walletAddress ?? oms.wallet.walletAddress ?? '')
      setStep('wallet')
      setWalletStatus('Wallet ready.')
    })
  }

  async function signMessage() {
    await run('Signing message...', setWalletStatus, async () => {
      const signature = await oms.wallet.signMessage({
        network: selectedNetwork,
        message,
      })
      setLastSignature(signature)
      setWalletStatus('Message signed.')
    })
  }

  async function sendTransaction() {
    await run('Sending transaction...', setWalletStatus, async () => {
      setFeeOptions([])
      setLastTransactionExplorerUrl('')
      try {
        const tx = await oms.wallet.sendTransaction({
          network: selectedNetwork,
          to: transactionTo as `0x${string}`,
          value: BigInt(transactionValue || '0'),
          selectFeeOption: waitForFeeOptionSelection,
        })
        setLastTransactionHash(tx.txnHash ?? tx.txnId)
        setLastTransactionExplorerUrl(tx.txnHash ? transactionExplorerUrl(selectedNetwork, tx.txnHash) : '')
        setWalletStatus('Transaction sent.')
      } finally {
        feeSelection.current = null
        setFeeOptions([])
      }
    })
  }

  function waitForFeeOptionSelection(options: FeeOptionWithBalance[]): Promise<FeeOptionSelection> {
    setFeeOptions(options)
    setWalletStatus('Choose a fee token to continue.')
    return new Promise((resolve, reject) => {
      feeSelection.current = { resolve, reject }
    })
  }

  function chooseFeeOption(option: FeeOptionWithBalance) {
    feeSelection.current?.resolve({ token: option.feeOption.token.symbol })
    feeSelection.current = null
    setFeeOptions([])
    setWalletStatus(`Selected ${option.feeOption.token.symbol}. Sending transaction...`)
  }

  function cancelFeeSelection() {
    feeSelection.current?.reject(new Error('Fee option selection cancelled'))
    feeSelection.current = null
    setFeeOptions([])
  }

  async function signOut() {
    await run('Signing out...', setWalletStatus, async () => {
      await oms.wallet.signOut()
      setCode('')
      setWalletAddress('')
      setLastSignature('')
      setLastTransactionHash('')
      setLastTransactionExplorerUrl('')
      setFeeOptions([])
      setStep('email')
      setEmailAuthStatus('Enter an email to start.')
      setRedirectStatus('')
      setWalletStatus('')
    })
  }

  return (
    <main className="shell">
      <section className="panel">
        <header>
          <p className="eyebrow">OMS Client Typescript SDK</p>
          <h1>Wallet Demo</h1>
        </header>

        {step === 'email' && (
          <form className="stack" onSubmit={(event) => {
            event.preventDefault()
            void startEmailAuth()
          }}>
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
                />
              </label>
              <p id="email-status" className="field-hint">{emailAuthStatus}</p>
            </div>
            <button type="submit" disabled={isBusy || !email.trim()}>
              Send code
            </button>
          </form>
        )}

        {step === 'code' && (
          <form className="stack" onSubmit={(event) => {
            event.preventDefault()
            void completeEmailAuth()
          }}>
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
                />
              </label>
              <p id="code-status" className="field-hint">{emailAuthStatus}</p>
            </div>
            <div className="actions">
              <button type="submit" disabled={isBusy || !code.trim()}>
                Complete sign-in
              </button>
              <button type="button" className="secondary" onClick={() => setStep('email')} disabled={isBusy}>
                Back
              </button>
            </div>
          </form>
        )}

        {step === 'wallet' && (
          <div className="stack">
            <div className="wallet">
              <span>Wallet</span>
              <code>{walletAddress}</code>
            </div>

            <div className="session-info">
              <div>
                <span>Login</span>
                <strong>{formatLoginType(session.loginType)}</strong>
              </div>
              <div>
                <span>Email</span>
                <strong>{session.sessionEmail ?? 'Unknown'}</strong>
              </div>
              <div>
                <span>Expires</span>
                <strong>{formatSessionExpiry(session.expiresAt)}</strong>
              </div>
            </div>

            <section className="tool network-tool">
              <div className="tool-header">
                <h2>Network</h2>
                <span className="network-meta">{selectedNetwork.nativeTokenSymbol}</span>
              </div>
              <select
                aria-label="Network"
                value={selectedNetworkId}
                onChange={(event) => setSelectedNetworkId(Number(event.target.value))}
                disabled={isBusy}
              >
                {supportedNetworks.map(network => (
                  <option key={network.id} value={network.id}>
                    {networkLabel(network)}
                  </option>
                ))}
              </select>
            </section>

            <section className="tool">
              <h2>Sign message</h2>
              <label>
                Message
                <input
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                />
              </label>
              <button type="button" onClick={signMessage} disabled={isBusy || !message.trim()}>
                Sign message
              </button>
              {lastSignature && <code className="result">{lastSignature}</code>}
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
              <button type="button" onClick={sendTransaction} disabled={isBusy || !transactionTo.trim()}>
                Send transaction
              </button>
              {feeOptions.length > 0 && (
                <div className="fee-options" aria-live="polite">
                  <h3>Fee option</h3>
                  <div className="fee-option-list">
                    {feeOptions.map(option => (
                      <button
                        key={`${option.feeOption.token.symbol}-${option.feeOption.value}`}
                        type="button"
                        className="fee-option"
                        onClick={() => chooseFeeOption(option)}
                      >
                        <span>
                          <strong>{option.feeOption.token.symbol}</strong>
                          <small>{option.feeOption.displayValue || option.feeOption.value}</small>
                        </span>
                        <span>{option.available ?? 'Balance unavailable'}</span>
                      </button>
                    ))}
                  </div>
                  <button type="button" className="secondary" onClick={cancelFeeSelection}>
                    Cancel transaction
                  </button>
                </div>
              )}
              {lastTransactionHash && (
                <div className="result-block">
                  <code className="result">{lastTransactionHash}</code>
                  {lastTransactionExplorerUrl && (
                    <a
                      href={lastTransactionExplorerUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View on explorer
                    </a>
                  )}
                </div>
              )}
            </section>

            <button type="button" className="secondary" onClick={signOut} disabled={isBusy}>
              Sign out
            </button>
          </div>
        )}

        {step === 'wallet' && walletStatus && <output>{walletStatus}</output>}
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

function transactionExplorerUrl(network: Network, txnHash: string): string {
  return `${network.explorerUrl.replace(/\/+$/, '')}/tx/${txnHash}`
}

function networkLabel(network: Network): string {
  const label = network.name
    .split('-')
    .map(part => part.toUpperCase() === 'BSC' ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1))
    .join(' ')
  return `${label} (${network.id})`
}

function formatLoginType(loginType: OMSClientSessionLoginType | undefined): string {
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
