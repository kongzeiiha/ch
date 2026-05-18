'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { ArticleCardRow } from '../../lib/feed';
import { XPost } from './XPost';
import { X } from './theme';

// 客户端"我关注的"feed 渲染 — 读 LS 拿 sourceIds,POST 给 API 拿 items。
// 拆成独立 client 组件,让 page.tsx 可以保持 server component(否则会把
// XLayout 等查 DB 的 server-only 模块拖到 client bundle,撞到 dns 包)。
const LS_KEY = 'followed-sources';

interface RawRow {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  source_id: string | null;
  cover_url: string | null;
  cover_sizes: string | Record<string, string> | null;
  cover_fallback: string | null;
  source: string | null;
  source_platform: string | null;
  category: string | null;
  tags: string | string[] | null;
  published_at: string | null;
  duration_sec: number | null;
  has_video: number | boolean;
  has_image: number | boolean;
  video_url: string | null;
  content_length: number | string;
  likes: number | string;
  pv_30d: number | string;
}

function normalize(r: RawRow): ArticleCardRow {
  const parseJson = <T,>(v: unknown): T | null => {
    if (v == null) return null;
    if (typeof v === 'string') { try { return JSON.parse(v) as T; } catch { return null; } }
    return v as T;
  };
  return {
    id: r.id, slug: r.slug, title: r.title, summary: r.summary,
    cover_url: r.cover_url,
    cover_sizes: parseJson<Record<string, string>>(r.cover_sizes),
    cover_fallback: r.cover_fallback ?? null,
    source_id: r.source_id ?? null,
    has_video: Boolean(Number(r.has_video ?? 0)),
    has_image: Boolean(Number(r.has_image ?? 0)),
    video_url: r.video_url ?? null,
    duration_sec: r.duration_sec != null ? Number(r.duration_sec) : null,
    category: r.category,
    tags: Array.isArray(r.tags) ? r.tags : parseJson<string[]>(r.tags) ?? [],
    published_at: r.published_at,
    source: r.source ?? null,
    source_platform: r.source_platform ?? null,
    content_length: Number(r.content_length ?? 0),
    likes: Number(r.likes ?? 0),
    pv_30d: Number(r.pv_30d ?? 0),
  };
}

export function FollowingFeed() {
  const [state, setState] = useState<'loading' | 'empty-follow' | 'empty-items' | 'ready' | 'error'>('loading');
  const [items, setItems] = useState<ArticleCardRow[]>([]);
  const [total, setTotal] = useState(0);
  const [followCount, setFollowCount] = useState(0);
  const [err, setErr] = useState<string>('');

  useEffect(() => {
    (async () => {
      let ids: string[] = [];
      try {
        const raw = localStorage.getItem(LS_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        ids = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
      } catch { ids = []; }
      setFollowCount(ids.length);
      if (ids.length === 0) { setState('empty-follow'); return; }

      try {
        const r = await fetch('/api/following/feed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceIds: ids, limit: 50 }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
        const normalized: ArticleCardRow[] = (d.items as RawRow[]).map(normalize);
        setItems(normalized);
        setTotal(Number(d.total ?? 0));
        setState(normalized.length === 0 ? 'empty-items' : 'ready');
      } catch (e: any) {
        setErr(e?.message ?? '加载失败');
        setState('error');
      }
    })();
  }, []);

  if (state === 'loading') {
    return <div style={{ padding: 40, textAlign: 'center', color: X.textSecondary }}>加载中…</div>;
  }
  if (state === 'empty-follow') {
    return (
      <div style={{ padding: '60px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>👀</div>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: X.text, margin: '0 0 8px' }}>还没关注任何人</h2>
        <p style={{ color: X.textSecondary, marginBottom: 20, lineHeight: 1.6 }}>
          去<Link href="/bloggers" style={{ color: X.accent, textDecoration: 'none' }}> 博主列表</Link>找你感兴趣的人,点「关注」即可。
          <br />关注记录存在你的浏览器里,换设备会重置。
        </p>
        <Link href="/bloggers" style={{
          display: 'inline-block', padding: '10px 24px',
          background: X.text, color: X.page,
          borderRadius: 9999, fontSize: 14, fontWeight: 700, textDecoration: 'none',
        }}>去发现博主</Link>
      </div>
    );
  }
  if (state === 'empty-items') {
    return (
      <div style={{ padding: '60px 20px', textAlign: 'center' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: X.text, margin: '0 0 8px' }}>关注的博主暂无内容</h2>
        <p style={{ color: X.textSecondary, marginBottom: 20 }}>
          已关注 {followCount} 位,但他们都还没发文章。
        </p>
        <Link href="/bloggers" style={{
          display: 'inline-block', padding: '8px 20px',
          background: 'transparent', color: X.text,
          border: `1px solid ${X.borderStrong}`,
          borderRadius: 9999, fontSize: 14, fontWeight: 600, textDecoration: 'none',
        }}>管理我的关注</Link>
      </div>
    );
  }
  if (state === 'error') {
    return <div style={{ padding: 40, textAlign: 'center', color: '#f4212e' }}>加载失败：{err}</div>;
  }
  return (
    <>
      <div style={{ padding: '8px 16px', fontSize: 13, color: X.textSecondary, borderBottom: `1px solid ${X.border}` }}>
        来自你关注的 {followCount} 位博主 · 共 {total} 篇
      </div>
      {items.map((a) => <XPost key={a.id} a={a} />)}
      {items.length < total && (
        <div style={{ padding: '16px 16px 40px', textAlign: 'center', fontSize: 13, color: X.textMuted }}>
          已显示 50 条 · 还有更多内容
        </div>
      )}
    </>
  );
}
