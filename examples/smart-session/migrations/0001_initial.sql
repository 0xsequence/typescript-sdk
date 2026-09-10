CREATE TABLE backend_racs (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  private_key TEXT,
  signer_id TEXT,
  credential_id TEXT,
  registered_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE approval_requests (
  id TEXT PRIMARY KEY,
  rac_id TEXT NOT NULL,
  token TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  credential_id TEXT NOT NULL,
  -- The Worker validates these values against its runtime allowlist before insertion.
  network_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  recipient_mode TEXT NOT NULL CHECK (recipient_mode IN ('specific', 'any')),
  recipients TEXT NOT NULL,
  allowance TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  rejected_at TEXT,
  FOREIGN KEY (rac_id) REFERENCES backend_racs(id)
);

CREATE INDEX approval_requests_rac_created_at
  ON approval_requests (rac_id, created_at DESC);

CREATE TABLE smart_sessions (
  id TEXT PRIMARY KEY,
  rac_id TEXT NOT NULL,
  approval_id TEXT NOT NULL UNIQUE,
  wallet_address TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  dismissed_at TEXT,
  FOREIGN KEY (rac_id) REFERENCES backend_racs(id),
  FOREIGN KEY (approval_id) REFERENCES approval_requests(id)
);

CREATE UNIQUE INDEX smart_sessions_session_id
  ON smart_sessions (session_id);

CREATE INDEX smart_sessions_rac_created_at
  ON smart_sessions (rac_id, created_at DESC);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  smart_session_id TEXT NOT NULL,
  txn_id TEXT NOT NULL UNIQUE,
  recipient TEXT NOT NULL,
  amount TEXT NOT NULL,
  status TEXT NOT NULL,
  txn_hash TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (smart_session_id) REFERENCES smart_sessions(id)
);

CREATE INDEX transactions_smart_session_created_at
  ON transactions (smart_session_id, created_at DESC);

CREATE TABLE rac_nonces (
  signer_id TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
