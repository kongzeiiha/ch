import { query } from '@ch/db';

interface ReportRow {
  slug: string;
  title: string;
  category: string | null;
  total_pv: number;
  total_uv: number;
  total_revenue: number;
}

interface DailySummary {
  date: string;
  pv: number;
  uv: number;
  revenue: number;
}

export async function generateWeeklyReport(): Promise<string> {
  const [topItems, dailySummary, totals] = await Promise.all([
    query<ReportRow>(`
      SELECT i.slug, i.title, i.category,
             CAST(SUM(a.pv) AS SIGNED)      AS total_pv,
             CAST(SUM(a.uv) AS SIGNED)      AS total_uv,
             CAST(SUM(a.revenue) AS DOUBLE) AS total_revenue
      FROM analytics_daily a
      JOIN items i ON i.id = a.item_id
      WHERE a.date >= CURRENT_DATE - INTERVAL 6 DAY
        AND a.channel = 'site'
      GROUP BY i.id, i.slug, i.title, i.category
      ORDER BY total_pv DESC
      LIMIT 10
    `),
    query<DailySummary>(`
      SELECT date,
             CAST(SUM(pv) AS SIGNED)        AS pv,
             CAST(SUM(uv) AS SIGNED)        AS uv,
             CAST(SUM(revenue) AS DOUBLE)   AS revenue
      FROM analytics_daily
      WHERE date >= CURRENT_DATE - INTERVAL 6 DAY AND channel = 'site'
      GROUP BY date
      ORDER BY date
    `),
    query<{ total_pv: number; total_uv: number; total_revenue: number }>(`
      SELECT CAST(SUM(pv) AS SIGNED)        AS total_pv,
             CAST(SUM(uv) AS SIGNED)        AS total_uv,
             CAST(SUM(revenue) AS DOUBLE)   AS total_revenue
      FROM analytics_daily
      WHERE date >= CURRENT_DATE - INTERVAL 6 DAY AND channel = 'site'
    `),
  ]);

  // SUM() over an empty result set returns null, not 0 — coerce to 0 here.
  const raw = totals[0];
  const t = {
    total_pv: Number(raw?.total_pv ?? 0),
    total_uv: Number(raw?.total_uv ?? 0),
    total_revenue: Number(raw?.total_revenue ?? 0),
  };
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 6);
  const weekEnd = new Date();

  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  let md = `# 周报 ${fmt(weekStart)} ~ ${fmt(weekEnd)}\n\n`;

  md += `## 汇总\n\n`;
  md += `| 指标 | 本周 |\n|---|---|\n`;
  md += `| 总 PV | ${t.total_pv.toLocaleString()} |\n`;
  md += `| 总 UV | ${t.total_uv.toLocaleString()} |\n`;
  md += `| 广告收入 | $${t.total_revenue.toFixed(2)} |\n\n`;

  md += `## 每日趋势\n\n`;
  md += `| 日期 | PV | UV | 收入 |\n|---|---|---|---|\n`;
  for (const d of dailySummary) {
    md += `| ${d.date} | ${d.pv} | ${d.uv} | $${Number(d.revenue).toFixed(2)} |\n`;
  }
  md += '\n';

  md += `## Top 10 文章\n\n`;
  md += `| 标题 | 分类 | PV | UV | 收入 |\n|---|---|---|---|---|\n`;
  for (const item of topItems) {
    const title = item.title.length > 30 ? item.title.slice(0, 28) + '…' : item.title;
    md += `| ${title} | ${item.category ?? '—'} | ${item.total_pv} | ${item.total_uv} | $${Number(item.total_revenue).toFixed(2)} |\n`;
  }

  if (topItems.length === 0) {
    md += `_（本周暂无数据，待 GA4 接入后自动填充）_\n`;
  }

  md += `\n---\n_生成时间: ${new Date().toISOString()}_\n`;
  return md;
}
