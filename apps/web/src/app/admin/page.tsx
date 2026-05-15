'use client';

import { useEffect, useState, useCallback } from 'react';
import { AdminNav } from '../../components/AdminNav';
import Link from 'next/link';

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

// Dark theme palette aligned with /workbench:
//   page bg     #0f172a (slate-900)
//   sticky bar  #020617
//   card        #1e293b w/ border #3e4144
//   text        #e7e9ea (main) · #71767b (mute) · #71767b (faint)
//   accent      #6366f1 (indigo)
const card: React.CSSProperties = {
  background: '#1e293b',
  border: '1px solid #3e4144',
  borderRadius: 8,
  padding: 16,
};
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontSize: 11,
  fontWeight: 600,
  color: '#71767b',
  borderBottom: '1px solid #3e4144',
  background: '#0f172a',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};
const td: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 13,
  borderBottom: '1px solid #3e4144',
  verticalAlign: 'top',
  color: '#e7e9ea',
};
const btn: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 12,
  border: '1px solid #3e4144',
  borderRadius: 6,
  background: 'transparent',
  color: '#71767b',
  cursor: 'pointer',
};
const btnPrimary: React.CSSProperties = {
  ...btn, background: '#6366f1', color: '#fff', borderColor: '#6366f1', fontWeight: 600,
};

export default function AdminDashboard() {
  const [sources, setSources] = useState<Source[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [itemsTotal, setItemsTotal] = useState(0);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [fanoutBusy, setFanoutBusy] = useState(false);
  const [lastResult, setLastResult] = useState<{ srcId: string; res: IngestResult } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const offset = (page - 1) * pageSize;
      const [s, st, it] = await Promise.all([
        getJSON<{ sources: Source[] }>('/api/admin/sources'),
        getJSON<Stats>('/api/admin/stats'),
        getJSON<{ items: Item[]; total: number }>(`/api/admin/items?limit=${pageSize}&offset=${offset}`),
      ]);
      setSources(s.sources);
      setStats(st);
      setItems(it.items);
      setItemsTotal(it.total ?? 0);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    }
  }, [page, pageSize]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5_000);
    return () => clearInterval(t);
  }, [refresh]);

  const totalPages = Math.max(1, Math.ceil(itemsTotal / pageSize));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

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
    setFanoutBusy(true);
    try {
      const r = await getJSON<{ jobId: string }>('/api/admin/ingest/fanout', { method: 'POST' });
      setLastResult({ srcId: 'all', res: { mode: 'async', jobId: r.jobId } });
      await refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setFanoutBusy(false);
    }
  }

  const countByStatus = Object.fromEntries(
    (stats?.items_by_status ?? []).map((s) => [s.status, s.count]),
  );

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e7e9ea', fontFamily: 'system-ui, -apple-system, PingFang SC, sans-serif' }}>

      {/* Sticky top bar — same heights & spacing as the workbench */}
      <header style={{ background: '#020617', borderBottom: '1px solid #1e293b', padding: '0 24px', height: 52, display: 'flex', alignItems: 'center', gap: 16, position: 'sticky', top: 0, zIndex: 100 }}>
        <span style={{ color: '#e7e9ea', fontSize: 16, fontWeight: 800 }}>内容中台</span>
        <span style={{ color: '#3e4144' }}>/</span>
        <span style={{ fontSize: 13, color: '#71767b' }}>采集总览</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Link href="/workbench" style={{ ...btn, textDecoration: 'none', color: '#e7e9ea', display: 'inline-flex', alignItems: 'center' }}>← 工作台</Link><button style={btn} onClick={refresh}>↻ 刷新</button>
          <button style={btnPrimary} disabled={fanoutBusy} onClick={fanout}>{fanoutBusy ? '入队中…' : '全量采集(异步)'}</button>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 20px 60px' }}>
        <AdminNav current="ingestion" />

        {err && (
          <div style={{ ...card, borderColor: '#7f1d1d', background: '#450a0a', color: '#fca5a5', marginBottom: 16, fontSize: 13 }}>
            ⚠ {err}
          </div>
        )}

        {/* Stats tiles */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 16 }}>
          <Tile label="账号源数" value={stats?.sources ?? '—'} />
          <Tile label="原始条目" value={stats?.raw_items ?? '—'} />
          <Tile label="已采集" value={countByStatus.INGESTED ?? 0} accent="#0ea5e9" />
          <Tile label="已分类" value={countByStatus.CLASSIFIED ?? 0} accent="#a78bfa" />
          <Tile label="已发布" value={countByStatus.PUBLISHED ?? 0} accent="#22c55e" />
        </section>

        {/* Last ingest result */}
        {lastResult?.res?.stats && (
          <section style={{ ...card, marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 13, color: '#a5b4fc', fontWeight: 600 }}>
              本次采集结果 · 账号源 <code style={{ background: '#0f172a', padding: '1px 6px', borderRadius: 3, fontSize: 11 }}>{lastResult.srcId.slice(0, 8)}…</code>
            </h3>
            <div style={{ display: 'flex', gap: 16, fontSize: 13, flexWrap: 'wrap', color: '#e7e9ea' }}>
              <span>候选:<b>{lastResult.res.stats.candidates}</b></span>
              <span style={{ color: '#22c55e' }}>入库:<b>{lastResult.res.stats.ingested}</b></span>
              <span style={{ color: '#fbbf24' }}>URL 重复:<b>{lastResult.res.stats.dupUrl}</b></span>
              <span style={{ color: '#fbbf24' }}>内容相似:<b>{lastResult.res.stats.dupContent}</b></span>
              <span style={{ color: '#71767b' }}>清洗失败:<b>{lastResult.res.stats.cleanFail}</b></span>
              <span style={{ color: '#f87171' }}>错误:<b>{lastResult.res.stats.errors}</b></span>
            </div>
          </section>
        )}

        {/* Sources */}
        <section style={{ ...card, padding: 0, marginBottom: 16, overflow: 'hidden' }}>
          <h3 style={{ margin: 0, padding: 14, fontSize: 13, borderBottom: '1px solid #3e4144', color: '#e7e9ea', fontWeight: 600 }}>账号源</h3>
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
                    <div style={{ color: '#71767b', fontSize: 11, marginTop: 2 }}>{s.external_id}</div>
                  </td>
                  <td style={td}>
                    <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 6, background: '#0ea5e933', color: '#7dd3fc' }}>{s.platform}</span>
                  </td>
                  <td style={td}>
                    <span style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
                      background: s.status === 'active' ? '#14532d' : '#7f1d1d',
                      color: s.status === 'active' ? '#86efac' : '#fca5a5',
                    }}>
                      {s.status === 'active' ? '启用' : s.status}
                    </span>
                  </td>
                  <td style={{ ...td, color: '#fbbf24', fontWeight: 600 }}>{s.score}</td>
                  <td style={{ ...td, color: '#71767b' }}>{s.last_fetch_at ? new Date(s.last_fetch_at).toLocaleString() : '—'}</td>
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
                  <td style={{ ...td, color: '#71767b' }} colSpan={6}>
                    暂无账号源 — 请执行 <code style={{ background: '#0f172a', padding: '1px 6px', borderRadius: 3 }}>pnpm seed</code>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {/* Recent items */}
        <section style={{ ...card, padding: 0, marginBottom: 16, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottom: '1px solid #3e4144' }}>
            <h3 style={{ margin: 0, fontSize: 13, color: '#e7e9ea', fontWeight: 600 }}>
              采集预览 <span style={{ color: '#71767b', fontWeight: 400, marginLeft: 6 }}>共 {itemsTotal} 条 · 第 {page}/{totalPages} 页</span>
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <label style={{ color: '#71767b' }}>
                每页
                <select
                  value={pageSize}
                  onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                  style={{ marginLeft: 4, padding: '3px 6px', fontSize: 12, border: '1px solid #3e4144', borderRadius: 4, background: '#0f172a', color: '#e7e9ea', colorScheme: 'dark' }}
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
              <button style={btn} disabled={page <= 1} onClick={() => setPage(1)}>« 首页</button>
              <button style={btn} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ 上一页</button>
              <button style={btn} disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>下一页 ›</button>
              <button style={btn} disabled={page >= totalPages} onClick={() => setPage(totalPages)}>末页 »</button>
            </div>
          </div>
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
                    <a href={it.url} target="_blank" rel="noreferrer" style={{ color: '#60a5fa', textDecoration: 'none' }}>
                      {it.title || <span style={{ color: '#71767b' }}>(无标题)</span>}
                    </a>
                  </td>
                  <td style={{ ...td, color: '#71767b' }}>{it.source}</td>
                  <td style={td}>
                    <code style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: '#0f172a', color: '#a5b4fc' }}>{it.status}</code>
                  </td>
                  <td style={{ ...td, color: '#71767b' }}>{new Date(it.created_at).toLocaleString()}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td style={{ ...td, color: '#71767b' }} colSpan={4}>暂无条目</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {/* Agent runs */}
        <section style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <h3 style={{ margin: 0, padding: 14, fontSize: 13, borderBottom: '1px solid #3e4144', color: '#e7e9ea', fontWeight: 600 }}>
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
                const colors: Record<string, [string, string]> = {
                  success: ['#14532d', '#86efac'],
                  failed:  ['#7f1d1d', '#fca5a5'],
                  running: ['#78350f', '#fbbf24'],
                };
                const [bg, fg] = colors[r.status] ?? ['#1e293b', '#71767b'];
                return (
                  <tr key={r.id}>
                    <td style={td}><code style={{ fontSize: 11, color: '#a5b4fc' }}>{r.agent}</code></td>
                    <td style={td}>
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600, background: bg, color: fg }}>
                        {label}
                      </span>
                    </td>
                    <td style={{ ...td, color: '#71767b' }}>{r.latency_ms ? `${r.latency_ms} ms` : '—'}</td>
                    <td style={{ ...td, color: '#a78bfa' }}>{r.cost_usd ? `$${Number(r.cost_usd).toFixed(4)}` : '—'}</td>
                    <td style={{ ...td, color: '#71767b' }}>{new Date(r.started_at).toLocaleString()}</td>
                    <td style={{ ...td, color: '#fca5a5', fontSize: 11, maxWidth: 260, fontFamily: 'ui-monospace, monospace' }}>{r.error ?? ''}</td>
                  </tr>
                );
              })}
              {(stats?.recent_runs?.length ?? 0) === 0 && (
                <tr><td style={{ ...td, color: '#71767b' }} colSpan={6}>暂无异步执行记录 — 点击账号行的「入队」或右上角「全量采集」</td></tr>
              )}
            </tbody>
          </table>
        </section>

        <footer style={{ marginTop: 20, textAlign: 'center', color: '#475569', fontSize: 11 }}>
          每 5 秒自动刷新 · API 通过 /api/* 代理到 :4000
        </footer>
      </div>
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div style={card}>
      <div style={{ color: '#71767b', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, marginTop: 6, color: accent ?? '#e7e9ea' }}>{value}</div>
    </div>
  );
}
