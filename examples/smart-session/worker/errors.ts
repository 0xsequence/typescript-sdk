import { isOMSWalletError } from '@polygonlabs/oms-wallet';

import type { WaasErrorDetails } from '../shared/api.js';

export function serializeWaasError(error: unknown): WaasErrorDetails | undefined {
  if (!isOMSWalletError(error)) return undefined;

  const cause = upstreamCause(error.cause);
  return {
    name: error.name,
    code: error.code,
    ...(error.operation === undefined ? {} : { operation: error.operation }),
    message: error.message,
    ...(error.status === undefined ? {} : { status: error.status }),
    ...(error.retryable === undefined ? {} : { retryable: error.retryable }),
    ...(error.txnId === undefined ? {} : { txnId: error.txnId }),
    ...(cause === undefined ? {} : { cause }),
    ...(error.upstreamError === undefined ? {} : { upstreamError: error.upstreamError })
  };
}

function upstreamCause(cause: unknown): string | undefined {
  if (typeof cause === 'string') return cause;
  if (cause instanceof Error && typeof cause.cause === 'string') return cause.cause;
  return undefined;
}
