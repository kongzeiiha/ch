'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { getSprintStart, computeDayLabel, todayISO } from '../../lib/sprint';

import type { PipelineState, ReviewItem, PublishItem, PublishedItem, DistTask, AgentRunRow, QueueStat, ItemHistory, LiveJobs, Source, CredentialRow, RawItem, AuthSuspect, BlockedItem, PassedItem } from './_components/types';
import { API, POLL, AGENTS } from './_components/constants';
import { PipelineTab } from './_components/PipelineTab';
import { SourcesPanel } from './_components/SourcesPanel';
import { CrawlPreviewPanel } from './_components/CrawlPreviewPanel';
import { CredentialsPanel } from './_components/CredentialsPanel';
import { QueueRunsPanel } from './_components/QueueRunsPanel';
import { OpLogsPanel } from './_components/OpLogsPanel';
import { ConfirmModal, type ConfirmRequest } from './_components/ConfirmModal';

// ─── Main page ────────────────────────────────────────────────────────────────

export default function WorkbenchPage() {
  const [sprintStart, setSprintStart] = useState(todayISO);
  useEffect(() => { setSprintStart(getSprintStart()); }, []);
  const dayLabel = (n: number) => computeDayLabel(sprintStart, n);

  function handleSprintChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setSprintStart(v);
    if (typeof window !== 'undefined') localStorage.setItem('sprintStart', v);
  }

  const [state, setState] = useState<PipelineState | null>(null);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [publishItems, setPublishItems] = useState<PublishItem[]>([]);
  const [publishedItems, setPublishedItems] = useState<PublishedItem[]>([]);
  const [distTasks, setDistTasks] = useState<DistTask[]>([]);
  const [blockedItems, setBlockedItems] = useState<BlockedItem[]>([]);
  const [passedItems, setPassedItems] = useState<PassedItem[]>([]);
  const [agentSummary, setAgentSummary] = useState<AgentRunRow[]>([]);
  const [queues, setQueues] = useState<QueueStat[]>([]);
  const [liveJobs, setLiveJobs] = useState<LiveJobs>({ active: {}, recent: {} });
  const [sources, setSources] = useState<Source[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [historyModal, setHistoryModal] = useState<ItemHistory | null>(null);
  // Custom confirm modal — replaces the harsh native window.confirm() so the
  // dark theme stays consistent across destructive actions (delete source,
  // emergency stop, rollback, etc.).
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);
  const confirmAsync = useCallback((opts: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> =>
    new Promise<boolean>(resolve => {
      setConfirmReq({
        ...opts,
        resolve: (ok) => { setConfirmReq(null); resolve(ok); },
      });
    }),
  []);
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
  // Split into "always" (header counters + sources for stage chips + auth
  // banner) and "pipeline-only" (the 7 endpoints that drive only the Pipeline
  // tab's queues / live-jobs / blocked / passed / published lists). Cuts the
  // per-tick request count from 12 → 5 whenever the user is on Sources / Crawl
  // / Credentials / Queues / OpLogs tabs.
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const load = useCallback(async () => {
    const onPipeline = tabRef.current === 'pipeline';
    try {
      // Always-needed fetches.
      const alwaysJobs = [
        fetch(`${API}/admin/pipeline/state`, { cache: 'no-store' }).then(r => r.json()),
        fetch(`${API}/admin/ops/agent-runs`, { cache: 'no-store' }).then(r => r.json()),
        fetch(`${API}/admin/ops/queues`, { cache: 'no-store' }).then(r => r.json()),
        fetch(`${API}/admin/sources`, { cache: 'no-store' }).then(r => r.json()),
        fetch(`${API}/admin/sources/auth-status`, { cache: 'no-store' }).then(r => r.json()),
      ];
      // Pipeline-tab-only fetches (7 of them).
      const pipelineJobs = onPipeline ? [
        fetch(`${API}/admin/pipeline/review-queue`, { cache: 'no-store' }).then(r => r.json()),
        fetch(`${API}/admin/pipeline/publish-queue`, { cache: 'no-store' }).then(r => r.json()),
        fetch(`${API}/admin/pipeline/distribution-queue`, { cache: 'no-store' }).then(r => r.json()),
        fetch(`${API}/admin/pipeline/live-jobs`, { cache: 'no-store' }).then(r => r.json()),
        fetch(`${API}/admin/pipeline/blocked-queue`, { cache: 'no-store' }).then(r => r.json()),
        fetch(`${API}/admin/pipeline/passed-queue`, { cache: 'no-store' }).then(r => r.json()),
        fetch(`${API}/admin/pipeline/published-queue`, { cache: 'no-store' }).then(r => r.json()),
      ] : [];

      const all = await Promise.allSettled([...alwaysJobs, ...pipelineJobs]);
      const [s, ar, qv, sv, asv, rv, pv, dv, lv, bv, psv, pubv] = all;

      if (s.status === 'fulfilled') setState(s.value);
      if (ar.status === 'fulfilled') setAgentSummary(ar.value.summary ?? []);
      if (qv.status === 'fulfilled') setQueues(qv.value.stats ?? []);
      if (sv.status === 'fulfilled') setSources(sv.value.sources ?? []);
      if (asv.status === 'fulfilled') setAuthSuspect(asv.value.suspect ?? []);

      if (onPipeline) {
        if (rv?.status === 'fulfilled') setReviewItems(rv.value.items ?? []);
        if (pv?.status === 'fulfilled') setPublishItems(pv.value.items ?? []);
        if (dv?.status === 'fulfilled') setDistTasks(dv.value.tasks ?? []);
        if (lv?.status === 'fulfilled') setLiveJobs({ active: lv.value.active ?? {}, recent: lv.value.recent ?? {} });
        if (bv?.status === 'fulfilled') setBlockedItems(bv.value.items ?? []);
        if (psv?.status === 'fulfilled') setPassedItems(psv.value.items ?? []);
        if (pubv?.status === 'fulfilled') setPublishedItems(pubv.value.items ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, tab]);
  useEffect(() => {
    // Pause polling when the browser tab is hidden — saves ~10 RPS for users
    // who left workbench open in a background tab. Catches up with one
    // immediate fetch on visibility-restore so the UI is never stale on
    // refocus.
    const tick = () => {
      if (autoRefresh.current && document.visibilityState === 'visible') {
        load();
      }
    };
    timer.current = setInterval(tick, POLL);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      if (timer.current) clearInterval(timer.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
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
    const ok = await confirmAsync({
      title: '紧急停止',
      body: '将暂停所有自动化流程。已在队列中的 job 仍会跑完，但 auto-pipeline / 调度器不再下发新任务。',
      danger: true,
      confirmLabel: '🛑 触发紧急停止',
    });
    if (!ok) return;
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
  const overrideBlock = async (itemId: string, title: string) => {
    const ok = await confirmAsync({
      title: '人工放行',
      body: `《${title.slice(0, 60)}${title.length > 60 ? '…' : ''}》\n\n会推翻机器拒绝结论（黑名单 / LLM 评分）并写入反馈环路，影响后续规则归纳。`,
      danger: true,
      confirmLabel: '强制放行',
    });
    if (!ok) return;
    const reason = prompt('放行理由（用于反馈环路,推荐填写）') ?? '';
    await call(`/admin/pipeline/override-block/${itemId}`, 'POST', { reason });
    flash('已放行 → COMPLIANCE_PASS');
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
  // Both actions invalidate any "最近完成" entry for the item: rollback moves
  // it back a stage, rerun re-queues it. The agent_runs audit row stays in
  // DB (we don't delete history), so the next /live-jobs poll would still
  // surface the stale entry until 8 newer runs push it out of the window.
  // Pull it out of the local recent list optimistically and close the
  // history modal so the operator gets immediate feedback.
  const dropFromRecent = (itemId: string) => {
    setLiveJobs((prev) => ({
      ...prev,
      recent: Object.fromEntries(
        Object.entries(prev.recent).map(([agent, list]) => [
          agent,
          list.filter((r) => r.item_id !== itemId),
        ]),
      ),
    }));
  };

  const rollback = async (itemId: string, title: string) => {
    const ok = await confirmAsync({
      title: '回滚到上一阶段',
      body: `「${title}」\n\n状态会退回上一档（已发布会下线）。`,
      danger: true,
      confirmLabel: '确认回滚',
    });
    if (!ok) return;
    try {
      const d: any = await call(`/admin/pipeline/rollback/${itemId}`);
      flash(`已回滚: ${d.from} → ${d.to}`);
      dropFromRecent(itemId);
      setHistoryModal(null);
      await load();
    } catch (e) { flash(`回滚失败: ${e}`, false); }
  };

  const rerun = async (itemId: string) => {
    try {
      const d: any = await call(`/admin/pipeline/rerun/${itemId}`);
      flash(`已重跑: ${d.agentKey}`);
      dropFromRecent(itemId);
      setHistoryModal(null);
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
    const ok = await confirmAsync({
      title: '删除采集源',
      body: `「${src.name}」（${src.platform}）将被删除。已采集的文章（如有）保留，下面会提示是否级联清理。`,
      danger: true,
      confirmLabel: '删除',
    });
    if (!ok) return;
    try {
      const r = await fetch(`${API}/admin/sources/${src.id}`, { method: 'DELETE' });
      if (r.status === 409) {
        const d = await r.json();
        const cascade = await confirmAsync({
          title: '级联删除文章',
          body: `${d.message}\n\n连同 ${d.itemCount} 篇关联文章一起删除？此操作不可撤销。`,
          danger: true,
          confirmLabel: `删除源 + ${d.itemCount} 篇文章`,
        });
        if (!cascade) return;
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

  // Bulk delete: one confirm covers the whole batch and forces cascade so we
  // don't ping-pong through the per-source 409 dialog N times. Sequential
  // (not Promise.all) — DELETE cascades touch MinIO and we don't want to slam
  // the bucket with parallel deletes that may share keys.
  const bulkDeleteSources = async (srcs: Source[]) => {
    if (srcs.length === 0) return;
    const ok = await confirmAsync({
      title: `批量删除 ${srcs.length} 个采集源`,
      body: `所选 ${srcs.length} 个采集源及其所有关联文章、封面、媒体文件都会被永久删除。此操作不可撤销。\n\n${srcs.slice(0, 8).map((s) => `· ${s.name} (${s.platform})`).join('\n')}${srcs.length > 8 ? `\n…还有 ${srcs.length - 8} 个` : ''}`,
      danger: true,
      confirmLabel: `删除 ${srcs.length} 个源（含关联文章）`,
    });
    if (!ok) return;
    let deleted = 0;
    let failed = 0;
    for (const src of srcs) {
      try {
        const r = await fetch(`${API}/admin/sources/${src.id}?cascade=1`, { method: 'DELETE' });
        if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
        deleted++;
      } catch (e) {
        failed++;
        console.warn(`bulk delete failed for ${src.name}:`, e);
      }
    }
    if (failed === 0) flash(`已删除 ${deleted} 个采集源`);
    else flash(`删除 ${deleted} 成功 / ${failed} 失败`, false);
    await load();
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
  const agentSummaryMap = new Map(agentSummary.map(r => [r.agent, r]));
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
    const firstWithBacklog = AGENTS.find((a) => a.pendingStatus && (pending[a.pendingStatus] ?? 0) > 0);
    setSelectedAgent(firstWithBacklog?.key ?? AGENTS[0].key);
  }, [state, reviewItems.length, publishItems.length, distTasks.length, selectedAgent, pending]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', fontFamily: 'system-ui, -apple-system, PingFang SC, sans-serif' }}>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 9999, padding: '10px 16px', borderRadius: 8, background: toast.ok ? '#052e16' : '#450a0a', border: `1px solid ${toast.ok ? '#16a34a' : '#dc2626'}`, color: toast.ok ? '#86efac' : '#fca5a5', fontSize: 13, maxWidth: 360, boxShadow: '0 4px 20px #0008' }}>
          {toast.msg}
        </div>
      )}

      {/* Themed confirm modal — replaces native window.confirm() globally. */}
      <ConfirmModal req={confirmReq} />

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
        <input
          type="date"
          value={sprintStart}
          onChange={handleSprintChange}
          aria-label="冲刺开始日期"
          style={{ fontSize: 12, background: '#1e293b', border: '1px solid #334155', borderRadius: 4, padding: '2px 6px', color: '#94a3b8', colorScheme: 'dark' }}
        />

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
          <Link href="/" style={{ fontSize: 12, color: '#94a3b8', textDecoration: 'none', padding: '4px 10px', border: '1px solid #334155', borderRadius: 6 }}>站点 →</Link>
          <button
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' });
              window.location.href = '/login';
            }}
            style={{ fontSize: 12, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px' }}
          >退出</button>

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

      <div style={{
        // Pipeline + queues tabs are dense (8 stage cards / queue grid) — they
        // need the full 1280. The list/form-heavy tabs (sources / crawl /
        // credentials / oplogs) look airier at a narrower width.
        maxWidth: ['sources', 'crawl', 'credentials', 'oplogs'].includes(tab) ? 1180 : 1280,
        margin: '0 auto',
        padding: '20px 20px 60px',
        transition: 'max-width 200ms ease',
      }}>

        {loading && !state && (
          <div style={{ textAlign: 'center', padding: 60, color: '#475569' }}>连接中…</div>
        )}

        {/* ── Pipeline tab ── */}
        {tab === 'pipeline' && (
          <PipelineTab
            loading={loading}
            state={state}
            agents={agents}
            pending={pending}
            queues={queues}
            agentSummary={agentSummary}
            liveJobs={liveJobs}
            reviewItems={reviewItems}
            publishItems={publishItems}
            publishedItems={publishedItems}
            distTasks={distTasks}
            blockedItems={blockedItems}
            passedItems={passedItems}
            selectedAgent={selectedAgent}
            setSelectedAgent={setSelectedAgent}
            busyAgent={busyAgent}
            selectedItems={selectedItems}
            setSelectedItems={setSelectedItems}
            dayLabel={dayLabel}
            setTab={(t) => setTab(t as 'pipeline' | 'sources' | 'crawl' | 'credentials' | 'queues' | 'oplogs')}
            setAuto={setAuto}
            setPaused={setPaused}
            runAgent={runAgent}
            approveReview={approveReview}
            rejectReview={rejectReview}
            overrideBlock={overrideBlock}
            approvePublish={approvePublish}
            confirmDist={confirmDist}
            rollback={rollback}
            rerun={rerun}
            showHistory={showHistory}
          />
        )}

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
            onBulkDelete={bulkDeleteSources}
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
            confirmAsync={confirmAsync}
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
