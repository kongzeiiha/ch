-- 0018_items_likes.sql — add like counter for the "最热" sort weight.
--
-- "最热" 排序公式: (pv_30d * 0.5 + likes * 0.5) DESC, published_at DESC
-- 与 pv_30d 同档作为持久化列,避免每次都 JOIN aggregate 子查询。
--
-- 选 INT(同 pv_30d)而不是 BIGINT — 32 位有符号最大 21 亿,远超任何单篇文章
-- 可能拿到的点赞数,省一半存储。
--
-- 加复合索引 (status, hot_score expr) 没法直接做(MySQL 8.0 函数式索引必须
-- 提前声明),所以我们靠 (status, pv_30d, likes) 的存在性 + 内层 SELECT 优化器
-- 推断;真正决定性能的是外层 WHERE status IN (...) 过滤后已经只剩几千行,排序成本可以忽略。

ALTER TABLE items
  ADD COLUMN likes INT NOT NULL DEFAULT 0 AFTER pv_30d;

-- 给"最热"用的复合索引 — 把 likes 也带进来,这样基于 hot_score 的排序
-- 可以 covering scan 同一索引,不用回表读 pv_30d/likes。
ALTER TABLE items
  ADD INDEX idx_items_status_hot (status, pv_30d, likes, published_at);
