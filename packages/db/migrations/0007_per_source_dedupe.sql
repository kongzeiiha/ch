-- ============================================================
-- 0007_per_source_dedupe.sql
-- Switch raw_items.dedupe_key from GLOBAL unique to (source_id, dedupe_key)
-- unique. Lets two sources scrape the same upstream account/tweet and each
-- keep their own copy. Per-source content_hash dedupe (added in 0006) still
-- prevents within-source duplicates.
-- ============================================================

ALTER TABLE raw_items DROP CONSTRAINT IF EXISTS raw_items_dedupe_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_items_source_dedupe
  ON raw_items (source_id, dedupe_key);
