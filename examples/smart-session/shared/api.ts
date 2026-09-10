import type { SmartSessionAssetId, SmartSessionNetworkId } from './networks.js';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export type RecipientScope = { mode: 'specific'; recipients: string[] } | { mode: 'any' };

export interface ApprovalRequest {
  id: string;
  recipientScope: RecipientScope;
  allowance: string;
  expiresAt: string;
  status: ApprovalStatus;
  credentialId: string;
  networkId: SmartSessionNetworkId;
  assetId: SmartSessionAssetId;
}

export interface ClientConfig {
  publishableKey: string;
}

export interface ApproveRequestBody {
  walletAddress: string;
  sessionId: string;
}

export interface CreateApprovalBody {
  recipientScope: RecipientScope;
  allowance: string;
  expiresAt: string;
  networkId: SmartSessionNetworkId;
  assetId: SmartSessionAssetId;
}

export interface CreatedApproval {
  id: string;
  approvalUrl: string;
  expiresAt: string;
}

export interface AdminApproval {
  id: string;
  recipientScope: RecipientScope;
  allowance: string;
  expiresAt: string;
  status: ApprovalStatus;
  networkId: SmartSessionNetworkId;
  assetId: SmartSessionAssetId;
  createdAt: string;
  approvedAt?: string;
  rejectedAt?: string;
}

export type AdminSmartSessionGrant =
  | {
      kind: 'nativeTransfer';
      to: string;
      limit: string;
      used?: string;
      remaining?: string;
    }
  | {
      kind: 'erc20Transfer';
      token: string;
      to?: string;
      limit: string;
      cumulative?: boolean;
      used?: string;
      remaining?: string;
    };

export interface AdminSmartSession {
  id: string;
  walletAddress: string;
  balance?: string;
  sessionId: string;
  grants: AdminSmartSessionGrant[];
  networkId: SmartSessionNetworkId;
  assetId: SmartSessionAssetId;
  expiresAt: string;
  createdAt: string;
  status: 'usable' | 'revoked' | 'expired';
}

export interface CreateTransactionBody {
  recipient: string;
  amount: string;
}

export interface AdminTransaction {
  id: string;
  smartSessionId: string;
  walletAddress: string;
  txnId: string;
  recipient: string;
  amount: string;
  networkId: SmartSessionNetworkId;
  assetId: SmartSessionAssetId;
  status: string;
  txnHash?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminOverview {
  credential: {
    id: string;
    expiresAt: string;
  };
  approvals: AdminApproval[];
  sessions: AdminSmartSession[];
  transactions: AdminTransaction[];
}

export interface WaasErrorDetails {
  name: string;
  code: string;
  operation?: string;
  message: string;
  status?: number;
  retryable?: boolean;
  txnId?: string;
  cause?: string;
  upstreamError?: {
    service: 'waas' | 'indexer';
    name?: string;
    code?: number | string;
    message?: string;
    status?: number;
  };
}

export interface ApiError {
  error: string;
  details?: WaasErrorDetails;
}
