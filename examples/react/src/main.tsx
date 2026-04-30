import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  defaultOmsEnvironment,
  defineOmsEnvironment,
  googleOidcProvider,
  OMSClient,
} from 'typescript-sdk'
import './styles.css'

type Step = 'email' | 'code' | 'wallet'

const NETWORK = 'amoy'
const EXPLORER_TX_URL = 'https://amoy.polygonscan.com/tx/'
const DEFAULT_MESSAGE = 'test'
const DEFAULT_TX_TO = '0xE5E8B483FfC05967FcFed58cc98D053265af6D99'

function App() {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [message, setMessage] = useState(DEFAULT_MESSAGE)
  const [transactionTo, setTransactionTo] = useState(DEFAULT_TX_TO)
  const [transactionValue, setTransactionValue] = useState('0')
  const [walletAddress, setWalletAddress] = useState('')
  const [lastSignature, setLastSignature] = useState('')
  const [lastTransactionHash, setLastTransactionHash] = useState('')
  const [status, setStatus] = useState('Enter an email to start.')
  const [isBusy, setIsBusy] = useState(false)
  const oidcCallbackStarted = useRef(false)

  const googleConfigured = Boolean(__OMS_GOOGLE_CLIENT_ID__)
  const oms = useMemo(() => {
    const environment = defineOmsEnvironment({
      ...defaultOmsEnvironment,
      auth: {
        ...defaultOmsEnvironment.auth,
        oidcProviders: {
          google: googleOidcProvider({
            clientId: __OMS_GOOGLE_CLIENT_ID__ || 'missing-google-client-id',
            relayRedirectUri: __OMS_OIDC_RELAY_REDIRECT_URI__ || undefined,
          }),
        },
      },
    })

    return new OMSClient({
      projectAccessKey: __OMS_PROJECT_ACCESS_KEY__,
      environment,
    })
  }, [])

  useEffect(() => {
    if (oms.wallet.walletAddress) {
      setWalletAddress(oms.wallet.walletAddress)
      setStep('wallet')
      setStatus('Wallet session restored.')
      return
    }

    const params = new URLSearchParams(window.location.search)
    if (params.has('code') || params.has('state') || params.has('error')) {
      if (oidcCallbackStarted.current) return
      oidcCallbackStarted.current = true
      void completeOidcRedirect()
    }
  }, [oms])

  async function run(label: string, action: () => Promise<void>) {
    setIsBusy(true)
    setStatus(label)
    try {
      await action()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setIsBusy(false)
    }
  }

  async function startEmailAuth() {
    if (!email.trim()) return
    await run('Sending code...', async () => {
      await oms.wallet.startEmailAuth({ email: email.trim() })
      setStep('code')
      setStatus('Code sent. Check your email.')
    })
  }

  async function completeEmailAuth() {
    if (!code.trim()) return
    await run('Completing sign-in...', async () => {
      await oms.wallet.completeEmailAuth({ code: code.trim() })
      setWalletAddress(oms.wallet.walletAddress ?? '')
      setStep('wallet')
      setStatus('Wallet ready.')
    })
  }

  async function startOidcRedirect() {
    if (!googleConfigured) {
      setStatus('Set OMS_GOOGLE_CLIENT_ID to enable Google redirect sign-in.')
      return
    }

    await run('Redirecting to provider...', async () => {
      await oms.wallet.signInWithOidcRedirect({ provider: 'google' })
    })
  }

  async function completeOidcRedirect() {
    await run('Completing redirect sign-in...', async () => {
      await oms.wallet.signInWithOidcRedirect({ provider: 'google' })
      setWalletAddress(oms.wallet.walletAddress ?? '')
      setStep('wallet')
      setStatus('Wallet ready.')
    })
  }

  async function signMessage() {
    await run('Signing message...', async () => {
      const signature = await oms.wallet.signMessage({
        network: NETWORK,
        message,
      })
      setLastSignature(signature)
      setStatus('Message signed.')
    })
  }

  async function sendTransaction() {
    await run('Sending transaction...', async () => {
      const tx = await oms.wallet.sendTransaction({
        network: NETWORK,
        to: transactionTo as `0x${string}`,
        value: BigInt(transactionValue || '0'),
      })
      setLastTransactionHash(tx.txHash ?? tx.txnId)
      setStatus('Transaction sent.')
    })
  }

  async function signOut() {
    await run('Signing out...', async () => {
      await oms.wallet.signOut()
      setCode('')
      setWalletAddress('')
      setLastSignature('')
      setLastTransactionHash('')
      setStep('email')
      setStatus('Signed out.')
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
            <label>
              Email
              <input
                autoFocus
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="user@example.com"
              />
            </label>
            <button type="submit" disabled={isBusy || !email.trim()}>
              Send code
            </button>
            <div className="divider">or</div>
            <button type="button" className="secondary" onClick={startOidcRedirect} disabled={isBusy || !googleConfigured}>
              Continue with Google
            </button>
          </form>
        )}

        {step === 'code' && (
          <form className="stack" onSubmit={(event) => {
            event.preventDefault()
            void completeEmailAuth()
          }}>
            <label>
              Code
              <input
                autoFocus
                inputMode="numeric"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="123456"
              />
            </label>
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
              {lastTransactionHash && (
                <div className="result-block">
                  <code className="result">{lastTransactionHash}</code>
                  <a
                    href={`${EXPLORER_TX_URL}${lastTransactionHash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on explorer
                  </a>
                </div>
              )}
            </section>

            <button type="button" className="secondary" onClick={signOut} disabled={isBusy}>
              Sign out
            </button>
          </div>
        )}

        <output>{status}</output>
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
