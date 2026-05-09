import type { ReactNode } from 'react';
import { AgeGate } from './_components/AgeGate';
import { JsonLd } from './_components/JsonLd';
import { websiteJsonLd, organizationJsonLd, AGE_GATE_EXIT_URL } from '../lib/seo';

// Per-route metadata.title (when set) overrides this; the template appends
// the brand suffix to anything that doesn't already include it.
export const metadata = {
  title: {
    default: '内容中台',
    template: '%s | 内容中台',
  },
  description: '聚合多源精选内容,热门精选、最新更新、主题专区、标签导航全方位长尾覆盖',
};

// Global keyframes used by status indicators across the workbench. Inlined
// here so all pages get them without needing a separate CSS file.
const GLOBAL_CSS = `
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.45; }
  }
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh">
      <head>
        <style dangerouslySetInnerHTML={{ __html: GLOBAL_CSS }} />
        {/* Site-wide structured data — applies to every route, including admin
            (admin pages don't ship to crawlers, so the cost is negligible). */}
        <JsonLd data={websiteJsonLd()} />
        <JsonLd data={organizationJsonLd()} />
      </head>
      <body style={{
        margin: 0,
        background: '#0f172a',
        color: '#e2e8f0',
        fontFamily: 'system-ui, -apple-system, PingFang SC, sans-serif',
      }}>
        {children}
        <AgeGate exitUrl={AGE_GATE_EXIT_URL} />
      </body>
    </html>
  );
}
