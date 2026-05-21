-- items.comment_count 物化列 — 本站匿名 + X 同步评论合计。
--
-- 之前 feed.ts ARTICLE_COLS 和 site-item-stats.ts 用两个 correlated subquery
-- 现算: (SELECT COUNT FROM comments WHERE item_id = i.id)
--      + (SELECT COUNT FROM external_comments WHERE item_id = i.id)
-- 当前 89 items 还能 ms 级跑,到 10k items 这就成 N+1 主要 contributor。
-- 物化后变成一次列读取,跟 i.likes / i.pv_30d 一样。
--
-- 写时维护:
--   - 本站发评论:site-comments.ts INSERT 后 UPDATE items SET comment_count = comment_count + 1
--   - X 同步:x-comments worker 每条 item 同步完按 (SELECT...)+(SELECT...) 重算一次,
--     保证 UPSERT (重复评论复爬只更新内容不改总数) + 偶发的 cascade delete 也一致
--
-- 这里同时 backfill 所有现有行,保证迁移后立即可用。
ALTER TABLE items
  ADD COLUMN comment_count INT NOT NULL DEFAULT 0;

UPDATE items i
SET i.comment_count =
  COALESCE((SELECT COUNT(*) FROM comments c WHERE c.item_id = i.id), 0)
  + COALESCE((SELECT COUNT(*) FROM external_comments ec WHERE ec.item_id = i.id), 0);
