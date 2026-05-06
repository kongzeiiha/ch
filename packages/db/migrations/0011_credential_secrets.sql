-- ============================================================
-- 0011_credential_secrets.sql
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
  credential_id          CHAR(36)     NOT NULL,
  username               VARCHAR(255) NOT NULL,
  password_blob          TEXT         NOT NULL,
  last_refresh_at        TIMESTAMP(6) NULL,
  last_refresh_ok        BOOLEAN,
  last_refresh_error     VARCHAR(300),                       -- short reason
  consecutive_failures   INT          NOT NULL DEFAULT 0,
  created_at             TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at             TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (credential_id),
  KEY idx_credential_secrets_failures (consecutive_failures),
  CONSTRAINT fk_credential_secrets_credential FOREIGN KEY (credential_id)
    REFERENCES credentials(id) ON DELETE CASCADE
) ENGINE=InnoDB;
