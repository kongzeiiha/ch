/**
 * Compliance test bench — inserts items covering each decision path
 * (PASS / REVIEW / FAIL · blacklist / FAIL · llm_reject) so the workbench
 * compliance step shows all three buckets simultaneously.
 *
 * Usage:
 *   pnpm --filter api exec tsx scripts/test-compliance-cases.ts
 */
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';

(function loadRootEnv() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const p = resolve(dir, '.env');
    if (existsSync(p)) { loadEnv({ path: p }); return; }
    dir = resolve(dir, '..');
  }
})();

const { query, ITEM_STATUS: IS } = await import('@ch/db');
const { complianceOne } = await import('../src/workers/compliance/index.js');
const { decide } = await import('../src/workers/compliance/decide.js');

// Cases that go through the real worker (blacklist + LLM, but LLM is currently
// SKIP so they all auto-pass). Hits L1 regex paths we want to demonstrate.
const REAL_CASES = [
  {
    label: 'PASS · clean tech',
    title: 'OpenAI 发布 GPT-5,推理能力大幅提升',
    content: '今天 OpenAI 在 DevDay 上发布了 GPT-5,新模型在多项基准测试上全面超越前代,数学和代码能力提升明显。这次还顺便上线了新的 API 工具调用能力。',
  },
  {
    label: 'FAIL · NSFW gallery',
    title: '[写真] 嫩模私拍 80P 清纯系列',
    content: '今日福利图分享,精选高清。',
  },
  {
    label: 'FAIL · NSFW soft+count',
    title: '美腿写真集 大尺度 50P',
    content: '完整写真集,内容丰富。',
  },
  {
    label: 'FAIL · explicit (CN)',
    title: '今日推荐',
    content: '一段含有露骨色情场面的描述,继续阅读了解更多。',
  },
  {
    label: 'FAIL · explicit (EN)',
    title: 'Headlines',
    content: 'Watch hardcore porn videos online — full HD library curated weekly.',
  },
  {
    label: 'FAIL · copyright',
    title: '图集分享',
    content: 'A curated collection of stunning landscapes. © 2024 Getty Images all rights reserved.',
  },
];

// Synthetic cases that bypass complianceOne() to demonstrate LLM-driven paths
// (REVIEW / llm_reject) which can't be reached while COMPLIANCE_SKIP_LLM=1.
// We hand-craft the risk score and call decide() directly so the resulting
// status / risk_tags / reasons match what the LLM path *would* produce.
const SYNTHETIC_CASES = [
  {
    label: 'REVIEW · LLM 建议复核(医疗)',
    title: '吃这个能根治糖尿病？',
    content: '本文介绍的偏方,据说一周见效,医生不会告诉你的真相...',
    scores: { '政治敏感': 0, '暴力恐怖': 0, '版权争议': 0, '医疗夸大': 2, '金融诱导': 0 },
    reasons: { '医疗夸大': '使用"根治""一周见效"等夸大疗效用语' },
  },
  {
    label: 'REVIEW · LLM 不可用(降级)',
    title: '随便一篇文章',
    content: '一篇正常内容。但碰巧 LLM 调用失败了,decide() 兜底为 REVIEW',
    scores: null, // 触发 llm_unavailable 兜底
    reasons: null,
  },
  {
    label: 'FAIL · LLM 直接拒(金融诱导)',
    title: '稳赚不赔的内幕股票',
    content: '本群免费分享股票信息,保本保收益,一个月翻倍,跟着老师走躺着赚钱...',
    scores: { '政治敏感': 0, '暴力恐怖': 0, '版权争议': 0, '医疗夸大': 0, '金融诱导': 3 },
    reasons: { '金融诱导': '明确"保本保收益""躺着赚钱"违规话术' },
  },
];

async function ensureSource(): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO sources (id, platform, external_id, name, url, status, config)
     VALUES ($1, 'rss', $2, 'compliance-test', 'http://test.local', 'active', $3)`,
    [id, `compliance-test-${id.slice(0, 8)}`, JSON.stringify({})],
  );
  return id;
}

async function insertItem(sourceId: string, title: string, content: string, status: string) {
  const rawId = randomUUID();
  const itemId = randomUUID();
  const dedupe = randomBytes(8).toString('hex');
  const hash = randomBytes(16).toString('hex');
  const text = `${title}\n\n${content}`;
  await query(
    `INSERT INTO raw_items (id, source_id, url, raw_payload, media_urls, content_hash, dedupe_key)
     VALUES ($1, $2, 'http://test.local/x', $3, $4, $5, $6)`,
    [rawId, sourceId, JSON.stringify({ text }), JSON.stringify([]), hash, dedupe],
  );
  await query(
    `INSERT INTO items (id, raw_item_id, source_id, status, title, content, summary, category, tags, keywords, risk_tags)
     VALUES ($1, $2, $3, $4, $5, $6, $7, '其他', $8, $8, $8)`,
    [itemId, rawId, sourceId, status, title, content, content.slice(0, 160), JSON.stringify([])],
  );
  return itemId;
}

async function main() {
  const sourceId = await ensureSource();
  console.log(`+ test source ${sourceId}\n`);

  // ── Real path (worker) ──────────────────────────────────────────────────
  console.log('── 真实 worker(走 blacklist + 当前 SKIP_LLM) ──');
  for (const c of REAL_CASES) {
    const itemId = await insertItem(sourceId, c.title, c.content, IS.COVERED);
    await complianceOne(itemId);
    const [row] = await query<{ status: string; risk_tags: any; compliance_reasons: any }>(
      `SELECT status, risk_tags, compliance_reasons FROM items WHERE id = $1`, [itemId],
    );
    const reasons = typeof row?.compliance_reasons === 'string' ? JSON.parse(row.compliance_reasons) : row?.compliance_reasons ?? {};
    const tags = Array.isArray(row?.risk_tags) ? row!.risk_tags : (row?.risk_tags ? JSON.parse(row.risk_tags) : []);
    console.log(`  ${c.label.padEnd(26)} → ${row?.status}  trigger=${reasons.trigger}  tags=${JSON.stringify(tags)}`);
  }

  // ── Synthetic path (bypass worker, direct decide()) ─────────────────────
  console.log('\n── 合成样本(直接调 decide(),演示 LLM 路径) ──');
  for (const c of SYNTHETIC_CASES) {
    const risk = c.scores ? { scores: c.scores, reasons: c.reasons ?? {} } : undefined;
    const decision = decide([], risk as any);
    const itemId = await insertItem(sourceId, c.title, c.content, decision.status);
    await query(
      `UPDATE items SET risk_tags=$2, compliance_status=$3, compliance_reasons=$4 WHERE id=$1`,
      [
        itemId,
        JSON.stringify(decision.risk_tags),
        decision.status,
        JSON.stringify({
          trigger: decision.trigger,
          maxScore: decision.maxScore,
          blacklist: [],
          scores: c.scores,
          reasons: c.reasons,
        }),
      ],
    );
    console.log(`  ${c.label.padEnd(26)} → ${decision.status}  trigger=${decision.trigger}  tags=${JSON.stringify(decision.risk_tags)}`);
  }

  console.log('\n--- summary ---');
  console.log(`source: ${sourceId}`);
  console.log(`\n看哪里:`);
  console.log(`  Workbench → Pipeline tab → 「合规」步骤底部应该看到:`);
  console.log(`    ⚠ N 条待人工审核（机器建议复核）        ← REVIEW 路径(2 条)`);
  console.log(`    🛑 已拦截 · 最近 N 条                      ← FAIL 路径(7 条)`);
  console.log(`  Workbench → Pipeline tab → 「发布」步骤底部应该看到:`);
  console.log(`    🔐 N 篇待人工批准发布                       ← PASS 路径(1 条 GPT-5)`);
  console.log(`\n清理:`);
  console.log(`  docker exec ch-mysql-1 mysql -u ch -pch ch -e "DELETE FROM sources WHERE id='${sourceId}';"`);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
