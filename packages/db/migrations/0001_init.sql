-- ============================================================
-- 0001_init.sql — core schema for the 9-agent content pipeline (MySQL 8)
-- ============================================================

-- ---------- sources ----------
CREATE TABLE IF NOT EXISTS sources (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()),
  platform      VARCHAR(64)  NOT NULL,
  external_id   VARCHAR(255) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  url           TEXT,
  score         INT          NOT NULL DEFAULT 50,
  risk_level    VARCHAR(32)  NOT NULL DEFAULT 'low',
  stability     INT          NOT NULL DEFAULT 50,
  status        VARCHAR(32)  NOT NULL DEFAULT 'active',
  config        JSON         NOT NULL DEFAULT (JSON_OBJECT()),
  last_fetch_at TIMESTAMP(6) NULL,
  created_at    TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at    TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sources_platform_external (platform, external_id),
  KEY idx_sources_status (status)
) ENGINE=InnoDB;

-- ---------- raw_items ----------
CREATE TABLE IF NOT EXISTS raw_items (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()),
  source_id    CHAR(36)     NOT NULL,
  url          TEXT,
  fetched_at   TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  raw_payload  JSON         NOT NULL,
  media_urls   JSON         NOT NULL DEFAULT (JSON_ARRAY()),
  content_hash VARCHAR(128) NOT NULL,
  dedupe_key   VARCHAR(255) NOT NULL,
  created_at   TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_raw_items_dedupe_key (dedupe_key),
  KEY idx_raw_items_source (source_id),
  KEY idx_raw_items_hash   (content_hash),
  CONSTRAINT fk_raw_items_source FOREIGN KEY (source_id)
    REFERENCES sources(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------- items ----------
-- status: INGESTED -> CLASSIFIED -> TITLED -> COVERED -> COMPLIANCE_PASS|COMPLIANCE_FAIL -> PUBLISHED -> DISTRIBUTED
CREATE TABLE IF NOT EXISTS items (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()),
  raw_item_id         CHAR(36)     NOT NULL,
  source_id           CHAR(36)     NOT NULL,
  status              VARCHAR(32)  NOT NULL DEFAULT 'INGESTED',
  category            VARCHAR(64),
  tags                JSON         NOT NULL DEFAULT (JSON_ARRAY()),
  keywords            JSON         NOT NULL DEFAULT (JSON_ARRAY()),
  embedding           TEXT,
  title               TEXT,
  title_version       INT          NOT NULL DEFAULT 0,
  summary             TEXT,
  slug                VARCHAR(255) UNIQUE,
  cover_url           TEXT,
  cover_copy          TEXT,
  compliance_status   VARCHAR(32),
  risk_tags           JSON         NOT NULL DEFAULT (JSON_ARRAY()),
  compliance_reasons  JSON,
  content             MEDIUMTEXT,
  content_html        MEDIUMTEXT,
  published_url       TEXT,
  published_at        TIMESTAMP(6) NULL,
  created_at          TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at          TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_items_status   (status),
  KEY idx_items_source   (source_id),
  KEY idx_items_category (category),
  CONSTRAINT fk_items_raw_item FOREIGN KEY (raw_item_id)
    REFERENCES raw_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_items_source FOREIGN KEY (source_id)
    REFERENCES sources(id)
) ENGINE=InnoDB;

-- ---------- distribution_tasks ----------
CREATE TABLE IF NOT EXISTS distribution_tasks (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()),
  item_id      CHAR(36)     NOT NULL,
  channel      VARCHAR(64)  NOT NULL,
  copy         TEXT         NOT NULL,
  media        JSON         NOT NULL DEFAULT (JSON_ARRAY()),
  status       VARCHAR(32)  NOT NULL DEFAULT 'pending',
  scheduled_at TIMESTAMP(6) NULL,
  executed_at  TIMESTAMP(6) NULL,
  result       JSON,
  created_at   TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_dist_item   (item_id),
  KEY idx_dist_status (status),
  CONSTRAINT fk_dist_item FOREIGN KEY (item_id)
    REFERENCES items(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------- analytics_daily ----------
CREATE TABLE IF NOT EXISTS analytics_daily (
  item_id      CHAR(36)        NOT NULL,
  date         DATE            NOT NULL,
  channel      VARCHAR(32)     NOT NULL DEFAULT 'site',
  pv           INT             NOT NULL DEFAULT 0,
  uv           INT             NOT NULL DEFAULT 0,
  ctr          DECIMAL(6,4),
  avg_duration INT,
  rpm          DECIMAL(10,4),
  revenue      DECIMAL(12,4)   NOT NULL DEFAULT 0,
  raw          JSON,
  PRIMARY KEY (item_id, date, channel),
  KEY idx_analytics_date (date),
  CONSTRAINT fk_analytics_item FOREIGN KEY (item_id)
    REFERENCES items(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------- agent_runs ----------
CREATE TABLE IF NOT EXISTS agent_runs (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()),
  agent             VARCHAR(64)  NOT NULL,
  item_id           CHAR(36),
  input_hash        VARCHAR(128),
  output            JSON,
  status            VARCHAR(32)  NOT NULL,
  error             TEXT,
  model             VARCHAR(128),
  input_tokens      INT,
  output_tokens     INT,
  cache_read_tokens INT,
  cost_usd          DECIMAL(10,6),
  latency_ms        INT,
  started_at        TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  finished_at       TIMESTAMP(6) NULL,
  PRIMARY KEY (id),
  KEY idx_agent_runs_agent  (agent),
  KEY idx_agent_runs_item   (item_id),
  KEY idx_agent_runs_status (status)
) ENGINE=InnoDB;

-- updated_at is automatic via `ON UPDATE CURRENT_TIMESTAMP(6)` on the column itself.
-- (PG required a trigger; MySQL has the clause built in.)
