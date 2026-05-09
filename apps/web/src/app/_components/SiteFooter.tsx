import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer style={{
      marginTop: 60,
      padding: '24px 24px 32px',
      borderTop: '1px solid #1e293b',
      background: '#020617',
      color: '#64748b',
      fontSize: 12,
    }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center' }}>
        <Link href="/search" style={linkStyle}>搜索</Link>
        <Link href="/about/terms" style={linkStyle}>服务条款</Link>
        <Link href="/about/privacy" style={linkStyle}>隐私政策</Link>
        <Link href="/about/dmca" style={linkStyle}>版权投诉</Link>
        <a href="/sitemap.xml" style={linkStyle}>Sitemap</a>
        <a href="/robots.txt" style={linkStyle}>Robots</a>
        <span style={{ marginLeft: 'auto' }}>
          本站内容来自互联网公开来源,仅供学习交流。如有侵权请按 <Link href="/about/dmca" style={linkStyle}>DMCA 流程</Link> 联系下架。
        </span>
      </div>
    </footer>
  );
}

const linkStyle: React.CSSProperties = {
  color: '#94a3b8',
  textDecoration: 'none',
};
