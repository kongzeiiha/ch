'use client';

import type { QueueStat, AgentRunRow } from './types';

export function QueueRunsPanel({ queues, agentSummary }: { queues: QueueStat[]; agentSummary: AgentRunRow[] }) {
  const totalCost = agentSummary.reduce((s, r) => s + Number(r.total_cost_usd), 0);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 20 }}>
      <div style={{ background: '#1e293b', border: '1px solid #3e4144', borderRadius: 10, padding: '14px 16px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: '#71767b' }}>队列快照</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: '#475569' }}>
              {['', '等待', '运行', '完成', '失败'].map(h => <th key={h} style={{ padding: '4px 8px', textAlign: h === '' ? 'left' : 'right', fontWeight: 400 }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {queues.map(q => {
              const active = q.counts.active > 0;
              const fail = q.counts.failed > 0;
              return (
                <tr key={q.name} style={{ borderTop: '1px solid #0f172a' }}>
                  <td style={{ padding: '5px 8px', color: active ? '#e7e9ea' : '#475569', fontWeight: active ? 600 : 400 }}>{q.name}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: q.counts.waiting > 20 ? '#fbbf24' : q.counts.waiting > 0 ? '#60a5fa' : '#3e4144' }}>{q.counts.waiting || '—'}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: active ? '#34d399' : '#3e4144' }}>{q.counts.active || '—'}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: '#3e4144' }}>{q.counts.completed || '—'}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: fail ? '#f87171' : '#3e4144' }}>{q.counts.failed || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ background: '#1e293b', border: '1px solid #3e4144', borderRadius: 10, padding: '14px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#71767b' }}>近期运行（24h）</span>
          <span style={{ fontSize: 12, color: '#a78bfa' }}>总成本 ${totalCost.toFixed(4)}</span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: '#475569' }}>
              {['Agent', '成功', '失败', '耗时', '成本'].map(h => <th key={h} style={{ padding: '4px 8px', textAlign: h === 'Agent' ? 'left' : 'right', fontWeight: 400 }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {agentSummary.map(r => (
              <tr key={r.agent} style={{ borderTop: '1px solid #0f172a' }}>
                <td style={{ padding: '5px 8px', color: '#71767b' }}>{r.agent}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: '#34d399' }}>{r.success}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: r.failed > 0 ? '#f87171' : '#3e4144' }}>{r.failed || '—'}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: '#475569' }}>{r.avg_latency_ms ? `${r.avg_latency_ms}ms` : '—'}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: '#a78bfa' }}>${Number(r.total_cost_usd).toFixed(4)}</td>
              </tr>
            ))}
            {agentSummary.length === 0 && <tr><td colSpan={5} style={{ padding: '12px 8px', textAlign: 'center', color: '#3e4144' }}>暂无数据</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
