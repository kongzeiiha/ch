-- ============================================================
-- 0010_feedback_loop.sql
-- 把"待复核拒绝/放行"和"待分发文案修改"这两类人工反馈变成两条数据资产：
--   1. training_examples — 标注好的 (input, machine_output, human_label) 三元组,
--                          可导出为 SFT JSONL 拿去微调（慢回路）。
--   2. agent_memory_rules — 活动规则,在每次 LLM 调用前注入到 system prompt,
--                           不必等微调即可影响下一次推理（快回路）。
-- ============================================================

-- ---------- training_examples ----------
CREATE TABLE IF NOT EXISTS training_examples (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()),

  -- 来源域：'compliance' 或 'distribution'。后续可加 'classify-title' 等。
  source          VARCHAR(64)  NOT NULL,
  item_id         CHAR(36),
  task_id         CHAR(36),

  input_data      JSON         NOT NULL,
  machine_output  JSON         NOT NULL,
  human_label     JSON         NOT NULL,

  -- agreement = false 表示人工推翻了机器（高信号样本,优先用于训练）。
  agreement         BOOLEAN    NOT NULL DEFAULT FALSE,
  used_for_training BOOLEAN    NOT NULL DEFAULT FALSE,

  op_log_id       CHAR(36),
  created_at      TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

  PRIMARY KEY (id),
  KEY idx_train_source        (source, created_at),
  KEY idx_train_agreement     (source, agreement),
  KEY idx_train_unused        (used_for_training),
  -- 同一 op_log 不可重复入样;MySQL UNIQUE 允许多个 NULL,
  -- 与 PG `WHERE op_log_id IS NOT NULL` 部分索引语义一致。
  UNIQUE KEY uq_train_oplog   (op_log_id),
  CONSTRAINT fk_train_item FOREIGN KEY (item_id)
    REFERENCES items(id) ON DELETE CASCADE,
  CONSTRAINT fk_train_task FOREIGN KEY (task_id)
    REFERENCES distribution_tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------- agent_memory_rules ----------
CREATE TABLE IF NOT EXISTS agent_memory_rules (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()),

  domain          VARCHAR(64)  NOT NULL,
  scope           VARCHAR(255),

  rule            TEXT         NOT NULL,

  origin          VARCHAR(32)  NOT NULL DEFAULT 'human',
  derived_from    CHAR(36),

  status          VARCHAR(32)  NOT NULL DEFAULT 'active',

  hit_count       INT          NOT NULL DEFAULT 0,
  last_used_at    TIMESTAMP(6) NULL,

  created_by      VARCHAR(128),
  notes           TEXT,
  created_at      TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at      TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),

  PRIMARY KEY (id),
  KEY idx_rules_domain_status (domain, status),
  CONSTRAINT fk_rules_derived FOREIGN KEY (derived_from)
    REFERENCES training_examples(id) ON DELETE SET NULL
) ENGINE=InnoDB;
