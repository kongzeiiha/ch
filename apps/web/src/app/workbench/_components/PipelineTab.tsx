'use client';

import React from 'react';
import type { PipelineState, AgentMeta, QueueStat, AgentRunRow, LiveJobs, ReviewItem, PublishItem, DistTask } from './types';
import { AGENTS } from './constants';
import { riskBadge } from './utils';
import { LiveStrip } from './LiveStrip';
import { CopyBtn } from './CopyBtn';

interface PipelineTabProps {
  loading: boolean;
  state: PipelineState | null;
  agents: Record<string, AgentMeta>;
  pending: Record<string, number>;
  queues: QueueStat[];
  agentSummary: AgentRunRow[];
  liveJobs: LiveJobs;
  reviewItems: ReviewItem[];
  publishItems: PublishItem[];
  distTasks: DistTask[];
  selectedAgent: string | null;
  setSelectedAgent: (key: string) => void;
  busyAgent: string | null;
  selectedItems: Set<string>;
  setSelectedItems: React.Dispatch<React.SetStateAction<Set<string>>>;
  dayLabel: (n: number) => string;
  setTab: (tab: string) => void;
  setAuto: (agent: string, auto: boolean) => void;
  setPaused: (agent: string, paused: boolean) => void;
  runAgent: (agentKey: string, label: string) => void;
  approveReview: (itemId: string) => void;
  rejectReview: (itemId: string) => void;
  approvePublish: (ids?: string[]) => void;
  confirmDist: (taskId: string) => void;
  rollback: (itemId: string, title: string) => void;
  rerun: (itemId: string) => void;
  showHistory: (itemId: string) => void;
}

export function PipelineTab({
  loading,
  state,
  agents,
  pending,
  queues,
  agentSummary,
  liveJobs,
  reviewItems,
  publishItems,
  distTasks,
  selectedAgent,
  setSelectedAgent,
  busyAgent,
  selectedItems,
  setSelectedItems,
  dayLabel,
  setTab,
  setAuto,
  setPaused,
  runAgent,
  approveReview,
  rejectReview,
  approvePublish,
  confirmDist,
  rollback,
  rerun,
  showHistory,
}: PipelineTabProps) {
  const summaryMap = new Map(agentSummary.map(r => [r.agent, r]));

  // Per-stage computed status, shared between the flow strip and the detail panel.
  const stageMeta = (key: string) => {
    const a = AGENTS.find(x => x.key === key)!;
    const meta = agents[a.key] ?? { auto: false, paused: false };
    const pendingCnt = a.pendingStatus ? (pending[a.pendingStatus] ?? 0) : 0;
    const queue = queues.find(q => q.name === a.key);
    const isProcessing = (queue?.counts.active ?? 0) > 0;
    const stopped = state?.globalStop || meta.paused;
    let humanGateCnt = 0;
    if (a.key === 'compliance')   humanGateCnt = reviewItems.length;
    if (a.key === 'publishing')   humanGateCnt = publishItems.length;
    if (a.key === 'distribution') humanGateCnt = distTasks.length;
    return { agent: a, meta, pendingCnt, isProcessing, stopped, humanGateCnt };
  };

  return (
    <>
    {/* Vertical stepper on the left + selected stage detail on the right.
        On narrow viewports the stepper wraps below the detail via flex-wrap. */}
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>

      {/* Left column: vertical stepper, all 8 stages stacked top → down.
          Cards are sized to fill the vertical real-estate naturally — flex
          with each card claiming an equal share, plus generous padding. */}
      <div style={{
        background: '#1e293b', border: '1px solid #334155', borderRadius: 12,
        padding: '18px 14px',
        flex: '0 0 260px', minWidth: 240,
        display: 'flex', flexDirection: 'column',
        // Match the right-side detail panel's natural height by stretching;
        // alignSelf: stretch is the default in flex, so the column grows to
        // the tallest sibling. We also enforce a min so it looks substantial
        // even when the right panel is short.
        minHeight: 720,
        alignSelf: 'stretch',
      }}>
        {AGENTS.map((a, idx) => {
          const m = stageMeta(a.key);
          const isSel = selectedAgent === a.key;
          // Corner dot: red=积压/⚠ · blue=processing · green=auto · orange=paused · grey=idle
          const dotColor =
            m.humanGateCnt > 0 ? '#ef4444' :
            m.isProcessing ? '#60a5fa' :
            m.meta.paused ? '#fb923c' :
            m.meta.auto ? '#22c55e' : '#475569';
          const accent = m.stopped ? '#475569' : a.color;
          return (
            <div key={a.key} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'stretch',
              // each stage row claims an equal share of the column
              flex: '1 1 0', minHeight: 0,
            }}>
              <button
                onClick={() => setSelectedAgent(a.key)}
                title={a.desc}
                style={{
                  flex: 1, minHeight: 64,
                  textAlign: 'left',
                  background: isSel ? `${accent}1c` : '#0f172a',
                  borderTop: `1px solid ${isSel ? accent : '#1e293b'}`,
                  borderRight: `1px solid ${isSel ? accent : '#1e293b'}`,
                  borderBottom: `1px solid ${isSel ? accent : '#1e293b'}`,
                  borderLeft: `4px solid ${accent}`,
                  borderRadius: 10, padding: '14px 14px',
                  cursor: 'pointer', position: 'relative',
                  opacity: m.stopped && !a.isHumanGate ? 0.65 : 1,
                  transition: 'background 120ms, border-color 120ms',
                  display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8,
                }}>
                {/* Header row: # number + name + status dot */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: accent,
                    background: `${accent}22`, padding: '2px 8px', borderRadius: 5,
                    flexShrink: 0,
                  }}>#{a.num}</span>
                  <span style={{
                    flex: 1, fontSize: 14, fontWeight: 700,
                    color: isSel ? '#f1f5f9' : '#cbd5e1',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {a.name}
                  </span>
                  <span style={{
                    width: 9, height: 9, borderRadius: '50%', background: dotColor,
                    boxShadow: m.isProcessing ? `0 0 8px ${dotColor}` : 'none',
                    animation: m.isProcessing || m.humanGateCnt > 0 ? 'pulse 1s infinite' : 'none',
                    flexShrink: 0,
                  }} />
                </div>
                {/* Bottom row: pending count + status chips */}
                {(m.pendingCnt > 0 || m.humanGateCnt > 0 || a.isHumanGate || m.meta.auto || m.meta.paused) && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {(m.pendingCnt > 0 || m.humanGateCnt > 0) && (
                      <span style={{
                        fontSize: 11, fontWeight: 700,
                        color: m.humanGateCnt > 0 ? '#fca5a5' : accent,
                        background: m.humanGateCnt > 0 ? '#7f1d1d44' : `${accent}22`,
                        padding: '2px 8px', borderRadius: 9,
                      }}>
                        {m.humanGateCnt > 0 ? `⚠ ${m.humanGateCnt}` : m.pendingCnt}
                      </span>
                    )}
                    {a.isHumanGate && (<span style={{ fontSize: 11, color: '#a78bfa' }}>🔐</span>)}
                    {m.meta.auto && !a.isHumanGate && (<span style={{ fontSize: 10, color: '#22c55e', fontWeight: 700 }}>⚡</span>)}
                    {m.meta.paused && (<span style={{ fontSize: 10, color: '#fb923c' }}>⏸</span>)}
                  </div>
                )}
              </button>
              {/* Stage connector — fading stem + chevron arrowhead, matches
                  flowchart conventions and reads cleaner than a unicode ↓. */}
              {idx < AGENTS.length - 1 && (
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  padding: '6px 0', userSelect: 'none', flexShrink: 0,
                }}>
                  <div style={{
                    width: 2, height: 14,
                    background: 'linear-gradient(to bottom, transparent, #6366f1)',
                    borderRadius: 1,
                  }} />
                  <div style={{
                    width: 0, height: 0,
                    borderLeft: '5px solid transparent',
                    borderRight: '5px solid transparent',
                    borderTop: '7px solid #6366f1',
                    marginTop: -1,
                    opacity: 0.85,
                  }} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Right column: selected stage detail */}
      <div style={{ flex: '1 1 600px', minWidth: 320, display: 'flex', flexDirection: 'column' }}>

    {/* Detail panel — only the selected stage */}
    {AGENTS.filter(a => a.key === (selectedAgent ?? AGENTS[0].key)).map((agent) => {
      const meta = agents[agent.key] ?? { auto: false, paused: false };
      const pendingCnt = agent.pendingStatus ? (pending[agent.pendingStatus] ?? 0) : null;
      const summary = summaryMap.get(agent.key);
      const busy = busyAgent === agent.key;
      const stopped = state?.globalStop || meta.paused;
      const badge = riskBadge(agent.riskLevel, agent.isHumanGate);
      const queue = queues.find(q => q.name === agent.key || q.name === agent.key.replace('-', ''));
      const isProcessing = (queue?.counts.active ?? 0) > 0;

      return (
        <div key={agent.key} style={{ marginBottom: 10 }}>

          {/* Stage row */}
          <div style={{
            background: '#1e293b',
            borderTop: `1px solid ${agent.isHumanGate ? '#4c1d95' : stopped ? '#374151' : '#334155'}`,
            borderRight: `1px solid ${agent.isHumanGate ? '#4c1d95' : stopped ? '#374151' : '#334155'}`,
            borderBottom: `1px solid ${agent.isHumanGate ? '#4c1d95' : stopped ? '#374151' : '#334155'}`,
            borderLeft: `4px solid ${stopped ? '#475569' : agent.color}`,
            borderRadius: 10,
            padding: '16px 18px',
            opacity: stopped && !agent.isHumanGate ? 0.7 : 1,
          }}>
            {/* Header: title + chips on left, controls on right */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: agent.color, background: `${agent.color}22`, padding: '1px 7px', borderRadius: 6 }}>
                    #{agent.num} {dayLabel(agent.dayNum)}
                  </span>
                  {badge && (
                    <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 6, background: badge.bg, color: badge.fg }}>
                      {badge.text}
                    </span>
                  )}
                  {isProcessing && (
                    <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 6, background: '#1e3a5f', color: '#60a5fa' }}>
                      ⟳ 处理中
                    </span>
                  )}
                  {meta.auto && !agent.isHumanGate && (
                    <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 6, background: '#14532d', color: '#86efac' }}>⚡ 自动模式</span>
                  )}
                  {meta.paused && (
                    <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 6, background: '#451a03', color: '#fb923c' }}>⏸ 已暂停</span>
                  )}
                </div>
                <div style={{ fontSize: 17, fontWeight: 700, color: '#f1f5f9' }}>{agent.name}</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>{agent.desc}</div>
              </div>

              {/* Controls */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>

                {/* Auto toggle (hidden for hard human gates) */}
                {!agent.isHumanGate && (
                  <button
                    onClick={() => setAuto(agent.key, !meta.auto)}
                    style={{
                      padding: '5px 12px', borderRadius: 6, border: '1px solid',
                      borderColor: meta.auto ? agent.color : '#334155',
                      background: meta.auto ? `${agent.color}22` : 'transparent',
                      color: meta.auto ? agent.color : '#475569',
                      fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}>
                    {meta.auto ? '⚡ 自动' : '手动'}
                  </button>
                )}

                {/* Pause toggle */}
                <button
                  onClick={() => setPaused(agent.key, !meta.paused)}
                  style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #334155', background: meta.paused ? '#451a03' : 'transparent', color: meta.paused ? '#fb923c' : '#475569', fontSize: 12, cursor: 'pointer' }}>
                  {meta.paused ? '⏸ 暂停中' : '⏸'}
                </button>

                {/* Manual run */}
                <button
                  disabled={busy || (state?.globalStop ?? false) || meta.paused || agent.isHumanGate}
                  onClick={() => runAgent(agent.key, agent.name)}
                  style={{
                    padding: '6px 16px', borderRadius: 6, border: 'none',
                    background: (busy || state?.globalStop || meta.paused || agent.isHumanGate) ? '#1e293b' : agent.color,
                    color: (busy || state?.globalStop || meta.paused || agent.isHumanGate) ? '#475569' : '#fff',
                    fontSize: 13, fontWeight: 600, cursor: (busy || state?.globalStop || meta.paused || agent.isHumanGate) ? 'not-allowed' : 'pointer',
                    minWidth: 80,
                  }}>
                  {busy ? '执行中…' : agent.isHumanGate ? '人工门控' : '▶ 执行'}
                </button>
              </div>
            </div>

            {/* Stats grid: 4 cards laid out evenly. For agents that don't
                process items by status (source-scoring / ingestion), the
                "待处理" tile turns into a 24h call-count instead of a stale
                em-dash. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 4 }}>
              <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '10px 12px' }}>
                {agent.pendingStatus ? (
                  <>
                    <div style={{ fontSize: 10, color: '#475569', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>待处理</div>
                    <div style={{
                      fontSize: 24, fontWeight: 800,
                      color: pendingCnt && pendingCnt > 0 ? agent.color : '#334155',
                      lineHeight: 1.2, marginTop: 2,
                    }}>
                      {pendingCnt ?? 0}
                    </div>
                    <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>状态 {agent.pendingStatus}</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 10, color: '#475569', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>近 24h 调用</div>
                    <div style={{
                      fontSize: 24, fontWeight: 800,
                      color: (summary?.total ?? 0) > 0 ? agent.color : '#334155',
                      lineHeight: 1.2, marginTop: 2,
                    }}>
                      {summary?.total ?? 0}
                    </div>
                    <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>无队列阻塞</div>
                  </>
                )}
              </div>

              <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, color: '#475569', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>近 24h 成败</div>
                <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.3, marginTop: 2 }}>
                  <span style={{ color: '#22c55e' }}>✓ {summary?.success ?? 0}</span>
                  <span style={{ color: '#475569', margin: '0 6px' }}>/</span>
                  <span style={{ color: (summary?.failed ?? 0) > 0 ? '#f87171' : '#475569' }}>✗ {summary?.failed ?? 0}</span>
                </div>
                <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>
                  {summary && (summary.success + summary.failed) > 0
                    ? `${((summary.success / (summary.success + summary.failed)) * 100).toFixed(0)}% 成功`
                    : '暂无数据'}
                </div>
              </div>

              <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, color: '#475569', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>平均延迟</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#60a5fa', lineHeight: 1.2, marginTop: 2 }}>
                  {summary?.avg_latency_ms ? `${summary.avg_latency_ms}` : '—'}
                  <span style={{ fontSize: 12, color: '#475569', marginLeft: 4, fontWeight: 600 }}>ms</span>
                </div>
                <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>每次调用</div>
              </div>

              <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, color: '#475569', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>近 24h 成本</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#a78bfa', lineHeight: 1.2, marginTop: 2 }}>
                  ${Number(summary?.total_cost_usd ?? 0).toFixed(4)}
                </div>
                <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>USD</div>
              </div>
            </div>

            {/* ── Live strip: 正在处理 + 最近完成 ── */}
            <LiveStrip
              active={liveJobs.active[agent.key] ?? []}
              recent={liveJobs.recent[agent.key] ?? []}
              color={agent.color}
              onClickItem={(id) => showHistory(id)}
            />

            {/* ── COMPLIANCE REVIEW human gate (inline) ── */}
            {agent.key === 'compliance' && reviewItems.length > 0 && (
              <div style={{ marginTop: 14, borderTop: '1px solid #334155', paddingTop: 12 }}>
                <div style={{ fontSize: 12, color: '#f59e0b', marginBottom: 8, fontWeight: 600 }}>
                  ⚠ {reviewItems.length} 条待人工审核（机器建议复核）
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                  {reviewItems.map(item => (
                    <div key={item.id} style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '10px 12px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      <div
                        onClick={() => showHistory(item.id)}
                        style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                        title="点击查看完整内容">
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#93c5fd', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}>
                          {item.title}
                        </div>
                        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>来源: {item.source}</div>
                        {item.risk_tags.length > 0 && (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {item.risk_tags.map(t => (
                              <span key={t} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, background: '#7f1d1d', color: '#fca5a5' }}>{t}</span>
                            ))}
                          </div>
                        )}
                        {item.summary && <div style={{ fontSize: 11, color: '#475569', marginTop: 4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{item.summary}</div>}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: '#78350f', color: '#fde68a', textAlign: 'center' }}>机器: 建议复核</span>
                        <button onClick={() => approveReview(item.id)} style={{ padding: '4px 12px', borderRadius: 5, border: 'none', background: '#14532d', color: '#86efac', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>✓ 批准</button>
                        <button onClick={() => rejectReview(item.id)} style={{ padding: '4px 12px', borderRadius: 5, border: 'none', background: '#450a0a', color: '#fca5a5', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>✗ 拒绝</button>
                        <button onClick={() => showHistory(item.id)} style={{ padding: '4px 12px', borderRadius: 5, border: '1px solid #334155', background: 'transparent', color: '#64748b', fontSize: 11, cursor: 'pointer' }}>追踪</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── PUBLISHING human gate (inline) ── */}
            {agent.key === 'publishing' && (
              <div style={{ marginTop: 14, borderTop: '1px solid #4c1d95', paddingTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <span style={{ fontSize: 12, color: '#a78bfa', fontWeight: 600 }}>
                    🔐 {publishItems.length} 篇待人工批准发布
                  </span>
                  {publishItems.length > 0 && (
                    <>
                      <button
                        onClick={() => approvePublish(selectedItems.size > 0 ? [...selectedItems] : undefined)}
                        style={{ padding: '5px 14px', borderRadius: 6, border: 'none', background: '#4c1d95', color: '#ddd6fe', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                        {selectedItems.size > 0 ? `批准选中 ${selectedItems.size} 篇` : `批准全部 ${publishItems.length} 篇`}
                      </button>
                      {selectedItems.size > 0 && (
                        <button onClick={() => setSelectedItems(new Set())} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #334155', background: 'transparent', color: '#64748b', fontSize: 11, cursor: 'pointer' }}>清除选择</button>
                      )}
                    </>
                  )}
                </div>
                {publishItems.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#334155', padding: '10px 0' }}>暂无待发布文章</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 240, overflowY: 'auto' }}>
                    {publishItems.map(item => (
                      <div key={item.id} style={{ background: '#0f172a', border: `1px solid ${selectedItems.has(item.id) ? '#7c3aed' : '#1e293b'}`, borderRadius: 7, padding: '9px 12px', display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}
                        onClick={() => setSelectedItems(prev => { const n = new Set(prev); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n; })}>
                        <input type="checkbox" readOnly checked={selectedItems.has(item.id)} style={{ accentColor: '#7c3aed', flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
                          <div style={{ fontSize: 11, color: '#475569' }}>{item.category ?? '—'} · {item.source}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={e => { e.stopPropagation(); approvePublish([item.id]); }} style={{ padding: '3px 10px', borderRadius: 5, border: 'none', background: '#4c1d95', color: '#ddd6fe', fontSize: 11, cursor: 'pointer' }}>发布</button>
                          <button onClick={e => { e.stopPropagation(); showHistory(item.id); }} style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid #334155', background: 'transparent', color: '#64748b', fontSize: 11, cursor: 'pointer' }}>追踪</button>
                          <button onClick={e => { e.stopPropagation(); rollback(item.id, item.title); }} style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid #334155', background: 'transparent', color: '#f87171', fontSize: 11, cursor: 'pointer' }}>回滚</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── DISTRIBUTION human gate (inline) ── */}
            {agent.key === 'distribution' && (
              <div style={{ marginTop: 14, borderTop: '1px solid #1e3a5f', paddingTop: 12 }}>
                <div style={{ fontSize: 12, color: '#60a5fa', marginBottom: 8, fontWeight: 600 }}>
                  🔐 {distTasks.length} 条待人工确认分发（复制文案后手动发布）
                </div>
                {distTasks.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#334155', padding: '10px 0' }}>暂无待分发任务 · 先点上方「执行」生成文案</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
                    {distTasks.map(task => (
                      <div key={task.task_id} style={{ background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 8, padding: '10px 12px' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#93c5fd', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</div>
                        <pre style={{ margin: '0 0 8px', fontSize: 12, color: '#e2e8f0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#1e293b', padding: '8px 10px', borderRadius: 5, lineHeight: 1.6 }}>{task.copy}</pre>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <CopyBtn text={task.copy} />
                          <button onClick={() => confirmDist(task.task_id)} style={{ padding: '3px 12px', borderRadius: 5, border: 'none', background: '#1e3a5f', color: '#60a5fa', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>✓ 已发出</button>
                          <button onClick={() => showHistory(task.item_id)} style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid #334155', background: 'transparent', color: '#64748b', fontSize: 11, cursor: 'pointer' }}>追踪</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      );
    })}

      </div>
      {/* end right-column wrapper */}
    </div>
    {/* end vertical-stepper + detail flex container */}

    {/* Queue snapshot + recent runs panel hidden in pipeline tab —
        still available on the dedicated 队列 & 成本 tab. */}
    </>
  );
}
