import type { ReactNode } from 'react';
import { X } from './theme';
import { XSideNav, type NavKey } from './XSideNav';
import { XRightRail } from './XRightRail';

// X.com 风格三栏 shell。
//   - 左侧 240px sticky 导航(图标 + label)
//   - 中间 feed 自适应宽,最大不超过 1280px 总布局
//   - 右侧 320px sticky rail(搜索 + 热门标签 + 推荐博主),窄屏(<1100)收起
//
// 文章页传 `omitRightRail` 时不渲染右栏,腾出宽度给正文。
export function XLayout({
  active,
  omitRightRail = false,
  children,
}: {
  active?: NavKey;
  omitRightRail?: boolean;
  children: ReactNode;
}) {
  return (
    <div style={{
      minHeight: '100vh',
      background: X.page,
      color: X.text,
      display: 'grid',
      gridTemplateColumns: omitRightRail
        ? 'minmax(220px, 280px) minmax(0, 1fr)'
        : 'minmax(220px, 280px) minmax(0, 1fr) minmax(280px, 360px)',
      maxWidth: 1400,
      margin: '0 auto',
    }}>
      <XSideNav active={active} />
      <main style={{ borderRight: omitRightRail ? 'none' : `1px solid ${X.border}`, minWidth: 0 }}>
        {children}
      </main>
      {!omitRightRail && <XRightRail />}
    </div>
  );
}
