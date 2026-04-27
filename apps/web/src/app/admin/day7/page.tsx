'use client';

import { useEffect, useState, useCallback } from 'react';
import { AdminNav } from '../../../components/AdminNav';
import { getSprintStart, computeDayLabel } from '../../../lib/sprint';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

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

function levelColor(l: 'ok' | 'warn' | 'critical') {
  return l === 'ok' ? '#16a34a' : l === 'warn' ? '#d97706' : '#dc2626';
}
function levelBg(l: 'ok' | 'warn' | 'critical') {
  return l === 'ok' ? '#f0fdf4' : l === 'warn' ? '#fffbeb' : '#fef2f2';
}

export default function Day7Page() {

  const [dayLabel, setDayLabel] = useState('4/26');
  useEffect(() => { setDayLabel(computeDayLabel(getSprintStart(), 7)); }, []);
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
        fetch(`${API}/admin/day7/alerts`).then((r) => r.json()),
        fetch(`${API}/admin/day7/agent-runs`).then((r) => r.json()),
        fetch(`${API}/admin/day7/queues`).then((r) => r.json()),
        fetch(`${API}/admin/day7/sources`).then((r) => r.json()),
        fetch(`${API}/admin/day7/pipeline-stats`).then((r) => r.json()),
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
    await action(`${API}/admin/day7/sources/${id}/grayscale`, 'PATCH', { pct }, `灰度设为 ${pct}%`);
  };

  const btn: React.CSSProperties = { padding: '7px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500 };

  const items = pipeline?.items ?? {};
  const totalItems = Object.values(items).reduce((a, b) => a + b, 0);

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 20px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <AdminNav current="day7" />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{dayLabel} · 联调加固 & 上线</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button style={{ ...btn, background: '#dc2626', color: '#fff' }}
            onClick={() => action(`${API}/admin/day7/stress-trigger`, 'POST', null, '全链路压测')}>
            触发全链路压测
          </button>
          <button style={{ ...btn, background: '#2563eb', color: '#fff' }}
            onClick={() => action(`${API}/admin/day7/grayscale-all`, 'POST', { pct: 100 }, '放量 100%')}>
            全量放量 100%
          </button>
          <button style={{ ...btn, background: '#f3f4f6', color: '#111' }} onClick={load}>刷新</button>
        </div>
      </div>

      {msg && (
        <div style={{ marginBottom: 16, padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, fontSize: 13, color: '#166534' }}>
          {msg}
        </div>
      )}

      {/* ── Alerts ── */}
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>系统告警</h2>
      {alerts && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 13, padding: '3px 10px', borderRadius: 12, background: alerts.healthy ? '#d1fae5' : '#fee2e2', color: alerts.healthy ? '#065f46' : '#991b1b', fontWeight: 600 }}>
              {alerts.healthy ? '✓ 系统健康' : '⚠ 有告警'}
            </span>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>检查时间: {new Date(alerts.checkedAt).toLocaleString('zh-CN')}</span>
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {alerts.alerts.map((a, i) => (
              <div key={i} style={{ padding: '8px 12px', borderRadius: 6, background: levelBg(a.level), border: `1px solid`, borderColor: a.level === 'ok' ? '#bbf7d0' : a.level === 'warn' ? '#fde68a' : '#fecaca', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, color: levelColor(a.level), fontWeight: 500 }}>{a.level.toUpperCase()}</span>
                <span style={{ fontSize: 13, color: '#374151' }}>{a.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Pipeline Overview ── */}
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>全链路状态</h2>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
        {['INGESTED','CLASSIFIED','TITLED','COVERED','COMPLIANCE_PASS','COMPLIANCE_FAIL','COMPLIANCE_REVIEW','PUBLISHED','DISTRIBUTED'].map((s) => (
          <div key={s} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 14px', minWidth: 90, textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 2 }}>{s}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: s === 'PUBLISHED' ? '#16a34a' : s.includes('FAIL') ? '#dc2626' : '#111827' }}>
              {loading ? '…' : (items[s] ?? 0)}
            </div>
          </div>
        ))}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 14px', minWidth: 90, textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 2 }}>总计</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#2563eb' }}>{loading ? '…' : totalItems}</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 14px', minWidth: 120, textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 2 }}>累计 LLM 成本</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#7c3aed' }}>${loading ? '…' : Number(pipeline?.totalCostUsd ?? 0).toFixed(4)}</div>
        </div>
      </div>

      {/* ── Queue Health ── */}
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>队列健康（实时）</h2>
      <div style={{ marginBottom: 24, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
              {['队列', '等待', '执行中', '延迟', '完成', '失败'].map((h) => (
                <th key={h} style={{ padding: '8px 10px', color: '#6b7280', fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {queues.map((q) => (
              <tr key={q.name} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '8px 10px', fontWeight: 500 }}>{q.name}</td>
                <td style={{ padding: '8px 10px', color: q.counts.waiting > 50 ? '#d97706' : '#111' }}>{q.counts.waiting}</td>
                <td style={{ padding: '8px 10px', color: q.counts.active > 0 ? '#2563eb' : '#9ca3af' }}>{q.counts.active}</td>
                <td style={{ padding: '8px 10px' }}>{q.counts.delayed}</td>
                <td style={{ padding: '8px 10px', color: '#16a34a' }}>{q.counts.completed}</td>
                <td style={{ padding: '8px 10px', color: q.counts.failed > 0 ? '#dc2626' : '#9ca3af' }}>{q.counts.failed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Agent Runs Summary ── */}
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>Agent 埋点（近 24h）</h2>
      <div style={{ marginBottom: 28, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
              {['Agent', '总次数', '成功', '失败', '平均耗时', '成本 USD'].map((h) => (
                <th key={h} style={{ padding: '8px 10px', color: '#6b7280', fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agentSummary.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: '20px 10px', textAlign: 'center', color: '#9ca3af' }}>暂无数据</td></tr>
            ) : agentSummary.map((r) => (
              <tr key={r.agent} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '8px 10px', fontWeight: 500 }}>{r.agent}</td>
                <td style={{ padding: '8px 10px' }}>{r.total}</td>
                <td style={{ padding: '8px 10px', color: '#16a34a' }}>{r.success}</td>
                <td style={{ padding: '8px 10px', color: r.failed > 0 ? '#dc2626' : '#9ca3af' }}>{r.failed}</td>
                <td style={{ padding: '8px 10px', color: '#374151' }}>{r.avg_latency_ms ? `${r.avg_latency_ms}ms` : '—'}</td>
                <td style={{ padding: '8px 10px', color: '#7c3aed' }}>${Number(r.total_cost_usd).toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Grayscale Control ── */}
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>灰度开关</h2>
      <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
        调整各 Source 的采集概率（10% → 每次 fanout 约 10% 概率被选中）
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {[10, 25, 50, 100].map((pct) => (
          <button key={pct} style={{ ...btn, background: '#f3f4f6', color: '#111' }}
            onClick={() => action(`${API}/admin/day7/grayscale-all`, 'POST', { pct }, `全部设为 ${pct}%`)}>
            全部 {pct}%
          </button>
        ))}
      </div>
      <div style={{ overflowX: 'auto', marginBottom: 32 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
              {['Source', '平台', '状态', '评分', '灰度 %', '操作'].map((h) => (
                <th key={h} style={{ padding: '8px 10px', color: '#6b7280', fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sources.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: '20px 10px', textAlign: 'center', color: '#9ca3af' }}>暂无 Source</td></tr>
            ) : sources.map((s) => (
              <tr key={s.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '8px 10px', fontWeight: 500 }}>{s.name}</td>
                <td style={{ padding: '8px 10px', color: '#6b7280' }}>{s.platform}</td>
                <td style={{ padding: '8px 10px' }}>
                  <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, background: s.status === 'active' ? '#d1fae5' : '#fee2e2', color: s.status === 'active' ? '#065f46' : '#991b1b' }}>
                    {s.status}
                  </span>
                </td>
                <td style={{ padding: '8px 10px' }}>{s.score}</td>
                <td style={{ padding: '8px 10px', fontWeight: 600, color: s.grayscale_pct < 50 ? '#d97706' : '#16a34a' }}>
                  {s.grayscale_pct}%
                </td>
                <td style={{ padding: '8px 10px', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {[10, 50, 100].map((pct) => (
                    <button key={pct}
                      style={{ padding: '3px 8px', fontSize: 11, borderRadius: 4, border: '1px solid #d1d5db', background: s.grayscale_pct === pct ? '#111827' : '#fff', color: s.grayscale_pct === pct ? '#fff' : '#374151', cursor: 'pointer' }}
                      onClick={() => setGrayscale(s.id, pct)}>
                      {pct}%
                    </button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ padding: 16, background: '#f9fafb', borderRadius: 8, fontSize: 12, color: '#6b7280' }}>
        <strong>验收要点：</strong>
        ① 告警全绿 ② 队列 failed=0 ③ 点「触发全链路压测」→ 队列 waiting 数字上升再下降 ④ 灰度先设 10% 观察 1 小时再放量 100%
        <br />
        <strong>Sentry：</strong> 设置 SENTRY_DSN 后执行 <code>pnpm --filter @ch/api add @sentry/node</code>
        <br />
        <strong>压测 500 条：</strong> <code>pnpm --filter @ch/api stress</code>
      </div>
    </main>
  );
}
