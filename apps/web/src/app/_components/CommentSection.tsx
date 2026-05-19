'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { X } from './theme';

// 文章页评论区 — 站点无用户系统,匿名身份完全靠 LS:
//   - comment:name      用户起的昵称(默认"匿名",可改)
//   - comment:anon-id   首次访问生成的 uuid 标 -- 后端用来标识"我自己的评论"
//
// 服务端有 IP+UA 指纹的 30s rate-limit,所以 LS 清掉也不能瞬时灌水。
const LS_NAME = 'comment:name';
const LS_ANON = 'comment:anon-id';

interface Comment {
  id: number;
  anonId: string;
  name: string;
  body: string;
  createdAt: string;
}

function ensureAnonId(): string {
  let id = localStorage.getItem(LS_ANON);
  if (!id) {
    // crypto.randomUUID 在 https/localhost 都可用;退路用 Math.random 保底
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

export function CommentSection({ slug }: { slug: string }) {
  const router = useRouter();
  const [comments, setComments] = useState<Comment[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  // anonIdRef 必须在 useState 阶段就用 lazy initializer 拿到值, 不能放 useEffect
  // 里赋值 — useEffect 在 mount 后才跑, 用户极速提交评论时可能赶在 ref 写入前
  // 触发 submit, anonId 是空字符串, 后端 400 拒绝。
  // useRef 接 init function 在某些 React 版本下不直接支持; 这里直接传初值,
  // ensureAnonId 在 SSR 时返回空,客户端 hydrate 后 useEffect 再补写一次。
  const anonIdRef = useRef<string>(typeof window !== 'undefined' ? ensureAnonId() : '');

  useEffect(() => {
    // 双重兜底:SSR 阶段 ref 是 '',hydration 后这里补一次。同时同步 nickname。
    if (!anonIdRef.current) anonIdRef.current = ensureAnonId();
    setName(localStorage.getItem(LS_NAME) ?? '');
    (async () => {
      try {
        const r = await fetch(`/api/comments/${encodeURIComponent(slug)}`);
        const d = await r.json();
        if (r.ok && d.ok) {
          setComments(d.comments ?? []);
          setTotal(d.total ?? 0);
        }
      } catch { /* 静默 — 网络故障时区域显示空,不阻塞文章页 */ }
      setLoading(false);
    })();
  }, [slug]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const trimmed = body.trim();
    if (!trimmed) { setErr('评论不能为空'); return; }
    // 极端兜底:点击极快 hydration 还没完成时,这里现拿一次 anonId
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
      setComments((cur) => [d.comment, ...cur]);
      setTotal((n) => n + 1);
      setBody('');
      // 让当前(文章)页的 RSC payload 失效;回列表时 staleTimes.dynamic=0
      // 强制重拉 server data,💬 计数立即同步。
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? '发表失败');
    } finally {
      setSubmitting(false);
    }
  }

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
      ) : comments.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 24, color: X.textMuted, fontSize: 14 }}>
          还没有评论 · 你来当第一个
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {comments.map((c) => {
            const isMine = c.anonId === anonIdRef.current;
            return (
              <li key={c.id} style={{
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
          })}
          {total > comments.length && (
            <li style={{ textAlign: 'center', padding: 12, fontSize: 12, color: X.textMuted, listStyle: 'none' }}>
              已显示最近 {comments.length} 条,共 {total} 条
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
