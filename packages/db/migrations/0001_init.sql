-- ============================================================
-- 0001_init.sql — core schema for the 9-agent content pipeline
-- ============================================================

-- ---------- sources ----------
CREATE TABLE IF NOT EXISTS sources (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform      TEXT NOT NULL,
  external_id   TEXT NOT NULL,
  name          TEXT NOT NULL,
  url           TEXT,
  score         INTEGER NOT NULL DEFAULT 50,
  risk_level    TEXT NOT NULL DEFAULT 'low',
  stability     INTEGER NOT NULL DEFAULT 50,
  status        TEXT NOT NULL DEFAULT 'active',
  config        JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_fetch_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (platform, external_id)
);
CREATE INDEX IF NOT EXISTS idx_sources_status ON sources (status);

-- ---------- raw_items ----------
CREATE TABLE IF NOT EXISTS raw_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id    UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  url          TEXT,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_payload  JSONB NOT NULL,
  media_urls   TEXT[] NOT NULL DEFAULT '{}',
  content_hash TEXT NOT NULL,
  dedupe_key   TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_raw_items_source ON raw_items (source_id);
CREATE INDEX IF NOT EXISTS idx_raw_items_hash   ON raw_items (content_hash);

-- ---------- items ----------
-- status: INGESTED -> CLASSIFIED -> TITLED -> COVERED -> COMPLIANCE_PASS|COMPLIANCE_FAIL -> PUBLISHED -> DISTRIBUTED
CREATE TABLE IF NOT EXISTS items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_item_id         UUID NOT NULL REFERENCES raw_items(id) ON DELETE CASCADE,
  source_id           UUID NOT NULL REFERENCES sources(id),
  status              TEXT NOT NULL DEFAULT 'INGESTED',
  category            TEXT,
  tags                TEXT[] NOT NULL DEFAULT '{}',
  keywords            TEXT[] NOT NULL DEFAULT '{}',
  embedding           TEXT,
  title               TEXT,
  title_version       INTEGER NOT NULL DEFAULT 0,
  summary             TEXT,
  slug                TEXT UNIQUE,
  cover_url           TEXT,
  cover_copy          TEXT,
  compliance_status   TEXT,
  risk_tags           TEXT[] NOT NULL DEFAULT '{}',
  compliance_reasons  JSONB,
  content             TEXT,
  content_html        TEXT,
  published_url       TEXT,
  published_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_items_status   ON items (status);
CREATE INDEX IF NOT EXISTS idx_items_source   ON items (source_id);
CREATE INDEX IF NOT EXISTS idx_items_category ON items (category);

-- ---------- distribution_tasks ----------
CREATE TABLE IF NOT EXISTS distribution_tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id      UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  channel      TEXT NOT NULL,
  copy         TEXT NOT NULL,
  media        JSONB NOT NULL DEFAULT '[]'::jsonb,
  status       TEXT NOT NULL DEFAULT 'pending',
  scheduled_at TIMESTAMPTZ,
  executed_at  TIMESTAMPTZ,
  result       JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dist_item   ON distribution_tasks (item_id);
CREATE INDEX IF NOT EXISTS idx_dist_status ON distribution_tasks (status);

-- ---------- analytics_daily ----------
CREATE TABLE IF NOT EXISTS analytics_daily (
  item_id      UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  channel      TEXT NOT NULL DEFAULT 'site',
  pv           INTEGER NOT NULL DEFAULT 0,
  uv           INTEGER NOT NULL DEFAULT 0,
  ctr          NUMERIC(6,4),
  avg_duration INTEGER,
  rpm          NUMERIC(10,4),
  revenue      NUMERIC(12,4) NOT NULL DEFAULT 0,
  raw          JSONB,
  PRIMARY KEY (item_id, date, channel)
);
CREATE INDEX IF NOT EXISTS idx_analytics_date ON analytics_daily (date);

-- ---------- agent_runs ----------
CREATE TABLE IF NOT EXISTS agent_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent             TEXT NOT NULL,
  item_id           UUID,
  input_hash        TEXT,
  output            JSONB,
  status            TEXT NOT NULL,
  error             TEXT,
  model             TEXT,
  input_tokens      INTEGER,
  output_tokens     INTEGER,
  cache_read_tokens INTEGER,
  cost_usd          NUMERIC(10,6),
  latency_ms        INTEGER,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent  ON agent_runs (agent);
CREATE INDEX IF NOT EXISTS idx_agent_runs_item   ON agent_runs (item_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs (status);

-- ---------- updated_at triggers ----------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sources_updated ON sources;
CREATE TRIGGER trg_sources_updated BEFORE UPDATE ON sources
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_items_updated ON items;
CREATE TRIGGER trg_items_updated BEFORE UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
