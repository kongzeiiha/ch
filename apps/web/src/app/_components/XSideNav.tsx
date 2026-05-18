import Link from 'next/link';
import { X } from './theme';
import {
  HomeIcon, FlameIcon, PlayIcon, ImageIcon, HashIcon,
  NewspaperIcon, SearchIcon, CogIcon, StarIcon, UsersIcon, HeartIcon,
} from './XIcons';
import { FollowCountBadge } from './FollowIndicators';

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
  | 'following'
  | 'search';

const ITEMS: Array<{ key: NavKey; label: string; href: string; Icon: typeof HomeIcon }> = [
  { key: 'home',      label: '首页',     href: '/',                  Icon: HomeIcon },
  { key: 'hot',       label: '热门',     href: '/?sort=hot',         Icon: FlameIcon },
  { key: 'videos',    label: '视频',     href: '/?media=video',      Icon: PlayIcon },
  { key: 'images',    label: '图片',     href: '/?media=image',      Icon: ImageIcon },
  { key: 'bloggers',  label: '博主',     href: '/bloggers',          Icon: UsersIcon },
  { key: 'following', label: '关注',     href: '/following',         Icon: HeartIcon },
  { key: 'topics',    label: '主题',     href: '/topic/weekly-hot',  Icon: NewspaperIcon },
  { key: 'tags',      label: '标签',     href: '/tag',               Icon: HashIcon },
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
    <aside style={{
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
              <Icon filled={isActive} size={26} />
            </span>
            <span>{it.label}</span>
            {it.key === 'following' && <FollowCountBadge />}
          </Link>
        );
      })}

      {/* 主 CTA — X 上是"发帖"按钮,我们站点上面向运营的是"进工作台"。
          全宽红色胶囊,视觉地位最重。 */}
      <Link href="/workbench" className="xnav-cta" style={{
        marginTop: 12,
        padding: '14px',
        background: X.accent,
        color: '#ffffff',
        border: 'none',
        borderRadius: 9999,
        fontSize: 15,
        fontWeight: 800,
        textAlign: 'center',
        textDecoration: 'none',
        cursor: 'pointer',
      }}>进入工作台</Link>

      {/* 底部小字工具链接 */}
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 12, borderTop: `1px solid ${X.border}` }}>
        <Link href="/admin" className="xnav-item" style={{ ...navItemStyle(false), fontSize: 14, padding: '8px 14px', color: X.accent }}>
          <span style={{ width: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <StarIcon size={20} />
          </span>
          <span>Admin</span>
        </Link>
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
