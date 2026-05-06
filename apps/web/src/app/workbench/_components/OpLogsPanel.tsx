'use client';

import { useState, useEffect, useCallback } from 'react';
import { API } from './constants';
import { fmtTs, payloadPreview, pageNumbers } from './utils';

// ─── OpLogRow interface ───────────────────────────────────────────────────────

interface OpLogRow {
  id: string;
  operator: string;
  operator_id: string | null;
  occurred_at: string;
  operation: string;
  target_type: string;
  target_id: string | null;
  payload: Record<string, unknown>;
  request_id: string | null;
  http_method: string | null;
  http_path: string | null;
  status_code: number | null;
  ip: string | null;
  user_agent: string | null;
}

// Friendly Chinese label for the most common operation strings. Anything not
// in the map falls back to the raw string — covers extension by the catch-all
// hook without requiring code changes here.
const OP_LABEL: Record<string, string> = {
  'source.create':              '新增信源',
  'source.upsert':              '新增信源（重复键覆盖）',
  'source.update':              '编辑信源',
  'source.delete':              '删除信源',
  'source.batch-import':        '批量导入信源',
  'compliance.approve':         '合规放行',
  'compliance.reject':          '合规拒绝',
  'distribution.edit-copy':     '编辑推文文案',
  'distribution.queue':         '加入分发队列',
  'distribution.batch-queue':   '批量分发',
  'distribution.confirm':       '确认分发完成',
  'publish.approve':            '放行发布',
  'publish.force':              '强制发布',
  'publish.batch':              '批量发布',
  'item.unpublish':             '紧急下线',
  'item.rollback':              '状态回滚',
  'item.rerun':                 '重跑某 Agent',
  'system.emergency-stop':      '全局急停',
  'system.resume':              '恢复运行',
  'pipeline.set-auto':          '切换自动模式',
  'pipeline.set-paused':        '暂停/恢复 Agent',
  'source-scoring.run':         '触发信源打分',
  'analytics.pull':             '触发数据回流',
};

const TARGET_LABEL: Record<string, string> = {
  source:             '信源',
  item:               '文章',
  distribution_task:  '分发任务',
  credential:         '凭证',
  agent:              'Agent',
  system:             '系统',
};

const TARGET_OPTIONS = ['', 'source', 'item', 'distribution_task', 'credential', 'agent', 'system'];

function PageBtn({
  label, active, disabled, onClick,
}: { label: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '5px 10px',
        minWidth: 32,
        borderRadius: 6,
        border: '1px solid ' + (active ? '#6366f1' : '#334155'),
        background: active ? '#6366f1' : 'transparent',
        color: disabled ? '#334155' : active ? '#fff' : '#94a3b8',
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >{label}</button>
  );
}

export function OpLogsPanel() {
  const [logs, setLogs] = useState<OpLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [modalLog, setModalLog] = useState<OpLogRow | null>(null);
  const PAGE_SIZE = 50;

  const [fOperator, setFOperator]     = useState('');
  const [fOperation, setFOperation]   = useState('');
  const [fTargetType, setFTargetType] = useState('');
  const [fTargetId, setFTargetId]     = useState('');
  // The values *applied* to the current fetch. We only push form state into
  // these on Search / Enter so typing doesn't fire a request per keystroke.
  const [applied, setApplied] = useState({ operator: '', operation: '', targetType: '', targetId: '' });

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(page * PAGE_SIZE));
      if (applied.operator)   params.set('operator',    applied.operator);
      if (applied.operation)  params.set('operation',   applied.operation);
      if (applied.targetType) params.set('target_type', applied.targetType);
      if (applied.targetId)   params.set('target_id',   applied.targetId);
      const r = await fetch(`${API}/admin/op-logs?${params.toString()}`, { cache: 'no-store' });
      const j = await r.json();
      setLogs(j.logs ?? []);
      setTotal(j.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [page, applied]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  function applyFilters() {
    setApplied({
      operator: fOperator.trim(),
      operation: fOperation.trim(),
      targetType: fTargetType,
      targetId: fTargetId.trim(),
    });
    setPage(0);
  }

  function clearFilters() {
    setFOperator(''); setFOperation(''); setFTargetType(''); setFTargetId('');
    setApplied({ operator: '', operation: '', targetType: '', targetId: '' });
    setPage(0);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = !!(applied.operator || applied.operation || applied.targetType || applied.targetId);

  return (
    <div style={{ marginTop: 16 }}>

      {/* Filter bar */}
      <div style={{
        background: '#1e293b', border: '1px solid #334155', borderRadius: 10,
        padding: '12px 14px', marginBottom: 12,
        display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
      }}>
        <input
          placeholder="操作人"
          value={fOperator}
          onChange={(e) => setFOperator(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
          style={{
            background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0',
            borderRadius: 6, padding: '6px 10px', fontSize: 12.5, width: 130,
          }}
        />
        <input
          placeholder="操作类型，如 source.create"
          value={fOperation}
          onChange={(e) => setFOperation(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
          style={{
            background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0',
            borderRadius: 6, padding: '6px 10px', fontSize: 12.5, width: 200,
          }}
        />
        <select
          value={fTargetType}
          onChange={(e) => setFTargetType(e.target.value)}
          style={{
            background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0',
            borderRadius: 6, padding: '6px 10px', fontSize: 12.5, minWidth: 120,
          }}
        >
          {TARGET_OPTIONS.map(t => (
            <option key={t} value={t}>{t === '' ? '全部目标类型' : (TARGET_LABEL[t] ?? t)}</option>
          ))}
        </select>
        <input
          placeholder="目标 ID（精确匹配）"
          value={fTargetId}
          onChange={(e) => setFTargetId(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
          style={{
            background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0',
            borderRadius: 6, padding: '6px 10px', fontSize: 12.5, width: 280, fontFamily: 'monospace',
          }}
        />
        <button onClick={applyFilters}
          style={{ background: '#6366f1', border: 'none', color: '#fff', borderRadius: 6, padding: '7px 16px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
          查询
        </button>
        {hasFilters && (
          <button onClick={clearFilters}
            style={{ background: 'transparent', border: '1px solid #334155', color: '#94a3b8', borderRadius: 6, padding: '6px 12px', fontSize: 12.5, cursor: 'pointer' }}>
            清空
          </button>
        )}
        <button onClick={fetchLogs} disabled={loading}
          style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid #334155', color: loading ? '#475569' : '#94a3b8', borderRadius: 6, padding: '6px 12px', fontSize: 12.5, cursor: loading ? 'wait' : 'pointer' }}>
          {loading ? '加载中…' : '刷新'}
        </button>
        <span style={{ fontSize: 12, color: '#64748b' }}>
          共 {total.toLocaleString()} 条
        </span>
      </div>

      {/* Table */}
      <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#0f172a', color: '#64748b', textAlign: 'left' }}>
              <th style={{ padding: '8px 12px', fontWeight: 600, width: 160 }}>时间</th>
              <th style={{ padding: '8px 12px', fontWeight: 600, width: 120 }}>操作人</th>
              <th style={{ padding: '8px 12px', fontWeight: 600, width: 200 }}>操作</th>
              <th style={{ padding: '8px 12px', fontWeight: 600, width: 90 }}>目标</th>
              <th style={{ padding: '8px 12px', fontWeight: 600 }}>对象 / 摘要</th>
              <th style={{ padding: '8px 12px', fontWeight: 600, width: 60, textAlign: 'right' }}>状态</th>
            </tr>
          </thead>
          <tbody>
            {logs.map(l => {
              const label = OP_LABEL[l.operation] ?? l.operation;
              const tgtLabel = TARGET_LABEL[l.target_type] ?? l.target_type;
              const isAuto = (l.payload as { auto?: boolean })?.auto === true;
              return (
                <tr key={l.id}
                  onClick={() => setModalLog(l)}
                  style={{ borderTop: '1px solid #0f172a', cursor: 'pointer' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#0f172a')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '8px 12px', color: '#94a3b8', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                    {fmtTs(l.occurred_at)}
                  </td>
                  <td style={{ padding: '8px 12px', color: '#e2e8f0', fontWeight: 500 }}>
                    {l.operator}
                    {l.operator === 'anonymous' && (
                      <span style={{ marginLeft: 4, color: '#64748b', fontSize: 10 }}>(匿名)</span>
                    )}
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ color: '#a78bfa', fontWeight: 500 }}>{label}</span>
                    {label !== l.operation && (
                      <div style={{ color: '#475569', fontSize: 10.5, fontFamily: 'monospace', marginTop: 2 }}>
                        {l.operation}{isAuto && ' · auto'}
                      </div>
                    )}
                    {label === l.operation && isAuto && (
                      <span style={{ marginLeft: 4, color: '#475569', fontSize: 10 }}>auto</span>
                    )}
                  </td>
                  <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{tgtLabel}</td>
                  <td style={{ padding: '8px 12px', color: '#cbd5e1', maxWidth: 0, overflow: 'hidden' }}>
                    {l.target_id && (
                      <div style={{ color: '#64748b', fontFamily: 'monospace', fontSize: 11, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {l.target_id}
                      </div>
                    )}
                    <div style={{ color: '#94a3b8', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {payloadPreview(l.payload)}
                    </div>
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace' }}>
                    <span style={{
                      color: l.status_code === null ? '#475569' :
                             l.status_code < 400 ? '#34d399' : '#f87171',
                    }}>
                      {l.status_code ?? '—'}
                    </span>
                  </td>
                </tr>
              );
            })}
            {logs.length === 0 && !loading && (
              <tr><td colSpan={6} style={{ padding: '40px 12px', textAlign: 'center', color: '#475569' }}>
                {hasFilters ? '没有符合条件的记录' : '暂无操作日志'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination — same numbered-jump pattern as 采集预览. */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4, marginTop: 16, flexWrap: 'wrap' }}>
          <PageBtn label="« 首页" disabled={page === 0} onClick={() => setPage(0)} />
          <PageBtn label="‹ 上一页" disabled={page === 0} onClick={() => setPage(Math.max(0, page - 1))} />

          {pageNumbers(page, totalPages).map((p, idx) =>
            p === '…' ? (
              <span key={`gap-${idx}`} style={{ padding: '5px 6px', fontSize: 12, color: '#475569' }}>…</span>
            ) : (
              <PageBtn key={p} label={String(p + 1)} active={p === page} onClick={() => setPage(p)} />
            ),
          )}

          <PageBtn label="下一页 ›" disabled={page >= totalPages - 1} onClick={() => setPage(Math.min(totalPages - 1, page + 1))} />
          <PageBtn label="末页 »" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)} />

          <span style={{ marginLeft: 12, fontSize: 12, color: '#64748b' }}>第 {page + 1} / {totalPages} 页</span>
        </div>
      )}

      {/* Detail modal */}
      {modalLog && (
        <div onClick={() => setModalLog(null)}
          style={{ position: 'fixed', inset: 0, background: '#000c', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, cursor: 'zoom-out' }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '760px', width: '100%', maxHeight: '85vh', overflow: 'auto', background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: '20px 24px', cursor: 'default' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
              <h3 style={{ margin: 0, color: '#e2e8f0', fontSize: 16 }}>
                {OP_LABEL[modalLog.operation] ?? modalLog.operation}
              </h3>
              <button onClick={() => setModalLog(null)}
                style={{ background: 'transparent', border: 'none', color: '#64748b', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>
                ×
              </button>
            </div>

            <table style={{ width: '100%', fontSize: 12.5, marginBottom: 14 }}>
              <tbody>
                {[
                  ['操作类型', modalLog.operation],
                  ['操作人', `${modalLog.operator}${modalLog.operator_id ? ` (${modalLog.operator_id})` : ''}`],
                  ['操作时间', fmtTs(modalLog.occurred_at)],
                  ['目标类型', TARGET_LABEL[modalLog.target_type] ?? modalLog.target_type],
                  ['目标 ID', modalLog.target_id ?? '—'],
                  ['HTTP', `${modalLog.http_method ?? '?'} ${modalLog.http_path ?? '?'}`],
                  ['响应码', modalLog.status_code ?? '—'],
                  ['IP', modalLog.ip ?? '—'],
                  ['请求 ID', modalLog.request_id ?? '—'],
                ].map(([k, v]) => (
                  <tr key={k as string}>
                    <td style={{ padding: '4px 12px 4px 0', color: '#64748b', whiteSpace: 'nowrap', verticalAlign: 'top', width: 90 }}>{k}</td>
                    <td style={{ padding: '4px 0', color: '#e2e8f0', fontFamily: typeof v === 'string' && /^[a-f0-9-]{8,}/i.test(v) ? 'monospace' : 'inherit', wordBreak: 'break-all' }}>{String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>Payload</div>
            <pre style={{
              background: '#0f172a', border: '1px solid #334155', borderRadius: 6,
              padding: '12px 14px', margin: 0,
              fontSize: 11.5, color: '#cbd5e1',
              overflow: 'auto', maxHeight: 360,
              fontFamily: '"JetBrains Mono", "SF Mono", Menlo, monospace',
            }}>{JSON.stringify(modalLog.payload, null, 2)}</pre>

            {modalLog.user_agent && (
              <div style={{ marginTop: 10, fontSize: 11, color: '#475569', wordBreak: 'break-all' }}>
                UA: {modalLog.user_agent}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
