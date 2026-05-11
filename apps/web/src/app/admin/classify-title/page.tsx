'use client';

import { useEffect, useState, useCallback } from 'react';
import { AdminNav } from '../../../components/AdminNav';
import Link from 'next/link';

type Stats = {
  total: number;
  by_status: { status: string; count: number }[];
  by_category: { category: string; count: number }[];
  recent_runs: {
    id: string;
    agent: string;
    status: string;
    latency_ms: number | null;
    cost_usd: string | null;
    started_at: string;
    error: string | null;
  }[];
  cost_last_24h: number;
};

type Item = {
  id: string;
  status: string;
  title: string | null;
  summary: string | null;
  slug: string | null;
  category: string | null;
  tags: string[];
  keywords: string[];
  source: string;
  url: string;
  updated_at: string;
};

async function getJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

const card: React.CSSProperties = { background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: 16 };
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600, color: '#94a3b8', borderBottom: '1px solid #334155', background: '#0f172a', textTransform: 'uppercase', letterSpacing: 0.4 };
const td: React.CSSProperties = { padding: '10px 12px', fontSize: 13, borderBottom: '1px solid #334155', verticalAlign: 'top', color: '#e2e8f0' };
const btn: React.CSSProperties = { padding: '6px 12px', fontSize: 12, border: '1px solid #334155', borderRadius: 6, background: 'transparent', color: '#94a3b8', cursor: 'pointer' };
const btnPrimary: React.CSSProperties = { ...btn, background: '#6366f1', color: '#fff', borderColor: '#6366f1', fontWeight: 600 };

const STATUS_LABEL: Record<string, string> = {
  INGESTED: '已采集', CLASSIFIED: '已分类', TITLED: '已生成标题', COVERED: '已选封面',
  COMPLIANCE_PASS: '合规通过', COMPLIANCE_FAIL: '合规拒绝', PUBLISHED: '已发布', DISTRIBUTED: '已分发',
};

function Tile({ label, value, hint, accent }: { label: string; value: React.ReactNode; hint?: string; accent?: string }) {
  return (
    <div style={card}>
      <div style={{ color: '#64748b', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, marginTop: 6, color: accent ?? '#e2e8f0' }}>{value}</div>
      {hint && <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function Pill({ children, color, fg }: { children: React.ReactNode; color?: string; fg?: string }) {
  return (
    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: color ?? '#334155', color: fg ?? '#cbd5e1', marginRight: 4, marginBottom: 2, display: 'inline-block', fontWeight: 500 }}>
      {children}
    </span>
  );
}

export default function Day3Page() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [loadingItems, setLoadingItems] = useState(false);
  // Inline-edit state: which item is being edited, and the draft buffer.
  // Background polls (4s) overwrite `items` — we keep the draft in a separate
  // map so a typing user doesn't lose their work mid-edit.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ title: string; summary: string }>({ title: '', summary: '' });
  // Items the user just kicked back via reclassify/retitle. We keep them
  // hidden from the list until the filter changes — otherwise the 4s
  // background poll would re-pull the row (its new status may still match
  // the active filter) and surprise the user with "didn't I just remove
  // that?".
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  // Filter changes are an explicit "show me current state" signal — drop
  // the hide-list so the user can see what's there now.
  useEffect(() => {
    setHiddenIds(new Set());
  }, [filter, categoryFilter]);

  const refresh = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoadingItems(true);
      const itemQs = new URLSearchParams({ limit: '30' });
      if (filter) itemQs.set('status', filter);
      if (categoryFilter) itemQs.set('category', categoryFilter);
      // Stats endpoint scopes total + by_status to the active category so the
      // status filter buttons can display accurate counts under that category.
      const statsQs = categoryFilter ? `?category=${encodeURIComponent(categoryFilter)}` : '';
      const [s, it] = await Promise.all([
        getJSON<Stats>(`/api/admin/classify-title/stats${statsQs}`),
        getJSON<{ items: Item[] }>(`/api/admin/classify-title/items?${itemQs.toString()}`),
      ]);
      setStats(s);
      setItems(it.items);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoadingItems(false);
    }
  }, [filter, categoryFilter]);

  useEffect(() => {
    refresh();
    // Background polls don't show the loading spinner — only explicit
    // user-initiated filter changes do.
    const t = setInterval(() => refresh(true), 4_000);
    return () => clearInterval(t);
  }, [refresh]);

  async function bulk(path: string, label: string) {
    setBusy(true);
    try {
      const r = await getJSON<{ enqueued: number }>(`/api/admin/classify-title/${path}`, { method: 'POST' });
      setToast(`${label}:已入队 ${r.enqueued} 条`);
      setTimeout(() => setToast(null), 3000);
      await refresh(true);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(it: Item) {
    setEditingId(it.id);
    setEditDraft({ title: it.title ?? '', summary: it.summary ?? '' });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft({ title: '', summary: '' });
  }

  async function saveEdit(it: Item) {
    const title = editDraft.title.trim();
    if (!title) {
      setErr('标题不能为空');
      setTimeout(() => setErr(null), 2500);
      return;
    }
    // Send summary only if it actually changed — keeps the payload clean and
    // avoids stomping a NULL summary when the user didn't touch it.
    const body: { title: string; summary?: string | null } = { title };
    const draftSummary = editDraft.summary.trim();
    const currentSummary = it.summary ?? '';
    if (draftSummary !== currentSummary) {
      body.summary = draftSummary === '' ? null : draftSummary;
    }

    setBusyId((b) => ({ ...b, [it.id]: true }));
    try {
      const r = await fetch(`/api/admin/classify-title/edit-title/${it.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `${r.status} ${r.statusText}`);
      // Optimistic local update — replace the row in-place so the user sees
      // the new title without waiting for the 4s background poll.
      setItems((prev) => prev.map((x) =>
        x.id === it.id
          ? { ...x, title: data.title ?? title, summary: body.summary !== undefined ? (body.summary ?? null) : x.summary, status: data.status ?? x.status }
          : x,
      ));
      cancelEdit();
      setToast(data.statusChanged ? '已保存（状态升级到 TITLED）' : '已保存');
      setTimeout(() => setToast(null), 2500);
      refresh(true);
    } catch (e: any) {
      setErr(e.message);
      setTimeout(() => setErr(null), 4000);
    } finally {
      setBusyId((b) => ({ ...b, [it.id]: false }));
    }
  }

  async function retrigger(kind: 'reclassify' | 'retitle', it: Item) {
    // Items already past TITLED have downstream fields (cover / compliance /
    // published_url) that the reset will wipe. Confirm before nuking them.
    const downstream = ['COVERED', 'COMPLIANCE_PASS', 'COMPLIANCE_FAIL', 'COMPLIANCE_REVIEW', 'PUBLISHED', 'DISTRIBUTED'];
    if (downstream.includes(it.status)) {
      const verb = kind === 'reclassify' ? '重新分类' : '重新标题';
      const extra = it.status === 'PUBLISHED' || it.status === 'DISTRIBUTED'
        ? '\n\n⚠ 该文章已上线，会立即从站点下线，须重新走完合规 + 人工批准发布才会再次显示。'
        : '\n\n会清空封面 / 合规 / 发布相关字段。';
      if (!window.confirm(`${verb}「${it.title ?? it.id.slice(0, 8)}」？${extra}`)) return;
    }
    setBusyId((b) => ({ ...b, [it.id]: true }));
    try {
      const r = await fetch(`/api/admin/classify-title/${kind}/${it.id}`, { method: 'POST' });
      const body = await r.json();
      if (!r.ok) throw new Error(body?.error ?? `${r.status} ${r.statusText}`);
      // Hide this id from now on. Background polls will re-fetch but our
      // render filter will drop it. Cleared when user switches filter.
      setHiddenIds((s) => { const n = new Set(s); n.add(it.id); return n; });
      setItems((prev) => prev.filter((x) => x.id !== it.id));
      setToast(kind === 'reclassify' ? '已重跑分类（status → INGESTED）' : '已重跑标题（status → CLASSIFIED）');
      setTimeout(() => setToast(null), 2500);
      // Pull fresh stats so the tile counts reflect the rollback.
      refresh(true);
    } catch (e: any) {
      setErr(e.message);
      setTimeout(() => setErr(null), 4000);
    } finally {
      setBusyId((b) => ({ ...b, [it.id]: false }));
    }
  }

  // Items currently visible after applying the local "hide just-rerun rows"
  // mask. Background polls overwrite `items` on every tick — without this
  // the hidden ids would re-appear on the next refresh.
  const visibleItems = items.filter((x) => !hiddenIds.has(x.id));

  const countByStatus = Object.fromEntries((stats?.by_status ?? []).map((s) => [s.status, s.count]));
  // Cumulative coverage: anything past INGESTED has been classified;
  // anything past CLASSIFIED has been titled. Computing by subtraction
  // catches all downstream statuses (incl. DISTRIBUTED / COMPLIANCE_FAIL /
  // COMPLIANCE_REVIEW) without listing them by name.
  const total = stats?.total ?? 0;
  const classifiedTotal = total - (countByStatus.INGESTED ?? 0);
  const titledTotal = classifiedTotal - (countByStatus.CLASSIFIED ?? 0);

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', fontFamily: 'system-ui, -apple-system, PingFang SC, sans-serif' }}>
      <header style={{ background: '#020617', borderBottom: '1px solid #1e293b', padding: '0 24px', height: 52, display: 'flex', alignItems: 'center', gap: 16, position: 'sticky', top: 0, zIndex: 100 }}>
        <span style={{ color: '#e2e8f0', fontSize: 16, fontWeight: 800 }}>内容中台</span>
        <span style={{ color: '#334155' }}>/</span>
        <span style={{ fontSize: 13, color: '#64748b' }}>分类与标题</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Link href="/workbench" style={{ ...btn, textDecoration: 'none', color: '#e2e8f0', display: 'inline-flex', alignItems: 'center' }}>← 工作台</Link>
          <button style={btn} disabled={busy} onClick={() => bulk('classify-all', '分类')}>批量分类 (INGESTED)</button>
          <button style={btnPrimary} disabled={busy} onClick={() => bulk('title-all', '标题')}>批量生成标题 (CLASSIFIED)</button>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 20px 60px' }}>
        <AdminNav current="classify-title" />

        {toast && <div style={{ ...card, background: '#052e16', borderColor: '#16a34a', color: '#86efac', marginBottom: 12, fontSize: 13 }}>{toast}</div>}
        {err && <div style={{ ...card, background: '#450a0a', borderColor: '#7f1d1d', color: '#fca5a5', marginBottom: 12, fontSize: 13 }}>⚠ {err}</div>}

        {/* Tiles */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 16 }}>
          <Tile label="总条目" value={stats?.total ?? '—'} />
          <Tile label="已分类" value={classifiedTotal} accent="#a78bfa" hint={`覆盖率 ${stats?.total ? Math.round((classifiedTotal / stats.total) * 100) : 0}%`} />
          <Tile label="已生成标题" value={titledTotal} accent="#22c55e" hint={`覆盖率 ${stats?.total ? Math.round((titledTotal / stats.total) * 100) : 0}%`} />
          <Tile label="24h 成本" value={`$${(stats?.cost_last_24h ?? 0).toFixed(4)}`} accent="#a78bfa" />
          <Tile label="待处理队列" value={(countByStatus.INGESTED ?? 0) + (countByStatus.CLASSIFIED ?? 0)} accent="#fbbf24" hint="INGESTED + CLASSIFIED" />
        </section>

        {/* Category distribution — pills are filter chips */}
        {stats && stats.by_category.length > 0 && (
          <section style={{ ...card, marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 13, color: '#cbd5e1', fontWeight: 600 }}>
              分类分布 <span style={{ color: '#475569', fontWeight: 400, fontSize: 11 }}>· 点击切换筛选</span>
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {stats.by_category.map((c) => {
                const active = categoryFilter === c.category;
                return (
                  <button
                    key={c.category}
                    onClick={() => setCategoryFilter(active ? '' : c.category)}
                    style={{
                      fontSize: 11, padding: '3px 10px', borderRadius: 10, fontWeight: 500,
                      cursor: 'pointer', border: '1px solid',
                      background: active ? '#6366f1' : '#1e3a8a',
                      borderColor: active ? '#818cf8' : '#1e3a8a',
                      color: active ? '#ffffff' : '#93c5fd',
                    }}>
                    {c.category} · {c.count}
                  </button>
                );
              })}
              {categoryFilter && (
                <button
                  onClick={() => setCategoryFilter('')}
                  style={{ fontSize: 11, padding: '3px 10px', borderRadius: 10, background: 'transparent', border: '1px solid #475569', color: '#94a3b8', cursor: 'pointer' }}>
                  清除分类筛选 ✕
                </button>
              )}
            </div>
          </section>
        )}

        {/* Status filter — counts come from stats.by_status which is now
            category-scoped when categoryFilter is set, so the badges reflect
            "how many in THIS category". Covers the full pipeline so users
            whose data has already moved past TITLED can still find it. */}
        <div style={{ marginBottom: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#64748b' }}>状态筛选:</span>
          {['', 'INGESTED', 'CLASSIFIED', 'TITLED', 'COVERED', 'COMPLIANCE_PASS', 'PUBLISHED', 'DISTRIBUTED'].map((s) => {
            const count = s === '' ? (stats?.total ?? 0) : (countByStatus[s] ?? 0);
            const active = filter === s;
            // INGESTED items have category=NULL by definition, so the
            // (category + INGESTED) intersection is always empty. Disable.
            const disabled = !!categoryFilter && s === 'INGESTED';
            return (
              <button
                key={s || 'all'}
                disabled={disabled}
                title={disabled ? 'INGESTED 状态尚未分类，无法按分类过滤' : undefined}
                style={{
                  ...btn,
                  ...(active ? { background: '#6366f1', color: '#fff', borderColor: '#6366f1' } : {}),
                  ...(disabled ? { opacity: 0.4, cursor: 'not-allowed' } : {}),
                }}
                onClick={() => !disabled && setFilter(s)}>
                {s === '' ? '全部' : STATUS_LABEL[s] ?? s}
                <span style={{
                  marginLeft: 6, fontSize: 10, color: active ? '#e0e7ff' : count > 0 ? '#a5b4fc' : '#475569',
                  fontVariantNumeric: 'tabular-nums',
                }}>{count}</span>
              </button>
            );
          })}
          {(filter || categoryFilter) && (
            <span style={{ fontSize: 11, color: '#64748b', marginLeft: 8 }}>
              {loadingItems ? '加载中…' : `命中 ${visibleItems.length} 条`}
              {hiddenIds.size > 0 && <span style={{ color: '#475569' }}> · 已隐藏 {hiddenIds.size} 条重跑中</span>}
              {categoryFilter && <> · 分类 <code style={{ color: '#93c5fd' }}>{categoryFilter}</code></>}
            </span>
          )}
        </div>

        {/* Items */}
        <section style={{ ...card, padding: 0, marginBottom: 16, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>标题 / 来源</th>
                <th style={th}>分类</th>
                <th style={th}>标签</th>
                <th style={th}>状态</th>
                <th style={th}>操作</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((it) => {
                const isEditing = editingId === it.id;
                return (
                <tr key={it.id}>
                  <td style={{ ...td, maxWidth: 380 }}>
                    {isEditing ? (
                      // Edit mode: title + summary textareas. Cmd/Ctrl+Enter saves,
                      // Esc cancels — keep operators on the keyboard.
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <textarea
                          value={editDraft.title}
                          autoFocus
                          rows={2}
                          onChange={(e) => setEditDraft((d) => ({ ...d, title: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                            else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveEdit(it); }
                          }}
                          placeholder="标题"
                          style={{
                            background: '#0f172a', border: '1px solid #6366f1', borderRadius: 6,
                            padding: '6px 10px', color: '#e2e8f0', fontSize: 13, lineHeight: 1.5,
                            outline: 'none', resize: 'vertical', fontFamily: 'inherit',
                          }}
                        />
                        <textarea
                          value={editDraft.summary}
                          rows={3}
                          onChange={(e) => setEditDraft((d) => ({ ...d, summary: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                            else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveEdit(it); }
                          }}
                          placeholder="摘要（可选）"
                          style={{
                            background: '#0f172a', border: '1px solid #334155', borderRadius: 6,
                            padding: '6px 10px', color: '#cbd5e1', fontSize: 12, lineHeight: 1.5,
                            outline: 'none', resize: 'vertical', fontFamily: 'inherit',
                          }}
                        />
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: '#64748b' }}>
                          <button style={btnPrimary} disabled={!!busyId[it.id]} onClick={() => saveEdit(it)}>
                            {busyId[it.id] ? '保存中…' : '保存'}
                          </button>
                          <button style={btn} disabled={!!busyId[it.id]} onClick={cancelEdit}>取消</button>
                          <span style={{ marginLeft: 4 }}>⌘/Ctrl + Enter 保存 · Esc 取消</span>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ fontWeight: 500, marginBottom: 2, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {it.title ? (
                              <a href={it.url} target="_blank" rel="noreferrer" style={{ color: '#e2e8f0', textDecoration: 'none' }}>{it.title}</a>
                            ) : (
                              <span style={{ color: '#64748b' }}>(无标题)</span>
                            )}
                          </div>
                          <button
                            onClick={() => startEdit(it)}
                            title="编辑标题 / 摘要(不会清空下游;PUBLISHED 文章会同步刷 ISR)"
                            style={{
                              flexShrink: 0,
                              background: 'transparent', border: '1px solid #334155', borderRadius: 4,
                              padding: '1px 6px', color: '#94a3b8', fontSize: 11, cursor: 'pointer',
                              lineHeight: 1.4,
                            }}>
                            ✎ 编辑
                          </button>
                        </div>
                        {it.summary && <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.5 }}>{it.summary}</div>}
                        <div style={{ color: '#475569', fontSize: 11, marginTop: 4 }}>{it.source} · {it.slug ?? '—'}</div>
                      </>
                    )}
                  </td>
                  <td style={td}>
                    {it.category ? <Pill color="#1e3a8a" fg="#93c5fd">{it.category}</Pill> : <span style={{ color: '#64748b' }}>—</span>}
                  </td>
                  <td style={{ ...td, maxWidth: 260 }}>
                    {it.tags?.length ? it.tags.map((t) => <Pill key={t} color="#3b0764" fg="#d8b4fe">{t}</Pill>) : <span style={{ color: '#64748b' }}>—</span>}
                  </td>
                  <td style={td}>
                    <code style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: '#0f172a', color: '#a5b4fc' }}>
                      {STATUS_LABEL[it.status] ?? it.status}
                    </code>
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button
                      style={btn}
                      disabled={!!busyId[it.id] || isEditing}
                      title="清空分类 + 下游所有字段，从 INGESTED 重跑（PUBLISHED 会触发 ISR 失效）"
                      onClick={() => retrigger('reclassify', it)}>
                      {busyId[it.id] ? '…' : '重新分类'}
                    </button>{' '}
                    <button
                      style={btn}
                      disabled={!!busyId[it.id] || isEditing}
                      title="保留分类，重跑标题 + 下游（cover/compliance/published 会清空重做）"
                      onClick={() => retrigger('retitle', it)}>
                      {busyId[it.id] ? '…' : '重新标题'}
                    </button>
                  </td>
                </tr>
                );
              })}
              {visibleItems.length === 0 && (
                <tr>
                  <td style={{ ...td, color: '#64748b' }} colSpan={5}>
                    {loadingItems
                      ? '加载中…'
                      : (filter || categoryFilter)
                        ? `命中 0 条 · 当前筛选：${[filter && (STATUS_LABEL[filter] ?? filter), categoryFilter && `分类=${categoryFilter}`].filter(Boolean).join(' · ')}`
                        : '暂无条目'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {/* Recent runs */}
        <section style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <h3 style={{ margin: 0, padding: 14, fontSize: 13, borderBottom: '1px solid #334155', color: '#cbd5e1', fontWeight: 600 }}>
            最近 Agent 执行记录(classify-title)
          </h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Agent</th>
                <th style={th}>状态</th>
                <th style={th}>耗时</th>
                <th style={th}>成本</th>
                <th style={th}>开始时间</th>
                <th style={th}>错误</th>
              </tr>
            </thead>
            <tbody>
              {(stats?.recent_runs ?? []).map((r) => {
                const label = r.status === 'success' ? '成功' : r.status === 'failed' ? '失败' : '执行中';
                const colors: Record<string, [string, string]> = {
                  success: ['#14532d', '#86efac'], failed: ['#7f1d1d', '#fca5a5'], running: ['#78350f', '#fbbf24'],
                };
                const [bg, fg] = colors[r.status] ?? ['#1e293b', '#94a3b8'];
                return (
                  <tr key={r.id}>
                    <td style={td}><code style={{ fontSize: 11, color: '#a5b4fc' }}>{r.agent}</code></td>
                    <td style={td}>
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600, background: bg, color: fg }}>{label}</span>
                    </td>
                    <td style={{ ...td, color: '#94a3b8' }}>{r.latency_ms ? `${r.latency_ms} ms` : '—'}</td>
                    <td style={{ ...td, color: '#a78bfa' }}>{r.cost_usd ? `$${Number(r.cost_usd).toFixed(6)}` : '—'}</td>
                    <td style={{ ...td, color: '#94a3b8' }}>{new Date(r.started_at).toLocaleString()}</td>
                    <td style={{ ...td, color: '#fca5a5', fontSize: 11, maxWidth: 260, fontFamily: 'ui-monospace, monospace' }}>{r.error ?? ''}</td>
                  </tr>
                );
              })}
              {(stats?.recent_runs?.length ?? 0) === 0 && (
                <tr><td style={{ ...td, color: '#64748b' }} colSpan={6}>暂无执行记录 — 点击上方「批量分类」或「批量生成标题」</td></tr>
              )}
            </tbody>
          </table>
        </section>

        <footer style={{ marginTop: 20, textAlign: 'center', color: '#475569', fontSize: 11 }}>
          每 4 秒自动刷新 · 分类走 Haiku,标题走 Sonnet(通过 CLASSIFICATION_MODEL / TITLE_MODEL 环境变量可改)
        </footer>
      </div>
    </div>
  );
}
