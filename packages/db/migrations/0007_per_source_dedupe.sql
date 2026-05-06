-- ============================================================
-- 0007_per_source_dedupe.sql
-- Switch raw_items.dedupe_key from GLOBAL unique to (source_id, dedupe_key)
-- unique. Lets two sources scrape the same upstream account/tweet and each
-- keep their own copy. Per-source content_hash dedupe (added in 0006) still
-- prevents within-source duplicates.
-- ============================================================

-- 0001 created uq_raw_items_dedupe_key in MySQL — drop it.
ALTER TABLE raw_items DROP INDEX uq_raw_items_dedupe_key;

CREATE UNIQUE INDEX uq_raw_items_source_dedupe
  ON raw_items (source_id, dedupe_key);
