import Link from 'next/link';
import { X } from './theme';
import {
  HomeIcon, FlameIcon, PlayIcon, ImageIcon, HashIcon,
  NewspaperIcon, SearchIcon, CogIcon, UsersIcon,
} from './XIcons';

// X.com 风格的左侧 sticky 导航。240px 宽,SVG 图标 + label。
// 桌面满宽显示;窄屏(<1100px)由父布局让位收掉。
//
// hover 高亮靠 className(inline style 没法触发 :hover),scoped CSS 用一段
// <style> 注入,只影响 `.xnav-*` 这几个 class。
export type NavKey =
  | 'home'
  | 'hot'
  | 'videos'
  | 'images'
  | 'tags'
  | 'topics'
  | 'bloggers'
  | 'search';

const ITEMS: Array<{ key: NavKey; label: string; href: string; Icon: typeof HomeIcon }> = [
  { key: 'home',      label: '首页',     href: '/',                  Icon: HomeIcon },
  { key: 'hot',       label: '热门',     href: '/?sort=hot',         Icon: FlameIcon },
  { key: 'videos',    label: '视频',     href: '/?media=video',      Icon: PlayIcon },
  { key: 'images',    label: '图片',     href: '/?media=image',      Icon: ImageIcon },
  { key: 'bloggers',  label: '博主',     href: '/bloggers',          Icon: UsersIcon },
  { key: 'search',    label: '搜索',     href: '/search',            Icon: SearchIcon },
];

const NAV_CSS = `
  .xnav-item { transition: background 0.15s; }
  .xnav-item:hover { background: ${X.surfaceHover}; }
  .xnav-cta { transition: background 0.15s, opacity 0.15s; }
  .xnav-cta:hover { background: ${X.accentHover}; }
`;

export function XSideNav({ active }: { active?: NavKey }) {
  return (
    <aside className="x-sidenav" style={{
      borderRight: `1px solid ${X.border}`,
      padding: '12px 12px',
      position: 'sticky',
      top: 0,
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      overflowY: 'auto',
    }}>
      <style dangerouslySetInnerHTML={{ __html: NAV_CSS }} />

      {/* Logo — 字母标 S(站点品牌缩写) */}
      <Link href="/" aria-label="首页" className="xnav-item" style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 52, height: 52,
        margin: '4px 0 8px',
        borderRadius: '50%',
        color: X.accent,
        textDecoration: 'none',
        fontSize: 34,
        fontWeight: 900,
        lineHeight: 1,
        letterSpacing: -1,
      }}>S</Link>

      {ITEMS.map((it) => {
        const isActive = it.key === active;
        const Icon = it.Icon;
        return (
          <Link key={it.key} href={it.href} className="xnav-item" style={navItemStyle(isActive)}>
            <span style={{ width: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              {/* active 时不再 fill 实心 — 实心会把 icon 渲染成黑色块,视觉太重。
                  active 状态用 label 的 fontWeight=800 自己表达。 */}
              <Icon size={26} />
            </span>
            <span>{it.label}</span>
          </Link>
        );
      })}

      {/* 工作台 / Admin 入口已从公开导航移除 —— 运营人员直接通过 URL 进 /workbench
          /admin (中间件鉴权),不再从前端泄露入口。 */}
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 12, borderTop: `1px solid ${X.border}` }}>
        <Link href="/about/terms" className="xnav-item" style={{ ...navItemStyle(false), fontSize: 14, padding: '8px 14px' }}>
          <span style={{ width: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <CogIcon size={20} />
          </span>
          <span>关于</span>
        </Link>
      </div>
    </aside>
  );
}

function navItemStyle(active: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 16,
    padding: '12px 16px',
    borderRadius: 9999,
    fontSize: 17,
    fontWeight: active ? 800 : 500,
    color: X.text,
    textDecoration: 'none',
  };
}

// 手机底部 tab bar — class `x-mobilebar` 默认 display:none,
// 媒体查询(layout.tsx)在 <=700px 把它切成 flex 撑满。
// 只露 5 个最常用入口(首页 / 热门 / 视频 / 图片 / 搜索),博主 / 工作台 / Admin
// 在手机用户里基本不命中,放进二级页就够。
const MOBILE_ITEMS: Array<{ key: NavKey; label: string; href: string; Icon: typeof HomeIcon }> = [
  { key: 'home',    label: '首页', href: '/',             Icon: HomeIcon },
  { key: 'hot',     label: '热门', href: '/?sort=hot',    Icon: FlameIcon },
  { key: 'videos',  label: '视频', href: '/?media=video', Icon: PlayIcon },
  { key: 'images',  label: '图片', href: '/?media=image', Icon: ImageIcon },
  { key: 'search',  label: '搜索', href: '/search',       Icon: SearchIcon },
];

export function XMobileBar({ active }: { active?: NavKey }) {
  return (
    <nav className="x-mobilebar" aria-label="底部导航">
      {MOBILE_ITEMS.map((it) => {
        const isActive = it.key === active;
        const Icon = it.Icon;
        return (
          <Link
            key={it.key}
            href={it.href}
            aria-label={it.label}
            style={{
              flex: 1,
              display: 'inline-flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              padding: '8px 0',
              minHeight: 56,
              color: isActive ? X.accent : X.text,
              textDecoration: 'none',
              fontSize: 11,
              fontWeight: isActive ? 700 : 500,
            }}
          >
            <Icon size={22} />
            <span>{it.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
