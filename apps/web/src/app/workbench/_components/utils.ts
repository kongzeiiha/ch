// ─── Utility functions ────────────────────────────────────────────────────────

export function cn(...args: (string | boolean | undefined)[]) {
  return args.filter(Boolean).join(' ');
}

export function riskBadge(level: 'low' | 'high', isGate: boolean) {
  if (isGate) return { text: '🔐 人工门控', bg: '#4c1d95', fg: '#ddd6fe' };
  if (level === 'high') return { text: '⚠ 高风险', bg: '#7f1d1d', fg: '#fecaca' };
  return null;
}

// Build stealth-mode (Playwright) extra options from form fields. Validates
// JSON inputs gracefully — invalid JSON is just dropped rather than blocking
// the save (we toast the error instead, but UI doesn't enforce yet).
export function buildStealthOpts(form: { htmlWaitFor: string; htmlExtraHeaders: string; htmlCookies: string; htmlLocale: string; htmlTimezone: string }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (form.htmlWaitFor.trim()) out.waitForSelector = form.htmlWaitFor.trim();
  if (form.htmlLocale.trim()) out.locale = form.htmlLocale.trim();
  if (form.htmlTimezone.trim()) out.timezone = form.htmlTimezone.trim();
  if (form.htmlExtraHeaders.trim()) {
    try { out.extraHeaders = JSON.parse(form.htmlExtraHeaders); } catch { /* ignore — UI hint only */ }
  }
  if (form.htmlCookies.trim()) {
    try { out.cookies = JSON.parse(form.htmlCookies); } catch { /* ignore */ }
  }
  return out;
}

// Parse a single line of 2ksg gallery input. Accepts:
//   - pure number:  "45499"        → { id: '45499' }
//   - SPA URL:      "https://uib.2ksg.com/app/#/detail?mode=img&tid=591&sid=&id=45499"
//                                  → { id: '45499', tid: '591', host: 'uib.2ksg.com' }
export function parseKsgLine(line: string): { id?: string; tid?: string; host?: string } {
  const t = line.trim();
  if (!t) return {};
  if (/^\d+$/.test(t)) return { id: t };
  const id   = t.match(/[?&#/]id=(\d+)/)?.[1];
  const tid  = t.match(/[?&#/]tid=(\d+)/)?.[1];
  const host = t.match(/^https?:\/\/([^/]+)/i)?.[1];
  return { id, tid, host };
}

export function fmtTs(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  // Local-time YYYY-MM-DD HH:mm:ss for at-a-glance reading.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function payloadPreview(p: Record<string, unknown>): string {
  if (!p || typeof p !== 'object') return '—';
  const keys = Object.keys(p);
  if (keys.length === 0) return '—';
  // Skip purely-internal markers like {auto:true} from the catch-all hook.
  const meaningful = keys.filter(k => k !== 'auto');
  if (meaningful.length === 0) return p.auto ? '(自动捕获)' : '—';
  // Show first 2 fields with values truncated. Full JSON is on row click.
  return meaningful.slice(0, 2).map(k => {
    const v = p[k];
    let s: string;
    if (v === null) s = 'null';
    else if (typeof v === 'string') s = v.length > 40 ? v.slice(0, 38) + '…' : v;
    else if (Array.isArray(v)) s = `[${v.length}]`;
    else if (typeof v === 'object') s = '{…}';
    else s = String(v);
    return `${k}=${s}`;
  }).join(' · ');
}

// Build a 0-based page list with ellipses, e.g. [0, '…', 4, 5, 6, '…', 19].
// Always shows: first, last, current ±1.
export function pageNumbers(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  const set = new Set<number>([0, total - 1, current, current - 1, current + 1]);
  const sorted = [...set].filter((p) => p >= 0 && p < total).sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push('…');
    out.push(sorted[i]);
  }
  return out;
}
