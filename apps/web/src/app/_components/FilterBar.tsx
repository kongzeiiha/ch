import Link from 'next/link';
import { LENGTH_BUCKETS, DATE_BUCKETS, type LengthBucket, type DateBucket } from '../../lib/feed';
import { X } from './theme';

interface Props {
  basePath: string;
  current: {
    tag?: string;
    /** Category filter (?category=自拍 等). Set when 视频/图片 scope 下
     *  CategoryNav 把分类拼到 query 而非跳到 /category/<X> 子页 — 这样
     *  「视频 + 调教 + 短(<5 分钟)」这类多维筛选可以叠加。和 media
     *  一样必须在任何 FilterBar 切换中保留。 */
    category?: string;
    length?: LengthBucket;
    date?: DateBucket;
    sort?: 'latest' | 'hot';
    /** Media filter (?media=video / ?media=image). Surfaces on the home
     *  page's 视频 / 图片 tabs — must be preserved when the user toggles
     *  any other facet, otherwise toggling 时长 silently drops the media
     *  scope and the URL falls back to "最新更新". */
    media?: 'video' | 'image';
  };
  /** Available tags within the current scope (category, search etc.). */
  tags?: { tag: string; count: number }[];
  /** Hide the 排序 row — used when the page already exposes 最新/最热 as
   *  a primary sub-tab above the FilterBar (e.g. /?media=video). Search page
   *  leaves it on because it has no sub-tabs of its own. */
  omitSort?: boolean;
  /** The sort value the page treats as its default. URLs emitted by FilterBar
   *  omit `?sort=` when it matches this default, keeping canonical paths clean.
   *  Home page = 'hot' (热门精选 landing), Search page = 'latest'. */
  defaultSort?: 'latest' | 'hot';
}

// Server-rendered filter bar. Each pill is a real <Link> that swaps a single
// query param while preserving the others — keeps URLs shareable, SEO-clean,
// and works without JS.
//
// Note: the legacy 题材 (keywords) row was removed — keywords and tags come
// from the same LLM classifier and the two rows were almost always identical.
// The `keyword` URL param is no longer supported.
export function FilterBar({ basePath, current, tags, omitSort, defaultSort = 'latest' }: Props) {
  const link = (override: Partial<Props['current']>) => {
    // For each key in override, undefined means "clear this filter" — so we
    // overwrite-then-drop instead of spread-merging (which would keep the old
    // value when override has it as undefined). The Pill's "全部" buttons rely
    // on this semantic to actually unset their facet.
    const next: Props['current'] = { ...current };
    for (const k of Object.keys(override) as (keyof Props['current'])[]) {
      const v = override[k];
      if (v === undefined) delete next[k];
      else (next as Record<string, unknown>)[k] = v;
    }
    const params = new URLSearchParams();
    // media + category scope the whole listing — preserve through every toggle.
    if (next.media)    params.set('media', next.media);
    if (next.category) params.set('category', next.category);
    if (next.tag)      params.set('tag', next.tag);
    if (next.length)   params.set('length', next.length);
    // date=all is the "no date filter" sentinel — omit from URL for clean
    // canonical paths.
    if (next.date && next.date !== 'all') params.set('date', next.date);
    // sort: omit when matching the page's declared default so `/` (= hot on
    // home, = latest on search) stays clean. Always emit when explicitly
    // different so the user's choice round-trips through SSR.
    if (next.sort && next.sort !== defaultSort) params.set('sort', next.sort);
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      padding: 14,
      background: X.surfaceSoft,
      border: `1px solid ${X.border}`,
      borderRadius: 16,
      marginBottom: 20,
    }}>
      {!omitSort && (
        <Row label="排序">
          <Pill active={current.sort !== 'hot'}  href={link({ sort: 'latest' })}>最新</Pill>
          <Pill active={current.sort === 'hot'}  href={link({ sort: 'hot' })}>最热</Pill>
        </Row>
      )}

      {/* 时长 row:
       *   - 视频范围 → 用 LENGTH_BUCKETS 的 minSec/maxSec 过滤 duration_sec
       *   - 文章范围(无 media)→ 用 min/max 过滤 CHAR_LENGTH(content)
       *   - 图片范围 → 没有时长概念,隐藏整行
       *  feed.ts 的 length 分支同时实现了两种语义,所以这里安全放开视频。 */}
      {current.media !== 'image' && (
        <Row label="时长">
          <Pill active={!current.length} href={link({ length: undefined })}>全部</Pill>
          {(Object.keys(LENGTH_BUCKETS) as LengthBucket[]).map((k) => (
            <Pill key={k} active={current.length === k} href={link({ length: k })}>
              {LENGTH_BUCKETS[k].label}
            </Pill>
          ))}
        </Row>
      )}

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
      <span style={{ fontSize: 12, color: X.textSecondary, fontWeight: 700, minWidth: 48 }}>{label}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{children}</div>
    </div>
  );
}

function Pill({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} style={{
      padding: '4px 12px',
      borderRadius: 9999,
      border: `1px solid ${active ? X.accent : X.borderStrong}`,
      background: active ? X.accent : X.surface,
      color: active ? '#ffffff' : X.text,
      fontSize: 13,
      fontWeight: active ? 700 : 500,
      textDecoration: 'none',
    }}>{children}</Link>
  );
}
