import type { Metadata } from 'next';
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
    getTopTags(20),
    // 默认落地：用户没输关键词时直接展示最新文章，而不是空白页
    isBrowsing ? getLatest({ limit: PAGE_SIZE }) : Promise.resolve([]),
  ]);
  const { items, total } = results;

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

        <FilterBar
          basePath={`${basePath}${baseQuery}`}
          current={searchParams}
          tags={tags}
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
