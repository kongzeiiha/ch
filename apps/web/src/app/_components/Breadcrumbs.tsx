import Link from 'next/link';
import { X } from './theme';

export interface CrumbItem {
  /** Display text. */
  name: string;
  /** Internal path (no SITE_URL prefix). Last item should omit `href` so the
   *  current page renders as plain text rather than a self-link. */
  href?: string;
}

// Visible breadcrumb. Mirrors the JSON-LD BreadcrumbList already emitted on
// each listing/article page so users see the same hierarchy crawlers do.
// Server-rendered, no JS — every link is crawlable.
export function Breadcrumbs({ items }: { items: CrumbItem[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="面包屑" style={{ fontSize: 14, color: X.textSecondary, marginBottom: 16 }}>
      {items.map((it, i) => (
        <span key={i}>
          {i > 0 && <span style={{ margin: '0 8px', color: X.textMuted }}>›</span>}
          {it.href ? (
            <Link href={it.href} style={{ color: X.accent, textDecoration: 'none' }}>{it.name}</Link>
          ) : (
            <span style={{ color: X.text, fontWeight: 600 }}>{it.name}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
