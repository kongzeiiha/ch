'use client';

import { useEffect, useState, useCallback } from 'react';
import { AdminNav } from '../../../components/AdminNav';
import Link from 'next/link';

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

const card: React.CSSProperties = { background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: 16 };
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600, color: '#94a3b8', borderBottom: '1px solid #334155', background: '#0f172a', textTransform: 'uppercase', letterSpacing: 0.4 };
const td: React.CSSProperties = { padding: '10px 12px', fontSize: 13, borderBottom: '1px solid #334155', verticalAlign: 'top', color: '#e2e8f0' };
const btn: React.CSSProperties = { padding: '6px 12px', fontSize: 12, border: '1px solid #334155', borderRadius: 6, background: 'transparent', color: '#94a3b8', cursor: 'pointer' };
const btnPrimary: React.CSSProperties = { ...btn, background: '#6366f1', color: '#fff', borderColor: '#6366f1', fontWeight: 600 };

const STATUS_LABEL: Record<string, string> = {
  INGESTED: '已采集', CLASSIFIED: '已分类', TITLED: '已生成标题', COVERED: '已选封面',
  COMPLIANCE_PASS: '合规通过', COMPLIANCE_REVIEW: '待人工复核', COMPLIANCE_FAIL: '合规拒绝', PUBLISHED: '已发布', DISTRIBUTED: '已分发',
};

const TRIGGER_LABEL: Record<string, string> = {
  pass: 'LLM 通过', llm_review: '维度 ≥ 2 复核', llm_reject: '维度 ≥ 3 拒绝', blacklist: '黑名单命中',
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

function ComplianceBadge({ status }: { status: string | null }) {
  if (!status) return <span style={{ color: '#64748b' }}>—</span>;
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    COMPLIANCE_PASS: { bg: '#14532d', fg: '#86efac', label: '通过' },
    COMPLIANCE_REVIEW: { bg: '#78350f', fg: '#fbbf24', label: '复核' },
    COMPLIANCE_FAIL: { bg: '#7f1d1d', fg: '#fca5a5', label: '拒绝' },
  };
  const s = map[status];
  if (!s) return <code style={{ fontSize: 11, color: '#94a3b8' }}>{status}</code>;
  return (
    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: s.bg, color: s.fg, fontWeight: 600 }}>{s.label}</span>
  );
}

export default function Day4Page() {
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
        getJSON<Stats>('/api/admin/cover-compliance/stats'),
        getJSON<{ items: Item[] }>(`/api/admin/cover-compliance/items${q}`),
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
      const r = await getJSON<{ enqueued: number }>(`/api/admin/cover-compliance/${path}`, { method: 'POST' });
      setToast(`${label}:已入队 ${r.enqueued} 条`);
      setTimeout(() => setToast(null), 3000);
      await refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function retrigger(kind: 'recover' | 'recheck', id: string) {
    setBusyId((b) => ({ ...b, [id]: true }));
    try {
      await getJSON<{ ok: true }>(`/api/admin/cover-compliance/${kind}/${id}`, { method: 'POST' });
      setToast(`已重新入队 ${kind}`);
      setTimeout(() => setToast(null), 2000);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusyId((b) => ({ ...b, [id]: false }));
    }
  }

  const countByStatus = Object.fromEntries((stats?.by_status ?? []).map((s) => [s.status, s.count]));
  const passCount = countByStatus.COMPLIANCE_PASS ?? 0;
  const reviewCount = countByStatus.COMPLIANCE_REVIEW ?? 0;
  const failCount = countByStatus.COMPLIANCE_FAIL ?? 0;

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', fontFamily: 'system-ui, -apple-system, PingFang SC, sans-serif' }}>
      <header style={{ background: '#020617', borderBottom: '1px solid #1e293b', padding: '0 24px', height: 52, display: 'flex', alignItems: 'center', gap: 16, position: 'sticky', top: 0, zIndex: 100 }}>
        <span style={{ color: '#e2e8f0', fontSize: 16, fontWeight: 800 }}>内容中台</span>
        <span style={{ color: '#334155' }}>/</span>
        <span style={{ fontSize: 13, color: '#64748b' }}>封面与合规</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Link href="/workbench" style={{ ...btn, textDecoration: 'none', color: '#e2e8f0', display: 'inline-flex', alignItems: 'center' }}>← 工作台</Link>
          <button style={btn} disabled={busy} onClick={() => bulk('cover-all', '封面')}>{busy ? '处理中…' : '批量选封面 (TITLED)'}</button>
          <button style={btnPrimary} disabled={busy} onClick={() => bulk('compliance-all', '合规')}>{busy ? '处理中…' : '批量合规 (COVERED)'}</button>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 20px 60px' }}>
        <AdminNav current="cover-compliance" />

        {toast && <div style={{ ...card, background: '#052e16', borderColor: '#16a34a', color: '#86efac', marginBottom: 12, fontSize: 13 }}>{toast}</div>}
        {err && <div style={{ ...card, background: '#450a0a', borderColor: '#7f1d1d', color: '#fca5a5', marginBottom: 12, fontSize: 13 }}>⚠ {err}</div>}

        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 16 }}>
          <Tile label="总条目" value={stats?.total ?? '—'} />
          <Tile label="已选封面" value={stats?.covered ?? '—'} accent="#0ea5e9" hint={`覆盖率 ${stats?.total ? Math.round(((stats.covered ?? 0) / stats.total) * 100) : 0}%`} />
          <Tile label="合规通过" value={passCount} accent="#22c55e" />
          <Tile label="待复核" value={reviewCount} accent="#fbbf24" />
          <Tile label="拒绝" value={failCount} accent="#f87171" />
          <Tile label="24h 成本" value={`$${(stats?.cost_last_24h ?? 0).toFixed(4)}`} accent="#a78bfa" />
        </section>

        {stats && stats.compliance_breakdown.length > 0 && (
          <section style={{ ...card, marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 13, color: '#cbd5e1', fontWeight: 600 }}>合规判决归因</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 13 }}>
              {stats.compliance_breakdown.map((c) => (
                <span key={c.trigger ?? 'null'} style={{ padding: '4px 10px', borderRadius: 6, background: '#312e81', color: '#c7d2fe' }}>
                  {TRIGGER_LABEL[c.trigger ?? ''] ?? c.trigger ?? '—'} · {c.count}
                </span>
              ))}
            </div>
          </section>
        )}

        <div style={{ marginBottom: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#64748b' }}>状态筛选:</span>
          {['', 'TITLED', 'COVERED', 'COMPLIANCE_PASS', 'COMPLIANCE_REVIEW', 'COMPLIANCE_FAIL', 'PUBLISHED', 'DISTRIBUTED'].map((s) => {
            const count = s === '' ? (stats?.total ?? 0) : (countByStatus[s] ?? 0);
            const active = filter === s;
            return (
              <button key={s || 'all'}
                style={{ ...btn, ...(active ? { background: '#6366f1', color: '#fff', borderColor: '#6366f1' } : {}) }}
                onClick={() => setFilter(s)}>
                {s === '' ? '全部' : STATUS_LABEL[s] ?? s}
                <span style={{
                  marginLeft: 6, fontSize: 10, color: active ? '#e0e7ff' : count > 0 ? '#a5b4fc' : '#475569',
                  fontVariantNumeric: 'tabular-nums',
                }}>{count}</span>
              </button>
            );
          })}
          {filter && (
            <span style={{ fontSize: 11, color: '#64748b', marginLeft: 8 }}>
              命中 {items.length} 条
            </span>
          )}
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
                    <td style={{ ...td, width: 220 }}>
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb} alt="" style={{ width: 200, height: 125, objectFit: 'cover', borderRadius: 6, background: '#0f172a', display: 'block' }} />
                      ) : (
                        <div style={{ width: 200, height: 125, background: '#0f172a', color: '#475569', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, border: '1px solid #334155' }}>
                          无图
                        </div>
                      )}
                      {it.cover_copy && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, lineHeight: 1.5 }}>{it.cover_copy}</div>}
                    </td>
                    <td style={{ ...td, maxWidth: 360 }}>
                      <div style={{ fontWeight: 500 }}>{it.title ?? <span style={{ color: '#64748b' }}>(无标题)</span>}</div>
                      <div style={{ color: '#475569', fontSize: 11, marginTop: 4 }}>
                        {it.source} · <code style={{ color: '#a5b4fc' }}>{STATUS_LABEL[it.status] ?? it.status}</code>
                      </div>
                    </td>
                    <td style={td}>
                      {it.category ? (
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#1e3a8a', color: '#93c5fd', fontWeight: 500 }}>{it.category}</span>
                      ) : (
                        <span style={{ color: '#64748b' }}>—</span>
                      )}
                    </td>
                    <td style={td}>
                      <ComplianceBadge status={it.compliance_status ?? it.status} />
                      {it.compliance_reasons?.maxScore >= 0 && (
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>最高分 {it.compliance_reasons.maxScore}</div>
                      )}
                    </td>
                    <td style={{ ...td, maxWidth: 200 }}>
                      {(it.risk_tags ?? []).length > 0
                        ? it.risk_tags.map((t) => (
                            <span key={t} style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: '#7f1d1d', color: '#fca5a5', marginRight: 4, marginBottom: 2, display: 'inline-block' }}>{t}</span>
                          ))
                        : '—'}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <button style={btn} disabled={!!busyId[it.id]} onClick={() => retrigger('recover', it.id)}>{busyId[it.id] ? '…' : '重选封面'}</button>{' '}
                      <button style={btn} disabled={!!busyId[it.id]} onClick={() => retrigger('recheck', it.id)}>{busyId[it.id] ? '…' : '重跑合规'}</button>
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 && (
                <tr><td style={{ ...td, color: '#64748b' }} colSpan={6}>暂无条目</td></tr>
              )}
            </tbody>
          </table>
        </section>

        <section style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <h3 style={{ margin: 0, padding: 14, fontSize: 13, borderBottom: '1px solid #334155', color: '#cbd5e1', fontWeight: 600 }}>
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
                <tr><td style={{ ...td, color: '#64748b' }} colSpan={6}>暂无执行记录</td></tr>
              )}
            </tbody>
          </table>
        </section>

        <footer style={{ marginTop: 20, textAlign: 'center', color: '#475569', fontSize: 11 }}>
          每 4 秒自动刷新 · 封面 Haiku,合规 Sonnet(COMPLIANCE_MODEL 可切)
        </footer>
      </div>
    </div>
  );
}
