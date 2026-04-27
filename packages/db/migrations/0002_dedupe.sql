-- ============================================================
-- 0002_dedupe.sql — simhash column for fuzzy content dedupe
-- ============================================================

ALTER TABLE raw_items
  ADD COLUMN IF NOT EXISTS simhash BIGINT;

CREATE INDEX IF NOT EXISTS idx_raw_items_simhash
  ON raw_items (simhash)
  WHERE simhash IS NOT NULL;

-- Scope candidate search by source + recency so the linear hamming check
-- stays cheap as the table grows.
CREATE INDEX IF NOT EXISTS idx_raw_items_source_fetched
  ON raw_items (source_id, fetched_at DESC);
