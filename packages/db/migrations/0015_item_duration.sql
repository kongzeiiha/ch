-- ============================================================
-- 0015_item_duration.sql
-- items.duration_sec: 视频时长(秒),为 NULL 时按文本字符数算阅读时长
-- ── 桶定义对齐 LENGTH_BUCKETS:
--    short  (< 5min)  → duration_sec < 300  或  CHAR_LENGTH < 1000
--    medium (5~15)    → 300-900            或  1000-3000
--    long   (>15min)  → > 900              或  > 3000
-- ============================================================

ALTER TABLE items
  ADD COLUMN duration_sec INT NULL;

-- 时长筛选会用这个索引；同时也帮排序按时长走
CREATE INDEX idx_items_duration ON items (duration_sec);
