-- ============================================================
-- 0003_cover_sizes.sql — store multiple cover resolutions
-- ============================================================

ALTER TABLE items
  ADD COLUMN cover_sizes JSON NULL;
