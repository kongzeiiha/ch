-- ============================================================
-- 0016_drop_redundant_indexes.sql — kill redundant items indexes
-- ============================================================
-- These two are left-prefix-covered by the composite indexes that already
-- exist, so they waste disk + add write amplification with zero query
-- benefit:
--
--   idx_items_status           ← covered by idx_items_status_published
--   idx_items_category         ← covered by idx_items_category_status_published
--
-- Both composite indexes start with the same column, so MySQL's optimizer
-- can use them for any WHERE that touches only `status` or only `category`.
-- DROP is safe; no DDL waits because items is small (<10k rows in prod).

ALTER TABLE items
  DROP INDEX idx_items_status,
  DROP INDEX idx_items_category;
