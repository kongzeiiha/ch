// Traffic-driving module. Renders any of the configured external channels
// (newsletter / Telegram / RSS / X). Hides itself entirely when no channel
// env vars are set, so dev environments don't show empty CTAs.
const CHANNELS = [
  { env: 'NEWSLETTER_URL', label: '订阅邮件简报',     icon: '✉' },
  { env: 'TELEGRAM_URL',   label: '加入 Telegram 频道', icon: '✈' },
  { env: 'X_URL',          label: '关注 X',           icon: '𝕏' },
  { env: 'RSS_URL',        label: 'RSS 订阅',          icon: '◉' },
] as const;

export function CTAModule({ compact = false }: { compact?: boolean }) {
  const items = CHANNELS
    .map((c) => ({ ...c, url: process.env[c.env] }))
    .filter((c): c is typeof c & { url: string } => !!c.url);
  if (items.length === 0) return null;

  return (
    <aside style={{
      background: '#1e293b',
      border: '1px solid #334155',
      borderRadius: 8,
      padding: compact ? '12px 14px' : '18px 20px',
    }}>
      {!compact && (
        <div style={{ fontSize: 13, color: '#cbd5e1', fontWeight: 600, marginBottom: 10 }}>
          不想错过更新?
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {items.map((c) => (
          <a key={c.env} href={c.url} target="_blank" rel="noreferrer" style={{
            padding: '6px 12px',
            border: '1px solid #6366f1',
            borderRadius: 6,
            color: '#a5b4fc',
            textDecoration: 'none',
            fontSize: 12,
            fontWeight: 500,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}>
            <span>{c.icon}</span> {c.label}
          </a>
        ))}
      </div>
    </aside>
  );
}
