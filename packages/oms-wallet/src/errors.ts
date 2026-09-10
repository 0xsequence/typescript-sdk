import type { OMSWalletOperation } from './operations.js';

export const attestationVerificationErrorPrefix = 'WaaS attestation verification failed: ';

export type OMSWalletErrorCode =
  | 'OMS_HTTP_ERROR'
  | 'OMS_INVALID_RESPONSE'
  | 'OMS_REQUEST_FAILED'
  | 'OMS_AUTH_COMMITMENT_CONSUMED'
  | 'OMS_WALLET_ADDRESS_ALREADY_IMPORTED'
  | 'OMS_ATTESTATION_VERIFICATION_FAILED'
  | 'OMS_SESSION_MISSING'
  | 'OMS_SESSION_EXPIRED'
  | 'OMS_WALLET_SELECTION_STALE'
  | 'OMS_WALLET_SELECTION_UNAVAILABLE'
  | 'OMS_WALLET_SELECTION_IN_FLIGHT'
  | 'OMS_TRANSACTION_EXECUTION_UNCONFIRMED'
  | 'OMS_TRANSACTION_STATUS_LOOKUP_FAILED'
  | 'OMS_VALIDATION_ERROR'
  | 'OMS_STORAGE_ERROR';

export interface OMSWalletUpstreamError {
  service: 'waas' | 'indexer';
  name?: string;
  code?: number | string;
  message?: string;
  status?: number;
}

export interface OMSWalletErrorParams<Code extends OMSWalletErrorCode = OMSWalletErrorCode> {
  code: Code;
  message: string;
  operation?: string;
  status?: number;
  txnId?: string;
  retryable?: boolean;
  upstreamError?: OMSWalletUpstreamError;
  cause?: unknown;
}

export abstract class OMSWalletError extends Error {
  readonly code: OMSWalletErrorCode;
  readonly operation?: string;
  readonly status?: number;
  readonly txnId?: string;
  readonly retryable?: boolean;
  readonly upstreamError?: OMSWalletUpstreamError;

  protected constructor(params: OMSWalletErrorParams) {
    super(params.message);
    this.name = 'OMSWalletError';
    this.code = params.code;
    this.operation = params.operation;
    this.status = params.status;
    this.txnId = params.txnId;
    this.retryable = params.retryable;
    this.upstreamError = params.upstreamError;
    if (params.cause !== undefined) {
      this.cause = params.cause;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

type OMSWalletSessionErrorCode = 'OMS_SESSION_MISSING' | 'OMS_SESSION_EXPIRED';
type OMSWalletRequestErrorCode =
  | 'OMS_HTTP_ERROR'
  | 'OMS_REQUEST_FAILED'
  | 'OMS_AUTH_COMMITMENT_CONSUMED'
  | 'OMS_WALLET_ADDRESS_ALREADY_IMPORTED';
type OMSWalletResponseErrorCode = 'OMS_INVALID_RESPONSE' | 'OMS_ATTESTATION_VERIFICATION_FAILED';
type OMSWalletTransactionErrorCode =
  'OMS_TRANSACTION_EXECUTION_UNCONFIRMED' | 'OMS_TRANSACTION_STATUS_LOOKUP_FAILED';
type OMSWalletSelectionErrorCode =
  | 'OMS_WALLET_SELECTION_STALE'
  | 'OMS_WALLET_SELECTION_UNAVAILABLE'
  | 'OMS_WALLET_SELECTION_IN_FLIGHT';
type OMSWalletValidationErrorCode = 'OMS_VALIDATION_ERROR';
type OMSWalletStorageErrorCode = 'OMS_STORAGE_ERROR';

export class OMSWalletSessionError extends OMSWalletError {
  constructor(
    params: Omit<OMSWalletErrorParams<OMSWalletSessionErrorCode>, 'code'> & {
      code?: OMSWalletSessionErrorCode;
    }
  ) {
    super({ ...params, code: params.code ?? 'OMS_SESSION_MISSING' });
    this.name = 'OMSWalletSessionError';
  }
}

export class OMSWalletRequestError extends OMSWalletError {
  constructor(
    params: Omit<OMSWalletErrorParams<OMSWalletRequestErrorCode>, 'code'> & {
      code?: OMSWalletRequestErrorCode;
    }
  ) {
    super({ ...params, code: params.code ?? 'OMS_REQUEST_FAILED' });
    this.name = 'OMSWalletRequestError';
  }
}

export class OMSWalletResponseError extends OMSWalletError {
  constructor(
    params: Omit<OMSWalletErrorParams<OMSWalletResponseErrorCode>, 'code'> & {
      code?: OMSWalletResponseErrorCode;
    }
  ) {
    super({ ...params, code: params.code ?? 'OMS_INVALID_RESPONSE' });
    this.name = 'OMSWalletResponseError';
  }
}

export class OMSWalletTransactionError extends OMSWalletError {
  constructor(
    params: Omit<OMSWalletErrorParams<OMSWalletTransactionErrorCode>, 'code'> & {
      code?: OMSWalletTransactionErrorCode;
    }
  ) {
    super({ ...params, code: params.code ?? 'OMS_TRANSACTION_STATUS_LOOKUP_FAILED' });
    this.name = 'OMSWalletTransactionError';
  }
}

export class OMSWalletSelectionError extends OMSWalletError {
  constructor(params: OMSWalletErrorParams<OMSWalletSelectionErrorCode>) {
    super(params);
    this.name = 'OMSWalletSelectionError';
  }
}

export class OMSWalletValidationError extends OMSWalletError {
  constructor(
    params: Omit<OMSWalletErrorParams<OMSWalletValidationErrorCode>, 'code'> & {
      code?: OMSWalletValidationErrorCode;
    }
  ) {
    super({ ...params, code: params.code ?? 'OMS_VALIDATION_ERROR' });
    this.name = 'OMSWalletValidationError';
  }
}

export class OMSWalletStorageError extends OMSWalletError {
  constructor(
    params: Omit<OMSWalletErrorParams<OMSWalletStorageErrorCode>, 'code'> & {
      code?: OMSWalletStorageErrorCode;
    }
  ) {
    super({ ...params, code: params.code ?? 'OMS_STORAGE_ERROR' });
    this.name = 'OMSWalletStorageError';
  }
}

export function isOMSWalletError(error: unknown): error is OMSWalletError {
  return error instanceof OMSWalletError;
}

export function toOMSWalletError(
  error: unknown,
  operation: OMSWalletOperation,
  upstreamService: OMSWalletUpstreamError['service'] = 'waas'
): OMSWalletError {
  if (isOMSWalletError(error)) {
    return error;
  }

  const status = statusFromError(error);
  const name = error instanceof Error ? error.name : undefined;
  const generatedCode = generatedCodeFromError(error);
  const upstreamError = upstreamErrorFromError(error, upstreamService);
  const attestationErrorMessage = attestationVerificationMessage(error);

  if (name === 'OMSWalletInvalidResponseError') {
    return new OMSWalletResponseError({
      operation,
      cause: error,
      message: errorMessage(error)
    });
  }

  if (attestationErrorMessage !== undefined) {
    return new OMSWalletResponseError({
      code: 'OMS_ATTESTATION_VERIFICATION_FAILED',
      operation,
      retryable: false,
      cause: error,
      message: attestationErrorMessage
    });
  }

  if (name === 'AddressAlreadyImported' || generatedCode === 7313) {
    return new OMSWalletRequestError({
      code: 'OMS_WALLET_ADDRESS_ALREADY_IMPORTED',
      operation,
      status: 409,
      retryable: false,
      upstreamError,
      cause: error,
      message: errorMessage(error)
    });
  }

  if (
    (operation === 'wallet.importWallet' || operation === 'wallet.importEncryptedWallet') &&
    (name === 'InvalidRequest' || generatedCode === 7200)
  ) {
    return new OMSWalletValidationError({
      operation,
      upstreamError,
      cause: error,
      message: errorMessage(error)
    });
  }

  if (name === 'CommitmentConsumed' || generatedCode === 7008) {
    return new OMSWalletRequestError({
      code: 'OMS_AUTH_COMMITMENT_CONSUMED',
      operation,
      status,
      retryable: false,
      upstreamError,
      cause: error,
      message: errorMessage(error)
    });
  }

  if (name === 'WebrpcBadResponse') {
    if (isHttpStatus(status)) {
      return new OMSWalletRequestError({
        code: 'OMS_HTTP_ERROR',
        operation,
        status,
        retryable: status >= 500,
        upstreamError,
        cause: error,
        message: errorMessage(error)
      });
    }

    return new OMSWalletResponseError({
      operation,
      status,
      upstreamError,
      cause: error,
      message: errorMessage(error)
    });
  }

  if (isHttpStatus(status) && name?.startsWith('Webrpc') && name !== 'WebrpcRequestFailed') {
    return new OMSWalletRequestError({
      code: 'OMS_HTTP_ERROR',
      operation,
      status,
      retryable: status >= 500,
      upstreamError,
      cause: error,
      message: errorMessage(error)
    });
  }

  if (!name?.startsWith('Webrpc') && status === undefined) {
    return new OMSWalletValidationError({
      operation,
      cause: error,
      message: errorMessage(error)
    });
  }

  return new OMSWalletRequestError({
    operation,
    status,
    retryable: name === 'WebrpcRequestFailed' || status === undefined || status >= 500,
    upstreamError,
    cause: error,
    message: errorMessage(error)
  });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function attestationVerificationMessage(error: unknown): string | undefined {
  if (error instanceof Error && error.name === 'OMSWalletAttestationVerificationError') {
    return error.message.replace(attestationVerificationErrorPrefix, '');
  }
  const cause = (error as { cause?: unknown } | undefined)?.cause;
  if (typeof cause !== 'string') return undefined;
  const prefixIndex = cause.indexOf(attestationVerificationErrorPrefix);
  return prefixIndex === -1
    ? undefined
    : cause.slice(prefixIndex + attestationVerificationErrorPrefix.length);
}

function statusFromError(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | undefined)?.status;
  const code = generatedCodeFromError(error);
  const name = error instanceof Error ? error.name : undefined;
  if (name === 'WebrpcRequestFailed' && code === -1 && status === 400) {
    return undefined;
  }
  return typeof status === 'number' ? status : undefined;
}

function generatedCodeFromError(error: unknown): number | undefined {
  const code = (error as { code?: unknown } | undefined)?.code;
  return typeof code === 'number' ? code : undefined;
}

function isHttpStatus(status: number | undefined): status is number {
  return status !== undefined && status >= 400;
}

function upstreamErrorFromError(
  error: unknown,
  service: OMSWalletUpstreamError['service']
): OMSWalletUpstreamError | undefined {
  const name = error instanceof Error ? error.name : undefined;
  const code = generatedCodeFromError(error);
  const status = statusFromError(error);

  if (!name?.startsWith('Webrpc') && code === undefined && status === undefined) {
    return undefined;
  }

  return {
    service,
    name,
    code,
    message: errorMessage(error),
    status
  };
}
