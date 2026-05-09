'use client';

import { useEffect, useState } from 'react';

const COOKIE = 'age_ok';
const TTL_DAYS = 365;

// Soft age gate. Renders nothing on the server (so SEO crawlers see the full
// page) and on first client paint after hydration. If no cookie is set, it
// surfaces a blocking modal until the user confirms 18+ — the page underneath
// stays in the DOM so back-button works and bots that ignore JS still index.
export function AgeGate({ exitUrl }: { exitUrl: string }) {
  const [confirmed, setConfirmed] = useState<boolean | null>(null);

  useEffect(() => {
    const has = document.cookie.split('; ').some((c) => c.startsWith(`${COOKIE}=1`));
    setConfirmed(has);
  }, []);

  if (confirmed === null || confirmed) return null;

  const accept = () => {
    const expires = new Date(Date.now() + TTL_DAYS * 86400_000).toUTCString();
    document.cookie = `${COOKIE}=1; path=/; expires=${expires}; SameSite=Lax`;
    setConfirmed(true);
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="age-gate-title"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: '#020617e6',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}>
      <div style={{
        maxWidth: 420,
        background: '#1e293b',
        border: '1px solid #334155',
        borderRadius: 10,
        padding: '28px 28px 22px',
        color: '#e2e8f0',
      }}>
        <div id="age-gate-title" style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>
          年龄确认
        </div>
        <p style={{ fontSize: 14, color: '#cbd5e1', lineHeight: 1.65, margin: '0 0 18px' }}>
          本站内容包含部分仅适合成年人浏览的素材。继续浏览即表示您已年满 18 周岁,
          并自愿接受本站的 <a href="/about/terms" style={{ color: '#a5b4fc' }}>服务条款</a> 与
          <a href="/about/privacy" style={{ color: '#a5b4fc' }}> 隐私政策</a>。
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={accept} style={{
            flex: 1,
            padding: '10px 0',
            background: '#6366f1',
            border: 'none',
            borderRadius: 6,
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}>我已年满 18 岁</button>
          <a href={exitUrl} style={{
            padding: '10px 14px',
            background: 'transparent',
            border: '1px solid #334155',
            borderRadius: 6,
            color: '#94a3b8',
            fontSize: 13,
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
          }}>离开</a>
        </div>
      </div>
    </div>
  );
}
