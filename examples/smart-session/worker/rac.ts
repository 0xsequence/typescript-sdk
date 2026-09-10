import {
  type CredentialSigner,
  EthereumPrivateKeyCredentialSigner,
  RemoteAccessClient
} from '@polygonlabs/oms-wallet';
import { hexToBytes, type Hex } from 'viem';

export const RAC_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

export interface RacContext {
  client: RemoteAccessClient;
  signerId: string;
}

export async function createRacContext(
  publishableKey: string,
  privateKey: string,
  db: D1Database
): Promise<RacContext> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error('RAC_PRIVATE_KEY must be a 0x-prefixed 32-byte private key');
  }

  const privateKeySigner = new EthereumPrivateKeyCredentialSigner(hexToBytes(privateKey as Hex));
  const signer = new D1CredentialSigner(privateKeySigner, db);
  return {
    client: new RemoteAccessClient({ publishableKey, credentialSigner: signer }),
    signerId: await signer.credentialId()
  };
}

class D1CredentialSigner implements CredentialSigner {
  readonly signingAlgorithm = 'ecdsa-p256k-eip191' as const;

  constructor(
    private readonly signer: EthereumPrivateKeyCredentialSigner,
    private readonly db: D1Database
  ) {}

  credentialId(): Promise<string> {
    return this.signer.credentialId();
  }

  async nextNonce(): Promise<string> {
    const signerId = await this.credentialId();
    const row = await this.db
      .prepare(
        `INSERT INTO rac_nonces (signer_id, value) VALUES (?, ?)
         ON CONFLICT(signer_id) DO UPDATE SET value = MAX(rac_nonces.value + 1, excluded.value)
         RETURNING value`
      )
      .bind(signerId, Date.now())
      .first<{ value: number }>();
    if (!row) throw new Error('Unable to allocate a RAC request nonce');
    return row.value.toString();
  }

  sign(preimage: string): Promise<string> {
    return this.signer.sign(preimage);
  }
}
