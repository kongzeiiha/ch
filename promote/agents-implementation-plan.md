# 9 个 Agent 内容流水线实现方案

下面是一套可以直接落地的工程方案，按「架构 → 数据模型 → 9 个 Agent 细化 → 编排 → 交付计划」的顺序组织，保证每个 Agent 都能独立开发、联调、灰度上线。

---

## 一、总体架构

这是一条 **采集 → 加工 → 审核 → 发布 → 分发 → 归因** 的内容流水线，9 个 Agent 本质是管道上的 9 个有状态节点。建议按「事件驱动 + 任务队列 + 幂等状态机」来设计,而不是一个大单体。

**推荐技术栈**

| 层 | 选型 | 说明 |
|---|---|---|
| 语言 | Node.js (TS) 或 Python | TS 生态对 SEO/前端一体化更友好；Python 对 NLP/数据分析更顺手。**建议主服务 TS + 分析/ML 脚本 Python** |
| LLM | Claude Opus/Sonnet 4.x(主)+ Haiku(低成本批处理) | 分类、打标、标题、封面文案、合规都走 LLM；启用 **prompt caching** 降本 |
| 编排 | Temporal 或 BullMQ + Redis | Agent 间靠事件流转，Temporal 提供重试/补偿/可观测 |
| 存储 | MySQL 8(主业务)+ S3/OSS(原始素材、图片) | 统一事务；simhash 用于去重 |
| 搜索 | Meilisearch / Elasticsearch | 站内搜索 + 后台审核检索 |
| 站点 | Next.js(ISR) | SEO 页面用 ISR 增量生成 |
| 监控 | OpenTelemetry + Grafana + Sentry | 每个 Agent 打 span |

---

## 二、核心数据模型(最小集)

```
sources(id, platform, external_id, name, score, risk_level, stability, status, ...)
raw_items(id, source_id, fetched_at, url, raw_payload, media_urls, hash, dedupe_key)
items(id, raw_item_id, status, category, tags[], keywords[], embedding,
      title, summary, cover_url, cover_copy,
      compliance_status, risk_tags[],
      published_url, published_at, ...)
distribution_tasks(id, item_id, channel, copy, status, scheduled_at, ...)
analytics_daily(item_id, date, pv, uv, ctr, rpm, revenue, source_channel)
agent_runs(id, agent, item_id, input_hash, output, cost, latency, status)
```

`items.status` 是状态机：`INGESTED → CLASSIFIED → TITLED → COVERED → COMPLIANCE_PASS/FAIL → PUBLISHED → DISTRIBUTED`。每个 Agent 只消费指定状态、产出下一状态，**天然幂等**。

---

## 三、9 个 Agent 详细实现

### 1) Source Scoring Agent —— 账号评分

- **输入**：`sources` + 该账号历史 `items` / `analytics_daily` / `compliance` 记录
- **输出**：`sources.score(0-100)` / `risk_level` / `stability` / `status(active|paused|blacklist)`
- **实现**：**不需要 LLM**，规则 + 统计模型即可
  - 质量分 = 平均 PV/UV、CTR、停留时长、Analytics 评级(加权)
  - 稳定分 = 最近 30/60/90 天发文频次方差、断更天数
  - 风险分 = 合规 Agent 给出的 `risk_tags` 命中率、投诉/下架次数
  - 综合分 = `w1*quality + w2*stability - w3*risk`
- **频率**：每日 cron 一次；另外 Compliance/Analytics 回写时触发增量
- **关键点**：评分要能**反向影响 Ingestion 的抓取频次与配额**(低分降频、黑名单停抓)

### 2) Ingestion Agent —— 采集/清洗/去重/入库

- **输入**：`sources` 激活列表 + 调度计划
- **输出**：`raw_items` 与初始化的 `items(status=INGESTED)`
- **实现**：
  - 采集：按 source 类型分 adapter(RSS / API / 浏览器抓取 playwright / 第三方供应商)，统一走适配器接口 `fetch(source) -> RawItem[]`
  - 清洗：HTML 正文抽取用 `@mozilla/readability` 或 `trafilatura`；剥广告、统一段落结构、保留图片/视频引用
  - 去重：
    - L1：URL / 外部 ID 哈希
    - L2：正文 simhash / minhash
    - L3：embedding 余弦相似度(阈值 0.92+ 视为重复)，查询 pgvector
  - 入库：原文存 S3，元数据入 `raw_items`，生成 `items` 记录
- **关键点**：**幂等**(同 `dedupe_key` 重复写直接跳过)；限流、失败指数退避；每个 source 独立 worker 防止互相拖慢

### 3) Classification Agent —— 分类/打标/关键词

- **输入**：`items(status=INGESTED)`
- **输出**：`category`、`tags[]`、`keywords[]`、`embedding`
- **实现**：
  - 分类体系先定**二级分类**(不要一开始做太细)；提示词里把完整分类树塞进去(走 prompt cache)
  - 用 Haiku 批处理：单次请求把 `{category, tags, keywords}` 一起产出(结构化 JSON，走 tool use 强制 schema)
  - 关键词抽取兼用 TF-IDF / KeyBERT 作为兜底 + LLM 结果做合并
  - 生成 embedding 写 pgvector，供去重 + 站内相关推荐复用
- **关键点**：**tag 要做同义词归一**(单独维护 `tag_aliases` 表)，否则长期会爆炸

### 4) Title Agent —— SEO 标题 + 摘要

- **输入**：清洗后的正文 + 分类/关键词
- **输出**：`title`(≤ 32 字)、`summary`(120–160 字)、`slug`
- **实现**：
  - Prompt 包含：目标关键词、站点品牌词、长度与风格约束、正负例
  - 一次生成 3 个候选标题 + 1 个摘要，再用小模型(Haiku)根据关键词密度/长度/可读性打分选一
  - slug = 英译或 pinyin + 哈希后缀，查重 `published_url` 唯一
- **关键点**：**不要每次都重新生成**。`items.title_version` 控制,人工后台可以手改 + 锁定

### 5) Cover Agent —— 封面选择 + 封面文案

- **输入**：正文图片列表 + 标题 + 关键词
- **输出**：`cover_url`、`cover_copy`(可选的图内叠字)
- **实现**：
  - 封面选择：
    - 候选池：正文图 + 来源图
    - 评分：分辨率、宽高比、清晰度(Laplacian 方差)、人脸/NSFW 检测(本地 onnx 模型或调用现有服务)
    - 选最高分，若均不合格走"兜底图库"或调用生图 API
  - 封面文案：Haiku 基于标题产出 ≤ 14 字的吸睛短语
  - 若需合成图：用 sharp/canvas 叠字，输出到 S3
- **关键点**：封面要**多尺寸预生成**(列表卡片、OG 图、分发平台规格)，避免前端现场处理

### 6) Compliance Agent —— 审核 + 风险打标

- **输入**：`items` 全量字段(标题、正文、封面、tags)
- **输出**：`compliance_status(pass|review|reject)`、`risk_tags[]`、`reasons[]`
- **实现**(**双层防御**)：
  - 第 1 层：关键词/正则黑名单(政治敏感、违禁品、人名等)—— 快、零成本
  - 第 2 层：LLM 审核(Sonnet)，给出维度评分：{政治、色情、暴力、版权、医疗夸大、金融诱导, …}，每个维度 0–3
  - 图像合规：NSFW 模型 + Logo/水印 OCR 检查(避免搬运他人水印)
  - 阈值：任一维度 ≥ 2 → `review`(进人工队列)；≥ 3 或命中黑名单 → `reject`
- **关键点**：审核结果**回写 Source Scoring**，形成"高风险账号自动降权"的负反馈闭环；人工后台必须有快捷复核界面

### 7) Publishing Agent —— 发布 + SEO 页面

- **输入**：`items(compliance_status=pass)`
- **输出**：`published_url`、`published_at`、sitemap 更新、RSS 更新
- **实现**：
  - Next.js 站点用 **ISR**：Publishing Agent 写库后调用 `revalidatePath('/a/[slug]')` + `/category/[cat]`
  - SEO 组装：
    - `<title>` / `meta description` / OG / Twitter Card
    - JSON-LD Article schema + BreadcrumbList
    - 内链：基于 embedding 相似度推荐 5 条同类文章
  - sitemap 分片(每片 ≤ 5 万 URL)，robots.txt 指向 sitemap index
  - 推送：提交 Google Indexing API / Bing IndexNow(定额)
- **关键点**：**发布必须幂等**，重复执行不会生成新 URL；支持撤回(`status=unpublished` + 301)

### 8) Distribution Agent —— 外部分发文案 + 投放任务

- **输入**：`items(status=published)` + 目标渠道配置(小红书/知乎/X/微博/Threads/邮件…)
- **输出**：`distribution_tasks`(每条包含渠道、改写文案、素材、定时时间)
- **实现**：
  - 按渠道写**风格适配 prompt**(字数、话题标签、emoji 用量、是否口语化)
  - 生成 N 版文案候选 + 配图裁剪(调用 Cover Agent 的多尺寸产物)
  - 定时：按账号历史最佳发布时段分布(Analytics 提供)
  - 真正的发送交给「投放执行器」，支持半自动(人工复核后一键发)与全自动
- **关键点**：**每个渠道有独立限频**；执行结果(曝光/点击)要回流到 Analytics

### 9) Analytics Agent —— 流量/收入分析 + 优化建议

- **输入**：GA4 / 自建埋点 / 广告收入(AdSense、联盟)/ 分发渠道回流
- **输出**：`analytics_daily` + 周报 + 给其他 Agent 的反馈信号
- **实现**：
  - ETL：按日拉取 → 归一化到 `item_id` + `channel`
  - 指标：PV、UV、CTR、平均停留、RPM、转化、收入
  - 洞察(LLM 生成)：
    - "高曝光低点击"的标题改写建议 → 回调 Title Agent 重生成
    - "高点击低停留"的封面/开头改写建议
    - 品类收益对比 → 调整 Ingestion 抓取配额
    - 源账号 ROI → 写回 Source Scoring
  - 周报：Markdown + 图表,发 Slack/邮件
- **关键点**：这是**闭环的大脑**,它的输出要**机器可读**(结构化建议)，能被其他 Agent 自动消费,而不只是给人看

---

## 四、编排与事件流

```
cron(每日) ─► SourceScoring ─► sources 打分
                          │
cron(每小时) ─► Ingestion ─► raw_items + items(INGESTED)
                                       │
             Classification ◄──────────┘
                    │
                 Title ─► Cover ─► Compliance
                                        │
                                  pass  │  fail
                                    ▼   ▼
                               Publishing   人工队列
                                    │
                              Distribution (多渠道扇出)
                                    │
                              Analytics (T+1 汇总)
                                    │
                         反馈 → SourceScoring / Title / Cover
```

- 每个 Agent 是一个 worker，消费"状态变更事件"；全程 `agent_runs` 落审计日志
- **重试策略**：LLM 失败最多 3 次指数退避 + 降级模型；最终失败写入死信队列,人工介入
- **灰度**：每个 Agent 有 `enabled_ratio` 开关，可先 10% 流量试跑

---

## 五、交付计划(建议 8 周，单人 + 1 前端)

| 周 | 里程碑 | 产出 |
|---|---|---|
| W1 | 骨架 | 仓库初始化、数据模型、队列、鉴权、最小后台；打通一个 source adapter |
| W2 | Ingestion + 去重 | 真正跑通 3 类 source，SimHash + embedding 去重；Raw/Item 入库 |
| W3 | Classification + Title | 分类树 v1、tag 归一；Title 候选+择优；后台可预览可改 |
| W4 | Cover + Compliance | 封面评分、多尺寸；双层合规；人工审核队列 |
| W5 | Publishing + SEO | Next.js 站点、ISR、sitemap、JSON-LD；首批 100 篇上线 |
| W6 | Source Scoring + Distribution | 评分闭环；2 个外部渠道(例如小红书+X)打通投放任务 |
| W7 | Analytics | GA4/AdSense 接入；T+1 报表；自动优化建议回流 |
| W8 | 灰度 / 观测 / 加固 | OTel、成本监控、全链路压测；正式放量 |

**先决问题**(开工前需要确认)：

1. 内容来源类型？(RSS / 公众号 / 网页 / 第三方 API)这决定 Ingestion 的 adapter 优先级
2. 是否有版权授权？Compliance 的"版权"维度严格程度取决于此
3. 目标站点是新站还是已有站？决定 SEO 策略(新站要更激进做内链与 sitemap 提交)
4. LLM 预算上限？决定 Title/Classification 用 Sonnet 还是 Haiku
5. 人力：是否有人工审核资源？没有的话 Compliance 阈值要保守一些

---

## 六、建议的推进顺序

**W1–W3 先把 Ingestion → Classification → Title 这条主干彻底跑通并灰度一小批内容**，再扩到 Cover/Compliance/Publishing，最后加 Distribution/Analytics 的反馈闭环——这样每一步都能看到站点上真实产出,而不是积压两个月才上线。
