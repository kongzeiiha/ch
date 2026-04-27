## 一、一周冲刺计划表

| 日期 | 主题 | 上午 (4h) | 下午 (4h) | 晚上 (2h) | 产出 |
|---|---|---|---|---|---|
| **Day 1 (周一)** | 环境 + 骨架 | 仓库初始化 (TS monorepo: `apps/api`、`apps/web`、`packages/agents`、`packages/db`);Docker Compose 起 Postgres + Redis + Minio | 建表(migrations):`sources / raw_items / items / distribution_tasks / analytics_daily / agent_runs`;BullMQ 队列骨架 + worker 启动模板 | Anthropic SDK 封装(含 prompt cache + 重试);.env 模板 + 部署脚本(Docker) | 代码仓库 + 本地一键 `pnpm dev` 起全部服务 |
| **Day 2 (周二)** | Agent 2 Ingestion | RSS/网页 adapter(axios + readability);清洗管线 | dedupe:URL hash + 正文 simhash;入库 `raw_items` + `items(INGESTED)` | 调度 cron;跑通 50 条真实数据 | Ingestion 可稳定采集并去重 |
| **Day 3 (周三)** | Agent 3 + 4 Classification & Title | Classification:tool use 输出 `{category,tags,keywords}` 用 Haiku 批处理;分类树写死在 prompt | Title:Sonnet 生成 3 候选 + Haiku 打分选最优;slug 生成 + 唯一性校验 | 两个 Agent 串起来,50 条数据全流水跑一遍 | `items` 上有分类、标签、标题、摘要 |
| **Day 4 (周四)** | Agent 5 + 6 Cover & Compliance | Cover:从正文图挑分辨率最高的;sharp 做多尺寸;封面文案 Haiku 生成 | Compliance:黑名单正则(3 大类:政治/色情/版权水印) + Sonnet 多维度打分;阈值:≥2 review、≥3 reject | 联调 Ingestion→Classification→Title→Cover→Compliance 全链路 | 合规产物 + `compliance_status` |
| **Day 5 (周五)** | Agent 7 + 1 Publishing & Source Scoring | Next.js 站点脚手架:文章页、分类页、首页;ISR + `revalidatePath` | SEO 四件套:title/meta/OG/JSON-LD + sitemap.xml(动态 route);Source Scoring:纯 SQL 跑分(质量/稳定/风险权重) | 首批 20 篇上线真实站点;配置域名 + HTTPS(Cloudflare) | **站点对外可访问,Google 能爬** |
| **Day 6 (周六)** | Agent 8 + 9 Distribution & Analytics | Distribution:按渠道改写 prompt(先做 X/Twitter 一个);写入 `distribution_tasks`,**投放执行留半自动**(后台一键复制文案) | Analytics:接 GA4 Data API + AdSense API(没对接就先 GA4);T+1 写 `analytics_daily`;简单周报 markdown 脚本 | Source Scoring 把 Analytics 指标并进来,形成最小闭环 | 9 个 Agent 全部跑通 |
| **Day 7 (周日)** | 联调 + 加固 + 上线 | 全链路压测:灌 500 条数据跑端到端;修 3-5 个主要 bug | 埋点:每个 Agent 写 `agent_runs`(成本/耗时/状态);Sentry 接入;关键告警(队列积压、LLM 失败率) | 灰度开关(按 source 10% → 100%);写 README + 运维手册 | **生产可用**,灰度放量 |

---