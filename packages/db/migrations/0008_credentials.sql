-- ============================================================
-- 0008_credentials.sql
-- Shared credential pool. Lets one cookie/UA pair be referenced by many
-- sources, so rotating an X session token doesn't require updating 50 source
-- rows. Existing inline `source.config.cookie` keeps working — `credential_id`
-- is opt-in and takes precedence when set.
-- ============================================================

CREATE TABLE IF NOT EXISTS credentials (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()),
  platform            VARCHAR(64)  NOT NULL,
  name                VARCHAR(255) NOT NULL,
  cookie              TEXT,
  user_agent          TEXT,
  status              VARCHAR(32)  NOT NULL DEFAULT 'active',  -- 'active' | 'expired' | 'revoked'
  last_used_at        TIMESTAMP(6) NULL,
  last_auth_check_at  TIMESTAMP(6) NULL,
  last_auth_ok        BOOLEAN,
  created_at          TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at          TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_credentials_platform_name (platform, name),
  KEY idx_credentials_platform_status (platform, status)
) ENGINE=InnoDB;

ALTER TABLE sources
  ADD COLUMN credential_id CHAR(36) NULL,
  ADD CONSTRAINT fk_sources_credential FOREIGN KEY (credential_id)
    REFERENCES credentials(id) ON DELETE SET NULL;

-- MySQL has no partial indexes; the WHERE credential_id IS NOT NULL filter is
-- dropped. Effect on lookups is negligible (NULL rows take one bucket).
CREATE INDEX idx_sources_credential ON sources (credential_id);
