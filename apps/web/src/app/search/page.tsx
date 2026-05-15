import type { Metadata } from 'next';
import Link from 'next/link';
import { search, getTopTags, getLatest, type LengthBucket, type DateBucket } from '../../lib/feed';
import { SITE_NAME, SITE_URL } from '../../lib/db';
import { FilterBar } from '../_components/FilterBar';
import { Pagination } from '../_components/Pagination';
import { XLayout } from '../_components/XLayout';
import { XFeedHeader } from '../_components/XFeedHeader';
import { XPost } from '../_components/XPost';

// Search results are intentionally not statically built — the query space is
// open. Keep them out of the index too (robots noindex) so we don't pollute
// SERPs with low-quality auto-generated long-tail.
export const dynamic = 'force-dynamic';

interface SearchParams {
  q?: string;
  category?: string;
  tag?: string;
  length?: LengthBucket;
  date?: DateBucket;
  sort?: 'latest' | 'hot';
  page?: string;
  [key: string]: string | undefined;
}

export async function generateMetadata(props: { searchParams: Promise<SearchParams> }): Promise<Metadata> {
  const searchParams = await props.searchParams;
  const q = searchParams.q?.trim();
  return {
    title: q ? `「${q}」搜索结果 - ${SITE_NAME}` : `站内搜索 - ${SITE_NAME}`,
    robots: { index: false, follow: true },
    alternates: { canonical: `${SITE_URL}/search` },
  };
}

const PAGE_SIZE = 20;

export default async function SearchPage(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  const q = searchParams.q?.trim() ?? '';
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);

  // Pills come from global aggregation. Cheap and useful even before the user
  // runs a query; if a tag/keyword has zero hits in combination with q, the
  // empty-state nudges them to relax filters.
  const isBrowsing = !q && !hasFilters(searchParams);
  // Fetch up to 200 tags for the "热门标签" section — top 20 render inline,
  // the rest are hidden behind a native <details> "更多标签" toggle. Tags
  // beyond the first 200 are long-tail noise and live on /tag instead.
  const [results, tags, latestForBrowse] = await Promise.all([
    isBrowsing
      ? Promise.resolve({ items: [], total: 0 })
      : search({
          q,
          category: searchParams.category,
          tag: searchParams.tag,
          length: searchParams.length,
          date: searchParams.date,
          sort: searchParams.sort,
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
        }),
    getTopTags(200),
    // 默认落地：用户没输关键词时直接展示最新文章，而不是空白页
    isBrowsing ? getLatest({ limit: PAGE_SIZE }) : Promise.resolve([]),
  ]);
  const { items, total } = results;
  const visibleTags = tags.slice(0, 20);
  const hiddenTags = tags.slice(20);

  // Tag pill href — preserves current q so users can drill in without
  // losing their query. When the tag matches `current.tag`, the pill
  // becomes a "deselect" link instead.
  const tagHref = (tag: string | null) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (tag) params.set('tag', tag);
    const qs = params.toString();
    return qs ? `/search?${qs}` : '/search';
  };

  const basePath = '/search';
  // Preserve `q` across filter switches so the user doesn't lose their query
  // when they tap a length/date pill.
  const baseQuery = q ? `?q=${encodeURIComponent(q)}` : '';

  return (
    <XLayout active="search">
      <XFeedHeader title="搜索" />
      <div style={{ padding: '16px' }}>
        {/* 视觉隐藏:H1 仍保留给爬虫和读屏软件,避免页面层级结构残缺 */}
        <h1 style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }}>站内搜索</h1>

        <form action="/search" method="get" style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="关键词、标题、正文……"
            aria-label="搜索关键词"
            autoFocus={!q}
            style={{
              flex: 1,
              padding: '11px 16px',
              background: '#ffffff',
              border: '1px solid #eff3f4',
              borderRadius: 9999,
              color: '#0f1419',
              fontSize: 14,
              outline: 'none',
            }}
          />
          {(['tag', 'length', 'date', 'sort', 'category'] as const).map((k) =>
            searchParams[k] ? <input key={k} type="hidden" name={k} value={searchParams[k] as string} /> : null,
          )}
          <button type="submit" style={{
            padding: '10px 24px',
            background: '#1d9bf0',
            border: 'none',
            borderRadius: 9999,
            color: '#ffffff',
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
          }}>搜索</button>
        </form>

        {tags.length > 0 && (
          <section aria-label="热门标签" style={{
            padding: 14,
            background: '#ffffff',
            border: '1px solid #eff3f4',
            borderRadius: 16,
            marginBottom: 20,
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: '#0f1419', fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase' }}>热门标签</span>
              <span style={{ fontSize: 12, color: '#536471' }}>共 {tags.length} 个</span>
              {searchParams.tag && (
                <Link href={tagHref(null)} style={{ marginLeft: 'auto', fontSize: 13, color: '#1d9bf0', textDecoration: 'none' }}>
                  清除标签筛选 ×
                </Link>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {visibleTags.map((t) => (
                <TagPill key={t.tag} tag={t.tag} count={t.count} active={searchParams.tag === t.tag} href={tagHref(t.tag)} />
              ))}
            </div>
            {hiddenTags.length > 0 && (
              <details open={!!searchParams.tag && hiddenTags.some((t) => t.tag === searchParams.tag)} style={{ marginTop: 10 }}>
                <summary style={{
                  fontSize: 13,
                  color: '#536471',
                  cursor: 'pointer',
                  padding: '4px 0',
                  userSelect: 'none',
                  listStyle: 'none',
                  fontWeight: 600,
                }}>
                  更多标签 · {hiddenTags.length}  ▾
                </summary>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {hiddenTags.map((t) => (
                    <TagPill key={t.tag} tag={t.tag} count={t.count} active={searchParams.tag === t.tag} href={tagHref(t.tag)} />
                  ))}
                </div>
              </details>
            )}
          </section>
        )}

        <FilterBar
          basePath={`${basePath}${baseQuery}`}
          current={searchParams}
        />

      </div>
      {isBrowsing ? (
        latestForBrowse.length === 0 ? (
          <p style={{ color: '#536471', padding: 40, textAlign: 'center' }}>暂无已发布内容</p>
        ) : (
          <>
            <div style={{ fontSize: 14, color: '#536471', padding: '0 16px 12px' }}>
              输入关键词或点击上方筛选可精确查找 · 以下为最新内容
            </div>
            {latestForBrowse.map((a) => <XPost key={a.id} a={a} />)}
          </>
        )
      ) : items.length === 0 ? (
        <p style={{ color: '#536471', padding: 40, textAlign: 'center' }}>
          {q ? <>没有匹配「<b style={{ color: '#0f1419' }}>{q}</b>」的文章</> : '没有匹配的文章'}
        </p>
      ) : (
        <>
          <div style={{ fontSize: 14, color: '#536471', padding: '0 16px 12px' }}>
            共 {total} 条结果{q && <> · 关键词「<span style={{ color: '#0f1419', fontWeight: 600 }}>{q}</span>」</>}
          </div>
          {items.map((a) => <XPost key={a.id} a={a} />)}
        </>
      )}

      <div style={{ padding: '16px 16px 40px' }}>
        <Pagination basePath={basePath} searchParams={searchParams} page={page} total={total} pageSize={PAGE_SIZE} />
      </div>
    </XLayout>
  );
}

function hasFilters(p: SearchParams): boolean {
  return !!(p.category || p.tag || p.length || p.date);
}

function TagPill({ tag, count, active, href }: { tag: string; count: number; active: boolean; href: string }) {
  // 与 FilterBar Pill 视觉完全一致:padding / radius / border / bg / color / 字号字重全对齐。
  // #前缀和计数复用主文字颜色,不再用粉红 / 浅灰强调,保持一片纯色块。
  return (
    <Link href={href} style={{
      padding: '4px 12px',
      borderRadius: 9999,
      border: `1px solid ${active ? '#1d9bf0' : '#cfd9de'}`,
      background: active ? '#1d9bf0' : '#ffffff',
      color: active ? '#ffffff' : '#0f1419',
      fontSize: 13,
      fontWeight: active ? 700 : 500,
      textDecoration: 'none',
    }}>#{tag} {count}</Link>
  );
}
