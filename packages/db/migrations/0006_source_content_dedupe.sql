-- ============================================================
-- 0006_source_content_dedupe.sql
-- Composite index to make per-source content_hash lookups cheap.
-- Used by ingestion's contentAlreadySeenForSource() to catch
-- re-posts that flip external_id but keep the same content.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_raw_items_source_content_hash
  ON raw_items (source_id, content_hash);
