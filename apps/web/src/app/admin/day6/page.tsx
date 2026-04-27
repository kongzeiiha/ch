'use client';

import { useEffect, useState, useCallback } from 'react';
import { AdminNav } from '../../../components/AdminNav';
import { getSprintStart, computeDayLabel } from '../../../lib/sprint';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface DistTask {
  id: string;
  item_id: string;
  channel: string;
  copy: string;
  status: string;
  created_at: string;
  title: string;
  slug: string | null;
}

interface DistStats {
  byStatus: Record<string, number>;
  byChannel: Record<string, number>;
  pendingDistribution: number;
}

interface AnalyticsSummary {
  total_pv: number;
  total_uv: number;
  total_revenue: number;
}

interface DailyRow {
  date: string;
  pv: number;
  uv: number;
  revenue: number;
}

interface TopItem {
  title: string;
  slug: string | null;
  pv: number;
  uv: number;
  revenue: number;
}

function Badge({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '14px 18px', minWidth: 110 }}>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button onClick={copy}
      style={{ padding: '4px 10px', fontSize: 12, borderRadius: 4, border: '1px solid #d1d5db', background: copied ? '#d1fae5' : '#fff', cursor: 'pointer', color: copied ? '#065f46' : '#374151', whiteSpace: 'nowrap' }}>
      {copied ? '已复制' : '复制文案'}
    </button>
  );
}

export default function Day6Page() {

  const [dayLabel, setDayLabel] = useState('4/25');
  useEffect(() => { setDayLabel(computeDayLabel(getSprintStart(), 6)); }, []);
  const [distStats, setDistStats] = useState<DistStats | null>(null);
  const [tasks, setTasks] = useState<DistTask[]>([]);
  const [analyticsSum, setAnalyticsSum] = useState<AnalyticsSummary | null>(null);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [topItems, setTopItems] = useState<TopItem[]>([]);
  const [report, setReport] = useState<string>('');
  const [showReport, setShowReport] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, tasksRes, analyticsRes] = await Promise.all([
        fetch(`${API}/admin/day6/distribution-stats`).then((r) => r.json()),
        fetch(`${API}/admin/day6/distribution?limit=50`).then((r) => r.json()),
        fetch(`${API}/admin/day6/analytics`).then((r) => r.json()),
      ]);
      setDistStats(statsRes);
      setTasks(tasksRes.tasks ?? []);
      setAnalyticsSum(analyticsRes.summary);
      setDaily(analyticsRes.daily ?? []);
      setTopItems(analyticsRes.topItems ?? []);
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

  const loadReport = async () => {
    setMsg('生成周报...');
    try {
      const r = await fetch(`${API}/admin/day6/report`).then((r) => r.json());
      setReport(r.markdown ?? '');
      setShowReport(true);
      setMsg('');
    } catch (e) {
      setMsg(`周报生成失败: ${e}`);
    }
  };

  const btn: React.CSSProperties = {
    padding: '7px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
    fontSize: 13, fontWeight: 500,
  };

  const s = distStats ?? { byStatus: {}, byChannel: {}, pendingDistribution: 0 };
  const totalDist = Object.values(s.byStatus).reduce((a, b) => a + b, 0);

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 20px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <AdminNav current="day6" />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{dayLabel} · 分发 & Analytics</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button style={{ ...btn, background: '#2563eb', color: '#fff' }}
            onClick={() => action(`${API}/admin/day6/distribute-all`, '批量分发')}>
            批量生成推文
          </button>
          <button style={{ ...btn, background: '#059669', color: '#fff' }}
            onClick={() => action(`${API}/admin/day6/analytics-pull`, 'GA4 拉取')}>
            拉取 GA4 数据
          </button>
          <button style={{ ...btn, background: '#7c3aed', color: '#fff' }}
            onClick={loadReport}>
            生成周报
          </button>
          <button style={{ ...btn, background: '#f3f4f6', color: '#111' }} onClick={load}>刷新</button>
        </div>
      </div>

      {msg && (
        <div style={{ marginBottom: 16, padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, fontSize: 13, color: '#166534' }}>
          {msg}
        </div>
      )}

      {/* ── Distribution Stats ── */}
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>Agent 8 · Distribution</h2>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
        <Badge label="已生成推文" value={loading ? '…' : totalDist} color="#111827" />
        <Badge label="待分发文章" value={loading ? '…' : s.pendingDistribution} color="#d97706" />
        <Badge label="Twitter" value={loading ? '…' : (s.byChannel['twitter'] ?? 0)} color="#1d9bf0" />
      </div>

      {/* ── Distribution Tasks Table ── */}
      {!loading && tasks.length === 0 ? (
        <div style={{ padding: 28, textAlign: 'center', background: '#f9fafb', borderRadius: 8, color: '#6b7280', fontSize: 14, marginBottom: 32 }}>
          暂无分发记录 · 点击「批量生成推文」为已发布文章生成 Twitter 文案
        </div>
      ) : (
        <div style={{ marginBottom: 32, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                <th style={{ padding: '8px 10px', color: '#6b7280', fontWeight: 500 }}>文章</th>
                <th style={{ padding: '8px 10px', color: '#6b7280', fontWeight: 500 }}>渠道</th>
                <th style={{ padding: '8px 10px', color: '#6b7280', fontWeight: 500, width: '40%' }}>推文文案</th>
                <th style={{ padding: '8px 10px', color: '#6b7280', fontWeight: 500 }}>状态</th>
                <th style={{ padding: '8px 10px', color: '#6b7280', fontWeight: 500 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id} style={{ borderBottom: '1px solid #f3f4f6', verticalAlign: 'top' }}>
                  <td style={{ padding: '10px 10px', maxWidth: 200 }}>
                    {t.slug ? (
                      <a href={`/a/${t.slug}`} target="_blank" rel="noreferrer"
                        style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 500, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {t.title}
                      </a>
                    ) : (
                      <span style={{ color: '#111' }}>{t.title}</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 10px', color: '#1d9bf0', fontWeight: 500 }}>
                    {t.channel === 'twitter' ? 'X / Twitter' : t.channel}
                  </td>
                  <td style={{ padding: '10px 10px', color: '#374151', lineHeight: 1.5, fontSize: 12 }}>
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', wordBreak: 'break-word' }}>{t.copy}</pre>
                  </td>
                  <td style={{ padding: '10px 10px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, background: t.status === 'done' ? '#d1fae5' : '#fef9c3', color: t.status === 'done' ? '#065f46' : '#92400e' }}>
                      {t.status}
                    </span>
                  </td>
                  <td style={{ padding: '10px 10px' }}>
                    <CopyButton text={t.copy} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Analytics ── */}
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>Agent 9 · Analytics（近 7 天）</h2>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <Badge label="总 PV" value={loading ? '…' : (analyticsSum?.total_pv ?? 0).toLocaleString()} color="#2563eb" />
        <Badge label="总 UV" value={loading ? '…' : (analyticsSum?.total_uv ?? 0).toLocaleString()} color="#7c3aed" />
        <Badge label="广告收入" value={loading ? '…' : `$${Number(analyticsSum?.total_revenue ?? 0).toFixed(2)}`} color="#16a34a" />
      </div>

      {daily.length > 0 && (
        <div style={{ marginBottom: 24, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                <th style={{ padding: '8px 10px', color: '#6b7280', fontWeight: 500 }}>日期</th>
                <th style={{ padding: '8px 10px', color: '#6b7280', fontWeight: 500 }}>PV</th>
                <th style={{ padding: '8px 10px', color: '#6b7280', fontWeight: 500 }}>UV</th>
                <th style={{ padding: '8px 10px', color: '#6b7280', fontWeight: 500 }}>收入</th>
              </tr>
            </thead>
            <tbody>
              {daily.map((d) => (
                <tr key={d.date} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '8px 10px', color: '#374151' }}>{d.date}</td>
                  <td style={{ padding: '8px 10px', color: '#111' }}>{Number(d.pv).toLocaleString()}</td>
                  <td style={{ padding: '8px 10px', color: '#111' }}>{Number(d.uv).toLocaleString()}</td>
                  <td style={{ padding: '8px 10px', color: '#16a34a' }}>${Number(d.revenue).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {topItems.length > 0 && (
        <>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#374151' }}>Top 10 文章</h3>
          <div style={{ marginBottom: 28, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px', color: '#6b7280', fontWeight: 500 }}>标题</th>
                  <th style={{ padding: '8px 10px', color: '#6b7280', fontWeight: 500 }}>PV</th>
                  <th style={{ padding: '8px 10px', color: '#6b7280', fontWeight: 500 }}>UV</th>
                  <th style={{ padding: '8px 10px', color: '#6b7280', fontWeight: 500 }}>收入</th>
                </tr>
              </thead>
              <tbody>
                {topItems.map((a, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '8px 10px' }}>
                      {a.slug ? (
                        <a href={`/a/${a.slug}`} target="_blank" rel="noreferrer" style={{ color: '#2563eb', textDecoration: 'none' }}>
                          {a.title.length > 40 ? a.title.slice(0, 38) + '…' : a.title}
                        </a>
                      ) : (
                        <span>{a.title}</span>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px' }}>{Number(a.pv).toLocaleString()}</td>
                    <td style={{ padding: '8px 10px' }}>{Number(a.uv).toLocaleString()}</td>
                    <td style={{ padding: '8px 10px', color: '#16a34a' }}>${Number(a.revenue).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {daily.length === 0 && !loading && (
        <div style={{ padding: 24, background: '#f9fafb', borderRadius: 8, color: '#6b7280', fontSize: 13, marginBottom: 28 }}>
          暂无 Analytics 数据 · 配置 GA4_PROPERTY_ID 和 GOOGLE_APPLICATION_CREDENTIALS 后点击「拉取 GA4 数据」
        </div>
      )}

      {/* ── Weekly Report ── */}
      {showReport && report && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>周报预览</h2>
            <button style={{ ...btn, background: '#f3f4f6', color: '#111' }}
              onClick={() => { navigator.clipboard.writeText(report); }}>
              复制 Markdown
            </button>
          </div>
          <pre style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, padding: 20, fontSize: 13, lineHeight: 1.7, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#111827' }}>
            {report}
          </pre>
        </div>
      )}

      <div style={{ marginTop: 32, padding: 16, background: '#f9fafb', borderRadius: 8, fontSize: 12, color: '#6b7280' }}>
        <strong>验收要点：</strong>
        点击「批量生成推文」→ 表格出现推文文案 → 点「复制文案」可粘贴到 X/Twitter 手动发布 ·
        GA4 配置好后「拉取 GA4 数据」→ analytics_daily 有数据 → 「生成周报」显示 markdown
      </div>
    </main>
  );
}
