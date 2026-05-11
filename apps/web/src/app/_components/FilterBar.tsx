import Link from 'next/link';
import { LENGTH_BUCKETS, DATE_BUCKETS, type LengthBucket, type DateBucket } from '../../lib/feed';

interface Props {
  basePath: string;
  current: {
    tag?: string;
    length?: LengthBucket;
    date?: DateBucket;
    sort?: 'latest' | 'hot';
  };
  /** Available tags within the current scope (category, search etc.). */
  tags?: { tag: string; count: number }[];
}

// Server-rendered filter bar. Each pill is a real <Link> that swaps a single
// query param while preserving the others — keeps URLs shareable, SEO-clean,
// and works without JS.
//
// Note: the legacy 题材 (keywords) row was removed — keywords and tags come
// from the same LLM classifier and the two rows were almost always identical.
// The `keyword` URL param is no longer supported.
export function FilterBar({ basePath, current, tags }: Props) {
  const link = (override: Partial<Props['current']>) => {
    const next = { ...current, ...override };
    const params = new URLSearchParams();
    if (next.tag)     params.set('tag', next.tag);
    if (next.length)  params.set('length', next.length);
    if (next.date)    params.set('date', next.date);
    if (next.sort && next.sort !== 'latest') params.set('sort', next.sort);
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      padding: 14,
      background: '#0f172a',
      border: '1px solid #1e293b',
      borderRadius: 8,
      marginBottom: 20,
    }}>
      <Row label="排序">
        <Pill active={current.sort !== 'hot'}  href={link({ sort: 'latest' })}>最新</Pill>
        <Pill active={current.sort === 'hot'}  href={link({ sort: 'hot' })}>最热</Pill>
      </Row>

      <Row label="时长">
        <Pill active={!current.length} href={link({ length: undefined })}>全部</Pill>
        {(Object.keys(LENGTH_BUCKETS) as LengthBucket[]).map((k) => (
          <Pill key={k} active={current.length === k} href={link({ length: k })}>
            {LENGTH_BUCKETS[k].label}
          </Pill>
        ))}
      </Row>

      <Row label="更新日期">
        <Pill active={!current.date || current.date === 'all'} href={link({ date: 'all' })}>{DATE_BUCKETS.all.label}</Pill>
        {(['7d', '30d', '90d'] as DateBucket[]).map((k) => (
          <Pill key={k} active={current.date === k} href={link({ date: k })}>
            {DATE_BUCKETS[k].label}
          </Pill>
        ))}
      </Row>

      {tags && tags.length > 0 && (
        <Row label="标签">
          <Pill active={!current.tag} href={link({ tag: undefined })}>全部</Pill>
          {tags.slice(0, 16).map((t) => (
            <Pill key={t.tag} active={current.tag === t.tag} href={link({ tag: t.tag })}>
              #{t.tag}
            </Pill>
          ))}
        </Row>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, minWidth: 32 }}>{label}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{children}</div>
    </div>
  );
}

function Pill({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} style={{
      padding: '3px 10px',
      borderRadius: 12,
      border: `1px solid ${active ? '#6366f1' : '#334155'}`,
      background: active ? '#6366f1' : '#1e293b',
      color: active ? '#fff' : '#cbd5e1',
      fontSize: 12,
      fontWeight: active ? 600 : 400,
      textDecoration: 'none',
    }}>{children}</Link>
  );
}
