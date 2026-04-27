'use client';

import { useEffect, useState, useCallback } from 'react';
import { AdminNav } from '../../../components/AdminNav';
import { getSprintStart, computeDayLabel } from '../../../lib/sprint';

type Stats = {
  total: number;
  by_status: { status: string; count: number }[];
  covered: number;
  compliance_breakdown: { trigger: string | null; count: number }[];
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
  category: string | null;
  cover_url: string | null;
  cover_sizes: Record<string, string> | null;
  cover_copy: string | null;
  compliance_status: string | null;
  risk_tags: string[];
  compliance_reasons: any;
  source: string;
  updated_at: string;
};

async function getJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

const card: React.CSSProperties = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 12, fontWeight: 600, color: '#6b7280', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' };
const td: React.CSSProperties = { padding: '8px 10px', fontSize: 13, borderBottom: '1px solid #f3f4f6', verticalAlign: 'top' };
const btn: React.CSSProperties = { padding: '6px 12px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer' };
const btnPrimary: React.CSSProperties = { ...btn, background: '#111827', color: '#fff', borderColor: '#111827' };

const STATUS_LABEL: Record<string, string> = {
  INGESTED: '已采集',
  CLASSIFIED: '已分类',
  TITLED: '已生成标题',
  COVERED: '已选封面',
  COMPLIANCE_PASS: '合规通过',
  COMPLIANCE_REVIEW: '待人工复核',
  COMPLIANCE_FAIL: '合规拒绝',
  PUBLISHED: '已发布',
};

const TRIGGER_LABEL: Record<string, string> = {
  pass: 'LLM 通过',
  llm_review: '维度 ≥ 2 复核',
  llm_reject: '维度 ≥ 3 拒绝',
  blacklist: '黑名单命中',
};

function Tile({ label, value, hint, color }: { label: string; value: React.ReactNode; hint?: string; color?: string }) {
  return (
    <div style={card}>
      <div style={{ color: '#6b7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4, color }}>{value}</div>
      {hint && <div style={{ color: '#9ca3af', fontSize: 11, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function ComplianceBadge({ status }: { status: string | null }) {
  if (!status) return <span style={{ color: '#9ca3af' }}>—</span>;
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    COMPLIANCE_PASS: { bg: '#d1fae5', fg: '#065f46', label: '通过' },
    COMPLIANCE_REVIEW: { bg: '#fef3c7', fg: '#92400e', label: '复核' },
    COMPLIANCE_FAIL: { bg: '#fee2e2', fg: '#991b1b', label: '拒绝' },
  };
  const s = map[status];
  if (!s) return <code>{status}</code>;
  return (
    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: s.bg, color: s.fg, fontWeight: 500 }}>
      {s.label}
    </span>
  );
}

export default function Day4Page() {

  const [dayLabel, setDayLabel] = useState('4/23');
  useEffect(() => { setDayLabel(computeDayLabel(getSprintStart(), 4)); }, []);
  const [stats, setStats] = useState<Stats | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const q = filter ? `?status=${encodeURIComponent(filter)}&limit=30` : '?limit=30';
      const [s, it] = await Promise.all([
        getJSON<Stats>('/api/admin/day4/stats'),
        getJSON<{ items: Item[] }>(`/api/admin/day4/items${q}`),
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
    try {
      const r = await getJSON<{ enqueued: number }>(`/api/admin/day4/${path}`, { method: 'POST' });
      setToast(`${label}:已入队 ${r.enqueued} 条`);
      setTimeout(() => setToast(null), 3000);
      await refresh();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function retrigger(kind: 'recover' | 'recheck', id: string) {
    try {
      await getJSON<{ ok: true }>(`/api/admin/day4/${kind}/${id}`, { method: 'POST' });
      setToast(`已重新入队 ${kind}`);
      setTimeout(() => setToast(null), 2000);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  const countByStatus = Object.fromEntries((stats?.by_status ?? []).map((s) => [s.status, s.count]));
  const passCount = countByStatus.COMPLIANCE_PASS ?? 0;
  const reviewCount = countByStatus.COMPLIANCE_REVIEW ?? 0;
  const failCount = countByStatus.COMPLIANCE_FAIL ?? 0;

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif', background: '#f3f4f6', minHeight: '100vh' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>{dayLabel} · 封面与合规</h1>
          <AdminNav current="day4" />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={btn} onClick={() => bulk('cover-all', '封面')}>批量选封面 (TITLED)</button>
          <button style={btnPrimary} onClick={() => bulk('compliance-all', '合规')}>批量合规 (COVERED)</button>
        </div>
      </header>

      {toast && <div style={{ ...card, background: '#f0fdf4', borderColor: '#86efac', color: '#065f46', marginBottom: 12 }}>{toast}</div>}
      {err && <div style={{ ...card, borderColor: '#fca5a5', background: '#fef2f2', color: '#991b1b', marginBottom: 12 }}>⚠ {err}</div>}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 16 }}>
        <Tile label="总条目" value={stats?.total ?? '—'} />
        <Tile label="已选封面" value={stats?.covered ?? '—'} hint={`覆盖率 ${stats?.total ? Math.round(((stats.covered ?? 0) / stats.total) * 100) : 0}%`} />
        <Tile label="合规通过" value={passCount} color="#065f46" />
        <Tile label="待复核" value={reviewCount} color="#92400e" />
        <Tile label="拒绝" value={failCount} color="#991b1b" />
        <Tile label="24h 成本" value={`$${(stats?.cost_last_24h ?? 0).toFixed(4)}`} />
      </section>

      {stats && stats.compliance_breakdown.length > 0 && (
        <section style={{ ...card, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>合规判决归因</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 13 }}>
            {stats.compliance_breakdown.map((c) => (
              <span key={c.trigger ?? 'null'} style={{ padding: '4px 10px', borderRadius: 6, background: '#eef2ff', color: '#3730a3' }}>
                {TRIGGER_LABEL[c.trigger ?? ''] ?? c.trigger ?? '—'} · {c.count}
              </span>
            ))}
          </div>
        </section>
      )}

      <div style={{ marginBottom: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#6b7280' }}>状态筛选:</span>
        {['', 'TITLED', 'COVERED', 'COMPLIANCE_PASS', 'COMPLIANCE_REVIEW', 'COMPLIANCE_FAIL'].map((s) => (
          <button
            key={s || 'all'}
            style={{ ...btn, ...(filter === s ? { background: '#111827', color: '#fff', borderColor: '#111827' } : {}) }}
            onClick={() => setFilter(s)}
          >
            {s === '' ? '全部' : STATUS_LABEL[s] ?? s}
          </button>
        ))}
      </div>

      <section style={{ ...card, padding: 0, marginBottom: 16, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>封面</th>
              <th style={th}>标题 / 来源</th>
              <th style={th}>分类</th>
              <th style={th}>合规</th>
              <th style={th}>风险标签</th>
              <th style={th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const thumb = it.cover_sizes?.thumb ?? it.cover_url;
              return (
                <tr key={it.id}>
                  <td style={{ ...td, width: 110 }}>
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumb}
                        alt=""
                        style={{ width: 96, height: 64, objectFit: 'cover', borderRadius: 4, background: '#f3f4f6' }}
                      />
                    ) : (
                      <div style={{ width: 96, height: 64, background: '#f3f4f6', color: '#9ca3af', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>
                        无图
                      </div>
                    )}
                    {it.cover_copy && <div style={{ fontSize: 11, color: '#4b5563', marginTop: 4 }}>{it.cover_copy}</div>}
                  </td>
                  <td style={{ ...td, maxWidth: 360 }}>
                    <div style={{ fontWeight: 500 }}>{it.title ?? <span style={{ color: '#9ca3af' }}>(无标题)</span>}</div>
                    <div style={{ color: '#9ca3af', fontSize: 11, marginTop: 4 }}>
                      {it.source} · {STATUS_LABEL[it.status] ?? it.status}
                    </div>
                  </td>
                  <td style={td}>
                    {it.category ? (
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#dbeafe' }}>{it.category}</span>
                    ) : (
                      <span style={{ color: '#9ca3af' }}>—</span>
                    )}
                  </td>
                  <td style={td}>
                    <ComplianceBadge status={it.compliance_status ?? it.status} />
                    {it.compliance_reasons?.maxScore >= 0 && (
                      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                        最高分 {it.compliance_reasons.maxScore}
                      </div>
                    )}
                  </td>
                  <td style={{ ...td, maxWidth: 200 }}>
                    {(it.risk_tags ?? []).length > 0
                      ? it.risk_tags.map((t) => (
                          <span key={t} style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: '#fee2e2', color: '#991b1b', marginRight: 4 }}>
                            {t}
                          </span>
                        ))
                      : '—'}
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button style={btn} onClick={() => retrigger('recover', it.id)}>重选封面</button>{' '}
                    <button style={btn} onClick={() => retrigger('recheck', it.id)}>重跑合规</button>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr><td style={td} colSpan={6}>暂无条目</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <h3 style={{ margin: 0, padding: 14, fontSize: 14, borderBottom: '1px solid #e5e7eb' }}>
          最近 Agent 执行记录(cover + compliance)
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
                  <td style={td}><code style={{ fontSize: 11 }}>{r.agent}</code></td>
                  <td style={td}>
                    <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: r.status === 'success' ? '#d1fae5' : r.status === 'failed' ? '#fee2e2' : '#fef3c7', color: r.status === 'success' ? '#065f46' : r.status === 'failed' ? '#991b1b' : '#92400e' }}>
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
              <tr><td style={td} colSpan={6}>暂无执行记录</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <footer style={{ marginTop: 16, textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>
        每 4 秒自动刷新 · 封面 Haiku,合规 Sonnet(COMPLIANCE_MODEL 可切)
      </footer>
    </main>
  );
}
