# 一周冲刺计划表 —— 9 个 Agent 全量交付

一周 9 个 Agent 全做完(含开发、联调、环境)是**极限压缩**,前提是只做 MVP、砍掉所有非关键项。下面是按**天 × 小时**排的实打实计划,按单人全职 ~10h/天 估算;如果是 2 人并行可以按表后面的分工拆。

---

## 先说砍了什么(否则时间表不成立)

- 去掉 Temporal,改 BullMQ + Redis
- 去掉 pgvector,用 Postgres + simhash 做去重(相似度检索延后)
- 只接 **1 个采集源类型**(建议 RSS 或你已有的那种)
- 只接 **1 个外部分发渠道**(先预留接口,不真发)
- Analytics 只做 **GA4 拉数 + SQL 汇总**,洞察回流建议由周报人工看,不做自动回调
- Compliance 只做**黑名单 + 一次 LLM 审核**,没有人工复核后台(挂死信队列)
- 站点用 **Next.js + ISR 模板**,SEO 只做 title/meta/JSON-LD/sitemap 四件套

---

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

## 二、按 Agent 难度的时间占比(心里有个数)

| Agent | 预计工时 | 风险 |
|---|---|---|
| 2 Ingestion | 8-10h | 中(采集源不稳定是最常见的坑) |
| 6 Compliance | 6-8h | 中(阈值要调,prompt 多轮迭代) |
| 7 Publishing(含站点) | 8-10h | **高**(SEO + ISR + 域名是第一次配的话最耗时) |
| 9 Analytics | 5-6h | 中(GA4 授权、AdSense 权限申请可能当天下不来) |
| 3/4/5/8 (LLM 类) | 每个 3-4h | 低(都是结构化 prompt) |
| 1 Source Scoring | 2-3h | 低(纯 SQL) |

---

## 三、如果是 2 人并行(强烈建议)

- **后端 A**:Day1 骨架 → Day2-3 Ingestion/Classification → Day4 Compliance → Day6 Analytics
- **全栈 B**:Day1 环境/部署 → Day2-3 Title/Cover → Day4-5 **Publishing + 站点**(这是最大块) → Day6 Distribution
- Day 7 两人一起联调加固

---

## 四、必须现在就备好的东西(不然第一天会卡)

1. **Anthropic API Key**(有额度) —— 不然 Day3 就卡住
2. **域名 + DNS 控制权** —— Day5 要上站,域名解析生效有延迟,**今天就买**
3. **GA4 property + 服务账号 JSON** —— Day6 Analytics 要用
4. **部署目标**(Vercel 或 VPS 都行,建议 Vercel 省事)
5. **采集源清单**(至少 5-10 个 RSS/URL,否则 Day2 没数据跑)
6. **分类树草稿**(二级分类 20-40 个,写死在 prompt 里用)

---

## 五、兜底预案(按概率排序)

| 若 Day X 卡住 | 砍哪个 |
|---|---|
| Day 2 采集不稳 | 直接手工喂 50 条 JSON 进 `raw_items`,继续后面的流程 |
| Day 5 站点 SEO 配不完 | JSON-LD 和 sitemap 挪到 Day 7,先让站点能访问 |
| Day 6 GA4 授权没下来 | Analytics 只接埋点自建表,广告收入手动导入 |
| Day 7 还有 bug | Distribution 降级为"只生成文案不投放",手动复制 |

---

## 六、一句话总结

这个时间表能跑通的前提是**接受 MVP 级别的质量**,80% 的边缘情况都靠 Day 8+ 迭代。如果某个 Agent 想做到生产稳定,按原来的 8 周计划更合理。