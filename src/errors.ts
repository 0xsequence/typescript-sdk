import type {OmsSdkOperation} from "./operations.js";

export type OmsSdkErrorCode =
    | "OMS_HTTP_ERROR"
    | "OMS_INVALID_RESPONSE"
    | "OMS_REQUEST_FAILED"
    | "OMS_AUTH_COMMITMENT_CONSUMED"
    | "OMS_SESSION_MISSING"
    | "OMS_SESSION_EXPIRED"
    | "OMS_WALLET_SELECTION_STALE"
    | "OMS_WALLET_SELECTION_UNAVAILABLE"
    | "OMS_WALLET_SELECTION_IN_FLIGHT"
    | "OMS_TRANSACTION_STATUS_LOOKUP_FAILED"
    | "OMS_VALIDATION_ERROR"

export interface OmsSdkErrorParams {
    code: OmsSdkErrorCode
    message: string
    operation?: string
    status?: number
    txnId?: string
    retryable?: boolean
    cause?: unknown
}

export class OmsSdkError extends Error {
    readonly code: OmsSdkErrorCode
    readonly operation?: string
    readonly status?: number
    readonly txnId?: string
    readonly retryable?: boolean

    constructor(params: OmsSdkErrorParams) {
        super(params.message)
        this.name = "OmsSdkError"
        this.code = params.code
        this.operation = params.operation
        this.status = params.status
        this.txnId = params.txnId
        this.retryable = params.retryable
        if (params.cause !== undefined) {
            this.cause = params.cause
        }
        Object.setPrototypeOf(this, new.target.prototype)
    }
}

export class OmsSessionError extends OmsSdkError {
    constructor(params: Omit<OmsSdkErrorParams, "code"> & { code?: OmsSdkErrorCode }) {
        super({code: params.code ?? "OMS_SESSION_MISSING", ...params})
        this.name = "OmsSessionError"
    }
}

export class OmsRequestError extends OmsSdkError {
    constructor(params: Omit<OmsSdkErrorParams, "code"> & { code?: OmsSdkErrorCode }) {
        super({code: params.code ?? "OMS_REQUEST_FAILED", ...params})
        this.name = "OmsRequestError"
    }
}

export class OmsResponseError extends OmsSdkError {
    constructor(params: Omit<OmsSdkErrorParams, "code"> & { code?: OmsSdkErrorCode }) {
        super({code: params.code ?? "OMS_INVALID_RESPONSE", ...params})
        this.name = "OmsResponseError"
    }
}

export class OmsTransactionError extends OmsSdkError {
    constructor(params: Omit<OmsSdkErrorParams, "code"> & { code?: OmsSdkErrorCode }) {
        super({code: params.code ?? "OMS_TRANSACTION_STATUS_LOOKUP_FAILED", ...params})
        this.name = "OmsTransactionError"
    }
}

export class OmsWalletSelectionError extends OmsSdkError {
    constructor(params: Omit<OmsSdkErrorParams, "code"> & {
        code:
            | "OMS_WALLET_SELECTION_STALE"
            | "OMS_WALLET_SELECTION_UNAVAILABLE"
            | "OMS_WALLET_SELECTION_IN_FLIGHT"
    }) {
        super(params)
        this.name = "OmsWalletSelectionError"
    }
}

export class OmsValidationError extends OmsSdkError {
    constructor(params: Omit<OmsSdkErrorParams, "code"> & { code?: OmsSdkErrorCode }) {
        super({code: params.code ?? "OMS_VALIDATION_ERROR", ...params})
        this.name = "OmsValidationError"
    }
}

export function isOmsSdkError(error: unknown): error is OmsSdkError {
    return error instanceof OmsSdkError
}

export function toOmsSdkError(error: unknown, operation: OmsSdkOperation): OmsSdkError {
    if (isOmsSdkError(error)) {
        return error
    }

    const status = statusFromError(error)
    const name = error instanceof Error ? error.name : undefined
    const generatedCode = generatedCodeFromError(error)

    if (name === "CommitmentConsumed" || generatedCode === 7008) {
        return new OmsRequestError({
            code: "OMS_AUTH_COMMITMENT_CONSUMED",
            operation,
            status,
            retryable: false,
            cause: error,
            message: errorMessage(error),
        })
    }

    if (name === "WebrpcBadResponse") {
        if (isHttpStatus(status)) {
            return new OmsRequestError({
                code: "OMS_HTTP_ERROR",
                operation,
                status,
                retryable: status >= 500,
                cause: error,
                message: errorMessage(error),
            })
        }

        return new OmsResponseError({
            operation,
            status,
            cause: error,
            message: errorMessage(error),
        })
    }

    if (isHttpStatus(status) && name?.startsWith("Webrpc") && name !== "WebrpcRequestFailed") {
        return new OmsRequestError({
            code: "OMS_HTTP_ERROR",
            operation,
            status,
            retryable: status >= 500,
            cause: error,
            message: errorMessage(error),
        })
    }

    if (!name?.startsWith("Webrpc") && status === undefined) {
        return new OmsValidationError({
            operation,
            cause: error,
            message: errorMessage(error),
        })
    }

    return new OmsRequestError({
        operation,
        status,
        retryable: name === "WebrpcRequestFailed" || status === undefined || status >= 500,
        cause: error,
        message: errorMessage(error),
    })
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function statusFromError(error: unknown): number | undefined {
    const status = (error as {status?: unknown} | undefined)?.status
    return typeof status === "number" ? status : undefined
}

function generatedCodeFromError(error: unknown): number | undefined {
    const code = (error as {code?: unknown} | undefined)?.code
    return typeof code === "number" ? code : undefined
}

function isHttpStatus(status: number | undefined): status is number {
    return status !== undefined && status >= 400
}
