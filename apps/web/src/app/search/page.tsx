import type { Metadata } from 'next';
import Link from 'next/link';
import { search, getTopTags, getLatest, type LengthBucket, type DateBucket } from '../../lib/feed';
import { SITE_NAME, SITE_URL } from '../../lib/db';
import { SiteHeader } from '../_components/SiteHeader';
import { ArticleCard } from '../_components/ArticleCard';
import { FilterBar } from '../_components/FilterBar';
import { Pagination } from '../_components/Pagination';
import { SiteFooter } from '../_components/SiteFooter';

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
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0' }}>
      <SiteHeader crumb="搜索" activeTab="search" />

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 20px 60px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 14, color: '#e2e8f0' }}>站内搜索</h1>

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
              padding: '10px 14px',
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: 6,
              color: '#e2e8f0',
              fontSize: 14,
              outline: 'none',
            }}
          />
          {/* Preserve filter selections in the form too */}
          {(['tag', 'length', 'date', 'sort', 'category'] as const).map((k) =>
            searchParams[k] ? <input key={k} type="hidden" name={k} value={searchParams[k] as string} /> : null,
          )}
          <button type="submit" style={{
            padding: '10px 20px',
            background: '#6366f1',
            border: 'none',
            borderRadius: 6,
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}>搜索</button>
        </form>

        {tags.length > 0 && (
          <section aria-label="热门标签" style={{
            padding: 14,
            background: '#0f172a',
            border: '1px solid #1e293b',
            borderRadius: 8,
            marginBottom: 20,
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: '#a5b4fc', fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase' }}>热门标签</span>
              <span style={{ fontSize: 11, color: '#64748b' }}>共 {tags.length} 个</span>
              {searchParams.tag && (
                <Link href={tagHref(null)} style={{ marginLeft: 'auto', fontSize: 12, color: '#a5b4fc', textDecoration: 'none' }}>
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
              // Native <details> — no JS, fully SSR'd, crawlable. Pre-opens when
              // a hidden tag is currently selected so the user sees the active
              // pill highlighted instead of an empty toggle.
              <details open={!!searchParams.tag && hiddenTags.some((t) => t.tag === searchParams.tag)} style={{ marginTop: 10 }}>
                <summary style={{
                  fontSize: 12,
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: '4px 0',
                  userSelect: 'none',
                  listStyle: 'none',
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

        {isBrowsing ? (
          latestForBrowse.length === 0 ? (
            <p style={{ color: '#94a3b8', padding: 40, textAlign: 'center', background: '#1e293b', borderRadius: 8 }}>
              暂无已发布内容
            </p>
          ) : (
            <>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
                输入关键词或点击上方筛选可精确查找 · 以下为最新内容
              </div>
              <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                {latestForBrowse.map((a) => <ArticleCard key={a.id} a={a} />)}
              </div>
            </>
          )
        ) : items.length === 0 ? (
          <p style={{ color: '#94a3b8', padding: 40, textAlign: 'center', background: '#1e293b', borderRadius: 8 }}>
            {q ? <>没有匹配「<b style={{ color: '#cbd5e1' }}>{q}</b>」的文章</> : '没有匹配的文章'}
          </p>
        ) : (
          <>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
              共 {total} 条结果{q && <> · 关键词「<span style={{ color: '#cbd5e1' }}>{q}</span>」</>}
            </div>
            <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
              {items.map((a) => <ArticleCard key={a.id} a={a} />)}
            </div>
          </>
        )}

        <Pagination basePath={basePath} searchParams={searchParams} page={page} total={total} pageSize={PAGE_SIZE} />
      </main>
      <SiteFooter />
    </div>
  );
}

function hasFilters(p: SearchParams): boolean {
  return !!(p.category || p.tag || p.length || p.date);
}

function TagPill({ tag, count, active, href }: { tag: string; count: number; active: boolean; href: string }) {
  return (
    <Link href={href} style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '3px 10px',
      borderRadius: 999,
      border: `1px solid ${active ? '#6366f1' : '#334155'}`,
      background: active ? '#6366f1' : '#1e293b',
      color: active ? '#fff' : '#cbd5e1',
      fontSize: 12,
      fontWeight: active ? 600 : 400,
      textDecoration: 'none',
      lineHeight: 1.5,
    }}>
      <span style={{ color: active ? '#e0e7ff' : '#818cf8', fontWeight: 600 }}>#</span>
      {tag}
      <span style={{
        fontSize: 10,
        color: active ? '#e0e7ff' : '#64748b',
        fontVariantNumeric: 'tabular-nums',
        marginLeft: 2,
      }}>{count}</span>
    </Link>
  );
}
