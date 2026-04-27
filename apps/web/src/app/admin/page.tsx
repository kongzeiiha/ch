'use client';

import { useEffect, useState, useCallback } from 'react';
import { AdminNav } from '../../components/AdminNav';
import { getSprintStart, computeDayLabel } from '../../lib/sprint';

type Source = {
  id: string;
  platform: string;
  external_id: string;
  name: string;
  url: string | null;
  status: string;
  score: number;
  last_fetch_at: string | null;
};

type Stats = {
  sources: number;
  raw_items: number;
  items_by_status: { status: string; count: number }[];
  recent_runs: {
    id: string;
    agent: string;
    status: string;
    latency_ms: number | null;
    cost_usd: string | null;
    started_at: string;
    finished_at: string | null;
    error: string | null;
  }[];
};

type Item = {
  id: string;
  status: string;
  title: string | null;
  slug: string | null;
  category: string | null;
  source: string;
  url: string;
  created_at: string;
};

type IngestResult = {
  mode: 'sync' | 'async';
  jobId?: string;
  stats?: {
    candidates: number;
    ingested: number;
    dupUrl: number;
    dupContent: number;
    cleanFail: number;
    errors: number;
  };
};

async function getJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 16,
};
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  fontSize: 12,
  fontWeight: 600,
  color: '#6b7280',
  borderBottom: '1px solid #e5e7eb',
  background: '#f9fafb',
};
const td: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: 13,
  borderBottom: '1px solid #f3f4f6',
  verticalAlign: 'top',
};
const btn: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 12,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
  cursor: 'pointer',
};
const btnPrimary: React.CSSProperties = { ...btn, background: '#111827', color: '#fff', borderColor: '#111827' };

export default function AdminDashboard() {
  const [dayLabel, setDayLabel] = useState('4/21');
  const [d3Label, setD3Label] = useState('4/22');
  const [d5Label, setD5Label] = useState('4/24');
  useEffect(() => {
    const s = getSprintStart();
    setDayLabel(computeDayLabel(s, 2));
    setD3Label(computeDayLabel(s, 3));
    setD5Label(computeDayLabel(s, 5));
  }, []);
  const [sources, setSources] = useState<Source[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [lastResult, setLastResult] = useState<{ srcId: string; res: IngestResult } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, st, it] = await Promise.all([
        getJSON<{ sources: Source[] }>('/api/admin/sources'),
        getJSON<Stats>('/api/admin/stats'),
        getJSON<{ items: Item[] }>('/api/admin/items?limit=20'),
      ]);
      setSources(s.sources);
      setStats(st);
      setItems(it.items);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5_000);
    return () => clearInterval(t);
  }, [refresh]);

  async function ingest(sourceId: string, mode: 'sync' | 'async') {
    setBusy((b) => ({ ...b, [sourceId]: true }));
    try {
      const url = mode === 'async'
        ? `/api/admin/ingest/${sourceId}?async=1`
        : `/api/admin/ingest/${sourceId}`;
      const res = await getJSON<IngestResult>(url, { method: 'POST' });
      setLastResult({ srcId: sourceId, res });
      await refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy((b) => ({ ...b, [sourceId]: false }));
    }
  }

  async function fanout() {
    try {
      const r = await getJSON<{ jobId: string }>('/api/admin/ingest/fanout', { method: 'POST' });
      setLastResult({ srcId: 'all', res: { mode: 'async', jobId: r.jobId } });
      await refresh();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  const countByStatus = Object.fromEntries(
    (stats?.items_by_status ?? []).map((s) => [s.status, s.count]),
  );

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif', background: '#f3f4f6', minHeight: '100vh' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>{dayLabel} · 采集总览</h1>
          <AdminNav current="day2" />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={btn} onClick={refresh}>刷新</button>
          <button style={btnPrimary} onClick={fanout}>全量采集(异步)</button>
        </div>
      </header>

      {err && (
        <div style={{ ...card, borderColor: '#fca5a5', background: '#fef2f2', color: '#991b1b', marginBottom: 16 }}>
          ⚠ {err}
        </div>
      )}

      {/* Stats tiles */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 16 }}>
        <Tile label="账号源数" value={stats?.sources ?? '—'} />
        <Tile label="原始条目" value={stats?.raw_items ?? '—'} />
        <Tile label="已采集" value={countByStatus.INGESTED ?? 0} />
        <Tile label="已分类" value={countByStatus.CLASSIFIED ?? 0} hint={d3Label} />
        <Tile label="已发布" value={countByStatus.PUBLISHED ?? 0} hint={d5Label} />
      </section>

      {/* Last ingest result */}
      {lastResult?.res?.stats && (
        <section style={{ ...card, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>
            本次采集结果 · 账号源 <code>{lastResult.srcId.slice(0, 8)}…</code>
          </h3>
          <div style={{ display: 'flex', gap: 16, fontSize: 13, flexWrap: 'wrap' }}>
            <span>候选:<b>{lastResult.res.stats.candidates}</b></span>
            <span style={{ color: '#059669' }}>入库:<b>{lastResult.res.stats.ingested}</b></span>
            <span style={{ color: '#d97706' }}>URL 重复:<b>{lastResult.res.stats.dupUrl}</b></span>
            <span style={{ color: '#d97706' }}>内容相似:<b>{lastResult.res.stats.dupContent}</b></span>
            <span style={{ color: '#6b7280' }}>清洗失败:<b>{lastResult.res.stats.cleanFail}</b></span>
            <span style={{ color: '#dc2626' }}>错误:<b>{lastResult.res.stats.errors}</b></span>
          </div>
        </section>
      )}

      {/* Sources */}
      <section style={{ ...card, padding: 0, marginBottom: 16, overflow: 'hidden' }}>
        <h3 style={{ margin: 0, padding: 14, fontSize: 14, borderBottom: '1px solid #e5e7eb' }}>账号源</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>名称</th>
              <th style={th}>类型</th>
              <th style={th}>状态</th>
              <th style={th}>评分</th>
              <th style={th}>上次采集</th>
              <th style={th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id}>
                <td style={td}>
                  <div style={{ fontWeight: 500 }}>{s.name}</div>
                  <div style={{ color: '#6b7280', fontSize: 11 }}>{s.external_id}</div>
                </td>
                <td style={td}>{s.platform}</td>
                <td style={td}>
                  <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: s.status === 'active' ? '#d1fae5' : '#fee2e2', color: s.status === 'active' ? '#065f46' : '#991b1b' }}>
                    {s.status === 'active' ? '启用' : s.status}
                  </span>
                </td>
                <td style={td}>{s.score}</td>
                <td style={td}>{s.last_fetch_at ? new Date(s.last_fetch_at).toLocaleString() : '—'}</td>
                <td style={{ ...td, display: 'flex', gap: 6 }}>
                  <button style={btn} disabled={!!busy[s.id]} onClick={() => ingest(s.id, 'sync')}>
                    {busy[s.id] ? '采集中…' : '立即采集'}
                  </button>
                  <button style={btn} disabled={!!busy[s.id]} onClick={() => ingest(s.id, 'async')}>
                    入队
                  </button>
                </td>
              </tr>
            ))}
            {sources.length === 0 && (
              <tr>
                <td style={td} colSpan={6}>暂无账号源 — 请执行 <code>pnpm seed</code></td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Recent items */}
      <section style={{ ...card, padding: 0, marginBottom: 16, overflow: 'hidden' }}>
        <h3 style={{ margin: 0, padding: 14, fontSize: 14, borderBottom: '1px solid #e5e7eb' }}>
          最新条目({items.length})
        </h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>标题</th>
              <th style={th}>来源</th>
              <th style={th}>状态</th>
              <th style={th}>创建时间</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td style={td}>
                  <a href={it.url} target="_blank" rel="noreferrer" style={{ color: '#2563eb', textDecoration: 'none' }}>
                    {it.title || <span style={{ color: '#9ca3af' }}>(无标题)</span>}
                  </a>
                </td>
                <td style={td}>{it.source}</td>
                <td style={td}>
                  <code style={{ fontSize: 11 }}>{it.status}</code>
                </td>
                <td style={td}>{new Date(it.created_at).toLocaleString()}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td style={td} colSpan={4}>暂无条目</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Agent runs */}
      <section style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <h3 style={{ margin: 0, padding: 14, fontSize: 14, borderBottom: '1px solid #e5e7eb' }}>
          Agent 执行记录
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
              const label = r.status === 'success' ? '成功' : r.status === 'failed' ? '失败' : r.status === 'running' ? '执行中' : r.status;
              return (
                <tr key={r.id}>
                  <td style={td}><code style={{ fontSize: 11 }}>{r.agent}</code></td>
                  <td style={td}>
                    <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: r.status === 'success' ? '#d1fae5' : r.status === 'failed' ? '#fee2e2' : '#fef3c7', color: r.status === 'success' ? '#065f46' : r.status === 'failed' ? '#991b1b' : '#92400e' }}>
                      {label}
                    </span>
                  </td>
                  <td style={td}>{r.latency_ms ? `${r.latency_ms} ms` : '—'}</td>
                  <td style={td}>{r.cost_usd ? `$${Number(r.cost_usd).toFixed(4)}` : '—'}</td>
                  <td style={td}>{new Date(r.started_at).toLocaleString()}</td>
                  <td style={{ ...td, color: '#991b1b', fontSize: 11, maxWidth: 260 }}>{r.error ?? ''}</td>
                </tr>
              );
            })}
            {(stats?.recent_runs?.length ?? 0) === 0 && (
              <tr><td style={td} colSpan={6}>暂无异步执行记录 — 点击账号行的「入队」或右上角「全量采集」</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <footer style={{ marginTop: 16, textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>
        每 5 秒自动刷新 · API 通过 /api/* 代理到 :4000
      </footer>
    </main>
  );
}

function Tile({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div style={card}>
      <div style={{ color: '#6b7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {hint && <div style={{ color: '#9ca3af', fontSize: 10, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}
