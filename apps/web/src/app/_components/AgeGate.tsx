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
        background: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}>
      <div style={{
        maxWidth: 420,
        background: '#ffffff',
        border: '1px solid #eff3f4',
        borderRadius: 16,
        padding: '28px 28px 22px',
        color: '#0f1419',
        boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
      }}>
        <div id="age-gate-title" style={{ fontSize: 20, fontWeight: 800, marginBottom: 10 }}>
          年龄确认
        </div>
        <p style={{ fontSize: 15, color: '#536471', lineHeight: 1.6, margin: '0 0 18px' }}>
          本站内容包含部分仅适合成年人浏览的素材。继续浏览即表示您已年满 18 周岁,
          并自愿接受本站的 <a href="/about/terms" style={{ color: '#1d9bf0', textDecoration: 'none' }}>服务条款</a> 与
          <a href="/about/privacy" style={{ color: '#1d9bf0', textDecoration: 'none' }}> 隐私政策</a>。
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={accept} style={{
            flex: 1,
            padding: '12px 0',
            background: '#1d9bf0',
            border: 'none',
            borderRadius: 9999,
            color: '#ffffff',
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
          }}>我已年满 18 岁</button>
          <a href={exitUrl} style={{
            padding: '12px 16px',
            background: 'transparent',
            border: '1px solid #cfd9de',
            borderRadius: 9999,
            color: '#0f1419',
            fontSize: 14,
            fontWeight: 600,
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
          }}>离开</a>
        </div>
      </div>
    </div>
  );
}
