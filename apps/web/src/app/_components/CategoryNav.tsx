import Link from 'next/link';
import { query } from '../../lib/db';
import { X } from './theme';

interface CatRow {
  category: string;
  count: number;
}

// CategoryNav supports two routing modes:
//   1. mediaScope undefined → 站点全局类目入口,链接到 /category/<name>
//      (例如首页 / 热门精选, 点击进入分类独立页 — 包含视频+图片)
//   2. mediaScope='video' / 'image' → 在 视频/图片 scope 下点击类目应当
//      保持当前媒体过滤,链接到 /?media=<scope>&category=<name>
//      (例如 视频 tab 下点 "其他" 不应跳到混合内容的 /category/其他)
//
// `count` 也在 mediaScope 模式下用对应媒体的子集计数,这样按钮上显示的
// 数字跟点进去看到的"共 N 条"严格匹配。
export async function CategoryNav({
  active,
  mediaScope,
}: {
  active?: string;
  mediaScope?: 'video' | 'image';
}) {
  // 注:`COUNT(*)::int` 是 PG 习惯,packages/db 的 rebuild() 适配器把 `::int`
  // 剥掉再交给 mysql2,所以保留也安全。这里显式留着便于和其他 PG-风格
  // 查询保持一致。
  const mediaWhere = mediaScope === 'video'
    ? "AND JSON_LENGTH(r.video_urls) > 0"
    : mediaScope === 'image'
    ? "AND JSON_LENGTH(r.media_urls) > 0 AND COALESCE(JSON_LENGTH(r.video_urls), 0) = 0"
    : '';
  const join = mediaScope ? 'LEFT JOIN raw_items r ON r.id = i.raw_item_id' : '';

  const categories = await query<CatRow>(
    `SELECT i.category, COUNT(*)::int AS count
     FROM items i ${join}
     WHERE i.status IN ('PUBLISHED','DISTRIBUTED') AND i.category IS NOT NULL ${mediaWhere}
     GROUP BY i.category
     ORDER BY count DESC`,
  );

  if (categories.length === 0) return null;

  // "全部" 链接根据 scope 决定回到哪儿
  const allHref = mediaScope ? `/?media=${mediaScope}` : '/';
  // 类目链接同样保留 scope
  const catHref = (name: string) => mediaScope
    ? `/?media=${mediaScope}&category=${encodeURIComponent(name)}`
    : `/category/${encodeURIComponent(name)}`;

  return (
    <nav style={{ marginBottom: 24, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <Link href={allHref} style={pillStyle(!active)}>
        全部 <span style={{ color: !active ? '#ffffff99' : X.textMuted }}>· {categories.reduce((n, c) => n + c.count, 0)}</span>
      </Link>
      {categories.map((c) => {
        const isActive = c.category === active;
        return (
          <Link key={c.category} href={catHref(c.category)} style={pillStyle(isActive)}>
            {c.category} <span style={{ color: isActive ? '#ffffff99' : X.textMuted }}>· {c.count}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function pillStyle(active: boolean): React.CSSProperties {
  return {
    padding: '6px 14px',
    border: `1px solid ${active ? X.accent : X.borderStrong}`,
    borderRadius: 9999,
    color: active ? '#ffffff' : X.text,
    textDecoration: 'none',
    fontSize: 14,
    background: active ? X.accent : X.surface,
    fontWeight: active ? 700 : 500,
  };
}
