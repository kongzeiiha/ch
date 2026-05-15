'use client';

import { useEffect, useState } from 'react';
import { API } from './constants';

interface TopRow {
  slug: string;
  title: string;
  category: string | null;
  pv: number;
  uv: number;
  revenue: number;
}

interface DailyRow {
  date: string;
  pv: number;
  uv: number;
  revenue: number;
}

interface Ga4Status {
  propertyId: boolean;
  credentials: boolean;
  configured: boolean;
}

interface ReportPayload {
  report: string | null;
  generatedAt: string | null;
  runId: string | null;
}

const TEAL = '#14b8a6';

export function AnalyticsPanel() {
  const [top, setTop] = useState<TopRow[]>([]);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [report, setReport] = useState<ReportPayload>({ report: null, generatedAt: null, runId: null });
  const [ga4, setGa4] = useState<Ga4Status | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportFlash, setReportFlash] = useState<string | null>(null);

  const fetchReport = async (): Promise<void> => {
    const r = await fetch(`${API}/admin/analytics/latest-report`, { cache: 'no-store' }).then(x => x.json());
    setReport(r);
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [t, d, r, g] = await Promise.allSettled([
        fetch(`${API}/admin/analytics/top?limit=5&days=7`, { cache: 'no-store' }).then(x => x.json()),
        fetch(`${API}/admin/analytics/daily?days=7`, { cache: 'no-store' }).then(x => x.json()),
        fetch(`${API}/admin/analytics/latest-report`, { cache: 'no-store' }).then(x => x.json()),
        fetch(`${API}/admin/analytics/ga4-status`, { cache: 'no-store' }).then(x => x.json()),
      ]);
      if (cancelled) return;
      if (t.status === 'fulfilled') setTop(t.value.items ?? []);
      if (d.status === 'fulfilled') setDaily(d.value.daily ?? []);
      if (r.status === 'fulfilled') setReport(r.value);
      if (g.status === 'fulfilled') setGa4(g.value);
    };
    load();
    // Daily-resolution data — 60s poll is plenty.
    const t = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const generateReport = async () => {
    if (reportBusy) return;
    setReportBusy(true);
    setReportFlash('已入队，约 10 秒…');
    setReportOpen(true);
    try {
      const res = await fetch(`${API}/admin/analytics/run-report`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Worker is single-concurrency + queries are fast; 8s is comfortable.
      // Poll once to pick up the new report.
      await new Promise(r => setTimeout(r, 8_000));
      await fetchReport();
      setReportFlash('已生成 ✓');
      setTimeout(() => setReportFlash(null), 2_500);
    } catch (e: any) {
      setReportFlash(`生成失败：${e?.message ?? e}`);
      setTimeout(() => setReportFlash(null), 4_000);
    } finally {
      setReportBusy(false);
    }
  };

  const totalPv = daily.reduce((s, d) => s + d.pv, 0);
  const totalUv = daily.reduce((s, d) => s + d.uv, 0);
  const totalRev = daily.reduce((s, d) => s + Number(d.revenue ?? 0), 0);

  return (
    <div>
      {ga4 && !ga4.configured && (
        <div style={{
          background: '#451a03', border: '1px solid #78350f', color: '#fb923c',
          fontSize: 11, padding: '6px 10px', borderRadius: 6, marginBottom: 10,
        }}>
          ⚠ GA4 未配置（缺{!ga4.propertyId && ' GA4_PROPERTY_ID'}{!ga4.propertyId && !ga4.credentials && ' /'}{!ga4.credentials && ' GOOGLE_APPLICATION_CREDENTIALS'}）— pull 任务会无操作返回。
        </div>
      )}

      {/* Trend + totals */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 10, marginBottom: 12 }}>
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 10 }}>
          <div style={{ fontSize: 11, color: '#71767b', fontWeight: 600, marginBottom: 6 }}>近 7 天 PV 趋势</div>
          {daily.length === 0 ? (
            <div style={{ fontSize: 11, color: '#3e4144', padding: '14px 0' }}>暂无数据</div>
          ) : (
            <>
              <Sparkline data={daily.map(d => d.pv)} height={48} stroke={TEAL} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#475569', marginTop: 4 }}>
                <span>{daily[0]?.date}</span>
                <span>{daily[daily.length - 1]?.date}</span>
              </div>
            </>
          )}
        </div>

        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 10 }}>
          <div style={{ fontSize: 11, color: '#71767b', fontWeight: 600, marginBottom: 6 }}>近 7 天合计</div>
          <div style={{ display: 'flex', gap: 14 }}>
            <Stat label="PV"  value={totalPv.toLocaleString()}            color={TEAL} />
            <Stat label="UV"  value={totalUv.toLocaleString()}            color="#60a5fa" />
            <Stat label="收入" value={`$${totalRev.toFixed(2)}`}           color="#a78bfa" />
          </div>
        </div>
      </div>

      {/* Top 5 articles */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: '#71767b', fontWeight: 600, marginBottom: 6 }}>📈 Top 5 文章 · 近 7 天</div>
        {top.length === 0 ? (
          <div style={{ fontSize: 11, color: '#3e4144', padding: '8px 0' }}>暂无文章流量数据 · 等 GA4 拉取后会出现</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {top.map((r, i) => (
              <a key={r.slug} href={`/a/${r.slug}`} target="_blank" rel="noreferrer" style={{
                background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6,
                padding: '7px 10px', display: 'flex', gap: 10, alignItems: 'center',
                textDecoration: 'none', color: '#e7e9ea',
              }}>
                <span style={{ fontSize: 11, color: '#475569', fontWeight: 700, width: 22 }}>#{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                  <div style={{ fontSize: 10, color: '#475569' }}>{r.category ?? '—'}</div>
                </div>
                <div style={{ fontSize: 11, color: TEAL, fontWeight: 700, fontVariantNumeric: 'tabular-nums', minWidth: 70, textAlign: 'right' }}>{r.pv.toLocaleString()} PV</div>
                <div style={{ fontSize: 11, color: '#60a5fa', fontVariantNumeric: 'tabular-nums', minWidth: 60, textAlign: 'right' }}>{r.uv.toLocaleString()} UV</div>
                {r.revenue > 0 && (
                  <div style={{ fontSize: 11, color: '#a78bfa', fontVariantNumeric: 'tabular-nums', minWidth: 60, textAlign: 'right' }}>${Number(r.revenue).toFixed(2)}</div>
                )}
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Latest weekly report — collapsed by default */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            onClick={() => setReportOpen(o => !o)}
            style={{ cursor: 'pointer', fontSize: 11, color: '#71767b', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none', flex: 1 }}
          >
            <span style={{ width: 10, display: 'inline-block' }}>{reportOpen ? '▼' : '▶'}</span>
            <span>📄 最近周报</span>
            {report.generatedAt
              ? <span style={{ color: '#475569', fontWeight: 400 }}>· {new Date(report.generatedAt).toLocaleString()}</span>
              : <span style={{ color: '#475569', fontWeight: 400 }}>· 尚未生成</span>}
            {reportFlash && (
              <span style={{ color: TEAL, fontWeight: 400, marginLeft: 'auto' }}>{reportFlash}</span>
            )}
          </div>
          <button
            onClick={generateReport}
            disabled={reportBusy}
            style={{
              padding: '4px 10px', borderRadius: 5,
              border: `1px solid ${reportBusy ? '#1e293b' : '#115e59'}`,
              background: reportBusy ? 'transparent' : '#042f2e',
              color: reportBusy ? '#475569' : TEAL,
              fontSize: 11, fontWeight: 600,
              cursor: reportBusy ? 'wait' : 'pointer',
              flexShrink: 0,
            }}
          >
            {reportBusy ? '生成中…' : '▶ 生成周报'}
          </button>
        </div>
        {reportOpen && report.report && (
          <pre style={{
            marginTop: 6, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6,
            padding: 10, fontSize: 11, color: '#e7e9ea', maxHeight: 320, overflow: 'auto',
            whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          }}>{report.report}</pre>
        )}
        {reportOpen && !report.report && !reportBusy && (
          <div style={{ marginTop: 6, fontSize: 11, color: '#3e4144' }}>
            还没生成过周报。点右侧「▶ 生成周报」即可。
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#475569' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color, lineHeight: 1.2, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function Sparkline({ data, height, stroke }: { data: number[]; height: number; stroke: string }) {
  if (data.length === 0) return null;
  const width = 280;
  const max = Math.max(1, ...data);
  const stepX = data.length > 1 ? width / (data.length - 1) : width;
  const points = data.map((v, i) => `${i * stepX},${height - (v / max) * (height - 4) - 2}`).join(' ');
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {data.map((v, i) => (
        <circle key={i} cx={i * stepX} cy={height - (v / max) * (height - 4) - 2} r={2.5} fill={stroke} />
      ))}
    </svg>
  );
}
