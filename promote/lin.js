┌────────────────────────┬──────────────────────────────┐
 │         Agent          │             建议             │
 ├────────────────────────┼──────────────────────────────┤
 │ Source Scoring         │ 规则 + 小模型（haiku）即可   │
 ├────────────────────────┼──────────────────────────────┤
 │ Ingestion 清洗         │ 纯规则/正则，不用 LLM        │
 ├────────────────────────┼──────────────────────────────┤
 │ Classification         │ 小模型 + 缓存 embedding      │
 ├────────────────────────┼──────────────────────────────┤
 │ Title/Cover (Creative) │ 中等模型（sonnet），SEO 敏感 │
 ├────────────────────────┼──────────────────────────────┤
 │ Compliance-Final       │ moderation API + 小模型复核  │
 ├────────────────────────┼──────────────────────────────┤
 │ Publishing copy        │ 模板 + 小模型改写            │
 ├────────────────────────┼──────────────────────────────┤
 │ Distribution adapter   │ 小模型 + 平台模板            │
 └────────────────────────┴──────────────────────────────┘

 目前默认配置里看到 openai-codex/gpt-5.4 为 primary、openai-codex/gpt-5.3-codex 为 fallback——code 模型不适合这条流水线里的创意/审核任务，应该按  
 agent 替换为内容/审核专用模型。

 P3 · 观测性（落地前就埋好）

 每个 agent 必须输出：agent_name, input_id, input_hash, latency_ms, cost_usd, status, error。

 目标：能回答"过去 24h 每个 agent 的成功率/平均延迟/单位成本"。

 ---
 三、建议新增的 Agent / 职责

 原 8 个基础上建议补 3 个：

 ┌─────┬────────────────────────────┬───────────────────────────────────┬──────────────────────────────┐
 │  #  │          新 Agent          │               作用                │             位置             │
 ├─────┼────────────────────────────┼───────────────────────────────────┼──────────────────────────────┤
 │ 9   │ Compliance-Pre（规则粗筛） │ 入库后立即过黑白名单              │ Ingestion 之后               │
 ├─────┼────────────────────────────┼───────────────────────────────────┼──────────────────────────────┤
 │ 10  │ Performance Feedback       │ 收集下游信号，回灌 Source Scoring │ Publishing/Distribution 之后 │
 ├─────┼────────────────────────────┼───────────────────────────────────┼──────────────────────────────┤
 │ 11  │ Scheduler / Orchestrator   │ 队列、重试、并发、幂等            │ 贯穿全链                     │
 └─────┴────────────────────────────┴───────────────────────────────────┴──────────────────────────────┘

 Title 与 Cover 建议合并为 Creative Agent（见 P0 第二条），合并后净 agent 数仍是 8 个，但职责更紧凑。

 ---
 四、数据模型（最小可用字段）

 建议核心表 content_item：

 id (uuid) | source_id | raw_url | content_hash | embedding
 lang | category | tags[] | keywords[] | intent
 title | summary | cover_url | cover_copy
 compliance_pre | compliance_final | published_at
 publish_platform | distribute_results (jsonb)
 state | retry_count | last_error
 created_at | updated_at

 账号表 source：

 id | platform | handle | quality | stability | risk
 last_scored_at | publish_success_rate | ban_events

 ---
 五、落地优先级建议（若要分期实施）

 Sprint 1（1-2 周）：状态机 + 队列 + Ingestion + Compliance-Pre + 最小 Publishing。先跑通"进-出"闭环，不要 LLM 也能发东西。

 Sprint 2：Classification + Creative（合并后的 Title/Cover）+ Compliance-Final。补齐生成与终审。

 Sprint 3：Distribution 多平台 + Source Scoring + Performance Feedback 闭环 + 观测面板。

 ---
 六、开放问题（需要用户确认后再展开实现计划）

 1. 这套流水线是扩展现有 OpenClaw（写成新的 skill + 挂到 3 个 bot），还是独立服务（Python/Node，带自己的 DB 和队列）？
 2. 目标发布站点是1 个自建 SEO 站，还是多站/多租户？
 3. 采集源规模（账号数、日增内容量）——决定队列和数据库选型。
 4. 是否有现成的合规词典/封面素材库，还是都要从零建？
 5. 现有 openai-codex/gpt-5.4 / gpt-5.3-codex 的模型默认是写代码场景留下的，流水线里是否需要换成内容/审核专用模型？（同时也对应你最早那条"删除   
 gpt-5.3-codex fallback"的操作。）

 ---
 七、验证方式

 建议先用 20-50 条真实内容跑一遍端到端，检查每个状态转换节点的：

 - 拒审率（pre vs final，看粗筛效果）
 - 单条内容端到端延迟
 - 单条内容总成本（LLM + 图片 + 审核）
 - 下游发布成功率 / 投放 CTR（回灌 Source Scoring 的校验）








 要做成工作台那种，并且1，所有agent发布链路必须保留人工兜底开关。2所有agent输出必须可追溯，可回滚，可重跑。3高风险节点必须机器建议加人工确认