import { useEffect, useRef, useState } from 'react';
import {
  SolanaNetworks,
  type FeeOptionSelection,
  type FeeOptionWithBalance
} from '@polygonlabs/oms-wallet';
import { FeeOptionsPanel } from '../../shared/example-components';
import { omsWallet } from './omsWallet';

const SOLANA_DEVNET_EXPLORER_URL = 'https://explorer.solana.com';
const LAMPORTS_PER_SOL_DECIMALS = 9;
const DEVNET_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const USDC_DECIMALS = 6;

type AssetType = 'SOL' | 'SPL';
type SplTokenType = 'USDC' | 'CUSTOM';
type FeeSelectionController = {
  resolve: (selection: FeeOptionSelection) => void;
  reject: (error: Error) => void;
};

export function SolanaExample({ walletAddress }: { walletAddress: string }) {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null);
  const [balanceStatus, setBalanceStatus] = useState('');
  const [isBalanceLoading, setIsBalanceLoading] = useState(false);
  const [message, setMessage] = useState('Sign in to OMS Wallet');
  const [messageSignature, setMessageSignature] = useState('');
  const [signStatus, setSignStatus] = useState('');
  const [assetType, setAssetType] = useState<AssetType>('SOL');
  const [splTokenType, setSplTokenType] = useState<SplTokenType>('USDC');
  const [mint, setMint] = useState('');
  const [tokenDecimals, setTokenDecimals] = useState('6');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('0.001');
  const [transactionSignature, setTransactionSignature] = useState('');
  const [transferStatus, setTransferStatus] = useState('');
  const [feeOptions, setFeeOptions] = useState<FeeOptionWithBalance[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const feeSelection = useRef<FeeSelectionController | null>(null);

  useEffect(() => {
    void refreshBalance();
    return () => {
      feeSelection.current?.reject(new Error('Solana operation closed'));
      feeSelection.current = null;
    };
  }, [walletAddress]);

  async function refreshBalance() {
    setIsBalanceLoading(true);
    setBalanceStatus('');

    try {
      const snapshot = await getDevnetBalances(walletAddress);
      if (snapshot.error) {
        setBalanceStatus(snapshot.error);
      } else {
        setBalance(snapshot.sol);
        setUsdcBalance(snapshot.usdc);
      }
    } catch (error) {
      setBalanceStatus(errorMessage(error));
    } finally {
      setIsBalanceLoading(false);
    }
  }

  async function signMessage() {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) return;
    setIsBusy(true);
    setSignStatus('Signing message...');
    setMessageSignature('');
    try {
      const signature = await omsWallet.wallet.signSolanaMessage({ message: trimmedMessage });
      setMessageSignature(signature);
      setSignStatus('Verifying signature...');
      const isValid = await omsWallet.wallet.isValidSolanaMessageSignature({
        walletAddress,
        message: trimmedMessage,
        signature
      });
      setSignStatus(isValid ? 'Message signed and verified.' : 'Signature verification failed.');
    } catch (error) {
      setSignStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function sendTransfer() {
    const destination = recipient.trim();
    if (!destination) return;

    setIsBusy(true);
    setTransferStatus('Preparing relayed transfer...');
    setTransactionSignature('');
    try {
      const asset =
        assetType === 'SOL' ? 'SOL' : splTokenType === 'USDC' ? DEVNET_USDC_MINT : mint.trim();
      if (!asset) {
        throw new Error('Enter an SPL token mint address.');
      }

      const amountInBaseUnits =
        assetType === 'SOL'
          ? parseDecimalBaseUnits(amount, LAMPORTS_PER_SOL_DECIMALS, 'SOL amount')
          : parseDecimalBaseUnits(
              amount,
              splTokenType === 'USDC' ? USDC_DECIMALS : parseTokenDecimals(tokenDecimals),
              splTokenType === 'USDC' ? 'USDC amount' : 'Token amount'
            );
      const transaction = await omsWallet.wallet.sendSolanaTransfer({
        network: SolanaNetworks.devnet,
        asset,
        to: destination,
        amount: amountInBaseUnits,
        selectFeeOption: waitForFeeOptionSelection,
        statusPolling: { timeoutMs: 120_000 }
      });

      setTransactionSignature(transaction.txnHash ?? transaction.txnId);
      setTransferStatus(
        transaction.statusResolution === 'timed-out'
          ? 'Transaction submitted. Confirmation is still pending.'
          : `Transfer ${transaction.status}.`
      );
      await refreshBalance();
    } catch (error) {
      setTransferStatus(error instanceof Error ? error.message : String(error));
    } finally {
      feeSelection.current = null;
      setFeeOptions([]);
      setIsBusy(false);
    }
  }

  async function waitForFeeOptionSelection(
    options: FeeOptionWithBalance[]
  ): Promise<FeeOptionSelection | undefined> {
    if (options.length === 0) {
      setTransferStatus('Network fee sponsored. Sending transfer...');
      return undefined;
    }

    let availableBalance = balance;
    try {
      const snapshot = await getDevnetBalances(walletAddress);
      if (snapshot.error) throw new Error(snapshot.error);
      availableBalance = snapshot.sol;
      setBalance(snapshot.sol);
      setUsdcBalance(snapshot.usdc);
      setBalanceStatus('');
    } catch (error) {
      if (availableBalance === null) {
        setBalanceStatus(error instanceof Error ? error.message : String(error));
      }
    }

    const enrichedOptions = options.map((option) =>
      availableBalance !== null && option.feeOption.token.symbol === 'SOL'
        ? {
            ...option,
            available: formatBaseUnits(availableBalance, LAMPORTS_PER_SOL_DECIMALS),
            availableRaw: availableBalance.toString(),
            decimals: LAMPORTS_PER_SOL_DECIMALS
          }
        : option
    );
    setFeeOptions(enrichedOptions);
    setTransferStatus('Review the recipient-account rent options to continue.');
    return new Promise((resolve, reject) => {
      feeSelection.current = { resolve, reject };
    });
  }

  function chooseFeeOption(option: FeeOptionWithBalance) {
    feeSelection.current?.resolve(option.selection);
    feeSelection.current = null;
    setFeeOptions([]);
    setTransferStatus(
      `Accepted ${option.feeOption.displayValue} ${option.feeOption.token.symbol} rent option. Sending transfer...`
    );
  }

  function cancelFeeSelection() {
    feeSelection.current?.reject(new Error('Fee confirmation cancelled'));
    feeSelection.current = null;
    setFeeOptions([]);
  }

  return (
    <>
      <section className="tool solana-tool" role="tabpanel">
        <div className="tool-header">
          <h2>Solana operations</h2>
          <span className="metadata-pill">Devnet</span>
        </div>

        <div className="balance-panel">
          <div className="balance-assets">
            <div className="balance-asset">
              <span>Devnet SOL balance</span>
              <strong>
                {balance === null
                  ? '—'
                  : `${formatBaseUnits(balance, LAMPORTS_PER_SOL_DECIMALS)} SOL`}
              </strong>
              <a href="https://faucet.solana.com/" target="_blank" rel="noreferrer">
                Open SOL faucet
              </a>
            </div>
            <div className="balance-asset">
              <span>Devnet USDC balance</span>
              <strong>
                {usdcBalance === null ? '—' : `${formatBaseUnits(usdcBalance, USDC_DECIMALS)} USDC`}
              </strong>
              <a href="https://faucet.circle.com/" target="_blank" rel="noreferrer">
                Open USDC faucet
              </a>
            </div>
          </div>
          <div className="inline-links">
            <button
              type="button"
              className="secondary compact-button"
              onClick={refreshBalance}
              disabled={isBalanceLoading}
            >
              {isBalanceLoading ? 'Refreshing...' : 'Refresh'}
            </button>
            <a href={solanaAddressExplorerUrl(walletAddress)} target="_blank" rel="noreferrer">
              View wallet
            </a>
          </div>
          {balanceStatus && <output>{balanceStatus}</output>}
        </div>

        <div className="operation-block">
          <h3>Sign message</h3>
          <label>
            Message
            <input value={message} onChange={(event) => setMessage(event.target.value)} />
          </label>
          <button type="button" onClick={signMessage} disabled={isBusy || !message.trim()}>
            Sign Solana message
          </button>
          {messageSignature && (
            <p className="result labeled-result">
              <span className="result-label">Signature</span>
              <code className="result-value">{messageSignature}</code>
            </p>
          )}
          {signStatus && <output>{signStatus}</output>}
        </div>

        <div className="operation-block">
          <div className="tool-header">
            <h3>Send transfer</h3>
            <span className="metadata-pill">Relayed</span>
          </div>
          <label>
            Asset
            <span className="select-control">
              <select
                value={assetType}
                onChange={(event) => {
                  const nextAssetType = event.target.value as AssetType;
                  setAssetType(nextAssetType);
                  setAmount(nextAssetType === 'SOL' ? '0.001' : '1');
                }}
              >
                <option value="SOL">Native SOL</option>
                <option value="SPL">SPL token</option>
              </select>
            </span>
          </label>
          {assetType === 'SPL' && (
            <>
              <label>
                Token
                <span className="select-control">
                  <select
                    value={splTokenType}
                    onChange={(event) => setSplTokenType(event.target.value as SplTokenType)}
                  >
                    <option value="USDC">USDC</option>
                    <option value="CUSTOM">Custom token</option>
                  </select>
                </span>
              </label>
              {splTokenType === 'CUSTOM' && (
                <>
                  <label>
                    Token mint
                    <input
                      value={mint}
                      onChange={(event) => setMint(event.target.value)}
                      placeholder="SPL or Token-2022 mint address"
                    />
                  </label>
                  <label>
                    Token decimals
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max="255"
                      value={tokenDecimals}
                      onChange={(event) => setTokenDecimals(event.target.value)}
                    />
                  </label>
                </>
              )}
              {splTokenType === 'USDC' && (
                <p className="field-hint">USDC mint address: {DEVNET_USDC_MINT}</p>
              )}
            </>
          )}
          <label>
            Recipient wallet
            <input
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="Solana wallet address"
            />
          </label>
          <label>
            {assetType === 'SOL'
              ? 'Amount (SOL)'
              : splTokenType === 'USDC'
                ? 'Amount (USDC)'
                : 'Amount (token units)'}
            <input
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          {assetType !== 'SOL' && (
            <p className="field-hint">
              Enter the recipient's wallet address. WaaS uses its associated token account when one
              exists. If one must be created, the network fee remains sponsored and you will choose
              how to pay the required account rent.
            </p>
          )}
          <button
            type="button"
            onClick={sendTransfer}
            disabled={
              isBusy ||
              !recipient.trim() ||
              !amount.trim() ||
              (assetType === 'SPL' &&
                splTokenType === 'CUSTOM' &&
                (!mint.trim() || !tokenDecimals.trim()))
            }
          >
            Send on Solana Devnet
          </button>
          {transactionSignature && (
            <div className="result-block">
              <p className="result labeled-result">
                <span className="result-label">Transaction signature</span>
                <code className="result-value">{transactionSignature}</code>
              </p>
              <a
                href={solanaTransactionExplorerUrl(transactionSignature)}
                target="_blank"
                rel="noreferrer"
              >
                View on Solana Explorer
              </a>
            </div>
          )}
          {transferStatus && <output>{transferStatus}</output>}
        </div>
      </section>
      {feeOptions.length > 0 && (
        <FeeOptionsPanel
          feeOptions={feeOptions}
          allowUnknownBalance
          onCancel={cancelFeeSelection}
          onChoose={chooseFeeOption}
        />
      )}
    </>
  );
}

async function getDevnetBalances(address: string): Promise<{
  sol: bigint;
  usdc: bigint;
  error?: string;
}> {
  const result = await omsWallet.indexer.getSolanaBalances({
    walletAddress: address,
    networks: [SolanaNetworks.devnet],
    mintAddresses: [DEVNET_USDC_MINT]
  });
  const networkError = result.errors.find((error) => error.network === SolanaNetworks.devnet);
  if (networkError) {
    return { sol: 0n, usdc: 0n, error: networkError.reason };
  }

  const nativeBalance = result.balances.find((asset) => asset.assetType === 'native');
  const usdcBalance = result.balances.find(
    (asset) => asset.assetType === 'fungible-token' && asset.mintAddress === DEVNET_USDC_MINT
  );
  return {
    sol: parseIndexerBalance(nativeBalance?.balance, 'SOL'),
    usdc: parseIndexerBalance(usdcBalance?.balance, 'USDC')
  };
}

function parseIndexerBalance(balance: string | undefined, symbol: string): bigint {
  if (balance === undefined) return 0n;
  if (!/^\d+$/.test(balance)) {
    throw new Error(`Indexer returned an invalid ${symbol} balance`);
  }
  return BigInt(balance);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseDecimalBaseUnits(value: string, decimals: number, label: string): bigint {
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`${label} must be a positive decimal value.`);
  }

  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > decimals) {
    throw new Error(`${label} supports at most ${decimals} decimal places.`);
  }
  const parsed = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'));
  if (parsed <= 0n) {
    throw new Error(`${label} must be greater than zero.`);
  }
  return parsed;
}

function parseTokenDecimals(value: string): number {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error('Token decimals must be an integer between 0 and 255.');
  }
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) {
    throw new Error('Token decimals must be an integer between 0 and 255.');
  }
  return parsed;
}

function formatBaseUnits(value: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = (value % divisor).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function solanaAddressExplorerUrl(address: string): string {
  return `${SOLANA_DEVNET_EXPLORER_URL}/address/${address}?cluster=devnet`;
}

function solanaTransactionExplorerUrl(signature: string): string {
  return `${SOLANA_DEVNET_EXPLORER_URL}/tx/${signature}?cluster=devnet`;
}
