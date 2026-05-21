'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { proxiedImage } from '../../lib/media';
import { X } from './theme';

// 文章页评论区 — 合并两路来源后按时间倒序混排:
//   1. 站点匿名评论(comments 表;LS 身份 + 30s rate-limit)
//   2. X 同步评论(external_comments 表;x-comments worker 每 10 分钟刷一次)
//
// 表单只发本站匿名评论(X 评论是镜像,不允许从这里回写)。
// X 来源的卡片右上角加 「来自 X」 徽标 + @handle 链接到 x.com。
const LS_NAME = 'comment:name';
const LS_ANON = 'comment:anon-id';

interface LocalComment {
  kind: 'local';
  id: string;          // local id 转成 string,避免和 external id 冲突
  anonId: string;
  name: string;
  body: string;
  createdAt: string;
}

interface ExternalComment {
  kind: 'external';
  id: string;
  platform: string;    // 现在只有 'x'
  authorHandle: string;
  authorName: string | null;
  authorAvatar: string | null;
  body: string;
  createdAt: string;
}

type MergedComment = LocalComment | ExternalComment;

interface LocalApiComment {
  id: number;
  anonId: string;
  name: string;
  body: string;
  createdAt: string;
}

interface ExternalApiComment {
  id: number;
  platform: string;
  externalId: string;
  authorHandle: string;
  authorName: string | null;
  authorAvatar: string | null;
  body: string;
  postedAt: string;
}

function ensureAnonId(): string {
  let id = localStorage.getItem(LS_ANON);
  if (!id) {
    id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(LS_ANON, id);
  }
  return id;
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return '';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function mergeAndSort(local: LocalComment[], external: ExternalComment[]): MergedComment[] {
  return [...local, ...external].sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    return tb - ta;
  });
}

export function CommentSection({ slug, sourceId }: { slug: string; sourceId?: string | null }) {
  const router = useRouter();
  const [localList, setLocalList] = useState<LocalComment[]>([]);
  const [externalList, setExternalList] = useState<ExternalComment[]>([]);
  const [localTotal, setLocalTotal] = useState(0);
  const [externalTotal, setExternalTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const anonIdRef = useRef<string>(typeof window !== 'undefined' ? ensureAnonId() : '');

  useEffect(() => {
    if (!anonIdRef.current) anonIdRef.current = ensureAnonId();
    setName(localStorage.getItem(LS_NAME) ?? '');
    (async () => {
      // 两个端点并发拉,任一失败不阻塞另一个;两边都空就显示"还没有评论"。
      const [localRes, extRes] = await Promise.allSettled([
        fetch(`/api/comments/${encodeURIComponent(slug)}`).then((r) => r.json()),
        fetch(`/api/external-comments/${encodeURIComponent(slug)}`).then((r) => r.json()),
      ]);

      if (localRes.status === 'fulfilled' && localRes.value?.ok) {
        const d = localRes.value;
        setLocalList((d.comments as LocalApiComment[]).map((c) => ({
          kind: 'local' as const,
          id: `local-${c.id}`,
          anonId: c.anonId,
          name: c.name,
          body: c.body,
          createdAt: c.createdAt,
        })));
        setLocalTotal(d.total ?? 0);
      }

      if (extRes.status === 'fulfilled' && extRes.value?.ok) {
        const d = extRes.value;
        setExternalList((d.comments as ExternalApiComment[]).map((c) => ({
          kind: 'external' as const,
          id: `ext-${c.id}`,
          platform: c.platform,
          authorHandle: c.authorHandle,
          authorName: c.authorName,
          authorAvatar: c.authorAvatar,
          body: c.body,
          createdAt: c.postedAt,
        })));
        setExternalTotal(d.total ?? 0);
      }

      setLoading(false);
    })();
  }, [slug]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const trimmed = body.trim();
    if (!trimmed) { setErr('评论不能为空'); return; }
    let anonId = anonIdRef.current;
    if (!anonId) {
      anonId = ensureAnonId();
      anonIdRef.current = anonId;
    }
    setSubmitting(true);
    setErr('');
    try {
      const trimmedName = name.trim().slice(0, 32);
      if (trimmedName) localStorage.setItem(LS_NAME, trimmedName);
      const r = await fetch(`/api/comment/${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName, body: trimmed, anonId }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      // 把新发的本站评论塞进 local 列表,渲染时和 external 一起按时间排好
      setLocalList((cur) => [
        {
          kind: 'local' as const,
          id: `local-${d.comment.id}`,
          anonId: d.comment.anonId,
          name: d.comment.name,
          body: d.comment.body,
          createdAt: d.comment.createdAt,
        },
        ...cur,
      ]);
      setLocalTotal((n) => n + 1);
      setBody('');
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? '发表失败');
    } finally {
      setSubmitting(false);
    }
  }

  const merged = mergeAndSort(localList, externalList);
  const total = localTotal + externalTotal;

  return (
    <section style={{ marginTop: 32, paddingTop: 20, borderTop: `1px solid ${X.border}` }}>
      <h2 style={{ fontSize: 18, fontWeight: 800, color: X.text, margin: '0 0 14px' }}>
        评论 {total > 0 && <span style={{ color: X.textMuted, fontWeight: 500 }}>· {total}</span>}
      </h2>

      <form onSubmit={submit} style={{
        marginBottom: 24,
        padding: 14,
        border: `1px solid ${X.border}`,
        borderRadius: 12,
        background: X.surface,
      }}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="昵称(留空显示为「匿名」)"
          maxLength={32}
          style={{
            display: 'block', width: '100%',
            padding: '8px 10px', marginBottom: 8,
            fontSize: 14, color: X.text,
            background: X.surfaceInput,
            border: 'none', borderRadius: 8, outline: 'none',
          }}
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="说点什么……"
          rows={3}
          maxLength={2000}
          style={{
            display: 'block', width: '100%',
            padding: '10px 12px',
            fontSize: 15, color: X.text, lineHeight: 1.5,
            background: X.surfaceInput,
            border: 'none', borderRadius: 8, outline: 'none',
            resize: 'vertical', fontFamily: 'inherit',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          <span style={{ fontSize: 12, color: err ? '#f4212e' : X.textMuted }}>
            {err || `${body.length} / 2000`}
          </span>
          <button
            type="submit"
            disabled={submitting || !body.trim()}
            style={{
              padding: '8px 20px', borderRadius: 9999,
              background: submitting || !body.trim() ? X.borderStrong : X.accent,
              color: '#ffffff', border: 'none',
              fontSize: 14, fontWeight: 700,
              cursor: submitting || !body.trim() ? 'not-allowed' : 'pointer',
            }}
          >{submitting ? '发表中…' : '发表'}</button>
        </div>
      </form>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 24, color: X.textMuted, fontSize: 13 }}>加载中…</div>
      ) : merged.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 24, color: X.textMuted, fontSize: 14 }}>
          还没有评论 · 你来当第一个
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {merged.map((c) =>
            c.kind === 'local'
              ? <LocalRow key={c.id} c={c} isMine={c.anonId === anonIdRef.current} />
              : <ExternalRow key={c.id} c={c} sourceId={sourceId ?? null} />,
          )}
          {(localTotal > localList.length || externalTotal > externalList.length) && (
            <li style={{ textAlign: 'center', padding: 12, fontSize: 12, color: X.textMuted, listStyle: 'none' }}>
              已显示最近 {merged.length} 条,共 {total} 条
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function LocalRow({ c, isMine }: { c: LocalComment; isMine: boolean }) {
  return (
    <li style={{
      padding: 12,
      background: isMine ? 'rgba(29,155,240,0.05)' : 'transparent',
      border: `1px solid ${X.border}`,
      borderRadius: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <span style={{ fontWeight: 700, color: X.text, fontSize: 14 }}>{c.name}</span>
        {isMine && <span style={{ fontSize: 11, color: X.accent, fontWeight: 600 }}>我</span>}
        <span style={{ fontSize: 12, color: X.textMuted, marginLeft: 'auto' }}>{timeAgo(c.createdAt)}</span>
      </div>
      <div style={{ fontSize: 15, color: X.text, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {c.body}
      </div>
    </li>
  );
}

function ExternalRow({ c, sourceId }: { c: ExternalComment; sourceId: string | null }) {
  return (
    <li style={{
      padding: 12,
      border: `1px solid ${X.border}`,
      borderRadius: 12,
      display: 'flex', gap: 10,
    }}>
      {c.authorAvatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={proxiedImage(c.authorAvatar, sourceId)} alt={c.authorName ?? c.authorHandle}
          loading="lazy"
          style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, objectFit: 'cover', background: X.surfaceHover }} />
      ) : (
        <div style={{
          width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: X.surfaceHover, color: X.textSecondary, fontWeight: 700, fontSize: 16,
        }}>{(c.authorName ?? c.authorHandle).charAt(0).toUpperCase()}</div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, color: X.text, fontSize: 14 }}>{c.authorName ?? c.authorHandle}</span>
          <a
            href={`https://x.com/${c.authorHandle}`}
            target="_blank" rel="noreferrer noopener"
            style={{ fontSize: 13, color: X.textMuted, textDecoration: 'none' }}
          >@{c.authorHandle}</a>
          <span style={{
            fontSize: 10, fontWeight: 700,
            padding: '2px 6px', borderRadius: 4,
            background: X.surfaceHover, color: X.textSecondary,
            letterSpacing: 0.5,
          }}>来自 X</span>
          <span style={{ fontSize: 12, color: X.textMuted, marginLeft: 'auto' }}>{timeAgo(c.createdAt)}</span>
        </div>
        <div style={{ fontSize: 15, color: X.text, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 4 }}>
          {c.body}
        </div>
      </div>
    </li>
  );
}
