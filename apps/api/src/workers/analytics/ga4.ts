import { query } from '@ch/db';

/**
 * GA4 Data API integration (T+1 pull).
 * Requires env: GA4_PROPERTY_ID, GOOGLE_APPLICATION_CREDENTIALS (path to service account JSON).
 * Falls back to a no-op if credentials are absent — the rest of the pipeline still runs.
 */

interface GA4Row {
  slug: string;
  pv: number;
  uv: number;
  avg_duration: number;
}

async function fetchGA4Yesterday(): Promise<GA4Row[]> {
  const propertyId = process.env.GA4_PROPERTY_ID;
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!propertyId || !credPath) {
    console.warn('[analytics] GA4_PROPERTY_ID or GOOGLE_APPLICATION_CREDENTIALS not set — skipping GA4 pull');
    return [];
  }

  // Dynamic import so the package is optional at build time
  let BetaAnalyticsDataClient: any;
  try {
    const mod = await import('@google-analytics/data');
    BetaAnalyticsDataClient = mod.BetaAnalyticsDataClient;
  } catch {
    console.warn('[analytics] @google-analytics/data not installed — skipping GA4 pull');
    return [];
  }

  const analyticsClient = new BetaAnalyticsDataClient({ keyFilename: credPath });

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().slice(0, 10).replace(/-/g, '');

  const [response] = await analyticsClient.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate: 'yesterday', endDate: 'yesterday' }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [
      { name: 'screenPageViews' },
      { name: 'totalUsers' },
      { name: 'averageSessionDuration' },
    ],
    dimensionFilter: {
      filter: {
        fieldName: 'pagePath',
        stringFilter: { matchType: 'BEGINS_WITH', value: '/a/' },
      },
    },
    limit: 10000,
  });

  const rows: GA4Row[] = [];
  for (const row of response.rows ?? []) {
    const path: string = row.dimensionValues?.[0]?.value ?? '';
    const slug = path.replace(/^\/a\//, '').replace(/\/$/, '');
    if (!slug) continue;
    rows.push({
      slug,
      pv: parseInt(row.metricValues?.[0]?.value ?? '0', 10),
      uv: parseInt(row.metricValues?.[1]?.value ?? '0', 10),
      avg_duration: Math.round(parseFloat(row.metricValues?.[2]?.value ?? '0')),
    });
  }

  void dateStr; // reserved for logging
  return rows;
}

export interface AnalyticsPullResult {
  date: string;
  upserted: number;
  skipped: number;
}

export async function pullAnalyticsYesterday(): Promise<AnalyticsPullResult> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const date = yesterday.toISOString().slice(0, 10);

  const ga4Rows = await fetchGA4Yesterday();

  if (ga4Rows.length === 0) {
    return { date, upserted: 0, skipped: 0 };
  }

  // Resolve slug → item_id
  const slugs = ga4Rows.map((r) => r.slug);
  const itemRows = await query<{ id: string; slug: string }>(
    `SELECT id, slug FROM items WHERE slug = ANY($1) AND status IN ('PUBLISHED', 'DISTRIBUTED')`,
    [slugs],
  );
  const slugToId = new Map(itemRows.map((r) => [r.slug, r.id]));

  let upserted = 0;
  let skipped = 0;

  for (const row of ga4Rows) {
    const itemId = slugToId.get(row.slug);
    if (!itemId) { skipped++; continue; }

    await query(
      `INSERT INTO analytics_daily (item_id, date, channel, pv, uv, avg_duration, raw)
       VALUES ($1, $2, 'site', $3, $4, $5, $6)
       ON CONFLICT (item_id, date, channel) DO UPDATE
         SET pv = EXCLUDED.pv,
             uv = EXCLUDED.uv,
             avg_duration = EXCLUDED.avg_duration,
             raw = EXCLUDED.raw`,
      [itemId, date, row.pv, row.uv, row.avg_duration, JSON.stringify(row)],
    );
    upserted++;
  }

  return { date, upserted, skipped };
}
