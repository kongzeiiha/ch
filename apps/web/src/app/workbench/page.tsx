'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { getSprintStart, computeDayLabel, todayISO } from '../../lib/sprint';

const API = process.env.NEXT_PUBLIC_API_URL ?? '/api';
const POLL = 6000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentMeta {
  auto: boolean;
  paused: boolean;
}

interface PipelineState {
  globalStop: boolean;
  agents: Record<string, AgentMeta>;
  pendingMap: Record<string, number>;
  reviewQueueSize: number;
  publishQueueSize: number;
}

interface ReviewItem {
  id: string; title: string; category: string | null; slug: string | null;
  compliance_status: string | null; risk_tags: string[]; compliance_reasons: unknown;
  cover_url: string | null; summary: string | null; source: string; url: string;
}

interface PublishItem {
  id: string; title: string; category: string | null; slug: string | null;
  cover_url: string | null; cover_sizes: unknown; summary: string | null; source: string;
}

interface DistTask {
  item_id: string; title: string; slug: string | null;
  task_id: string; channel: string; copy: string; status: string; created_at: string;
}

interface AgentRunRow {
  agent: string; total: number; success: number; failed: number;
  avg_latency_ms: number; total_cost_usd: number;
}

interface QueueStat {
  name: string;
  counts: { waiting: number; active: number; delayed: number; completed: number; failed: number };
}

interface ItemHistory {
  item: Record<string, unknown>;
  runs: Array<{ id: string; agent: string; status: string; latency_ms: number | null; cost_usd: number | null; error: string | null; output: unknown; started_at: string; finished_at: string | null }>;
}

interface LiveJobs {
  active: Record<string, Array<{ itemId: string | null; label: string; since: string | null }>>;
  recent: Record<string, Array<{ agent: string; item_id: string | null; title: string | null; finished_at: string; latency_ms: number | null; status: string }>>;
}

interface Source {
  id: string;
  platform: string;
  external_id: string;
  name: string;
  url: string;
  status: string;
  score: number | null;
  last_fetch_at: string | null;
  config: Record<string, unknown>;
  credential_id: string | null;
  credential_name: string | null;
  credential_status: string | null;
}

interface CredentialRow {
  id: string;
  platform: string;
  name: string;
  status: string;
  cookie_len: number;
  user_agent: string | null;
  source_count: number;
  last_used_at: string | null;
  last_auth_check_at: string | null;
  last_auth_ok: boolean | null;
  has_secret: boolean;
  secret_username: string | null;
  secret_last_refresh_at: string | null;
  secret_last_refresh_ok: boolean | null;
  secret_consecutive_failures: number | null;
  secret_last_refresh_error: string | null;
}

interface RawItem {
  id: string;
  url: string | null;
  fetched_at: string;
  media_urls: string[];
  /** mp4 URLs when the underlying post had a video (X video, GIF, etc).
   *  media_urls stores the still poster; this lets the lightbox play the actual video. */
  video_urls: string[];
  dedupe_key: string;
  source_id: string;
  source_name: string;
  platform: string;
  title: string;
}

interface AuthSuspect {
  id: string;
  name: string;
  platform: string;
  auth_status: number | null;
  auth_reason: string | null;
  candidates: number | null;
  finished_at: string;
}

// ─── Agent definitions (Day 1 → Day 7 order) ─────────────────────────────────

const AGENTS = [
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

// ─── Small helpers ────────────────────────────────────────────────────────────

function cn(...args: (string | boolean | undefined)[]) {
  return args.filter(Boolean).join(' ');
}

function riskBadge(level: 'low' | 'high', isGate: boolean) {
  if (isGate) return { text: '🔐 人工门控', bg: '#4c1d95', fg: '#ddd6fe' };
  if (level === 'high') return { text: '⚠ 高风险', bg: '#7f1d1d', fg: '#fecaca' };
  return null;
}

// Build stealth-mode (Playwright) extra options from form fields. Validates
// JSON inputs gracefully — invalid JSON is just dropped rather than blocking
// the save (we toast the error instead, but UI doesn't enforce yet).
function buildStealthOpts(form: { htmlWaitFor: string; htmlExtraHeaders: string; htmlCookies: string; htmlLocale: string; htmlTimezone: string }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (form.htmlWaitFor.trim()) out.waitForSelector = form.htmlWaitFor.trim();
  if (form.htmlLocale.trim()) out.locale = form.htmlLocale.trim();
  if (form.htmlTimezone.trim()) out.timezone = form.htmlTimezone.trim();
  if (form.htmlExtraHeaders.trim()) {
    try { out.extraHeaders = JSON.parse(form.htmlExtraHeaders); } catch { /* ignore — UI hint only */ }
  }
  if (form.htmlCookies.trim()) {
    try { out.cookies = JSON.parse(form.htmlCookies); } catch { /* ignore */ }
  }
  return out;
}

// Parse a single line of 2ksg gallery input. Accepts:
//   - pure number:  "45499"        → { id: '45499' }
//   - SPA URL:      "https://uib.2ksg.com/app/#/detail?mode=img&tid=591&sid=&id=45499"
//                                  → { id: '45499', tid: '591', host: 'uib.2ksg.com' }
function parseKsgLine(line: string): { id?: string; tid?: string; host?: string } {
  const t = line.trim();
  if (!t) return {};
  if (/^\d+$/.test(t)) return { id: t };
  const id   = t.match(/[?&#/]id=(\d+)/)?.[1];
  const tid  = t.match(/[?&#/]tid=(\d+)/)?.[1];
  const host = t.match(/^https?:\/\/([^/]+)/i)?.[1];
  return { id, tid, host };
}

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}
      style={{ padding: '3px 10px', borderRadius: 4, border: '1px solid #374151', background: done ? '#064e3b' : '#1f2937', color: done ? '#6ee7b7' : '#9ca3af', fontSize: 12, cursor: 'pointer' }}>
      {done ? '✓ 已复制' : '复制文案'}
    </button>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function WorkbenchPage() {
  const [sprintStart, setSprintStart] = useState(todayISO);
  useEffect(() => { setSprintStart(getSprintStart()); }, []);
  const dayLabel = (n: number) => computeDayLabel(sprintStart, n);

  function handleSprintChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setSprintStart(v);
    // persist to localStorage so AdminNav picks it up too
    if (typeof window !== 'undefined') localStorage.setItem('sprintStart', v);
  }

  const [state, setState] = useState<PipelineState | null>(null);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [publishItems, setPublishItems] = useState<PublishItem[]>([]);
  const [distTasks, setDistTasks] = useState<DistTask[]>([]);
  const [agentSummary, setAgentSummary] = useState<AgentRunRow[]>([]);
  const [queues, setQueues] = useState<QueueStat[]>([]);
  const [liveJobs, setLiveJobs] = useState<LiveJobs>({ active: {}, recent: {} });
  const [sources, setSources] = useState<Source[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [historyModal, setHistoryModal] = useState<ItemHistory | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAgent, setBusyAgent] = useState<string | null>(null);
  const [tab, setTab] = useState<'pipeline' | 'sources' | 'crawl' | 'credentials' | 'queues' | 'oplogs'>('pipeline');
  // Currently focused stage in the redesigned pipeline view. Defaults to the
  // most-actionable stage on first load (pending items or pending human-gate
  // work). Once the user clicks a card, we keep their choice — never auto-jump.
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [editingSource, setEditingSource] = useState<Source | null>(null);
  const [showAddSource, setShowAddSource] = useState(false);

  // Shared credential pool state — lifted here so both the sources tab
  // (batch-import dropdown) and the credentials tab share one cache.
  const [credentials, setCredentials] = useState<CredentialRow[]>([]);
  const [refreshingCredId, setRefreshingCredId] = useState<string | null>(null);
  // When the stealth login fails, the API returns a base64 PNG of whatever X
  // actually showed — modal lightbox so you can spot challenge / 2FA / consent.
  const [refreshFailModal, setRefreshFailModal] = useState<{
    name: string; reason: string; detail: string; screenshotDataUrl: string;
  } | null>(null);

  const reloadCredentials = useCallback(async () => {
    try {
      const r = await fetch(`${API}/admin/credentials`, { cache: 'no-store' });
      const d = await r.json();
      setCredentials(d.credentials ?? []);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { reloadCredentials(); }, [reloadCredentials]);

  // Sync stealth-login refresh — hits the API and re-loads on completion.
  const refreshCredential = useCallback(async (credId: string) => {
    setRefreshingCredId(credId);
    try {
      const r = await fetch(`${API}/admin/credentials/${credId}/refresh?sync=1`, { method: 'POST' });
      if (!r.ok) { const t = await r.text(); setToast({ msg: `刷新失败：${t.slice(0,160)}`, ok: false }); setTimeout(() => setToast(null), 3500); return; }
      const d = await r.json();
      if (d.ok) {
        setToast({ msg: `✓ 凭证已刷新（${d.durationMs ?? '?'}ms）`, ok: true });
        setTimeout(() => setToast(null), 3500);
      } else if (d.screenshotBase64) {
        // Open modal with screenshot so you can SEE what X showed.
        const cred = credentials.find(c => c.id === credId);
        setRefreshFailModal({
          name: cred?.name ?? credId.slice(0, 8),
          reason: d.reason ?? 'unknown',
          detail: d.detail ?? '',
          screenshotDataUrl: `data:image/png;base64,${d.screenshotBase64}`,
        });
      } else {
        setToast({ msg: `刷新失败：${d.reason}${d.detail ? ` — ${d.detail}` : ''}`, ok: false });
        setTimeout(() => setToast(null), 5000);
      }
      await reloadCredentials();
    } finally {
      setRefreshingCredId(null);
    }
  }, [reloadCredentials, credentials]);

  const [rawItems, setRawItems] = useState<RawItem[]>([]);
  const [rawTotal, setRawTotal] = useState(0);
  const [rawSourceId, setRawSourceId] = useState<string>('');
  const [rawPage, setRawPage] = useState(0);
  const [rawLoading, setRawLoading] = useState(false);
  const [rawWithMedia, setRawWithMedia] = useState(true);
  const RAW_PAGE_SIZE = 30;
  const [authSuspect, setAuthSuspect] = useState<AuthSuspect[]>([]);
  const [authBannerDismissed, setAuthBannerDismissed] = useState(false);
  const timer = useRef<NodeJS.Timeout | null>(null);
  const autoRefresh = useRef(true);

  // ── Data loading ──
  const load = useCallback(async () => {
    try {
      const [s, rv, pv, dv, ar, qv, sv, lv, asv] = await Promise.allSettled([
        fetch(`${API}/admin/pipeline/state`, { cache: 'no-store' }).then(r => r.json()),
        fetch(`${API}/admin/pipeline/review-queue`, { cache: 'no-store' }).then(r => r.json()),
        fetch(`${API}/admin/pipeline/publish-queue`, { cache: 'no-store' }).then(r => r.json()),
        fetch(`${API}/admin/pipeline/distribution-queue`, { cache: 'no-store' }).then(r => r.json()),
        fetch(`${API}/admin/ops/agent-runs`, { cache: 'no-store' }).then(r => r.json()),
        fetch(`${API}/admin/ops/queues`, { cache: 'no-store' }).then(r => r.json()),
        fetch(`${API}/admin/sources`, { cache: 'no-store' }).then(r => r.json()),
        fetch(`${API}/admin/pipeline/live-jobs`, { cache: 'no-store' }).then(r => r.json()),
        fetch(`${API}/admin/sources/auth-status`, { cache: 'no-store' }).then(r => r.json()),
      ]);
      if (s.status === 'fulfilled') setState(s.value);
      if (rv.status === 'fulfilled') setReviewItems(rv.value.items ?? []);
      if (pv.status === 'fulfilled') setPublishItems(pv.value.items ?? []);
      if (dv.status === 'fulfilled') setDistTasks(dv.value.tasks ?? []);
      if (ar.status === 'fulfilled') setAgentSummary(ar.value.summary ?? []);
      if (qv.status === 'fulfilled') setQueues(qv.value.stats ?? []);
      if (sv.status === 'fulfilled') setSources(sv.value.sources ?? []);
      if (lv.status === 'fulfilled') setLiveJobs({ active: lv.value.active ?? {}, recent: lv.value.recent ?? {} });
      if (asv.status === 'fulfilled') setAuthSuspect(asv.value.suspect ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    timer.current = setInterval(() => { if (autoRefresh.current) load(); }, POLL);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [load]);

  // ── Crawl preview loader ──
  const loadRawItems = useCallback(async () => {
    setRawLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(RAW_PAGE_SIZE),
        offset: String(rawPage * RAW_PAGE_SIZE),
      });
      if (rawSourceId) params.set('source_id', rawSourceId);
      if (rawWithMedia) params.set('with_media', '1');
      const r = await fetch(`${API}/admin/raw-items?${params}`, { cache: 'no-store' });
      const d = await r.json();
      setRawItems(d.items ?? []);
      setRawTotal(d.total ?? 0);
    } finally {
      setRawLoading(false);
    }
  }, [rawSourceId, rawPage, rawWithMedia]);

  useEffect(() => {
    if (tab === 'crawl') loadRawItems();
  }, [tab, loadRawItems]);

  // ── Toast ──
  const flash = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  // ── API action helper ──
  const call = async (url: string, method = 'POST', body?: unknown): Promise<unknown> => {
    const r = await fetch(`${API}${url}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r.json();
  };

  // ── Agent toggle helpers ──
  const setAuto = async (agent: string, auto: boolean) => {
    try {
      await call('/admin/pipeline/set-auto', 'POST', { agent, auto, ack: true });
      flash(`${agent} 自动模式: ${auto ? 'ON' : 'OFF'}`);
      await load();
    } catch (e) { flash(`${e}`, false); }
  };

  const setPaused = async (agent: string, paused: boolean) => {
    try {
      await call('/admin/pipeline/set-paused', 'POST', { agent, paused });
      flash(`${agent} ${paused ? '已暂停' : '已恢复'}`);
      await load();
    } catch (e) { flash(`${e}`, false); }
  };

  const runAgent = async (agentKey: string, label: string) => {
    setBusyAgent(agentKey);
    try {
      const d: any = await call(`/admin/pipeline/run/${agentKey}`);
      flash(`${label} · 已入队 ${d.queued ?? 1} 条`);
      await load();
    } catch (e) { flash(`${label} 失败: ${e}`, false); }
    finally { setBusyAgent(null); }
  };

  // ── Emergency stop ──
  const emergencyStop = async () => {
    if (!confirm('确认触发紧急停止？将暂停所有自动化流程。')) return;
    await call('/admin/pipeline/emergency-stop');
    flash('🛑 紧急停止已触发', false);
    await load();
  };
  const resumeAll = async () => {
    await call('/admin/pipeline/resume');
    flash('✅ 已恢复运行');
    await load();
  };

  // ── Review gate actions ──
  const approveReview = async (itemId: string) => {
    await call(`/admin/pipeline/approve-review/${itemId}`);
    flash('已批准 → COMPLIANCE_PASS');
    await load();
  };
  const rejectReview = async (itemId: string) => {
    const reason = prompt('拒绝原因（可选）') ?? '';
    await call(`/admin/pipeline/reject-review/${itemId}`, 'POST', { reason });
    flash('已拒绝 → COMPLIANCE_FAIL');
    await load();
  };

  // ── Publish gate ──
  const approvePublish = async (ids?: string[]) => {
    const body = ids ? { itemIds: ids } : {};
    const d: any = await call('/admin/pipeline/approve-publish', 'POST', body);
    flash(`已批准发布 ${d.queued} 篇`);
    setSelectedItems(new Set());
    await load();
  };

  // ── Distribution gate ──
  const confirmDist = async (taskId: string) => {
    await call(`/admin/pipeline/confirm-distribution/${taskId}`);
    flash('已确认分发');
    await load();
  };

  // ── Rollback / Re-run ──
  const rollback = async (itemId: string, title: string) => {
    if (!confirm(`回滚「${title}」到上一阶段？`)) return;
    try {
      const d: any = await call(`/admin/pipeline/rollback/${itemId}`);
      flash(`已回滚: ${d.from} → ${d.to}`);
      await load();
    } catch (e) { flash(`回滚失败: ${e}`, false); }
  };

  const rerun = async (itemId: string) => {
    try {
      const d: any = await call(`/admin/pipeline/rerun/${itemId}`);
      flash(`已重跑: ${d.agentKey}`);
      await load();
    } catch (e) { flash(`重跑失败: ${e}`, false); }
  };

  const showHistory = async (itemId: string) => {
    try {
      const d: any = await call(`/admin/pipeline/item-history/${itemId}`, 'GET');
      if (!d || d.error || !d.item) {
        flash(d?.error ? `找不到此文章：${d.error}` : '文章已不存在', false);
        return;
      }
      setHistoryModal(d);
    } catch (e) {
      flash(`${e}`, false);
    }
  };

  // ── Source CRUD ──
  const saveSource = async (data: Partial<Source> & { id?: string; config?: Record<string, unknown> }) => {
    try {
      const config = data.config ?? { feed_url: data.url, limit: 20 };
      if (data.id) {
        await call(`/admin/sources/${data.id}`, 'PATCH', { ...data, config });
        flash('采集源已更新');
      } else {
        await call('/admin/sources', 'POST', {
          platform: data.platform ?? 'rss',
          external_id: data.external_id ?? data.name?.toLowerCase().replace(/\s+/g, '-'),
          name: data.name,
          url: data.url,
          config,
        });
        flash('采集源已添加');
      }
      setEditingSource(null);
      setShowAddSource(false);
      await load();
    } catch (e) { flash(`操作失败: ${e}`, false); }
  };

  const deleteSource = async (src: Source) => {
    if (!confirm(`删除「${src.name}」？`)) return;
    try {
      const r = await fetch(`${API}/admin/sources/${src.id}`, { method: 'DELETE' });
      if (r.status === 409) {
        const d = await r.json();
        if (!confirm(`${d.message}\n\n确认连同 ${d.itemCount} 篇文章一起删除？`)) return;
        await call(`/admin/sources/${src.id}?cascade=1`, 'DELETE');
        flash(`已级联删除（含 ${d.itemCount} 篇文章）`);
      } else if (!r.ok) {
        throw new Error(`${r.status} ${await r.text()}`);
      } else {
        flash('已删除');
      }
      await load();
    } catch (e) { flash(`删除失败: ${e}`, false); }
  };

  const toggleSourceStatus = async (src: Source) => {
    const next = src.status === 'active' ? 'inactive' : 'active';
    setSources(prev => prev.map(s => s.id === src.id ? { ...s, status: next } : s));
    try {
      await call(`/admin/sources/${src.id}`, 'PATCH', { status: next });
      flash(next === 'active' ? `${src.name} 已激活` : `${src.name} 已停用`);
      await load();
    } catch (e) {
      setSources(prev => prev.map(s => s.id === src.id ? { ...s, status: src.status } : s));
      flash(`操作失败: ${e}`, false);
    }
  };

  const ingestOne = async (src: Source) => {
    flash(`${src.name} 采集中…`);
    try {
      const d: any = await call(`/admin/ingest/${src.id}`, 'POST');
      const s = d?.stats;
      if (s) {
        flash(`${src.name}: +${s.inserted ?? 0} 条（跳过 ${s.skipped ?? 0}）`);
      } else {
        flash(`${src.name} 已采集`);
      }
      await load();
    } catch (e) { flash(`采集失败: ${e}`, false); }
  };

  // ── Derived ──
  const pending = state?.pendingMap ?? {};
  const agents = state?.agents ?? {};
  const summaryMap = new Map(agentSummary.map(r => [r.agent, r]));
  const totalCost = agentSummary.reduce((s, r) => s + Number(r.total_cost_usd), 0);
  const totalItems = Object.values(pending).reduce((a, b) => a + b, 0);
  const queueBusy = queues.reduce((s, q) => s + q.counts.waiting + q.counts.active, 0);

  // Pick a sensible default stage on first load. Priority: human gates with
  // pending work → first stage with a backlog → first agent in the list.
  useEffect(() => {
    if (selectedAgent || !state) return;
    if (reviewItems.length > 0)        { setSelectedAgent('compliance');     return; }
    if (publishItems.length > 0)       { setSelectedAgent('publishing');     return; }
    if (distTasks.length > 0)          { setSelectedAgent('distribution');   return; }
    const firstWithBacklog = AGENTS.find(a => a.pendingStatus && (pending[a.pendingStatus] ?? 0) > 0);
    setSelectedAgent(firstWithBacklog?.key ?? AGENTS[0].key);
  }, [state, reviewItems.length, publishItems.length, distTasks.length, selectedAgent, pending]);

  // Per-stage computed status, shared between the flow strip and the detail panel.
  const stageMeta = (key: string) => {
    const a = AGENTS.find(x => x.key === key)!;
    const meta = agents[a.key] ?? { auto: false, paused: false };
    const pendingCnt = a.pendingStatus ? (pending[a.pendingStatus] ?? 0) : 0;
    const queue = queues.find(q => q.name === a.key);
    const isProcessing = (queue?.counts.active ?? 0) > 0;
    const stopped = state?.globalStop || meta.paused;
    let humanGateCnt = 0;
    if (a.key === 'compliance')   humanGateCnt = reviewItems.length;
    if (a.key === 'publishing')   humanGateCnt = publishItems.length;
    if (a.key === 'distribution') humanGateCnt = distTasks.length;
    return { agent: a, meta, pendingCnt, isProcessing, stopped, humanGateCnt };
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', fontFamily: 'system-ui, -apple-system, PingFang SC, sans-serif' }}>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 9999, padding: '10px 16px', borderRadius: 8, background: toast.ok ? '#052e16' : '#450a0a', border: `1px solid ${toast.ok ? '#16a34a' : '#dc2626'}`, color: toast.ok ? '#86efac' : '#fca5a5', fontSize: 13, maxWidth: 360, boxShadow: '0 4px 20px #0008' }}>
          {toast.msg}
        </div>
      )}

      {/* Refresh-failure screenshot modal — shows what X actually presented */}
      {refreshFailModal && (
        <div onClick={() => setRefreshFailModal(null)}
          style={{ position: 'fixed', inset: 0, background: '#000c', zIndex: 9500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, cursor: 'zoom-out' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#1e293b', border: '1px solid #dc2626', borderRadius: 12, padding: 18, maxWidth: '92vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column', gap: 10, cursor: 'default' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#fca5a5' }}>⚠ 刷新失败 · {refreshFailModal.name}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                  reason: <code style={{ color: '#fbbf24' }}>{refreshFailModal.reason}</code>
                  {refreshFailModal.detail && <> · {refreshFailModal.detail}</>}
                </div>
              </div>
              <button onClick={() => setRefreshFailModal(null)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.6, padding: '6px 10px', background: '#0f172a', borderRadius: 6 }}>
              这是 Playwright 失败那一刻的页面截图。X 多半在登录流程里加了挑战页(2FA / 异常登录确认 / 邮件验证码 / Arkose captcha 等),自动登录无法继续。
              <br />
              <strong style={{ color: '#cbd5e1' }}>处理建议</strong>:无痕窗口手工登录一次解决挑战 → 复制新 cookie → 凭证池 → 编辑 → 粘贴 cookie + 状态改 active(会自动重置 3 连败计数)。
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={refreshFailModal.screenshotDataUrl} alt="X login screenshot at failure"
              style={{ maxWidth: '85vw', maxHeight: '70vh', borderRadius: 6, border: '1px solid #334155', objectFit: 'contain', background: '#000' }} />
          </div>
        </div>
      )}

      {/* Item history modal */}
      {historyModal && historyModal.item && (
        <div style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setHistoryModal(null)}>
          <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 24, maxWidth: 700, width: '90%', maxHeight: '80vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>追踪历史：{String(historyModal.item.title ?? historyModal.item.id)}</div>
              <button onClick={() => setHistoryModal(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
              状态: <strong style={{ color: '#e2e8f0' }}>{String(historyModal.item.status)}</strong>
              {historyModal.item.category ? <> {' · '} 分类: <span style={{ color: '#93c5fd' }}>{String(historyModal.item.category)}</span></> : null}
              {' · '} slug: {String(historyModal.item.slug ?? '—')}
              {' · '} 创建: {String(historyModal.item.created_at ?? '').slice(0, 19)}
              {historyModal.item.original_url ? <> {' · '} <a href={String(historyModal.item.original_url)} target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>原文 ↗</a></> : null}
            </div>

            {/* Cover image if any */}
            {historyModal.item.cover_url ? (
              <img
                src={String(historyModal.item.cover_url)}
                alt=""
                style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 6, marginBottom: 12, background: '#0f172a' }}
              />
            ) : null}

            {/* Risk tags (compliance) */}
            {Array.isArray(historyModal.item.risk_tags) && (historyModal.item.risk_tags as string[]).length > 0 && (
              <div style={{ marginBottom: 10, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: '#f59e0b', marginRight: 4 }}>⚠ 风险标签：</span>
                {(historyModal.item.risk_tags as string[]).map((t) => (
                  <span key={t} style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, background: '#7f1d1d', color: '#fca5a5' }}>{t}</span>
                ))}
              </div>
            )}

            {/* Tags / keywords */}
            {Array.isArray(historyModal.item.tags) && (historyModal.item.tags as string[]).length > 0 && (
              <div style={{ marginBottom: 8, display: 'flex', gap: 4, flexWrap: 'wrap', fontSize: 11 }}>
                <span style={{ color: '#64748b', marginRight: 4 }}>标签：</span>
                {(historyModal.item.tags as string[]).map((t) => (
                  <span key={t} style={{ padding: '1px 7px', borderRadius: 10, background: '#1e293b', color: '#cbd5e1', border: '1px solid #334155' }}>{t}</span>
                ))}
              </div>
            )}

            {/* Summary */}
            {historyModal.item.summary ? (
              <div style={{
                marginBottom: 12,
                padding: '10px 12px',
                background: '#0f172a',
                borderLeft: '3px solid #6366f1',
                borderRadius: 4,
                fontSize: 13,
                color: '#cbd5e1',
                lineHeight: 1.7,
              }}>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>摘要</div>
                {String(historyModal.item.summary)}
              </div>
            ) : null}

            {/* Full content (collapsible) */}
            {historyModal.item.content ? (
              <details style={{ marginBottom: 14, background: '#0f172a', borderRadius: 6, padding: '8px 12px' }}>
                <summary style={{ cursor: 'pointer', fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>
                  全文（{String(historyModal.item.content).length} 字）· 点击展开
                </summary>
                <div style={{
                  marginTop: 10,
                  fontSize: 12.5,
                  color: '#cbd5e1',
                  lineHeight: 1.75,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 320,
                  overflowY: 'auto',
                }}>
                  {String(historyModal.item.content)}
                </div>
              </details>
            ) : null}

            {/* Runs history */}
            <div style={{ fontSize: 11, color: '#64748b', margin: '14px 0 6px', fontWeight: 600 }}>处理历史</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {historyModal.runs.map(r => (
                <div key={r.id} style={{ display: 'flex', gap: 10, padding: '8px 10px', background: '#0f172a', borderRadius: 6, fontSize: 12, alignItems: 'flex-start' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginTop: 3, background: r.status === 'success' ? '#22c55e' : r.status === 'running' ? '#3b82f6' : '#ef4444' }} />
                  <span style={{ minWidth: 160, color: '#94a3b8' }}>{r.agent}</span>
                  <span style={{ color: '#64748b' }}>{r.started_at.slice(0, 19)}</span>
                  <span style={{ color: '#94a3b8' }}>{r.latency_ms ? `${r.latency_ms}ms` : ''}</span>
                  <span style={{ color: '#a78bfa' }}>{r.cost_usd ? `$${Number(r.cost_usd).toFixed(5)}` : ''}</span>
                  {r.error && <span style={{ color: '#f87171', flex: 1 }}>{r.error}</span>}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={() => rerun(String(historyModal.item.id))}
                style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #334155', background: '#1e293b', color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>
                重跑
              </button>
              <button onClick={() => rollback(String(historyModal.item.id), String(historyModal.item.title ?? ''))}
                style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #991b1b', background: '#1e293b', color: '#f87171', fontSize: 12, cursor: 'pointer' }}>
                回滚到上阶段
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <header style={{ background: '#020617', borderBottom: '1px solid #1e293b', padding: '0 24px', height: 52, display: 'flex', alignItems: 'center', gap: 16, position: 'sticky', top: 0, zIndex: 100 }}>
        <Link href="/" style={{ color: '#e2e8f0', textDecoration: 'none', fontSize: 16, fontWeight: 800 }}>内容中台</Link>
        <span style={{ color: '#334155' }}>/</span>
        <span style={{ fontSize: 13, color: '#64748b' }}>流水线工作台</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569' }}>
          冲刺开始
          <input
            type="date"
            value={sprintStart}
            onChange={handleSprintChange}
            style={{ fontSize: 12, background: '#1e293b', border: '1px solid #334155', borderRadius: 4, padding: '2px 6px', color: '#94a3b8', colorScheme: 'dark' }}
          />
        </label>

        {state?.globalStop && (
          <span style={{ padding: '2px 10px', borderRadius: 12, background: '#7f1d1d', color: '#fca5a5', fontSize: 12, fontWeight: 700, animation: 'pulse 1s infinite' }}>
            🛑 紧急停止中
          </span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#475569' }}>总计 <strong style={{ color: '#e2e8f0' }}>{totalItems}</strong> 条</span>
          <span style={{ fontSize: 12, color: '#475569' }}>队列 <strong style={{ color: queueBusy > 0 ? '#fbbf24' : '#64748b' }}>{queueBusy}</strong></span>
          <span style={{ fontSize: 12, color: '#475569' }}>成本 <strong style={{ color: '#a78bfa' }}>${totalCost.toFixed(4)}</strong></span>
          <Link href="/admin" style={{ fontSize: 12, color: '#a5b4fc', textDecoration: 'none', padding: '4px 10px', border: '1px solid #334155', borderRadius: 6 }} title="按 Day 分页的验收后台">Admin →</Link>
          <Link href="/" style={{ fontSize: 12, color: '#475569', textDecoration: 'none' }}>站点 →</Link>

          {state?.globalStop
            ? <button onClick={resumeAll} style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: '#16a34a', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>▶ 恢复运行</button>
            : <button onClick={emergencyStop} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #7f1d1d', background: '#1e293b', color: '#f87171', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>🛑 紧急停止</button>
          }
        </div>
      </header>

      {/* ── Auth-failure banner ── */}
      {authSuspect.length > 0 && !authBannerDismissed && (
        <div style={{
          background: '#7f1d1d', borderBottom: '1px solid #991b1b',
          padding: '10px 24px', color: '#fee2e2', fontSize: 13,
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 16 }}>🔑</span>
          <strong>{authSuspect.length}</strong> 个采集源凭证可能已过期 ·&nbsp;
          <span>
            {authSuspect.slice(0, 3).map(s => (
              <button
                key={s.id}
                onClick={() => {
                  setTab('sources');
                  const src = sources.find(x => x.id === s.id);
                  if (src) { setEditingSource(src); setShowAddSource(false); }
                }}
                title={s.auth_reason ?? ''}
                style={{
                  background: '#991b1b', border: '1px solid #fecaca',
                  color: '#fee2e2', borderRadius: 4, padding: '2px 8px',
                  fontSize: 12, marginRight: 6, cursor: 'pointer', fontWeight: 600,
                }}>
                {s.name} <span style={{ opacity: 0.6, fontWeight: 400 }}>· {s.platform}</span>
              </button>
            ))}
            {authSuspect.length > 3 && <span style={{ opacity: 0.7 }}>· 还有 {authSuspect.length - 3} 个</span>}
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={() => setTab('sources')}
              style={{ background: 'transparent', border: '1px solid #fecaca', color: '#fee2e2', borderRadius: 4, padding: '3px 10px', fontSize: 12, cursor: 'pointer' }}>
              去刷新
            </button>
            <button onClick={() => setAuthBannerDismissed(true)}
              style={{ background: 'transparent', border: 'none', color: '#fecaca', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>
              ✕
            </button>
          </span>
        </div>
      )}

      {/* ── Tab bar ── */}
      <div style={{ background: '#020617', borderBottom: '1px solid #1e293b', padding: '0 24px', display: 'flex', gap: 4 }}>
        {(['pipeline', 'sources', 'crawl', 'credentials', 'queues', 'oplogs'] as const).map(t => {
          const labels: Record<string, string> = { pipeline: '流水线', sources: '采集源', crawl: '采集预览', credentials: '凭证池', queues: '队列 & 成本', oplogs: '操作日志' };
          return (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '10px 18px', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: tab === t ? 700 : 400,
              color: tab === t ? '#e2e8f0' : '#475569',
              borderBottom: tab === t ? '2px solid #6366f1' : '2px solid transparent',
            }}>{labels[t]}</button>
          );
        })}
      </div>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 20px 60px' }}>

        {loading && !state && (
          <div style={{ textAlign: 'center', padding: 60, color: '#475569' }}>连接中…</div>
        )}

        {/* ── Pipeline tab ── */}
        {tab === 'pipeline' && <>

        {/* Vertical stepper on the left + selected stage detail on the right.
            On narrow viewports the stepper wraps below the detail via flex-wrap. */}
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>

          {/* Left column: vertical stepper, all 8 stages stacked top → down.
              Cards are sized to fill the vertical real-estate naturally — flex
              with each card claiming an equal share, plus generous padding. */}
          <div style={{
            background: '#1e293b', border: '1px solid #334155', borderRadius: 12,
            padding: '18px 14px',
            flex: '0 0 260px', minWidth: 240,
            display: 'flex', flexDirection: 'column',
            // Match the right-side detail panel's natural height by stretching;
            // alignSelf: stretch is the default in flex, so the column grows to
            // the tallest sibling. We also enforce a min so it looks substantial
            // even when the right panel is short.
            minHeight: 720,
            alignSelf: 'stretch',
          }}>
            {AGENTS.map((a, idx) => {
              const m = stageMeta(a.key);
              const isSel = selectedAgent === a.key;
              // Corner dot: red=积压/⚠ · blue=processing · green=auto · orange=paused · grey=idle
              const dotColor =
                m.humanGateCnt > 0 ? '#ef4444' :
                m.isProcessing ? '#60a5fa' :
                m.meta.paused ? '#fb923c' :
                m.meta.auto ? '#22c55e' : '#475569';
              const accent = m.stopped ? '#475569' : a.color;
              return (
                <div key={a.key} style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'stretch',
                  // each stage row claims an equal share of the column
                  flex: '1 1 0', minHeight: 0,
                }}>
                  <button
                    onClick={() => setSelectedAgent(a.key)}
                    title={a.desc}
                    style={{
                      flex: 1, minHeight: 64,
                      textAlign: 'left',
                      background: isSel ? `${accent}1c` : '#0f172a',
                      borderTop: `1px solid ${isSel ? accent : '#1e293b'}`,
                      borderRight: `1px solid ${isSel ? accent : '#1e293b'}`,
                      borderBottom: `1px solid ${isSel ? accent : '#1e293b'}`,
                      borderLeft: `4px solid ${accent}`,
                      borderRadius: 10, padding: '14px 14px',
                      cursor: 'pointer', position: 'relative',
                      opacity: m.stopped && !a.isHumanGate ? 0.65 : 1,
                      transition: 'background 120ms, border-color 120ms',
                      display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8,
                    }}>
                    {/* Header row: # number + name + status dot */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, color: accent,
                        background: `${accent}22`, padding: '2px 8px', borderRadius: 5,
                        flexShrink: 0,
                      }}>#{a.num}</span>
                      <span style={{
                        flex: 1, fontSize: 14, fontWeight: 700,
                        color: isSel ? '#f1f5f9' : '#cbd5e1',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {a.name}
                      </span>
                      <span style={{
                        width: 9, height: 9, borderRadius: '50%', background: dotColor,
                        boxShadow: m.isProcessing ? `0 0 8px ${dotColor}` : 'none',
                        animation: m.isProcessing || m.humanGateCnt > 0 ? 'pulse 1s infinite' : 'none',
                        flexShrink: 0,
                      }} />
                    </div>
                    {/* Bottom row: pending count + status chips */}
                    {(m.pendingCnt > 0 || m.humanGateCnt > 0 || a.isHumanGate || m.meta.auto || m.meta.paused) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {(m.pendingCnt > 0 || m.humanGateCnt > 0) && (
                          <span style={{
                            fontSize: 11, fontWeight: 700,
                            color: m.humanGateCnt > 0 ? '#fca5a5' : accent,
                            background: m.humanGateCnt > 0 ? '#7f1d1d44' : `${accent}22`,
                            padding: '2px 8px', borderRadius: 9,
                          }}>
                            {m.humanGateCnt > 0 ? `⚠ ${m.humanGateCnt}` : m.pendingCnt}
                          </span>
                        )}
                        {a.isHumanGate && (<span style={{ fontSize: 11, color: '#a78bfa' }}>🔐</span>)}
                        {m.meta.auto && !a.isHumanGate && (<span style={{ fontSize: 10, color: '#22c55e', fontWeight: 700 }}>⚡</span>)}
                        {m.meta.paused && (<span style={{ fontSize: 10, color: '#fb923c' }}>⏸</span>)}
                      </div>
                    )}
                  </button>
                  {/* Stage connector — fading stem + chevron arrowhead, matches
                      flowchart conventions and reads cleaner than a unicode ↓. */}
                  {idx < AGENTS.length - 1 && (
                    <div style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center',
                      padding: '6px 0', userSelect: 'none', flexShrink: 0,
                    }}>
                      <div style={{
                        width: 2, height: 14,
                        background: 'linear-gradient(to bottom, transparent, #6366f1)',
                        borderRadius: 1,
                      }} />
                      <div style={{
                        width: 0, height: 0,
                        borderLeft: '5px solid transparent',
                        borderRight: '5px solid transparent',
                        borderTop: '7px solid #6366f1',
                        marginTop: -1,
                        opacity: 0.85,
                      }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Right column: selected stage detail */}
          <div style={{ flex: '1 1 600px', minWidth: 320, display: 'flex', flexDirection: 'column' }}>

        {/* Detail panel — only the selected stage */}
        {AGENTS.filter(a => a.key === (selectedAgent ?? AGENTS[0].key)).map((agent) => {
          const meta = agents[agent.key] ?? { auto: false, paused: false };
          const pendingCnt = agent.pendingStatus ? (pending[agent.pendingStatus] ?? 0) : null;
          const summary = summaryMap.get(agent.key);
          const busy = busyAgent === agent.key;
          const stopped = state?.globalStop || meta.paused;
          const badge = riskBadge(agent.riskLevel, agent.isHumanGate);
          const queue = queues.find(q => q.name === agent.key || q.name === agent.key.replace('-', ''));
          const isProcessing = (queue?.counts.active ?? 0) > 0;

          return (
            <div key={agent.key} style={{ marginBottom: 10 }}>

              {/* Stage row */}
              <div style={{
                background: '#1e293b',
                borderTop: `1px solid ${agent.isHumanGate ? '#4c1d95' : stopped ? '#374151' : '#334155'}`,
                borderRight: `1px solid ${agent.isHumanGate ? '#4c1d95' : stopped ? '#374151' : '#334155'}`,
                borderBottom: `1px solid ${agent.isHumanGate ? '#4c1d95' : stopped ? '#374151' : '#334155'}`,
                borderLeft: `4px solid ${stopped ? '#475569' : agent.color}`,
                borderRadius: 10,
                padding: '16px 18px',
                opacity: stopped && !agent.isHumanGate ? 0.7 : 1,
              }}>
                {/* Header: title + chips on left, controls on right */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: agent.color, background: `${agent.color}22`, padding: '1px 7px', borderRadius: 6 }}>
                        #{agent.num} {dayLabel(agent.dayNum)}
                      </span>
                      {badge && (
                        <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 6, background: badge.bg, color: badge.fg }}>
                          {badge.text}
                        </span>
                      )}
                      {isProcessing && (
                        <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 6, background: '#1e3a5f', color: '#60a5fa' }}>
                          ⟳ 处理中
                        </span>
                      )}
                      {meta.auto && !agent.isHumanGate && (
                        <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 6, background: '#14532d', color: '#86efac' }}>⚡ 自动模式</span>
                      )}
                      {meta.paused && (
                        <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 6, background: '#451a03', color: '#fb923c' }}>⏸ 已暂停</span>
                      )}
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 700, color: '#f1f5f9' }}>{agent.name}</div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>{agent.desc}</div>
                  </div>

                  {/* Controls */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>

                    {/* Auto toggle (hidden for hard human gates) */}
                    {!agent.isHumanGate && (
                      <button
                        onClick={() => setAuto(agent.key, !meta.auto)}
                        style={{
                          padding: '5px 12px', borderRadius: 6, border: '1px solid',
                          borderColor: meta.auto ? agent.color : '#334155',
                          background: meta.auto ? `${agent.color}22` : 'transparent',
                          color: meta.auto ? agent.color : '#475569',
                          fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        }}>
                        {meta.auto ? '⚡ 自动' : '手动'}
                      </button>
                    )}

                    {/* Pause toggle */}
                    <button
                      onClick={() => setPaused(agent.key, !meta.paused)}
                      style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #334155', background: meta.paused ? '#451a03' : 'transparent', color: meta.paused ? '#fb923c' : '#475569', fontSize: 12, cursor: 'pointer' }}>
                      {meta.paused ? '⏸ 暂停中' : '⏸'}
                    </button>

                    {/* Manual run */}
                    <button
                      disabled={busy || (state?.globalStop ?? false) || meta.paused || agent.isHumanGate}
                      onClick={() => runAgent(agent.key, agent.name)}
                      style={{
                        padding: '6px 16px', borderRadius: 6, border: 'none',
                        background: (busy || state?.globalStop || meta.paused || agent.isHumanGate) ? '#1e293b' : agent.color,
                        color: (busy || state?.globalStop || meta.paused || agent.isHumanGate) ? '#475569' : '#fff',
                        fontSize: 13, fontWeight: 600, cursor: (busy || state?.globalStop || meta.paused || agent.isHumanGate) ? 'not-allowed' : 'pointer',
                        minWidth: 80,
                      }}>
                      {busy ? '执行中…' : agent.isHumanGate ? '人工门控' : '▶ 执行'}
                    </button>
                  </div>
                </div>

                {/* Stats grid: 4 cards laid out evenly. For agents that don't
                    process items by status (source-scoring / ingestion), the
                    "待处理" tile turns into a 24h call-count instead of a stale
                    em-dash. */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 4 }}>
                  <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '10px 12px' }}>
                    {agent.pendingStatus ? (
                      <>
                        <div style={{ fontSize: 10, color: '#475569', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>待处理</div>
                        <div style={{
                          fontSize: 24, fontWeight: 800,
                          color: pendingCnt && pendingCnt > 0 ? agent.color : '#334155',
                          lineHeight: 1.2, marginTop: 2,
                        }}>
                          {pendingCnt ?? 0}
                        </div>
                        <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>状态 {agent.pendingStatus}</div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: 10, color: '#475569', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>近 24h 调用</div>
                        <div style={{
                          fontSize: 24, fontWeight: 800,
                          color: (summary?.total ?? 0) > 0 ? agent.color : '#334155',
                          lineHeight: 1.2, marginTop: 2,
                        }}>
                          {summary?.total ?? 0}
                        </div>
                        <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>无队列阻塞</div>
                      </>
                    )}
                  </div>

                  <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 10, color: '#475569', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>近 24h 成败</div>
                    <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.3, marginTop: 2 }}>
                      <span style={{ color: '#22c55e' }}>✓ {summary?.success ?? 0}</span>
                      <span style={{ color: '#475569', margin: '0 6px' }}>/</span>
                      <span style={{ color: (summary?.failed ?? 0) > 0 ? '#f87171' : '#475569' }}>✗ {summary?.failed ?? 0}</span>
                    </div>
                    <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>
                      {summary && (summary.success + summary.failed) > 0
                        ? `${((summary.success / (summary.success + summary.failed)) * 100).toFixed(0)}% 成功`
                        : '暂无数据'}
                    </div>
                  </div>

                  <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 10, color: '#475569', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>平均延迟</div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: '#60a5fa', lineHeight: 1.2, marginTop: 2 }}>
                      {summary?.avg_latency_ms ? `${summary.avg_latency_ms}` : '—'}
                      <span style={{ fontSize: 12, color: '#475569', marginLeft: 4, fontWeight: 600 }}>ms</span>
                    </div>
                    <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>每次调用</div>
                  </div>

                  <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 10, color: '#475569', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>近 24h 成本</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#a78bfa', lineHeight: 1.2, marginTop: 2 }}>
                      ${Number(summary?.total_cost_usd ?? 0).toFixed(4)}
                    </div>
                    <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>USD</div>
                  </div>
                </div>

                {/* ── Live strip: 正在处理 + 最近完成 ── */}
                <LiveStrip
                  active={liveJobs.active[agent.key] ?? []}
                  recent={liveJobs.recent[agent.key] ?? []}
                  color={agent.color}
                  onClickItem={(id) => showHistory(id)}
                />

                {/* ── COMPLIANCE REVIEW human gate (inline) ── */}
                {agent.key === 'compliance' && reviewItems.length > 0 && (
                  <div style={{ marginTop: 14, borderTop: '1px solid #334155', paddingTop: 12 }}>
                    <div style={{ fontSize: 12, color: '#f59e0b', marginBottom: 8, fontWeight: 600 }}>
                      ⚠ {reviewItems.length} 条待人工审核（机器建议复核）
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                      {reviewItems.map(item => (
                        <div key={item.id} style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '10px 12px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                          <div
                            onClick={() => showHistory(item.id)}
                            style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                            title="点击查看完整内容">
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#93c5fd', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}>
                              {item.title}
                            </div>
                            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>来源: {item.source}</div>
                            {item.risk_tags.length > 0 && (
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                {item.risk_tags.map(t => (
                                  <span key={t} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, background: '#7f1d1d', color: '#fca5a5' }}>{t}</span>
                                ))}
                              </div>
                            )}
                            {item.summary && <div style={{ fontSize: 11, color: '#475569', marginTop: 4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{item.summary}</div>}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: '#78350f', color: '#fde68a', textAlign: 'center' }}>机器: 建议复核</span>
                            <button onClick={() => approveReview(item.id)} style={{ padding: '4px 12px', borderRadius: 5, border: 'none', background: '#14532d', color: '#86efac', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>✓ 批准</button>
                            <button onClick={() => rejectReview(item.id)} style={{ padding: '4px 12px', borderRadius: 5, border: 'none', background: '#450a0a', color: '#fca5a5', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>✗ 拒绝</button>
                            <button onClick={() => showHistory(item.id)} style={{ padding: '4px 12px', borderRadius: 5, border: '1px solid #334155', background: 'transparent', color: '#64748b', fontSize: 11, cursor: 'pointer' }}>追踪</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── PUBLISHING human gate (inline) ── */}
                {agent.key === 'publishing' && (
                  <div style={{ marginTop: 14, borderTop: '1px solid #4c1d95', paddingTop: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                      <span style={{ fontSize: 12, color: '#a78bfa', fontWeight: 600 }}>
                        🔐 {publishItems.length} 篇待人工批准发布
                      </span>
                      {publishItems.length > 0 && (
                        <>
                          <button
                            onClick={() => approvePublish(selectedItems.size > 0 ? [...selectedItems] : undefined)}
                            style={{ padding: '5px 14px', borderRadius: 6, border: 'none', background: '#4c1d95', color: '#ddd6fe', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                            {selectedItems.size > 0 ? `批准选中 ${selectedItems.size} 篇` : `批准全部 ${publishItems.length} 篇`}
                          </button>
                          {selectedItems.size > 0 && (
                            <button onClick={() => setSelectedItems(new Set())} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #334155', background: 'transparent', color: '#64748b', fontSize: 11, cursor: 'pointer' }}>清除选择</button>
                          )}
                        </>
                      )}
                    </div>
                    {publishItems.length === 0 ? (
                      <div style={{ fontSize: 12, color: '#334155', padding: '10px 0' }}>暂无待发布文章</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 240, overflowY: 'auto' }}>
                        {publishItems.map(item => (
                          <div key={item.id} style={{ background: '#0f172a', border: `1px solid ${selectedItems.has(item.id) ? '#7c3aed' : '#1e293b'}`, borderRadius: 7, padding: '9px 12px', display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}
                            onClick={() => setSelectedItems(prev => { const n = new Set(prev); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n; })}>
                            <input type="checkbox" readOnly checked={selectedItems.has(item.id)} style={{ accentColor: '#7c3aed', flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
                              <div style={{ fontSize: 11, color: '#475569' }}>{item.category ?? '—'} · {item.source}</div>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button onClick={e => { e.stopPropagation(); approvePublish([item.id]); }} style={{ padding: '3px 10px', borderRadius: 5, border: 'none', background: '#4c1d95', color: '#ddd6fe', fontSize: 11, cursor: 'pointer' }}>发布</button>
                              <button onClick={e => { e.stopPropagation(); showHistory(item.id); }} style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid #334155', background: 'transparent', color: '#64748b', fontSize: 11, cursor: 'pointer' }}>追踪</button>
                              <button onClick={e => { e.stopPropagation(); rollback(item.id, item.title); }} style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid #334155', background: 'transparent', color: '#f87171', fontSize: 11, cursor: 'pointer' }}>回滚</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── DISTRIBUTION human gate (inline) ── */}
                {agent.key === 'distribution' && (
                  <div style={{ marginTop: 14, borderTop: '1px solid #1e3a5f', paddingTop: 12 }}>
                    <div style={{ fontSize: 12, color: '#60a5fa', marginBottom: 8, fontWeight: 600 }}>
                      🔐 {distTasks.length} 条待人工确认分发（复制文案后手动发布）
                    </div>
                    {distTasks.length === 0 ? (
                      <div style={{ fontSize: 12, color: '#334155', padding: '10px 0' }}>暂无待分发任务 · 先点上方「执行」生成文案</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
                        {distTasks.map(task => (
                          <div key={task.task_id} style={{ background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 8, padding: '10px 12px' }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#93c5fd', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</div>
                            <pre style={{ margin: '0 0 8px', fontSize: 12, color: '#e2e8f0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#1e293b', padding: '8px 10px', borderRadius: 5, lineHeight: 1.6 }}>{task.copy}</pre>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <CopyBtn text={task.copy} />
                              <button onClick={() => confirmDist(task.task_id)} style={{ padding: '3px 12px', borderRadius: 5, border: 'none', background: '#1e3a5f', color: '#60a5fa', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>✓ 已发出</button>
                              <button onClick={() => showHistory(task.item_id)} style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid #334155', background: 'transparent', color: '#64748b', fontSize: 11, cursor: 'pointer' }}>追踪</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

            </div>
          );
        })}

          </div>
          {/* end right-column wrapper */}
        </div>
        {/* end vertical-stepper + detail flex container */}

        {/* Queue snapshot + recent runs panel hidden in pipeline tab —
            still available on the dedicated 队列 & 成本 tab. */}
        </>}

        {/* ── Sources tab ── */}
        {tab === 'sources' && (
          <SourcesPanel
            sources={sources}
            editingSource={editingSource}
            showAddSource={showAddSource}
            setEditingSource={setEditingSource}
            setShowAddSource={setShowAddSource}
            onSave={saveSource}
            onDelete={deleteSource}
            onToggleStatus={toggleSourceStatus}
            onIngest={ingestOne}
            onAfterBatch={load}
            flash={flash}
            credentials={credentials}
            refreshingCredId={refreshingCredId}
            reloadCredentials={reloadCredentials}
            refreshCredential={refreshCredential}
          />
        )}

        {/* ── Crawl preview tab ── */}
        {tab === 'crawl' && (
          <CrawlPreviewPanel
            sources={sources}
            items={rawItems}
            total={rawTotal}
            loading={rawLoading}
            sourceId={rawSourceId}
            withMedia={rawWithMedia}
            page={rawPage}
            pageSize={RAW_PAGE_SIZE}
            onSourceChange={(id) => { setRawSourceId(id); setRawPage(0); }}
            onWithMediaChange={(v) => { setRawWithMedia(v); setRawPage(0); }}
            onPageChange={setRawPage}
            onRefresh={loadRawItems}
          />
        )}

        {/* ── Credentials pool tab ── */}
        {tab === 'credentials' && (
          <CredentialsPanel
            credentials={credentials}
            refreshingCredId={refreshingCredId}
            reload={reloadCredentials}
            onRefreshOne={refreshCredential}
            flash={flash}
          />
        )}

        {/* ── Queues tab ── */}
        {tab === 'queues' && (
          <QueueRunsPanel queues={queues} agentSummary={agentSummary} />
        )}

        {/* ── Operation logs tab ── */}
        {tab === 'oplogs' && (
          <OpLogsPanel />
        )}

      </div>
    </div>
  );
}

// ─── LiveStrip: "正在处理" + "最近完成" ─────────────────────────────────────

function LiveStrip({
  active, recent, color, onClickItem,
}: {
  active: Array<{ itemId: string | null; label: string; since: string | null }>;
  recent: Array<{ agent: string; item_id: string | null; title: string | null; finished_at: string; latency_ms: number | null; status: string }>;
  color: string;
  onClickItem: (id: string) => void;
}) {
  if (active.length === 0 && recent.length === 0) return null;

  const fmtSince = (iso: string | null) => {
    if (!iso) return '';
    const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m${sec % 60}s`;
  };

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #334155', fontSize: 11 }}>
      {active.length > 0 && (
        <div style={{ marginBottom: recent.length > 0 ? 8 : 0 }}>
          <div style={{ color: color, fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: color, animation: 'pulse 1s infinite' }} />
            正在处理 · {active.length}
          </div>
          {active.map((a, i) => (
            <div key={i}
              onClick={() => a.itemId && onClickItem(a.itemId)}
              title={a.itemId ? '点击查看详情' : ''}
              style={{
                padding: '4px 8px', marginBottom: 2,
                background: '#0f172a', borderRadius: 4,
                color: '#cbd5e1',
                cursor: a.itemId ? 'pointer' : 'default',
                display: 'flex', gap: 8, alignItems: 'center',
                overflow: 'hidden',
              }}>
              <span style={{ color: '#64748b', fontSize: 10, flexShrink: 0, minWidth: 28 }}>{fmtSince(a.since)}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.label}</span>
            </div>
          ))}
        </div>
      )}
      {recent.length > 0 && (
        <div>
          <div style={{ color: '#64748b', fontWeight: 600, marginBottom: 4 }}>最近完成 · {recent.length}</div>
          {recent.map((r, i) => (
            <div key={i}
              onClick={() => r.item_id && onClickItem(r.item_id)}
              title={r.item_id ? '点击查看详情' : ''}
              style={{
                padding: '4px 8px', marginBottom: 2,
                background: '#0f172a', borderRadius: 4,
                color: '#94a3b8',
                cursor: r.item_id ? 'pointer' : 'default',
                display: 'flex', gap: 8, alignItems: 'center',
                overflow: 'hidden',
                opacity: r.status === 'success' ? 1 : 0.7,
              }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                background: r.status === 'success' ? '#22c55e' : '#ef4444',
              }} />
              <span style={{ color: '#64748b', fontSize: 10, flexShrink: 0, minWidth: 42 }}>
                {r.latency_ms ? `${r.latency_ms}ms` : '—'}
              </span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.title ?? (r.item_id ? `item ${r.item_id.slice(0, 8)}` : '—')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── SourcesPanel ─────────────────────────────────────────────────────────────

function SourcesPanel({
  sources, editingSource, showAddSource,
  setEditingSource, setShowAddSource,
  onSave, onDelete, onToggleStatus, onIngest,
  onAfterBatch, flash,
  credentials, refreshingCredId, reloadCredentials, refreshCredential,
}: {
  sources: Source[];
  editingSource: Source | null;
  showAddSource: boolean;
  setEditingSource: (s: Source | null) => void;
  setShowAddSource: (v: boolean) => void;
  onSave: (data: any) => void;
  onDelete: (s: Source) => void;
  onToggleStatus: (s: Source) => void;
  onIngest: (s: Source) => void;
  onAfterBatch: () => void;
  flash: (msg: string, ok?: boolean) => void;
  credentials: CredentialRow[];
  refreshingCredId: string | null;
  reloadCredentials: () => Promise<void>;
  refreshCredential: (id: string) => Promise<void>;
}) {
  // Batch-import modal state. Lives inside SourcesPanel because it's coupled
  // to this surface; surfacing it through the global state machine isn't worth
  // the indirection.
  const [showBatch, setShowBatch] = useState(false);
  const [batchPlatform, setBatchPlatform] = useState<'x' | 'bluesky' | 'reddit'>('x');
  const [batchHandles, setBatchHandles] = useState('');
  const [batchCookie, setBatchCookie] = useState('');
  const [batchUserAgent, setBatchUserAgent] = useState('');
  const [batchLimit, setBatchLimit] = useState(20);
  const [batchSkipRetweets, setBatchSkipRetweets] = useState(true);
  const [batchTriggerFetch, setBatchTriggerFetch] = useState(true);
  // Reddit-specific knobs (sort/time controlling /r/<sub>/<sort>.json?t=<time>)
  const [batchRedditSort, setBatchRedditSort] = useState<'hot'|'new'|'top'|'rising'>('top');
  const [batchRedditTime, setBatchRedditTime] = useState<'hour'|'day'|'week'|'month'|'year'|'all'>('day');
  // credentials / refreshingCredId / reloadCredentials / refreshCredential
  // are now lifted to WorkbenchPage and passed as props above.
  const [batchCredentialId, setBatchCredentialId] = useState<string>('');
  // Inline-create-credential affordance (no need to leave the modal)
  const [showCreateCred, setShowCreateCred] = useState(false);
  const [newCredName, setNewCredName] = useState('');
  const [newCredCookie, setNewCredCookie] = useState('');
  const [newCredUA, setNewCredUA] = useState('');
  // Optional auto-refresh secret (X username + password). When filled, the
  // refresh worker can re-login when this credential's cookie expires.
  const [newCredXUser, setNewCredXUser] = useState('');
  const [newCredXPass, setNewCredXPass] = useState('');
  const [credBusy, setCredBusy] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResult, setBatchResult] = useState<null | {
    created: { handle: string; sourceId: string }[];
    updated: { handle: string; sourceId: string }[];
    failed: { handle: string; reason: string }[];
  }>(null);

  // Default-fill cookie+UA from the most recent X source so the user doesn't
  // re-paste a 4KB cookie for every batch.
  const openBatchModal = () => {
    const lastX = sources.find(s => s.platform === 'x' && (s.config?.cookie as string));
    setBatchCookie((lastX?.config?.cookie as string) ?? '');
    setBatchUserAgent((lastX?.config?.userAgent as string) ?? '');
    setBatchHandles('');
    setBatchResult(null);
    setShowBatch(true);
  };

  const submitBatch = async () => {
    const handles = batchHandles
      .split(/[\n,，;\s]+/)
      .map(h => h.trim())
      .filter(Boolean);
    if (handles.length === 0) {
      flash('请粘贴至少一个 handle', false);
      return;
    }
    const sharedConfig: Record<string, unknown> = { limit: Number(batchLimit) || 20 };
    const usingCred = !!batchCredentialId;
    if (batchPlatform === 'x') {
      if (!usingCred && !batchCookie.trim()) { flash('X 需要 cookie 或选择一个凭证', false); return; }
      if (!usingCred) sharedConfig.cookie = batchCookie.trim();
      if (!usingCred && batchUserAgent.trim()) sharedConfig.userAgent = batchUserAgent.trim();
      sharedConfig.skipRetweets = batchSkipRetweets;
    }
    if (batchPlatform === 'reddit') {
      sharedConfig.sort = batchRedditSort;
      sharedConfig.time = batchRedditTime;
      if (batchUserAgent.trim()) sharedConfig.userAgent = batchUserAgent.trim();
    }
    setBatchBusy(true);
    try {
      const r = await fetch(`${API}/admin/sources/batch-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: batchPlatform,
          handles,
          sharedConfig,
          credentialId: batchCredentialId || undefined,
          triggerFetch: batchTriggerFetch,
        }),
      });
      if (!r.ok) {
        const txt = await r.text();
        flash(`导入失败：${txt.slice(0, 160)}`, false);
        return;
      }
      const d = await r.json();
      setBatchResult({ created: d.created ?? [], updated: d.updated ?? [], failed: d.failed ?? [] });
      flash(`导入完成：新建 ${d.created?.length ?? 0} · 更新 ${d.updated?.length ?? 0} · 失败 ${d.failed?.length ?? 0}`);
      onAfterBatch();
    } catch (e: any) {
      flash(`导入异常：${e?.message ?? e}`, false);
    } finally {
      setBatchBusy(false);
    }
  };

  const [form, setForm] = useState({ name: '', url: '', platform: 'x', external_id: '', htmlUrls: '', perImage: false, useBrowser: false, extractAll: false, htmlMode: 'article' as 'article'|'per-image'|'crawl', crawlEntry: '', crawlMaxDepth: 2, crawlMaxPages: 30, crawlPattern: '', ksgIds: '', ksgBucket: '5', ksgHost: 'uib.2ksg.com', ksgToken: '', ksgReferer: 'https://uib.2ksg.com/app/', ksgCrawlList: false, ksgMaxIds: 30, knitUrls: '', knitCookie: '', knitUserAgent: '', redditSubs: '', redditSort: 'top' as 'hot'|'new'|'top'|'rising', redditTime: 'day' as 'hour'|'day'|'week'|'month'|'year'|'all', redditLimit: 25, redditUA: '', bskyMode: 'author' as 'author'|'search', bskyActor: '', bskyQuery: '', bskyLimit: 25, sitemapUrl: '', sitemapLimit: 200, sitemapPattern: '', xMode: 'user' as 'user'|'search', xScreenName: '', xQuery: '', xCookie: '', xUserAgent: '', xLimit: 20, htmlWaitFor: '', htmlExtraHeaders: '', htmlCookies: '', htmlLocale: '', htmlTimezone: '' });

  // Reliable sync: whenever editingSource changes (or list refresh swaps the
  // object identity), repopulate the form from the source's current values.
  useEffect(() => {
    if (!editingSource) return;
    const existingUrls = Array.isArray(editingSource.config?.urls)
      ? (editingSource.config!.urls as string[]).join('\n')
      : '';
    setForm({
      name: editingSource.name,
      url: (editingSource.config?.feed_url as string) ?? editingSource.url ?? '',
      platform: editingSource.platform,
      external_id: editingSource.external_id,
      htmlUrls: existingUrls,
      perImage: editingSource.config?.mode === 'per-image',
      useBrowser: editingSource.config?.render === 'browser',
      extractAll: editingSource.config?.extractAll === true,
      htmlMode: (editingSource.config?.mode === 'crawl' ? 'crawl'
                : editingSource.config?.mode === 'per-image' ? 'per-image'
                : 'article') as 'article'|'per-image'|'crawl',
      crawlEntry: (editingSource.config?.entry as string) ?? '',
      crawlMaxDepth: Number(editingSource.config?.maxDepth ?? 2),
      crawlMaxPages: Number(editingSource.config?.maxPages ?? 30),
      crawlPattern: (editingSource.config?.urlPattern as string) ?? '',
      ksgIds: Array.isArray(editingSource.config?.ids)
        ? (editingSource.config!.ids as string[]).join('\n')
        : '',
      ksgBucket: (editingSource.config?.bucket as string) ?? '5',
      ksgHost: (editingSource.config?.host as string) ?? 'uib.2ksg.com',
      ksgToken: (editingSource.config?.token as string) ?? '',
      ksgReferer: (editingSource.config?.referer as string) ?? 'https://uib.2ksg.com/app/',
      ksgCrawlList: editingSource.config?.crawlList === true,
      ksgMaxIds: Number(editingSource.config?.maxIds ?? 30),
      knitUrls: Array.isArray(editingSource.config?.urls) && editingSource.platform === 'knit'
        ? (editingSource.config!.urls as string[]).join('\n')
        : '',
      knitCookie: (editingSource.config?.cookie as string) ?? '',
      knitUserAgent: (editingSource.config?.userAgent as string) ?? '',
      redditSubs: Array.isArray(editingSource.config?.subreddits)
        ? (editingSource.config!.subreddits as string[]).join('\n')
        : '',
      redditSort: ((editingSource.config?.sort as string) ?? 'top') as 'hot'|'new'|'top'|'rising',
      redditTime: ((editingSource.config?.time as string) ?? 'day') as 'hour'|'day'|'week'|'month'|'year'|'all',
      redditLimit: Number(editingSource.config?.limit ?? 25),
      redditUA: (editingSource.config?.userAgent as string) ?? '',
      bskyMode: ((editingSource.config?.mode as string) ?? 'author') as 'author'|'search',
      bskyActor: (editingSource.config?.actor as string) ?? '',
      bskyQuery: (editingSource.config?.query as string) ?? '',
      bskyLimit: Number(editingSource.config?.limit ?? 25),
      sitemapUrl: (editingSource.config?.sitemapUrl as string) ?? '',
      sitemapLimit: Number(editingSource.config?.limit ?? 200),
      sitemapPattern: (editingSource.config?.pagePattern as string) ?? '',
      xMode: ((editingSource.config?.mode as string) ?? 'user') as 'user'|'search',
      xScreenName: (editingSource.config?.screenName as string) ?? '',
      xQuery: (editingSource.config?.query as string) ?? '',
      xCookie: (editingSource.config?.cookie as string) ?? '',
      xUserAgent: (editingSource.config?.userAgent as string) ?? '',
      xLimit: Number(editingSource.config?.limit ?? 20),
      htmlWaitFor: (editingSource.config?.waitForSelector as string) ?? '',
      htmlExtraHeaders: editingSource.config?.extraHeaders
        ? JSON.stringify(editingSource.config.extraHeaders, null, 2)
        : '',
      htmlCookies: Array.isArray(editingSource.config?.cookies)
        ? JSON.stringify(editingSource.config.cookies, null, 2)
        : '',
      htmlLocale: (editingSource.config?.locale as string) ?? '',
      htmlTimezone: (editingSource.config?.timezone as string) ?? '',
    });
  }, [editingSource?.id]);

  const startEdit = (src: Source) => {
    setEditingSource(src);
    setShowAddSource(false);
    // useEffect above will populate the form when editingSource updates.
  };

  const resetForm = () => {
    // Inherit site-level settings (token / host / bucket / referer) from the
    // most recent 2ksg source that has them set. Saves the user from having
    // to re-enter token every time they add a new gallery.
    const lastKsg = sources.find(s => s.platform === '2ksg' && (s.config?.token as string));
    const lastKnit = sources.find(s => s.platform === 'knit' && (s.config?.cookie as string));
    setForm({
      name: '', url: '', platform: 'x', external_id: '', htmlUrls: '',
      perImage: false, useBrowser: false, extractAll: false,
      htmlMode: 'article' as 'article'|'per-image'|'crawl',
      crawlEntry: '', crawlMaxDepth: 2, crawlMaxPages: 30, crawlPattern: '',
      ksgIds: '',
      ksgBucket: (lastKsg?.config?.bucket as string) ?? '5',
      ksgHost:   (lastKsg?.config?.host   as string) ?? 'uib.2ksg.com',
      ksgToken:  (lastKsg?.config?.token  as string) ?? '',
      ksgReferer:(lastKsg?.config?.referer as string) ?? 'https://uib.2ksg.com/app/',
      ksgCrawlList: false,
      ksgMaxIds: 30,
      knitUrls: '',
      knitCookie:    (lastKnit?.config?.cookie    as string) ?? '',
      knitUserAgent: (lastKnit?.config?.userAgent as string) ?? '',
      redditSubs: '',
      redditSort: 'top' as 'hot'|'new'|'top'|'rising',
      redditTime: 'day' as 'hour'|'day'|'week'|'month'|'year'|'all',
      redditLimit: 25,
      redditUA: '',
      bskyMode: 'author' as 'author'|'search',
      bskyActor: '',
      bskyQuery: '',
      bskyLimit: 25,
      sitemapUrl: '',
      sitemapLimit: 200,
      sitemapPattern: '',
      xMode: 'user' as 'user'|'search',
      xScreenName: '',
      xQuery: '',
      xCookie: (sources.find((s) => s.platform === 'x' && (s.config?.cookie as string))?.config?.cookie as string) ?? '',
      xUserAgent: (sources.find((s) => s.platform === 'x' && (s.config?.userAgent as string))?.config?.userAgent as string) ?? '',
      xLimit: 20,
      htmlWaitFor: '',
      htmlExtraHeaders: '',
      htmlCookies: '',
      htmlLocale: '',
      htmlTimezone: '',
    });
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: '#94a3b8' }}>
          共 <strong style={{ color: '#e2e8f0' }}>{sources.length}</strong> 个来源 ·&nbsp;
          <span style={{ color: '#22c55e' }}>活跃 {sources.filter(s => s.status === 'active').length}</span>
          &nbsp;/ <span style={{ color: '#475569' }}>停用 {sources.filter(s => s.status !== 'active').length}</span>
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={openBatchModal}
            title="批量粘贴博主 handle（X / Bluesky），系统自动建源 + 抓取 + 分类"
            style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #6366f1', background: 'transparent', color: '#a5b4fc', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            ⚡ 批量导入博主
          </button>
          <button
            onClick={() => { resetForm(); setShowAddSource(true); setEditingSource(null); }}
            style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#6366f1', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            + 添加来源
          </button>
        </div>
      </div>

      {/* Batch-import modal */}
      {showBatch && (
        <div
          onClick={() => !batchBusy && setShowBatch(false)}
          style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#1e293b', border: '1px solid #6366f1', borderRadius: 12, padding: 22, maxWidth: 640, width: '100%', maxHeight: '88vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#a5b4fc' }}>⚡ 批量导入博主</div>
              <button onClick={() => !batchBusy && setShowBatch(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>

            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14, lineHeight: 1.6 }}>
              粘贴一批 handle，系统会为每个建一条独立的采集源（共享下面的 cookie / 限制），
              并按 fanout 节奏自动抓取 + 走完分类→标题→封面→合规→发布全流程。
            </div>

            {/* Platform */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {(['x', 'bluesky', 'reddit'] as const).map(p => (
                <button key={p} onClick={() => setBatchPlatform(p)}
                  disabled={batchBusy}
                  style={{
                    flex: 1, padding: '7px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                    border: '1px solid', borderColor: batchPlatform === p ? '#6366f1' : '#334155',
                    background: batchPlatform === p ? '#312e81' : 'transparent',
                    color: batchPlatform === p ? '#c7d2fe' : '#64748b', cursor: 'pointer',
                  }}>
                  {p === 'x' ? 'X (Twitter)' : p === 'bluesky' ? 'Bluesky' : 'Reddit'}
                </button>
              ))}
            </div>

            {/* Credential picker — for X only (knit/bluesky can use it too in future). */}
            {(batchPlatform === 'x') && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>凭证池（推荐）</span>
                  {!showCreateCred && (
                    <button onClick={() => { setShowCreateCred(true); setNewCredName(''); setNewCredCookie(''); setNewCredUA(''); }}
                      disabled={batchBusy}
                      style={{ background: 'none', border: 'none', color: '#a5b4fc', fontSize: 11, cursor: 'pointer', padding: 0 }}>
                      + 新建凭证
                    </button>
                  )}
                </div>
                <select
                  value={batchCredentialId}
                  onChange={e => setBatchCredentialId(e.target.value)}
                  disabled={batchBusy || showCreateCred}
                  style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, colorScheme: 'dark' }}>
                  <option value="">— 不用凭证池（粘贴 cookie 到下方）—</option>
                  {credentials
                    .filter(c => c.platform === batchPlatform)
                    .map(c => {
                      const statusIcon = c.status === 'active' ? '✓' : c.status === 'expired' ? '⚠ expired' : '✗ revoked';
                      const refreshIcon = c.has_secret ? ' · 🔁 自动刷新' : '';
                      const sourceUse = c.source_count > 0 ? ` · ${c.source_count} 源` : '';
                      return (
                        <option key={c.id} value={c.id}>
                          {c.name} · {statusIcon}{refreshIcon}{sourceUse}
                        </option>
                      );
                    })}
                </select>
                {/* Selected-credential action row: show refresh button + status detail */}
                {batchCredentialId && (() => {
                  const c = credentials.find(x => x.id === batchCredentialId);
                  if (!c) return null;
                  const lastRefresh = c.secret_last_refresh_at ? new Date(c.secret_last_refresh_at).toLocaleString('zh-CN') : '—';
                  const failedSinceLast = (c.secret_consecutive_failures ?? 0) > 0;
                  return (
                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: '#64748b' }}>
                      {c.has_secret ? (
                        <>
                          <span>账号 <strong style={{ color: '#cbd5e1' }}>{c.secret_username}</strong></span>
                          <span>· 上次刷新 {lastRefresh}</span>
                          {failedSinceLast && (
                            <span style={{ color: '#f87171' }} title={c.secret_last_refresh_error ?? undefined}>
                              · 连续失败 {c.secret_consecutive_failures} 次
                            </span>
                          )}
                          <button
                            onClick={() => refreshCredential(batchCredentialId)}
                            disabled={refreshingCredId === batchCredentialId || batchBusy}
                            title="用账号密码 stealth 登录刷一次 cookie（约 15-30 秒）"
                            style={{ marginLeft: 'auto', padding: '3px 10px', borderRadius: 5, border: '1px solid #334155', background: refreshingCredId === batchCredentialId ? '#1e293b' : 'transparent', color: refreshingCredId === batchCredentialId ? '#475569' : '#a5b4fc', fontSize: 11, cursor: refreshingCredId === batchCredentialId ? 'not-allowed' : 'pointer' }}>
                            {refreshingCredId === batchCredentialId ? '刷新中…' : '🔁 立即刷新'}
                          </button>
                        </>
                      ) : (
                        <span style={{ color: '#64748b' }}>
                          未配置自动刷新 · 当 cookie 过期时需要手动重新粘贴
                        </span>
                      )}
                    </div>
                  );
                })()}
                {showCreateCred && (
                  <div style={{ marginTop: 8, padding: 10, background: '#0f172a', border: '1px dashed #334155', borderRadius: 6 }}>
                    <div style={{ fontSize: 11, color: '#a5b4fc', fontWeight: 600, marginBottom: 6 }}>新建凭证</div>
                    <input
                      value={newCredName}
                      onChange={e => setNewCredName(e.target.value)}
                      placeholder="凭证名（如 main-x-account-2026-04）"
                      disabled={credBusy}
                      style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, marginBottom: 6 }} />
                    <textarea
                      value={newCredCookie}
                      onChange={e => setNewCredCookie(e.target.value)}
                      rows={3}
                      placeholder="auth_token=…; ct0=…; …"
                      disabled={credBusy}
                      style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'ui-monospace, monospace', resize: 'vertical', marginBottom: 6 }} />
                    <input
                      value={newCredUA}
                      onChange={e => setNewCredUA(e.target.value)}
                      placeholder="User-Agent（可选）"
                      disabled={credBusy}
                      style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'ui-monospace, monospace', marginBottom: 8 }} />

                    {/* Optional auto-refresh secret */}
                    {batchPlatform === 'x' && (
                      <details style={{ marginBottom: 8 }}>
                        <summary style={{ fontSize: 11, color: '#a5b4fc', cursor: 'pointer', marginBottom: 6 }}>
                          🔁 配置自动刷新（X 用户名 + 密码，加密存储）
                        </summary>
                        <div style={{ marginTop: 6, padding: '8px 10px', background: '#1e293b', borderRadius: 5, border: '1px solid #312e81' }}>
                          <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6, lineHeight: 1.5 }}>
                            填了之后，cookie 过期时系统会自动用账号密码重新登录刷新。
                            遇到 Arkose / 2FA / 邮件验证码时刷新失败，仍需人工处理。
                            密码用 AES-256-GCM 加密后入库，不会以明文返回。
                          </div>
                          <input
                            value={newCredXUser}
                            onChange={e => setNewCredXUser(e.target.value)}
                            placeholder="X 用户名 / 邮箱 / 手机号"
                            disabled={credBusy}
                            autoComplete="off"
                            style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, marginBottom: 6 }} />
                          <input
                            type="password"
                            value={newCredXPass}
                            onChange={e => setNewCredXPass(e.target.value)}
                            placeholder="X 密码"
                            disabled={credBusy}
                            autoComplete="new-password"
                            style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }} />
                        </div>
                      </details>
                    )}

                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button onClick={() => setShowCreateCred(false)} disabled={credBusy}
                        style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontSize: 11, cursor: 'pointer' }}>
                        取消
                      </button>
                      <button
                        disabled={credBusy || !newCredName.trim() || !newCredCookie.trim()}
                        onClick={async () => {
                          setCredBusy(true);
                          try {
                            const r = await fetch(`${API}/admin/credentials`, {
                              method: 'POST', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                platform: batchPlatform,
                                name: newCredName.trim(),
                                cookie: newCredCookie.trim(),
                                user_agent: newCredUA.trim() || null,
                              }),
                            });
                            if (!r.ok) {
                              const txt = await r.text();
                              flash(`创建失败：${txt.slice(0, 160)}`, false);
                              return;
                            }
                            const d = await r.json();
                            // If user filled the auto-refresh secret, attach it
                            if (newCredXUser.trim() && newCredXPass.trim()) {
                              const sr = await fetch(`${API}/admin/credentials/${d.credential.id}/secret`, {
                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ username: newCredXUser.trim(), password: newCredXPass }),
                              });
                              if (!sr.ok) {
                                const txt = await sr.text();
                                flash(`凭证已建，但保存账密失败：${txt.slice(0, 120)}`, false);
                              }
                            }
                            await reloadCredentials();
                            setBatchCredentialId(d.credential.id);
                            setShowCreateCred(false);
                            // Clear the password from memory ASAP
                            setNewCredXPass('');
                            flash(`已新建凭证 "${d.credential.name}"`);
                          } finally { setCredBusy(false); }
                        }}
                        style={{ padding: '4px 12px', borderRadius: 5, border: 'none', background: credBusy ? '#1e293b' : '#6366f1', color: credBusy ? '#475569' : '#fff', fontSize: 11, fontWeight: 600, cursor: credBusy ? 'not-allowed' : 'pointer' }}>
                        {credBusy ? '保存中…' : '保存凭证'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Cookie & UA — only for X, and only when no credential picked */}
            {batchPlatform === 'x' && !batchCredentialId && (
              <>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>共享 Cookie（须含 auth_token + ct0）</span>
                  <textarea
                    value={batchCookie}
                    onChange={e => setBatchCookie(e.target.value)}
                    rows={3}
                    placeholder="auth_token=…; ct0=…; …"
                    disabled={batchBusy}
                    style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'ui-monospace, monospace', resize: 'vertical' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>User-Agent（可选，与 cookie 抓取的浏览器一致）</span>
                  <input
                    value={batchUserAgent}
                    onChange={e => setBatchUserAgent(e.target.value)}
                    placeholder="Mozilla/5.0 (Macintosh; …) Chrome/147.0.0.0"
                    disabled={batchBusy}
                    style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'ui-monospace, monospace' }} />
                </label>
              </>
            )}

            {/* Reddit-specific knobs */}
            {batchPlatform === 'reddit' && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>排序</span>
                  <select
                    value={batchRedditSort}
                    onChange={e => setBatchRedditSort(e.target.value as any)}
                    disabled={batchBusy}
                    style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, colorScheme: 'dark' }}>
                    <option value="top">top</option>
                    <option value="hot">hot</option>
                    <option value="new">new</option>
                    <option value="rising">rising</option>
                  </select>
                </label>
                <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>时间窗（仅 sort=top）</span>
                  <select
                    value={batchRedditTime}
                    onChange={e => setBatchRedditTime(e.target.value as any)}
                    disabled={batchBusy || batchRedditSort !== 'top'}
                    style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, colorScheme: 'dark' }}>
                    <option value="hour">hour</option>
                    <option value="day">day</option>
                    <option value="week">week</option>
                    <option value="month">month</option>
                    <option value="year">year</option>
                    <option value="all">all</option>
                  </select>
                </label>
                <label style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>User-Agent（可选）</span>
                  <input
                    value={batchUserAgent}
                    onChange={e => setBatchUserAgent(e.target.value)}
                    placeholder="ch-agents/0.1 (+content-pipeline)"
                    disabled={batchBusy}
                    style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'ui-monospace, monospace' }} />
                </label>
              </div>
            )}

            {/* Handles */}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>
                {batchPlatform === 'x'
                  ? '博主 handle 列表（每行一个，自动去 @ / 去重）'
                  : batchPlatform === 'reddit'
                    ? 'subreddit 列表（每行一个，自动去 r/ 前缀 / 去重）'
                    : 'actor handle 列表（每行一个）'}
              </span>
              <textarea
                value={batchHandles}
                onChange={e => setBatchHandles(e.target.value)}
                rows={8}
                placeholder={
                  batchPlatform === 'x'
                    ? 'natgeo\n@elonmusk\nphotoblog123\n…\n（最多 500 个）'
                    : batchPlatform === 'reddit'
                      ? 'EarthPorn\nr/photographs\n/r/itookapicture\n…'
                      : 'pfrazee.com\nbsky.app\n…'
                }
                disabled={batchBusy}
                style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'ui-monospace, monospace', resize: 'vertical', lineHeight: 1.5 }} />
            </label>

            {/* Knobs */}
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8' }}>
                <span>每次抓取</span>
                <input
                  type="number" min={1} max={100}
                  value={batchLimit}
                  onChange={e => setBatchLimit(Math.max(1, Math.min(100, Number(e.target.value) || 20)))}
                  disabled={batchBusy}
                  style={{ width: 70, background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '4px 8px', color: '#e2e8f0', fontSize: 12 }} />
                <span style={{ color: '#475569' }}>条/源</span>
              </label>
              {batchPlatform === 'x' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8', cursor: 'pointer' }}>
                  <input type="checkbox" checked={batchSkipRetweets} onChange={e => setBatchSkipRetweets(e.target.checked)} disabled={batchBusy} />
                  跳过转推（避免重复入库）
                </label>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8', cursor: 'pointer' }}>
                <input type="checkbox" checked={batchTriggerFetch} onChange={e => setBatchTriggerFetch(e.target.checked)} disabled={batchBusy} />
                立即触发首次采集
              </label>
            </div>

            {/* Result */}
            {batchResult && (
              <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 12 }}>
                <div style={{ marginBottom: 6 }}>
                  <span style={{ color: '#22c55e', fontWeight: 700 }}>✓ 新建 {batchResult.created.length}</span>
                  <span style={{ color: '#475569', margin: '0 8px' }}>·</span>
                  <span style={{ color: '#60a5fa', fontWeight: 700 }}>↻ 更新 {batchResult.updated.length}</span>
                  <span style={{ color: '#475569', margin: '0 8px' }}>·</span>
                  <span style={{ color: batchResult.failed.length > 0 ? '#f87171' : '#475569', fontWeight: 700 }}>✗ 失败 {batchResult.failed.length}</span>
                </div>
                {batchResult.failed.length > 0 && (
                  <details style={{ marginTop: 6 }}>
                    <summary style={{ cursor: 'pointer', color: '#f87171', fontSize: 11 }}>展开失败详情 ({batchResult.failed.length})</summary>
                    <div style={{ marginTop: 6, maxHeight: 160, overflowY: 'auto', fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#fca5a5' }}>
                      {batchResult.failed.map((f, i) => (
                        <div key={i} style={{ padding: '2px 0' }}>
                          <strong>{f.handle}</strong>: {f.reason}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => !batchBusy && setShowBatch(false)} disabled={batchBusy}
                style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontSize: 12, cursor: batchBusy ? 'not-allowed' : 'pointer' }}>
                {batchResult ? '关闭' : '取消'}
              </button>
              <button onClick={submitBatch} disabled={batchBusy}
                style={{ padding: '7px 16px', borderRadius: 6, border: 'none', background: batchBusy ? '#1e293b' : '#6366f1', color: batchBusy ? '#475569' : '#fff', fontSize: 12, fontWeight: 700, cursor: batchBusy ? 'not-allowed' : 'pointer' }}>
                {batchBusy ? '导入中…' : (batchResult ? '再导一批' : '⚡ 开始导入')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit form — modal overlay */}
      {(showAddSource || editingSource) && (
        <div
          onClick={() => { setEditingSource(null); setShowAddSource(false); }}
          style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 9000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, overflowY: 'auto' }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#1e293b', border: '1px solid #6366f1', borderRadius: 10, padding: 16, width: '100%', maxWidth: 880, maxHeight: 'calc(100vh - 48px)', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#a5b4fc' }}>
              {editingSource ? `编辑：${editingSource.name}` : '新增采集源'}
            </div>
            <button
              onClick={() => { setEditingSource(null); setShowAddSource(false); }}
              style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
              aria-label="关闭">✕</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>名称</span>
              <input
                value={form.name}
                onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="BBC History Extra"
                style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>Platform</span>
              <select
                value={form.platform}
                onChange={e => setForm(prev => ({ ...prev, platform: e.target.value }))}
                style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}>
                {/* Only X is exposed for new sources right now. Other platforms
                    stay editable for existing rows so we can see/edit them. */}
                <option value="x">x — Twitter cookie 注入</option>
                {editingSource && editingSource.platform !== 'x' && (
                  <option value={editingSource.platform}>{editingSource.platform}（已有源，只读）</option>
                )}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>ID (slug)</span>
              <input
                value={form.external_id}
                onChange={e => setForm(prev => ({ ...prev, external_id: e.target.value }))}
                placeholder="bbc-history-extra"
                style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}
              />
            </label>
            {form.platform === 'rss' ? (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>Feed URL</span>
                <input
                  value={form.url}
                  onChange={e => setForm(prev => ({ ...prev, url: e.target.value }))}
                  placeholder="https://example.com/feed/"
                  style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}
                />
              </label>
            ) : (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>站点主页（可选，仅用于显示）</span>
                <input
                  value={form.url}
                  onChange={e => setForm(prev => ({ ...prev, url: e.target.value }))}
                  placeholder="https://example.com"
                  style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}
                />
              </label>
            )}
          </div>

          {/* 2ksg JSON API 配置 */}
          {form.platform === '2ksg' && (
            <div style={{ marginTop: 10, padding: '10px 12px', background: '#0f172a', border: '1px solid #ec4899', borderRadius: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#ec4899', marginBottom: 8 }}>
                🎀 2ksg / aizuyun JSON API 模式 — 直连图册接口，绕过 SPA 反爬
              </div>
              {(() => {
                const parsed = form.ksgIds.split('\n').map(parseKsgLine);
                const validIds = parsed.filter(p => p.id);
                const invalid = form.ksgIds.split('\n').filter(s => s.trim()).length - validIds.length;
                return (
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                    <span style={{ fontSize: 11, color: '#64748b' }}>
                      图册 URL 或 ID 列表（每行一个，可直接粘贴 detail 页地址）
                    </span>
                    <textarea
                      value={form.ksgIds}
                      onChange={e => {
                        const v = e.target.value;
                        const lines = v.split('\n').map(parseKsgLine);
                        const newHost = lines.find(p => p.host)?.host;
                        const newBucket = lines.find(p => p.tid)?.tid?.[0];
                        setForm(prev => ({
                          ...prev,
                          ksgIds: v,
                          ...(newHost ? { ksgHost: newHost } : {}),
                          ...(newBucket ? { ksgBucket: newBucket } : {}),
                        }));
                      }}
                      placeholder={'45499\nhttps://uib.2ksg.com/app/#/detail?mode=img&tid=591&sid=&id=78902'}
                      rows={4}
                      style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace', lineHeight: 1.6, resize: 'vertical' }}
                    />
                    <div style={{ fontSize: 10, color: validIds.length ? '#22c55e' : '#64748b', marginTop: 2 }}>
                      ✓ 已识别 <strong>{validIds.length}</strong> 个 ID
                      {invalid > 0 && <span style={{ color: '#f87171', marginLeft: 8 }}>· {invalid} 行无法解析</span>}
                    </div>
                  </label>
                );
              })()}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>Host</span>
                  <input
                    value={form.ksgHost}
                    onChange={e => setForm(prev => ({ ...prev, ksgHost: e.target.value }))}
                    placeholder="uib.2ksg.com"
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>
                    Bucket 种子（找不到会自动探测 0-9）
                  </span>
                  <input
                    value={form.ksgBucket}
                    onChange={e => setForm(prev => ({ ...prev, ksgBucket: e.target.value }))}
                    placeholder="5"
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}
                  />
                </label>
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  token 头（从 DevTools 复制）
                  {!form.ksgToken && <span style={{ color: '#f87171', marginLeft: 6 }}>· 必填,空则采集会失败</span>}
                </span>
                <input
                  value={form.ksgToken}
                  onChange={e => setForm(prev => ({ ...prev, ksgToken: e.target.value }))}
                  placeholder="6208330590a87f"
                  style={{
                    background: '#020617',
                    border: `1px solid ${form.ksgToken ? '#334155' : '#7f1d1d'}`,
                    borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace',
                  }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>Referer</span>
                <input
                  value={form.ksgReferer}
                  onChange={e => setForm(prev => ({ ...prev, ksgReferer: e.target.value }))}
                  placeholder="https://uib.2ksg.com/app/"
                  style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontSize: 12, color: '#cbd5e1', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.ksgCrawlList}
                  onChange={e => setForm(prev => ({ ...prev, ksgCrawlList: e.target.checked }))}
                  style={{ accentColor: '#ec4899' }}
                />
                <span>同时跟进 data.list[] 里的相关图册（最多 <input type="number" value={form.ksgMaxIds} min={1} max={200} onChange={e => setForm(prev => ({ ...prev, ksgMaxIds: Number(e.target.value) }))} style={{ width: 50, background: '#020617', border: '1px solid #334155', borderRadius: 4, padding: '2px 6px', color: '#e2e8f0', fontSize: 12 }} /> 个）</span>
              </label>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 8 }}>
                每个 ID 拉一次 detail.json → 解码 → 抽出图册全部图片。比 SPA 渲染快 10x，稳定 100x。
              </div>
            </div>
          )}

          {/* knit 配置 */}
          {form.platform === 'knit' && (
            <div style={{ marginTop: 10, padding: '10px 12px', background: '#0f172a', border: '1px solid #f59e0b', borderRadius: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#f59e0b', marginBottom: 8 }}>
                ☁️ knit / Cloudflare 模式 — 借浏览器 cookie 绕过 CF + 自动补全 1..N 张
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  文章 URL 列表（每行一个，如 https://xx.knit.bid/article/30689/）
                </span>
                <textarea
                  value={form.knitUrls}
                  onChange={e => setForm(prev => ({ ...prev, knitUrls: e.target.value }))}
                  placeholder={'https://xx.knit.bid/article/30689/\nhttps://xx.knit.bid/article/30690/'}
                  rows={4}
                  style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace', lineHeight: 1.6, resize: 'vertical' }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  Cookie（DevTools → Network → 主请求 → Request Headers → Cookie 整行）
                  {!form.knitCookie && <span style={{ color: '#f87171', marginLeft: 6 }}>· 必填</span>}
                </span>
                <textarea
                  value={form.knitCookie}
                  onChange={e => setForm(prev => ({ ...prev, knitCookie: e.target.value }))}
                  placeholder="cf_clearance=...; user_segment=anon; ..."
                  rows={3}
                  style={{
                    background: '#020617',
                    border: `1px solid ${form.knitCookie ? '#334155' : '#7f1d1d'}`,
                    borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all', resize: 'vertical',
                  }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  User-Agent（必须和 cookie 配对，CF 会校验）
                </span>
                <input
                  value={form.knitUserAgent}
                  onChange={e => setForm(prev => ({ ...prev, knitUserAgent: e.target.value }))}
                  placeholder="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ..."
                  style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace' }}
                />
              </label>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 4, lineHeight: 1.6 }}>
                cookie 里 cf_clearance 通常 30 分钟到几小时过期；过期后采集会失败，重抓一次 Cookie 刷新即可。
                自动从 HTML 第一张图推断 URL 模板，从标题里 "<strong>NN P</strong>" 推断总数，生成 1..N 全部 URL。
              </div>
            </div>
          )}

          {/* reddit 配置 */}
          {form.platform === 'reddit' && (
            <div style={{ marginTop: 10, padding: '10px 12px', background: '#0f172a', border: '1px solid #f97316', borderRadius: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#f97316', marginBottom: 8 }}>
                🦊 Reddit 公开 JSON API · 无需 OAuth
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  Subreddit 列表（每行一个，可带或不带 r/）
                </span>
                <textarea
                  value={form.redditSubs}
                  onChange={e => setForm(prev => ({ ...prev, redditSubs: e.target.value }))}
                  placeholder={'EarthPorn\nphotographs\ncosplay'}
                  rows={3}
                  style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace', lineHeight: 1.6, resize: 'vertical' }}
                />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>排序</span>
                  <select value={form.redditSort} onChange={e => setForm(prev => ({ ...prev, redditSort: e.target.value as any }))}
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}>
                    <option value="hot">hot</option>
                    <option value="new">new</option>
                    <option value="top">top</option>
                    <option value="rising">rising</option>
                  </select>
                </label>
                {(form.redditSort === 'top') && (
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 11, color: '#64748b' }}>时间范围</span>
                    <select value={form.redditTime} onChange={e => setForm(prev => ({ ...prev, redditTime: e.target.value as any }))}
                      style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}>
                      <option value="hour">hour</option>
                      <option value="day">day</option>
                      <option value="week">week</option>
                      <option value="month">month</option>
                      <option value="year">year</option>
                      <option value="all">all</option>
                    </select>
                  </label>
                )}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>每个 sub 限数 (1-100)</span>
                  <input type="number" min={1} max={100} value={form.redditLimit}
                    onChange={e => setForm(prev => ({ ...prev, redditLimit: Number(e.target.value) }))}
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }} />
                </label>
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>User-Agent（Reddit 强制要求,留空用默认。机房 IP 容易被屏蔽）</span>
                <input value={form.redditUA} onChange={e => setForm(prev => ({ ...prev, redditUA: e.target.value }))}
                  placeholder="ch-agents/0.1 (by /u/yourname)"
                  style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace' }} />
              </label>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 6, lineHeight: 1.6 }}>
                注:Reddit 2024 后大量屏蔽机房 IP,从家庭 IP 跑通常没问题。被屏蔽时会触发 authFail 红条提示。
              </div>
            </div>
          )}

          {/* bluesky 配置 */}
          {form.platform === 'bluesky' && (
            <div style={{ marginTop: 10, padding: '10px 12px', background: '#0f172a', border: '1px solid #38bdf8', borderRadius: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#38bdf8', marginBottom: 8 }}>
                🦋 Bluesky · AT Protocol 公开 API
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>采集模式</span>
                <select value={form.bskyMode} onChange={e => setForm(prev => ({ ...prev, bskyMode: e.target.value as any }))}
                  style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}>
                  <option value="author">author — 拉取指定用户的发文</option>
                  <option value="search">search — 关键词/话题搜索</option>
                </select>
              </label>
              {form.bskyMode === 'author' ? (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>Handle (e.g. pfrazee.com / natgeo.com)</span>
                  <input value={form.bskyActor} onChange={e => setForm(prev => ({ ...prev, bskyActor: e.target.value }))}
                    placeholder="pfrazee.com"
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace' }} />
                </label>
              ) : (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>搜索词或 #hashtag</span>
                  <input value={form.bskyQuery} onChange={e => setForm(prev => ({ ...prev, bskyQuery: e.target.value }))}
                    placeholder="#photography"
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }} />
                </label>
              )}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>每次拉取数量 (1-100)</span>
                <input type="number" min={1} max={100} value={form.bskyLimit}
                  onChange={e => setForm(prev => ({ ...prev, bskyLimit: Number(e.target.value) }))}
                  style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }} />
              </label>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 6, lineHeight: 1.6 }}>
                public.api.bsky.app 完全免费无需 token。author 模式稳定;search 模式可能被防爬限流。
              </div>
            </div>
          )}

          {/* sitemap-images 配置 */}
          {form.platform === 'sitemap-images' && (
            <div style={{ marginTop: 10, padding: '10px 12px', background: '#0f172a', border: '1px solid #84cc16', borderRadius: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#84cc16', marginBottom: 8 }}>
                🗺️ 站点地图 · 解析 &lt;image:image&gt; 扩展
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>Sitemap URL</span>
                <input value={form.sitemapUrl} onChange={e => setForm(prev => ({ ...prev, sitemapUrl: e.target.value }))}
                  placeholder="https://example.com/sitemap-image.xml"
                  style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace' }} />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8, marginBottom: 4 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>最大图数 (1-5000)</span>
                  <input type="number" min={1} max={5000} value={form.sitemapLimit}
                    onChange={e => setForm(prev => ({ ...prev, sitemapLimit: Number(e.target.value) }))}
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>页面 URL 正则 (可选,只跟进匹配的页面)</span>
                  <input value={form.sitemapPattern} onChange={e => setForm(prev => ({ ...prev, sitemapPattern: e.target.value }))}
                    placeholder="/blog/|/article/"
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace' }} />
                </label>
              </div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 6, lineHeight: 1.6 }}>
                自动识别 sitemap-index(含子 sitemap 列表)并递归。
                每张图独立成 1 个 raw_item。
              </div>
            </div>
          )}

          {/* X (Twitter) 配置 */}
          {form.platform === 'x' && (() => {
            // If this source is bound to the credential pool, cookie/UA live on
            // the credential — not on the source row. Without this banner the
            // empty cookie textarea + red "必填" warning makes users think the
            // batch import "didn't add cookie", when in fact it's working as
            // designed (resolveAuth reads cookie from credentials table at
            // runtime).
            const boundCred = editingSource?.credential_id
              ? credentials.find(c => c.id === editingSource.credential_id)
              : null;
            return (
            <div style={{ marginTop: 10, padding: '10px 12px', background: '#0f172a', border: '1px solid #71717a', borderRadius: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#e4e4e7', marginBottom: 8 }}>
                𝕏 X (Twitter) · Cookie 注入(GraphQL 回放)
              </div>
              {boundCred && (
                <div style={{ marginBottom: 10, padding: '8px 12px', background: '#312e81', border: '1px solid #6366f1', borderRadius: 5, fontSize: 11, color: '#c7d2fe', lineHeight: 1.6 }}>
                  <div style={{ fontWeight: 700, marginBottom: 3 }}>
                    🔑 已绑定凭证池中的 <span style={{ color: '#fff' }}>{boundCred.name}</span>
                    <span style={{ marginLeft: 6, opacity: 0.7 }}>
                      (状态:{boundCred.status} · cookie {boundCred.cookie_len} 字符
                      {boundCred.user_agent ? ` · UA ${String(boundCred.user_agent).slice(0, 40)}…` : ' · 无 UA'})
                    </span>
                  </div>
                  <div style={{ opacity: 0.85 }}>
                    cookie / User-Agent 由凭证池统一管理,不需要在这里再贴一遍。运行时 X 适配器会从 credentials 表里读。要换 cookie 请去 工作台 → 凭证池 → {boundCred.name} → 编辑。
                  </div>
                </div>
              )}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>采集模式</span>
                <select
                  value={form.xMode === 'user' && form.xLimit === 20 ? 'user-20' : form.xMode}
                  onChange={e => {
                    const v = e.target.value;
                    if (v === 'user-20') {
                      // Preset: user mode + force latest 20.
                      setForm(prev => ({ ...prev, xMode: 'user', xLimit: 20 }));
                    } else {
                      setForm(prev => ({ ...prev, xMode: v as 'user' | 'search' }));
                    }
                  }}
                  style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}>
                  <option value="user">user — 拉取指定账号最近发文</option>
                  <option value="user-20">user — 拉取最近的 20 条</option>
                  <option value="search">search — 关键词搜索 Latest</option>
                </select>
              </label>
              {form.xMode === 'user' ? (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>账号 handle (不带 @)</span>
                  <input value={form.xScreenName} onChange={e => setForm(prev => ({ ...prev, xScreenName: e.target.value }))}
                    placeholder="natgeo"
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace' }} />
                </label>
              ) : (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>搜索词或 #hashtag</span>
                  <input value={form.xQuery} onChange={e => setForm(prev => ({ ...prev, xQuery: e.target.value }))}
                    placeholder="#aurora min_faves:10"
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }} />
                </label>
              )}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  Cookie{boundCred ? '(凭证池模式留空即可)' : '(必须含 auth_token 和 ct0)'}
                  {!boundCred && <span style={{ color: '#f87171', marginLeft: 6, fontWeight: 600 }}>· 必填</span>}
                </span>
                <textarea value={form.xCookie}
                  onChange={e => setForm(prev => ({ ...prev, xCookie: e.target.value }))}
                  placeholder={boundCred ? '— 由凭证池接管,留空 —' : 'auth_token=...; ct0=...; guest_id=...'}
                  rows={3}
                  style={{
                    background: '#020617',
                    border: `1px solid ${(form.xCookie || boundCred) ? '#334155' : '#7f1d1d'}`,
                    borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all', resize: 'vertical',
                    opacity: boundCred ? 0.55 : 1,
                  }}
                />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>
                    User-Agent {boundCred ? '(凭证池接管)' : '(建议跟你浏览器一致)'}
                    {!boundCred && <span style={{ color: '#f87171', marginLeft: 6, fontWeight: 600 }}>· 必填</span>}
                  </span>
                  <input value={form.xUserAgent} onChange={e => setForm(prev => ({ ...prev, xUserAgent: e.target.value }))}
                    placeholder={boundCred ? '— 由凭证池接管,留空 —' : 'Mozilla/5.0 ... Chrome/147.0 ...'}
                    style={{
                      background: '#020617',
                      border: `1px solid ${(form.xUserAgent || boundCred) ? '#334155' : '#7f1d1d'}`,
                      borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace',
                      opacity: boundCred ? 0.55 : 1,
                    }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>拉取最近多少条 (1-100)</span>
                  <input type="number" min={1} max={100} value={form.xLimit}
                    onChange={e => setForm(prev => ({ ...prev, xLimit: Number(e.target.value) }))}
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }} />
                </label>
              </div>
              {/* Quick presets: 10 / 20 / 40 / 80 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 11, color: '#64748b' }}>
                <span>快选:</span>
                {[10, 20, 40, 80].map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setForm(prev => ({ ...prev, xLimit: n }))}
                    style={{
                      padding: '2px 10px', borderRadius: 4,
                      border: `1px solid ${form.xLimit === n ? '#71717a' : '#334155'}`,
                      background: form.xLimit === n ? '#27272a' : 'transparent',
                      color: form.xLimit === n ? '#e4e4e7' : '#94a3b8',
                      fontSize: 11, cursor: 'pointer', fontWeight: form.xLimit === n ? 600 : 400,
                    }}>
                    {n}
                  </button>
                ))}
                <span style={{ marginLeft: 'auto', fontSize: 10, color: '#475569' }}>
                  (X 单次最多 ~40 条;含图比例约 5-30%,实际入库会少于 N)
                </span>
              </div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 6, lineHeight: 1.6 }}>
                Cookie 用 <code>document.cookie</code> 在 <code>x.com</code> 控制台复制。auth_token 通常 30+ 天有效;X 改 GraphQL 时需要更新 opIds。
              </div>
            </div>
            );
          })()}

          {/* HTML 模式三选一 */}
          {form.platform === 'html' && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>采集模式</span>
              <select
                value={form.htmlMode}
                onChange={e => setForm(prev => ({ ...prev, htmlMode: e.target.value as any }))}
                style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}>
                <option value="article">article — 每个 URL = 1 篇文章</option>
                <option value="per-image">per-image — 每张图独立成一个 item</option>
                <option value="crawl">crawl — 入口递归爬取（同域名）</option>
              </select>
            </label>
          )}

          {/* article / per-image：URL 列表 */}
          {form.platform === 'html' && form.htmlMode !== 'crawl' && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>
                文章 URL 列表（每行一个，共 {form.htmlUrls.split('\n').filter(s => s.trim()).length} 条）
              </span>
              <textarea
                value={form.htmlUrls}
                onChange={e => setForm(prev => ({ ...prev, htmlUrls: e.target.value }))}
                placeholder={'https://example.com/article/1\nhttps://example.com/article/2'}
                rows={5}
                style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'SF Mono, Menlo, monospace', lineHeight: 1.6, resize: 'vertical' }}
              />
            </label>
          )}

          {/* crawl 模式：入口 + 深度 + 页数 + 正则 */}
          {form.platform === 'html' && form.htmlMode === 'crawl' && (
            <div style={{ marginTop: 10, padding: '10px 12px', background: '#0f172a', border: '1px solid #f97316', borderRadius: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#f97316', marginBottom: 8 }}>
                🕷 爬虫模式 — 从入口页 BFS 同域链接，按 per-image 抽图
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>入口 URL</span>
                <input
                  value={form.crawlEntry}
                  onChange={e => setForm(prev => ({ ...prev, crawlEntry: e.target.value }))}
                  placeholder="https://www.smithsonianmag.com/history/"
                  style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}
                />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>最大深度（0-5）</span>
                  <input
                    type="number" min={0} max={5}
                    value={form.crawlMaxDepth}
                    onChange={e => setForm(prev => ({ ...prev, crawlMaxDepth: Number(e.target.value) }))}
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>最多页数（1-80）</span>
                  <input
                    type="number" min={1} max={80}
                    value={form.crawlMaxPages}
                    onChange={e => setForm(prev => ({ ...prev, crawlMaxPages: Number(e.target.value) }))}
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}
                  />
                </label>
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>URL 正则（可选，只跟进匹配的链接）</span>
                <input
                  value={form.crawlPattern}
                  onChange={e => setForm(prev => ({ ...prev, crawlPattern: e.target.value }))}
                  placeholder="/history/[^/]+-\\d+/$"
                  style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace' }}
                />
              </label>
              <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 8 }}>
                注意：仅同域名爬取。开 JS 渲染后每页 5-8s，30 页 ≈ 3-4 分钟。
              </div>
            </div>
          )}

          {/* JS 渲染（headless 浏览器）开关 */}
          {form.platform === 'html' && (
            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 8,
              padding: '10px 12px', background: '#0f172a',
              border: `1px solid ${form.useBrowser ? '#14b8a6' : '#334155'}`,
              borderRadius: 6, cursor: 'pointer',
            }}>
              <input
                type="checkbox"
                checked={form.useBrowser}
                onChange={e => setForm(prev => ({ ...prev, useBrowser: e.target.checked }))}
                style={{ marginTop: 2, accentColor: '#14b8a6' }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: form.useBrowser ? '#14b8a6' : '#cbd5e1' }}>
                  JS 渲染（浏览器模式）
                </div>
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 3, lineHeight: 1.6 }}>
                  用 headless Chromium 跑 JS 再抓 HTML，适合 SPA / 动态图片站（Vue/React 前端）。
                  <span style={{ color: '#f59e0b' }}>每页慢 3-8 秒。已开启 stealth 反检测(navigator.webdriver / plugins / WebGL 等 17 项 patch)。</span>
                </div>
              </div>
            </label>
          )}

          {/* JS 渲染高级选项 (仅在 useBrowser=true 时显示) */}
          {form.platform === 'html' && form.useBrowser && (
            <details style={{ marginTop: 8, padding: '8px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 6 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#14b8a6' }}>
                浏览器模式高级选项(可选)
              </summary>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>等待选择器(CSS,渲染完成的标志)</span>
                  <input value={form.htmlWaitFor}
                    onChange={e => setForm(prev => ({ ...prev, htmlWaitFor: e.target.value }))}
                    placeholder="img[src], .article-content, [data-loaded]"
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace' }} />
                  <span style={{ fontSize: 10, color: '#475569' }}>留空则等 networkidle。SPA 推荐填写。</span>
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 11, color: '#64748b' }}>Locale</span>
                    <input value={form.htmlLocale}
                      onChange={e => setForm(prev => ({ ...prev, htmlLocale: e.target.value }))}
                      placeholder="en-US 或 zh-CN"
                      style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 11, color: '#64748b' }}>Timezone</span>
                    <input value={form.htmlTimezone}
                      onChange={e => setForm(prev => ({ ...prev, htmlTimezone: e.target.value }))}
                      placeholder="America/New_York 或 Asia/Shanghai"
                      style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }} />
                  </label>
                </div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>Cookies (JSON 数组,登录态注入)</span>
                  <textarea value={form.htmlCookies}
                    onChange={e => setForm(prev => ({ ...prev, htmlCookies: e.target.value }))}
                    placeholder={'[{"name":"session","value":"xxx","domain":".example.com","path":"/"}]'}
                    rows={3}
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace', resize: 'vertical' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>额外 HTTP 头 (JSON 对象)</span>
                  <textarea value={form.htmlExtraHeaders}
                    onChange={e => setForm(prev => ({ ...prev, htmlExtraHeaders: e.target.value }))}
                    placeholder={'{"Authorization": "Bearer ...", "X-Custom": "value"}'}
                    rows={3}
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace', resize: 'vertical' }} />
                </label>
              </div>
            </details>
          )}

          {/* 抓取全部图片（不过滤） */}
          {form.platform === 'html' && form.htmlMode !== 'article' && (
            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 8,
              padding: '10px 12px', background: '#0f172a',
              border: `1px solid ${form.extractAll ? '#a855f7' : '#334155'}`,
              borderRadius: 6, cursor: 'pointer',
            }}>
              <input
                type="checkbox"
                checked={form.extractAll}
                onChange={e => setForm(prev => ({ ...prev, extractAll: e.target.checked }))}
                style={{ marginTop: 2, accentColor: '#a855f7' }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: form.extractAll ? '#a855f7' : '#cbd5e1' }}>
                  抓取全部图片（不过滤）
                </div>
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 3, lineHeight: 1.6 }}>
                  绕过尺寸/黑名单/最小描述的过滤，每页最多 500 张；额外解析 srcset 与 &lt;picture&gt;。
                  <span style={{ color: '#f59e0b' }}>会抓到 logo/icon/小图等噪音。</span>
                </div>
              </div>
            </label>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              onClick={() => {
                // Stealth-mode advanced options (only valid when useBrowser=true)
                const stealthOpts = form.useBrowser ? buildStealthOpts(form) : {};
                const config: Record<string, unknown> = form.platform === 'html'
                  ? (form.htmlMode === 'crawl'
                      ? {
                          mode: 'crawl',
                          entry: form.crawlEntry,
                          maxDepth: form.crawlMaxDepth,
                          maxPages: form.crawlMaxPages,
                          ...(form.crawlPattern ? { urlPattern: form.crawlPattern } : {}),
                          ...(form.useBrowser ? { render: 'browser' } : {}),
                          ...(form.extractAll ? { extractAll: true } : {}),
                          ...stealthOpts,
                        }
                      : {
                          urls: form.htmlUrls.split('\n').map(s => s.trim()).filter(Boolean),
                          mode: form.htmlMode,
                          ...(form.useBrowser ? { render: 'browser' } : {}),
                          ...(form.extractAll ? { extractAll: true } : {}),
                          ...stealthOpts,
                        })
                  : form.platform === '2ksg'
                  ? {
                      ids: form.ksgIds.split('\n').map(parseKsgLine).map(p => p.id).filter((x): x is string => !!x),
                      bucket: form.ksgBucket || '5',
                      host: form.ksgHost || 'uib.2ksg.com',
                      token: form.ksgToken,
                      referer: form.ksgReferer || 'https://uib.2ksg.com/app/',
                      ...(form.ksgCrawlList ? { crawlList: true, maxIds: form.ksgMaxIds } : {}),
                    }
                  : form.platform === 'knit'
                  ? {
                      urls: form.knitUrls.split('\n').map(s => s.trim()).filter(Boolean),
                      cookie: form.knitCookie,
                      userAgent: form.knitUserAgent || undefined,
                    }
                  : form.platform === 'reddit'
                  ? {
                      subreddits: form.redditSubs.split('\n').map(s => s.trim().replace(/^\/?r\//i, '')).filter(Boolean),
                      sort: form.redditSort,
                      time: form.redditTime,
                      limit: form.redditLimit,
                      ...(form.redditUA ? { userAgent: form.redditUA } : {}),
                    }
                  : form.platform === 'bluesky'
                  ? {
                      mode: form.bskyMode,
                      ...(form.bskyMode === 'author' ? { actor: form.bskyActor.trim().replace(/^@/, '') } : {}),
                      ...(form.bskyMode === 'search' ? { query: form.bskyQuery } : {}),
                      limit: form.bskyLimit,
                    }
                  : form.platform === 'sitemap-images'
                  ? {
                      sitemapUrl: form.sitemapUrl,
                      limit: form.sitemapLimit,
                      ...(form.sitemapPattern ? { pagePattern: form.sitemapPattern } : {}),
                    }
                  : form.platform === 'x'
                  ? {
                      mode: form.xMode,
                      ...(form.xMode === 'user'   ? { screenName: form.xScreenName.trim().replace(/^@/, '') } : {}),
                      ...(form.xMode === 'search' ? { query: form.xQuery } : {}),
                      cookie: form.xCookie,
                      ...(form.xUserAgent ? { userAgent: form.xUserAgent } : {}),
                      limit: form.xLimit,
                    }
                  : { feed_url: form.url, limit: 20 };
                onSave(editingSource
                  ? { ...editingSource, ...form, config }
                  : { ...form, config });
              }}
              style={{ padding: '6px 18px', borderRadius: 6, border: 'none', background: '#6366f1', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              {editingSource ? '保存' : '添加'}
            </button>
            <button
              onClick={() => { setEditingSource(null); setShowAddSource(false); }}
              style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #334155', background: 'transparent', color: '#64748b', fontSize: 12, cursor: 'pointer' }}>
              取消
            </button>
          </div>
          </div>
        </div>
      )}

      {/* Sources list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {sources.map(src => (
          <div key={src.id} style={{
            background: '#1e293b',
            border: `1px solid ${src.status === 'active' ? '#334155' : '#1e293b'}`,
            borderLeft: `3px solid ${src.status === 'active' ? '#22c55e' : '#374151'}`,
            borderRadius: 8, padding: '12px 16px',
            opacity: src.status === 'active' ? 1 : 0.55,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {src.name}
                  {src.credential_id && (
                    <span title={`使用凭证池中的 ${src.credential_name}（${src.credential_status ?? '未知状态'}）。cookie 不在源里,运行时从 credentials 表读取。`}
                      style={{
                        fontSize: 10, fontWeight: 600,
                        padding: '1px 7px', borderRadius: 10,
                        background: src.credential_status === 'active' ? '#312e81' : '#7f1d1d',
                        color: src.credential_status === 'active' ? '#c7d2fe' : '#fca5a5',
                      }}>
                      🔑 {src.credential_name ?? src.credential_id.slice(0, 6)}
                    </span>
                  )}
                  {!src.credential_id && (src.config?.cookie as string) && (
                    <span title="该源在 config 里内联存了 cookie(legacy 模式)" style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, background: '#374151', color: '#9ca3af' }}>
                      🍪 inline
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                  {src.platform} · {src.external_id}
                  {src.last_fetch_at && ` · 最近采集: ${src.last_fetch_at.slice(0, 16)}`}
                </div>
                <div style={{ fontSize: 11, color: '#475569', marginTop: 1, wordBreak: 'break-all' }}>
                  {(src.config?.feed_url as string) ?? src.url}
                </div>
              </div>
              {src.score !== null && (
                <div style={{ textAlign: 'center', flexShrink: 0 }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#f59e0b' }}>{Number(src.score).toFixed(1)}</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>评分</div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button onClick={() => onToggleStatus(src)} style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid #334155', background: src.status === 'active' ? '#14532d' : '#1e293b', color: src.status === 'active' ? '#86efac' : '#475569', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                  {src.status === 'active' ? '活跃' : '停用'}
                </button>
                <button onClick={() => onIngest(src)} disabled={src.status !== 'active'} style={{ padding: '4px 10px', borderRadius: 5, border: 'none', background: src.status === 'active' ? '#0ea5e9' : '#1e293b', color: src.status === 'active' ? '#fff' : '#334155', fontSize: 11, cursor: src.status === 'active' ? 'pointer' : 'not-allowed', fontWeight: 600 }}>
                  采集
                </button>
                <button onClick={() => startEdit(src)} style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontSize: 11, cursor: 'pointer' }}>编辑</button>
                <button onClick={() => onDelete(src)} style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid #334155', background: 'transparent', color: '#f87171', fontSize: 11, cursor: 'pointer' }}>删除</button>
              </div>
            </div>
          </div>
        ))}
        {sources.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: '#334155' }}>暂无采集源，点击「+ 添加来源」</div>
        )}
      </div>
    </div>
  );
}

// ─── QueueRunsPanel ───────────────────────────────────────────────────────────

function QueueRunsPanel({ queues, agentSummary }: { queues: QueueStat[]; agentSummary: AgentRunRow[] }) {
  const totalCost = agentSummary.reduce((s, r) => s + Number(r.total_cost_usd), 0);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 20 }}>
      <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: '14px 16px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: '#94a3b8' }}>队列快照</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: '#475569' }}>
              {['', '等待', '运行', '完成', '失败'].map(h => <th key={h} style={{ padding: '4px 8px', textAlign: h === '' ? 'left' : 'right', fontWeight: 400 }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {queues.map(q => {
              const active = q.counts.active > 0;
              const fail = q.counts.failed > 0;
              return (
                <tr key={q.name} style={{ borderTop: '1px solid #0f172a' }}>
                  <td style={{ padding: '5px 8px', color: active ? '#f1f5f9' : '#475569', fontWeight: active ? 600 : 400 }}>{q.name}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: q.counts.waiting > 20 ? '#fbbf24' : q.counts.waiting > 0 ? '#60a5fa' : '#334155' }}>{q.counts.waiting || '—'}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: active ? '#34d399' : '#334155' }}>{q.counts.active || '—'}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: '#334155' }}>{q.counts.completed || '—'}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: fail ? '#f87171' : '#334155' }}>{q.counts.failed || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: '14px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8' }}>近期运行（24h）</span>
          <span style={{ fontSize: 12, color: '#a78bfa' }}>总成本 ${totalCost.toFixed(4)}</span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: '#475569' }}>
              {['Agent', '成功', '失败', '耗时', '成本'].map(h => <th key={h} style={{ padding: '4px 8px', textAlign: h === 'Agent' ? 'left' : 'right', fontWeight: 400 }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {agentSummary.map(r => (
              <tr key={r.agent} style={{ borderTop: '1px solid #0f172a' }}>
                <td style={{ padding: '5px 8px', color: '#94a3b8' }}>{r.agent}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: '#34d399' }}>{r.success}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: r.failed > 0 ? '#f87171' : '#334155' }}>{r.failed || '—'}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: '#475569' }}>{r.avg_latency_ms ? `${r.avg_latency_ms}ms` : '—'}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: '#a78bfa' }}>${Number(r.total_cost_usd).toFixed(4)}</td>
              </tr>
            ))}
            {agentSummary.length === 0 && <tr><td colSpan={5} style={{ padding: '12px 8px', textAlign: 'center', color: '#334155' }}>暂无数据</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── CrawlPreviewPanel ───────────────────────────────────────────────────────

function CrawlPreviewPanel({
  sources, items, total, loading, sourceId, withMedia, page, pageSize,
  onSourceChange, onWithMediaChange, onPageChange, onRefresh,
}: {
  sources: Source[];
  items: RawItem[];
  total: number;
  loading: boolean;
  sourceId: string;
  withMedia: boolean;
  page: number;
  pageSize: number;
  onSourceChange: (id: string) => void;
  onWithMediaChange: (v: boolean) => void;
  onPageChange: (p: number) => void;
  onRefresh: () => void;
}) {
  const [preview, setPreview] = useState<{ url: string; sourceId: string; title: string; videoUrl?: string } | null>(null);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const totalImages = items.reduce((n, it) => n + (it.media_urls?.length ?? 0), 0);

  // Both 2ksg (Referer check) and knit (cf_clearance) block direct browser
  // image loads. Route them through the API proxy with the right headers.
  const proxied = (remoteUrl: string, sourceId: string) =>
    `${API}/admin/proxy-image?source_id=${encodeURIComponent(sourceId)}&url=${encodeURIComponent(remoteUrl)}`;

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <select
          value={sourceId}
          onChange={(e) => onSourceChange(e.target.value)}
          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', fontSize: 13, minWidth: 240 }}
        >
          <option value="">全部采集源</option>
          {sources.map(s => (
            <option key={s.id} value={s.id}>{s.name} · {s.platform}</option>
          ))}
        </select>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={withMedia}
            onChange={(e) => onWithMediaChange(e.target.checked)}
            style={{ accentColor: '#6366f1' }}
          />
          仅显示有图片的条目
        </label>

        <button
          onClick={onRefresh}
          style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}
        >
          ↻ 刷新
        </button>

        <div style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>
          共 <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{total}</span> 条
          · 本页 <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{totalImages}</span> 张图
        </div>
      </div>

      {loading && items.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: '#475569' }}>加载中…</div>
      )}

      {!loading && items.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: '#475569', background: '#0f172a', borderRadius: 10, border: '1px dashed #334155' }}>
          暂无数据
        </div>
      )}

      {/* Items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {items.map(it => (
          <div key={it.id} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: 14 }}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 240, fontSize: 13, fontWeight: 600, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={it.title || it.url || ''}>
                {it.title || it.url || '(无标题)'}
              </div>
              <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 6, background: '#0ea5e933', color: '#7dd3fc' }}>{it.platform}</span>
              <span style={{ fontSize: 11, color: '#64748b' }}>{it.source_name}</span>
              <span style={{ fontSize: 11, color: '#475569' }}>{fmtTime(it.fetched_at)}</span>
              {it.url && (
                <a href={it.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#60a5fa', textDecoration: 'none' }}>↗ 原文</a>
              )}
            </div>

            {it.media_urls && it.media_urls.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                {it.media_urls.map((u, i) => {
                  // Legacy data: some early X items wrote .mp4 / .webm into
                  // media_urls itself. <img> can't render videos — show a poster card.
                  const urlIsVideo = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u);
                  // Modern X path: media_urls[i] is a poster jpg + parallel
                  // video_urls[i] is the playable mp4. Surface as a click-to-play.
                  const sidecarVideo = it.video_urls?.[i] || it.video_urls?.[0];
                  const hasPlayable = !!sidecarVideo;

                  if (urlIsVideo) {
                    return (
                      <a key={i} href={u} target="_blank" rel="noreferrer"
                        title={`视频:${u}`}
                        style={{
                          position: 'relative', aspectRatio: '4/3', borderRadius: 6, overflow: 'hidden',
                          background: '#1e293b', border: '1px solid #334155', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexDirection: 'column', gap: 6, color: '#94a3b8', fontSize: 11, textDecoration: 'none',
                        }}>
                        <span style={{ fontSize: 32 }}>🎥</span>
                        <span>视频(点击打开)</span>
                      </a>
                    );
                  }
                  return (
                    <div key={i}
                      onClick={() => setPreview({ url: u, sourceId: it.source_id, title: it.title || it.url || '', videoUrl: sidecarVideo })}
                      style={{
                        position: 'relative', aspectRatio: '4/3', borderRadius: 6, overflow: 'hidden',
                        background: '#0f172a', border: '1px solid #334155', cursor: 'pointer',
                      }}
                      title={hasPlayable ? `视频海报 — 点击播放\n${u}` : u}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={proxied(u, it.source_id)} alt="" loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        onError={(e) => {
                          const el = e.currentTarget;
                          el.style.display = 'none';
                          const parent = el.parentElement;
                          if (parent && !parent.querySelector('.fallback')) {
                            const fb = document.createElement('div');
                            fb.className = 'fallback';
                            fb.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;color:#475569;text-align:center;padding:8px;';
                            fb.textContent = '加载失败';
                            parent.appendChild(fb);
                          }
                        }}
                      />
                      {hasPlayable && (
                        <div style={{
                          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          pointerEvents: 'none',
                        }}>
                          <div style={{
                            background: 'rgba(0,0,0,0.55)', borderRadius: '50%',
                            width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 18, color: '#fff',
                          }}>▶</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: 11, color: '#475569', fontStyle: 'italic' }}>(无图片)</div>
            )}
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4, marginTop: 20, flexWrap: 'wrap' }}>
          <PageBtn label="« 首页" disabled={page === 0} onClick={() => onPageChange(0)} />
          <PageBtn label="‹ 上一页" disabled={page === 0} onClick={() => onPageChange(Math.max(0, page - 1))} />

          {pageNumbers(page, totalPages).map((p, idx) =>
            p === '…' ? (
              <span key={`gap-${idx}`} style={{ padding: '5px 6px', fontSize: 12, color: '#475569' }}>…</span>
            ) : (
              <PageBtn
                key={p}
                label={String(p + 1)}
                active={p === page}
                onClick={() => onPageChange(p)}
              />
            ),
          )}

          <PageBtn label="下一页 ›" disabled={page >= totalPages - 1} onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))} />
          <PageBtn label="末页 »" disabled={page >= totalPages - 1} onClick={() => onPageChange(totalPages - 1)} />

          <span style={{ marginLeft: 12, fontSize: 12, color: '#64748b' }}>第 {page + 1} / {totalPages} 页</span>
        </div>
      )}

      {/* Lightbox */}
      {preview && (
        <div onClick={() => setPreview(null)}
          style={{ position: 'fixed', inset: 0, background: '#000c', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, cursor: 'zoom-out' }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '92vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column', gap: 8, cursor: 'default' }}>
            {preview.videoUrl ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video controls autoPlay
                src={proxied(preview.videoUrl, preview.sourceId)}
                poster={proxied(preview.url, preview.sourceId)}
                style={{ maxWidth: '92vw', maxHeight: '80vh', borderRadius: 8, background: '#000' }} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={proxied(preview.url, preview.sourceId)} alt={preview.title}
                style={{ maxWidth: '92vw', maxHeight: '80vh', borderRadius: 8, background: '#000', objectFit: 'contain' }} />
            )}
            <div style={{ fontSize: 11, color: '#cbd5e1', wordBreak: 'break-all', background: '#1e293b', padding: '6px 10px', borderRadius: 6, lineHeight: 1.7 }}>
              {preview.videoUrl
                ? <>视频:<a href={preview.videoUrl} target="_blank" rel="noreferrer" style={{ color: '#93c5fd' }}>{preview.videoUrl}</a></>
                : <>原始 URL:<a href={preview.url} target="_blank" rel="noreferrer" style={{ color: '#93c5fd' }}>{preview.url}</a></>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PageBtn({
  label, active, disabled, onClick,
}: { label: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '5px 10px',
        minWidth: 32,
        borderRadius: 6,
        border: '1px solid ' + (active ? '#6366f1' : '#334155'),
        background: active ? '#6366f1' : 'transparent',
        color: disabled ? '#334155' : active ? '#fff' : '#94a3b8',
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >{label}</button>
  );
}

// Build a 0-based page list with ellipses, e.g. [0, '…', 4, 5, 6, '…', 19].
// Always shows: first, last, current ±1.
function pageNumbers(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  const set = new Set<number>([0, total - 1, current, current - 1, current + 1]);
  const sorted = [...set].filter((p) => p >= 0 && p < total).sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push('…');
    out.push(sorted[i]);
  }
  return out;
}

// ─── OpLogsPanel ─────────────────────────────────────────────────────────────
// Audit trail of every human-initiated admin write. Filters by operator /
// operation type / target. Click a row to inspect the full payload.

interface OpLogRow {
  id: string;
  operator: string;
  operator_id: string | null;
  occurred_at: string;
  operation: string;
  target_type: string;
  target_id: string | null;
  payload: Record<string, unknown>;
  request_id: string | null;
  http_method: string | null;
  http_path: string | null;
  status_code: number | null;
  ip: string | null;
  user_agent: string | null;
}

// Friendly Chinese label for the most common operation strings. Anything not
// in the map falls back to the raw string — covers extension by the catch-all
// hook without requiring code changes here.
const OP_LABEL: Record<string, string> = {
  'source.create':              '新增信源',
  'source.upsert':              '新增信源（重复键覆盖）',
  'source.update':              '编辑信源',
  'source.delete':              '删除信源',
  'source.batch-import':        '批量导入信源',
  'compliance.approve':         '合规放行',
  'compliance.reject':          '合规拒绝',
  'distribution.edit-copy':     '编辑推文文案',
  'distribution.queue':         '加入分发队列',
  'distribution.batch-queue':   '批量分发',
  'distribution.confirm':       '确认分发完成',
  'publish.approve':            '放行发布',
  'publish.force':              '强制发布',
  'publish.batch':              '批量发布',
  'item.unpublish':             '紧急下线',
  'item.rollback':              '状态回滚',
  'item.rerun':                 '重跑某 Agent',
  'system.emergency-stop':      '全局急停',
  'system.resume':              '恢复运行',
  'pipeline.set-auto':          '切换自动模式',
  'pipeline.set-paused':        '暂停/恢复 Agent',
  'source-scoring.run':         '触发信源打分',
  'analytics.pull':             '触发数据回流',
};

const TARGET_LABEL: Record<string, string> = {
  source:             '信源',
  item:               '文章',
  distribution_task:  '分发任务',
  credential:         '凭证',
  agent:              'Agent',
  system:             '系统',
};

const TARGET_OPTIONS = ['', 'source', 'item', 'distribution_task', 'credential', 'agent', 'system'];

function fmtTs(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  // Local-time YYYY-MM-DD HH:mm:ss for at-a-glance reading.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function payloadPreview(p: Record<string, unknown>): string {
  if (!p || typeof p !== 'object') return '—';
  const keys = Object.keys(p);
  if (keys.length === 0) return '—';
  // Skip purely-internal markers like {auto:true} from the catch-all hook.
  const meaningful = keys.filter(k => k !== 'auto');
  if (meaningful.length === 0) return p.auto ? '(自动捕获)' : '—';
  // Show first 2 fields with values truncated. Full JSON is on row click.
  return meaningful.slice(0, 2).map(k => {
    const v = p[k];
    let s: string;
    if (v === null) s = 'null';
    else if (typeof v === 'string') s = v.length > 40 ? v.slice(0, 38) + '…' : v;
    else if (Array.isArray(v)) s = `[${v.length}]`;
    else if (typeof v === 'object') s = '{…}';
    else s = String(v);
    return `${k}=${s}`;
  }).join(' · ');
}

// ─── CredentialsPanel ───────────────────────────────────────────────────────
// Manage the shared credential pool. Each row shows status / source count /
// last auth check / refresh-secret state. Clicking a row opens an edit drawer
// where the cookie / UA / status can be updated and the auto-refresh password
// (X only) attached or rotated.

function CredentialsPanel({
  credentials, refreshingCredId, reload, onRefreshOne, flash,
}: {
  credentials: CredentialRow[];
  refreshingCredId: string | null;
  reload: () => Promise<void>;
  onRefreshOne: (id: string) => Promise<void>;
  flash: (msg: string, ok?: boolean) => void;
}) {
  const [editing, setEditing] = useState<CredentialRow | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Edit-drawer state
  const [name, setName] = useState('');
  const [cookie, setCookie] = useState('');
  const [ua, setUa] = useState('');
  const [status, setStatus] = useState<'active'|'expired'|'revoked'>('active');
  const [secretUser, setSecretUser] = useState('');
  const [secretPass, setSecretPass] = useState('');
  const [busy, setBusy] = useState(false);

  // Inline-create state
  const [cName, setCName] = useState('');
  const [cPlatform, setCPlatform] = useState<'x'|'knit'|'2ksg'|'bluesky'>('x');
  const [cCookie, setCCookie] = useState('');
  const [cUa, setCUa] = useState('');
  const [cSecretUser, setCSecretUser] = useState('');
  const [cSecretPass, setCSecretPass] = useState('');

  const startEdit = (c: CredentialRow) => {
    setEditing(c);
    setName(c.name);
    setCookie('');           // never pre-fill cookie — too long, and we don't return it from /admin/credentials
    setUa(c.user_agent ?? '');
    setStatus((['active','expired','revoked'].includes(c.status) ? c.status : 'active') as any);
    setSecretUser(c.secret_username ?? '');
    setSecretPass('');
  };
  const closeEdit = () => { setEditing(null); setBusy(false); };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {};
      if (name.trim() && name.trim() !== editing.name) body.name = name.trim();
      if (cookie.trim()) body.cookie = cookie.trim();
      if (ua.trim() !== (editing.user_agent ?? '')) body.user_agent = ua.trim() || null;
      if (status !== editing.status) body.status = status;

      if (Object.keys(body).length === 0 && !secretUser.trim() && !secretPass.trim()) {
        flash('没有变更', false);
        return;
      }

      if (Object.keys(body).length > 0) {
        const r = await fetch(`${API}/admin/credentials/${editing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!r.ok) { const t = await r.text(); flash(`保存失败：${t.slice(0,160)}`, false); return; }
      }

      // Optionally update auto-refresh secret. We require BOTH user+pass to
      // touch it — if either is blank the user is just editing other fields.
      if (secretUser.trim() && secretPass.trim()) {
        const sr = await fetch(`${API}/admin/credentials/${editing.id}/secret`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: secretUser.trim(), password: secretPass }),
        });
        if (!sr.ok) {
          const t = await sr.text();
          flash(`其他字段已保存,但 secret 失败：${t.slice(0,140)}`, false);
        }
      }

      flash(`已保存凭证 ${editing.name}`);
      setSecretPass('');  // clear from memory
      closeEdit();
      await reload();
    } catch (e) {
      flash(`保存失败：${e}`, false);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    if (!confirm(`确认删除凭证 "${editing.name}"？挂在它上面的 ${editing.source_count} 个源会回到无凭证状态(运行时会报缺 cookie)。`)) return;
    setBusy(true);
    try {
      const r = await fetch(`${API}/admin/credentials/${editing.id}`, { method: 'DELETE' });
      if (!r.ok) { const t = await r.text(); flash(`删除失败：${t.slice(0,160)}`, false); return; }
      flash(`已删除 ${editing.name}`);
      closeEdit();
      await reload();
    } finally { setBusy(false); }
  };

  const removeSecret = async () => {
    if (!editing) return;
    if (!confirm('确认移除自动刷新账密？此后 cookie 过期需要手动粘贴。')) return;
    setBusy(true);
    try {
      const r = await fetch(`${API}/admin/credentials/${editing.id}/secret`, { method: 'DELETE' });
      if (!r.ok) { const t = await r.text(); flash(`移除失败：${t.slice(0,160)}`, false); return; }
      flash('已移除 secret');
      closeEdit();
      await reload();
    } finally { setBusy(false); }
  };

  const create = async () => {
    if (!cName.trim() || !cCookie.trim()) { flash('名字 + cookie 必填', false); return; }
    setBusy(true);
    try {
      const r = await fetch(`${API}/admin/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: cPlatform,
          name: cName.trim(),
          cookie: cCookie.trim(),
          user_agent: cUa.trim() || null,
        }),
      });
      if (!r.ok) { const t = await r.text(); flash(`创建失败：${t.slice(0,160)}`, false); return; }
      const d = await r.json();
      if (cSecretUser.trim() && cSecretPass.trim()) {
        await fetch(`${API}/admin/credentials/${d.credential.id}/secret`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: cSecretUser.trim(), password: cSecretPass }),
        });
      }
      flash(`已新建凭证 ${cName}`);
      setCName(''); setCCookie(''); setCUa(''); setCSecretUser(''); setCSecretPass('');
      setShowCreate(false);
      await reload();
    } finally { setBusy(false); }
  };

  const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString('zh-CN') : '—';

  const statusBadge = (s: string) => {
    const colors: Record<string, [string, string]> = {
      active:  ['#14532d', '#86efac'],
      expired: ['#78350f', '#fbbf24'],
      revoked: ['#7f1d1d', '#fca5a5'],
    };
    const [bg, fg] = colors[s] ?? ['#1e293b', '#94a3b8'];
    const label = s === 'active' ? '活跃' : s === 'expired' ? '已过期' : s === 'revoked' ? '已吊销' : s;
    return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: bg, color: fg, fontWeight: 600 }}>{label}</span>;
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: '#94a3b8' }}>
          共 <strong style={{ color: '#e2e8f0' }}>{credentials.length}</strong> 个凭证 ·&nbsp;
          <span style={{ color: '#22c55e' }}>活跃 {credentials.filter(c => c.status === 'active').length}</span>&nbsp;/
          <span style={{ color: '#fbbf24' }}> 过期 {credentials.filter(c => c.status === 'expired').length}</span>&nbsp;/
          <span style={{ color: '#f87171' }}> 吊销 {credentials.filter(c => c.status === 'revoked').length}</span>
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={reload}
            title="重新拉取一次列表(只刷新页面数据,不影响任何凭证的 cookie)"
            style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>
            ↻ 重新加载列表
          </button>
          <button onClick={() => setShowCreate(true)}
            style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#6366f1', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            + 新建凭证
          </button>
        </div>
      </div>

      {/* Rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {credentials.map(c => {
          const failed = (c.secret_consecutive_failures ?? 0) > 0;
          return (
            <div key={c.id} style={{
              background: '#1e293b',
              border: `1px solid ${c.status === 'active' ? '#334155' : '#1e293b'}`,
              borderLeft: `3px solid ${c.status === 'active' ? '#22c55e' : c.status === 'expired' ? '#d97706' : '#dc2626'}`,
              borderRadius: 8, padding: '12px 16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9' }}>{c.name}</span>
                    <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 8, background: '#0ea5e933', color: '#7dd3fc' }}>{c.platform}</span>
                    {statusBadge(c.status)}
                    {c.has_secret && (
                      <span title={`auto-refresh 账号: ${c.secret_username}`} style={{ fontSize: 10, padding: '1px 7px', borderRadius: 8, background: '#312e81', color: '#c7d2fe' }}>
                        🔁 自动刷新
                      </span>
                    )}
                    {failed && (
                      <span title={c.secret_last_refresh_error ?? undefined} style={{ fontSize: 10, padding: '1px 7px', borderRadius: 8, background: '#7f1d1d', color: '#fca5a5' }}>
                        连续失败 {c.secret_consecutive_failures} 次
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    <span>cookie {c.cookie_len > 0 ? `${c.cookie_len} 字符` : '空'}</span>
                    <span>{c.source_count} 个源在用</span>
                    <span>上次使用: {fmt(c.last_used_at)}</span>
                    <span>上次校验: {fmt(c.last_auth_check_at)}{c.last_auth_ok === false ? ' ❌' : c.last_auth_ok === true ? ' ✓' : ''}</span>
                    {c.has_secret && <span>上次刷新: {fmt(c.secret_last_refresh_at)}{c.secret_last_refresh_ok === false ? ' ❌' : c.secret_last_refresh_ok ? ' ✓' : ''}</span>}
                  </div>
                  {failed && c.secret_last_refresh_error && (
                    <div style={{ fontSize: 11, color: '#fca5a5', marginTop: 4, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-word' }}>
                      ⚠ {c.secret_last_refresh_error.slice(0, 220)}{c.secret_last_refresh_error.length > 220 ? '…' : ''}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {c.has_secret && (
                    <button onClick={() => onRefreshOne(c.id)} disabled={refreshingCredId === c.id}
                      title="用账号密码 stealth 登录刷一次 cookie"
                      style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid #334155', background: refreshingCredId === c.id ? '#1e293b' : 'transparent', color: refreshingCredId === c.id ? '#475569' : '#a5b4fc', fontSize: 11, cursor: refreshingCredId === c.id ? 'not-allowed' : 'pointer' }}>
                      {refreshingCredId === c.id ? '刷新中…' : '🔁 立即刷新'}
                    </button>
                  )}
                  <button onClick={() => startEdit(c)}
                    style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontSize: 11, cursor: 'pointer' }}>
                    编辑
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        {credentials.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: '#334155', background: '#0f172a', borderRadius: 10, border: '1px dashed #334155' }}>
            暂无凭证 · 点击「+ 新建凭证」
          </div>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div onClick={() => !busy && setShowCreate(false)}
          style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#1e293b', border: '1px solid #6366f1', borderRadius: 12, padding: 22, maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#a5b4fc' }}>新建凭证</div>
              <button onClick={() => !busy && setShowCreate(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>平台</span>
                <select value={cPlatform} onChange={e => setCPlatform(e.target.value as any)}
                  style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, colorScheme: 'dark' }}>
                  <option value="x">X (Twitter)</option>
                  {/* Other platforms hidden until their credential workflows are wired up. */}
                  {/* <option value="knit">knit</option> */}
                  {/* <option value="2ksg">2ksg</option> */}
                  {/* <option value="bluesky">bluesky</option> */}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>名字</span>
                <input value={cName} onChange={e => setCName(e.target.value)}
                  placeholder="如 main-x-2026-04"
                  style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }} />
              </label>
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>Cookie(完整 Cookie 头)</span>
              <textarea value={cCookie} onChange={e => setCCookie(e.target.value)} rows={4}
                placeholder="auth_token=…; ct0=…; …"
                style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'ui-monospace, monospace', resize: 'vertical' }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>User-Agent(可选)</span>
              <input value={cUa} onChange={e => setCUa(e.target.value)}
                placeholder="Mozilla/5.0 …"
                style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'ui-monospace, monospace' }} />
            </label>

            {cPlatform === 'x' && (
              <details style={{ marginBottom: 12 }}>
                <summary style={{ fontSize: 11, color: '#a5b4fc', cursor: 'pointer', marginBottom: 6 }}>
                  🔁 配置自动刷新(X 用户名 + 密码,加密存储)
                </summary>
                <div style={{ marginTop: 6, padding: '8px 10px', background: '#0f172a', borderRadius: 5, border: '1px solid #312e81' }}>
                  <input value={cSecretUser} onChange={e => setCSecretUser(e.target.value)} autoComplete="off"
                    placeholder="X 用户名 / 邮箱 / 手机号"
                    style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, marginBottom: 6 }} />
                  <input type="password" value={cSecretPass} onChange={e => setCSecretPass(e.target.value)} autoComplete="new-password"
                    placeholder="X 密码"
                    style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }} />
                </div>
              </details>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
              <button onClick={() => setShowCreate(false)} disabled={busy}
                style={{ padding: '6px 14px', borderRadius: 5, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>取消</button>
              <button onClick={create} disabled={busy || !cName.trim() || !cCookie.trim()}
                style={{ padding: '6px 14px', borderRadius: 5, border: 'none', background: busy || !cName.trim() || !cCookie.trim() ? '#1e293b' : '#6366f1', color: busy || !cName.trim() || !cCookie.trim() ? '#475569' : '#fff', fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>
                {busy ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit drawer */}
      {editing && (
        <div onClick={() => !busy && closeEdit()}
          style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#1e293b', border: '1px solid #6366f1', borderRadius: 12, padding: 22, maxWidth: 580, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#a5b4fc' }}>编辑凭证</div>
              <button onClick={() => !busy && closeEdit()} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 12 }}>
              {editing.platform} · 当前 {editing.cookie_len} 字符 cookie · {editing.source_count} 个源在用
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>名字</span>
              <input value={name} onChange={e => setName(e.target.value)}
                style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }} />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>Cookie(留空则不动,贴新值会替换并重置 last_auth_check)</span>
              <textarea value={cookie} onChange={e => setCookie(e.target.value)} rows={4}
                placeholder="auth_token=…; ct0=…; …"
                style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'ui-monospace, monospace', resize: 'vertical' }} />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>User-Agent</span>
              <input value={ua} onChange={e => setUa(e.target.value)}
                style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'ui-monospace, monospace' }} />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>状态(改成 active 会同时重置自动刷新失败计数)</span>
              <select value={status} onChange={e => setStatus(e.target.value as any)}
                style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, colorScheme: 'dark' }}>
                <option value="active">active(活跃)</option>
                <option value="expired">expired(过期,scheduler 会尝试自动刷)</option>
                <option value="revoked">revoked(吊销,scheduler 跳过)</option>
              </select>
            </label>

            {editing.platform === 'x' && (
              <details style={{ marginBottom: 12 }} open={!editing.has_secret ? false : undefined}>
                <summary style={{ fontSize: 11, color: '#a5b4fc', cursor: 'pointer', marginBottom: 6 }}>
                  🔁 自动刷新账密 {editing.has_secret ? `(已绑定 ${editing.secret_username})` : '(未配置)'}
                </summary>
                <div style={{ marginTop: 6, padding: '8px 10px', background: '#0f172a', borderRadius: 5, border: '1px solid #312e81' }}>
                  <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6, lineHeight: 1.5 }}>
                    填了之后,cookie 过期时系统会自动重新登录刷新。两个字段都填才会更新;留空不动。
                    密码用 AES-256-GCM 加密入库。
                  </div>
                  <input value={secretUser} onChange={e => setSecretUser(e.target.value)} autoComplete="off"
                    placeholder="X 用户名 / 邮箱 / 手机号"
                    style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, marginBottom: 6 }} />
                  <input type="password" value={secretPass} onChange={e => setSecretPass(e.target.value)} autoComplete="new-password"
                    placeholder={editing.has_secret ? '留空保留旧密码' : 'X 密码'}
                    style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, marginBottom: 6 }} />
                  {editing.has_secret && (
                    <button onClick={removeSecret} disabled={busy}
                      style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid #7f1d1d', background: 'transparent', color: '#fca5a5', fontSize: 11, cursor: 'pointer' }}>
                      移除自动刷新
                    </button>
                  )}
                </div>
              </details>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <button onClick={remove} disabled={busy}
                style={{ padding: '6px 14px', borderRadius: 5, border: '1px solid #7f1d1d', background: 'transparent', color: '#fca5a5', fontSize: 12, cursor: 'pointer' }}>
                删除凭证
              </button>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={closeEdit} disabled={busy}
                  style={{ padding: '6px 14px', borderRadius: 5, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>取消</button>
                <button onClick={save} disabled={busy}
                  style={{ padding: '6px 14px', borderRadius: 5, border: 'none', background: busy ? '#1e293b' : '#6366f1', color: busy ? '#475569' : '#fff', fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>
                  {busy ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OpLogsPanel() {
  const [logs, setLogs] = useState<OpLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [modalLog, setModalLog] = useState<OpLogRow | null>(null);
  const PAGE_SIZE = 50;

  const [fOperator, setFOperator]     = useState('');
  const [fOperation, setFOperation]   = useState('');
  const [fTargetType, setFTargetType] = useState('');
  const [fTargetId, setFTargetId]     = useState('');
  // The values *applied* to the current fetch. We only push form state into
  // these on Search / Enter so typing doesn't fire a request per keystroke.
  const [applied, setApplied] = useState({ operator: '', operation: '', targetType: '', targetId: '' });

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(page * PAGE_SIZE));
      if (applied.operator)   params.set('operator',    applied.operator);
      if (applied.operation)  params.set('operation',   applied.operation);
      if (applied.targetType) params.set('target_type', applied.targetType);
      if (applied.targetId)   params.set('target_id',   applied.targetId);
      const r = await fetch(`${API}/admin/op-logs?${params.toString()}`, { cache: 'no-store' });
      const j = await r.json();
      setLogs(j.logs ?? []);
      setTotal(j.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [page, applied]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  function applyFilters() {
    setApplied({
      operator: fOperator.trim(),
      operation: fOperation.trim(),
      targetType: fTargetType,
      targetId: fTargetId.trim(),
    });
    setPage(0);
  }

  function clearFilters() {
    setFOperator(''); setFOperation(''); setFTargetType(''); setFTargetId('');
    setApplied({ operator: '', operation: '', targetType: '', targetId: '' });
    setPage(0);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = !!(applied.operator || applied.operation || applied.targetType || applied.targetId);

  return (
    <div style={{ marginTop: 16 }}>

      {/* Filter bar */}
      <div style={{
        background: '#1e293b', border: '1px solid #334155', borderRadius: 10,
        padding: '12px 14px', marginBottom: 12,
        display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
      }}>
        <input
          placeholder="操作人"
          value={fOperator}
          onChange={(e) => setFOperator(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
          style={{
            background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0',
            borderRadius: 6, padding: '6px 10px', fontSize: 12.5, width: 130,
          }}
        />
        <input
          placeholder="操作类型，如 source.create"
          value={fOperation}
          onChange={(e) => setFOperation(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
          style={{
            background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0',
            borderRadius: 6, padding: '6px 10px', fontSize: 12.5, width: 200,
          }}
        />
        <select
          value={fTargetType}
          onChange={(e) => setFTargetType(e.target.value)}
          style={{
            background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0',
            borderRadius: 6, padding: '6px 10px', fontSize: 12.5, minWidth: 120,
          }}
        >
          {TARGET_OPTIONS.map(t => (
            <option key={t} value={t}>{t === '' ? '全部目标类型' : (TARGET_LABEL[t] ?? t)}</option>
          ))}
        </select>
        <input
          placeholder="目标 ID（精确匹配）"
          value={fTargetId}
          onChange={(e) => setFTargetId(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
          style={{
            background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0',
            borderRadius: 6, padding: '6px 10px', fontSize: 12.5, width: 280, fontFamily: 'monospace',
          }}
        />
        <button onClick={applyFilters}
          style={{ background: '#6366f1', border: 'none', color: '#fff', borderRadius: 6, padding: '7px 16px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
          查询
        </button>
        {hasFilters && (
          <button onClick={clearFilters}
            style={{ background: 'transparent', border: '1px solid #334155', color: '#94a3b8', borderRadius: 6, padding: '6px 12px', fontSize: 12.5, cursor: 'pointer' }}>
            清空
          </button>
        )}
        <button onClick={fetchLogs} disabled={loading}
          style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid #334155', color: loading ? '#475569' : '#94a3b8', borderRadius: 6, padding: '6px 12px', fontSize: 12.5, cursor: loading ? 'wait' : 'pointer' }}>
          {loading ? '加载中…' : '刷新'}
        </button>
        <span style={{ fontSize: 12, color: '#64748b' }}>
          共 {total.toLocaleString()} 条
        </span>
      </div>

      {/* Table */}
      <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#0f172a', color: '#64748b', textAlign: 'left' }}>
              <th style={{ padding: '8px 12px', fontWeight: 600, width: 160 }}>时间</th>
              <th style={{ padding: '8px 12px', fontWeight: 600, width: 120 }}>操作人</th>
              <th style={{ padding: '8px 12px', fontWeight: 600, width: 200 }}>操作</th>
              <th style={{ padding: '8px 12px', fontWeight: 600, width: 90 }}>目标</th>
              <th style={{ padding: '8px 12px', fontWeight: 600 }}>对象 / 摘要</th>
              <th style={{ padding: '8px 12px', fontWeight: 600, width: 60, textAlign: 'right' }}>状态</th>
            </tr>
          </thead>
          <tbody>
            {logs.map(l => {
              const label = OP_LABEL[l.operation] ?? l.operation;
              const tgtLabel = TARGET_LABEL[l.target_type] ?? l.target_type;
              const isAuto = (l.payload as { auto?: boolean })?.auto === true;
              return (
                <tr key={l.id}
                  onClick={() => setModalLog(l)}
                  style={{ borderTop: '1px solid #0f172a', cursor: 'pointer' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#0f172a')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '8px 12px', color: '#94a3b8', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                    {fmtTs(l.occurred_at)}
                  </td>
                  <td style={{ padding: '8px 12px', color: '#e2e8f0', fontWeight: 500 }}>
                    {l.operator}
                    {l.operator === 'anonymous' && (
                      <span style={{ marginLeft: 4, color: '#64748b', fontSize: 10 }}>(匿名)</span>
                    )}
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ color: '#a78bfa', fontWeight: 500 }}>{label}</span>
                    {label !== l.operation && (
                      <div style={{ color: '#475569', fontSize: 10.5, fontFamily: 'monospace', marginTop: 2 }}>
                        {l.operation}{isAuto && ' · auto'}
                      </div>
                    )}
                    {label === l.operation && isAuto && (
                      <span style={{ marginLeft: 4, color: '#475569', fontSize: 10 }}>auto</span>
                    )}
                  </td>
                  <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{tgtLabel}</td>
                  <td style={{ padding: '8px 12px', color: '#cbd5e1', maxWidth: 0, overflow: 'hidden' }}>
                    {l.target_id && (
                      <div style={{ color: '#64748b', fontFamily: 'monospace', fontSize: 11, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {l.target_id}
                      </div>
                    )}
                    <div style={{ color: '#94a3b8', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {payloadPreview(l.payload)}
                    </div>
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace' }}>
                    <span style={{
                      color: l.status_code === null ? '#475569' :
                             l.status_code < 400 ? '#34d399' : '#f87171',
                    }}>
                      {l.status_code ?? '—'}
                    </span>
                  </td>
                </tr>
              );
            })}
            {logs.length === 0 && !loading && (
              <tr><td colSpan={6} style={{ padding: '40px 12px', textAlign: 'center', color: '#475569' }}>
                {hasFilters ? '没有符合条件的记录' : '暂无操作日志'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination — same numbered-jump pattern as 采集预览. */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4, marginTop: 16, flexWrap: 'wrap' }}>
          <PageBtn label="« 首页" disabled={page === 0} onClick={() => setPage(0)} />
          <PageBtn label="‹ 上一页" disabled={page === 0} onClick={() => setPage(Math.max(0, page - 1))} />

          {pageNumbers(page, totalPages).map((p, idx) =>
            p === '…' ? (
              <span key={`gap-${idx}`} style={{ padding: '5px 6px', fontSize: 12, color: '#475569' }}>…</span>
            ) : (
              <PageBtn key={p} label={String(p + 1)} active={p === page} onClick={() => setPage(p)} />
            ),
          )}

          <PageBtn label="下一页 ›" disabled={page >= totalPages - 1} onClick={() => setPage(Math.min(totalPages - 1, page + 1))} />
          <PageBtn label="末页 »" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)} />

          <span style={{ marginLeft: 12, fontSize: 12, color: '#64748b' }}>第 {page + 1} / {totalPages} 页</span>
        </div>
      )}

      {/* Detail modal */}
      {modalLog && (
        <div onClick={() => setModalLog(null)}
          style={{ position: 'fixed', inset: 0, background: '#000c', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, cursor: 'zoom-out' }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '760px', width: '100%', maxHeight: '85vh', overflow: 'auto', background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: '20px 24px', cursor: 'default' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
              <h3 style={{ margin: 0, color: '#e2e8f0', fontSize: 16 }}>
                {OP_LABEL[modalLog.operation] ?? modalLog.operation}
              </h3>
              <button onClick={() => setModalLog(null)}
                style={{ background: 'transparent', border: 'none', color: '#64748b', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>
                ×
              </button>
            </div>

            <table style={{ width: '100%', fontSize: 12.5, marginBottom: 14 }}>
              <tbody>
                {[
                  ['操作类型', modalLog.operation],
                  ['操作人', `${modalLog.operator}${modalLog.operator_id ? ` (${modalLog.operator_id})` : ''}`],
                  ['操作时间', fmtTs(modalLog.occurred_at)],
                  ['目标类型', TARGET_LABEL[modalLog.target_type] ?? modalLog.target_type],
                  ['目标 ID', modalLog.target_id ?? '—'],
                  ['HTTP', `${modalLog.http_method ?? '?'} ${modalLog.http_path ?? '?'}`],
                  ['响应码', modalLog.status_code ?? '—'],
                  ['IP', modalLog.ip ?? '—'],
                  ['请求 ID', modalLog.request_id ?? '—'],
                ].map(([k, v]) => (
                  <tr key={k as string}>
                    <td style={{ padding: '4px 12px 4px 0', color: '#64748b', whiteSpace: 'nowrap', verticalAlign: 'top', width: 90 }}>{k}</td>
                    <td style={{ padding: '4px 0', color: '#e2e8f0', fontFamily: typeof v === 'string' && /^[a-f0-9-]{8,}/i.test(v) ? 'monospace' : 'inherit', wordBreak: 'break-all' }}>{String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>Payload</div>
            <pre style={{
              background: '#0f172a', border: '1px solid #334155', borderRadius: 6,
              padding: '12px 14px', margin: 0,
              fontSize: 11.5, color: '#cbd5e1',
              overflow: 'auto', maxHeight: 360,
              fontFamily: '"JetBrains Mono", "SF Mono", Menlo, monospace',
            }}>{JSON.stringify(modalLog.payload, null, 2)}</pre>

            {modalLog.user_agent && (
              <div style={{ marginTop: 10, fontSize: 11, color: '#475569', wordBreak: 'break-all' }}>
                UA: {modalLog.user_agent}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
