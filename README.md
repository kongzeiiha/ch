# CH — 9-Agent Content Platform

Monorepo scaffold for a content pipeline driven by 9 agents:
Source Scoring · Ingestion · Classification · Title · Cover · Compliance · Publishing · Distribution · Analytics.

Day 1 delivers the skeleton: infra + data model + queue + SDK wrapper. Days 2–7 fill in each agent.

---

## Layout

```
.
├── apps/
│   ├── api/          Fastify server + BullMQ worker host
│   └── web/          Next.js site (article pages, SEO)
├── packages/
│   ├── agents/       Anthropic SDK wrapper, queue helpers, run tracking
│   └── db/           mysql2 client, migrations, schema
├── docker-compose.yml  MySQL + Redis + MinIO
└── .env.example
```

## Prerequisites

- Node >= 20.10
- pnpm 9
- Docker + Docker Compose

## One-shot bootstrap

```bash
# 1. env
cp .env.example .env
#  → fill in ANTHROPIC_API_KEY

# 2. infra
pnpm infra:up        # mysql:3306, redis:6380, minio:9000/9001

# 3. deps
pnpm install

# 4. db schema
pnpm migrate

# 5. dev (api :4000 + web :3000)
pnpm dev
```

Verify:

- `curl http://localhost:4000/health`  → `{ ok: true }`
- `curl http://localhost:4000/agents`  → list of 9 agents
- `open http://localhost:3000`         → landing page
- `open http://localhost:9001`         → MinIO console (minioadmin / minioadmin)

## Data model (see `packages/db/migrations/0001_init.sql`)

| table                 | purpose                                       |
| --------------------- | --------------------------------------------- |
| `sources`             | upstream accounts + score/risk/status         |
| `raw_items`           | unprocessed fetches, dedupe_key unique        |
| `items`               | processed articles, status machine            |
| `distribution_tasks`  | per-channel distribution jobs                 |
| `analytics_daily`     | daily traffic + revenue rollup                |
| `agent_runs`          | per-step audit log, tokens, cost, latency     |

`items.status` flow:
`INGESTED → CLASSIFIED → TITLED → COVERED → COMPLIANCE_PASS|COMPLIANCE_FAIL → PUBLISHED → DISTRIBUTED`

## Day 1 smoke test

```bash
pnpm infra:up
pnpm install
pnpm migrate
pnpm --filter @ch/api dev
# in another shell:
curl http://localhost:4000/health
```

Should return `{"ok":true,"ts":...}` proving the API boots, DB is reachable, and all 9 BullMQ queues come up with stub workers.

## Next

Day 2: replace the Ingestion stub in [apps/api/src/workers/index.ts](apps/api/src/workers/index.ts) with real RSS/web adapters + simhash dedupe.
