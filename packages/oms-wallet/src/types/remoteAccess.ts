import type { Address, Hex } from 'viem';

import type { Network } from '../networks.js';
import type { RemoteAccessSession, RemoteCredentialMetadata } from './accessGrant.js';
import type { FeeOption, FeeOptionSelection, TransactionStatus } from './waas.js';

export interface RegisterRemoteCredentialParams {
  lifetimeSeconds: number;
  metadata: RemoteCredentialMetadata;
}

export interface RegisteredRemoteCredential {
  credentialId: string;
}

export interface RevokeRemoteCredentialParams {
  credentialId: string;
}

export interface ListRemoteAccessSessionsParams {
  pageSize?: number;
}

export interface RemoteAccessSessionPage {
  sessions: RemoteAccessSession[];
}

export interface PrepareRemoteTransactionParams {
  walletId: string;
  sessionId: string;
  network: Network;
  to: Address;
  value?: bigint;
  data?: Hex;
}

export interface PreparedRemoteTransaction {
  txnId: string;
  status: TransactionStatus;
  feeOptions: ReadonlyArray<FeeOption>;
  sponsored: boolean;
  expiresAt: string;
}

export interface ExecuteRemoteTransactionParams {
  txnId: string;
  feeOption?: FeeOptionSelection;
}

export interface ExecutedRemoteTransaction {
  status: TransactionStatus;
}
