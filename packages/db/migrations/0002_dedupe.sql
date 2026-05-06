-- ============================================================
-- 0002_dedupe.sql — simhash column for fuzzy content dedupe (MySQL 8)
-- ============================================================

ALTER TABLE raw_items
  ADD COLUMN simhash BIGINT NULL;

-- MySQL has no partial indexes; the WHERE simhash IS NOT NULL filter is dropped.
-- The index still serves the same lookups; rows with NULL simhash are simply
-- indexed too (cheap; column is small and most rows will have a value).
CREATE INDEX idx_raw_items_simhash ON raw_items (simhash);

-- Scope candidate search by source + recency so the linear hamming check
-- stays cheap as the table grows.
CREATE INDEX idx_raw_items_source_fetched
  ON raw_items (source_id, fetched_at DESC);
