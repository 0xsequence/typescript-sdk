import { isAddress } from 'viem';

import type { CredentialSigner } from '../credentialSigner.js';
import type { Network } from '../networks.js';
import type { RemoteAccessSession, SmartSessionGrantUsage } from '../types/accessGrant.js';
import type {
  ExecuteRemoteTransactionParams,
  ExecutedRemoteTransaction,
  ListRemoteAccessSessionsParams,
  PreparedRemoteTransaction,
  PrepareRemoteTransactionParams,
  RegisteredRemoteCredential,
  RegisterRemoteCredentialParams,
  RemoteAccessSessionPage,
  RevokeRemoteCredentialParams
} from '../types/remoteAccess.js';
import type { TransactionStatusResponse } from '../types/waas.js';

import { toOMSWalletError } from '../errors.js';
import { Waas } from '../generated/waas.gen.js';
import { environmentFromPublishableKey } from '../omsEnvironment.js';
import { RemoteAccessOperation } from '../operations.js';
import { parsePublishableKey } from '../publishableKey.js';
import { createSignedFetch } from '../signedFetch.js';
import { TransactionMode } from '../types/waas.js';
import {
  fromGeneratedRemoteAccessSession,
  fromGeneratedRemoteAccessSessions,
  fromGeneratedSmartSessionGrantUsages
} from '../utils/accessGrant.js';
import {
  fromGeneratedFeeOption,
  fromGeneratedTransactionStatus,
  fromGeneratedTransactionStatusResponse,
  toGeneratedFeeOptionSelection,
  toGeneratedTransactionMode
} from '../utils/waasTypes.js';

export interface RemoteAccessClientParams {
  publishableKey: string;
  credentialSigner: CredentialSigner;
}

/** Signs remote-application requests for owner-authorized smart sessions. */
export class RemoteAccessClient {
  readonly #client: Waas;

  constructor(params: RemoteAccessClientParams) {
    const { projectId } = parsePublishableKey(params.publishableKey);
    const { walletApiUrl } = environmentFromPublishableKey(params.publishableKey);
    this.#client = new Waas(
      walletApiUrl,
      createSignedFetch(params.publishableKey, params.credentialSigner, projectId)
    );
  }

  /** Registers the signer as a RAC and returns its WaaS credential ID. */
  async registerCredential(
    params: RegisterRemoteCredentialParams
  ): Promise<RegisteredRemoteCredential> {
    return this.#run(RemoteAccessOperation.registerCredential, async () => {
      if (!Number.isSafeInteger(params.lifetimeSeconds) || params.lifetimeSeconds <= 0) {
        throw new Error('lifetimeSeconds must be a positive safe integer');
      }
      const response = await this.#client.registerCredential({
        lifetime: params.lifetimeSeconds,
        metadata: {
          appUrl: params.metadata.appUrl,
          appName: params.metadata.appName,
          appLogoUrl: params.metadata.appLogoUrl,
          custom: { ...params.metadata.custom }
        }
      });
      return { credentialId: response.credentialId };
    });
  }

  /** Prepares an Ethereum transaction against a specific owner-authorized session. */
  async prepareTransaction(
    params: PrepareRemoteTransactionParams
  ): Promise<PreparedRemoteTransaction> {
    return this.#run(RemoteAccessOperation.prepareTransaction, async () => {
      this.#requireSession(params.walletId, params.sessionId);
      if (!isAddress(params.to)) throw new Error('to must be a valid Ethereum address');
      if (params.value !== undefined && params.value < 0n) {
        throw new Error('value must not be negative');
      }
      const response = await this.#client.prepareEthereumTransaction({
        network: params.network.id.toString(),
        walletId: params.walletId,
        sessionId: params.sessionId,
        to: params.to,
        value: (params.value ?? 0n).toString(),
        data: params.data,
        mode: toGeneratedTransactionMode(TransactionMode.Relayer)
      });
      return {
        txnId: response.txnId,
        status: fromGeneratedTransactionStatus(response.status),
        feeOptions: response.feeOptions.map(fromGeneratedFeeOption),
        sponsored: response.sponsored,
        expiresAt: response.expiresAt
      };
    });
  }

  /** Executes a transaction previously prepared by this remote credential. */
  async executeTransaction(
    params: ExecuteRemoteTransactionParams
  ): Promise<ExecutedRemoteTransaction> {
    return this.#run(RemoteAccessOperation.executeTransaction, async () => {
      if (!params.txnId.trim()) throw new Error('txnId is required');
      const response = await this.#client.execute({
        txnId: params.txnId,
        feeOption: params.feeOption ? toGeneratedFeeOptionSelection(params.feeOption) : undefined
      });
      return { status: fromGeneratedTransactionStatus(response.status) };
    });
  }

  /** Reads WaaS transaction status without polling. */
  async getTransactionStatus(params: { txnId: string }): Promise<TransactionStatusResponse> {
    return this.#run(RemoteAccessOperation.getTransactionStatus, async () => {
      if (!params.txnId.trim()) throw new Error('txnId is required');
      return fromGeneratedTransactionStatusResponse(
        await this.#client.transactionStatus({ txnId: params.txnId })
      );
    });
  }

  /** Revokes a WaaS credential ID returned by registerCredential. */
  async revokeCredential(params: RevokeRemoteCredentialParams): Promise<void> {
    return this.#run(RemoteAccessOperation.revokeCredential, async () => {
      if (!params.credentialId.trim()) throw new Error('credentialId is required');
      await this.#client.revokeCredential({ credentialId: params.credentialId });
    });
  }

  /** Lists every smart session authorized for this remote credential. */
  async listSessions(params: ListRemoteAccessSessionsParams = {}): Promise<RemoteAccessSession[]> {
    return this.#run(RemoteAccessOperation.listSessions, async () => {
      const sessions: RemoteAccessSession[] = [];
      for await (const page of this.#listSessionPagesUnchecked(params)) {
        sessions.push(...page.sessions);
      }
      return sessions;
    });
  }

  /** Streams smart sessions page by page. */
  async *listSessionPages(
    params: ListRemoteAccessSessionsParams = {}
  ): AsyncIterable<RemoteAccessSessionPage> {
    try {
      yield* this.#listSessionPagesUnchecked(params);
    } catch (error) {
      throw toOMSWalletError(error, RemoteAccessOperation.listSessionPages);
    }
  }

  /** Reads one smart session authorized for this remote credential. */
  async getSession(params: { sessionId: string }): Promise<RemoteAccessSession> {
    return this.#run(RemoteAccessOperation.getSession, async () => {
      this.#requireSessionId(params.sessionId);
      const response = await this.#client.getSession({ sessionId: params.sessionId });
      return fromGeneratedRemoteAccessSession(response.session);
    });
  }

  /** Reads grant usage for one smart session on a network. */
  async getSessionUsage(params: {
    sessionId: string;
    network: Network;
  }): Promise<SmartSessionGrantUsage[]> {
    return this.#run(RemoteAccessOperation.getSessionUsage, async () => {
      this.#requireSessionId(params.sessionId);
      const response = await this.#client.getSessionUsage({
        sessionId: params.sessionId,
        network: params.network.id.toString()
      });
      return fromGeneratedSmartSessionGrantUsages(response.entries);
    });
  }

  async *#listSessionPagesUnchecked(
    params: ListRemoteAccessSessionsParams
  ): AsyncIterable<RemoteAccessSessionPage> {
    if (
      params.pageSize !== undefined &&
      (!Number.isSafeInteger(params.pageSize) || params.pageSize <= 0)
    ) {
      throw new Error('pageSize must be a positive safe integer');
    }

    let cursor: string | undefined;
    do {
      const page =
        params.pageSize === undefined && cursor === undefined
          ? undefined
          : { limit: params.pageSize, cursor };
      const response = await this.#client.listSessions({ page });
      cursor = response.page?.cursor || undefined;
      yield { sessions: fromGeneratedRemoteAccessSessions(response.sessions) };
    } while (cursor);
  }

  #requireSession(walletId: string, sessionId: string): void {
    if (!walletId.trim()) throw new Error('walletId is required');
    if (!sessionId.trim()) throw new Error('sessionId is required');
  }

  #requireSessionId(sessionId: string): void {
    if (!sessionId.trim()) throw new Error('sessionId is required');
  }

  async #run<T>(
    operation: (typeof RemoteAccessOperation)[keyof typeof RemoteAccessOperation],
    action: () => Promise<T>
  ): Promise<T> {
    try {
      return await action();
    } catch (error) {
      throw toOMSWalletError(error, operation);
    }
  }
}
