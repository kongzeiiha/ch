import type { Metadata } from 'next';
import Link from 'next/link';
import { getTopTags } from '../../lib/feed';
import { SITE_NAME, SITE_URL } from '../../lib/db';
import { breadcrumbJsonLd, ogImages, ROBOTS_INDEXABLE } from '../../lib/seo';
import { JsonLd } from '../_components/JsonLd';
import { XLayout } from '../_components/XLayout';
import { XFeedHeader } from '../_components/XFeedHeader';

// ISR — the tag index aggregates JSON_TABLE over every published article and
// is one of the most expensive SSR pages once the corpus grows. Tag counts
// shift slowly (next publish bumps maybe one tag's count) so 60s of stale
// data is invisible to humans. publishing's revalidatePath('/tag') flushes
// this immediately on each new article, the TTL is just the safety net.
export const revalidate = 60;

const TAG_INDEX_DESC = '按标签浏览全站内容,聚合所有标签入口,快速发现感兴趣的话题。涵盖热门精选、最新更新、深度长文等长尾内容。';

// Pill-cloud styling. B1 风格：深色背景 + 粉红强调。
// 三档(heavy/medium/light)用边框深浅区分热度。
const TAG_PILL_CSS = `
.tag-cloud { display: flex; flex-wrap: wrap; gap: 6px; }
.tag-pill {
  display: inline-flex; align-items: baseline; gap: 4px;
  padding: 5px 12px;
  border-radius: 9999px;
  font-size: 13px;
  line-height: 1.5;
  text-decoration: none;
  border: 1px solid #cfd9de;
  background: #ffffff;
  color: #0f1419;
  transition: background 120ms ease, border-color 120ms ease;
}
.tag-pill:hover {
  background: #f7f9f9;
  border-color: #1d9bf0;
}
.tag-pill .tag-hash { color: #1d9bf0; font-weight: 700; }
.tag-pill .tag-count {
  font-size: 11px;
  color: #536471;
  font-variant-numeric: tabular-nums;
  margin-left: 2px;
}

.tag-pill--heavy {
  background: #1d9bf0;
  border-color: #1d9bf0;
  color: #ffffff;
  font-weight: 700;
}
.tag-pill--heavy .tag-hash  { color: #ffffff; }
.tag-pill--heavy .tag-count { color: #ffffffaa; }
.tag-pill--heavy:hover {
  background: #1a8cd8;
  border-color: #1a8cd8;
}

.tag-pill--medium {
  border-color: #1d9bf0;
}
`;

export const metadata: Metadata = {
  title: '标签导航',
  description: TAG_INDEX_DESC,
  alternates: { canonical: `${SITE_URL}/tag` },
  robots: ROBOTS_INDEXABLE,
  openGraph: {
    title: `标签导航 - ${SITE_NAME}`,
    description: TAG_INDEX_DESC,
    url: `${SITE_URL}/tag`,
    siteName: SITE_NAME,
    type: 'website',
    locale: 'zh_CN',
    images: ogImages(),
  },
};

export default async function TagIndexPage() {
  // 200 covers nearly every published tag; the long tail beyond that is rarely
  // useful for navigation and would dilute the grid.
  const tags = await getTopTags(200);

  const crumbs = [
    { name: '首页', url: `${SITE_URL}/` },
    { name: '标签导航', url: `${SITE_URL}/tag` },
  ];

  return (
    <XLayout active="tags">
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <XFeedHeader title="标签导航" />

      <div style={{ padding: '16px' }}>
        <p style={{ color: '#536471', margin: '0 0 16px', fontSize: 14 }}>
          {tags.length === 0 ? '等内容采集起来后,热门标签会出现在这里' : `共 ${tags.length} 个标签`}
        </p>

        {tags.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', border: '1px dashed #cfd9de', borderRadius: 12, color: '#536471' }}>
            暂无标签
          </div>
        ) : (
          <>
            <style>{TAG_PILL_CSS}</style>
            <nav aria-label="全部标签" className="tag-cloud">
              {tags.map((t) => {
                const tier = t.count >= 8 ? 'heavy' : t.count >= 3 ? 'medium' : 'light';
                return (
                  <Link
                    key={t.tag}
                    href={`/tag/${encodeURIComponent(t.tag)}`}
                    className={`tag-pill tag-pill--${tier}`}
                  >
                    {t.tag}
                    <span className="tag-count">{t.count}</span>
                  </Link>
                );
              })}
            </nav>
          </>
        )}
      </div>
    </XLayout>
  );
}
