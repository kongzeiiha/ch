-- ============================================================
-- 0017_items_pv_30d.sql — materialize 30-day PV for hot sort
-- ============================================================
-- The `sort=hot` path used a correlated subquery that summed analytics_daily
-- per row, defeating any chance of an index-backed ORDER BY (EXPLAIN showed
-- Using filesort). Once analytics fills out for real, that scan becomes the
-- dominant cost on /, /?sort=hot, FilteredView, category/tag pages.
--
-- Strategy: keep a denormalized integer column refreshed once per analytics
-- pull (daily). Hot-sort ORDER BY can then walk a real BTREE.

ALTER TABLE items
  ADD COLUMN pv_30d INT NOT NULL DEFAULT 0 AFTER status,
  ADD INDEX idx_items_status_pv30d (status, pv_30d DESC, published_at DESC);
