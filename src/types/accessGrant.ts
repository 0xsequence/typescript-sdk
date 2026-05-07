export interface WalletCredential {
    credentialId: string
    expiresAt: string
    isCaller: boolean
}

export type AccessGrant = WalletCredential

export interface ListAccessParams {
    pageSize?: number
}

export interface AccessGrantPage {
    grants: AccessGrant[]
}
