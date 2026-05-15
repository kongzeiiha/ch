'use client';

import { useEffect, useState, useCallback } from 'react';
import { AdminNav } from '../../../components/AdminNav';
import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL ?? '/api';

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

interface DailyRow { date: string; pv: number; uv: number; revenue: number; }
interface TopItem { title: string; slug: string | null; pv: number; uv: number; revenue: number; }

const card: React.CSSProperties = { background: '#1e293b', border: '1px solid #3e4144', borderRadius: 8, padding: 16 };
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600, color: '#71767b', borderBottom: '1px solid #3e4144', background: '#0f172a', textTransform: 'uppercase', letterSpacing: 0.4 };
const td: React.CSSProperties = { padding: '10px 12px', fontSize: 13, borderBottom: '1px solid #3e4144', verticalAlign: 'top', color: '#e7e9ea' };
const btn: React.CSSProperties = { padding: '6px 12px', fontSize: 12, border: '1px solid #3e4144', borderRadius: 6, background: 'transparent', color: '#71767b', cursor: 'pointer' };
const btnPrimary: React.CSSProperties = { ...btn, background: '#6366f1', color: '#fff', borderColor: '#6366f1', fontWeight: 600 };
const btnGreen:   React.CSSProperties = { ...btn, background: '#16a34a', color: '#fff', borderColor: '#16a34a', fontWeight: 600 };
const btnViolet:  React.CSSProperties = { ...btn, background: '#7c3aed', color: '#fff', borderColor: '#7c3aed', fontWeight: 600 };

function Tile({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div style={card}>
      <div style={{ fontSize: 10, color: '#71767b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: accent ?? '#e7e9ea' }}>{value}</div>
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
      style={{ padding: '4px 10px', fontSize: 12, borderRadius: 4, border: '1px solid #3e4144', background: copied ? '#14532d' : 'transparent', cursor: 'pointer', color: copied ? '#86efac' : '#71767b', whiteSpace: 'nowrap' }}>
      {copied ? '已复制' : '复制文案'}
    </button>
  );
}

export default function Day6Page() {
  const [distStats, setDistStats] = useState<DistStats | null>(null);
  const [tasks, setTasks] = useState<DistTask[]>([]);
  const [analyticsSum, setAnalyticsSum] = useState<AnalyticsSummary | null>(null);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [topItems, setTopItems] = useState<TopItem[]>([]);
  const [report, setReport] = useState<string>('');
  const [showReport, setShowReport] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, tasksRes, analyticsRes] = await Promise.all([
        fetch(`${API}/admin/distribution/distribution-stats`).then((r) => r.json()),
        fetch(`${API}/admin/distribution/distribution?limit=50`).then((r) => r.json()),
        fetch(`${API}/admin/distribution/analytics`).then((r) => r.json()),
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

  const loadReport = async () => {
    setBusy(true);
    setMsg('生成周报...');
    try {
      const r = await fetch(`${API}/admin/distribution/report`).then((r) => r.json());
      setReport(r.markdown ?? '');
      setShowReport(true);
      setMsg('');
    } catch (e) {
      setMsg(`周报生成失败: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  const s = distStats ?? { byStatus: {}, byChannel: {}, pendingDistribution: 0 };
  const totalDist = Object.values(s.byStatus).reduce((a, b) => a + b, 0);
  const sectionTitle: React.CSSProperties = { fontSize: 12, color: '#71767b', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 };

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e7e9ea', fontFamily: 'system-ui, -apple-system, PingFang SC, sans-serif' }}>
      <header style={{ background: '#020617', borderBottom: '1px solid #1e293b', padding: '0 24px', height: 52, display: 'flex', alignItems: 'center', gap: 16, position: 'sticky', top: 0, zIndex: 100 }}>
        <span style={{ color: '#e7e9ea', fontSize: 16, fontWeight: 800 }}>内容中台</span>
        <span style={{ color: '#3e4144' }}>/</span>
        <span style={{ fontSize: 13, color: '#71767b' }}>分发 & Analytics</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href="/workbench" style={{ ...btn, textDecoration: 'none', color: '#e7e9ea', display: 'inline-flex', alignItems: 'center' }}>← 工作台</Link><button style={btn} onClick={load}>↻ 刷新</button>
          <button style={btnViolet} disabled={busy} onClick={loadReport}>{busy ? '处理中…' : '生成周报'}</button>
          <button style={btnGreen} disabled={busy} onClick={() => action(`${API}/admin/distribution/analytics-pull`, 'GA4 拉取')}>{busy ? '处理中…' : '拉取 GA4 数据'}</button>
          <button style={btnPrimary} disabled={busy} onClick={() => action(`${API}/admin/distribution/distribute-all`, '批量分发')}>{busy ? '处理中…' : '批量生成推文'}</button>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 20px 60px' }}>
        <AdminNav current="distribution" />

        {msg && (
          <div style={{ marginBottom: 16, padding: '10px 14px', background: '#052e16', border: '1px solid #16a34a', borderRadius: 6, fontSize: 13, color: '#86efac' }}>
            {msg}
          </div>
        )}

        <h3 style={sectionTitle}>Agent 8 · Distribution</h3>
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
          <Tile label="已生成推文" value={loading ? '…' : totalDist} />
          <Tile label="待分发文章" value={loading ? '…' : s.pendingDistribution} accent="#fbbf24" />
          <Tile label="Twitter" value={loading ? '…' : (s.byChannel['twitter'] ?? 0)} accent="#0ea5e9" />
        </section>

        {!loading && tasks.length === 0 ? (
          <div style={{ ...card, color: '#71767b', textAlign: 'center', fontSize: 14, marginBottom: 32 }}>
            暂无分发记录 · 点击「批量生成推文」为已发布文章生成 Twitter 文案
          </div>
        ) : (
          <section style={{ ...card, padding: 0, overflow: 'hidden', marginBottom: 32 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>文章</th>
                  <th style={th}>渠道</th>
                  <th style={{ ...th, width: '40%' }}>推文文案</th>
                  <th style={th}>状态</th>
                  <th style={th}>操作</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td style={{ ...td, maxWidth: 220 }}>
                      {t.slug ? (
                        <a href={`/a/${t.slug}`} target="_blank" rel="noreferrer"
                          style={{ color: '#60a5fa', textDecoration: 'none', fontWeight: 500, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {t.title}
                        </a>
                      ) : (
                        <span>{t.title}</span>
                      )}
                    </td>
                    <td style={{ ...td, color: '#7dd3fc', fontWeight: 500 }}>
                      {t.channel === 'twitter' ? 'X / Twitter' : t.channel}
                    </td>
                    <td style={{ ...td, color: '#e7e9ea', lineHeight: 1.5, fontSize: 12 }}>
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', wordBreak: 'break-word' }}>{t.copy}</pre>
                    </td>
                    <td style={td}>
                      <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                        background: t.status === 'done' ? '#14532d' : '#78350f',
                        color: t.status === 'done' ? '#86efac' : '#fbbf24' }}>
                        {t.status}
                      </span>
                    </td>
                    <td style={td}>
                      <CopyButton text={t.copy} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <h3 style={sectionTitle}>Agent 9 · Analytics(近 7 天)</h3>
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
          <Tile label="总 PV" value={loading ? '…' : (analyticsSum?.total_pv ?? 0).toLocaleString()} accent="#0ea5e9" />
          <Tile label="总 UV" value={loading ? '…' : (analyticsSum?.total_uv ?? 0).toLocaleString()} accent="#a78bfa" />
          <Tile label="广告收入" value={loading ? '…' : `$${Number(analyticsSum?.total_revenue ?? 0).toFixed(2)}`} accent="#22c55e" />
        </section>

        {daily.length > 0 && (
          <section style={{ ...card, padding: 0, overflow: 'hidden', marginBottom: 24 }}>
            <h4 style={{ margin: 0, padding: 14, fontSize: 13, color: '#e7e9ea', fontWeight: 600, borderBottom: '1px solid #3e4144' }}>每日趋势</h4>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>日期</th>
                  <th style={th}>PV</th>
                  <th style={th}>UV</th>
                  <th style={th}>收入</th>
                </tr>
              </thead>
              <tbody>
                {daily.map((d) => (
                  <tr key={d.date}>
                    <td style={{ ...td, color: '#71767b' }}>{d.date}</td>
                    <td style={td}>{Number(d.pv).toLocaleString()}</td>
                    <td style={td}>{Number(d.uv).toLocaleString()}</td>
                    <td style={{ ...td, color: '#22c55e' }}>${Number(d.revenue).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {topItems.length > 0 && (
          <section style={{ ...card, padding: 0, overflow: 'hidden', marginBottom: 28 }}>
            <h4 style={{ margin: 0, padding: 14, fontSize: 13, color: '#e7e9ea', fontWeight: 600, borderBottom: '1px solid #3e4144' }}>Top 10 文章</h4>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>标题</th>
                  <th style={th}>PV</th>
                  <th style={th}>UV</th>
                  <th style={th}>收入</th>
                </tr>
              </thead>
              <tbody>
                {topItems.map((a, i) => (
                  <tr key={i}>
                    <td style={td}>
                      {a.slug ? (
                        <a href={`/a/${a.slug}`} target="_blank" rel="noreferrer" style={{ color: '#60a5fa', textDecoration: 'none' }}>
                          {a.title.length > 40 ? a.title.slice(0, 38) + '…' : a.title}
                        </a>
                      ) : (
                        <span>{a.title}</span>
                      )}
                    </td>
                    <td style={td}>{Number(a.pv).toLocaleString()}</td>
                    <td style={td}>{Number(a.uv).toLocaleString()}</td>
                    <td style={{ ...td, color: '#22c55e' }}>${Number(a.revenue).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {daily.length === 0 && !loading && (
          <div style={{ ...card, color: '#71767b', fontSize: 13, marginBottom: 28 }}>
            暂无 Analytics 数据 · 配置 GA4_PROPERTY_ID 和 GOOGLE_APPLICATION_CREDENTIALS 后点击「拉取 GA4 数据」
          </div>
        )}

        {showReport && report && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <h3 style={{ ...sectionTitle, margin: 0 }}>周报预览</h3>
              <button style={btn} onClick={() => { navigator.clipboard.writeText(report); }}>
                复制 Markdown
              </button>
            </div>
            <pre style={{ background: '#0f172a', border: '1px solid #3e4144', borderRadius: 8, padding: 20, fontSize: 13, lineHeight: 1.7, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#e7e9ea' }}>
              {report}
            </pre>
          </div>
        )}

        <div style={{ marginTop: 24, padding: 14, background: '#1e293b', border: '1px solid #3e4144', borderRadius: 8, fontSize: 12, color: '#71767b', lineHeight: 1.7 }}>
          <strong style={{ color: '#e7e9ea' }}>验收要点:</strong>
          点击「批量生成推文」→ 表格出现推文文案 → 点「复制文案」可粘贴到 X/Twitter 手动发布 ·
          GA4 配置好后「拉取 GA4 数据」→ analytics_daily 有数据 → 「生成周报」显示 markdown
        </div>
      </div>
    </div>
  );
}
