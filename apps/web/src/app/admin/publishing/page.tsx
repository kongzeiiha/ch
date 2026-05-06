'use client';

import { useEffect, useState, useCallback } from 'react';
import { AdminNav } from '../../../components/AdminNav';
import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL ?? '/api';

interface Stats {
  byStatus: Record<string, number>;
  publishedLast24h: number;
}

interface PublishedItem {
  id: string;
  slug: string;
  title: string;
  category: string | null;
  published_at: string | null;
  published_url: string | null;
}

const card: React.CSSProperties = { background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: 16 };
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600, color: '#94a3b8', borderBottom: '1px solid #334155', background: '#0f172a', textTransform: 'uppercase', letterSpacing: 0.4 };
const td: React.CSSProperties = { padding: '10px 12px', fontSize: 13, borderBottom: '1px solid #334155', verticalAlign: 'top', color: '#e2e8f0' };
const btn: React.CSSProperties = { padding: '6px 12px', fontSize: 12, border: '1px solid #334155', borderRadius: 6, background: 'transparent', color: '#94a3b8', cursor: 'pointer' };
const btnPrimary: React.CSSProperties = { ...btn, background: '#6366f1', color: '#fff', borderColor: '#6366f1', fontWeight: 600 };
const btnAlt: React.CSSProperties = { ...btn, background: '#7c3aed', color: '#fff', borderColor: '#7c3aed', fontWeight: 600 };

function Tile({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div style={card}>
      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: accent ?? '#e2e8f0' }}>{value}</div>
    </div>
  );
}

export default function Day5Page() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [items, setItems] = useState<PublishedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, i] = await Promise.all([
        fetch(`${API}/admin/publishing/stats`).then((r) => r.json()),
        fetch(`${API}/admin/publishing/items?limit=20`).then((r) => r.json()),
      ]);
      setStats(s);
      setItems(i.items ?? []);
    } catch (e) {
      setMsg(`加载失败: ${e}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const action = async (url: string, label: string) => {
    setBusy(true);
    setMsg(`${label}...`);
    try {
      const r = await fetch(url, { method: 'POST' });
      const d = await r.json();
      setMsg(`${label} 完成: ${JSON.stringify(d)}`);
      await load();
    } catch (e) {
      setMsg(`${label} 失败: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  const forcePublish = async (id: string) => {
    setBusyId((b) => ({ ...b, [id]: true }));
    try {
      await action(`${API}/admin/publishing/force-publish/${id}`, '强制发布');
    } finally {
      setBusyId((b) => ({ ...b, [id]: false }));
    }
  };

  const s = stats?.byStatus ?? {};
  const published = s['PUBLISHED'] ?? 0;
  const compPass = s['COMPLIANCE_PASS'] ?? 0;
  const compReview = s['COMPLIANCE_REVIEW'] ?? 0;
  const total = Object.values(s).reduce((a, b) => a + b, 0);

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', fontFamily: 'system-ui, -apple-system, PingFang SC, sans-serif' }}>
      <header style={{ background: '#020617', borderBottom: '1px solid #1e293b', padding: '0 24px', height: 52, display: 'flex', alignItems: 'center', gap: 16, position: 'sticky', top: 0, zIndex: 100 }}>
        <span style={{ color: '#e2e8f0', fontSize: 16, fontWeight: 800 }}>内容中台</span>
        <span style={{ color: '#334155' }}>/</span>
        <span style={{ fontSize: 13, color: '#64748b' }}>发布与 Source 评分</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Link href="/workbench" style={{ ...btn, textDecoration: 'none', color: '#e2e8f0', display: 'inline-flex', alignItems: 'center' }}>← 工作台</Link><button style={btn} onClick={load}>↻ 刷新</button>
          <button style={btnAlt} disabled={busy} onClick={() => action(`${API}/admin/publishing/score-now`, 'Source评分')}>{busy ? '处理中…' : 'Source 评分'}</button>
          <button style={btnPrimary} disabled={busy} onClick={() => action(`${API}/admin/publishing/publish-all`, '批量发布')}>{busy ? '处理中…' : '批量发布'}</button>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 20px 60px' }}>
        <AdminNav current="publishing" />

        {msg && (
          <div style={{ marginBottom: 16, padding: '10px 14px', background: '#052e16', border: '1px solid #16a34a', borderRadius: 6, fontSize: 13, color: '#86efac' }}>
            {msg}
          </div>
        )}

        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
          <Tile label="总计" value={loading ? '…' : total} />
          <Tile label="已发布" value={loading ? '…' : published} accent="#22c55e" />
          <Tile label="24h 新发布" value={loading ? '…' : (stats?.publishedLast24h ?? 0)} accent="#0ea5e9" />
          <Tile label="待发布 (合规通过)" value={loading ? '…' : compPass} accent="#fbbf24" />
          <Tile label="待审核" value={loading ? '…' : compReview} accent="#94a3b8" />
        </section>

        <h3 style={{ fontSize: 12, color: '#64748b', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}>
          最新已发布文章
        </h3>

        {loading ? (
          <div style={{ ...card, color: '#64748b', textAlign: 'center', fontSize: 13 }}>加载中…</div>
        ) : items.length === 0 ? (
          <div style={{ ...card, color: '#64748b', textAlign: 'center', fontSize: 14 }}>
            暂无已发布文章 · 点击「批量发布」将合规通过的文章发布到站点
          </div>
        ) : (
          <section style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>标题</th>
                  <th style={th}>分类</th>
                  <th style={th}>发布时间</th>
                  <th style={th}>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td style={td}>
                      {item.slug ? (
                        <a href={`/a/${item.slug}`} target="_blank" rel="noreferrer" style={{ color: '#60a5fa', textDecoration: 'none', fontWeight: 500 }}>
                          {item.title}
                        </a>
                      ) : (
                        <span style={{ color: '#e2e8f0' }}>{item.title}</span>
                      )}
                    </td>
                    <td style={{ ...td, color: '#94a3b8' }}>{item.category ?? '—'}</td>
                    <td style={{ ...td, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                      {item.published_at ? new Date(item.published_at).toLocaleString('zh-CN') : '—'}
                    </td>
                    <td style={td}>
                      <button style={btn} disabled={!!busyId[item.id] || busy} onClick={() => forcePublish(item.id)}>{busyId[item.id] ? '…' : '重新发布'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <div style={{ marginTop: 24, padding: 14, background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12, color: '#94a3b8', lineHeight: 1.7 }}>
          <strong style={{ color: '#cbd5e1' }}>验收要点:</strong> 批量发布 → 文章出现在列表 → 点击标题在站点上打开 → 检查
          <a href="/sitemap.xml" target="_blank" style={{ color: '#60a5fa', margin: '0 4px' }}>sitemap.xml</a>
          包含该 slug → 首页
          <a href="/" target="_blank" style={{ color: '#60a5fa', margin: '0 4px' }}>/</a>
          显示已发布文章卡片
        </div>
      </div>
    </div>
  );
}
