-- 0019_ingestion_ad_skips.sql — 记录"首条命中广告关键词"被跳过的事件,
-- 给 /admin/ingestion/ad-skipped 端点提供可观测性。
--
-- 写入位置:apps/api/src/workers/ingestion/index.ts 的 i===0 广告分支。
-- 读取位置:apps/api/src/admin.ts 的 /admin/ingestion/ad-skipped。
--
-- 用 BIGINT auto-increment 主键(不用 UUID),因为这是日志型表,顺序读多,
-- B+ tree 主键扫描比 UUID 友好;每条事件最多几百字节,30 天体量百万级也无压力。

CREATE TABLE IF NOT EXISTS ingestion_ad_skips (
  id              BIGINT          NOT NULL AUTO_INCREMENT,
  source_id       CHAR(36)        NOT NULL,
  item_url        VARCHAR(2048),
  item_title      VARCHAR(1024),
  matched_tokens  JSON,
  occurred_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ad_skips_occurred (occurred_at DESC),
  KEY idx_ad_skips_source (source_id, occurred_at DESC),
  CONSTRAINT fk_ad_skips_source FOREIGN KEY (source_id)
    REFERENCES sources(id) ON DELETE CASCADE
) ENGINE=InnoDB;
