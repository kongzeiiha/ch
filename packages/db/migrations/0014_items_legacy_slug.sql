-- ============================================================
-- 0014_items_legacy_slug.sql — preserve historical slugs for 301 redirects
-- ============================================================
-- The classify-title slug generator previously stripped CJK characters,
-- producing slugs like `https-t-co-tssvxrqp92-8423e6` from Chinese titles.
-- That hurts station-internal SEO because Google can't extract keywords
-- from the URL.
--
-- We're switching to a CJK-preserving generator. To avoid breaking inbound
-- links / shared URLs / search engine cache, every renamed item keeps its
-- old slug here. The /a/<slug> route checks legacy_slug on miss and 301-
-- redirects to the new canonical URL.

ALTER TABLE items
  ADD COLUMN legacy_slug VARCHAR(255) NULL AFTER slug,
  ADD INDEX idx_items_legacy_slug (legacy_slug);
