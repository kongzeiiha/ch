-- ============================================================
-- 0013_items_fulltext.sql — full-text search on published articles
-- ============================================================
-- The public /search page uses MATCH(...) AGAINST(...) IN NATURAL LANGUAGE
-- MODE against the (title, summary, content) bundle. Combined with WHERE
-- filters on category/tags/published_at to support 组合筛选.
--
-- ngram parser is required for CJK because the default parser tokenizes on
-- whitespace and would treat e.g. "巴黎时尚" as a single token. ngram with
-- ngram_token_size=2 (the default) yields bi-gram tokens that match Chinese
-- query terms naturally.

ALTER TABLE items
  ADD FULLTEXT INDEX ft_items_search (title, summary, content) WITH PARSER ngram;
