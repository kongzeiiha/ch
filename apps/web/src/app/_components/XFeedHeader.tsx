import Link from 'next/link';
import { X } from './theme';
import { XBackButton } from './XBackButton';

// X.com 风格的 feed 顶栏:粘性 + blur 背景,大字号标题,tab 条下挂分页。
// 子 tab 直接传 children 让调用方塞 <Link>,避免在这里硬塞 routing 逻辑。
//
// back: true → 左侧加返回箭头按钮(详情/列表页用);默认不显示。
// fallbackHref: 直接打开页面(无浏览器历史)时返回去哪,默认首页。
export function XFeedHeader({
  title,
  tabs,
  rightAction,
  back = false,
  fallbackHref,
}: {
  title: React.ReactNode;
  tabs?: Array<{ key: string; label: string; href: string; active?: boolean }>;
  rightAction?: React.ReactNode;
  back?: boolean;
  fallbackHref?: string;
}) {
  return (
    <div className="x-feedhead" style={{
      position: 'sticky',
      top: 0,
      background: 'rgba(255, 255, 255, 0.85)',
      backdropFilter: 'saturate(180%) blur(12px)',
      WebkitBackdropFilter: 'saturate(180%) blur(12px)',
      borderBottom: `1px solid ${X.border}`,
      zIndex: 10,
    }}>
      <div className="x-feedhead-row" style={{
        padding: '12px 16px 0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, flex: 1 }}>
          {back && <XBackButton fallbackHref={fallbackHref} />}
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: X.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h2>
        </div>
        {rightAction}
      </div>

      {tabs && tabs.length > 0 && (
        <nav className="x-feedhead-tabs" style={{ display: 'flex', marginTop: 12 }}>
          {tabs.map((t) => (
            <Link key={t.key} href={t.href} style={{
              flex: 1,
              textAlign: 'center',
              padding: '14px 0',
              fontSize: 14,
              fontWeight: t.active ? 800 : 600,
              color: t.active ? X.text : X.textSecondary,
              borderBottom: `3px solid ${t.active ? X.accent : 'transparent'}`,
              textDecoration: 'none',
            }}>{t.label}</Link>
          ))}
        </nav>
      )}
    </div>
  );
}
