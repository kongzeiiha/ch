-- ============================================================
-- 0009_credential_secrets.sql
-- Stores encrypted X username/password against a credential, so the system
-- can refresh an expired cookie via stealth Playwright login without needing
-- a human to re-paste cookies every couple of weeks.
--
-- The password is NEVER stored in plaintext. Encryption is AES-256-GCM with
-- a key from CREDENTIAL_SECRET_KEY env var (32 bytes, hex-encoded). Format:
--     password_blob = base64(iv) || ":" || base64(ciphertext) || ":" || base64(tag)
-- One credential has at most one secret (PK = credential_id).
-- ============================================================

CREATE TABLE IF NOT EXISTS credential_secrets (
  credential_id          uuid PRIMARY KEY REFERENCES credentials(id) ON DELETE CASCADE,
  username               text NOT NULL,
  password_blob          text NOT NULL,
  last_refresh_at        timestamptz,
  last_refresh_ok        boolean,
  last_refresh_error     text,                       -- short reason (≤300 chars)
  consecutive_failures   int  NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT NOW(),
  updated_at             timestamptz NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_credential_secrets_updated ON credential_secrets;
CREATE TRIGGER trg_credential_secrets_updated
  BEFORE UPDATE ON credential_secrets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_credential_secrets_failures
  ON credential_secrets (consecutive_failures) WHERE consecutive_failures > 0;
