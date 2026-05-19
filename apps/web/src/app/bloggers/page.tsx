import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE_NAME, SITE_URL } from '../../lib/db';
import { ROBOTS_INDEXABLE } from '../../lib/seo';
import { searchSources } from '../../lib/feed';
import { virtualBlogger } from '../../lib/virtual-blogger';
import { proxiedImage } from '../../lib/media';
import { XLayout } from '../_components/XLayout';
import { XFeedHeader } from '../_components/XFeedHeader';
import { X } from '../_components/theme';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '博主 - ' + SITE_NAME,
  description: '发现站点上的全部博主,按热度 / 新加入 / 活跃度浏览,关注感兴趣的虚拟博主。',
  alternates: { canonical: `${SITE_URL}/bloggers` },
  robots: ROBOTS_INDEXABLE,
};

type Sort = 'popular' | 'newest' | 'recent-active';
interface SearchParams {
  q?: string;
  sort?: Sort;
  page?: string;
  [key: string]: string | undefined;
}
const PAGE_SIZE = 30;

export default async function BloggersPage(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  const sort: Sort = searchParams.sort === 'newest' || searchParams.sort === 'recent-active'
    ? searchParams.sort
    : 'popular';
  const q = searchParams.q?.trim() ?? '';
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);

  const { sources, total } = await searchSources({
    q: q || undefined,
    sort,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // tab href 保留 q,切换 sort 时回首页
  const tabHref = (s: Sort) => {
    const p = new URLSearchParams();
    if (s !== 'popular') p.set('sort', s);
    if (q) p.set('q', q);
    const qs = p.toString();
    return qs ? `/bloggers?${qs}` : '/bloggers';
  };

  return (
    <XLayout active="bloggers">
      <XFeedHeader
        title="博主"
        tabs={[
          { key: 'popular',       label: '推荐',     href: tabHref('popular'),       active: sort === 'popular' },
          { key: 'recent-active', label: '最近活跃', href: tabHref('recent-active'), active: sort === 'recent-active' },
          { key: 'newest',        label: '新加入',   href: tabHref('newest'),        active: sort === 'newest' },
        ]}
      />

      <form action="/bloggers" method="get" style={{ padding: '12px 16px', borderBottom: `1px solid ${X.border}` }}>
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="搜索博主名"
          aria-label="搜索博主"
          style={{
            width: '100%', boxSizing: 'border-box',
            background: X.surfaceInput, border: '1px solid transparent',
            borderRadius: 9999, padding: '10px 16px',
            color: X.text, fontSize: 14, outline: 'none',
          }}
        />
        {sort !== 'popular' && <input type="hidden" name="sort" value={sort} />}
      </form>

      <div style={{ padding: '8px 16px', fontSize: 13, color: X.textSecondary, borderBottom: `1px solid ${X.border}` }}>
        共 {total} 位博主{q && <> · 关键词「<span style={{ color: X.text, fontWeight: 600 }}>{q}</span>」</>}
      </div>

      {sources.length === 0 ? (
        <p style={{ padding: 40, textAlign: 'center', color: X.textSecondary }}>
          {q ? <>没有匹配「<b style={{ color: X.text }}>{q}</b>」的博主</> : '暂无博主'}
        </p>
      ) : (
        sources.map((s) => <BloggerRow key={s.id} s={s} />)
      )}

      {totalPages > 1 && (
        <nav style={{ display: 'flex', justifyContent: 'center', gap: 4, padding: '16px 16px 40px', flexWrap: 'wrap' }}>
          {pagerLinks(page, totalPages, q, sort).map((l, i) =>
            l === null
              ? <span key={`gap-${i}`} style={{ padding: '6px 8px', color: X.textMuted }}>…</span>
              : <Link key={l.n} href={l.href} style={{
                  padding: '6px 13px', minWidth: 36, textAlign: 'center',
                  borderRadius: 9999,
                  border: `1px solid ${l.active ? X.text : X.borderStrong}`,
                  background: l.active ? X.text : X.surface,
                  color: l.active ? X.page : X.text,
                  fontSize: 13, fontWeight: l.active ? 700 : 500,
                  textDecoration: 'none',
                }}>{l.n}</Link>
          )}
        </nav>
      )}
    </XLayout>
  );
}

function pagerLinks(page: number, totalPages: number, q: string, sort: Sort) {
  const out: Array<{ n: number; href: string; active: boolean } | null> = [];
  const link = (n: number) => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (sort !== 'popular') p.set('sort', sort);
    if (n > 1) p.set('page', String(n));
    const qs = p.toString();
    return qs ? `/bloggers?${qs}` : '/bloggers';
  };
  const window = 2;
  const lo = Math.max(1, page - window);
  const hi = Math.min(totalPages, page + window);
  if (lo > 1) { out.push({ n: 1, href: link(1), active: page === 1 }); if (lo > 2) out.push(null); }
  for (let i = lo; i <= hi; i++) out.push({ n: i, href: link(i), active: i === page });
  if (hi < totalPages) { if (hi < totalPages - 1) out.push(null); out.push({ n: totalPages, href: link(totalPages), active: page === totalPages }); }
  return out;
}

// 单行博主卡 — 头像渐变 + 化名 / handle / 统计 + 关注按钮
function BloggerRow({ s }: { s: { id: string; name: string; platform: string; avatar_url: string | null; article_count: number; last_article_at: string | null } }) {
  const vb = virtualBlogger(s.id, { platform: s.platform, name: s.name });
  const lastActive = s.last_article_at ? formatTimeAgo(s.last_article_at) : '未发帖';
  return (
    <Link href={`/topic/source-${s.id}`} style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '14px 16px',
      borderBottom: `1px solid ${X.border}`,
      color: X.text, textDecoration: 'none',
    }}>
      {s.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={proxiedImage(s.avatar_url, s.id)} alt={vb.name} loading="lazy"
          style={{
            width: 48, height: 48, borderRadius: '50%', flexShrink: 0,
            objectFit: 'cover', background: X.surfaceHover,
          }} />
      ) : (
        <div style={{
          ...avatarGradient(s.id),
          width: 48, height: 48, borderRadius: '50%', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#ffffff', fontWeight: 800, fontSize: 18,
        }}>{vb.initial}</div>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: X.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {vb.name}
        </div>
        <div style={{ fontSize: 13, color: X.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {vb.handle}
        </div>
        <div style={{ fontSize: 12, color: X.textSecondary, marginTop: 2 }}>
          {s.article_count} 篇 · 最近 {lastActive}
          {s.platform === 'manual' && <> · <span style={{ color: X.accent }}>手工</span></>}
        </div>
      </div>
    </Link>
  );
}

function avatarGradient(seed: string): React.CSSProperties {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return { background: `linear-gradient(135deg, hsl(${hue},70%,50%), hsl(${(hue+40)%360},70%,30%))` };
}

function formatTimeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  const m = Math.floor((Date.now() - t) / 60_000);
  if (m < 60) return `${Math.max(1, m)}m 前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h 前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d 前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}
