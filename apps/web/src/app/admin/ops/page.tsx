'use client';

import { useEffect, useState, useCallback } from 'react';
import { AdminNav } from '../../../components/AdminNav';
import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL ?? '/api';

interface AlertResult { level: 'ok' | 'warn' | 'critical'; message: string; value: number; threshold: number; }
interface AlertsReport { checkedAt: string; alerts: AlertResult[]; healthy: boolean; }

interface AgentSummaryRow {
  agent: string; total: number; success: number; failed: number;
  avg_latency_ms: number; total_cost_usd: number;
}

interface QueueStat {
  name: string;
  counts: { waiting: number; active: number; delayed: number; completed: number; failed: number };
}

interface Source {
  id: string; name: string; platform: string; status: string;
  score: number; grayscale_pct: number; last_fetch_at: string | null;
}

interface PipelineStats {
  items: Record<string, number>;
  sources: { total: number; active: number; paused: number; blacklist: number };
  totalCostUsd: number;
}

const card: React.CSSProperties = { background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: 16 };
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600, color: '#94a3b8', borderBottom: '1px solid #334155', background: '#0f172a', textTransform: 'uppercase', letterSpacing: 0.4 };
const td: React.CSSProperties = { padding: '10px 12px', fontSize: 13, borderBottom: '1px solid #334155', verticalAlign: 'top', color: '#e2e8f0' };
const btn: React.CSSProperties = { padding: '6px 12px', fontSize: 12, border: '1px solid #334155', borderRadius: 6, background: 'transparent', color: '#94a3b8', cursor: 'pointer' };
const btnPrimary: React.CSSProperties = { ...btn, background: '#6366f1', color: '#fff', borderColor: '#6366f1', fontWeight: 600 };
const btnDanger: React.CSSProperties = { ...btn, background: '#dc2626', color: '#fff', borderColor: '#dc2626', fontWeight: 600 };

function levelStyle(l: 'ok' | 'warn' | 'critical') {
  if (l === 'ok')       return { bg: '#052e16', border: '#16a34a', fg: '#86efac' };
  if (l === 'warn')     return { bg: '#78350f', border: '#d97706', fg: '#fbbf24' };
  return { bg: '#450a0a', border: '#dc2626', fg: '#fca5a5' };
}

function MiniTile({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div style={{ ...card, padding: '12px 14px', minWidth: 90, textAlign: 'center' }}>
      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent ?? '#e2e8f0' }}>{value}</div>
    </div>
  );
}

export default function Day7Page() {
  const [alerts, setAlerts] = useState<AlertsReport | null>(null);
  const [agentSummary, setAgentSummary] = useState<AgentSummaryRow[]>([]);
  const [queues, setQueues] = useState<QueueStat[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [pipeline, setPipeline] = useState<PipelineStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [alertsRes, runsRes, queuesRes, sourcesRes, pipelineRes] = await Promise.all([
        fetch(`${API}/admin/ops/alerts`).then((r) => r.json()),
        fetch(`${API}/admin/ops/agent-runs`).then((r) => r.json()),
        fetch(`${API}/admin/ops/queues`).then((r) => r.json()),
        fetch(`${API}/admin/ops/sources`).then((r) => r.json()),
        fetch(`${API}/admin/ops/pipeline-stats`).then((r) => r.json()),
      ]);
      setAlerts(alertsRes);
      setAgentSummary(runsRes.summary ?? []);
      setQueues(queuesRes.stats ?? []);
      setSources(sourcesRes.sources ?? []);
      setPipeline(pipelineRes);
    } catch (e) {
      setMsg(`加载失败: ${e}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const action = async (url: string, method: string, body: unknown, label: string) => {
    setMsg(`${label}...`);
    try {
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const d = await r.json();
      setMsg(`${label} 完成: ${JSON.stringify(d)}`);
      await load();
    } catch (e) {
      setMsg(`${label} 失败: ${e}`);
    }
  };

  const setGrayscale = async (id: string, pct: number) => {
    await action(`${API}/admin/ops/sources/${id}/grayscale`, 'PATCH', { pct }, `灰度设为 ${pct}%`);
  };

  const items = pipeline?.items ?? {};
  const totalItems = Object.values(items).reduce((a, b) => a + b, 0);
  const sectionTitle: React.CSSProperties = { fontSize: 12, color: '#64748b', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 };

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', fontFamily: 'system-ui, -apple-system, PingFang SC, sans-serif' }}>
      <header style={{ background: '#020617', borderBottom: '1px solid #1e293b', padding: '0 24px', height: 52, display: 'flex', alignItems: 'center', gap: 16, position: 'sticky', top: 0, zIndex: 100 }}>
        <span style={{ color: '#e2e8f0', fontSize: 16, fontWeight: 800 }}>内容中台</span>
        <span style={{ color: '#334155' }}>/</span>
        <span style={{ fontSize: 13, color: '#64748b' }}>联调加固 & 上线</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href="/workbench" style={{ ...btn, textDecoration: 'none', color: '#e2e8f0', display: 'inline-flex', alignItems: 'center' }}>← 工作台</Link><button style={btn} onClick={load}>↻ 刷新</button>
          <button style={btnDanger} onClick={() => action(`${API}/admin/ops/stress-trigger`, 'POST', null, '全链路压测')}>触发全链路压测</button>
          <button style={btnPrimary} onClick={() => action(`${API}/admin/ops/grayscale-all`, 'POST', { pct: 100 }, '放量 100%')}>全量放量 100%</button>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 20px 60px' }}>
        <AdminNav current="ops" />

        {msg && (
          <div style={{ marginBottom: 16, padding: '10px 14px', background: '#052e16', border: '1px solid #16a34a', borderRadius: 6, fontSize: 13, color: '#86efac' }}>
            {msg}
          </div>
        )}

        {/* Alerts */}
        <h3 style={sectionTitle}>系统告警</h3>
        {alerts && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 12, fontWeight: 600,
                background: alerts.healthy ? '#14532d' : '#7f1d1d',
                color: alerts.healthy ? '#86efac' : '#fca5a5' }}>
                {alerts.healthy ? '✓ 系统健康' : '⚠ 有告警'}
              </span>
              <span style={{ fontSize: 12, color: '#64748b' }}>检查时间: {new Date(alerts.checkedAt).toLocaleString('zh-CN')}</span>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {alerts.alerts.map((a, i) => {
                const sty = levelStyle(a.level);
                return (
                  <div key={i} style={{ padding: '8px 12px', borderRadius: 6, background: sty.bg, border: `1px solid ${sty.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 11, color: sty.fg, fontWeight: 700, padding: '1px 8px', borderRadius: 4, background: 'rgba(0,0,0,0.25)' }}>{a.level.toUpperCase()}</span>
                    <span style={{ fontSize: 13, color: '#cbd5e1' }}>{a.message}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Pipeline Overview */}
        <h3 style={sectionTitle}>全链路状态</h3>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
          {['INGESTED','CLASSIFIED','TITLED','COVERED','COMPLIANCE_PASS','COMPLIANCE_FAIL','COMPLIANCE_REVIEW','PUBLISHED','DISTRIBUTED'].map((s) => {
            const accent = s === 'PUBLISHED' ? '#22c55e' : s.includes('FAIL') ? '#f87171' : undefined;
            return <MiniTile key={s} label={s} value={loading ? '…' : (items[s] ?? 0)} accent={accent} />;
          })}
          <MiniTile label="总计" value={loading ? '…' : totalItems} accent="#0ea5e9" />
          <MiniTile label="累计 LLM 成本" value={loading ? '…' : `$${Number(pipeline?.totalCostUsd ?? 0).toFixed(4)}`} accent="#a78bfa" />
        </div>

        {/* Queue Health */}
        <h3 style={sectionTitle}>队列健康(实时)</h3>
        <section style={{ ...card, padding: 0, overflow: 'hidden', marginBottom: 24 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['队列', '等待', '执行中', '延迟', '完成', '失败'].map((h) => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {queues.map((q) => (
                <tr key={q.name}>
                  <td style={td}><code style={{ fontSize: 12, color: '#a5b4fc' }}>{q.name}</code></td>
                  <td style={{ ...td, color: q.counts.waiting > 50 ? '#fbbf24' : '#e2e8f0' }}>{q.counts.waiting}</td>
                  <td style={{ ...td, color: q.counts.active > 0 ? '#0ea5e9' : '#94a3b8' }}>{q.counts.active}</td>
                  <td style={{ ...td, color: '#94a3b8' }}>{q.counts.delayed}</td>
                  <td style={{ ...td, color: '#94a3b8' }}>{q.counts.completed}</td>
                  <td style={{ ...td, color: q.counts.failed > 0 ? '#fca5a5' : '#94a3b8', fontWeight: q.counts.failed > 0 ? 600 : 400 }}>{q.counts.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Agent Runs Summary */}
        <h3 style={sectionTitle}>Agent 埋点(近 24h)</h3>
        <section style={{ ...card, padding: 0, overflow: 'hidden', marginBottom: 28 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Agent', '总次数', '成功', '失败', '平均耗时', '成本 USD'].map((h) => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agentSummary.length === 0 ? (
                <tr><td colSpan={6} style={{ ...td, color: '#64748b', textAlign: 'center', padding: '20px 10px' }}>暂无数据</td></tr>
              ) : agentSummary.map((r) => (
                <tr key={r.agent}>
                  <td style={td}><code style={{ fontSize: 12, color: '#a5b4fc' }}>{r.agent}</code></td>
                  <td style={td}>{r.total}</td>
                  <td style={{ ...td, color: '#22c55e' }}>{r.success}</td>
                  <td style={{ ...td, color: r.failed > 0 ? '#fca5a5' : '#94a3b8', fontWeight: r.failed > 0 ? 600 : 400 }}>{r.failed}</td>
                  <td style={{ ...td, color: '#94a3b8' }}>{r.avg_latency_ms ? `${r.avg_latency_ms}ms` : '—'}</td>
                  <td style={{ ...td, color: '#a78bfa' }}>${Number(r.total_cost_usd).toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Grayscale Control */}
        <h3 style={sectionTitle}>灰度开关</h3>
        <p style={{ fontSize: 12, color: '#64748b', marginTop: -6, marginBottom: 12 }}>
          调整各 Source 的采集概率(10% → 每次 fanout 约 10% 概率被选中)
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {[10, 25, 50, 100].map((pct) => (
            <button key={pct} style={btn}
              onClick={() => action(`${API}/admin/ops/grayscale-all`, 'POST', { pct }, `全部设为 ${pct}%`)}>
              全部 {pct}%
            </button>
          ))}
        </div>
        <section style={{ ...card, padding: 0, overflow: 'hidden', marginBottom: 28 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Source', '平台', '状态', '评分', '灰度 %', '操作'].map((h) => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sources.length === 0 ? (
                <tr><td colSpan={6} style={{ ...td, color: '#64748b', textAlign: 'center', padding: '20px 10px' }}>暂无 Source</td></tr>
              ) : sources.map((s) => (
                <tr key={s.id}>
                  <td style={{ ...td, fontWeight: 500 }}>{s.name}</td>
                  <td style={td}>
                    <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 6, background: '#0ea5e933', color: '#7dd3fc' }}>{s.platform}</span>
                  </td>
                  <td style={td}>
                    <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                      background: s.status === 'active' ? '#14532d' : '#7f1d1d',
                      color: s.status === 'active' ? '#86efac' : '#fca5a5' }}>
                      {s.status}
                    </span>
                  </td>
                  <td style={{ ...td, color: '#fbbf24', fontWeight: 600 }}>{s.score}</td>
                  <td style={{ ...td, fontWeight: 600, color: s.grayscale_pct < 50 ? '#fbbf24' : '#22c55e' }}>{s.grayscale_pct}%</td>
                  <td style={{ ...td, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {[10, 50, 100].map((pct) => (
                      <button key={pct}
                        style={{
                          padding: '3px 8px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                          border: `1px solid ${s.grayscale_pct === pct ? '#6366f1' : '#334155'}`,
                          background: s.grayscale_pct === pct ? '#6366f1' : 'transparent',
                          color: s.grayscale_pct === pct ? '#fff' : '#94a3b8',
                        }}
                        onClick={() => setGrayscale(s.id, pct)}>
                        {pct}%
                      </button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div style={{ padding: 14, background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12, color: '#94a3b8', lineHeight: 1.7 }}>
          <strong style={{ color: '#cbd5e1' }}>验收要点:</strong>
          ① 告警全绿 ② 队列 failed=0 ③ 点「触发全链路压测」→ 队列 waiting 数字上升再下降 ④ 灰度先设 10% 观察 1 小时再放量 100%
          <br />
          <strong style={{ color: '#cbd5e1' }}>Sentry:</strong> 设置 SENTRY_DSN 后执行 <code style={{ color: '#a5b4fc' }}>pnpm --filter @ch/api add @sentry/node</code>
          <br />
          <strong style={{ color: '#cbd5e1' }}>压测 500 条:</strong> <code style={{ color: '#a5b4fc' }}>pnpm --filter @ch/api stress</code>
        </div>
      </div>
    </div>
  );
}
