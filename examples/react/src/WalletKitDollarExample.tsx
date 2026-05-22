import { useEffect, useMemo, useState } from 'react'
import { Networks, OMSClient } from '@0xsequence/typescript-sdk'
import { createPublicClient, formatUnits, http, isAddress, parseUnits } from 'viem'
import type { Address } from 'viem'
import { PUBLIC_API_KEY, PROJECT_ID } from './config'
import { walletKitDollarAbi } from './walletKitDollarContract'

const AMOY_RPC_URL = 'https://rpc-amoy.polygon.technology'
const WKUSD_CONTRACT_ADDRESS = '0x4Ef29925C9C72b860447A6DA628cc78f785b27b5' as const satisfies Address
const BURN_ADDRESS = '0x000000000000000000000000000000000000dEaD' as const satisfies Address
const WALLET_KIT_DOLLAR = {
  name: 'WalletKit Dollar',
  symbol: 'WKUSD',
  decimals: 6,
} as const
const MINT_AMOUNT = 10n * 10n ** BigInt(WALLET_KIT_DOLLAR.decimals)

export function WalletKitDollarExample() {
  const [walletAddress, setWalletAddress] = useState('')
  const [balance, setBalance] = useState<bigint | null>(null)
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('1')
  const [sendToBurn, setSendToBurn] = useState(false)
  const [lastHash, setLastHash] = useState('')
  const [lastExplorerUrl, setLastExplorerUrl] = useState('')
  const [status, setStatus] = useState('')
  const [isBusy, setIsBusy] = useState(false)

  const oms = useMemo(() => new OMSClient({
    publicApiKey: PUBLIC_API_KEY,
    projectId: PROJECT_ID,
  }), [])
  const publicClient = useMemo(() => createPublicClient({
    transport: http(AMOY_RPC_URL),
  }), [])

  useEffect(() => {
    const restoredAddress = oms.wallet.walletAddress ?? ''
    setWalletAddress(restoredAddress)
    if (isAddress(restoredAddress)) {
      void refreshBalance(restoredAddress)
    }
  }, [oms])

  useEffect(() => {
    if (sendToBurn) {
      setTo(BURN_ADDRESS)
    }
  }, [sendToBurn])

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

  async function mint() {
    await run('Minting WKUSD...', async () => {
      const activeWallet = requireWalletAddress()
      clearLastTransaction()

      const tx = await oms.wallet.sendTransaction({
        network: Networks.amoy,
        to: WKUSD_CONTRACT_ADDRESS,
        abi: walletKitDollarAbi,
        functionName: 'mint',
        args: [activeWallet, MINT_AMOUNT],
        statusPolling: {
          timeoutMs: 120_000,
          intervalMs: 2_000,
        },
      })

      setLastHash(tx.txnHash ?? tx.txnId)
      setLastExplorerUrl(tx.txnHash ? transactionExplorerUrl(tx.txnHash) : '')
      await refreshBalance(activeWallet)
      setStatus(`Minted 10 ${WALLET_KIT_DOLLAR.name}.`)
    })
  }

  async function send() {
    await run('Sending WKUSD...', async () => {
      const activeWallet = requireWalletAddress()
      const recipient = to.trim()
      if (!isAddress(recipient)) {
        throw new Error('Enter a valid recipient address.')
      }

      const transferAmount = parseUnits(amount || '0', WALLET_KIT_DOLLAR.decimals)
      if (transferAmount <= 0n) {
        throw new Error('Send amount must be greater than zero.')
      }

      clearLastTransaction()

      const tx = await oms.wallet.sendTransaction({
        network: Networks.amoy,
        to: WKUSD_CONTRACT_ADDRESS,
        abi: walletKitDollarAbi,
        functionName: 'transfer',
        args: [recipient as Address, transferAmount],
        statusPolling: {
          timeoutMs: 120_000,
          intervalMs: 2_000,
        },
      })

      setLastHash(tx.txnHash ?? tx.txnId)
      setLastExplorerUrl(tx.txnHash ? transactionExplorerUrl(tx.txnHash) : '')
      await refreshBalance(activeWallet)
      setStatus(`Sent ${amount} ${WALLET_KIT_DOLLAR.symbol}.`)
    })
  }

  async function refreshBalance(address: Address) {
    const nextBalance = await publicClient.readContract({
      address: WKUSD_CONTRACT_ADDRESS,
      abi: walletKitDollarAbi,
      functionName: 'balanceOf',
      args: [address],
    })
    setBalance(nextBalance)
  }

  function requireWalletAddress(): Address {
    const activeWallet = oms.wallet.walletAddress ?? walletAddress
    if (!isAddress(activeWallet)) {
      throw new Error('Active wallet address is not a valid EVM address.')
    }
    return activeWallet
  }

  function clearLastTransaction() {
    setLastHash('')
    setLastExplorerUrl('')
  }

  return (
    <section className="example-block">
      <div className="tool-header">
        <h2>WalletKit Dollar</h2>
        <span className="metadata-pill">{WALLET_KIT_DOLLAR.symbol}</span>
      </div>
      <div className="balance-panel">
        <span>Your Balance</span>
        <strong>{formatTokenBalance(balance)}</strong>
      </div>
      <button type="button" onClick={mint} disabled={isBusy}>
        Mint 10 WalletKit Dollar
      </button>
      <div className="field-stack">
        <label>
          Send to
          <input
            value={to}
            onChange={(event) => {
              setTo(event.target.value)
              setSendToBurn(event.target.value === BURN_ADDRESS)
            }}
            disabled={sendToBurn}
          />
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={sendToBurn}
            onChange={(event) => setSendToBurn(event.target.checked)}
          />
          <span>Send to burn address</span>
        </label>
        <label>
          Amount
          <input
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
      </div>
      <button
        type="button"
        className={sendToBurn ? 'burn-button burn-button-active' : 'burn-button'}
        onClick={send}
        disabled={isBusy || !to.trim() || !amount.trim()}
      >
        <span className="button-label">Send WKUSD</span>
      </button>
      {lastHash && (
        <div className="result-block">
          <p className="result labeled-result">
            <span className="result-label">Transaction hash</span>
            <code className="result-value">{lastHash}</code>
          </p>
          {lastExplorerUrl && (
            <a
              href={lastExplorerUrl}
              target="_blank"
              rel="noreferrer"
            >
              View on explorer
            </a>
          )}
        </div>
      )}
      {status && <output>{status}</output>}
    </section>
  )
}

function transactionExplorerUrl(txnHash: string): string {
  return `${Networks.amoy.explorerUrl}/tx/${txnHash}`
}

function formatTokenBalance(value: bigint | null): string {
  if (value === null) return 'Loading...'
  return `${formatUnits(value, WALLET_KIT_DOLLAR.decimals)} ${WALLET_KIT_DOLLAR.symbol}`
}
