// ─── Constants ────────────────────────────────────────────────────────────────

export const API = process.env.NEXT_PUBLIC_API_URL ?? '/api';
export const POLL = 6000;

// ─── Agent definitions (Day 1 → Day 7 order) ─────────────────────────────────

export const AGENTS = [
  {
    key: 'source-scoring', num: 1, name: 'Source 评分', dayNum: 1,
    desc: '质量/稳定/风险权重打分，决定采集优先级',
    color: '#6366f1', pendingStatus: null, isHumanGate: false,
    riskLevel: 'low' as const,
  },
  {
    key: 'ingestion', num: 2, name: '内容采集', dayNum: 2,
    desc: 'RSS / HTML 抓取 + URL hash + simhash 去重入库',
    color: '#0ea5e9', pendingStatus: null, isHumanGate: false,
    riskLevel: 'low' as const,
  },
  {
    key: 'classify-title', num: 3, name: '分类标题', dayNum: 3,
    desc: 'Haiku 打分类/标签 → Sonnet 生成 3 候选标题 + 摘要 + slug',
    color: '#10b981', pendingStatus: 'INGESTED', isHumanGate: false,
    riskLevel: 'low' as const,
  },
  {
    key: 'cover', num: 4, name: '封面选图', dayNum: 4,
    desc: '最高分辨率图 + sharp 多尺寸 + Haiku 封面文案',
    color: '#ec4899', pendingStatus: 'TITLED', isHumanGate: false,
    riskLevel: 'low' as const,
  },
  {
    key: 'compliance', num: 5, name: '合规审查', dayNum: 4,
    desc: '黑名单正则 + Sonnet 多维打分  ⚠ REVIEW 项需人工确认',
    color: '#ef4444', pendingStatus: 'COVERED', isHumanGate: false,
    riskLevel: 'high' as const,
  },
  {
    key: 'publishing', num: 6, name: '发布上站', dayNum: 5,
    desc: 'ISR revalidate + slug 唯一校验  🔐 人工审批后发布',
    color: '#8b5cf6', pendingStatus: 'COMPLIANCE_PASS', isHumanGate: true,
    riskLevel: 'high' as const,
  },
  {
    key: 'distribution', num: 7, name: '社媒分发', dayNum: 6,
    desc: 'X/Twitter 文案改写  🔐 人工确认文案后执行',
    color: '#1d9bf0', pendingStatus: 'PUBLISHED', isHumanGate: true,
    riskLevel: 'high' as const,
  },
  {
    key: 'analytics', num: 8, name: '数据分析', dayNum: 6,
    desc: 'GA4 T+1 拉取 → analytics_daily → 周报',
    color: '#14b8a6', pendingStatus: 'DISTRIBUTED', isHumanGate: false,
    riskLevel: 'low' as const,
  },
];
