import Link from 'next/link';
import type { ArticleCardRow } from '../../lib/feed';
import { proxiedImage } from '../../lib/media';
import { displayTitle } from '../../lib/strip-urls';
import { virtualBlogger } from '../../lib/virtual-blogger';
import { X } from './theme';
import { CommentIcon, RepostIcon, HeartIcon, EyeIcon } from './XIcons';
import { ShareButton } from './ShareButton';

// 内联 read-minutes — 避免从 lib/feed.ts 拽 ioredis(cache)进 client bundle。
// 公式: ~200 zh chars/min,跟原 readMinutes 一致。
function readMinutes(charCount: number): number {
  return Math.max(1, Math.round(charCount / 200));
}

// X.com 风格的 feed post — 替代 ArticleCard 在三栏布局里用。
// 整张卡片是个 <Link>,任何位置点击都跳文章详情;hover 浅色高亮。
//
// 头像是按 source_id 哈希出的渐变方块 + 名字首字 — 没有真人头像表的折衷,
// 至少不同博主能视觉区分开,不会一片相同的灰圆圈。

const POST_CSS = `
  .xpost { transition: background 0.15s; }
  .xpost:hover { background: ${X.surfaceHover}; }
`;

export function XPost({ a }: { a: ArticleCardRow }) {
  const rawCover = a.cover_sizes?.card ?? a.cover_url ?? a.cover_fallback ?? null;
  const thumb = proxiedImage(rawCover, a.source_id);

  const cleanTitle = displayTitle(a.title, 100) || (a.category ? `${a.category} · 无标题内容` : '无标题内容');
  const cleanSummary = displayTitle(a.summary ?? '', 200);

  // 爬虫源走哈希化名;手工源直接用运营填的 name。virtualBlogger 内部分流。
  const vb = virtualBlogger(a.source_id, { platform: a.source_platform, name: a.source });
  const sourceName = vb.name;
  const handle = vb.handle;
  const initial = vb.initial;
  const ago = a.published_at ? formatTimeAgo(a.published_at) : null;
  const duration = a.duration_sec ? formatDuration(a.duration_sec) : null;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: POST_CSS }} />
      <Link href={`/a/${a.slug}`} className="xpost" style={{
        display: 'flex',
        gap: 12,
        padding: '14px 16px',
        borderBottom: `1px solid ${X.border}`,
        color: X.text,
        textDecoration: 'none',
      }}>
        {a.source_avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={proxiedImage(a.source_avatar, a.source_id)} alt={sourceName}
            loading="lazy"
            style={{
              width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
              objectFit: 'cover', background: X.surfaceHover,
            }} />
        ) : (
          <div style={{
            ...avatarGradient(a.source_id ?? a.id),
            width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#ffffff', fontWeight: 800, fontSize: 17,
          }}>{initial}</div>
        )}

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 800, color: X.text }}>{sourceName}</span>
            <span style={{ color: X.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{handle}</span>
            {ago && (
              <>
                <span style={{ color: X.textMuted }}>·</span>
                <span style={{ color: X.textMuted }}>{ago}</span>
              </>
            )}
            {a.category && (
              <span style={{ marginLeft: 'auto', fontSize: 12, color: X.accent, fontWeight: 700 }}>{a.category}</span>
            )}
          </div>

          <div style={{ fontSize: 15, fontWeight: 700, color: X.text, lineHeight: 1.4, margin: '4px 0 6px' }}>
            {cleanTitle}
          </div>

          {/* summary <p> 暂时隐藏 — 爬虫源 X 帖的 summary 基本就是标题文案的复读,
              详情页 h1 已经展示,卡片再贴一遍只是噪音 */}

          {thumb && (
            <div style={{
              position: 'relative',
              aspectRatio: '16 / 9',
              borderRadius: 16,
              overflow: 'hidden',
              border: `1px solid ${X.border}`,
              background: X.surfaceHover,
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumb} alt={cleanTitle} loading="lazy"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              {a.has_video && (
                <span style={{
                  position: 'absolute', right: 8, bottom: 8,
                  background: 'rgba(0,0,0,0.78)', color: '#fff',
                  fontSize: 12, fontWeight: 700,
                  padding: '3px 8px', borderRadius: 4,
                  fontVariantNumeric: 'tabular-nums',
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M7 4l13 8-13 8z" />
                  </svg>
                  {duration ?? `${readMinutes(a.content_length)} min`}
                </span>
              )}
            </div>
          )}

          {/* Actions 行 — data-* 属性 + class 标识给客户端 LiveCountPatcher 用,
              组件 mount 后批量打 /api/item-stats 拉最新计数 patch 进来,
              避免 SSR 缓存 / Next router 缓存导致返回时数字不更新。 */}
          <div style={{
            display: 'flex', gap: 8, marginTop: 12, maxWidth: 420,
            justifyContent: 'space-between', color: X.textMuted, fontSize: 13,
          }} data-xpost-slug={a.slug}>
            <span style={actionStyle}><CommentIcon /> <span data-xpost-count="comments">{fmtCount(a.comment_count ?? 0)}</span></span>
            <span style={actionStyle}><RepostIcon /> <span>0</span></span>
            <span style={actionStyle}><HeartIcon /> <span data-xpost-count="likes">{fmtCount(a.likes ?? 0)}</span></span>
            <span style={actionStyle}><EyeIcon /> <span data-xpost-count="pv">{fmtCount(a.pv_30d ?? 0)}</span></span>
            <ShareButton slug={a.slug} title={cleanTitle} />
          </div>
        </div>
      </Link>
    </>
  );
}

const actionStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontVariantNumeric: 'tabular-nums',
};

function avatarGradient(seed: string): React.CSSProperties {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const c1 = `hsl(${hue}, 70%, 50%)`;
  const c2 = `hsl(${(hue + 40) % 360}, 70%, 30%)`;
  return { background: `linear-gradient(135deg, ${c1}, ${c2})` };
}

function fmtCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return (n / 10_000).toFixed(1).replace(/\.0$/, '') + '万';
}

function formatTimeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}
