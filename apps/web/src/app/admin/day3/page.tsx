'use client';

import { useEffect, useState, useCallback } from 'react';
import { AdminNav } from '../../../components/AdminNav';
import { getSprintStart, computeDayLabel } from '../../../lib/sprint';

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
const btnPrimary: React.CSSProperties = {
  ...btn,
  background: '#111827',
  color: '#fff',
  borderColor: '#111827',
};

const STATUS_LABEL: Record<string, string> = {
  INGESTED: '已采集',
  CLASSIFIED: '已分类',
  TITLED: '已生成标题',
  COVERED: '已选封面',
  COMPLIANCE_PASS: '合规通过',
  COMPLIANCE_FAIL: '合规拒绝',
  PUBLISHED: '已发布',
  DISTRIBUTED: '已分发',
};

function Tile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div style={card}>
      <div style={{ color: '#6b7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {hint && <div style={{ color: '#9ca3af', fontSize: 11, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function Pill({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      style={{
        fontSize: 11,
        padding: '2px 8px',
        borderRadius: 10,
        background: color ?? '#e5e7eb',
        color: '#111827',
        marginRight: 4,
      }}
    >
      {children}
    </span>
  );
}

export default function Day3Page() {

  const [dayLabel, setDayLabel] = useState('4/22');
  useEffect(() => { setDayLabel(computeDayLabel(getSprintStart(), 3)); }, []);
  const [stats, setStats] = useState<Stats | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const q = filter ? `?status=${encodeURIComponent(filter)}&limit=30` : '?limit=30';
      const [s, it] = await Promise.all([
        getJSON<Stats>('/api/admin/day3/stats'),
        getJSON<{ items: Item[] }>(`/api/admin/day3/items${q}`),
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
      const r = await getJSON<{ enqueued: number }>(`/api/admin/day3/${path}`, { method: 'POST' });
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
    try {
      await getJSON<{ ok: true }>(`/api/admin/day3/${kind}/${id}`, { method: 'POST' });
      setToast(`已重新入队 ${kind}`);
      setTimeout(() => setToast(null), 2000);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  const countByStatus = Object.fromEntries(
    (stats?.by_status ?? []).map((s) => [s.status, s.count]),
  );
  const classifiedTotal =
    (countByStatus.CLASSIFIED ?? 0) +
    (countByStatus.TITLED ?? 0) +
    (countByStatus.COVERED ?? 0) +
    (countByStatus.COMPLIANCE_PASS ?? 0) +
    (countByStatus.PUBLISHED ?? 0);
  const titledTotal =
    (countByStatus.TITLED ?? 0) +
    (countByStatus.COVERED ?? 0) +
    (countByStatus.COMPLIANCE_PASS ?? 0) +
    (countByStatus.PUBLISHED ?? 0);

  return (
    <main
      style={{
        maxWidth: 1200,
        margin: '0 auto',
        padding: 24,
        fontFamily: 'system-ui, sans-serif',
        background: '#f3f4f6',
        minHeight: '100vh',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 16,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>{dayLabel} · 分类与标题</h1>
          <AdminNav current="day3" />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={btn} disabled={busy} onClick={() => bulk('classify-all', '分类')}>
            批量分类 (INGESTED)
          </button>
          <button style={btnPrimary} disabled={busy} onClick={() => bulk('title-all', '标题')}>
            批量生成标题 (CLASSIFIED)
          </button>
        </div>
      </header>

      {toast && (
        <div
          style={{
            ...card,
            background: '#f0fdf4',
            borderColor: '#86efac',
            color: '#065f46',
            marginBottom: 12,
          }}
        >
          {toast}
        </div>
      )}
      {err && (
        <div
          style={{
            ...card,
            borderColor: '#fca5a5',
            background: '#fef2f2',
            color: '#991b1b',
            marginBottom: 12,
          }}
        >
          ⚠ {err}
        </div>
      )}

      {/* Tiles */}
      <section
        style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 16 }}
      >
        <Tile label="总条目" value={stats?.total ?? '—'} />
        <Tile
          label="已分类"
          value={classifiedTotal}
          hint={`覆盖率 ${stats?.total ? Math.round((classifiedTotal / stats.total) * 100) : 0}%`}
        />
        <Tile
          label="已生成标题"
          value={titledTotal}
          hint={`覆盖率 ${stats?.total ? Math.round((titledTotal / stats.total) * 100) : 0}%`}
        />
        <Tile label="24h 成本" value={`$${(stats?.cost_last_24h ?? 0).toFixed(4)}`} />
        <Tile label="待处理队列" value={(countByStatus.INGESTED ?? 0) + (countByStatus.CLASSIFIED ?? 0)} hint="INGESTED + CLASSIFIED" />
      </section>

      {/* Category distribution */}
      {stats && stats.by_category.length > 0 && (
        <section style={{ ...card, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>分类分布</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {stats.by_category.map((c) => (
              <Pill key={c.category} color="#dbeafe">
                {c.category} · {c.count}
              </Pill>
            ))}
          </div>
        </section>
      )}

      {/* Status filter */}
      <div style={{ marginBottom: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#6b7280' }}>状态筛选:</span>
        {['', 'INGESTED', 'CLASSIFIED', 'TITLED'].map((s) => (
          <button
            key={s || 'all'}
            style={{ ...btn, ...(filter === s ? { background: '#111827', color: '#fff', borderColor: '#111827' } : {}) }}
            onClick={() => setFilter(s)}
          >
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
                      <a href={it.url} target="_blank" rel="noreferrer" style={{ color: '#111827', textDecoration: 'none' }}>
                        {it.title}
                      </a>
                    ) : (
                      <span style={{ color: '#9ca3af' }}>(无标题)</span>
                    )}
                  </div>
                  {it.summary && (
                    <div style={{ color: '#4b5563', fontSize: 12, lineHeight: 1.5 }}>
                      {it.summary}
                    </div>
                  )}
                  <div style={{ color: '#9ca3af', fontSize: 11, marginTop: 4 }}>
                    {it.source} · {it.slug ?? '—'}
                  </div>
                </td>
                <td style={td}>
                  {it.category ? <Pill color="#dbeafe">{it.category}</Pill> : <span style={{ color: '#9ca3af' }}>—</span>}
                </td>
                <td style={{ ...td, maxWidth: 260 }}>
                  {it.tags?.length ? (
                    it.tags.map((t) => <Pill key={t} color="#f3e8ff">{t}</Pill>)
                  ) : (
                    <span style={{ color: '#9ca3af' }}>—</span>
                  )}
                </td>
                <td style={td}>
                  <code style={{ fontSize: 11 }}>{STATUS_LABEL[it.status] ?? it.status}</code>
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  <button style={btn} onClick={() => retrigger('reclassify', it.id)}>重新分类</button>{' '}
                  <button style={btn} onClick={() => retrigger('retitle', it.id)}>重起标题</button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td style={td} colSpan={5}>
                  暂无条目
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Recent runs */}
      <section style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <h3 style={{ margin: 0, padding: 14, fontSize: 14, borderBottom: '1px solid #e5e7eb' }}>
          最近 Agent 执行记录(classification + title)
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
              return (
                <tr key={r.id}>
                  <td style={td}>
                    <code style={{ fontSize: 11 }}>{r.agent}</code>
                  </td>
                  <td style={td}>
                    <span
                      style={{
                        fontSize: 11,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background:
                          r.status === 'success' ? '#d1fae5' : r.status === 'failed' ? '#fee2e2' : '#fef3c7',
                        color:
                          r.status === 'success' ? '#065f46' : r.status === 'failed' ? '#991b1b' : '#92400e',
                      }}
                    >
                      {label}
                    </span>
                  </td>
                  <td style={td}>{r.latency_ms ? `${r.latency_ms} ms` : '—'}</td>
                  <td style={td}>{r.cost_usd ? `$${Number(r.cost_usd).toFixed(6)}` : '—'}</td>
                  <td style={td}>{new Date(r.started_at).toLocaleString()}</td>
                  <td style={{ ...td, color: '#991b1b', fontSize: 11, maxWidth: 260 }}>{r.error ?? ''}</td>
                </tr>
              );
            })}
            {(stats?.recent_runs?.length ?? 0) === 0 && (
              <tr>
                <td style={td} colSpan={6}>
                  暂无执行记录 — 点击上方「批量分类」或「批量生成标题」
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <footer style={{ marginTop: 16, textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>
        每 4 秒自动刷新 · 分类走 Haiku,标题走 Sonnet(通过 CLASSIFICATION_MODEL / TITLE_MODEL 环境变量可改)
      </footer>
    </main>
  );
}
