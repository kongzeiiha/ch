import Link from 'next/link';
import { X } from './theme';

export function SiteFooter() {
  return (
    <footer style={{
      marginTop: 60,
      padding: '24px 24px 32px',
      borderTop: `1px solid ${X.border}`,
      background: X.surface,
      color: X.textSecondary,
      fontSize: 13,
    }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center' }}>
        <Link href="/search" style={linkStyle}>搜索</Link>
        <Link href="/about/terms" style={linkStyle}>服务条款</Link>
        <Link href="/about/privacy" style={linkStyle}>隐私政策</Link>
        <Link href="/about/dmca" style={linkStyle}>版权投诉</Link>
        <a href="/sitemap.xml" style={linkStyle}>Sitemap</a>
        <a href="/robots.txt" style={linkStyle}>Robots</a>
        <span style={{ marginLeft: 'auto', color: X.textMuted }}>
          本站内容来自互联网公开来源,仅供学习交流。如有侵权请按 <Link href="/about/dmca" style={linkStyle}>DMCA 流程</Link> 联系下架。
        </span>
      </div>
    </footer>
  );
}

const linkStyle: React.CSSProperties = {
  color: X.textSecondary,
  textDecoration: 'none',
};
