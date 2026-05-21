-- 缓存原平台 view count(X tweet 的 views.count / legacy.view_count)。
--
-- 列表卡 👁️ 显示 = items.pv_30d(本站累计) + items.external_views(X 原帖查看数)。
-- 两者语义不完全等同(不同受众),但合计后数字最直观、最大,运营展示场景下用户也
-- 习惯看一个"总热度"指标。
--
-- 由 x-comments worker 每轮顺手更新(它本来就调 TweetDetail 拿回复, focal tweet
-- 节点带 view_count, 同一次响应里拿出来零成本)。
ALTER TABLE items
  ADD COLUMN external_views BIGINT NULL DEFAULT 0;
