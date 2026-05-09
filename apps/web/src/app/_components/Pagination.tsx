import Link from 'next/link';

// Server-rendered numeric pagination. Each page link is a real URL with all
// existing search params preserved + page=N — keeps history navigable, copy-
// pasteable, and fully crawlable for SEO long-tail pages.
export function Pagination({
  basePath, searchParams, page, total, pageSize, window = 2,
}: {
  basePath: string;
  // Loose by design — page-level SearchParams interfaces are closed shapes that
  // lack index signatures. We only read string values out, so any object works.
  searchParams: Record<string, unknown>;
  page: number;
  total: number;
  pageSize: number;
  /** how many neighbours to show either side of current */
  window?: number;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const link = (n: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (k === 'page' || v == null) continue;
      const s = Array.isArray(v) ? String(v[0] ?? '') : String(v);
      if (s) params.set(k, s);
    }
    if (n > 1) params.set('page', String(n));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const pages: Array<number | '…'> = [];
  const lo = Math.max(1, page - window);
  const hi = Math.min(totalPages, page + window);
  if (lo > 1) { pages.push(1); if (lo > 2) pages.push('…'); }
  for (let i = lo; i <= hi; i++) pages.push(i);
  if (hi < totalPages) { if (hi < totalPages - 1) pages.push('…'); pages.push(totalPages); }

  return (
    <nav aria-label="分页" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4, marginTop: 28, flexWrap: 'wrap' }}>
      {page > 1 && (
        <Link href={link(page - 1)} style={btn(false)}>‹ 上一页</Link>
      )}
      {pages.map((p, i) =>
        p === '…' ? (
          <span key={`g-${i}`} style={{ padding: '5px 6px', fontSize: 12, color: '#475569' }}>…</span>
        ) : (
          <Link key={p} href={link(p)} style={btn(p === page)}>{p}</Link>
        ),
      )}
      {page < totalPages && (
        <Link href={link(page + 1)} style={btn(false)}>下一页 ›</Link>
      )}
    </nav>
  );
}

function btn(active: boolean): React.CSSProperties {
  return {
    padding: '5px 11px',
    minWidth: 32,
    textAlign: 'center',
    borderRadius: 6,
    border: `1px solid ${active ? '#6366f1' : '#334155'}`,
    background: active ? '#6366f1' : 'transparent',
    color: active ? '#fff' : '#94a3b8',
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    textDecoration: 'none',
  };
}
