-- ============================================================
-- 0009_operation_logs.sql
-- 全量操作日志：记录每一次后台写操作（who / when / what / on which target）。
-- 区别于 agent_runs（机器执行审计），这张表只记录 *人类发起* 的写动作。
-- ============================================================

CREATE TABLE IF NOT EXISTS operation_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 谁
  operator      TEXT NOT NULL,                  -- 显示名（来自 x-operator 头，缺则 'anonymous'）
  operator_id   TEXT,                           -- 业务侧用户 id（可选；未来接 SSO 用）

  -- 什么时间（始终是 server now，杜绝客户端伪造）
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 做了什么
  -- 命名约定：<domain>.<action>，如 source.create / compliance.approve / item.rollback
  -- domain 取值：source / item / compliance / publish / distribution / pipeline / credential / queue / analytics / system / admin
  operation     TEXT NOT NULL,

  -- 操作对象（唯一识别）
  -- target_type 是被操作实体的类型：source / item / distribution_task / credential / queue / agent / system
  -- target_id 是该实体在其表里的主键（可能是 UUID 也可能是 string，所以用 TEXT）
  target_type   TEXT NOT NULL,
  target_id     TEXT,                           -- NULL 仅用于 system 级操作（如全局急停）

  -- 上下文（前后值、原因、批量操作的 ids 列表等）
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- 请求溯源
  request_id    TEXT,                           -- Fastify req.id
  http_method   TEXT,
  http_path     TEXT,
  status_code   INTEGER,                        -- 实际响应码（成功/失败都记）
  ip            TEXT,
  user_agent    TEXT
);

-- 常见查询路径：按时间倒序、按目标查、按操作人查、按操作类型查
CREATE INDEX IF NOT EXISTS idx_oplog_occurred       ON operation_logs (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_oplog_target         ON operation_logs (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_oplog_operator       ON operation_logs (operator, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_oplog_operation      ON operation_logs (operation, occurred_at DESC);
