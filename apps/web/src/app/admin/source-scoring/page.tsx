'use client';

import { useEffect, useState, useCallback } from 'react';
import { AdminNav } from '../../../components/AdminNav';
import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL ?? '/api';

interface SourceRow {
  id: string;
  name: string;
  platform: string;
  external_id: string;
  status: string;
  score: number | null;
  risk_level: string | null;
  stability: number | null;
  last_fetch_at: string | null;
}

interface Stats {
  byStatus: Record<string, number>;
  byRisk: Record<string, number>;
  score: { avg: number | null; min: number | null; max: number | null; cnt: number };
  lastRun: {
    id: string; status: string;
    started_at: string; finished_at: string | null;
    latency_ms: number | null;
    output: { updated?: number; samples?: Array<{ id: string; name: string; before: number; after: number; status: string }> } | null;
  } | null;
}

interface RunRow {
  id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  latency_ms: number | null;
  output: { updated?: number; samples?: Array<{ id: string; name: string; before: number; after: number }> } | null;
  error: string | null;
}

const card: React.CSSProperties = { background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: 16 };
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600, color: '#94a3b8', borderBottom: '1px solid #334155', background: '#0f172a', textTransform: 'uppercase', letterSpacing: 0.4 };
const td: React.CSSProperties = { padding: '10px 12px', fontSize: 13, borderBottom: '1px solid #334155', verticalAlign: 'top', color: '#e2e8f0' };
const btn: React.CSSProperties = { padding: '6px 12px', fontSize: 12, border: '1px solid #334155', borderRadius: 6, background: 'transparent', color: '#94a3b8', cursor: 'pointer' };
const btnPrimary: React.CSSProperties = { ...btn, background: '#7c3aed', color: '#fff', borderColor: '#7c3aed', fontWeight: 600 };

function Tile({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div style={card}>
      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: accent ?? '#e2e8f0' }}>{value}</div>
    </div>
  );
}

function ScoreBar({ score }: { score: number | null }) {
  if (score === null) return <span style={{ color: '#64748b' }}>—</span>;
  const color = score >= 70 ? '#22c55e' : score >= 40 ? '#fbbf24' : '#f87171';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 80, height: 6, background: '#0f172a', borderRadius: 3, overflow: 'hidden', border: '1px solid #334155' }}>
        <div style={{ width: `${score}%`, height: '100%', background: color }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 26, textAlign: 'right' }}>{score}</span>
    </div>
  );
}

function RiskChip({ level }: { level: string | null }) {
  if (!level) return <span style={{ color: '#64748b' }}>—</span>;
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    low:    { bg: '#14532d', fg: '#86efac', label: '低' },
    medium: { bg: '#78350f', fg: '#fbbf24', label: '中' },
    high:   { bg: '#7f1d1d', fg: '#fca5a5', label: '高' },
  };
  const m = map[level] ?? { bg: '#1e293b', fg: '#94a3b8', label: level };
  return (
    <span style={{ background: m.bg, color: m.fg, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10 }}>
      {m.label}
    </span>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    active:    { bg: '#14532d', fg: '#86efac' },
    paused:    { bg: '#78350f', fg: '#fbbf24' },
    blacklist: { bg: '#7f1d1d', fg: '#fca5a5' },
    inactive:  { bg: '#1e293b', fg: '#94a3b8' },
  };
  const m = map[status] ?? { bg: '#1e293b', fg: '#94a3b8' };
  return (
    <span style={{ background: m.bg, color: m.fg, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10 }}>
      {status}
    </span>
  );
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SourceScoringPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, src, rn] = await Promise.all([
        fetch(`${API}/admin/source-scoring/stats`).then(r => r.json()),
        fetch(`${API}/admin/source-scoring/sources`).then(r => r.json()),
        fetch(`${API}/admin/source-scoring/runs?limit=10`).then(r => r.json()),
      ]);
      setStats(s);
      setSources(src.sources ?? []);
      setRuns(rn.runs ?? []);
    } catch (e) {
      setMsg(`加载失败: ${e}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const triggerScore = async () => {
    setBusy(true);
    setMsg('已入队,运行中…');
    try {
      const r = await fetch(`${API}/admin/source-scoring/run`, { method: 'POST' });
      const d = await r.json();
      setMsg(`已入队 ${d.queued} 个评分任务(约 1–3 秒后完成,刷新查看结果)`);
      setTimeout(() => { void load(); }, 2500);
    } catch (e) {
      setMsg(`触发失败: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  const totalSources = Object.values(stats?.byStatus ?? {}).reduce((a, b) => a + b, 0);
  const active = stats?.byStatus.active ?? 0;
  const paused = stats?.byStatus.paused ?? 0;
  const blacklist = stats?.byStatus.blacklist ?? 0;
  const riskHigh = stats?.byRisk.high ?? 0;
  const sectionTitle: React.CSSProperties = { fontSize: 12, color: '#64748b', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 };

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', fontFamily: 'system-ui, -apple-system, PingFang SC, sans-serif' }}>
      <header style={{ background: '#020617', borderBottom: '1px solid #1e293b', padding: '0 24px', height: 52, display: 'flex', alignItems: 'center', gap: 16, position: 'sticky', top: 0, zIndex: 100 }}>
        <span style={{ color: '#e2e8f0', fontSize: 16, fontWeight: 800 }}>内容中台</span>
        <span style={{ color: '#334155' }}>/</span>
        <span style={{ fontSize: 13, color: '#64748b' }}>Source 评分</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Link href="/workbench" style={{ ...btn, textDecoration: 'none', color: '#e2e8f0', display: 'inline-flex', alignItems: 'center' }}>← 工作台</Link><button style={btn} onClick={load}>↻ 刷新</button>
          <button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={triggerScore}>
            {busy ? '运行中…' : '立即评分'}
          </button>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 20px 60px' }}>
        <AdminNav current="source-scoring" />

        <div style={{ ...card, marginBottom: 20, fontSize: 12, color: '#94a3b8', lineHeight: 1.7 }}>
          每条采集源的得分由 SQL 聚合算出(无 LLM 调用):
          <span style={{ color: '#cbd5e1' }}>基础 50 分 + 已发布数 ×2 + 新鲜度 ±10 + 近 7 天采集量 + 近 7 天 PV / 收益奖励 − 合规拒/审核惩罚</span>。
          定时任务每天 03:15 UTC 跑一次,按钮可立即手工触发一轮。
        </div>

        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 12, marginBottom: 24 }}>
          <Tile label="总源数" value={loading ? '…' : totalSources} />
          <Tile label="active" value={loading ? '…' : active} accent="#22c55e" />
          <Tile label="paused" value={loading ? '…' : paused} accent="#fbbf24" />
          <Tile label="blacklist" value={loading ? '…' : blacklist} accent="#f87171" />
          <Tile label="高风险" value={loading ? '…' : riskHigh} accent="#f87171" />
          <Tile label="均分" value={loading ? '…' : (stats?.score.avg !== null && stats?.score.avg !== undefined ? stats.score.avg.toFixed(1) : '—')} accent="#0ea5e9" />
          <Tile label="上次运行" value={loading ? '…' : (stats?.lastRun?.started_at ? fmtTime(stats.lastRun.started_at).slice(5) : '—')} />
        </section>

        {msg && (
          <div style={{ marginBottom: 16, padding: '10px 14px', background: '#1e3a8a', border: '1px solid #3b82f6', borderRadius: 6, fontSize: 13, color: '#bfdbfe' }}>
            {msg}
          </div>
        )}

        <h3 style={sectionTitle}>采集源评分(高分在前)</h3>
        <section style={{ ...card, padding: 0, overflow: 'hidden', marginBottom: 24 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>名称</th>
                <th style={th}>平台</th>
                <th style={th}>评分</th>
                <th style={th}>风险</th>
                <th style={th}>稳定度</th>
                <th style={th}>状态</th>
                <th style={th}>最近采集</th>
              </tr>
            </thead>
            <tbody>
              {loading && sources.length === 0 && (
                <tr><td style={{ ...td, color: '#64748b', textAlign: 'center' }} colSpan={7}>加载中…</td></tr>
              )}
              {!loading && sources.length === 0 && (
                <tr><td style={{ ...td, color: '#64748b', textAlign: 'center' }} colSpan={7}>暂无数据</td></tr>
              )}
              {sources.map(s => (
                <tr key={s.id}>
                  <td style={td}>
                    <div style={{ fontWeight: 500 }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>{s.external_id}</div>
                  </td>
                  <td style={td}>
                    <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 6, background: '#0ea5e933', color: '#7dd3fc' }}>{s.platform}</span>
                  </td>
                  <td style={td}><ScoreBar score={s.score} /></td>
                  <td style={td}><RiskChip level={s.risk_level} /></td>
                  <td style={{ ...td, color: '#cbd5e1' }}>{s.stability ?? <span style={{ color: '#64748b' }}>—</span>}</td>
                  <td style={td}><StatusChip status={s.status} /></td>
                  <td style={{ ...td, color: '#94a3b8' }}>{fmtTime(s.last_fetch_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <h3 style={sectionTitle}>近 10 次评分运行</h3>
        <section style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>开始时间</th>
                <th style={th}>状态</th>
                <th style={th}>耗时</th>
                <th style={th}>更新源数</th>
                <th style={th}>错误</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr><td style={{ ...td, color: '#64748b', textAlign: 'center' }} colSpan={5}>暂无运行记录</td></tr>
              )}
              {runs.map(r => {
                const colors: Record<string, [string, string]> = {
                  success: ['#14532d', '#86efac'],
                  error:   ['#7f1d1d', '#fca5a5'],
                  failed:  ['#7f1d1d', '#fca5a5'],
                  running: ['#78350f', '#fbbf24'],
                };
                const [bg, fg] = colors[r.status] ?? ['#1e293b', '#94a3b8'];
                return (
                  <tr key={r.id}>
                    <td style={{ ...td, color: '#cbd5e1' }}>{fmtTime(r.started_at)}</td>
                    <td style={td}>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: bg, color: fg }}>
                        {r.status}
                      </span>
                    </td>
                    <td style={{ ...td, color: '#94a3b8' }}>{r.latency_ms ? `${r.latency_ms}ms` : '—'}</td>
                    <td style={{ ...td, color: '#a78bfa', fontWeight: 600 }}>{r.output?.updated ?? '—'}</td>
                    <td style={{ ...td, fontSize: 11, color: '#fca5a5', fontFamily: 'ui-monospace, monospace' }}>{r.error ?? ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
