'use client';

import { useEffect, useState, useCallback } from 'react';
import { AdminNav } from '../../../components/AdminNav';
import { getSprintStart, computeDayLabel } from '../../../lib/sprint';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

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

function Badge({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '16px 20px', minWidth: 120 }}>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

export default function Day5Page() {

  const [dayLabel, setDayLabel] = useState('4/24');
  useEffect(() => { setDayLabel(computeDayLabel(getSprintStart(), 5)); }, []);
  const [stats, setStats] = useState<Stats | null>(null);
  const [items, setItems] = useState<PublishedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, i] = await Promise.all([
        fetch(`${API}/admin/day5/stats`).then((r) => r.json()),
        fetch(`${API}/admin/day5/items?limit=20`).then((r) => r.json()),
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
    setMsg(`${label}...`);
    try {
      const r = await fetch(url, { method: 'POST' });
      const d = await r.json();
      setMsg(`${label} 完成: ${JSON.stringify(d)}`);
      await load();
    } catch (e) {
      setMsg(`${label} 失败: ${e}`);
    }
  };

  const forcePublish = async (id: string) => {
    await action(`${API}/admin/day5/force-publish/${id}`, '强制发布');
  };

  const s = stats?.byStatus ?? {};
  const published = s['PUBLISHED'] ?? 0;
  const compPass = s['COMPLIANCE_PASS'] ?? 0;
  const compReview = s['COMPLIANCE_REVIEW'] ?? 0;
  const total = Object.values(s).reduce((a, b) => a + b, 0);

  const btn: React.CSSProperties = {
    padding: '7px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
    fontSize: 13, fontWeight: 500,
  };

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 20px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <AdminNav current="day5" />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{dayLabel} · 发布与Source评分</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...btn, background: '#2563eb', color: '#fff' }}
            onClick={() => action(`${API}/admin/day5/publish-all`, '批量发布')}>
            批量发布
          </button>
          <button style={{ ...btn, background: '#7c3aed', color: '#fff' }}
            onClick={() => action(`${API}/admin/day5/score-now`, 'Source评分')}>
            Source 评分
          </button>
          <button style={{ ...btn, background: '#f3f4f6', color: '#111' }} onClick={load}>
            刷新
          </button>
        </div>
      </div>

      {msg && (
        <div style={{ marginBottom: 16, padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, fontSize: 13, color: '#166534' }}>
          {msg}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
        <Badge label="总计" value={loading ? '…' : total} color="#111827" />
        <Badge label="已发布" value={loading ? '…' : published} color="#16a34a" />
        <Badge label="24h 新发布" value={loading ? '…' : (stats?.publishedLast24h ?? 0)} color="#2563eb" />
        <Badge label="待发布 (合规通过)" value={loading ? '…' : compPass} color="#d97706" />
        <Badge label="待审核" value={loading ? '…' : compReview} color="#9ca3af" />
      </div>

      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>最新已发布文章</h2>

      {loading ? (
        <p style={{ color: '#6b7280' }}>加载中...</p>
      ) : items.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', background: '#f9fafb', borderRadius: 8, color: '#6b7280', fontSize: 14 }}>
          暂无已发布文章 · 点击「批量发布」将合规通过的文章发布到站点
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
              <th style={{ padding: '8px 10px', color: '#6b7280', fontWeight: 500 }}>标题</th>
              <th style={{ padding: '8px 10px', color: '#6b7280', fontWeight: 500 }}>分类</th>
              <th style={{ padding: '8px 10px', color: '#6b7280', fontWeight: 500 }}>发布时间</th>
              <th style={{ padding: '8px 10px', color: '#6b7280', fontWeight: 500 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '10px 10px' }}>
                  {item.slug ? (
                    <a href={`/a/${item.slug}`} target="_blank" rel="noreferrer"
                      style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 500 }}>
                      {item.title}
                    </a>
                  ) : (
                    <span style={{ color: '#111827' }}>{item.title}</span>
                  )}
                </td>
                <td style={{ padding: '10px 10px', color: '#6b7280' }}>{item.category ?? '—'}</td>
                <td style={{ padding: '10px 10px', color: '#6b7280', whiteSpace: 'nowrap' }}>
                  {item.published_at ? new Date(item.published_at).toLocaleString('zh-CN') : '—'}
                </td>
                <td style={{ padding: '10px 10px' }}>
                  <button style={{ ...btn, background: '#f3f4f6', color: '#374151', fontSize: 12 }}
                    onClick={() => forcePublish(item.id)}>
                    重新发布
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ marginTop: 32, padding: 16, background: '#f9fafb', borderRadius: 8, fontSize: 12, color: '#6b7280' }}>
        <strong>验收要点：</strong> 批量发布 → 文章出现在列表 → 点击标题在站点上打开 → 检查 <a href="/sitemap.xml" target="_blank" style={{ color: '#2563eb' }}>sitemap.xml</a> 包含该 slug → 首页 <a href="/" target="_blank" style={{ color: '#2563eb' }}>/ </a> 显示已发布文章卡片
      </div>
    </main>
  );
}
