-- ============================================================
-- 0003_cover_sizes.sql — store multiple cover resolutions
-- ============================================================

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS cover_sizes JSONB;
