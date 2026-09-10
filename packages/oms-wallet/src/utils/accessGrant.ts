import type { Address } from 'viem';

import { isAddress } from 'viem';

import type { Grant, GrantUsage, SessionInfo } from '../generated/waas.gen.js';
import type {
  RemoteAccessSession,
  SmartSessionGrant,
  SmartSessionGrantUsage
} from '../types/accessGrant.js';

import { GrantKind } from '../generated/waas.gen.js';

export function toGeneratedSmartSessionGrant(grant: SmartSessionGrant): Grant {
  if (grant.kind === 'nativeTransfer') {
    return {
      kind: GrantKind.NativeTransfer,
      nativeTransfer: { to: grant.to, limit: grant.limit.toString() }
    };
  }
  return {
    kind: GrantKind.ERC20Transfer,
    erc20Transfer: {
      token: grant.token,
      to: grant.to,
      limit: grant.limit.toString(),
      cumulative: grant.cumulative
    }
  };
}

export function fromGeneratedSmartSessionGrant(grant: Grant | undefined): SmartSessionGrant {
  if (!grant) throw invalidSessionResponse('Session contains an invalid grant');
  if (grant.kind === GrantKind.NativeTransfer && grant.nativeTransfer) {
    return {
      kind: 'nativeTransfer',
      to: ethereumAddress(grant.nativeTransfer.to, 'native transfer recipient'),
      limit: unsignedBigInt(grant.nativeTransfer.limit, 'native transfer limit')
    };
  }
  if (grant.kind === GrantKind.ERC20Transfer && grant.erc20Transfer) {
    return {
      kind: 'erc20Transfer',
      token: ethereumAddress(grant.erc20Transfer.token, 'ERC-20 token'),
      to:
        grant.erc20Transfer.to === undefined || grant.erc20Transfer.to === null
          ? undefined
          : ethereumAddress(grant.erc20Transfer.to, 'ERC-20 recipient'),
      limit: unsignedBigInt(grant.erc20Transfer.limit, 'ERC-20 transfer limit'),
      cumulative: grant.erc20Transfer.cumulative
    };
  }
  throw invalidSessionResponse('Session contains an invalid grant');
}

export function fromGeneratedRemoteAccessSession(
  session: SessionInfo | undefined
): RemoteAccessSession {
  if (
    !session ||
    !session.sessionId?.trim() ||
    !session.walletId?.trim() ||
    !session.expiresAt?.trim() ||
    !Array.isArray(session.grants?.entries)
  ) {
    throw invalidSessionResponse('Session response is missing required fields');
  }
  const chainId = Number(session.chainId);
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || chainId.toString() !== session.chainId) {
    throw invalidSessionResponse('Session contains an invalid chain ID');
  }
  return {
    sessionId: session.sessionId,
    walletId: session.walletId,
    signerAddress: ethereumAddress(session.signerAddress, 'signer address'),
    grants: session.grants.entries.map(fromGeneratedSmartSessionGrant),
    chainId,
    expiresAt: session.expiresAt
  };
}

export function fromGeneratedRemoteAccessSessions(
  sessions: SessionInfo[] | undefined
): RemoteAccessSession[] {
  if (!Array.isArray(sessions)) {
    throw invalidSessionResponse('Session-list response is missing sessions');
  }
  return sessions.map(fromGeneratedRemoteAccessSession);
}

export function fromGeneratedSmartSessionGrantUsage(
  usage: GrantUsage | undefined
): SmartSessionGrantUsage {
  if (!usage?.grant) throw invalidSessionResponse('Session usage contains an invalid grant');
  return {
    grant: fromGeneratedSmartSessionGrant(usage.grant),
    used: usage.used === undefined ? undefined : unsignedBigInt(usage.used, 'grant usage')
  };
}

export function fromGeneratedSmartSessionGrantUsages(
  entries: GrantUsage[] | undefined
): SmartSessionGrantUsage[] {
  if (!Array.isArray(entries)) {
    throw invalidSessionResponse('Session-usage response is missing entries');
  }
  return entries.map(fromGeneratedSmartSessionGrantUsage);
}

function ethereumAddress(value: string, field: string): Address {
  if (!isAddress(value)) {
    throw invalidSessionResponse(`Session contains an invalid ${field}`);
  }
  return value;
}

function unsignedBigInt(value: string, field: string): bigint {
  try {
    const parsed = BigInt(value);
    if (parsed < 0n || parsed.toString() !== value) throw new Error();
    return parsed;
  } catch {
    throw invalidSessionResponse(`Session contains an invalid ${field}`);
  }
}

function invalidSessionResponse(message: string): Error {
  const error = new Error(message);
  error.name = 'OMSWalletInvalidResponseError';
  return error;
}
