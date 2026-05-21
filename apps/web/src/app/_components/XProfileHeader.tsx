import { virtualBlogger } from '../../lib/virtual-blogger';
import { proxiedImage } from '../../lib/media';
import { X } from './theme';

// 博主主页头部 — 在 /topic/source-<id> 上方铺一张 banner + 大头像 + 名字 +
// handle + 统计 + 关注按钮,跟 X profile 的视觉对齐。
//
// 输入是已经查好的 source 行(name/platform)和聚合统计(篇数/最近发文)。
// 调用方负责 JOIN 数据,这里只做展示。
export function XProfileHeader({
  sourceId,
  sourceName,
  sourcePlatform,
  sourceAvatar,
  sourceExternalId,
  articleCount,
  description,
}: {
  sourceId: string;
  sourceName: string;
  sourcePlatform: string | null;
  sourceAvatar?: string | null;
  sourceExternalId?: string | null;
  articleCount: number;
  description?: string | null;
}) {
  const vb = virtualBlogger(sourceId, { platform: sourcePlatform, name: sourceName, externalId: sourceExternalId });
  const banner = bannerGradient(sourceId);
  const avatar = avatarGradient(sourceId);

  return (
    <div style={{ borderBottom: `1px solid ${X.border}` }}>
      {/* Banner — 16:5 渐变色块,X profile 的标准宽高比 */}
      <div style={{
        ...banner,
        aspectRatio: '16 / 5',
        width: '100%',
        position: 'relative',
      }} />

      <div style={{ padding: '12px 16px 16px', position: 'relative' }}>
        {/* 头像悬挂在 banner 下沿,负 margin 把它顶上去一半 */}
        <div style={{ marginBottom: 12 }}>
          {sourceAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={proxiedImage(sourceAvatar, sourceId)} alt={vb.name}
              style={{
                width: 110, height: 110, borderRadius: '50%',
                border: `4px solid ${X.page}`,
                marginTop: -75, objectFit: 'cover', flexShrink: 0,
                background: X.surfaceHover, display: 'block',
              }} />
          ) : (
            <div style={{
              ...avatar,
              width: 110, height: 110,
              borderRadius: '50%',
              border: `4px solid ${X.page}`,
              marginTop: -75,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#ffffff', fontWeight: 800, fontSize: 44,
              flexShrink: 0,
            }}>{vb.initial}</div>
          )}
        </div>

        <div style={{ fontSize: 22, fontWeight: 800, color: X.text, lineHeight: 1.2 }}>{vb.name}</div>
        <div style={{ fontSize: 15, color: X.textMuted, marginTop: 2 }}>{vb.handle}</div>

        {description && (
          <div style={{ fontSize: 15, color: X.text, lineHeight: 1.5, marginTop: 12 }}>
            {description}
          </div>
        )}

        <div style={{ display: 'flex', gap: 18, marginTop: 12, fontSize: 14, color: X.textSecondary, flexWrap: 'wrap' }}>
          <span><strong style={{ color: X.text, fontWeight: 700 }}>{articleCount}</strong> 篇文章</span>
          {sourcePlatform === 'manual'
            ? <span style={{ color: X.accent, fontWeight: 600 }}>手工博主</span>
            : <span>来自 {sourcePlatform}</span>}
        </div>
      </div>
    </div>
  );
}

/** 头像 — 跟 XPost / XRightRail / FollowingFeed 用的同一套哈希渐变,
 *  同一 source_id 在站点任何位置头像色一致。 */
function avatarGradient(seed: string): React.CSSProperties {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return { background: `linear-gradient(135deg, hsl(${hue},70%,50%), hsl(${(hue+40)%360},70%,30%))` };
}

/** Banner — 用同一 hue 反向 + 透明叠加,跟头像协调但不撞色。 */
function bannerGradient(seed: string): React.CSSProperties {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = (h % 360 + 180) % 360;
  return { background: `linear-gradient(135deg, hsl(${hue},60%,35%), hsl(${(hue+30)%360},50%,20%))` };
}
