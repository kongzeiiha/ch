-- ============================================================
-- 0016_items_hot_indexes.sql — composites for the read path
-- ============================================================
-- Almost every web page issues:
--   WHERE status IN ('PUBLISHED','DISTRIBUTED') ORDER BY published_at DESC
-- pre-fix the optimizer chose `idx_items_status` then `Using filesort` over
-- the matching rows. With 63 rows it's fine; at 10k+ the filesort is the
-- single dominant cost in /, /tag/<slug>, /category/<slug>, /search and the
-- sitemap. The composite below lets InnoDB walk the index in already-sorted
-- order and bail out at LIMIT.
CREATE INDEX idx_items_status_published ON items (status, published_at DESC);

-- /category/<slug> and /a/<slug>'s related-articles strip both filter by
-- category first then sort by published_at — narrower than the global feed.
-- Without this, the optimizer falls back to idx_items_category and resorts
-- (filesort) on each request.
CREATE INDEX idx_items_category_status_published
  ON items (category, status, published_at DESC);

-- /sitemap.xml walks every published article in published_at order; the bare
-- column index avoids any status filter overhead when status is not in the
-- predicate (sitemap renders every visible article).
CREATE INDEX idx_items_published ON items (published_at DESC);

-- raw_items.fetched_at is the ORDER BY for the workbench /admin/raw-items
-- listing. Already covered by idx_raw_items_source_fetched when source_id is
-- bound, but the unqualified browse path (no source filter) needs the bare
-- column to avoid filesort.
CREATE INDEX idx_raw_items_fetched ON raw_items (fetched_at DESC);
