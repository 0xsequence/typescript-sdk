import type { Address } from 'viem';

import type { Network } from '../networks.js';

export interface WalletCredential {
  credentialId: string;
  expiresAt: string;
  isCaller: boolean;
}

export interface RemoteCredentialMetadata {
  appUrl: string;
  appName: string;
  appLogoUrl: string;
  custom: Readonly<Record<string, string>>;
}

export type SmartSessionGrant =
  | {
      kind: 'nativeTransfer';
      to: Address;
      limit: bigint;
    }
  | {
      kind: 'erc20Transfer';
      token: Address;
      to?: Address;
      limit: bigint;
      cumulative?: boolean;
    };

export interface DirectAccessGrant extends WalletCredential {
  type: 'direct';
}

export interface RemoteAccessGrant extends WalletCredential {
  type: 'remote';
  sessionId: string;
  metadata: RemoteCredentialMetadata;
  grants: ReadonlyArray<SmartSessionGrant>;
}

export type AccessGrant = DirectAccessGrant | RemoteAccessGrant;

export interface ListAccessParams {
  pageSize?: number;
  type?: AccessGrant['type'];
}

export interface AccessGrantPage {
  grants: AccessGrant[];
}

export interface AuthorizeRemoteAccessParams {
  credentialId: string;
  network: Network;
  grants: ReadonlyArray<SmartSessionGrant>;
  expiresAt: string;
  sessionId?: string;
}

export interface AuthorizedRemoteAccess {
  walletId: string;
  sessionId: string;
  expiresAt: string;
}

export interface RemoteAccessSession {
  sessionId: string;
  walletId: string;
  signerAddress: Address;
  grants: ReadonlyArray<SmartSessionGrant>;
  chainId: number;
  expiresAt: string;
}

export interface SmartSessionGrantUsage {
  grant: SmartSessionGrant;
  used?: bigint;
}

export interface RevokeAccessParams {
  credentialId: string;
  sessionId?: string;
}
