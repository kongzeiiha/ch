-- ============================================================
-- 0009_operation_logs.sql
-- 全量操作日志：记录每一次后台写操作（who / when / what / on which target）。
-- 区别于 agent_runs（机器执行审计），这张表只记录 *人类发起* 的写动作。
-- ============================================================

CREATE TABLE IF NOT EXISTS operation_logs (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()),

  -- 谁
  operator      VARCHAR(128) NOT NULL,             -- 显示名（来自 x-operator 头，缺则 'anonymous'）
  operator_id   VARCHAR(128),                      -- 业务侧用户 id（可选；未来接 SSO 用）

  -- 什么时间（始终是 server now，杜绝客户端伪造）
  occurred_at   TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

  -- 做了什么
  -- 命名约定：<domain>.<action>，如 source.create / compliance.approve / item.rollback
  operation     VARCHAR(128) NOT NULL,

  -- 操作对象（唯一识别）
  target_type   VARCHAR(64)  NOT NULL,
  target_id     VARCHAR(128),                      -- NULL 仅用于 system 级操作（如全局急停）

  -- 上下文（前后值、原因、批量操作的 ids 列表等）
  payload       JSON         NOT NULL DEFAULT (JSON_OBJECT()),

  -- 请求溯源
  request_id    VARCHAR(128),                      -- Fastify req.id
  http_method   VARCHAR(16),
  http_path     TEXT,
  status_code   INT,                               -- 实际响应码（成功/失败都记）
  ip            VARCHAR(64),
  user_agent    TEXT,

  PRIMARY KEY (id),
  -- 常见查询路径：按时间倒序、按目标查、按操作人查、按操作类型查
  KEY idx_oplog_occurred  (occurred_at),
  KEY idx_oplog_target    (target_type, target_id),
  KEY idx_oplog_operator  (operator, occurred_at),
  KEY idx_oplog_operation (operation, occurred_at)
) ENGINE=InnoDB;
