-- 外部平台评论同步表(目前只用于 X / Twitter, 留 platform 字段方便后续接 Reddit 等)。
--
-- 与 comments 表分开 — 那张表是站点匿名用户写的(anon_id + 30s rate-limit), 这张
-- 是从原平台爬的, 字段语义完全不同:作者是真实平台账号 (handle + display name +
-- avatar), 唯一性靠 (platform, external_id), 不需要去重 / rate-limit。
--
-- 文章页分两区渲染:
--   - 上半「X 评论 (N)」读 external_comments
--   - 下半「本站评论 (M)」读 comments
CREATE TABLE IF NOT EXISTS external_comments (
  id              BIGINT       NOT NULL AUTO_INCREMENT,
  item_id         CHAR(36)     NOT NULL,
  platform        VARCHAR(32)  NOT NULL,
  -- 原平台评论的唯一 ID(X 上是 reply tweet 的 id_str)。复爬时 UPSERT 用。
  external_id     VARCHAR(64)  NOT NULL,
  author_handle   VARCHAR(64)  NOT NULL,
  author_name     VARCHAR(128) NULL,
  author_avatar   VARCHAR(512) NULL,
  body            TEXT         NOT NULL,
  -- 原平台发布该评论的时间(legacy.created_at)
  posted_at       TIMESTAMP    NOT NULL,
  -- 这条评论被我们写入 / 最后一次更新的时间
  synced_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_ext_platform_id (platform, external_id),
  KEY idx_item_posted (item_id, posted_at DESC),
  CONSTRAINT fk_ext_comments_item
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 标记每条 item 的评论同步进度 — 给 cron worker 选「应该再同步一次」的目标用。
-- NULL 表示从未同步过, 旧值表示距上次同步已超过冷却窗口(默认 10 分钟)。
ALTER TABLE items
  ADD COLUMN comments_synced_at TIMESTAMP NULL,
  ADD KEY idx_items_comments_synced (comments_synced_at);
