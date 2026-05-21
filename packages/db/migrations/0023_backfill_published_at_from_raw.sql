-- Backfill items.published_at from raw_items.fetched_at for legacy rows.
--
-- 历史原因:ingestion 阶段 candidate.publishedAt(X 的 legacy.created_at)被错
-- 塞进了 raw_items.fetched_at;items.published_at 一直 NULL → publishing worker
-- 用 NOW() 填成"发布到本站的时间"而非"原平台发布时间"。
--
-- 修法:对所有 X / 爬虫源的 items, 把 published_at 改成 raw_items.fetched_at,
-- 这条字段在旧代码下实际就是原平台时间。
--
-- 不动 manual 源 — 它们 fetched_at 就是 NOW(),published_at 也是 NOW(),
-- 二者已经一致, 没有需要回滚的语义。
--
-- 这条迁移幂等:只更新真正需要变化的行,跑第二次没副作用。
UPDATE items i
JOIN raw_items r ON r.id = i.raw_item_id
JOIN sources  s ON s.id = i.source_id
SET i.published_at = r.fetched_at
WHERE s.platform <> 'manual'
  AND r.fetched_at IS NOT NULL
  AND (i.published_at IS NULL OR i.published_at <> r.fetched_at);
