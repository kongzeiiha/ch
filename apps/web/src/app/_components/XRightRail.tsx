import Link from 'next/link';
import { getTopTags, getTopSources } from '../../lib/feed';
import { virtualBlogger } from '../../lib/virtual-blogger';
import { X } from './theme';
import { SearchIcon } from './XIcons';

// X.com 风格右栏:搜索框 + 热门标签 + 推荐采集源 三块。
// hover 高亮靠 className(inline style 没法触发 :hover)。
const RAIL_CSS = `
  .xrail-trend { transition: background 0.15s; border-radius: 6px; }
  .xrail-trend:hover { background: ${X.surfaceHover}; }
  .xrail-search { transition: border-color 0.15s; }
  .xrail-search:focus-within { border-color: ${X.accent}; }
`;

export async function XRightRail() {
  const [tags, sources] = await Promise.all([
    getTopTags(6),
    getTopSources(5),
  ]);

  return (
    <aside style={{
      padding: '12px 14px',
      position: 'sticky',
      top: 0,
      height: '100vh',
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
    }}>
      <style dangerouslySetInnerHTML={{ __html: RAIL_CSS }} />

      <form action="/search" method="get" className="xrail-search" style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: '#f7f9f9',
        border: '1px solid transparent',
        borderRadius: 9999,
        padding: '10px 16px',
      }}>
        <span style={{ color: X.textMuted, display: 'inline-flex' }}>
          <SearchIcon size={18} />
        </span>
        <input
          name="q"
          type="search"
          placeholder="搜索文章 / 标签"
          aria-label="站内搜索"
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: X.text,
            fontSize: 14,
            padding: 0,
          }}
        />
      </form>

      {tags.length > 0 && (
        <section style={blockStyle}>
          <h3 style={blockTitleStyle}>热门标签</h3>
          {tags.map((t) => (
            <Link key={t.tag} href={`/tag/${encodeURIComponent(t.tag)}`}
              className="xrail-trend"
              style={{ display: 'block', padding: '8px 12px', textDecoration: 'none', margin: '0 -12px' }}>
              <div style={{ fontSize: 11, color: X.textMuted }}>#{t.tag}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: X.text, margin: '2px 0' }}>{t.tag}</div>
              <div style={{ fontSize: 12, color: X.textMuted }}>{t.count} 篇文章</div>
            </Link>
          ))}
        </section>
      )}

      {sources.length > 0 && (
        <section style={blockStyle}>
          <h3 style={blockTitleStyle}>推荐博主</h3>
          {sources.map((s) => {
            // 跟 XPost 一致:爬虫源哈希化名,手工源用 s.name 直显。
            const vb = virtualBlogger(s.id, { platform: s.platform, name: s.name });
            return (
              <Link key={s.id} href={`/topic/source-${s.id}`}
                className="xrail-trend"
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px', margin: '0 -12px',
                  textDecoration: 'none',
                }}>
                <div style={{
                  ...avatarGradient(s.id),
                  width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#ffffff', fontWeight: 800, fontSize: 16,
                }}>{vb.initial}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: X.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{vb.name}</div>
                  <div style={{ fontSize: 12, color: X.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{vb.handle} · {s.article_count} 篇</div>
                </div>
              </Link>
            );
          })}
        </section>
      )}
    </aside>
  );
}

const blockStyle: React.CSSProperties = {
  background: '#f7f9f9',
  borderRadius: 16,
  padding: '14px 12px',
};

const blockTitleStyle: React.CSSProperties = {
  margin: '0 0 6px',
  padding: '0 4px',
  fontSize: 20,
  fontWeight: 800,
  color: '#0f1419',
};

function avatarGradient(seed: string): React.CSSProperties {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return { background: `linear-gradient(135deg, hsl(${hue},70%,50%), hsl(${(hue+40)%360},70%,30%))` };
}
