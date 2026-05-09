import type { Metadata } from 'next';
import Link from 'next/link';
import { getTopTags } from '../../lib/feed';
import { SITE_NAME, SITE_URL } from '../../lib/db';
import { breadcrumbJsonLd, ogImages, ROBOTS_INDEXABLE } from '../../lib/seo';
import { SiteHeader } from '../_components/SiteHeader';
import { JsonLd } from '../_components/JsonLd';
import { Breadcrumbs } from '../_components/Breadcrumbs';
import { SiteFooter } from '../_components/SiteFooter';

export const dynamic = 'force-dynamic';

const TAG_INDEX_DESC = '按标签浏览全站内容,聚合所有标签入口,快速发现感兴趣的话题。涵盖热门精选、最新更新、深度长文等长尾内容。';

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
        <Breadcrumbs items={[
          { name: '首页', href: '/' },
          { name: '标签导航' },
        ]} />

        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, color: '#a5b4fc', fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 4 }}>标签导航</div>
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
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
            {tags.map((t) => (
              <Link key={t.tag} href={`/tag/${encodeURIComponent(t.tag)}`} style={{
                display: 'block',
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: 8,
                padding: '14px 16px',
                color: '#e2e8f0',
                textDecoration: 'none',
              }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#a5b4fc', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  #{t.tag}
                </div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{t.count} 篇文章</div>
              </Link>
            ))}
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
