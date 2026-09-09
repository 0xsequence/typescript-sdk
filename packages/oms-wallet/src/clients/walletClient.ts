import type { ContractFunctionName, Abi, Address, EncodeFunctionDataParameters } from 'viem';

import { encodeFunctionData, isAddress } from 'viem';

import type { CredentialSigner, CredentialSigningAlgorithm } from '../credentialSigner.js';
import type {
  CommitVerifierRequest,
  CompleteAuthRequest,
  CompleteAuthResponse,
  CreateWalletRequest,
  UseWalletRequest,
  ListAccessRequest,
  ListWalletsRequest,
  RevokeAccessRequest,
  AuthorizeRemoteAccessRequest,
  SignMessageRequest,
  SignTypedDataRequest,
  GetIDTokenRequest,
  IsValidMessageSignatureRequest,
  IsValidTypedDataSignatureRequest,
  PrepareEthereumTransactionRequest,
  PrepareEthereumContractCallRequest,
  PrepareSolanaTransferRequest,
  ExecuteRequest,
  ExecuteResponse,
  TransactionStatusRequest,
  PrepareResponse,
  Fetch,
  CredentialInfo,
  CredentialMetadata,
  HPKEPayload,
  FeeOption as GeneratedFeeOption,
  KeyOrigin as GeneratedKeyOrigin
} from '../generated/waas.gen.js';
import type { Network, SolanaNetwork } from '../networks.js';
import type { ResolvedOidcProviderConfig } from '../oidc.js';
import type { OMSWalletEnvironment } from '../omsEnvironment.js';
import type { StorageManager } from '../storageManager.js';
import type {
  AccessGrant,
  AccessGrantPage,
  AuthorizeRemoteAccessParams,
  AuthorizedRemoteAccess,
  ListAccessParams,
  RemoteCredentialMetadata,
  RevokeAccessParams,
  RemoteAccessSession,
  SmartSessionGrantUsage,
  WalletCredential
} from '../types/accessGrant.js';
import type {
  FeeOptionSelector,
  FeeOptionWithBalance,
  SendContractTransactionParams,
  SendDataTransactionParams,
  SendNativeTransactionParams,
  SendSolanaTransferParams,
  SendTransactionParams,
  SendTransactionResponse,
  TransactionStatusPollingOptions
} from '../types/transactionTypes.js';
import type {
  AbiArg,
  OidcAuthMode,
  FeeOption,
  FeeOptionSelection,
  TransactionStatusResponse,
  WalletImportCipherSuite
} from '../types/waas.js';
import type {
  AutomaticWalletSelectionParams,
  CompleteEmailAuthParams,
  CompleteEmailAuthResult,
  CompleteOidcIdTokenAuthResult,
  CompleteOidcRedirectAuthParams,
  CompleteOidcRedirectAuthResult,
  CompleteWalletAuthResult,
  GetIdTokenParams,
  IsValidMessageSignatureParams,
  IsValidSolanaMessageSignatureParams,
  IsValidTypedDataSignatureParams,
  ImportEncryptedWalletParams,
  ImportWalletParams,
  ManualWalletSelectionParams,
  OMSWalletClient,
  OMSWalletEmailSessionAuth,
  OMSWalletOidcSessionAuth,
  OMSWalletOidcSessionAuthFlow,
  OMSWalletSessionAuth,
  OMSWalletSessionExpiredEvent,
  OMSWalletSessionExpiredListener,
  OMSWalletSessionState,
  PendingWalletSelection,
  SignInWithOidcIdTokenParams,
  SignInWithOidcRedirectParams,
  SignMessageParams,
  SignSolanaMessageParams,
  SignTypedDataParams,
  StartEmailAuthParams,
  StartOidcRedirectAuthParams,
  StartOidcRedirectAuthResult,
  WalletAccount,
  WalletActivationResult,
  WalletImportRecipientKey,
  WalletSelectionBehavior
} from '../wallet.js';
import type { TokenBalance } from './indexerClient.js';

import { createAttestedFetch } from '../attestation.js';
import { WebCryptoP256CredentialSigner } from '../credentialSigner.js';
import {
  OMSWalletSessionError,
  OMSWalletStorageError,
  OMSWalletTransactionError,
  OMSWalletSelectionError,
  toOMSWalletError
} from '../errors.js';
import {
  Waas as WaasClient,
  WaasPublic as WaasPublicClient,
  IdentityType,
  AuthMode as GeneratedAuthMode,
  NetworkFamily as GeneratedNetworkFamily,
  CredentialType,
  KeyFormat as GeneratedKeyFormat,
  TransportPurpose as GeneratedTransportPurpose
} from '../generated/waas.gen.js';
import { isOmsRelayOidcProvider, resolveOidcProviderConfig } from '../oidc.js';
import { WalletOperation } from '../operations.js';
import { createSignedFetch } from '../signedFetch.js';
import { createDefaultStorage, SessionStorageManager } from '../storageManager.js';
import { feeOptionSelection } from '../types/transactionTypes.js';
import {
  AuthMode,
  TransactionMode,
  TransactionStatus,
  WalletImportCipherSuite as WalletImportCipherSuiteValues,
  WalletType
} from '../types/waas.js';
import {
  fromGeneratedRemoteAccessSession,
  fromGeneratedSmartSessionGrant,
  fromGeneratedSmartSessionGrantUsages,
  toGeneratedSmartSessionGrant
} from '../utils/accessGrant.js';
import { Constants } from '../utils/constants.js';
import { oidcIdTokenExpiresAtEpochSeconds, oidcIdTokenHandleHash } from '../utils/oidcIdToken.js';
import {
  buildOidcAuthorizationUrl,
  cleanOidcCallbackUrl,
  decodeOidcState,
  encodeOidcState,
  generateOidcNonce,
  matchesRedirectUri,
  parseOidcCallbackUrl,
  redirectUriFromCurrentUrl
} from '../utils/oidcRedirect.js';
import { RequestUtils } from '../utils/requestUtils.js';
import {
  fromGeneratedFeeOption,
  fromGeneratedNetworkFamily,
  fromGeneratedTransactionStatus,
  fromGeneratedTransactionStatusResponse,
  fromGeneratedWalletKeyOrigin,
  toGeneratedAuthMode,
  toGeneratedFeeOptionSelection,
  toGeneratedNetworkFamily,
  toGeneratedTransactionMode,
  toGeneratedWalletImportCipherSuite
} from '../utils/waasTypes.js';
import {
  requireBase64,
  sealWalletImportPrivateKey,
  validateWalletImportReference,
  walletImportPlaintext
} from '../walletImport.js';
import { IndexerClient } from './indexerClient.js';

interface PendingOidcRedirectAuth {
  verifier: string;
  nonce: string;
  authMode: OidcAuthMode;
  provider?: string;
  providerLabel?: string;
  walletType: WalletType;
  walletSelection?: WalletSelectionBehavior;
  sessionLifetimeSeconds?: number;
  signerCredentialId: string;
  signerKeyType: CredentialSigningAlgorithm;
  expectedCallbackUri: string;
  issuer: string;
  projectId: string;
  consumed?: boolean;
}

interface WalletSessionMetadata {
  expiresAt: string;
  auth: OMSWalletSessionAuth;
  signerCredentialId: string;
  signerKeyType: CredentialSigningAlgorithm;
}

interface StoredSessionSnapshot {
  serializedRecord: string;
  session: OMSWalletSessionState;
}

interface StoredSessionRecord {
  version: 1;
  scope: {
    projectId: string;
    walletApiUrl: string;
    indexerGatewayUrl: string;
  };
  walletId: string;
  walletAddress: string;
  expiresAt: string;
  auth: OMSWalletSessionAuth;
  signerCredentialId: string;
  signerKeyType: CredentialSigningAlgorithm;
}

interface LoadedSessionRecord {
  record: StoredSessionRecord;
  serialized: string;
}

interface PolledTransactionStatus {
  response: TransactionStatusResponse;
  resolution: 'resolved' | 'timed-out';
}

interface ActivePendingWalletSelection {
  id: string;
  signerCredentialId: string;
  signerKeyType: CredentialSigningAlgorithm;
  walletType: WalletType;
  metadata: WalletSessionMetadata;
}

interface ActiveWalletActivationContext {
  walletId: string;
  metadata: WalletSessionMetadata;
}

type WalletImportActivationContext =
  | {
      type: 'active';
      walletId: string;
      metadata: WalletSessionMetadata;
    }
  | {
      type: 'pending';
      selectionId: string;
      walletType: WalletType;
      metadata: WalletSessionMetadata;
    };

interface WalletAuthCommitGuard {
  validate(): void;
}

interface EmailAuthCompletionParams {
  code: string;
  walletType: WalletType;
  walletSelection: WalletSelectionBehavior;
}

interface ActiveEmailAuthAttempt {
  email: string;
  verifier: string;
  challenge: string;
  sessionLifetimeSeconds: number;
  completion?: {
    params: EmailAuthCompletionParams;
    promise: Promise<CompleteEmailAuthResult | PendingWalletSelection>;
  };
}

class PendingWalletSelectionImpl implements PendingWalletSelection {
  private readonly availableWalletIds: Set<string>;
  private inFlight = false;

  constructor(
    public readonly walletType: WalletType,
    public readonly wallets: ReadonlyArray<WalletAccount>,
    public readonly credential: Readonly<WalletCredential>,
    private readonly selectWalletAction: (walletId: string) => Promise<WalletActivationResult>,
    private readonly createAndSelectWalletAction: (
      reference?: string
    ) => Promise<WalletActivationResult>
  ) {
    this.availableWalletIds = new Set(wallets.map((wallet) => wallet.id));
  }

  async selectWallet(params: { walletId: string }): Promise<WalletActivationResult> {
    return this.runExclusive(WalletOperation.pendingWalletSelectionSelectWallet, async () => {
      if (!this.availableWalletIds.has(params.walletId)) {
        throw new OMSWalletSelectionError({
          code: 'OMS_WALLET_SELECTION_UNAVAILABLE',
          operation: WalletOperation.pendingWalletSelectionSelectWallet,
          message: 'Selected wallet is not one of the available options'
        });
      }
      return this.selectWalletAction(params.walletId);
    });
  }

  async createAndSelectWallet(
    params: { reference?: string } = {}
  ): Promise<WalletActivationResult> {
    return this.runExclusive(WalletOperation.pendingWalletSelectionCreateAndSelectWallet, () =>
      this.createAndSelectWalletAction(params.reference)
    );
  }

  private async runExclusive<T>(operation: WalletOperation, action: () => Promise<T>): Promise<T> {
    if (this.inFlight) {
      throw new OMSWalletSelectionError({
        code: 'OMS_WALLET_SELECTION_IN_FLIGHT',
        operation,
        message: 'Pending wallet selection already has an action in flight'
      });
    }

    this.inFlight = true;
    try {
      return await action();
    } catch (error) {
      throw toOMSWalletError(error, operation);
    } finally {
      this.inFlight = false;
    }
  }
}

export class WalletClient implements OMSWalletClient {
  private readonly client: WaasClient;
  private readonly walletImportClient?: WaasClient;
  private readonly publicClient: WaasPublicClient;
  private readonly storage: StorageManager;
  private readonly redirectAuthStorage?: StorageManager;
  private readonly credentialSigner: CredentialSigner;
  private readonly indexerClient: IndexerClient;
  private readonly environment: OMSWalletEnvironment;
  private readonly projectId: string;
  private readonly sessionExpiredListeners = new Set<OMSWalletSessionExpiredListener>();
  private readonly fastTransactionStatusPollIntervalMs = 400;
  private readonly fastTransactionStatusPollCount = 5;
  private readonly transactionStatusPollIntervalMs = 2_000;
  private readonly transactionStatusPollTimeoutMs = 60_000;

  private activeWalletAddress: string | undefined;
  private sessionExpiresAt: string | undefined;
  private sessionAuth: OMSWalletSessionAuth | undefined;
  private sessionSignerCredentialId: string | undefined;
  private sessionSignerKeyType: CredentialSigningAlgorithm | undefined;
  private activePendingWalletSelection: ActivePendingWalletSelection | undefined;
  private activeEmailAuthAttempt: ActiveEmailAuthAttempt | undefined;
  private nextPendingWalletSelectionId = 1;
  private sessionExpiryTimer: ReturnType<typeof setTimeout> | undefined;
  private latestSessionExpiredEvent: OMSWalletSessionExpiredEvent | undefined;
  private sessionRevision = 0;
  private dispatchingSessionExpiredEvent = false;

  private walletId: string;

  constructor(params: {
    publishableKey: string;
    projectId: string;
    environment: OMSWalletEnvironment;
    storage?: StorageManager;
    redirectAuthStorage?: StorageManager;
    credentialSigner?: CredentialSigner;
    walletImportTrustedPcr0s?: ReadonlyArray<string>;
  }) {
    this.environment = params.environment;
    this.storage = params.storage ?? createDefaultStorage();
    this.redirectAuthStorage = params.redirectAuthStorage ?? defaultRedirectAuthStorage();
    this.credentialSigner = params.credentialSigner ?? new WebCryptoP256CredentialSigner();
    this.projectId = params.projectId;

    const storedSession = this.loadStoredSessionRecord();

    if (storedSession) {
      const { record } = storedSession;
      const restoredSession = {
        walletAddress: record.walletAddress,
        expiresAt: record.expiresAt,
        auth: record.auth
      };

      if (this.isSessionExpired(restoredSession)) {
        this.walletId = '';
        this.activeWalletAddress = undefined;
        this.sessionExpiresAt = undefined;
        this.sessionAuth = undefined;
        this.scheduleStoredSessionExpiryNotification({
          serializedRecord: storedSession.serialized,
          session: restoredSession
        });
      } else {
        this.walletId = record.walletId;
        this.activeWalletAddress = restoredSession.walletAddress;
        this.sessionExpiresAt = restoredSession.expiresAt;
        this.sessionAuth = restoredSession.auth;
        this.sessionSignerCredentialId = record.signerCredentialId;
        this.sessionSignerKeyType = record.signerKeyType;
        this.scheduleSessionExpiry(restoredSession);
      }
    } else {
      this.walletId = '';
      this.activeWalletAddress = undefined;
      this.sessionExpiresAt = undefined;
      this.sessionAuth = undefined;
      this.sessionSignerCredentialId = undefined;
      this.sessionSignerKeyType = undefined;
    }

    const signedFetch = createSignedFetch(
      params.publishableKey,
      this.credentialSigner,
      this.projectId
    );
    this.client = new WaasClient(params.environment.walletApiUrl, signedFetch);
    this.walletImportClient = params.walletImportTrustedPcr0s
      ? new WaasClient(
          params.environment.walletApiUrl,
          createAttestedFetch(signedFetch, params.walletImportTrustedPcr0s)
        )
      : undefined;
    this.publicClient = new WaasPublicClient(
      params.environment.walletApiUrl,
      createApiKeyFetch(params.publishableKey)
    );
    this.indexerClient = new IndexerClient({
      publishableKey: params.publishableKey,
      environment: params.environment
    });
  }

  /** The on-chain address of this wallet. Undefined until auth completes or a session is restored. */
  get walletAddress(): string | undefined {
    return this.activeWalletAddress;
  }

  /** Durable metadata for the completed wallet session. */
  get session(): OMSWalletSessionState {
    if (!this.activeWalletAddress) {
      return {
        walletAddress: undefined,
        expiresAt: undefined,
        auth: undefined
      };
    }

    return {
      walletAddress: this.activeWalletAddress,
      expiresAt: this.sessionExpiresAt,
      auth: cloneSessionAuth(this.sessionAuth)
    };
  }

  onSessionExpired(listener: OMSWalletSessionExpiredListener): () => void {
    this.sessionExpiredListeners.add(listener);

    if (this.latestSessionExpiredEvent && !this.dispatchingSessionExpiredEvent) {
      this.callSessionExpiredListener(
        listener,
        cloneSessionExpiredEvent(this.latestSessionExpiredEvent)
      );
    }

    return () => {
      this.sessionExpiredListeners.delete(listener);
    };
  }

  /**
   * Initiates email-based OTP authentication by sending a one-time code to the given address.
   *
   * After this resolves, show your OTP entry UI and pass the code to `completeEmailAuth`.
   */
  async startEmailAuth(params: StartEmailAuthParams): Promise<void> {
    return this.runOperation(WalletOperation.startEmailAuth, async () => {
      const sessionLifetimeSeconds = this.sessionLifetimeSeconds(
        params.sessionLifetimeSeconds,
        WalletOperation.startEmailAuth
      );
      await this.clearSession({ operation: WalletOperation.startEmailAuth });
      const request: CommitVerifierRequest = {
        identityType: IdentityType.Email,
        authMode: GeneratedAuthMode.OTP,
        metadata: {},
        handle: params.email
      };
      const response = await this.client.commitVerifier(request);
      this.activeEmailAuthAttempt = {
        email: params.email,
        verifier: response.verifier,
        challenge: response.challenge,
        sessionLifetimeSeconds
      };
    });
  }

  /**
   * Completes the email OTP flow by verifying the code the user received.
   *
   * Must be called after `startEmailAuth`. On success, this activates an
   * existing wallet or creates a new one and returns the wallet address plus
   * the credential added by WaaS.
   */
  async completeEmailAuth(
    params: ManualWalletSelectionParams<CompleteEmailAuthParams>
  ): Promise<PendingWalletSelection>;
  async completeEmailAuth(
    params: AutomaticWalletSelectionParams<CompleteEmailAuthParams>
  ): Promise<CompleteEmailAuthResult>;
  async completeEmailAuth(
    params: CompleteEmailAuthParams
  ): Promise<CompleteEmailAuthResult | PendingWalletSelection>;
  async completeEmailAuth(
    params: CompleteEmailAuthParams
  ): Promise<CompleteEmailAuthResult | PendingWalletSelection> {
    return this.runOperation(WalletOperation.completeEmailAuth, async () => {
      const completionParams: EmailAuthCompletionParams = {
        code: params.code,
        walletType: params.walletType ?? WalletType.Ethereum,
        walletSelection: params.walletSelection ?? 'automatic'
      };
      const attempt = this.currentEmailAuthAttempt(WalletOperation.completeEmailAuth);
      const completion = attempt.completion;
      if (completion) {
        if (!sameEmailAuthCompletionParams(completion.params, completionParams)) {
          throw new OMSWalletSessionError({
            operation: WalletOperation.completeEmailAuth,
            message: 'Email auth completion is already in flight'
          });
        }
        return completion.promise;
      }

      const promise: Promise<CompleteEmailAuthResult | PendingWalletSelection> =
        this.completeEmailAuthAttempt(attempt, completionParams).catch((error) => {
          const sdkError = toOMSWalletError(error, WalletOperation.completeEmailAuth);
          if (this.activeEmailAuthAttempt === attempt && attempt.completion?.promise === promise) {
            if (sdkError.code === 'OMS_AUTH_COMMITMENT_CONSUMED') {
              this.activeEmailAuthAttempt = undefined;
            } else {
              attempt.completion = undefined;
            }
          }
          throw sdkError;
        });
      attempt.completion = { params: completionParams, promise };
      return promise;
    });
  }

  /**
   * Signs in with an app-provided OIDC ID token.
   *
   * The application is responsible for obtaining the provider ID token and passing
   * the issuer and audience used to mint it. The SDK completes WaaS ID-token auth
   * and then activates an existing wallet or creates one.
   */
  async signInWithOidcIdToken(
    params: ManualWalletSelectionParams<SignInWithOidcIdTokenParams>
  ): Promise<PendingWalletSelection>;
  async signInWithOidcIdToken(
    params: AutomaticWalletSelectionParams<SignInWithOidcIdTokenParams>
  ): Promise<CompleteOidcIdTokenAuthResult>;
  async signInWithOidcIdToken(
    params: SignInWithOidcIdTokenParams
  ): Promise<CompleteOidcIdTokenAuthResult | PendingWalletSelection>;
  async signInWithOidcIdToken(
    params: SignInWithOidcIdTokenParams
  ): Promise<CompleteOidcIdTokenAuthResult | PendingWalletSelection> {
    return this.runOperation(WalletOperation.signInWithOidcIdToken, async () => {
      await this.clearSession({ operation: WalletOperation.signInWithOidcIdToken });
      const authRevision = this.sessionRevision;
      const sessionLifetimeSeconds = this.sessionLifetimeSeconds(
        params.sessionLifetimeSeconds,
        WalletOperation.signInWithOidcIdToken
      );

      const idTokenExpiresAt = oidcIdTokenExpiresAtEpochSeconds(params.idToken);
      const request: CommitVerifierRequest = {
        identityType: IdentityType.OIDC,
        authMode: GeneratedAuthMode.IDToken,
        metadata: {
          iss: params.issuer,
          aud: params.audience,
          exp: idTokenExpiresAt.toString()
        },
        handle: await oidcIdTokenHandleHash(params.idToken)
      };
      const commitment = await this.client.commitVerifier(request);
      const completeRequest: CompleteAuthRequest = {
        identityType: IdentityType.OIDC,
        authMode: GeneratedAuthMode.IDToken,
        verifier: commitment.verifier,
        answer: params.idToken,
        lifetime: sessionLifetimeSeconds
      };
      const response = await this.client.completeAuth(completeRequest);
      return this.completeWalletAuth(
        response,
        params.walletType ?? WalletType.Ethereum,
        params.walletSelection ?? 'automatic',
        this.oidcIdTokenSessionAuthFromParams(params, response),
        WalletOperation.signInWithOidcIdToken,
        {
          validate: () =>
            this.requireCurrentSessionRevision(authRevision, WalletOperation.signInWithOidcIdToken)
        }
      );
    });
  }

  /**
   * Starts an OIDC authorization-code redirect flow and returns the provider URL.
   *
   * Store or navigate to the returned `url`, then call `completeOidcRedirectAuth`
   * after the provider redirects back to your application.
   */
  async startOidcRedirectAuth(
    params: StartOidcRedirectAuthParams
  ): Promise<StartOidcRedirectAuthResult> {
    return this.runOperation(WalletOperation.startOidcRedirectAuth, async () => {
      const previousSession = this.session;
      const redirectAuthStorage = this.requireRedirectAuthStorage();
      const providerValue = params.provider;
      const provider = resolveOidcProviderConfig(providerValue);
      const isOmsRelayProvider = isOmsRelayOidcProvider(providerValue);
      if (isOmsRelayProvider && params.authorizeParams !== undefined) {
        throw new Error('OMS relay OIDC authorization parameters are fixed by the SDK');
      }
      const authMode = this.resolveOidcAuthMode(provider);
      const sessionLifetimeSeconds =
        params.sessionLifetimeSeconds === undefined
          ? undefined
          : this.sessionLifetimeSeconds(
              params.sessionLifetimeSeconds,
              WalletOperation.startOidcRedirectAuth
            );
      const providerRedirectUri = isOmsRelayProvider
        ? this.derivedOmsRelayRedirectUri(providerValue.provider)
        : providerValue.providerRedirectUri;
      if (!providerRedirectUri) {
        throw new Error('OIDC provider requires providerRedirectUri');
      }
      if (!isOmsRelayProvider && params.omsRelayReturnUri !== undefined) {
        throw new Error(
          'omsRelayReturnUri is only supported for SDK built-in Google and Apple OIDC providers'
        );
      }
      const omsRelayReturnUri =
        params.omsRelayReturnUri ??
        (isOmsRelayProvider
          ? redirectUriFromCurrentUrl(
              this.browserCurrentUrl('startOidcRedirectAuth', 'omsRelayReturnUri')
            )
          : undefined);
      const expectedCallbackUri = omsRelayReturnUri ?? providerRedirectUri;

      await this.clearSession({ operation: WalletOperation.startOidcRedirectAuth });
      const authRevision = this.sessionRevision;

      const request: CommitVerifierRequest = {
        identityType: IdentityType.OIDC,
        authMode: toGeneratedAuthMode(authMode),
        metadata: {
          iss: provider.issuer,
          aud: provider.clientId,
          redirect_uri: providerRedirectUri
        }
      };
      const response = await this.client.commitVerifier(request);
      const signerCredentialId = await this.credentialSigner.credentialId();
      this.requireCurrentSessionRevision(authRevision, WalletOperation.startOidcRedirectAuth);
      const nonce = generateOidcNonce();
      const state = encodeOidcState({
        nonce,
        scope: this.projectId,
        ...(omsRelayReturnUri ? { redirect_uri: omsRelayReturnUri } : {})
      });

      const pending: PendingOidcRedirectAuth = {
        verifier: response.verifier,
        nonce,
        authMode,
        provider: this.sessionProviderFromOidcProvider(provider),
        providerLabel: this.sessionProviderLabelFromOidcProvider(provider),
        walletType: params.walletType ?? WalletType.Ethereum,
        walletSelection: params.walletSelection,
        sessionLifetimeSeconds,
        signerCredentialId,
        signerKeyType: this.credentialSigner.signingAlgorithm,
        expectedCallbackUri,
        issuer: provider.issuer,
        projectId: this.projectId
      };
      this.savePendingOidcRedirectAuth(redirectAuthStorage, pending);

      const authorizeParams = isOmsRelayProvider
        ? provider.authorizeParams
        : {
            ...provider.authorizeParams,
            ...params.authorizeParams
          };
      const url = buildOidcAuthorizationUrl({
        authorizationUrl: provider.authorizationUrl,
        clientId: provider.clientId,
        redirectUri: providerRedirectUri,
        scopes: this.resolveOidcScopes(provider),
        state,
        challenge: response.challenge,
        usePkce: authMode === AuthMode.AuthCodePKCE,
        authorizeParams,
        loginHint: this.loginHintForProvider(
          provider,
          params.loginHint ?? previousSession.auth?.email
        )
      });
      this.requireCurrentSessionRevision(authRevision, WalletOperation.startOidcRedirectAuth);

      return {
        authorizationUrl: url
      };
    });
  }

  /**
   * Completes an OIDC authorization-code redirect flow.
   *
   * This validates the state nonce persisted by `startOidcRedirectAuth`, completes
   * WaaS auth, and activates an existing wallet or creates a new one.
   */
  async completeOidcRedirectAuth(): Promise<
    CompleteOidcRedirectAuthResult | PendingWalletSelection | void
  >;
  async completeOidcRedirectAuth(
    params: ManualWalletSelectionParams<CompleteOidcRedirectAuthParams>
  ): Promise<PendingWalletSelection | void>;
  async completeOidcRedirectAuth(
    params: AutomaticWalletSelectionParams<CompleteOidcRedirectAuthParams>
  ): Promise<CompleteOidcRedirectAuthResult | void>;
  async completeOidcRedirectAuth(
    params: CompleteOidcRedirectAuthParams
  ): Promise<CompleteOidcRedirectAuthResult | PendingWalletSelection | void>;
  async completeOidcRedirectAuth(
    params: CompleteOidcRedirectAuthParams = {}
  ): Promise<CompleteOidcRedirectAuthResult | PendingWalletSelection | void> {
    return this.runOperation(WalletOperation.completeOidcRedirectAuth, async () => {
      const callbackUrl =
        params.callbackUrl ?? this.browserCurrentUrl('completeOidcRedirectAuth', 'callbackUrl');
      const callback = parseOidcCallbackUrl(callbackUrl);
      const hasCallbackParams = !!(callback.code || callback.state || callback.error);

      if (!hasCallbackParams && params.callbackUrl === undefined) {
        return undefined;
      }

      const redirectAuthStorage = this.requireRedirectAuthStorage();
      let shouldClearPendingRedirectAuth = false;

      try {
        if (!callback.state || (!callback.code && !callback.error)) {
          throw new Error('OIDC callback URL is missing code or state');
        }

        const pending = this.loadPendingOidcRedirectAuth(redirectAuthStorage);
        this.validateOidcState(callback.state, pending);
        if (!matchesRedirectUri(callbackUrl, pending.expectedCallbackUri)) {
          return undefined;
        }
        if (pending.consumed) {
          throw new Error('No pending OIDC redirect auth found');
        }
        this.markPendingOidcRedirectAuthConsumed(redirectAuthStorage, pending);
        shouldClearPendingRedirectAuth = true;

        if (params.cleanUrl ?? params.callbackUrl === undefined) {
          this.replaceOidcCallbackUrl(callbackUrl, params.replaceUrl);
        }

        if (callback.error) {
          throw new Error(
            callback.errorDescription || `OIDC provider returned error: ${callback.error}`
          );
        }
        if (!callback.code) {
          throw new Error('OIDC callback URL is missing code or state');
        }

        await this.validatePendingOidcRedirectSigner(
          pending,
          WalletOperation.completeOidcRedirectAuth
        );
        const walletSelection = params.walletSelection ?? pending.walletSelection ?? 'automatic';
        const sessionLifetimeSeconds = this.sessionLifetimeSeconds(
          params.sessionLifetimeSeconds ?? pending.sessionLifetimeSeconds,
          WalletOperation.completeOidcRedirectAuth
        );
        const authRevision = this.sessionRevision;

        const request: CompleteAuthRequest = {
          identityType: IdentityType.OIDC,
          authMode: toGeneratedAuthMode(pending.authMode),
          verifier: pending.verifier,
          answer: callback.code,
          lifetime: sessionLifetimeSeconds
        };
        const response = await this.client.completeAuth(request);
        const result = await this.completeWalletAuth(
          response,
          pending.walletType,
          walletSelection,
          this.oidcRedirectSessionAuthFromPending(pending, response),
          WalletOperation.completeOidcRedirectAuth,
          {
            validate: () =>
              this.requireCurrentSessionRevision(
                authRevision,
                WalletOperation.completeOidcRedirectAuth
              )
          }
        );

        if (walletSelection === 'automatic' && !this.activeWalletAddress) {
          throw new Error('OIDC auth completed without an active wallet');
        }

        return result;
      } finally {
        if (shouldClearPendingRedirectAuth) {
          try {
            this.clearPendingOidcRedirectAuth();
          } catch {
            // Auth result and primary failure take precedence over best-effort pending-state cleanup.
          }
        }
      }
    });
  }

  /**
   * Browser convenience wrapper that starts an OIDC redirect and navigates to the provider.
   */
  async signInWithOidcRedirect(params: SignInWithOidcRedirectParams): Promise<void> {
    return this.runOperation(WalletOperation.signInWithOidcRedirect, async () => {
      let result: StartOidcRedirectAuthResult;
      const isOmsRelayProvider = isOmsRelayOidcProvider(params.provider);
      if (isOmsRelayProvider && params.authorizeParams !== undefined) {
        throw new Error('OMS relay OIDC authorization parameters are fixed by the SDK');
      }
      if (!isOmsRelayProvider && params.omsRelayReturnUri !== undefined) {
        throw new Error(
          'omsRelayReturnUri is only supported for SDK built-in Google and Apple OIDC providers'
        );
      }
      if (isOmsRelayOidcProvider(params.provider)) {
        const omsRelayReturnUri =
          params.omsRelayReturnUri ??
          redirectUriFromCurrentUrl(
            params.currentUrl ?? this.browserCurrentUrl('signInWithOidcRedirect', 'currentUrl')
          );
        result = await this.startOidcRedirectAuth({
          provider: params.provider,
          omsRelayReturnUri,
          walletType: params.walletType,
          walletSelection: params.walletSelection,
          sessionLifetimeSeconds: params.sessionLifetimeSeconds,
          loginHint: params.loginHint
        });
      } else {
        result = await this.startOidcRedirectAuth({
          provider: params.provider,
          walletType: params.walletType,
          walletSelection: params.walletSelection,
          sessionLifetimeSeconds: params.sessionLifetimeSeconds,
          authorizeParams: params.authorizeParams,
          loginHint: params.loginHint
        });
      }
      const assignUrl = params.assignUrl ?? this.browserAssignUrl();
      assignUrl(result.authorizationUrl);
    });
  }

  async signOut(): Promise<void> {
    return this.runOperation(WalletOperation.signOut, () =>
      this.clearSession({ operation: WalletOperation.signOut })
    );
  }

  async listWallets(): Promise<Array<WalletAccount>> {
    return this.runOperation(WalletOperation.listWallets, async () => {
      await this.requireWalletSelectionOrActiveSession(WalletOperation.listWallets);
      return this.listAllWallets();
    });
  }

  async useWallet(params: { walletId: string }): Promise<WalletActivationResult> {
    return this.runOperation(WalletOperation.useWallet, async () => {
      const context = await this.activeWalletActivationContext(WalletOperation.useWallet);
      const wallet = await this.requestUseWallet(params.walletId);
      await this.requireActiveWalletActivationContextStillActive(
        context,
        WalletOperation.useWallet
      );
      return this.activateWallet(wallet, context.metadata, WalletOperation.useWallet);
    });
  }

  async createWallet(
    params: { type?: WalletType; reference?: string } = {}
  ): Promise<WalletActivationResult> {
    return this.runOperation(WalletOperation.createWallet, async () => {
      const context = await this.activeWalletActivationContext(WalletOperation.createWallet);
      const wallet = await this.requestCreateWallet(
        params.type ?? WalletType.Ethereum,
        params.reference
      );
      await this.requireActiveWalletActivationContextStillActive(
        context,
        WalletOperation.createWallet
      );
      return this.activateWallet(wallet, context.metadata, WalletOperation.createWallet);
    });
  }

  async importWallet(params: ImportWalletParams): Promise<WalletActivationResult> {
    return this.runOperation(WalletOperation.importWallet, async () => {
      const context = await this.walletImportActivationContext(
        params.type,
        WalletOperation.importWallet
      );
      const privateKey = walletImportPlaintext(params);
      const recipientKey = await this.getWalletImportRecipientKeyUnchecked(
        WalletImportCipherSuiteValues.P256Sha256Aes256Gcm,
        WalletOperation.importWallet
      );
      let encryptedKey: Awaited<ReturnType<typeof sealWalletImportPrivateKey>>;
      try {
        encryptedKey = await sealWalletImportPrivateKey(recipientKey.publicKey, privateKey);
      } finally {
        privateKey.fill(0);
      }
      const wallet = await this.requestImportWallet({
        type: params.type,
        reference: params.reference,
        keyMaterial: {
          keyId: recipientKey.keyId,
          cipherSuite: recipientKey.cipherSuite,
          ...encryptedKey
        }
      });
      await this.requireWalletImportActivationContextStillActive(
        context,
        WalletOperation.importWallet
      );
      return this.activateWallet(wallet, context.metadata, WalletOperation.importWallet);
    });
  }

  async getWalletImportRecipientKey(params: {
    cipherSuite: WalletImportCipherSuite;
  }): Promise<WalletImportRecipientKey> {
    return this.runOperation(WalletOperation.getWalletImportRecipientKey, () =>
      this.getWalletImportRecipientKeyUnchecked(
        params.cipherSuite,
        WalletOperation.getWalletImportRecipientKey
      )
    );
  }

  async importEncryptedWallet(
    params: ImportEncryptedWalletParams
  ): Promise<WalletActivationResult> {
    return this.runOperation(WalletOperation.importEncryptedWallet, async () => {
      const context = await this.walletImportActivationContext(
        params.type,
        WalletOperation.importEncryptedWallet
      );
      validateWalletImportReference(params.reference);
      const wallet = await this.requestImportWallet(params);
      await this.requireWalletImportActivationContextStillActive(
        context,
        WalletOperation.importEncryptedWallet
      );
      return this.activateWallet(wallet, context.metadata, WalletOperation.importEncryptedWallet);
    });
  }

  async getIdToken(params: GetIdTokenParams = {}): Promise<string> {
    return this.runOperation(WalletOperation.getIdToken, async () => {
      await this.requireActiveSession(WalletOperation.getIdToken);
      const request: GetIDTokenRequest = {
        walletId: this.walletId,
        ttlSeconds: params.ttlSeconds,
        customClaims: params.customClaims
      };
      const response = await this.client.getIDToken(request);
      return response.idToken;
    });
  }

  private async clearSession(
    options: {
      clearStorage?: boolean;
      operation?: WalletOperation;
    } = {}
  ): Promise<void> {
    this.sessionRevision += 1;
    const clearStorage = options.clearStorage ?? true;
    let storageFailure: unknown;
    if (clearStorage) {
      this.latestSessionExpiredEvent = undefined;
      try {
        this.storage.delete(Constants.sessionStorageKey);
      } catch (error) {
        storageFailure = error;
      }
      try {
        this.clearPendingOidcRedirectAuth();
      } catch (error) {
        storageFailure ??= error;
      }
    } else {
      try {
        this.clearPendingOidcRedirectAuth();
      } catch (error) {
        storageFailure = error;
      }
    }
    this.walletId = '';
    this.activeWalletAddress = undefined;
    this.sessionExpiresAt = undefined;
    this.sessionAuth = undefined;
    this.sessionSignerCredentialId = undefined;
    this.sessionSignerKeyType = undefined;
    this.activePendingWalletSelection = undefined;
    this.activeEmailAuthAttempt = undefined;
    this.clearSessionExpiryTimer();
    await this.credentialSigner.clear?.();
    if (storageFailure !== undefined) {
      throw new OMSWalletStorageError({
        operation: options.operation,
        message: 'Wallet session cleanup failed',
        cause: storageFailure
      });
    }
  }

  private clearPendingOidcRedirectAuth(): void {
    this.redirectAuthStorage?.delete(Constants.redirectAuthStorageKey);
  }

  async signMessage(params: SignMessageParams): Promise<string> {
    return this.runOperation(WalletOperation.signMessage, async () => {
      await this.requireActiveEthereumSession(WalletOperation.signMessage);
      const request: SignMessageRequest = {
        network: params.network.id.toString(),
        walletId: this.walletId,
        message: params.message
      };
      const response = await this.client.signMessage(request);
      return response.signature;
    });
  }

  async signSolanaMessage(params: SignSolanaMessageParams): Promise<string> {
    return this.runOperation(WalletOperation.signSolanaMessage, async () => {
      await this.requireActiveSolanaSession(WalletOperation.signSolanaMessage);
      const request: SignMessageRequest = {
        network: '',
        walletId: this.walletId,
        message: params.message
      };
      const response = await this.client.signMessage(request);
      return response.signature;
    });
  }

  async signTypedData(params: SignTypedDataParams): Promise<string> {
    return this.runOperation(WalletOperation.signTypedData, async () => {
      await this.requireActiveEthereumSession(WalletOperation.signTypedData);
      const request: SignTypedDataRequest = {
        network: params.network.id.toString(),
        walletId: this.walletId,
        typedData: normalizeJsonBigInts(params.typedData)
      };
      const response = await this.client.signTypedData(request);
      return response.signature;
    });
  }

  async isValidMessageSignature(params: IsValidMessageSignatureParams): Promise<boolean> {
    return this.runOperation(WalletOperation.isValidMessageSignature, async () => {
      const request: IsValidMessageSignatureRequest = {
        network: params.network?.id.toString(),
        networkFamily: GeneratedNetworkFamily.EVM,
        walletAddress: params.walletAddress,
        walletId: params.walletId ?? (params.walletAddress ? undefined : this.activeWalletId()),
        message: params.message,
        signature: params.signature
      };
      const response = await this.publicClient.isValidMessageSignature(request);
      return response.isValid;
    });
  }

  async isValidSolanaMessageSignature(
    params: IsValidSolanaMessageSignatureParams
  ): Promise<boolean> {
    return this.runOperation(WalletOperation.isValidSolanaMessageSignature, async () => {
      const request: IsValidMessageSignatureRequest = {
        networkFamily: GeneratedNetworkFamily.Solana,
        walletAddress: params.walletAddress,
        walletId: params.walletId ?? (params.walletAddress ? undefined : this.activeWalletId()),
        message: params.message,
        signature: params.signature
      };
      const response = await this.publicClient.isValidMessageSignature(request);
      return response.isValid;
    });
  }

  async isValidTypedDataSignature(params: IsValidTypedDataSignatureParams): Promise<boolean> {
    return this.runOperation(WalletOperation.isValidTypedDataSignature, async () => {
      const request: IsValidTypedDataSignatureRequest = {
        network: params.network?.id.toString(),
        walletAddress: params.walletAddress,
        walletId: params.walletId ?? (params.walletAddress ? undefined : this.activeWalletId()),
        typedData: normalizeJsonBigInts(params.typedData),
        signature: params.signature
      };
      const response = await this.publicClient.isValidTypedDataSignature(request);
      return response.isValid;
    });
  }

  async sendTransaction(params: SendNativeTransactionParams): Promise<SendTransactionResponse>;
  async sendTransaction(params: SendDataTransactionParams): Promise<SendTransactionResponse>;
  async sendTransaction<
    const abi extends Abi | readonly unknown[],
    functionName extends ContractFunctionName<abi> | undefined = ContractFunctionName<abi>
  >(params: SendContractTransactionParams<abi, functionName>): Promise<SendTransactionResponse>;
  async sendTransaction(params: SendTransactionParams): Promise<SendTransactionResponse> {
    return this.runOperation(WalletOperation.sendTransaction, async () => {
      await this.requireActiveEthereumSession(WalletOperation.sendTransaction);
      const data =
        'abi' in params ? encodeFunctionData(params as EncodeFunctionDataParameters) : params.data;

      const request: PrepareEthereumTransactionRequest = {
        network: params.network.id.toString(),
        walletId: this.walletId,
        to: params.to,
        value: (params.value ?? 0n).toString(),
        data,
        mode: toGeneratedTransactionMode(params.mode ?? TransactionMode.Relayer)
      };

      const prepared = await this.client.prepareEthereumTransaction(request);
      return this.executePreparedTransaction({
        prepared,
        network: params.network,
        selectFeeOption: params.selectFeeOption,
        waitForStatus: params.waitForStatus,
        statusPolling: params.statusPolling
      });
    });
  }

  async sendSolanaTransfer(params: SendSolanaTransferParams): Promise<SendTransactionResponse> {
    return this.runOperation(WalletOperation.sendSolanaTransfer, async () => {
      await this.requireActiveSolanaSession(WalletOperation.sendSolanaTransfer);
      const request: PrepareSolanaTransferRequest = {
        network: params.network,
        walletId: this.walletId,
        asset: params.asset,
        recipient: { address: params.to },
        amount: params.amount.toString(),
        mode: toGeneratedTransactionMode(params.mode ?? TransactionMode.Relayer)
      };

      const prepared = await this.client.prepareSolanaTransfer(request);
      return this.executePreparedTransaction({
        prepared,
        network: params.network,
        selectFeeOption: params.selectFeeOption,
        waitForStatus: params.waitForStatus,
        statusPolling: params.statusPolling
      });
    });
  }

  async callContract(params: {
    network: Network;
    contractAddress: Address;
    method: string;
    args?: Array<AbiArg>;
    mode?: TransactionMode;
    selectFeeOption?: FeeOptionSelector;
    waitForStatus?: boolean;
    statusPolling?: TransactionStatusPollingOptions;
  }): Promise<SendTransactionResponse> {
    return this.runOperation(WalletOperation.callContract, async () => {
      await this.requireActiveEthereumSession(WalletOperation.callContract);
      const request: PrepareEthereumContractCallRequest = {
        network: params.network.id.toString(),
        walletId: this.walletId,
        contract: params.contractAddress,
        method: params.method,
        args: params.args,
        mode: toGeneratedTransactionMode(params.mode ?? TransactionMode.Relayer)
      };

      const prepared = await this.client.prepareEthereumContractCall(request);
      return this.executePreparedTransaction({
        prepared,
        network: params.network,
        selectFeeOption: params.selectFeeOption,
        waitForStatus: params.waitForStatus,
        statusPolling: params.statusPolling
      });
    });
  }

  async getTransactionStatus(params: { txnId: string }): Promise<TransactionStatusResponse> {
    return this.runOperation(WalletOperation.getTransactionStatus, async () =>
      fromGeneratedTransactionStatusResponse(
        await this.client.transactionStatus({ txnId: params.txnId } as TransactionStatusRequest)
      )
    );
  }

  async inspectRemoteCredential(params: {
    credentialId: string;
  }): Promise<RemoteCredentialMetadata> {
    return this.runOperation(WalletOperation.inspectRemoteCredential, async () => {
      const response = await this.publicClient.inspectCredential({
        scope: this.projectId,
        credentialId: params.credentialId
      });
      return this.toRemoteCredentialMetadata(response.metadata);
    });
  }

  async authorizeRemoteAccess(
    params: AuthorizeRemoteAccessParams
  ): Promise<AuthorizedRemoteAccess> {
    return this.runOperation(WalletOperation.authorizeRemoteAccess, async () => {
      await this.requireActiveEthereumSession(WalletOperation.authorizeRemoteAccess);
      const walletId = this.walletId;
      const request: AuthorizeRemoteAccessRequest = {
        credentialId: params.credentialId,
        walletId,
        grants: { entries: params.grants.map(toGeneratedSmartSessionGrant) },
        expiry: params.expiresAt,
        chainId: params.network.id.toString(),
        sessionId: params.sessionId
      };
      const response = await this.client.authorizeRemoteAccess(request);
      await this.requireSameActiveWalletSession(walletId, WalletOperation.authorizeRemoteAccess);
      return {
        walletId,
        sessionId: response.sessionId,
        expiresAt: response.expiry
      };
    });
  }

  async listAccess(params: ListAccessParams = {}): Promise<AccessGrant[]> {
    return this.runOperation(WalletOperation.listAccess, async () => {
      const grants: AccessGrant[] = [];
      for await (const page of this.listAccessPagesUnchecked(params, WalletOperation.listAccess)) {
        grants.push(...page.grants);
      }
      return grants;
    });
  }

  async *listAccessPages(params: ListAccessParams = {}): AsyncIterable<AccessGrantPage> {
    try {
      yield* this.listAccessPagesUnchecked(params, WalletOperation.listAccessPages);
    } catch (error) {
      throw toOMSWalletError(error, WalletOperation.listAccessPages);
    }
  }

  async getRemoteAccessSession(params: { sessionId: string }): Promise<RemoteAccessSession> {
    return this.runOperation(WalletOperation.getRemoteAccessSession, async () => {
      await this.requireActiveSession(WalletOperation.getRemoteAccessSession);
      if (!params.sessionId.trim()) throw new Error('sessionId is required');
      const walletId = this.walletId;
      const response = await this.client.getSession({ sessionId: params.sessionId });
      await this.requireSameActiveWalletSession(walletId, WalletOperation.getRemoteAccessSession);
      const session = fromGeneratedRemoteAccessSession(response.session);
      if (session.walletId !== walletId) {
        throw new Error('Session does not belong to the active wallet');
      }
      return session;
    });
  }

  async getRemoteAccessSessionUsage(params: {
    sessionId: string;
    network: Network;
  }): Promise<SmartSessionGrantUsage[]> {
    return this.runOperation(WalletOperation.getRemoteAccessSessionUsage, async () => {
      await this.requireActiveSession(WalletOperation.getRemoteAccessSessionUsage);
      if (!params.sessionId.trim()) throw new Error('sessionId is required');
      const walletId = this.walletId;
      const response = await this.client.getSessionUsage({
        sessionId: params.sessionId,
        network: params.network.id.toString()
      });
      await this.requireSameActiveWalletSession(
        walletId,
        WalletOperation.getRemoteAccessSessionUsage
      );
      return fromGeneratedSmartSessionGrantUsages(response.entries);
    });
  }

  async revokeAccess(params: RevokeAccessParams): Promise<void> {
    return this.runOperation(WalletOperation.revokeAccess, async () => {
      await this.requireActiveSession(WalletOperation.revokeAccess);
      const request: RevokeAccessRequest = {
        targetCredentialId: params.credentialId,
        walletId: this.walletId,
        sessionId: params.sessionId
      };

      await this.client.revokeAccess(request);
    });
  }

  /**
   * Creates a new wallet of the requested type for the authenticated user.
   *
   * The wallet ID and address are persisted to storage so the session can be
   * restored when the configured credential signer is also available.
   */
  private async requestCreateWallet(type: WalletType, reference?: string): Promise<WalletAccount> {
    const params: CreateWalletRequest = {
      networkFamily: toGeneratedNetworkFamily(type),
      reference
    };
    const response = await this.client.createWallet(params);
    return this.toWalletAccount(response.wallet);
  }

  private async getWalletImportRecipientKeyUnchecked(
    cipherSuite: WalletImportCipherSuite,
    operation: WalletOperation
  ): Promise<WalletImportRecipientKey> {
    await this.requireWalletSelectionOrActiveSession(operation);
    const client = this.requireWalletImportClient();
    const response = await client.getRecipientKey({
      purpose: GeneratedTransportPurpose.WalletImport,
      suite: toGeneratedWalletImportCipherSuite(cipherSuite)
    });
    await this.requireWalletSelectionOrActiveSession(operation);
    if (!response.keyId.trim() || !response.publicKey.trim()) {
      throw new Error('Wallet import recipient-key response is incomplete');
    }
    return {
      keyId: response.keyId,
      cipherSuite,
      publicKey: requireBase64(response.publicKey, 'recipient publicKey')
    };
  }

  private async requestImportWallet(params: ImportEncryptedWalletParams): Promise<WalletAccount> {
    const client = this.requireWalletImportClient();
    if (!params.keyMaterial.keyId.trim()) throw new Error('keyMaterial.keyId is required');
    // Webrpc's TypeScript generator declares Go []byte fields as string arrays,
    // while the JSON transport encodes them as base64 strings.
    const keyMaterial = {
      keyId: params.keyMaterial.keyId,
      suite: toGeneratedWalletImportCipherSuite(params.keyMaterial.cipherSuite),
      encapsulatedKey: requireBase64(
        params.keyMaterial.encapsulatedKey,
        'keyMaterial.encapsulatedKey'
      ),
      ciphertext: requireBase64(params.keyMaterial.ciphertext, 'keyMaterial.ciphertext')
    } as unknown as HPKEPayload;
    const response = await client.importWallet({
      networkFamily: toGeneratedNetworkFamily(params.type),
      format: GeneratedKeyFormat.PrivateKey,
      keyMaterial,
      reference: params.reference
    });
    return this.toWalletAccount(response.wallet);
  }

  private requireWalletImportClient(): WaasClient {
    if (!this.walletImportClient) {
      throw new Error('Wallet import is unavailable for this WaaS environment');
    }
    return this.walletImportClient;
  }

  /**
   * Loads an existing wallet by its server-side ID.
   *
   * The wallet ID and address are persisted to storage.
   */
  private async requestUseWallet(walletId: string): Promise<WalletAccount> {
    const params: UseWalletRequest = { walletId };
    const response = await this.client.useWallet(params);
    return this.toWalletAccount(response.wallet);
  }

  private activateWallet(
    wallet: WalletAccount,
    metadata: WalletSessionMetadata,
    operation?: WalletOperation
  ): WalletActivationResult {
    this.persistSession(wallet.id, wallet.address, metadata, operation);
    this.activePendingWalletSelection = undefined;
    return { walletAddress: wallet.address, wallet };
  }

  private async completeWalletAuth(
    response: CompleteAuthResponse,
    walletType: WalletType,
    walletSelection: WalletSelectionBehavior,
    auth: OMSWalletSessionAuth,
    operation: WalletOperation,
    guard?: WalletAuthCommitGuard
  ): Promise<CompleteWalletAuthResult | PendingWalletSelection> {
    this.activePendingWalletSelection = undefined;

    const metadata = await this.sessionMetadataFromAuthResponse(response, auth);
    const wallets = await this.listAllWalletsFromAuthResponse(response);
    const credential = this.toWalletCredential(response.credential);
    const candidateWallets = wallets.filter((wallet) => wallet.type === walletType);
    const requireCurrentAuth = () => guard?.validate();

    requireCurrentAuth();

    if (walletSelection === 'manual') {
      const selection = await this.createPendingWalletSelection(
        {
          walletType,
          wallets: candidateWallets,
          credential,
          metadata
        },
        requireCurrentAuth
      );
      return selection;
    }

    const wallet = candidateWallets[0];
    const selectedWallet = wallet
      ? await this.requestUseWallet(wallet.id)
      : await this.requestCreateWallet(walletType);
    requireCurrentAuth();
    const activated = this.activateWallet(selectedWallet, metadata, operation);
    const resultWallets = wallet ? wallets : [...wallets, activated.wallet];

    return {
      walletAddress: activated.walletAddress,
      wallet: activated.wallet,
      wallets: resultWallets,
      credential
    };
  }

  private async completeEmailAuthAttempt(
    attempt: ActiveEmailAuthAttempt,
    params: EmailAuthCompletionParams
  ): Promise<CompleteEmailAuthResult | PendingWalletSelection> {
    this.requireActiveEmailAuthAttempt(attempt, WalletOperation.completeEmailAuth);
    const answer = await RequestUtils.hashEmailAuthAnswer(attempt.challenge, params.code);
    this.requireActiveEmailAuthAttempt(attempt, WalletOperation.completeEmailAuth);

    const request: CompleteAuthRequest = {
      identityType: IdentityType.Email,
      authMode: GeneratedAuthMode.OTP,
      verifier: attempt.verifier,
      answer,
      lifetime: attempt.sessionLifetimeSeconds
    };
    const response = await this.client.completeAuth(request);
    this.requireActiveEmailAuthAttempt(attempt, WalletOperation.completeEmailAuth);
    const result = await this.completeWalletAuth(
      response,
      params.walletType,
      params.walletSelection,
      this.emailSessionAuthFromResponse(response, attempt.email),
      WalletOperation.completeEmailAuth,
      {
        validate: () =>
          this.requireActiveEmailAuthAttempt(attempt, WalletOperation.completeEmailAuth)
      }
    );
    this.clearEmailAuthAttempt(attempt);
    return result;
  }

  private async *listAccessPagesUnchecked(
    params: ListAccessParams,
    operation: WalletOperation
  ): AsyncIterable<AccessGrantPage> {
    await this.requireActiveSession(operation);
    const walletId = this.walletId;

    let cursor: string | undefined;
    do {
      await this.requireSameActiveWalletSession(walletId, operation);
      const page = this.buildListAccessPage(params.pageSize, cursor);
      const request: ListAccessRequest = {
        walletId,
        page,
        type: this.toGeneratedCredentialType(params.type)
      };
      const response = await this.client.listAccess(request);
      await this.requireSameActiveWalletSession(walletId, operation);

      cursor = response.page?.cursor || undefined;
      yield {
        grants: response.credentials.map((c) => this.toWalletCredential(c))
      };
    } while (cursor);
  }

  private buildListAccessPage(
    pageSize: number | undefined,
    cursor: string | undefined
  ): ListAccessRequest['page'] | undefined {
    if (pageSize === undefined && cursor === undefined) {
      return undefined;
    }

    return {
      limit: pageSize,
      cursor
    };
  }

  private async listAllWallets(): Promise<Array<WalletAccount>> {
    const wallets: Array<WalletAccount> = [];
    let cursor: string | undefined;
    do {
      const page = cursor ? { cursor } : undefined;
      const request: ListWalletsRequest = page ? { page } : {};
      const response = await this.client.listWallets(request);
      wallets.push(...response.wallets.map((wallet) => this.toWalletAccount(wallet)));
      cursor = response.page?.cursor || undefined;
    } while (cursor);
    return wallets;
  }

  private async listAllWalletsFromAuthResponse(
    response: CompleteAuthResponse
  ): Promise<Array<WalletAccount>> {
    const wallets = response.wallets.map((wallet) => this.toWalletAccount(wallet));
    let cursor = response.page?.cursor || undefined;
    while (cursor) {
      const nextPage = await this.client.listWallets({ page: { cursor } });
      wallets.push(...nextPage.wallets.map((wallet) => this.toWalletAccount(wallet)));
      cursor = nextPage.page?.cursor || undefined;
    }
    return wallets;
  }

  private toWalletAccount(wallet: {
    id: string;
    networkFamily?: GeneratedNetworkFamily;
    keyOrigin?: GeneratedKeyOrigin;
    address: string;
    reference?: string;
  }): WalletAccount {
    if (!wallet.networkFamily) {
      throw new Error('Wallet response is missing networkFamily');
    }
    if (!wallet.keyOrigin) {
      throw new Error('Wallet response is missing keyOrigin');
    }
    const type = fromGeneratedNetworkFamily(wallet.networkFamily);
    const keyOrigin = fromGeneratedWalletKeyOrigin(wallet.keyOrigin);
    if (type === WalletType.Ethereum) {
      return {
        id: wallet.id,
        type,
        address: wallet.address as Address,
        reference: wallet.reference,
        keyOrigin
      };
    }
    return {
      id: wallet.id,
      type,
      address: wallet.address,
      reference: wallet.reference,
      keyOrigin
    };
  }

  private toWalletCredential(credential: CredentialInfo): AccessGrant {
    if (credential.type === CredentialType.Direct) {
      return {
        type: 'direct',
        credentialId: credential.credentialId,
        expiresAt: credential.expiresAt,
        isCaller: credential.isCaller
      };
    }

    if (!credential.sessionId || !credential.metadata || !credential.grants) {
      throw new Error('Remote access entry is missing session data');
    }

    return {
      type: 'remote',
      credentialId: credential.credentialId,
      sessionId: credential.sessionId,
      metadata: this.toRemoteCredentialMetadata(credential.metadata),
      grants: credential.grants.entries.map(fromGeneratedSmartSessionGrant),
      expiresAt: credential.expiresAt,
      isCaller: credential.isCaller
    };
  }

  private toGeneratedCredentialType(type: ListAccessParams['type']): CredentialType | undefined {
    if (type === undefined) {
      return undefined;
    }
    return type === 'direct' ? CredentialType.Direct : CredentialType.Remote;
  }

  private toRemoteCredentialMetadata(metadata: CredentialMetadata): RemoteCredentialMetadata {
    return {
      appUrl: metadata.appUrl,
      appName: metadata.appName,
      appLogoUrl: metadata.appLogoUrl,
      custom: { ...metadata.custom }
    };
  }

  /** Saves wallet metadata. The non-extractable credential key is owned by the signer. */
  private persistSession(
    walletId: string,
    walletAddress: string,
    metadata: WalletSessionMetadata,
    operation?: WalletOperation
  ): void {
    const record: StoredSessionRecord = {
      version: 1,
      scope: this.sessionScope(),
      walletId,
      walletAddress,
      expiresAt: metadata.expiresAt,
      auth: cloneSessionAuth(metadata.auth),
      signerCredentialId: metadata.signerCredentialId,
      signerKeyType: metadata.signerKeyType
    };
    try {
      this.storage.set(Constants.sessionStorageKey, JSON.stringify(record));
    } catch (error) {
      throw new OMSWalletStorageError({
        operation,
        message: 'Wallet session persistence failed',
        cause: error
      });
    }

    this.latestSessionExpiredEvent = undefined;
    this.walletId = walletId;
    this.activeWalletAddress = walletAddress;
    this.sessionExpiresAt = metadata.expiresAt;
    this.sessionAuth = cloneSessionAuth(metadata.auth);
    this.sessionSignerCredentialId = metadata.signerCredentialId;
    this.sessionSignerKeyType = metadata.signerKeyType;
    this.scheduleSessionExpiry(this.session);
  }

  private loadStoredSessionRecord(): LoadedSessionRecord | undefined {
    const serialized = this.storage.get(Constants.sessionStorageKey);
    if (!serialized) return undefined;

    try {
      const parsed = JSON.parse(serialized) as Record<string, unknown>;
      const scope = parsed.scope as Record<string, unknown> | undefined;
      const auth = normalizeSessionAuth(parsed.auth);
      const signerCredentialId = parsed.signerCredentialId;
      const signerKeyType = parsed.signerKeyType;
      if (
        parsed.version !== 1 ||
        typeof parsed.walletId !== 'string' ||
        typeof parsed.walletAddress !== 'string' ||
        typeof parsed.expiresAt !== 'string' ||
        typeof signerCredentialId !== 'string' ||
        !isCredentialSigningAlgorithm(signerKeyType) ||
        !scope ||
        typeof scope.projectId !== 'string' ||
        typeof scope.walletApiUrl !== 'string' ||
        typeof scope.indexerGatewayUrl !== 'string' ||
        !auth
      ) {
        this.storage.delete(Constants.sessionStorageKey);
        return undefined;
      }

      const expectedScope = this.sessionScope();
      if (
        scope.projectId !== expectedScope.projectId ||
        scope.walletApiUrl !== expectedScope.walletApiUrl ||
        scope.indexerGatewayUrl !== expectedScope.indexerGatewayUrl
      ) {
        this.storage.delete(Constants.sessionStorageKey);
        return undefined;
      }

      return {
        serialized,
        record: {
          version: 1,
          scope: expectedScope,
          walletId: parsed.walletId,
          walletAddress: parsed.walletAddress,
          expiresAt: parsed.expiresAt,
          auth,
          signerCredentialId,
          signerKeyType
        }
      };
    } catch {
      this.storage.delete(Constants.sessionStorageKey);
      return undefined;
    }
  }

  private sessionScope(): StoredSessionRecord['scope'] {
    return {
      projectId: this.projectId,
      walletApiUrl: this.environment.walletApiUrl,
      indexerGatewayUrl: this.environment.indexerGatewayUrl
    };
  }

  private currentSessionMetadata(): WalletSessionMetadata | undefined {
    if (
      !this.sessionExpiresAt ||
      !this.sessionAuth ||
      !this.sessionSignerCredentialId ||
      !this.sessionSignerKeyType
    )
      return undefined;
    return {
      expiresAt: this.sessionExpiresAt,
      auth: cloneSessionAuth(this.sessionAuth),
      signerCredentialId: this.sessionSignerCredentialId,
      signerKeyType: this.sessionSignerKeyType
    };
  }

  private async activeWalletActivationContext(
    operation: WalletOperation
  ): Promise<ActiveWalletActivationContext> {
    await this.requireActiveSession(operation);
    const metadata = this.currentSessionMetadata();
    if (!metadata) {
      throw new OMSWalletSessionError({
        operation,
        message: 'No active wallet session'
      });
    }
    return {
      walletId: this.walletId,
      metadata
    };
  }

  private async walletImportActivationContext(
    walletType: WalletType,
    operation: WalletOperation
  ): Promise<WalletImportActivationContext> {
    const pending = this.activePendingWalletSelection;
    if (pending) {
      await this.requireActivePendingWalletSelection(pending, operation);
      if (pending.walletType !== walletType) {
        throw new Error(`Pending wallet selection requires a ${pending.walletType} wallet`);
      }
      return {
        type: 'pending',
        selectionId: pending.id,
        walletType: pending.walletType,
        metadata: pending.metadata
      };
    }

    const active = await this.activeWalletActivationContext(operation);
    return { type: 'active', ...active };
  }

  private async requireWalletImportActivationContextStillActive(
    context: WalletImportActivationContext,
    operation: WalletOperation
  ): Promise<void> {
    if (context.type === 'active') {
      await this.requireActiveWalletActivationContextStillActive(context, operation);
      return;
    }
    const pending = this.activePendingWalletSelection;
    if (!pending || pending.id !== context.selectionId) {
      throw new OMSWalletSelectionError({
        code: 'OMS_WALLET_SELECTION_STALE',
        operation,
        message: 'Pending wallet selection is no longer active'
      });
    }
    await this.requireActivePendingWalletSelection(pending, operation);
  }

  private async requireActiveWalletActivationContextStillActive(
    context: ActiveWalletActivationContext,
    operation: WalletOperation
  ): Promise<void> {
    await this.requireActiveSession(operation);
    if (this.walletId !== context.walletId) {
      throw new OMSWalletSessionError({
        operation,
        message: 'Active wallet session changed'
      });
    }
  }

  private async requireSameActiveWalletSession(
    walletId: string,
    operation: WalletOperation
  ): Promise<void> {
    await this.requireActiveSession(operation);
    if (this.walletId !== walletId) {
      throw new OMSWalletSessionError({
        operation,
        message: 'Active wallet session changed'
      });
    }
  }

  private async requireWalletSelectionOrActiveSession(operation: WalletOperation): Promise<void> {
    if (this.activePendingWalletSelection) {
      await this.requireActivePendingWalletSelection(this.activePendingWalletSelection, operation);
      return;
    }

    if (this.walletId) {
      await this.requireActiveSession(operation);
      return;
    }

    throw new OMSWalletSessionError({
      operation,
      message: 'No authenticated wallet session'
    });
  }

  private currentEmailAuthAttempt(operation: WalletOperation): ActiveEmailAuthAttempt {
    if (!this.activeEmailAuthAttempt) {
      throw new OMSWalletSessionError({
        operation,
        message: 'No pending email auth attempt'
      });
    }

    return this.activeEmailAuthAttempt;
  }

  private requireActiveEmailAuthAttempt(
    attempt: ActiveEmailAuthAttempt,
    operation: WalletOperation
  ): void {
    if (this.activeEmailAuthAttempt !== attempt) {
      throw new OMSWalletSessionError({
        operation,
        message: 'Email auth attempt is no longer active'
      });
    }
  }

  private clearEmailAuthAttempt(attempt: ActiveEmailAuthAttempt | undefined): void {
    if (attempt && this.activeEmailAuthAttempt === attempt) {
      this.activeEmailAuthAttempt = undefined;
    }
  }

  private async createPendingWalletSelection(
    params: {
      walletType: WalletType;
      wallets: Array<WalletAccount>;
      credential: WalletCredential;
      metadata: WalletSessionMetadata;
    },
    beforeCommit?: () => void
  ): Promise<PendingWalletSelection> {
    const signerCredentialId = await this.credentialSigner.credentialId();
    beforeCommit?.();
    const selectionSession: ActivePendingWalletSelection = {
      id: `pending-${this.nextPendingWalletSelectionId++}`,
      signerCredentialId,
      signerKeyType: this.credentialSigner.signingAlgorithm,
      walletType: params.walletType,
      metadata: params.metadata
    };
    this.activePendingWalletSelection = selectionSession;
    this.scheduleSessionExpiry(this.sessionFromMetadata(undefined, params.metadata));

    const wallets = params.wallets.map((wallet) => ({ ...wallet }));
    const credential = { ...params.credential };

    return new PendingWalletSelectionImpl(
      params.walletType,
      wallets,
      credential,
      async (walletId) => {
        const operation = WalletOperation.pendingWalletSelectionSelectWallet;
        await this.requireActivePendingWalletSelection(selectionSession, operation);
        const wallet = await this.requestUseWallet(walletId);
        await this.requireActivePendingWalletSelection(selectionSession, operation);
        return this.activateWallet(wallet, selectionSession.metadata, operation);
      },
      async (reference) => {
        const operation = WalletOperation.pendingWalletSelectionCreateAndSelectWallet;
        await this.requireActivePendingWalletSelection(selectionSession, operation);
        const wallet = await this.requestCreateWallet(selectionSession.walletType, reference);
        await this.requireActivePendingWalletSelection(selectionSession, operation);
        return this.activateWallet(wallet, selectionSession.metadata, operation);
      }
    );
  }

  private async requireActivePendingWalletSelection(
    selectionSession: ActivePendingWalletSelection,
    operation: WalletOperation
  ): Promise<void> {
    if (this.activePendingWalletSelection?.id !== selectionSession.id) {
      throw new OMSWalletSelectionError({
        code: 'OMS_WALLET_SELECTION_STALE',
        operation,
        message: 'Pending wallet selection is no longer active'
      });
    }

    const session = this.sessionFromMetadata(undefined, selectionSession.metadata);
    if (this.isSessionExpired(session)) {
      await this.expireSession(session);
      throw new OMSWalletSessionError({
        code: 'OMS_SESSION_EXPIRED',
        operation,
        message: 'Wallet session expired'
      });
    }

    if (this.credentialSigner.hasCredential && !(await this.credentialSigner.hasCredential())) {
      this.activePendingWalletSelection = undefined;
      throw new OMSWalletSessionError({
        operation,
        message: 'No active credential'
      });
    }

    const signerCredentialId = await this.credentialSigner.credentialId();
    if (
      normalizeCredentialId(signerCredentialId) !==
        normalizeCredentialId(selectionSession.signerCredentialId) ||
      this.credentialSigner.signingAlgorithm !== selectionSession.signerKeyType
    ) {
      throw new OMSWalletSelectionError({
        code: 'OMS_WALLET_SELECTION_STALE',
        operation,
        message: 'Pending wallet selection is no longer active'
      });
    }
  }

  private async sessionMetadataFromAuthResponse(
    response: CompleteAuthResponse,
    auth: OMSWalletSessionAuth
  ): Promise<WalletSessionMetadata> {
    return {
      expiresAt: response.credential.expiresAt,
      auth,
      signerCredentialId: await this.credentialSigner.credentialId(),
      signerKeyType: this.credentialSigner.signingAlgorithm
    };
  }

  private emailSessionAuthFromResponse(
    response: CompleteAuthResponse,
    requestedEmail: string
  ): OMSWalletEmailSessionAuth {
    return {
      type: 'email',
      email: response.email ?? requestedEmail
    };
  }

  private oidcIdTokenSessionAuthFromParams(
    params: SignInWithOidcIdTokenParams,
    response: CompleteAuthResponse
  ): OMSWalletOidcSessionAuth {
    const issuer = response.identity.iss || params.issuer;
    return {
      type: 'oidc',
      flow: 'id-token',
      issuer,
      provider: params.provider ?? builtInOidcProviderForIssuer(issuer),
      providerLabel: params.providerLabel ?? builtInOidcProviderLabelForIssuer(issuer),
      email: response.email
    };
  }

  private oidcRedirectSessionAuthFromPending(
    pending: PendingOidcRedirectAuth,
    response: CompleteAuthResponse
  ): OMSWalletOidcSessionAuth {
    const issuer = response.identity.iss || pending.issuer;
    return {
      type: 'oidc',
      flow: 'redirect',
      issuer,
      provider: pending.provider ?? builtInOidcProviderForIssuer(issuer),
      providerLabel: pending.providerLabel ?? builtInOidcProviderLabelForIssuer(issuer),
      email: response.email
    };
  }

  private resolveOidcScopes(provider: ResolvedOidcProviderConfig): string[] {
    return provider.scopes ? [...provider.scopes] : [];
  }

  private resolveOidcAuthMode(provider: ResolvedOidcProviderConfig): OidcAuthMode {
    return provider.authMode ?? AuthMode.AuthCodePKCE;
  }

  private sessionProviderFromOidcProvider(
    provider: ResolvedOidcProviderConfig
  ): string | undefined {
    return provider.provider ?? builtInOidcProviderForIssuer(provider.issuer);
  }

  private sessionProviderLabelFromOidcProvider(
    provider: ResolvedOidcProviderConfig
  ): string | undefined {
    return provider.providerLabel ?? builtInOidcProviderLabelForIssuer(provider.issuer);
  }

  private derivedOmsRelayRedirectUri(relayProvider: 'google' | 'apple'): string {
    return `${this.environment.walletApiUrl.replace(/\/+$/, '')}/auth/waas/callback/${relayProvider}`;
  }

  private requireRedirectAuthStorage(): StorageManager {
    if (!this.redirectAuthStorage) {
      throw new Error('OIDC redirect auth requires redirectAuthStorage or browser sessionStorage');
    }
    return this.redirectAuthStorage;
  }

  private savePendingOidcRedirectAuth(
    storage: StorageManager,
    pending: PendingOidcRedirectAuth
  ): void {
    try {
      storage.set(Constants.redirectAuthStorageKey, JSON.stringify(pending));
    } catch (error) {
      throw new OMSWalletStorageError({
        operation: WalletOperation.startOidcRedirectAuth,
        message: 'OIDC redirect auth state persistence failed',
        cause: error
      });
    }
  }

  private loadPendingOidcRedirectAuth(storage: StorageManager): PendingOidcRedirectAuth {
    const stored = storage.get(Constants.redirectAuthStorageKey);
    if (!stored) {
      throw new Error('No pending OIDC redirect auth found');
    }

    try {
      const parsed = JSON.parse(stored) as Partial<PendingOidcRedirectAuth>;
      const signerKeyType = parsed.signerKeyType;
      if (
        typeof parsed.verifier !== 'string' ||
        typeof parsed.nonce !== 'string' ||
        !isOidcAuthMode(parsed.authMode) ||
        typeof parsed.signerCredentialId !== 'string' ||
        !isCredentialSigningAlgorithm(signerKeyType) ||
        typeof parsed.expectedCallbackUri !== 'string' ||
        typeof parsed.issuer !== 'string' ||
        typeof parsed.projectId !== 'string' ||
        (parsed.consumed !== undefined && typeof parsed.consumed !== 'boolean')
      ) {
        throw new Error('Pending OIDC redirect auth is invalid');
      }

      return {
        verifier: parsed.verifier,
        nonce: parsed.nonce,
        authMode: parsed.authMode,
        provider: typeof parsed.provider === 'string' ? parsed.provider : undefined,
        providerLabel: typeof parsed.providerLabel === 'string' ? parsed.providerLabel : undefined,
        walletType: isWalletType(parsed.walletType) ? parsed.walletType : WalletType.Ethereum,
        walletSelection: isWalletSelectionBehavior(parsed.walletSelection)
          ? parsed.walletSelection
          : undefined,
        sessionLifetimeSeconds:
          typeof parsed.sessionLifetimeSeconds === 'number'
            ? parsed.sessionLifetimeSeconds
            : undefined,
        signerCredentialId: parsed.signerCredentialId,
        signerKeyType,
        expectedCallbackUri: parsed.expectedCallbackUri,
        issuer: parsed.issuer,
        projectId: parsed.projectId,
        consumed: parsed.consumed
      };
    } catch (error) {
      throw error instanceof Error ? error : new Error('Pending OIDC redirect auth is invalid');
    }
  }

  private markPendingOidcRedirectAuthConsumed(
    storage: StorageManager,
    pending: PendingOidcRedirectAuth
  ): void {
    try {
      storage.set(Constants.redirectAuthStorageKey, JSON.stringify({ ...pending, consumed: true }));
    } catch (error) {
      throw new OMSWalletStorageError({
        operation: WalletOperation.completeOidcRedirectAuth,
        message: 'OIDC redirect auth state consumption failed',
        cause: error
      });
    }
  }

  private validateOidcState(encodedState: string, pending: PendingOidcRedirectAuth): void {
    const state = decodeOidcState(encodedState);
    if (state.nonce !== pending.nonce) {
      throw new Error('OIDC state nonce mismatch');
    }
    if (state.scope !== pending.projectId) {
      throw new Error('OIDC state scope mismatch');
    }
    if (state.redirect_uri !== undefined && state.redirect_uri !== pending.expectedCallbackUri) {
      throw new Error('OIDC state redirect_uri mismatch');
    }
  }

  private async validatePendingOidcRedirectSigner(
    pending: PendingOidcRedirectAuth,
    operation: WalletOperation
  ): Promise<void> {
    if (this.credentialSigner.hasCredential && !(await this.credentialSigner.hasCredential())) {
      throw new OMSWalletSessionError({
        operation,
        message: 'No active credential'
      });
    }

    const signerCredentialId = await this.credentialSigner.credentialId();
    if (
      normalizeCredentialId(signerCredentialId) !==
        normalizeCredentialId(pending.signerCredentialId) ||
      this.credentialSigner.signingAlgorithm !== pending.signerKeyType
    ) {
      throw new OMSWalletSessionError({
        operation,
        message: 'OIDC redirect auth signer mismatch'
      });
    }
  }

  private replaceOidcCallbackUrl(callbackUrl: string, replaceUrl?: (url: string) => void): void {
    const cleanUrl = cleanOidcCallbackUrl(callbackUrl);
    if (replaceUrl) {
      replaceUrl(cleanUrl);
      return;
    }

    if (typeof window === 'undefined' || !window.history?.replaceState) {
      throw new Error('cleanUrl requires replaceUrl or browser history support');
    }

    window.history.replaceState({}, '', cleanUrl);
  }

  private browserCurrentUrl(operation: string, requiredParam: string): string {
    if (typeof window === 'undefined') {
      throw new Error(`${operation} requires ${requiredParam} outside a browser`);
    }
    return window.location.href;
  }

  private browserAssignUrl(): (url: string) => void {
    if (typeof window === 'undefined') {
      throw new Error('signInWithOidcRedirect requires assignUrl outside a browser');
    }
    return (url: string) => window.location.assign(url);
  }

  private async executePreparedTransaction(params: {
    prepared: PrepareResponse;
    network?: Network | SolanaNetwork;
    selectFeeOption?: FeeOptionSelector;
    waitForStatus?: boolean;
    statusPolling?: TransactionStatusPollingOptions;
  }): Promise<SendTransactionResponse> {
    if (params.waitForStatus !== false) {
      this.validateTransactionStatusPollingOptions(params.statusPolling);
    }
    const feeOption = await this.selectFeeOption({
      feeOptions: params.prepared.feeOptions,
      sponsored: params.prepared.sponsored,
      network: params.network,
      selectFeeOption: params.selectFeeOption
    });
    const request: ExecuteRequest = { txnId: params.prepared.txnId };
    if (feeOption) {
      request.feeOption = toGeneratedFeeOptionSelection(feeOption);
    }

    let executed: ExecuteResponse;
    try {
      executed = await this.client.execute(request);
    } catch (error) {
      const sdkError = toOMSWalletError(error, WalletOperation.execute);
      throw new OMSWalletTransactionError({
        code: 'OMS_TRANSACTION_EXECUTION_UNCONFIRMED',
        operation: WalletOperation.execute,
        txnId: params.prepared.txnId,
        status: sdkError.status,
        retryable: false,
        upstreamError: sdkError.upstreamError,
        cause: sdkError,
        message: 'Transaction execution failed before status could be confirmed'
      });
    }

    if (params.waitForStatus === false) {
      return {
        txnId: params.prepared.txnId,
        status: fromGeneratedTransactionStatus(executed.status),
        statusResolution: 'not-requested'
      };
    }

    let polledStatus: PolledTransactionStatus;
    try {
      polledStatus = await this.waitForTransactionStatus(
        params.prepared.txnId,
        executed.status,
        params.statusPolling
      );
    } catch (error) {
      const sdkError = toOMSWalletError(error, WalletOperation.transactionStatus);
      throw new OMSWalletTransactionError({
        operation: WalletOperation.transactionStatus,
        txnId: params.prepared.txnId,
        status: sdkError.status,
        retryable: true,
        upstreamError: sdkError.upstreamError,
        cause: sdkError,
        message: 'Transaction was submitted, but status polling failed'
      });
    }

    return {
      txnId: params.prepared.txnId,
      status: polledStatus.response.status,
      txnHash: polledStatus.response.txnHash,
      statusResolution: polledStatus.resolution
    };
  }

  private async selectFeeOption(params: {
    feeOptions: GeneratedFeeOption[];
    sponsored: boolean;
    network?: Network | SolanaNetwork;
    selectFeeOption?: FeeOptionSelector;
  }): Promise<FeeOptionSelection | undefined> {
    if (params.sponsored) {
      await params.selectFeeOption?.([]);
      return undefined;
    }

    if (params.feeOptions.length === 0) {
      throw new Error('No fee options available for unsponsored transaction');
    }

    const feeOptions = params.feeOptions.map(fromGeneratedFeeOption);
    if (!params.selectFeeOption) {
      return this.defaultFeeOptionSelection(feeOptions);
    }

    const options = params.network
      ? await this.enrichFeeOptionsWithBalances(params.network, feeOptions)
      : feeOptions.map((feeOption, index) => ({
          feeOption,
          selection: feeOptionSelection(feeOption, index)
        }));
    const selected = await params.selectFeeOption(options);
    if (!selected) {
      throw new Error('No fee option selected for unsponsored transaction');
    }
    return selected;
  }

  private async enrichFeeOptionsWithBalances(
    network: Network | SolanaNetwork,
    feeOptions: FeeOption[]
  ): Promise<FeeOptionWithBalance[]> {
    if (typeof network === 'string') {
      return this.enrichSolanaFeeOptionsWithBalances(network, feeOptions);
    }

    const walletAddress = this.walletAddress;
    if (!walletAddress) {
      throw new Error('No active wallet session');
    }

    const contractAddresses = Array.from(
      new Set(
        feeOptions
          .map((option) => this.normalizeAddress(option.token.contractAddress))
          .filter((address): address is string => Boolean(address))
      )
    );
    const balances = await this.indexerClient
      .getBalances({
        networks: [network],
        contractAddresses,
        walletAddress,
        includeMetadata: false
      })
      .catch(() => undefined);
    const nativeBalance = feeOptions.some((option) => this.isNativeToken(option))
      ? balances?.nativeBalances.find((balance) => balance.chainId === network.id)
      : undefined;
    const tokenBalances = new Map<string, TokenBalance | undefined>(
      contractAddresses.map((contractAddress) => [
        contractAddress,
        balances?.balances.find(
          (balance) => this.normalizeAddress(balance.contractAddress) === contractAddress
        )
      ])
    );

    return feeOptions.map((feeOption, index) => {
      const balance = this.isNativeToken(feeOption)
        ? nativeBalance
        : tokenBalances.get(this.normalizeAddress(feeOption.token.contractAddress) ?? '');
      const decimals = this.balanceDecimals(feeOption);

      return {
        feeOption,
        selection: feeOptionSelection(feeOption, index),
        balance,
        available: this.formatTokenAmount(balance?.balance, decimals),
        availableRaw: balance?.balance,
        decimals
      };
    });
  }

  private async enrichSolanaFeeOptionsWithBalances(
    network: SolanaNetwork,
    feeOptions: FeeOption[]
  ): Promise<FeeOptionWithBalance[]> {
    const walletAddress = this.walletAddress;
    if (!walletAddress) {
      throw new Error('No active wallet session');
    }

    const mintAddresses = Array.from(
      new Set(
        feeOptions
          .filter((option) => !this.isNativeToken(option))
          .map((option) => option.token.contractAddress?.trim())
          .filter((address): address is string => Boolean(address))
      )
    );
    const balances = await this.indexerClient
      .getSolanaBalances({
        networks: [network],
        walletAddress,
        mintAddresses,
        includeMetadata: false,
        omitNativeBalances: !feeOptions.some((option) => this.isNativeToken(option))
      })
      .catch(() => undefined);
    const nativeBalance = balances?.balances.find(
      (balance) => balance.network === network && balance.assetType === 'native'
    );
    const balancesByMint = new Map(
      balances?.balances
        .filter((balance) => balance.network === network && balance.assetType === 'fungible-token')
        .map((balance) => [balance.mintAddress, balance]) ?? []
    );

    return feeOptions.map((feeOption, index) => {
      const balance = this.isNativeToken(feeOption)
        ? nativeBalance
        : balancesByMint.get(feeOption.token.contractAddress?.trim() ?? '');
      const decimals = balance?.decimals ?? feeOption.token.decimals;

      return {
        feeOption,
        selection: feeOptionSelection(feeOption, index),
        available: this.formatTokenAmount(balance?.balance, decimals),
        availableRaw: balance?.balance,
        decimals
      };
    });
  }

  private defaultFeeOptionSelection(feeOptions: FeeOption[]): FeeOptionSelection {
    return feeOptionSelection(feeOptions[0], 0);
  }

  private async waitForTransactionStatus(
    txnId: string,
    fallbackStatus: ExecuteResponse['status'],
    options: TransactionStatusPollingOptions = {}
  ): Promise<PolledTransactionStatus> {
    const timeoutMs = options.timeoutMs ?? this.transactionStatusPollTimeoutMs;
    const deadline = Date.now() + timeoutMs;
    let lastStatus: TransactionStatusResponse = {
      status: fromGeneratedTransactionStatus(fallbackStatus)
    };
    let completedPolls = 0;

    do {
      if (completedPolls > 0 && Date.now() >= deadline) {
        return { response: lastStatus, resolution: 'timed-out' };
      }
      lastStatus = fromGeneratedTransactionStatusResponse(
        await this.client.transactionStatus({ txnId } as TransactionStatusRequest)
      );
      completedPolls += 1;
      if (
        lastStatus.status === TransactionStatus.Executed ||
        lastStatus.status === TransactionStatus.Failed ||
        lastStatus.txnHash
      ) {
        return { response: lastStatus, resolution: 'resolved' };
      }
      const pollDelayMs = this.transactionStatusPollDelayMs(completedPolls, options);
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        return { response: lastStatus, resolution: 'timed-out' };
      }
      await this.delay(Math.min(pollDelayMs, remainingMs));
    } while (true);
  }

  private transactionStatusPollDelayMs(
    completedPolls: number,
    options: TransactionStatusPollingOptions = {}
  ): number {
    const fastPollCount = options.fastPollCount ?? this.fastTransactionStatusPollCount;
    return completedPolls < fastPollCount
      ? (options.fastIntervalMs ?? this.fastTransactionStatusPollIntervalMs)
      : (options.intervalMs ?? this.transactionStatusPollIntervalMs);
  }

  private validateTransactionStatusPollingOptions(
    options: TransactionStatusPollingOptions = {}
  ): void {
    this.requireFinitePollingNumber('timeoutMs', options.timeoutMs, { minimum: 0 });
    this.requireFinitePollingNumber('intervalMs', options.intervalMs, {
      minimum: 0,
      exclusive: true
    });
    this.requireFinitePollingNumber('fastIntervalMs', options.fastIntervalMs, {
      minimum: 0,
      exclusive: true
    });
    this.requireFinitePollingNumber('fastPollCount', options.fastPollCount, {
      minimum: 0,
      integer: true
    });
  }

  private requireFinitePollingNumber(
    name: string,
    value: number | undefined,
    constraints: { minimum: number; exclusive?: boolean; integer?: boolean }
  ): void {
    if (value === undefined) return;
    const belowMinimum = constraints.exclusive
      ? value <= constraints.minimum
      : value < constraints.minimum;
    if (
      !Number.isFinite(value) ||
      belowMinimum ||
      (constraints.integer && !Number.isInteger(value))
    ) {
      const comparison = constraints.exclusive ? 'greater than' : 'at least';
      const integer = constraints.integer ? ' integer' : '';
      throw new Error(
        `${name} must be a finite${integer} value ${comparison} ${constraints.minimum}`
      );
    }
  }

  private async requireActiveSession(operation: WalletOperation): Promise<void> {
    if (!this.walletId) {
      throw new OMSWalletSessionError({
        operation,
        message: 'No active wallet session'
      });
    }

    const session = this.session;
    if (this.isSessionExpired(session)) {
      await this.expireSession(session);
      throw new OMSWalletSessionError({
        code: 'OMS_SESSION_EXPIRED',
        operation,
        message: 'Wallet session expired'
      });
    }

    if (this.credentialSigner.hasCredential && !(await this.credentialSigner.hasCredential())) {
      await this.clearSession({ operation });
      throw new OMSWalletSessionError({
        operation,
        message: 'No active wallet session'
      });
    }

    const signerCredentialId = await this.credentialSigner.credentialId();
    if (
      !this.sessionSignerCredentialId ||
      !this.sessionSignerKeyType ||
      normalizeCredentialId(signerCredentialId) !==
        normalizeCredentialId(this.sessionSignerCredentialId) ||
      this.credentialSigner.signingAlgorithm !== this.sessionSignerKeyType
    ) {
      await this.clearSession({ operation });
      throw new OMSWalletSessionError({
        operation,
        message: 'No active wallet session'
      });
    }
  }

  private async requireActiveEthereumSession(operation: WalletOperation): Promise<void> {
    await this.requireActiveSession(operation);
    if (!isAddress(this.activeWalletAddress!)) {
      throw new Error('An active Ethereum wallet is required');
    }
  }

  private async requireActiveSolanaSession(operation: WalletOperation): Promise<void> {
    await this.requireActiveSession(operation);
    if (isAddress(this.activeWalletAddress!)) {
      throw new Error('An active Solana wallet is required');
    }
  }

  private activeWalletId(): string | undefined {
    return this.walletId || undefined;
  }

  private isNativeToken(feeOption: FeeOption): boolean {
    return (
      feeOption.token.type.toLowerCase() === 'native' ||
      (!feeOption.token.contractAddress && !feeOption.token.tokenID)
    );
  }

  private balanceDecimals(feeOption: FeeOption): number | undefined {
    return feeOption.token.decimals ?? (this.isNativeToken(feeOption) ? 18 : undefined);
  }

  private normalizeAddress(address: string | undefined): string | undefined {
    return address?.trim().toLowerCase() || undefined;
  }

  private formatTokenAmount(
    value: string | undefined,
    decimals: number | undefined
  ): string | undefined {
    if (value === undefined || decimals === undefined) {
      return value;
    }

    try {
      const raw = BigInt(value);
      const divisor = 10n ** BigInt(decimals);
      const whole = raw / divisor;
      const fraction = (raw % divisor).toString().padStart(decimals, '0').replace(/0+$/, '');
      return fraction ? `${whole}.${fraction}` : whole.toString();
    } catch {
      return value;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isSessionExpired(session: OMSWalletSessionState): boolean {
    if (!session.expiresAt) return false;
    const expiresAtMs = Date.parse(session.expiresAt);
    return Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();
  }

  private sessionFromMetadata(
    walletAddress: string | undefined,
    metadata: WalletSessionMetadata
  ): OMSWalletSessionState {
    return {
      walletAddress,
      expiresAt: metadata.expiresAt,
      auth: cloneSessionAuth(metadata.auth)
    };
  }

  private async expireSession(session: OMSWalletSessionState): Promise<void> {
    const expiredAt = session.expiresAt;
    try {
      await this.clearSession({ clearStorage: false });
    } catch {
      // Expiry notification should not depend on credential cleanup succeeding.
    }
    if (expiredAt) {
      this.notifySessionExpired({ session, expiredAt });
    }
  }

  private scheduleSessionExpiry(session: OMSWalletSessionState): void {
    this.clearSessionExpiryTimer();

    if (!session.expiresAt) return;
    const expiresAtMs = Date.parse(session.expiresAt);
    if (!Number.isFinite(expiresAtMs)) return;

    const delayMs = Math.min(Math.max(0, expiresAtMs - Date.now()), MAX_SESSION_EXPIRY_TIMER_MS);
    const timer = setTimeout(() => {
      this.sessionExpiryTimer = undefined;
      void this.expireSessionFromTimer(session);
    }, delayMs);
    this.sessionExpiryTimer = timer;
    const unrefTimer = timer as { unref?: () => void };
    unrefTimer.unref?.();
  }

  private clearSessionExpiryTimer(): void {
    if (!this.sessionExpiryTimer) return;
    clearTimeout(this.sessionExpiryTimer);
    this.sessionExpiryTimer = undefined;
  }

  private async expireSessionFromTimer(session: OMSWalletSessionState): Promise<void> {
    if (!this.isCurrentSessionSnapshot(session)) return;
    if (!this.isSessionExpired(session)) {
      this.scheduleSessionExpiry(session);
      return;
    }
    await this.expireSession(session);
  }

  private isCurrentSessionSnapshot(session: OMSWalletSessionState): boolean {
    if (session.walletAddress) {
      return (
        this.activeWalletAddress === session.walletAddress &&
        this.sessionExpiresAt === session.expiresAt
      );
    }

    return (
      !!this.activePendingWalletSelection &&
      this.activePendingWalletSelection.metadata.expiresAt === session.expiresAt
    );
  }

  private scheduleStoredSessionExpiryNotification(snapshot: StoredSessionSnapshot): void {
    const session = snapshot.session;
    const expiredAt = session.expiresAt;
    void Promise.resolve()
      .then(async () => {
        if (!this.matchesStoredSessionSnapshot(snapshot)) return;

        try {
          await this.credentialSigner.clear?.();
        } catch {
          // Expiry replay should still happen if credential cleanup fails.
        }

        if (!this.matchesStoredSessionSnapshot(snapshot)) return;

        if (expiredAt) {
          this.notifySessionExpired({ session, expiredAt });
        }
      })
      .catch(() => {});
  }

  private matchesStoredSessionSnapshot(snapshot: StoredSessionSnapshot): boolean {
    return this.storage.get(Constants.sessionStorageKey) === snapshot.serializedRecord;
  }

  private notifySessionExpired(event: OMSWalletSessionExpiredEvent): void {
    const eventSnapshot = cloneSessionExpiredEvent(event);
    this.latestSessionExpiredEvent = eventSnapshot;

    this.dispatchingSessionExpiredEvent = true;
    try {
      for (const listener of Array.from(this.sessionExpiredListeners)) {
        this.callSessionExpiredListener(listener, cloneSessionExpiredEvent(eventSnapshot));
      }
    } finally {
      this.dispatchingSessionExpiredEvent = false;
    }
  }

  private callSessionExpiredListener(
    listener: OMSWalletSessionExpiredListener,
    event: OMSWalletSessionExpiredEvent
  ): void {
    try {
      const result = listener(event);
      if (isPromiseLike(result)) {
        void result.catch(() => {});
      }
    } catch {
      // User callbacks must not change the SDK operation error.
    }
  }

  private loginHintForProvider(
    provider: ResolvedOidcProviderConfig,
    loginHint: string | undefined
  ): string | undefined {
    return provider.issuer === GOOGLE_ISSUER ? loginHint : undefined;
  }

  private sessionLifetimeSeconds(value: number | undefined, operation: WalletOperation): number {
    const lifetime = value ?? DEFAULT_SESSION_LIFETIME_SECONDS;
    if (!Number.isInteger(lifetime) || lifetime < 1 || lifetime > MAX_SESSION_LIFETIME_SECONDS) {
      throw new Error(
        `${operation} requires sessionLifetimeSeconds to be an integer between 1 and ${MAX_SESSION_LIFETIME_SECONDS}`
      );
    }
    return lifetime;
  }

  private requireCurrentSessionRevision(revision: number, operation: WalletOperation): void {
    if (this.sessionRevision !== revision) {
      throw new OMSWalletSessionError({
        operation,
        message: 'Wallet session changed while auth was in flight'
      });
    }
  }

  private async runOperation<T>(operation: WalletOperation, action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      throw toOMSWalletError(error, operation);
    }
  }
}

function defaultRedirectAuthStorage(): StorageManager | undefined {
  return SessionStorageManager.isAvailable() ? new SessionStorageManager() : undefined;
}

function createApiKeyFetch(publishableKey: string): Fetch {
  return async (input: RequestInfo, init?: RequestInit): Promise<Response> => {
    const existingHeaders = (init?.headers ?? {}) as Record<string, string>;
    const headers: Record<string, string> = {
      ...existingHeaders,
      'Api-Key': publishableKey
    };

    return globalThis.fetch(input, { ...init, headers });
  };
}

function isWalletType(value: unknown): value is WalletType {
  return typeof value === 'string' && Object.values(WalletType).includes(value as WalletType);
}

function isOidcAuthMode(value: unknown): value is OidcAuthMode {
  return value === AuthMode.AuthCode || value === AuthMode.AuthCodePKCE;
}

function isCredentialSigningAlgorithm(value: unknown): value is CredentialSigningAlgorithm {
  return value === 'ecdsa-p256-sha256' || value === 'ecdsa-p256k-eip191';
}

function isWalletSelectionBehavior(value: unknown): value is WalletSelectionBehavior {
  return value === 'automatic' || value === 'manual';
}

function sameEmailAuthCompletionParams(
  left: EmailAuthCompletionParams,
  right: EmailAuthCompletionParams
): boolean {
  return (
    left.code === right.code &&
    left.walletType === right.walletType &&
    left.walletSelection === right.walletSelection
  );
}

function normalizeCredentialId(value: string): string {
  return value.trim().toLowerCase();
}

function isPromiseLike(value: unknown): value is Promise<void> {
  return !!value && typeof (value as { catch?: unknown }).catch === 'function';
}

function cloneSessionAuth(auth: OMSWalletSessionAuth): OMSWalletSessionAuth;
function cloneSessionAuth(auth: undefined): undefined;
function cloneSessionAuth(auth: OMSWalletSessionAuth | undefined): OMSWalletSessionAuth | undefined;
function cloneSessionAuth(
  auth: OMSWalletSessionAuth | undefined
): OMSWalletSessionAuth | undefined {
  return auth ? { ...auth } : undefined;
}

function cloneSessionState(session: OMSWalletSessionState): OMSWalletSessionState {
  return {
    walletAddress: session.walletAddress,
    expiresAt: session.expiresAt,
    auth: cloneSessionAuth(session.auth)
  };
}

function cloneSessionExpiredEvent(
  event: OMSWalletSessionExpiredEvent
): OMSWalletSessionExpiredEvent {
  return {
    session: cloneSessionState(event.session),
    expiredAt: event.expiredAt
  };
}

function normalizeSessionAuth(value: unknown): OMSWalletSessionAuth | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const auth = value as Record<string, unknown>;
  if (auth.type === 'email' && typeof auth.email === 'string') {
    return {
      type: 'email',
      email: auth.email
    };
  }

  if (auth.type === 'oidc' && typeof auth.issuer === 'string' && isSessionAuthFlow(auth.flow)) {
    return {
      type: 'oidc',
      flow: auth.flow,
      issuer: auth.issuer,
      provider: typeof auth.provider === 'string' ? auth.provider : undefined,
      providerLabel: typeof auth.providerLabel === 'string' ? auth.providerLabel : undefined,
      email: typeof auth.email === 'string' ? auth.email : undefined
    };
  }

  return undefined;
}

function isSessionAuthFlow(value: unknown): value is OMSWalletOidcSessionAuthFlow {
  return value === 'redirect' || value === 'id-token';
}

function builtInOidcProviderForIssuer(issuer: string): string | undefined {
  switch (issuer) {
    case GOOGLE_ISSUER:
      return 'google';
    case APPLE_ISSUER:
      return 'apple';
    default:
      return undefined;
  }
}

function builtInOidcProviderLabelForIssuer(issuer: string): string | undefined {
  switch (issuer) {
    case GOOGLE_ISSUER:
      return 'Google';
    case APPLE_ISSUER:
      return 'Apple';
    default:
      return undefined;
  }
}

function normalizeJsonBigInts<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, nestedValue) => {
      return typeof nestedValue === 'bigint' ? nestedValue.toString() : nestedValue;
    })
  ) as T;
}

const DEFAULT_SESSION_LIFETIME_SECONDS = 604_800;
const MAX_SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
const MAX_SESSION_EXPIRY_TIMER_MS = 2_147_483_647;
const GOOGLE_ISSUER = 'https://accounts.google.com';
const APPLE_ISSUER = 'https://appleid.apple.com';
