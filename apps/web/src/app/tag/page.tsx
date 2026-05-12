import type { Metadata } from 'next';
import Link from 'next/link';
import { getTopTags } from '../../lib/feed';
import { SITE_NAME, SITE_URL } from '../../lib/db';
import { breadcrumbJsonLd, ogImages, ROBOTS_INDEXABLE } from '../../lib/seo';
import { SiteHeader } from '../_components/SiteHeader';
import { JsonLd } from '../_components/JsonLd';
import { SiteFooter } from '../_components/SiteFooter';

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
  border: 1px solid #334155;
  background: #000000;
  color: #e2e8f0;
  transition: background 120ms ease, border-color 120ms ease;
}
.tag-pill:hover {
  background: #1a2236;
  border-color: #dc2626;
}
.tag-pill .tag-hash { color: #dc2626; font-weight: 700; }
.tag-pill .tag-count {
  font-size: 11px;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
  margin-left: 2px;
}

.tag-pill--heavy {
  background: #dc2626;
  border-color: #dc2626;
  color: #ffffff;
  font-weight: 700;
}
.tag-pill--heavy .tag-hash  { color: #ffffff; }
.tag-pill--heavy .tag-count { color: #ffffffaa; }
.tag-pill--heavy:hover {
  background: #b91c1c;
  border-color: #b91c1c;
}

.tag-pill--medium {
  border-color: #dc2626;
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
    <div style={{ minHeight: '100vh', background: '#000000', color: '#e2e8f0' }}>
      <SiteHeader crumb="标签导航" activeTab="tags" />
      <JsonLd data={breadcrumbJsonLd(crumbs)} />

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 20px 60px' }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 6px', color: '#f1f5f9' }}>全部标签</h1>
          <p style={{ color: '#94a3b8', margin: 0, fontSize: 14 }}>
            {tags.length === 0 ? '等内容采集起来后,热门标签会出现在这里' : `共 ${tags.length} 个标签`}
          </p>
        </div>

        {tags.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', background: '#000000', border: '1px dashed #334155', borderRadius: 12, color: '#94a3b8' }}>
            暂无标签
          </div>
        ) : (
          <>
            {/* 3 tiers by count + hover lift. Thresholds match the typical
                long-tail distribution: a handful of "heavy" head terms (≥8),
                a "medium" shoulder (3–7), and a "light" long tail. The CSS
                lives in a scoped <style> block here because the page is a
                server component (no styled-jsx / 'use client'), and we need
                :hover transitions which inline styles can't express. */}
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
                    <span className="tag-hash">#</span>
                    {t.tag}
                    <span className="tag-count">{t.count}</span>
                  </Link>
                );
              })}
            </nav>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
