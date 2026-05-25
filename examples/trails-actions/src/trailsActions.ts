import { TrailsApi } from '@0xtrails/api'
import {
  custom,
  deposit,
  dynamic,
  encodeDestinationCalls,
  getAmountWithSlippage,
  getEarnBalances,
  getEarnMarkets,
  lend,
  resolveActionsToCalls,
  swap,
  uniswapV3,
  type ActionItem,
  type EarnBalance,
  type EarnBalances,
  type EarnMarket,
} from '0xtrails/actions'
import {
  Networks,
} from '@0xsequence/typescript-sdk'
import {
  encodeFunctionData,
  formatUnits,
  parseEther,
  parseUnits,
  type Address,
  type Hex,
} from 'viem'
import { oms } from './omsClient'

export type PreparedTrailsTransaction = {
  title: string
  to: Address
  data: Hex
  value: string
  callCount: number
  postSendExpectation: PostSendExpectation
  marketName?: string
  marketId?: string
}

export type PreparedYieldTransactions = {
  title: string
  transactions: ParsedYieldTransaction[]
  postSendExpectation: PostSendExpectation
  marketName?: string
  marketId?: string
}

export type PostSendExpectation =
  | {
      type: 'usdcIncrease'
      minIncreaseRaw: string
    }
  | {
      type: 'earnMarketIncrease'
      marketId: string
    }
  | {
      type: 'earnMarketDecrease'
      marketId: string
    }

export type ParsedYieldTransaction = {
  to: Address
  data: Hex
  value: bigint
  chainId: number
}

export type EarnPosition = {
  id: string
  marketId: string
  marketName: string
  provider: string
  amount: string
  amountDisplay: string
  amountRaw: string
  amountUsd: string | null
  apy: string
  tokenSymbol: string
  outputToken: string
  outputTokenNetwork: string
  canWithdraw: boolean
}

export type BalanceState = {
  pol: string
  usdc: string
  polRaw: string
  usdcRaw: string
  status: string
}

const TRAILS_API_URL = 'https://trails-api.sequence.app'
const POLYGON_CHAIN_ID_NUMBER = 137
const POLYGON_USDC = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'
const POLYGON_WPOL = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'
const POL_TO_USDC_SWAP_FEE = '0.05'
const MAX_SWAP_SLIPPAGE_BPS = 100
const WRAPPED_NATIVE_DEPOSIT_ABI = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
] as const
const WRAPPED_NATIVE_DEPOSIT_CALLDATA = encodeFunctionData({
  abi: WRAPPED_NATIVE_DEPOSIT_ABI,
  functionName: 'deposit',
})

export const POLYGON_NETWORK = Networks.polygon
export const DEFAULT_SWAP_POL_AMOUNT = '0.5'
export const DEFAULT_DEPOSIT_USDC_AMOUNT = '0.1'
export const DEFAULT_EARN_POL_AMOUNT = '1'
export const SIGNED_OUT_BALANCES: BalanceState = {
  pol: '-',
  usdc: '-',
  polRaw: '0',
  usdcRaw: '0',
  status: 'Sign in to load balances.',
}

export function createTrailsClient(): TrailsApi {
  return new TrailsApi('', { hostname: TRAILS_API_URL })
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`
}

export function explorerUrlFor(txHash: string): string {
  return `${POLYGON_NETWORK.explorerUrl}/tx/${txHash}`
}

export function normalizeAmountInput(value: string): string {
  let result = ''
  let hasDecimal = false

  for (const character of value.replace(/,/g, '.')) {
    if (character >= '0' && character <= '9') {
      result += character
      continue
    }

    if (character === '.' && !hasDecimal) {
      result += character
      hasDecimal = true
    }
  }

  return result.startsWith('.') ? `0${result}` : result
}

export function requireWalletAddress(address: string | undefined): Address {
  if (!address?.startsWith('0x')) {
    throw new Error('Sign in before preparing a Trails action.')
  }
  return address as Address
}

export function requirePreparedTransaction(
  prepared: PreparedTrailsTransaction | null,
): PreparedTrailsTransaction {
  if (!prepared) throw new Error('Prepare the transaction first.')
  return prepared
}

export function requirePreparedYieldTransactions(
  prepared: PreparedYieldTransactions | null,
): PreparedYieldTransactions {
  if (!prepared) throw new Error('Prepare the transaction first.')
  return prepared
}

export async function getPolygonBalances(walletAddress: Address): Promise<BalanceState> {
  const [polBalance, usdcResult] = await Promise.all([
    oms.indexer.getNativeTokenBalance({
      network: POLYGON_NETWORK,
      walletAddress,
    }),
    oms.indexer.getTokenBalances({
      network: POLYGON_NETWORK,
      contractAddress: POLYGON_USDC,
      walletAddress,
      includeMetadata: false,
    }),
  ])
  const polRaw = polBalance?.balance ?? '0'
  const usdcRaw = usdcResult.balances[0]?.balance ?? '0'

  return {
    pol: formatTokenAmount(polRaw, 18, 'POL'),
    usdc: formatTokenAmount(usdcRaw, 6, 'USDC'),
    polRaw,
    usdcRaw,
    status: 'Balances updated.',
  }
}

export async function getPolygonEarnPositions(
  walletAddress: Address,
): Promise<{ positions: EarnPosition[]; errors: string[] }> {
  const trailsClient = createTrailsClient()
  const [balancesResult, marketsResult] = await Promise.all([
    getEarnBalances(
      {
        queries: [
          {
            address: walletAddress,
            network: 'polygon',
          },
        ],
      },
      trailsClient,
    ),
    getEarnMarkets(
      {
        chain: POLYGON_CHAIN_ID_NUMBER,
        limit: 100,
      },
      trailsClient,
    ),
  ])
  const marketById = new Map(marketsResult.items.map((market) => [market.id, market]))
  const positions = balancesResult.items
    .flatMap((balances) => {
      const balance = getPrimaryEarnBalance(balances)
      if (!balance) return []

      const market = marketById.get(balances.yieldId)
      const position: EarnPosition = {
        id: balances.yieldId,
        marketId: balances.yieldId,
        marketName: market?.metadata?.name ?? balance.shareToken?.name ?? `${balance.token.symbol} position`,
        provider: market?.providerId ?? balance.shareToken?.symbol ?? balances.yieldId,
        amount: balance.amount,
        amountDisplay: formatDisplayAmount(balance.amount),
        amountRaw: balance.amountRaw,
        amountUsd: formatUsdAmount(balance.amountUsd),
        apy: formatApy(balances.rewardRate ?? market?.rewardRate),
        tokenSymbol: balance.token.symbol,
        outputToken: balance.token.address ?? balance.token.symbol,
        outputTokenNetwork: balance.token.network ?? market?.network ?? 'polygon',
        canWithdraw: market?.status?.exit !== false,
      }
      return [position]
    })
    .sort((left, right) => getEarnPositionSortValue(right) - getEarnPositionSortValue(left))

  return {
    positions,
    errors: balancesResult.errors.map((error) => `${error.yieldId}: ${error.error}`),
  }
}

export async function prepareSwapPolToUsdc({
  walletAddress,
  polAmount,
}: {
  walletAddress: Address
  polAmount: string
}): Promise<PreparedTrailsTransaction> {
  const amountRaw = parsePositivePolAmount(polAmount)
  const trailsClient = createTrailsClient()
  const minAmountOutRaw = await getPolToUsdcMinAmountOutRaw(amountRaw)
  const calls = await resolveActionsToCalls({
    actions: [
      custom({
        to: POLYGON_WPOL,
        data: WRAPPED_NATIVE_DEPOSIT_CALLDATA,
        value: amountRaw,
      }),
      swap({
        tokenIn: POLYGON_WPOL,
        tokenOut: POLYGON_USDC,
        fee: POL_TO_USDC_SWAP_FEE,
        amountInRaw: amountRaw,
        minAmountOutRaw,
        provider: 'UNISWAP_V3',
      }),
    ],
    destinationChain: POLYGON_CHAIN_ID_NUMBER,
    userWalletAddress: walletAddress,
    trailsClient,
    publicClient: null,
  })

  return encodePreparedTransaction({
    title: 'Swap POL to USDC',
    calls,
    walletAddress,
    value: amountRaw,
    postSendExpectation: {
      type: 'usdcIncrease',
      minIncreaseRaw: minAmountOutRaw.toString(),
    },
  })
}

export async function prepareDepositUsdc({
  walletAddress,
  usdcAmount,
}: {
  walletAddress: Address
  usdcAmount: string
}): Promise<PreparedYieldTransactions> {
  const amount = parsePositiveUsdcAmount(usdcAmount)
  const trailsClient = createTrailsClient()
  const market = await findPolygonUsdcEarnMarket(trailsClient)
  const inputToken = getMarketInputToken(market)
  const response = await trailsClient.yieldCreateEnterAction({
    earnMarketId: market.id,
    userWalletAddress: walletAddress,
    args: {
      amount,
      inputToken: inputToken?.address ?? inputToken?.symbol,
      inputTokenNetwork: inputToken?.network ?? market.network,
      receiverAddress: walletAddress,
    },
  })
  const transactions = response.action.transactions
    .filter((transaction) => !transaction.isMessage)
    .map((transaction) => parseUnsignedYieldTransaction(transaction.unsignedTransaction))

  assertPolygonTransactions(transactions, 'Deposit')

  return {
    title: 'Deposit USDC using Earn',
    transactions,
    postSendExpectation: {
      type: 'earnMarketIncrease',
      marketId: market.id,
    },
    marketName: getMarketName(market),
    marketId: market.id,
  }
}

export async function prepareWithdrawEarnPosition({
  walletAddress,
  position,
}: {
  walletAddress: Address
  position: EarnPosition
}): Promise<PreparedYieldTransactions> {
  if (!position.canWithdraw) {
    throw new Error('This earn position is not currently withdrawable.')
  }

  const trailsClient = createTrailsClient()
  const response = await trailsClient.yieldCreateExitAction({
    earnMarketId: position.marketId,
    userWalletAddress: walletAddress,
    args: {
      amount: position.amount,
      outputToken: position.outputToken,
      outputTokenNetwork: position.outputTokenNetwork,
    },
  })
  const transactions = response.action.transactions
    .filter((transaction) => !transaction.isMessage)
    .map((transaction) => parseUnsignedYieldTransaction(transaction.unsignedTransaction))

  assertPolygonTransactions(transactions, 'Withdraw')

  return {
    title: `Withdraw ${position.marketName}`,
    transactions,
    postSendExpectation: {
      type: 'earnMarketDecrease',
      marketId: position.marketId,
    },
    marketName: position.marketName,
    marketId: position.marketId,
  }
}

export async function prepareSwapAndEarnUsdc({
  walletAddress,
  polAmount,
}: {
  walletAddress: Address
  polAmount: string
}): Promise<PreparedTrailsTransaction> {
  const amountRaw = parsePositivePolAmount(polAmount)
  const trailsClient = createTrailsClient()
  const market = await findPolygonUsdcEarnMarket(trailsClient)
  const minAmountOutRaw = await getPolToUsdcMinAmountOutRaw(amountRaw)
  const calls = await resolveActionsToCalls({
    actions: [
      custom({
        to: POLYGON_WPOL,
        data: WRAPPED_NATIVE_DEPOSIT_CALLDATA,
        value: amountRaw,
      }),
      swap({
        tokenIn: POLYGON_WPOL,
        tokenOut: POLYGON_USDC,
        fee: POL_TO_USDC_SWAP_FEE,
        amountInRaw: amountRaw,
        minAmountOutRaw,
        provider: 'UNISWAP_V3',
      }),
      buildEarnAction(market, walletAddress),
    ],
    destinationChain: POLYGON_CHAIN_ID_NUMBER,
    userWalletAddress: walletAddress,
    trailsClient,
    publicClient: null,
  })

  return encodePreparedTransaction({
    title: 'Swap and deposit USDC',
    calls,
    walletAddress,
    value: amountRaw,
    market,
    postSendExpectation: {
      type: 'earnMarketIncrease',
      marketId: market.id,
    },
  })
}

function parsePositivePolAmount(amount: string): bigint {
  const trimmed = normalizeAmountInput(amount).trim()
  if (!trimmed) throw new Error('Enter a POL amount.')
  const parsed = parseEther(trimmed)
  if (parsed <= 0n) throw new Error('Enter a POL amount greater than zero.')
  return parsed
}

function parsePositiveUsdcAmount(amount: string): string {
  const trimmed = normalizeAmountInput(amount).trim()
  if (!trimmed) throw new Error('Enter a USDC amount.')
  const parsed = parseUnits(trimmed, 6)
  if (parsed <= 0n) throw new Error('Enter a USDC amount greater than zero.')
  return trimmed
}

async function getPolToUsdcMinAmountOutRaw(amountRaw: bigint): Promise<bigint> {
  const quote = await uniswapV3.onChain(POLYGON_CHAIN_ID_NUMBER).quoteSwap({
    type: 'exactInputSingle',
    tokenIn: POLYGON_WPOL,
    tokenOut: POLYGON_USDC,
    fee: POL_TO_USDC_SWAP_FEE,
    amountIn: amountRaw,
  })

  if (quote.amountOut === undefined || quote.amountOut <= 0n) {
    throw new Error('Uniswap V3 quote did not return a positive USDC output amount.')
  }

  const minAmountOutRaw = getAmountWithSlippage(quote.amountOut, MAX_SWAP_SLIPPAGE_BPS)
  return minAmountOutRaw > 0n ? minAmountOutRaw : quote.amountOut
}

function getPrimaryEarnBalance(balances: EarnBalances): EarnBalance | undefined {
  if (balances.outputTokenBalance && hasPositiveEarnBalance(balances.outputTokenBalance)) {
    return balances.outputTokenBalance
  }

  return balances.balances.find(hasPositiveEarnBalance)
}

function hasPositiveEarnBalance(balance: EarnBalance): boolean {
  try {
    return BigInt(balance.amountRaw) > 0n
  } catch {
    const amount = Number(balance.amount)
    return Number.isFinite(amount) && amount > 0
  }
}

function getEarnPositionSortValue(position: EarnPosition): number {
  const amountUsd = Number(position.amountUsd)
  if (Number.isFinite(amountUsd)) return amountUsd

  const amount = Number(position.amount)
  return Number.isFinite(amount) ? amount : 0
}

function formatTokenAmount(rawBalance: string | undefined, decimals: number, symbol: string): string {
  if (!rawBalance) return `0 ${symbol}`

  try {
    const formatted = formatUnits(BigInt(rawBalance), decimals)
    const [whole, fraction = ''] = formatted.split('.')
    const trimmedFraction = fraction.slice(0, 6).replace(/0+$/, '')
    return `${trimmedFraction ? `${whole}.${trimmedFraction}` : whole} ${symbol}`
  } catch {
    return `- ${symbol}`
  }
}

function formatDisplayAmount(amount: string, maxFractionDigits = 4): string {
  const [whole, fraction = ''] = amount.split('.')
  const trimmedFraction = fraction.slice(0, maxFractionDigits).replace(/0+$/, '')
  const wholePart = whole ?? '0'

  return trimmedFraction ? `${wholePart}.${trimmedFraction}` : wholePart
}

function formatUsdAmount(amountUsd: string | undefined): string | null {
  if (amountUsd === undefined) return null
  const numericAmount = Number(amountUsd)
  if (!Number.isFinite(numericAmount)) return null

  return new Intl.NumberFormat('en-US', {
    currency: 'USD',
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: 'currency',
  }).format(numericAmount)
}

function formatApy(rewardRate?: { total?: number }): string {
  const total = rewardRate?.total
  if (!Number.isFinite(total)) return '-'
  const percent = (total as number) * 100
  return `${percent.toFixed(percent >= 10 ? 1 : 2)}%`
}

function getMarketInputToken(market: EarnMarket) {
  return market.inputTokens[0] ?? market.token
}

function getMarketName(market: EarnMarket): string {
  return market.metadata?.name || market.id
}

function isUsdcMarket(market: EarnMarket): boolean {
  const input = getMarketInputToken(market)
  return input?.address?.toLowerCase() === POLYGON_USDC.toLowerCase()
}

async function findPolygonUsdcEarnMarket(trailsClient: TrailsApi): Promise<EarnMarket> {
  const markets = await getEarnMarkets(
    {
      chain: POLYGON_CHAIN_ID_NUMBER,
      search: 'USDC',
      limit: 50,
    },
    trailsClient,
  )

  const candidates = markets.items
    .filter((market) => market.status?.enter !== false)
    .filter(isUsdcMarket)
    .sort((left, right) => {
      const leftRate = left.rewardRate?.total ?? 0
      const rightRate = right.rewardRate?.total ?? 0
      return rightRate - leftRate
    })

  const market = candidates[0]
  if (!market) {
    throw new Error('No enterable Polygon USDC earn market was returned.')
  }
  return market
}

function buildEarnAction(market: EarnMarket, walletAddress: Address, amount: string = dynamic()): ActionItem {
  const inputToken = getMarketInputToken(market)
  const params = {
    marketId: market.id,
    amount,
    inputToken: inputToken?.address ?? inputToken?.symbol,
    inputTokenNetwork: inputToken?.network ?? market.network,
    receiverAddress: walletAddress,
  }

  return market.mechanics.type === 'lending' ? lend(params) : deposit(params)
}

function encodePreparedTransaction({
  title,
  calls,
  walletAddress,
  value,
  postSendExpectation,
  market,
}: {
  title: string
  calls: Awaited<ReturnType<typeof resolveActionsToCalls>>
  walletAddress: Address
  value: bigint
  postSendExpectation: PostSendExpectation
  market?: EarnMarket
}): PreparedTrailsTransaction {
  const encoded = encodeDestinationCalls({
    calls,
    tokenAddress: POLYGON_USDC,
    sweepTarget: walletAddress,
  })

  return {
    title,
    to: encoded.recipient,
    data: encoded.destinationCalldata,
    value: value.toString(),
    callCount: calls.length,
    postSendExpectation,
    marketName: market ? getMarketName(market) : undefined,
    marketId: market?.id,
  }
}

function parseUnsignedYieldTransaction(tx: unknown): ParsedYieldTransaction {
  const unsignedTx = (typeof tx === 'string' ? JSON.parse(tx) : tx) as {
    to?: string
    data?: string
    value?: string | number | bigint | null
    chainId?: string | number
  }

  if (!unsignedTx.to || unsignedTx.chainId === undefined) {
    throw new Error('Yield action returned an incomplete transaction.')
  }

  return {
    to: unsignedTx.to as Address,
    data: (unsignedTx.data ?? '0x') as Hex,
    value: unsignedTx.value === null ? 0n : BigInt(unsignedTx.value ?? 0),
    chainId: Number(unsignedTx.chainId),
  }
}

function assertPolygonTransactions(transactions: ParsedYieldTransaction[], label: string): void {
  if (transactions.length === 0) {
    throw new Error(`${label} action did not return a transaction.`)
  }

  const unsupportedTransaction = transactions.find((transaction) => transaction.chainId !== POLYGON_CHAIN_ID_NUMBER)
  if (unsupportedTransaction) {
    throw new Error(
      `${label} returned chain ${unsupportedTransaction.chainId}, but this demo only sends Polygon transactions.`,
    )
  }
}
