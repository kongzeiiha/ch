import type { ReactNode } from 'react';
import { AgeGate } from './_components/AgeGate';
import { BfcacheRefresh } from './_components/BfcacheRefresh';
import { LiveCountPatcher } from './_components/LiveCountPatcher';
import { JsonLd } from './_components/JsonLd';
import { websiteJsonLd, organizationJsonLd, AGE_GATE_EXIT_URL } from '../lib/seo';
import { X } from './_components/theme';

// H5 适配:viewport 必须在 <head> 里有,否则手机会按 980px 桌面宽度渲染再
// 缩放,字号 / 命中区都不对。Next 15 推荐独立的 `viewport` export,
// metadata.viewport 已 deprecated。maximumScale=5 保留双指缩放(强禁缩放
// 对 a11y / 弱视用户不友好)。
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

// Per-route metadata.title (when set) overrides this; the template appends
// the brand suffix to anything that doesn't already include it.
export const metadata = {
  title: {
    default: '内容中台',
    template: '%s | 内容中台',
  },
  description: '聚合多源精选内容,热门精选、最新更新、主题专区、标签导航全方位长尾覆盖',
  // SVG favicon — pure vector, scales to any size (tab/touch icon/PWA).
  // Falls back to /favicon.ico if a browser doesn't accept SVG, but every
  // current browser does so we don't bother shipping a raster fallback.
  icons: { icon: '/favicon.svg' },
};

// Global keyframes used by status indicators across the workbench. Inlined
// here so all pages get them without needing a separate CSS file.
//
// H5 媒体查询统一塞在这里:
//   - <=700px 视为手机,XLayout 三栏 grid 折叠成单列(`.x-shell`)
//   - 桌面左栏 (`.x-sidenav`) 和右栏 (`.x-rightrail`) 在手机隐藏
//   - 单独的底部 tab bar (`.x-mobilebar`) 在桌面隐藏、手机才出现
//   - 主内容区给底栏让 56px 高度 + iOS safe-area
//   - 兜底:html/body 关掉横向滚动 + 100% 宽,iOS 上 X 元素超出会撑出滚动条
const GLOBAL_CSS = `
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.45; }
  }
  html, body { max-width: 100%; overflow-x: hidden; }
  .x-mobilebar { display: none; }
  @media (max-width: 700px) {
    .x-shell { grid-template-columns: minmax(0, 1fr) !important; }
    .x-sidenav, .x-rightrail { display: none !important; }
    .x-main { border-right: none !important; padding-bottom: calc(64px + env(safe-area-inset-bottom)) !important; }
    .x-mobilebar {
      display: flex !important;
      position: fixed;
      left: 0; right: 0; bottom: 0;
      z-index: 50;
      background: rgba(255,255,255,0.96);
      backdrop-filter: saturate(180%) blur(12px);
      -webkit-backdrop-filter: saturate(180%) blur(12px);
      border-top: 1px solid #eff3f4;
      padding-bottom: env(safe-area-inset-bottom);
    }
    /* 顶栏字号 / padding 在手机收一点,避免标题 + 按钮挤出 */
    .x-feedhead h2 { font-size: 17px !important; }
    .x-feedhead-row { padding: 10px 12px 0 !important; }
    .x-feedhead-tabs a { padding: 12px 0 !important; font-size: 13px !important; }
    /* 卡片左右 padding 收窄,字体略小 */
    .x-post { padding: 10px 12px !important; }
    /* 文章详情:24px 两边 padding 在手机上挤掉太多正文宽度 */
    .x-article { padding: 12px 14px 32px !important; line-height: 1.75 !important; }
    .x-article h1 { font-size: 22px !important; }
    .x-article h2 { font-size: 18px !important; }
    .x-article h3 { font-size: 16px !important; }
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
        background: X.page,
        color: X.text,
        fontFamily: '"Chirp", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Helvetica Neue", Arial, sans-serif',
        WebkitFontSmoothing: 'antialiased',
        MozOsxFontSmoothing: 'grayscale',
      }}>
        {children}
        <AgeGate exitUrl={AGE_GATE_EXIT_URL} />
        <BfcacheRefresh />
        <LiveCountPatcher />
      </body>
    </html>
  );
}
