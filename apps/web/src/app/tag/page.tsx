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

// Pill-cloud styling. Three tiers (heavy/medium/light) carry the popularity
// signal via color/border instead of font size, so density stays uniform.
// Hover lifts the pill 1px and tints it indigo to give a clear affordance.
const TAG_PILL_CSS = `
.tag-cloud { display: flex; flex-wrap: wrap; gap: 6px; }
.tag-pill {
  display: inline-flex; align-items: baseline; gap: 4px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 1.5;
  text-decoration: none;
  border: 1px solid #334155;
  background: #1e293b;
  color: #cbd5e1;
  transition: transform 120ms ease, border-color 120ms ease, background 120ms ease, color 120ms ease, box-shadow 120ms ease;
}
.tag-pill:hover {
  transform: translateY(-1px);
  border-color: #818cf8;
  color: #e0e7ff;
  background: #312e81;
  box-shadow: 0 4px 14px -6px rgba(99,102,241,0.55);
}
.tag-pill .tag-hash { color: #818cf8; font-weight: 600; }
.tag-pill .tag-count {
  font-size: 10px;
  color: #64748b;
  font-variant-numeric: tabular-nums;
  margin-left: 2px;
}
.tag-pill:hover .tag-count { color: #c7d2fe; }
.tag-pill:hover .tag-hash  { color: #c7d2fe; }

.tag-pill--heavy {
  background: linear-gradient(180deg, #4f46e5 0%, #3730a3 100%);
  border-color: #6366f1;
  color: #eef2ff;
  font-weight: 600;
}
.tag-pill--heavy .tag-hash  { color: #c7d2fe; }
.tag-pill--heavy .tag-count { color: #c7d2fe; }
.tag-pill--heavy:hover {
  background: linear-gradient(180deg, #6366f1 0%, #4338ca 100%);
  border-color: #a5b4fc;
}

.tag-pill--medium {
  border-color: #475569;
  color: #e2e8f0;
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
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0' }}>
      <SiteHeader crumb="标签导航" activeTab="tags" />
      <JsonLd data={breadcrumbJsonLd(crumbs)} />

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 20px 60px' }}>
        {/* Kicker label removed — the page name is already in the
            breadcrumb + the active nav tab. Keep H1 + count line so users
            still see what they're looking at. */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 6px', color: '#e2e8f0' }}>全部标签</h1>
          <p style={{ color: '#94a3b8', margin: 0, fontSize: 14 }}>
            {tags.length === 0 ? '等内容采集起来后,热门标签会出现在这里' : `共 ${tags.length} 个标签`}
          </p>
        </div>

        {tags.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', background: '#1e293b', border: '1px dashed #334155', borderRadius: 8, color: '#94a3b8' }}>
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
