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
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const q = filter ? `?status=${encodeURIComponent(filter)}&limit=30` : '?limit=30';
      const [s, it] = await Promise.all([
        getJSON<Stats>('/api/admin/classify-title/stats'),
        getJSON<{ items: Item[] }>(`/api/admin/classify-title/items${q}`),
      ]);
      setStats(s);
      setItems(it.items);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    }
  }, [filter]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4_000);
    return () => clearInterval(t);
  }, [refresh]);

  async function bulk(path: string, label: string) {
    setBusy(true);
    try {
      const r = await getJSON<{ enqueued: number }>(`/api/admin/classify-title/${path}`, { method: 'POST' });
      setToast(`${label}:已入队 ${r.enqueued} 条`);
      setTimeout(() => setToast(null), 3000);
      await refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function retrigger(kind: 'reclassify' | 'retitle', id: string) {
    setBusyId((b) => ({ ...b, [id]: true }));
    try {
      await getJSON<{ ok: true }>(`/api/admin/classify-title/${kind}/${id}`, { method: 'POST' });
      setToast(`已重新入队 ${kind}`);
      setTimeout(() => setToast(null), 2000);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusyId((b) => ({ ...b, [id]: false }));
    }
  }

  const countByStatus = Object.fromEntries((stats?.by_status ?? []).map((s) => [s.status, s.count]));
  const classifiedTotal = (countByStatus.CLASSIFIED ?? 0) + (countByStatus.TITLED ?? 0) + (countByStatus.COVERED ?? 0) + (countByStatus.COMPLIANCE_PASS ?? 0) + (countByStatus.PUBLISHED ?? 0);
  const titledTotal = (countByStatus.TITLED ?? 0) + (countByStatus.COVERED ?? 0) + (countByStatus.COMPLIANCE_PASS ?? 0) + (countByStatus.PUBLISHED ?? 0);

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

        {/* Category distribution */}
        {stats && stats.by_category.length > 0 && (
          <section style={{ ...card, marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 13, color: '#cbd5e1', fontWeight: 600 }}>分类分布</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {stats.by_category.map((c) => (
                <Pill key={c.category} color="#1e3a8a" fg="#93c5fd">{c.category} · {c.count}</Pill>
              ))}
            </div>
          </section>
        )}

        {/* Status filter */}
        <div style={{ marginBottom: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#64748b' }}>状态筛选:</span>
          {['', 'INGESTED', 'CLASSIFIED', 'TITLED'].map((s) => (
            <button key={s || 'all'}
              style={{ ...btn, ...(filter === s ? { background: '#6366f1', color: '#fff', borderColor: '#6366f1' } : {}) }}
              onClick={() => setFilter(s)}>
              {s === '' ? '全部' : STATUS_LABEL[s] ?? s}
            </button>
          ))}
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
              {items.map((it) => (
                <tr key={it.id}>
                  <td style={{ ...td, maxWidth: 380 }}>
                    <div style={{ fontWeight: 500, marginBottom: 2 }}>
                      {it.title ? (
                        <a href={it.url} target="_blank" rel="noreferrer" style={{ color: '#e2e8f0', textDecoration: 'none' }}>{it.title}</a>
                      ) : (
                        <span style={{ color: '#64748b' }}>(无标题)</span>
                      )}
                    </div>
                    {it.summary && <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.5 }}>{it.summary}</div>}
                    <div style={{ color: '#475569', fontSize: 11, marginTop: 4 }}>{it.source} · {it.slug ?? '—'}</div>
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
                    <button style={btn} disabled={!!busyId[it.id]} onClick={() => retrigger('reclassify', it.id)}>{busyId[it.id] ? '…' : '重新分类'}</button>{' '}
                    <button style={btn} disabled={!!busyId[it.id]} onClick={() => retrigger('retitle', it.id)}>{busyId[it.id] ? '…' : '重起标题'}</button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td style={{ ...td, color: '#64748b' }} colSpan={5}>暂无条目</td></tr>
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
