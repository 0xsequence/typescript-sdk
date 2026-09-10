// Minimal hand-written indexer gateway adapters for the SDK surface we expose.

import type { OMSWalletUpstreamError } from '../errors.js';
import type { Network, SolanaNetwork } from '../networks.js';

import { errorMessage, OMSWalletRequestError, OMSWalletResponseError } from '../errors.js';
import { HttpClient } from '../httpClient.js';
import { SolanaNetworks } from '../networks.js';
import { IndexerOperation } from '../operations.js';

const IndexerWebrpcHeaderValue = 'webrpc@v0.31.2;gen-typescript@v0.23.1;sequence-indexer@v0.4.0';
const SolanaIndexerWebrpcHeaderValue =
  'webrpc@v0.31.2;gen-typescript@v0.23.1;solana-indexer-gateway@v1';

export type IndexerNetworkType = 'MAINNETS' | 'TESTNETS' | 'ALL';
export type ContractVerificationStatus = 'VERIFIED' | 'UNVERIFIED' | 'ALL';

export interface TokenBalancesPage {
  page: number;
  column?: string;
  before?: unknown;
  after?: unknown;
  sort?: SortBy[];
  pageSize: number;
  more: boolean;
}

export interface TokenBalancesPageRequest {
  page?: number;
  column?: string;
  before?: unknown;
  after?: unknown;
  sort?: SortBy[];
  pageSize?: number;
}

export interface SortBy {
  column: string;
  order: 'DESC' | 'ASC';
}

export interface TokenContractInfo {
  chainId: number;
  address: string;
  source: string;
  name: string;
  type: string;
  symbol: string;
  decimals?: number;
  logoURI?: string;
  deployed: boolean;
  bytecodeHash: string;
  extensions: Record<string, unknown>;
  updatedAt: string;
  queuedAt?: string;
  status: string;
}

export interface TokenMetadataAsset {
  id?: number;
  collectionId?: number;
  tokenId?: string;
  url?: string;
  metadataField?: string;
  name?: string;
  filesize?: number;
  mimeType?: string;
  width?: number;
  height?: number;
  updatedAt?: string;
}

export interface TokenMetadata {
  chainId?: number;
  contractAddress?: string;
  tokenId: string;
  source: string;
  name: string;
  description?: string;
  image?: string;
  video?: string;
  audio?: string;
  properties?: Record<string, unknown>;
  attributes: Record<string, unknown>[];
  imageData?: string;
  externalUrl?: string;
  backgroundColor?: string;
  animationUrl?: string;
  decimals?: number;
  updatedAt?: string;
  assets?: TokenMetadataAsset[];
  status: string;
  queuedAt?: string;
  lastFetched?: string;
}

interface TokenBalanceBase {
  contractType: string;
  accountAddress: string;
  balance: string;
  chainId: number;
  balanceUSD?: string;
  priceUSD?: string;
  priceUpdatedAt?: string;
}

export interface NativeTokenBalance extends TokenBalanceBase {
  contractType: 'NATIVE';
  name: string;
  symbol: string;
  contractAddress?: undefined;
  tokenId?: undefined;
}

export interface ContractTokenBalance extends TokenBalanceBase {
  contractAddress: string;
  /** The gateway returns `tokenID`; the SDK exposes it as `tokenId`. */
  tokenId: string;
  blockHash: string;
  blockNumber: number;
  uniqueCollectibles?: string;
  isSummary?: boolean;
  contractInfo?: TokenContractInfo;
  tokenMetadata?: TokenMetadata;
}

export type TokenBalance = NativeTokenBalance | ContractTokenBalance;

export interface MetadataOptions {
  verifiedOnly?: boolean;
  unverifiedOnly?: boolean;
  includeContracts?: string[];
}

export interface GetBalancesParams {
  walletAddress: string;
  networks?: Network[];
  networkType?: IndexerNetworkType;
  contractAddresses?: string[];
  includeMetadata?: boolean;
  omitPrices?: boolean;
  tokenIds?: string[];
  contractStatus?: ContractVerificationStatus;
  page?: TokenBalancesPageRequest;
}

export interface BalancesResult {
  status: number;
  page?: TokenBalancesPage;
  nativeBalances: NativeTokenBalance[];
  balances: ContractTokenBalance[];
}

export interface GetSolanaBalancesParams {
  walletAddress: string;
  networks?: SolanaNetwork[];
  includeMetadata?: boolean;
  omitNativeBalances?: boolean;
  mintAddresses?: string[];
  excludedMintAddresses?: string[];
}

export type SolanaVerificationStatus = 'verified' | 'unverified' | 'unknown';
export type SolanaVerificationSource = 'jupiter' | 'solflare-utl' | 'none';

export interface SolanaBalanceBase {
  network: SolanaNetwork;
  accountAddress: string;
  name: string;
  symbol: string;
  decimals: number;
  balance: string;
  formattedBalance: string;
  imageUrl?: string;
  metadataUri?: string;
  verificationStatus: SolanaVerificationStatus;
  verificationSource: SolanaVerificationSource;
  priceUSD?: string;
  balanceUSD?: string;
}

export interface SolanaNativeBalance extends SolanaBalanceBase {
  assetType: 'native';
  tokenProgram?: undefined;
  mintAddress?: undefined;
}

export interface SolanaFungibleTokenBalance extends SolanaBalanceBase {
  assetType: 'fungible-token';
  tokenProgram: 'spl-token' | 'token-2022';
  mintAddress: string;
}

export type SolanaBalance = SolanaNativeBalance | SolanaFungibleTokenBalance;

export interface SolanaNetworkError {
  network: SolanaNetwork;
  reason: string;
}

export interface SolanaBalancesResult {
  status: number;
  balances: SolanaBalance[];
  errors: SolanaNetworkError[];
}

export interface TransactionTransfer {
  transferType: string;
  contractAddress: string;
  contractType: string;
  from: string;
  to: string;
  tokenIds?: string[];
  amounts: string[];
  logIndex: number;
  amountsUSD?: string[];
  pricesUSD?: string[];
  contractInfo?: TokenContractInfo;
  tokenMetadata?: Record<string, TokenMetadata>;
}

export interface Transaction {
  txnHash: string;
  blockNumber: number;
  blockHash: string;
  chainId: number;
  metaTxnId?: string;
  transfers: TransactionTransfer[];
  timestamp: string;
}

export interface GetTransactionHistoryParams {
  walletAddress: string;
  networks?: Network[];
  networkType?: IndexerNetworkType;
  contractAddresses?: string[];
  transactionHashes?: string[];
  metaTransactionIds?: string[];
  fromBlock?: number;
  toBlock?: number;
  tokenId?: string;
  includeMetadata?: boolean;
  omitPrices?: boolean;
  metadataOptions?: MetadataOptions;
  page?: TokenBalancesPageRequest;
}

export interface TransactionHistoryResult {
  status: number;
  page?: TokenBalancesPage;
  transactions: Transaction[];
}

interface GatewayNativeTokenBalances {
  chainId: number;
  errorReason?: string;
  results?: NativeTokenBalanceRaw[];
}

interface GatewayTokenBalance {
  chainId: number;
  errorReason?: string;
  results?: TokenBalanceRaw[];
}

interface GatewayTransaction {
  chainId: number;
  errorReason?: string;
  results?: TransactionRaw[];
}

interface NativeTokenBalanceRaw {
  accountAddress?: unknown;
  chainId?: unknown;
  name?: unknown;
  symbol?: unknown;
  balance?: unknown;
  balanceWei?: unknown;
  balanceUSD?: unknown;
  priceUSD?: unknown;
  priceUpdatedAt?: unknown;
  errorReason?: unknown;
}

interface TokenBalanceRaw {
  contractType?: unknown;
  contractAddress?: unknown;
  accountAddress?: unknown;
  tokenID?: unknown;
  balance?: unknown;
  balanceUSD?: unknown;
  priceUSD?: unknown;
  priceUpdatedAt?: unknown;
  blockHash?: unknown;
  blockNumber?: unknown;
  chainId?: unknown;
  uniqueCollectibles?: unknown;
  isSummary?: unknown;
  contractInfo?: unknown;
  tokenMetadata?: unknown;
}

interface TokenContractInfoRaw {
  chainId?: unknown;
  address?: unknown;
  source?: unknown;
  name?: unknown;
  type?: unknown;
  symbol?: unknown;
  decimals?: unknown;
  logoURI?: unknown;
  deployed?: unknown;
  bytecodeHash?: unknown;
  extensions?: unknown;
  updatedAt?: unknown;
  queuedAt?: unknown;
  status?: unknown;
}

interface TokenMetadataRaw {
  chainId?: unknown;
  contractAddress?: unknown;
  tokenId?: unknown;
  tokenID?: unknown;
  source?: unknown;
  name?: unknown;
  description?: unknown;
  image?: unknown;
  video?: unknown;
  audio?: unknown;
  properties?: unknown;
  attributes?: unknown;
  image_data?: unknown;
  external_url?: unknown;
  background_color?: unknown;
  animation_url?: unknown;
  decimals?: unknown;
  updatedAt?: unknown;
  assets?: unknown;
  status?: unknown;
  queuedAt?: unknown;
  lastFetched?: unknown;
}

interface TokenMetadataAssetRaw {
  id?: unknown;
  collectionId?: unknown;
  tokenId?: unknown;
  tokenID?: unknown;
  url?: unknown;
  metadataField?: unknown;
  name?: unknown;
  filesize?: unknown;
  mimeType?: unknown;
  width?: unknown;
  height?: unknown;
  updatedAt?: unknown;
}

interface TransactionRaw {
  txnHash?: unknown;
  blockNumber?: unknown;
  blockHash?: unknown;
  chainId?: unknown;
  metaTxnID?: unknown;
  transfers?: unknown;
  timestamp?: unknown;
}

interface TransactionTransferRaw {
  transferType?: unknown;
  contractAddress?: unknown;
  contractType?: unknown;
  from?: unknown;
  to?: unknown;
  tokenIds?: unknown;
  tokenIDs?: unknown;
  amounts?: unknown;
  logIndex?: unknown;
  amountsUSD?: unknown;
  pricesUSD?: unknown;
  contractInfo?: unknown;
  tokenMetadata?: unknown;
}

interface TokenBalancesFilter {
  accountAddresses: string[];
  contractStatus?: ContractVerificationStatus;
  contractTypes?: string[];
  contractWhitelist?: string[];
  contractBlacklist?: string[];
  omitNativeBalances: boolean;
  omitPrices?: boolean;
  tokenIDs?: string[];
}

interface GetTokenBalancesDetailsRequest {
  chainIds?: number[];
  networkType?: IndexerNetworkType;
  filter: TokenBalancesFilter;
  omitMetadata?: boolean;
  page?: TokenBalancesPageRequest;
}

interface GetTokenBalancesDetailsResponse {
  page?: unknown;
  nativeBalances?: GatewayNativeTokenBalances[];
  balances?: GatewayTokenBalance[];
}

interface GetSolanaTokenBalancesDetailsRequest {
  networks: SolanaNetwork[];
  filter: {
    accountAddresses: string[];
    omitNativeBalances?: boolean;
    contractWhitelist?: string[];
    contractBlacklist?: string[];
  };
  omitMetadata: boolean;
}

interface GetSolanaTokenBalancesDetailsResponse {
  balances?: unknown;
  errors?: unknown;
}

interface SolanaBalanceRaw {
  network?: unknown;
  accountAddress?: unknown;
  assetType?: unknown;
  tokenProgram?: unknown;
  mintAddress?: unknown;
  name?: unknown;
  symbol?: unknown;
  decimals?: unknown;
  balance?: unknown;
  formattedBalance?: unknown;
  imageUrl?: unknown;
  metadataUri?: unknown;
  verificationStatus?: unknown;
  verificationSource?: unknown;
  priceUSD?: unknown;
  balanceUSD?: unknown;
}

interface SolanaNetworkErrorRaw {
  network?: unknown;
  reason?: unknown;
}

interface TransactionHistoryFilter {
  accountAddresses: string[];
  contractAddresses?: string[];
  transactionHashes?: string[];
  metaTransactionIDs?: string[];
  fromBlock?: number;
  toBlock?: number;
  tokenID?: string;
  omitPrices?: boolean;
}

interface GetTransactionHistoryRequest {
  chainIds?: number[];
  networkType?: IndexerNetworkType;
  filter: TransactionHistoryFilter;
  includeMetadata?: boolean;
  metadataOptions?: MetadataOptions;
  page?: TokenBalancesPageRequest;
}

interface GetTransactionHistoryResponse {
  page?: unknown;
  transactions?: GatewayTransaction[];
}

interface IndexerClientEnvironment {
  indexerGatewayUrl: string;
  solanaIndexerGatewayUrl: string;
}

export interface OMSWalletIndexerClient {
  getBalances(params: GetBalancesParams): Promise<BalancesResult>;
  getSolanaBalances(params: GetSolanaBalancesParams): Promise<SolanaBalancesResult>;
  getTransactionHistory(params: GetTransactionHistoryParams): Promise<TransactionHistoryResult>;
}

export class IndexerClient implements OMSWalletIndexerClient {
  private readonly publishableKey: string;
  private readonly environment: IndexerClientEnvironment;
  private readonly client: HttpClient;

  constructor(params: { publishableKey: string; environment: IndexerClientEnvironment }) {
    this.publishableKey = params.publishableKey;
    this.environment = params.environment;
    this.client = new HttpClient();
  }

  async getBalances(params: GetBalancesParams): Promise<BalancesResult> {
    const request: GetTokenBalancesDetailsRequest = {
      ...this.chainScope(params),
      filter: {
        accountAddresses: [params.walletAddress],
        contractWhitelist: nonEmpty(params.contractAddresses),
        contractStatus: params.contractStatus,
        omitNativeBalances: false,
        omitPrices: params.omitPrices,
        tokenIDs: nonEmpty(params.tokenIds)
      },
      omitMetadata: params.includeMetadata === false,
      page: this.requestPage(params.page)
    };

    const response = await this.postJson<GetTokenBalancesDetailsResponse>(
      IndexerOperation.getBalances,
      {
        baseUrl: this.indexerGatewayUrl(),
        path: '/GetTokenBalancesDetails',
        body: JSON.stringify(request),
        headers: this.defaultHeaders()
      }
    );

    return this.decodeResponse(IndexerOperation.getBalances, response.statusCode, () => ({
      status: response.statusCode,
      page: mapTokenBalancesPage(response.payload.page),
      nativeBalances: flattenGatewayResults(response.payload.nativeBalances).map(
        mapNativeTokenBalance
      ),
      balances: flattenGatewayResults(response.payload.balances).map(mapContractTokenBalance)
    }));
  }

  async getSolanaBalances(params: GetSolanaBalancesParams): Promise<SolanaBalancesResult> {
    const request: GetSolanaTokenBalancesDetailsRequest = {
      networks: params.networks ?? [SolanaNetworks.mainnet, SolanaNetworks.devnet],
      filter: {
        accountAddresses: [params.walletAddress],
        omitNativeBalances: params.omitNativeBalances,
        contractWhitelist: nonEmpty(params.mintAddresses),
        contractBlacklist: nonEmpty(params.excludedMintAddresses)
      },
      omitMetadata: params.includeMetadata === false
    };

    const response = await this.postJson<GetSolanaTokenBalancesDetailsResponse>(
      IndexerOperation.getSolanaBalances,
      {
        baseUrl: this.environment.solanaIndexerGatewayUrl,
        path: '/GetTokenBalancesDetails',
        body: JSON.stringify(request),
        headers: this.defaultHeaders(SolanaIndexerWebrpcHeaderValue)
      }
    );

    return this.decodeResponse(IndexerOperation.getSolanaBalances, response.statusCode, () => ({
      status: response.statusCode,
      balances: requiredArray(response.payload.balances, 'balances').map(mapSolanaBalance),
      errors: requiredArray(response.payload.errors, 'errors').map(mapSolanaNetworkError)
    }));
  }

  async getTransactionHistory(
    params: GetTransactionHistoryParams
  ): Promise<TransactionHistoryResult> {
    const request: GetTransactionHistoryRequest = {
      ...this.chainScope(params),
      filter: {
        accountAddresses: [params.walletAddress],
        contractAddresses: nonEmpty(params.contractAddresses),
        transactionHashes: nonEmpty(params.transactionHashes),
        metaTransactionIDs: nonEmpty(params.metaTransactionIds),
        fromBlock: params.fromBlock,
        toBlock: params.toBlock,
        tokenID: params.tokenId,
        omitPrices: params.omitPrices
      },
      includeMetadata: params.includeMetadata ?? true,
      metadataOptions: params.metadataOptions,
      page: this.requestPage(params.page)
    };

    const response = await this.postJson<GetTransactionHistoryResponse>(
      IndexerOperation.getTransactionHistory,
      {
        baseUrl: this.indexerGatewayUrl(),
        path: '/GetTransactionHistory',
        body: JSON.stringify(request),
        headers: this.defaultHeaders()
      }
    );

    return this.decodeResponse(IndexerOperation.getTransactionHistory, response.statusCode, () => ({
      status: response.statusCode,
      page: mapTokenBalancesPage(response.payload.page),
      transactions: flattenGatewayResults(response.payload.transactions).map(mapTransaction)
    }));
  }

  private async postJson<T>(
    operation: IndexerOperation,
    args: Parameters<HttpClient['postJson']>[0]
  ): Promise<{ statusCode: number; payload: T }> {
    let response;
    try {
      response = await this.client.postJson(args);
    } catch (error) {
      throw new OMSWalletRequestError({
        operation,
        retryable: true,
        upstreamError: indexerRequestFailure(error),
        cause: error,
        message: errorMessage(error)
      });
    }

    let payload: T;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      const errorPayload = parseJsonOrText(response.body);
      const message = responseErrorMessage(errorPayload, operation, response.statusCode);
      throw new OMSWalletRequestError({
        code: 'OMS_HTTP_ERROR',
        operation,
        status: response.statusCode,
        retryable: response.statusCode >= 500,
        upstreamError: indexerResponseError(errorPayload, response.statusCode, message),
        cause: errorPayload,
        message
      });
    }

    try {
      payload = JSON.parse(response.body) as T;
    } catch (error) {
      const message = `Invalid JSON response from ${operation}`;
      throw new OMSWalletResponseError({
        operation,
        status: response.statusCode,
        upstreamError: {
          service: 'indexer',
          status: response.statusCode,
          message
        },
        cause: error,
        message
      });
    }

    return { statusCode: response.statusCode, payload };
  }

  private chainScope(params: { networks?: Network[]; networkType?: IndexerNetworkType }): {
    chainIds?: number[];
    networkType?: IndexerNetworkType;
  } {
    if (params.networks && params.networks.length > 0) {
      return { chainIds: params.networks.map((network) => network.id) };
    }
    return { networkType: params.networkType ?? 'MAINNETS' };
  }

  private requestPage(page: TokenBalancesPageRequest | undefined): TokenBalancesPageRequest {
    return {
      ...page,
      page: page?.page ?? 0,
      pageSize: page?.pageSize ?? 40
    };
  }

  private decodeResponse<T>(operation: IndexerOperation, status: number, decode: () => T): T {
    try {
      return decode();
    } catch (error) {
      const message = `Invalid JSON response from ${operation}`;
      throw new OMSWalletResponseError({
        operation,
        status,
        upstreamError: {
          service: 'indexer',
          status,
          message
        },
        cause: error,
        message
      });
    }
  }

  private indexerGatewayUrl(): string {
    return this.environment.indexerGatewayUrl;
  }

  private defaultHeaders(webrpcHeaderValue = IndexerWebrpcHeaderValue): Record<string, string> {
    const headers: Record<string, string> = {
      'Api-Key': this.publishableKey,
      Accept: 'application/json',
      Webrpc: webrpcHeaderValue
    };

    return headers;
  }
}

function flattenGatewayResults<T>(groups: Array<{ results?: T[] }> | undefined): T[] {
  return groups?.flatMap((group) => group.results ?? []) ?? [];
}

function nonEmpty<T>(values: T[] | undefined): T[] | undefined {
  return values && values.length > 0 ? values : undefined;
}

function mapSolanaBalance(value: unknown): SolanaBalance {
  const raw = asObject(value, 'balances[]') as SolanaBalanceRaw;
  const assetType = requiredStringUnion(raw.assetType, 'balances[].assetType', [
    'native',
    'fungible-token'
  ] as const);
  const base: SolanaBalanceBase = {
    network: mapSolanaNetwork(raw.network, 'balances[].network'),
    accountAddress: requiredString(raw.accountAddress, 'balances[].accountAddress'),
    name: requiredString(raw.name, 'balances[].name'),
    symbol: requiredString(raw.symbol, 'balances[].symbol'),
    decimals: requiredNumber(raw.decimals, 'balances[].decimals'),
    balance: requiredString(raw.balance, 'balances[].balance'),
    formattedBalance: requiredString(raw.formattedBalance, 'balances[].formattedBalance'),
    imageUrl: optionalNonEmptyString(raw.imageUrl, 'balances[].imageUrl'),
    metadataUri: optionalNonEmptyString(raw.metadataUri, 'balances[].metadataUri'),
    verificationStatus: requiredStringUnion(
      raw.verificationStatus,
      'balances[].verificationStatus',
      ['verified', 'unverified', 'unknown'] as const
    ),
    verificationSource: requiredStringUnion(
      raw.verificationSource,
      'balances[].verificationSource',
      ['jupiter', 'solflare-utl', 'none'] as const
    ),
    priceUSD: optionalString(raw.priceUSD, 'balances[].priceUSD'),
    balanceUSD: optionalString(raw.balanceUSD, 'balances[].balanceUSD')
  };

  if (assetType === 'native') {
    if (raw.tokenProgram != null || raw.mintAddress != null) {
      throw new TypeError('native balances must not include tokenProgram or mintAddress');
    }
    return { ...base, assetType };
  }

  return {
    ...base,
    assetType,
    tokenProgram: requiredStringUnion(raw.tokenProgram, 'balances[].tokenProgram', [
      'spl-token',
      'token-2022'
    ] as const),
    mintAddress: requiredString(raw.mintAddress, 'balances[].mintAddress')
  };
}

function mapSolanaNetworkError(value: unknown): SolanaNetworkError {
  const raw = asObject(value, 'errors[]') as SolanaNetworkErrorRaw;
  return {
    network: mapSolanaNetwork(raw.network, 'errors[].network'),
    reason: requiredString(raw.reason, 'errors[].reason')
  };
}

function mapSolanaNetwork(value: unknown, path: string): SolanaNetwork {
  return requiredStringUnion(value, path, [SolanaNetworks.mainnet, SolanaNetworks.devnet] as const);
}

function mapNativeTokenBalance(raw: NativeTokenBalanceRaw): NativeTokenBalance {
  return {
    contractType: 'NATIVE',
    accountAddress: requiredString(raw.accountAddress, 'nativeBalances[].accountAddress'),
    name: requiredString(raw.name, 'nativeBalances[].name'),
    symbol: requiredString(raw.symbol, 'nativeBalances[].symbol'),
    balance: requiredString(raw.balance ?? raw.balanceWei, 'nativeBalances[].balance'),
    balanceUSD: optionalString(raw.balanceUSD, 'nativeBalances[].balanceUSD'),
    priceUSD: optionalString(raw.priceUSD, 'nativeBalances[].priceUSD'),
    priceUpdatedAt: optionalString(raw.priceUpdatedAt, 'nativeBalances[].priceUpdatedAt'),
    chainId: requiredNumber(raw.chainId, 'nativeBalances[].chainId')
  };
}

/** Re-maps the wire key `tokenID` onto the camelCase `tokenId` field. */
function mapContractTokenBalance(raw: TokenBalanceRaw): ContractTokenBalance {
  return {
    contractType: requiredString(raw.contractType, 'balances[].contractType'),
    contractAddress: requiredString(raw.contractAddress, 'balances[].contractAddress'),
    accountAddress: requiredString(raw.accountAddress, 'balances[].accountAddress'),
    tokenId: requiredString(raw.tokenID, 'balances[].tokenID'),
    balance: requiredString(raw.balance, 'balances[].balance'),
    balanceUSD: optionalString(raw.balanceUSD, 'balances[].balanceUSD'),
    priceUSD: optionalString(raw.priceUSD, 'balances[].priceUSD'),
    priceUpdatedAt: optionalString(raw.priceUpdatedAt, 'balances[].priceUpdatedAt'),
    blockHash: requiredString(raw.blockHash, 'balances[].blockHash'),
    blockNumber: requiredNumber(raw.blockNumber, 'balances[].blockNumber'),
    chainId: requiredNumber(raw.chainId, 'balances[].chainId'),
    uniqueCollectibles: optionalString(raw.uniqueCollectibles, 'balances[].uniqueCollectibles'),
    isSummary: optionalBoolean(raw.isSummary, 'balances[].isSummary'),
    contractInfo: raw.contractInfo == null ? undefined : mapTokenContractInfo(raw.contractInfo),
    tokenMetadata: raw.tokenMetadata == null ? undefined : mapTokenMetadata(raw.tokenMetadata)
  };
}

function mapTransaction(raw: TransactionRaw): Transaction {
  return {
    txnHash: requiredString(raw.txnHash, 'transactions[].txnHash'),
    blockNumber: requiredNumber(raw.blockNumber, 'transactions[].blockNumber'),
    blockHash: requiredString(raw.blockHash, 'transactions[].blockHash'),
    chainId: requiredNumber(raw.chainId, 'transactions[].chainId'),
    metaTxnId: optionalString(raw.metaTxnID, 'transactions[].metaTxnID'),
    transfers: requiredArray(raw.transfers, 'transactions[].transfers').map(mapTransactionTransfer),
    timestamp: requiredString(raw.timestamp, 'transactions[].timestamp')
  };
}

function mapTransactionTransfer(value: unknown): TransactionTransfer {
  const raw = asObject(value, 'transactions[].transfers[]') as TransactionTransferRaw;
  return {
    transferType: requiredString(raw.transferType, 'transactions[].transfers[].transferType'),
    contractAddress: requiredString(
      raw.contractAddress,
      'transactions[].transfers[].contractAddress'
    ),
    contractType: requiredString(raw.contractType, 'transactions[].transfers[].contractType'),
    from: requiredString(raw.from, 'transactions[].transfers[].from'),
    to: requiredString(raw.to, 'transactions[].transfers[].to'),
    tokenIds: optionalStringArray(
      raw.tokenIds ?? raw.tokenIDs,
      'transactions[].transfers[].tokenIds'
    ),
    amounts: requiredStringArray(raw.amounts, 'transactions[].transfers[].amounts'),
    logIndex: requiredNumber(raw.logIndex, 'transactions[].transfers[].logIndex'),
    amountsUSD: optionalStringArray(raw.amountsUSD, 'transactions[].transfers[].amountsUSD'),
    pricesUSD: optionalStringArray(raw.pricesUSD, 'transactions[].transfers[].pricesUSD'),
    contractInfo: raw.contractInfo == null ? undefined : mapTokenContractInfo(raw.contractInfo),
    tokenMetadata: raw.tokenMetadata == null ? undefined : mapTokenMetadataRecord(raw.tokenMetadata)
  };
}

function mapTokenMetadataRecord(value: unknown): Record<string, TokenMetadata> {
  const raw = asObject(value, 'transactions[].transfers[].tokenMetadata');
  return Object.fromEntries(
    Object.entries(raw).map(([tokenId, metadata]) => [tokenId, mapTokenMetadata(metadata)])
  );
}

function mapTokenBalancesPage(value: unknown): TokenBalancesPage | undefined {
  if (value == null) return undefined;
  const raw = asObject(value, 'page');
  const sort = optionalArrayOrUndefined(raw.sort, 'page.sort');
  return {
    page: requiredNumber(raw.page, 'page.page'),
    column: optionalString(raw.column, 'page.column'),
    before: raw.before ?? undefined,
    after: raw.after ?? undefined,
    sort: sort?.map((item, index) => {
      const entry = asObject(item, `page.sort[${index}]`);
      const order = requiredString(entry.order, `page.sort[${index}].order`);
      if (order !== 'DESC' && order !== 'ASC') {
        throw new TypeError(`page.sort[${index}].order must be DESC or ASC`);
      }
      return {
        column: requiredString(entry.column, `page.sort[${index}].column`),
        order
      };
    }),
    pageSize: requiredNumber(raw.pageSize, 'page.pageSize'),
    more: requiredBoolean(raw.more, 'page.more')
  };
}

function mapTokenContractInfo(value: unknown): TokenContractInfo {
  const raw = asObject(value, 'contractInfo') as TokenContractInfoRaw;
  return {
    chainId: requiredNumber(raw.chainId, 'contractInfo.chainId'),
    address: requiredString(raw.address, 'contractInfo.address'),
    source: requiredString(raw.source, 'contractInfo.source'),
    name: requiredString(raw.name, 'contractInfo.name'),
    type: requiredString(raw.type, 'contractInfo.type'),
    symbol: requiredString(raw.symbol, 'contractInfo.symbol'),
    decimals: optionalNumber(raw.decimals, 'contractInfo.decimals'),
    logoURI: optionalString(raw.logoURI, 'contractInfo.logoURI'),
    deployed: requiredBoolean(raw.deployed, 'contractInfo.deployed'),
    bytecodeHash: requiredString(raw.bytecodeHash, 'contractInfo.bytecodeHash'),
    extensions: requiredObject(raw.extensions, 'contractInfo.extensions'),
    updatedAt: requiredString(raw.updatedAt, 'contractInfo.updatedAt'),
    queuedAt: optionalString(raw.queuedAt, 'contractInfo.queuedAt'),
    status: requiredString(raw.status, 'contractInfo.status')
  };
}

function mapTokenMetadata(value: unknown): TokenMetadata {
  const raw = asObject(value, 'tokenMetadata') as TokenMetadataRaw;
  const assets = optionalArrayOrUndefined(raw.assets, 'tokenMetadata.assets');
  return {
    chainId: optionalNumber(raw.chainId, 'tokenMetadata.chainId'),
    contractAddress: optionalString(raw.contractAddress, 'tokenMetadata.contractAddress'),
    tokenId: requiredString(raw.tokenId ?? raw.tokenID, 'tokenMetadata.tokenId'),
    source: requiredString(raw.source, 'tokenMetadata.source'),
    name: requiredString(raw.name, 'tokenMetadata.name'),
    description: optionalString(raw.description, 'tokenMetadata.description'),
    image: optionalString(raw.image, 'tokenMetadata.image'),
    video: optionalString(raw.video, 'tokenMetadata.video'),
    audio: optionalString(raw.audio, 'tokenMetadata.audio'),
    properties: optionalObject(raw.properties, 'tokenMetadata.properties'),
    attributes: requiredObjectArray(raw.attributes, 'tokenMetadata.attributes'),
    imageData: optionalString(raw.image_data, 'tokenMetadata.image_data'),
    externalUrl: optionalString(raw.external_url, 'tokenMetadata.external_url'),
    backgroundColor: optionalString(raw.background_color, 'tokenMetadata.background_color'),
    animationUrl: optionalString(raw.animation_url, 'tokenMetadata.animation_url'),
    decimals: optionalNumber(raw.decimals, 'tokenMetadata.decimals'),
    updatedAt: optionalString(raw.updatedAt, 'tokenMetadata.updatedAt'),
    assets: assets?.map(mapTokenMetadataAsset),
    status: requiredString(raw.status, 'tokenMetadata.status'),
    queuedAt: optionalString(raw.queuedAt, 'tokenMetadata.queuedAt'),
    lastFetched: optionalString(raw.lastFetched, 'tokenMetadata.lastFetched')
  };
}

function mapTokenMetadataAsset(value: unknown): TokenMetadataAsset {
  const raw = asObject(value, 'tokenMetadata.assets[]') as TokenMetadataAssetRaw;
  return {
    id: optionalNumber(raw.id, 'tokenMetadata.assets[].id'),
    collectionId: optionalNumber(raw.collectionId, 'tokenMetadata.assets[].collectionId'),
    tokenId: optionalString(raw.tokenId ?? raw.tokenID, 'tokenMetadata.assets[].tokenId'),
    url: optionalString(raw.url, 'tokenMetadata.assets[].url'),
    metadataField: optionalString(raw.metadataField, 'tokenMetadata.assets[].metadataField'),
    name: optionalString(raw.name, 'tokenMetadata.assets[].name'),
    filesize: optionalNumber(raw.filesize, 'tokenMetadata.assets[].filesize'),
    mimeType: optionalString(raw.mimeType, 'tokenMetadata.assets[].mimeType'),
    width: optionalNumber(raw.width, 'tokenMetadata.assets[].width'),
    height: optionalNumber(raw.height, 'tokenMetadata.assets[].height'),
    updatedAt: optionalString(raw.updatedAt, 'tokenMetadata.assets[].updatedAt')
  };
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredObject(value: unknown, path: string): Record<string, unknown> {
  return asObject(value, path);
}

function optionalObject(value: unknown, path: string): Record<string, unknown> | undefined {
  return value == null ? undefined : asObject(value, path);
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${path} must be a string`);
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  return value == null ? undefined : requiredString(value, path);
}

function optionalNonEmptyString(value: unknown, path: string): string | undefined {
  const stringValue = optionalString(value, path);
  return stringValue === '' ? undefined : stringValue;
}

function requiredStringUnion<const Value extends string>(
  value: unknown,
  path: string,
  allowed: readonly Value[]
): Value {
  const stringValue = requiredString(value, path);
  if (!allowed.includes(stringValue as Value)) {
    throw new TypeError(`${path} must be one of ${allowed.join(', ')}`);
  }
  return stringValue as Value;
}

function requiredNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number`);
  }
  return value;
}

function optionalNumber(value: unknown, path: string): number | undefined {
  return value == null ? undefined : requiredNumber(value, path);
}

function requiredBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${path} must be a boolean`);
  }
  return value;
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  return value == null ? undefined : requiredBoolean(value, path);
}

function requiredArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be an array`);
  }
  return value;
}

function optionalArrayOrUndefined(value: unknown, path: string): unknown[] | undefined {
  if (value == null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be an array`);
  }
  return value;
}

function requiredStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new TypeError(`${path} must be an array of strings`);
  }
  return value;
}

function optionalStringArray(value: unknown, path: string): string[] | undefined {
  return value == null ? undefined : requiredStringArray(value, path);
}

function requiredObjectArray(value: unknown, path: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be an array`);
  }
  return value.map((item, index) => asObject(item, `${path}[${index}]`));
}

function responseErrorMessage(
  payload: unknown,
  operation: IndexerOperation,
  status: number
): string {
  const message = gatewayErrorMessage(payload);
  if (message) {
    return message;
  }
  return `${operation} failed with HTTP ${status}`;
}

function parseJsonOrText(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function indexerRequestFailure(error: unknown): OMSWalletUpstreamError {
  const status = numberField(error, 'status');
  return {
    service: 'indexer',
    name: error instanceof Error ? error.name : stringField(error, 'name'),
    code: numberOrStringField(error, 'code'),
    message: errorMessage(error),
    status
  };
}

function indexerResponseError(
  payload: unknown,
  status: number,
  fallbackMessage: string
): OMSWalletUpstreamError {
  return {
    service: 'indexer',
    name: stringField(payload, 'name') ?? stringField(payload, 'error'),
    code: numberOrStringField(payload, 'code'),
    message: gatewayErrorMessage(payload) ?? fallbackMessage,
    status
  };
}

function gatewayErrorMessage(payload: unknown): string | undefined {
  return (
    stringField(payload, 'message') ?? stringField(payload, 'cause') ?? stringField(payload, 'msg')
  );
}

function stringField(source: unknown, key: string): string | undefined {
  const value = objectField(source, key);
  return typeof value === 'string' ? value : undefined;
}

function numberField(source: unknown, key: string): number | undefined {
  const value = objectField(source, key);
  return typeof value === 'number' ? value : undefined;
}

function numberOrStringField(source: unknown, key: string): number | string | undefined {
  const value = objectField(source, key);
  return typeof value === 'number' || typeof value === 'string' ? value : undefined;
}

function objectField(source: unknown, key: string): unknown {
  return source && typeof source === 'object'
    ? (source as Record<string, unknown>)[key]
    : undefined;
}
