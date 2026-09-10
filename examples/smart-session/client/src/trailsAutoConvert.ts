import { FeeOptionSelector, Networks, type OMSWallet } from '@polygonlabs/oms-wallet';
import {
  FundMethod,
  IntentMode,
  IntentStatus,
  TradeType,
  TrailsApi,
  type IntentReceipt,
  type TransactionStatus
} from '@0xtrails/api';
import { formatUnits, type Address, type Hex } from 'viem';

import { BASE_USDC, getSmartSessionAsset } from '../../shared/networks';

const TRAILS_API_URL = 'https://trails-api.sequence.app';
const TRAILS_API_KEY = 'AQAAAAAAAMDoWz-avqIIjXGH7JJlBSormpo';

const polygonUsdt = getSmartSessionAsset('polygon', 'usdt');
if (polygonUsdt.kind !== 'erc20') throw new Error('Polygon USDT must be an ERC-20 asset');
export const POLYGON_USDT = polygonUsdt.tokenAddress;
export const AUTO_CONVERT_POLL_INTERVAL_MS = 15_000;

export type TrailsAutoConvertPhase =
  | 'idle'
  | 'watching'
  | 'quoting'
  | 'committing'
  | 'submitting'
  | 'bridging'
  | 'settling'
  | 'complete'
  | 'error';

export interface TrailsAutoConvertProgress {
  phase: TrailsAutoConvertPhase;
  message: string;
  inputAmountRaw?: string;
  quotedOutputRaw?: string;
  receivedOutputRaw?: string;
  routeProviders?: string[];
  estimatedDurationSeconds?: number;
  totalFeeUsd?: number;
  intentId?: string;
  originTransactionHash?: string;
  destinationTransactionHash?: string;
}

export const IDLE_AUTO_CONVERT_PROGRESS: TrailsAutoConvertProgress = {
  phase: 'idle',
  message: ''
};

export async function getPolygonUsdtBalance(
  wallet: OMSWallet,
  walletAddress: Address
): Promise<bigint> {
  const response = await wallet.indexer.getBalances({
    walletAddress,
    networks: [Networks.polygon],
    contractAddresses: [POLYGON_USDT],
    includeMetadata: false,
    omitPrices: true
  });

  return response.balances.reduce((total, balance) => {
    if (
      balance.contractType.toUpperCase() !== 'ERC20' ||
      balance.chainId !== Networks.polygon.id ||
      balance.contractAddress.toLowerCase() !== POLYGON_USDT.toLowerCase()
    ) {
      return total;
    }
    return total + BigInt(balance.balance);
  }, 0n);
}

export async function convertPolygonUsdtToBaseUsdc({
  amount,
  onProgress,
  signal,
  wallet,
  walletAddress
}: {
  amount: bigint;
  onProgress: (progress: TrailsAutoConvertProgress) => void;
  signal: AbortSignal;
  wallet: OMSWallet;
  walletAddress: Address;
}): Promise<TrailsAutoConvertProgress> {
  if (amount <= 0n) throw new Error('A positive Polygon USDT balance is required.');

  const trails = new TrailsApi(TRAILS_API_KEY, { hostname: TRAILS_API_URL });
  const baseProgress: TrailsAutoConvertProgress = {
    phase: 'quoting',
    message: 'Fetching a Trails quote for Polygon USDT to Base USDC…',
    inputAmountRaw: amount.toString()
  };
  onProgress(baseProgress);

  const { intent } = await trails.quoteIntent(
    {
      ownerAddress: walletAddress,
      originChainId: Networks.polygon.id,
      originTokenAddress: POLYGON_USDT,
      destinationChainId: Networks.base.id,
      destinationTokenAddress: BASE_USDC,
      destinationToAddress: walletAddress,
      originTokenAmount: amount,
      tradeType: TradeType.EXACT_INPUT,
      fundMethod: FundMethod.WALLET,
      mode: IntentMode.SWAP
    },
    undefined,
    signal
  );

  const quotedProgress: TrailsAutoConvertProgress = {
    ...baseProgress,
    phase: 'committing',
    message: 'Quote received. Creating the one-time Trails intent…',
    quotedOutputRaw: intent.quote.toAmount.toString(),
    routeProviders: intent.quote.routeProviders,
    estimatedDurationSeconds: intent.quote.estimatedDuration,
    totalFeeUsd: intent.fees.totalFeeUsd,
    intentId: intent.intentId
  };
  onProgress(quotedProgress);

  const committed = await trails.commitIntent({ intent }, undefined, signal);
  const deposit = intent.depositTransaction;
  onProgress({
    ...quotedProgress,
    phase: 'submitting',
    message: 'Submitting the Polygon USDT transfer…',
    intentId: committed.intentId
  });

  const transaction = await wallet.wallet.sendTransaction({
    network: Networks.polygon,
    to: deposit.to as Address,
    value: deposit.value,
    data: deposit.data as Hex,
    selectFeeOption: selectFirstAvailableFeeOption
  });

  const originTransactionHash = transaction.txnHash;
  const executingProgress: TrailsAutoConvertProgress = {
    ...quotedProgress,
    phase: 'bridging',
    message: 'Polygon transfer submitted. Trails is moving the funds to Base…',
    intentId: committed.intentId,
    originTransactionHash
  };
  onProgress(executingProgress);

  await trails.executeIntent(
    {
      intentId: committed.intentId,
      depositTransactionHash: originTransactionHash
    },
    undefined,
    signal
  );

  let lastReceiptStates: TransactionStatus[] | undefined;
  while (!signal.aborted) {
    const response = await trails.waitIntentReceipt(
      { intentId: committed.intentId, lastReceiptStates },
      undefined,
      signal
    );
    const progress = progressFromReceipt(executingProgress, response.intentReceipt);
    onProgress(progress);

    if (response.done) {
      if (response.intentReceipt.status !== IntentStatus.SUCCEEDED) {
        throw new Error(intentFailureMessage(response.intentReceipt));
      }
      return progress;
    }
    lastReceiptStates = response.receiptStates;
  }

  throw new DOMException('The Trails conversion was cancelled.', 'AbortError');
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function trailsAutoConvertErrorMessage(error: unknown): string {
  const cause = (error as { cause?: unknown } | undefined)?.cause;
  const message = typeof cause === 'string' && cause.trim() ? cause : errorMessage(error);
  const insufficientAmount = parseInsufficientOriginAmount(message);
  if (!insufficientAmount) return message;

  return [
    'The Polygon USDT balance is too small to cover this Trails route.',
    `Available: ${formatUsdt(insufficientAmount.origin)} USDT.`,
    `Estimated route costs: ${formatUsdt(insufficientAmount.cost)} USDT`,
    `(${formatUsdt(insufficientAmount.shortfall)} USDT more than the available balance), before any Base USDC output.`,
    'Add more USDT, then enable the one-time conversion again.'
  ].join(' ');
}

async function selectFirstAvailableFeeOption(
  options: Parameters<typeof FeeOptionSelector.firstAvailable>[0]
) {
  if (options.length === 0) return undefined;

  const selection = await FeeOptionSelector.firstAvailable(options);
  if (!selection) throw new Error('No transaction fee option has enough balance.');
  return selection;
}

function progressFromReceipt(
  previous: TrailsAutoConvertProgress,
  receipt: IntentReceipt
): TrailsAutoConvertProgress {
  const destinationTransactionHash = receipt.destinationTransaction?.txnHash;
  const complete = receipt.status === IntentStatus.SUCCEEDED;
  return {
    ...previous,
    phase: complete ? 'complete' : destinationTransactionHash ? 'settling' : 'bridging',
    message: complete
      ? 'Conversion complete. Base USDC has arrived.'
      : destinationTransactionHash
        ? 'The destination transaction is settling on Base…'
        : 'Trails is bridging the funds to Base…',
    receivedOutputRaw: receipt.summary.destinationTokenAmount?.toString(),
    originTransactionHash:
      receipt.depositTransaction.txnHash ??
      receipt.originTransaction.txnHash ??
      previous.originTransactionHash,
    destinationTransactionHash
  };
}

function intentFailureMessage(receipt: IntentReceipt): string {
  const reason =
    receipt.destinationTransaction?.statusReason ??
    receipt.originTransaction.statusReason ??
    receipt.depositTransaction.statusReason;
  return `Trails intent ${receipt.status.toLowerCase()}${reason ? `: ${reason}` : '.'}`;
}

function parseInsufficientOriginAmount(
  message: string
): { origin: bigint; cost: bigint; shortfall: bigint } | undefined {
  if (!message.toLowerCase().includes('insufficient origin amount')) return undefined;

  const origin = integerField(message, 'origin');
  const trailsFee = integerField(message, 'trailsFee');
  const gasAndBridgeFee = integerField(message, 'gasAndBridgeFee');
  const providerSpendOverage = integerField(message, 'providerSpendOverage');
  if (
    origin === undefined ||
    trailsFee === undefined ||
    gasAndBridgeFee === undefined ||
    providerSpendOverage === undefined
  ) {
    return undefined;
  }

  const cost = trailsFee + gasAndBridgeFee + providerSpendOverage;
  return { origin, cost, shortfall: cost > origin ? cost - origin : 0n };
}

function integerField(message: string, field: string): bigint | undefined {
  const match = message.match(new RegExp(`${field}=(-?\\d+)`));
  return match ? BigInt(match[1]) : undefined;
}

function formatUsdt(amount: bigint): string {
  return formatUnits(amount, 6).replace(/\.0+$/, '');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
