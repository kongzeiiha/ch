'use client';

// Per-category accent for chips. Each entry: [背景色, 文字色]. Falls back to
// neutral slate when an unmapped category sneaks in.
const CATEGORY_PALETTE: Record<string, [string, string]> = {
  'AI':         ['#312e81', '#c7d2fe'],
  // '硬件':        ['#155e75', '#a5f3fc'],
  // '软件工程':     ['#1e3a8a', '#bfdbfe'],
  // '网络安全':     ['#7f1d1d', '#fecaca'],
  // '互联网产品':   ['#4c1d95', '#ddd6fe'],
  // '创业与投资':   ['#78350f', '#fde68a'],
  // '金融市场':     ['#713f12', '#fef08a'],
  // '加密货币':     ['#7c2d12', '#fed7aa'],
  // '物理与天文':   ['#0c4a6e', '#bae6fd'],
  // '生命科学':     ['#064e3b', '#a7f3d0'],
  // '气候与环境':   ['#14532d', '#bbf7d0'],
  // '政治与政策':   ['#881337', '#fecdd3'],
  // '社会新闻':     ['#831843', '#fbcfe8'],

  '探花':        ['#155e75', '#a5f3fc'],
  '丝袜':     ['#1e3a8a', '#bfdbfe'],
  '偷拍':     ['#7f1d1d', '#fecaca'],
  '调教':   ['#4c1d95', '#ddd6fe'],
  '创业与投资':   ['#78350f', '#fde68a'],
  '自拍':     ['#713f12', '#fef08a'],
  '熟女':     ['#7c2d12', '#fed7aa'],
  '自慰':   ['#0c4a6e', '#bae6fd'],
  '动漫':     ['#064e3b', '#a7f3d0'],
  '萝莉':   ['#14532d', '#bbf7d0'],
  'SM':   ['#881337', '#fecdd3'],
  '剧情':     ['#831843', '#fbcfe8'],
  '网曝门':     ['#831843', '#fbcfe8'],
  '美乳':     ['#831843', '#fbcfe8'],
  '内射':     ['#831843', '#fbcfe8'],
  '口射':     ['#831843', '#fbcfe8'],
  '巨乳':     ['#831843', '#fbcfe8'],
  '反差':     ['#831843', '#fbcfe8'],
  '文化艺术':     ['#86198f', '#f5d0fe'],
  // '生活方式':     ['#3f6212', '#d9f99d'],
  '其他':        ['#1e293b', '#71767b'],
};
const DEFAULT_CHIP: [string, string] = ['#1e293b', '#71767b'];

export function LiveStrip({
  active, recent, color, onClickItem,
}: {
  active: Array<{ itemId: string | null; label: string; since: string | null }>;
  recent: Array<{
    agent: string;
    item_id: string | null;
    title: string | null;
    category: string | null;
    tags: string[] | null;
    finished_at: string;
    latency_ms: number | null;
    status: string;
    summary?: string;
    movers?: Array<{ name: string; before: number; after: number }>;
  }>;
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
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #3e4144', fontSize: 11 }}>
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
                color: '#e7e9ea',
                cursor: a.itemId ? 'pointer' : 'default',
                display: 'flex', gap: 8, alignItems: 'center',
                overflow: 'hidden',
              }}>
              <span style={{ color: '#71767b', fontSize: 10, flexShrink: 0, minWidth: 28 }}>{fmtSince(a.since)}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.label}</span>
            </div>
          ))}
        </div>
      )}
      {recent.length > 0 && (
        <div>
          <div style={{ color: '#71767b', fontWeight: 600, marginBottom: 4 }}>最近完成 · {recent.length}</div>
          {recent.map((r, i) => (
            <div key={i}
              onClick={() => r.item_id && onClickItem(r.item_id)}
              title={r.item_id ? '点击查看详情' : ''}
              style={{
                padding: r.summary ? '6px 8px' : '4px 8px', marginBottom: 2,
                background: '#0f172a', borderRadius: 4,
                color: '#71767b',
                cursor: r.item_id ? 'pointer' : 'default',
                overflow: 'hidden',
                opacity: r.status === 'success' ? 1 : 0.7,
              }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', overflow: 'hidden' }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                  background: r.status === 'success' ? '#22c55e' : '#ef4444',
                }} />
                <span style={{ color: '#71767b', fontSize: 10, flexShrink: 0, minWidth: 42 }}>
                  {r.latency_ms ? `${r.latency_ms}ms` : '—'}
                </span>
                {!r.summary && r.category && (() => {
                  const [bg, fg] = CATEGORY_PALETTE[r.category] ?? DEFAULT_CHIP;
                  const tooltip = r.tags && r.tags.length > 0
                    ? `${r.category} · ${r.tags.slice(0, 5).join(' / ')}`
                    : r.category;
                  return (
                    <span
                      title={tooltip}
                      style={{
                        flexShrink: 0, fontSize: 10, fontWeight: 600,
                        padding: '1px 7px', borderRadius: 10,
                        background: bg, color: fg,
                      }}>
                      {r.category}
                    </span>
                  );
                })()}
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: r.summary ? '#e7e9ea' : '#71767b' }}>
                  {r.summary ?? r.title ?? (r.item_id ? `item ${r.item_id.slice(0, 8)}` : '—')}
                </span>
              </div>
              {r.movers && r.movers.length > 0 && (
                <div style={{ marginTop: 4, paddingLeft: 56, display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 10.5 }}>
                  {r.movers.map((m, j) => {
                    const delta = m.after - m.before;
                    const arrow = delta > 0 ? '↗' : delta < 0 ? '↘' : '→';
                    const c = delta > 0 ? '#34d399' : delta < 0 ? '#f87171' : '#71767b';
                    return (
                      <span key={j} style={{ color: c, whiteSpace: 'nowrap' }}>
                        {arrow} <span style={{ color: '#e7e9ea' }}>{m.name}</span>
                        <span style={{ color: '#71767b' }}> {m.before}→{m.after}</span>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
