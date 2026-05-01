-- ============================================================
-- 0010_feedback_loop.sql
-- 把"待复核拒绝/放行"和"待分发文案修改"这两类人工反馈变成两条数据资产：
--   1. training_examples — 标注好的 (input, machine_output, human_label) 三元组,
--                          可导出为 SFT JSONL 拿去微调（慢回路）。
--   2. agent_memory_rules — 活动规则,在每次 LLM 调用前注入到 system prompt,
--                           不必等微调即可影响下一次推理（快回路）。
-- ============================================================

-- ---------- training_examples ----------
-- 一行 = 一条可用于训练的人工反馈样本。
CREATE TABLE IF NOT EXISTS training_examples (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 来源域：'compliance' 或 'distribution'。后续可加 'classify-title' 等。
  source          TEXT NOT NULL,
  -- 关联回原始 item / 任务,便于追溯。
  item_id         UUID REFERENCES items(id) ON DELETE CASCADE,
  task_id         UUID REFERENCES distribution_tasks(id) ON DELETE CASCADE,

  -- 模型当时看到的输入（标题/正文摘要 等）。结构化以便构造训练 prompt。
  input_data      JSONB NOT NULL,
  -- 模型当时给出的输出（risk scores、生成的文案等)。
  machine_output  JSONB NOT NULL,
  -- 人工最终的标注（决定/编辑后的文案/拒绝理由）。
  human_label     JSONB NOT NULL,

  -- agreement = false 表示人工推翻了机器（高信号样本,优先用于训练）。
  agreement       BOOLEAN NOT NULL DEFAULT false,

  -- 是否已用于某次训练运行（避免重复使用）。
  used_for_training BOOLEAN NOT NULL DEFAULT false,

  -- 反查溯源
  op_log_id       UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_train_source        ON training_examples (source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_train_agreement     ON training_examples (source, agreement);
CREATE INDEX IF NOT EXISTS idx_train_unused        ON training_examples (used_for_training) WHERE used_for_training = false;
-- 同一 op_log 不可重复入样,harvest 幂等
CREATE UNIQUE INDEX IF NOT EXISTS uq_train_oplog   ON training_examples (op_log_id) WHERE op_log_id IS NOT NULL;

-- ---------- agent_memory_rules ----------
-- 由人工沉淀（或后续由 LLM 自动归纳）的"复核规则",在 LLM 调用前注入到 system prompt。
CREATE TABLE IF NOT EXISTS agent_memory_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 应用到哪个 agent: 'compliance' / 'distribution' / ...
  domain          TEXT NOT NULL,
  -- 可选作用域,如 'category=AI' 或 'channel=twitter'。NULL = 通用。
  scope           TEXT,

  -- 规则文本（直接拼到 system prompt）。要写成命令式短句。
  rule            TEXT NOT NULL,

  -- 规则来源：'human' = 运营手写, 'derived' = 从 training_examples 自动归纳的
  origin          TEXT NOT NULL DEFAULT 'human',
  -- 若 origin='derived',指向归纳所基于的样本（一对多,这里取代表样本）
  derived_from    UUID REFERENCES training_examples(id) ON DELETE SET NULL,

  -- 状态:active 才会被注入。paused/deprecated 留作历史。
  status          TEXT NOT NULL DEFAULT 'active',

  -- 命中计数 + 最后使用时间。低命中规则可定期清理,避免 prompt 膨胀。
  hit_count       INTEGER NOT NULL DEFAULT 0,
  last_used_at    TIMESTAMPTZ,

  created_by      TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rules_domain_status ON agent_memory_rules (domain, status);

DROP TRIGGER IF EXISTS trg_rules_updated ON agent_memory_rules;
CREATE TRIGGER trg_rules_updated BEFORE UPDATE ON agent_memory_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
