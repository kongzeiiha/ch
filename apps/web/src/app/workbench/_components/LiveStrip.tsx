'use client';

export function LiveStrip({
  active, recent, color, onClickItem,
}: {
  active: Array<{ itemId: string | null; label: string; since: string | null }>;
  recent: Array<{ agent: string; item_id: string | null; title: string | null; finished_at: string; latency_ms: number | null; status: string }>;
  color: string;
  onClickItem: (id: string) => void;
}) {
  if (active.length === 0 && recent.length === 0) return null;

  const fmtSince = (iso: string | null) => {
    if (!iso) return '';
    const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m${sec % 60}s`;
  };

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #334155', fontSize: 11 }}>
      {active.length > 0 && (
        <div style={{ marginBottom: recent.length > 0 ? 8 : 0 }}>
          <div style={{ color: color, fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: color, animation: 'pulse 1s infinite' }} />
            正在处理 · {active.length}
          </div>
          {active.map((a, i) => (
            <div key={i}
              onClick={() => a.itemId && onClickItem(a.itemId)}
              title={a.itemId ? '点击查看详情' : ''}
              style={{
                padding: '4px 8px', marginBottom: 2,
                background: '#0f172a', borderRadius: 4,
                color: '#cbd5e1',
                cursor: a.itemId ? 'pointer' : 'default',
                display: 'flex', gap: 8, alignItems: 'center',
                overflow: 'hidden',
              }}>
              <span style={{ color: '#64748b', fontSize: 10, flexShrink: 0, minWidth: 28 }}>{fmtSince(a.since)}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.label}</span>
            </div>
          ))}
        </div>
      )}
      {recent.length > 0 && (
        <div>
          <div style={{ color: '#64748b', fontWeight: 600, marginBottom: 4 }}>最近完成 · {recent.length}</div>
          {recent.map((r, i) => (
            <div key={i}
              onClick={() => r.item_id && onClickItem(r.item_id)}
              title={r.item_id ? '点击查看详情' : ''}
              style={{
                padding: '4px 8px', marginBottom: 2,
                background: '#0f172a', borderRadius: 4,
                color: '#94a3b8',
                cursor: r.item_id ? 'pointer' : 'default',
                display: 'flex', gap: 8, alignItems: 'center',
                overflow: 'hidden',
                opacity: r.status === 'success' ? 1 : 0.7,
              }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                background: r.status === 'success' ? '#22c55e' : '#ef4444',
              }} />
              <span style={{ color: '#64748b', fontSize: 10, flexShrink: 0, minWidth: 42 }}>
                {r.latency_ms ? `${r.latency_ms}ms` : '—'}
              </span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.title ?? (r.item_id ? `item ${r.item_id.slice(0, 8)}` : '—')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
