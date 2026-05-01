-- ============================================================
-- 0008_credentials.sql
-- Shared credential pool. Lets one cookie/UA pair be referenced by many
-- sources, so rotating an X session token doesn't require updating 50 source
-- rows. Existing inline `source.config.cookie` keeps working — `credential_id`
-- is opt-in and takes precedence when set.
-- ============================================================

CREATE TABLE IF NOT EXISTS credentials (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform            text NOT NULL,
  name                text NOT NULL,
  cookie              text,
  user_agent          text,
  status              text NOT NULL DEFAULT 'active',  -- 'active' | 'expired' | 'revoked'
  last_used_at        timestamptz,
  last_auth_check_at  timestamptz,
  last_auth_ok        boolean,
  created_at          timestamptz NOT NULL DEFAULT NOW(),
  updated_at          timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (platform, name)
);

CREATE INDEX IF NOT EXISTS idx_credentials_platform_status
  ON credentials (platform, status);

DROP TRIGGER IF EXISTS trg_credentials_updated ON credentials;
CREATE TRIGGER trg_credentials_updated
  BEFORE UPDATE ON credentials
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS credential_id uuid REFERENCES credentials(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sources_credential
  ON sources (credential_id) WHERE credential_id IS NOT NULL;
