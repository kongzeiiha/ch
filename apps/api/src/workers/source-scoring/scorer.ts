import { query, tx, ITEM_STATUS as IS } from '@ch/db';

/**
 * Pure SQL scorer. No LLM, no external calls. Reads item-flow signals we
 * already collect, aggregates per source, writes back score/risk/stability/status.
 *
 * Formula intentionally simple — real weights come from Analytics (Day 7).
 */
export async function scoreAllSources(): Promise<{
  updated: number;
  samples: Array<{ id: string; name: string; before: number; after: number; status: string }>;
}> {
  return tx(async (q) => {
    const rows = await q(`
      WITH agg AS (
        SELECT
          s.id,
          s.name,
          s.score AS before_score,
          s.status AS before_status,
          s.last_fetch_at,
          COALESCE(c.total, 0)                AS total_items,
          COALESCE(c.published, 0)            AS published,
          COALESCE(c.compliance_fail, 0)      AS comp_fail,
          COALESCE(c.compliance_review, 0)    AS comp_review,
          COALESCE(c.recent_ingested, 0)      AS recent_ingested,
          COALESCE(a.week_pv, 0)              AS week_pv,
          COALESCE(a.week_revenue, 0)         AS week_revenue
        FROM sources s
        LEFT JOIN (
          SELECT
            source_id,
            CAST(COUNT(*) AS SIGNED) AS total,
            CAST(SUM(CASE WHEN status = '${IS.PUBLISHED}' THEN 1 ELSE 0 END) AS SIGNED)         AS published,
            CAST(SUM(CASE WHEN status = '${IS.COMPLIANCE_FAIL}' THEN 1 ELSE 0 END) AS SIGNED)   AS compliance_fail,
            CAST(SUM(CASE WHEN status = '${IS.COMPLIANCE_REVIEW}' THEN 1 ELSE 0 END) AS SIGNED) AS compliance_review,
            CAST(SUM(CASE WHEN created_at > NOW() - INTERVAL 7 DAY THEN 1 ELSE 0 END) AS SIGNED) AS recent_ingested
          FROM items
          GROUP BY source_id
        ) c ON c.source_id = s.id
        LEFT JOIN (
          SELECT i.source_id,
                 CAST(SUM(ad.pv) AS SIGNED)        AS week_pv,
                 CAST(SUM(ad.revenue) AS DOUBLE)   AS week_revenue
          FROM analytics_daily ad
          JOIN items i ON i.id = ad.item_id
          WHERE ad.date >= CURRENT_DATE - INTERVAL 7 DAY
          GROUP BY i.source_id
        ) a ON a.source_id = s.id
      )
      SELECT * FROM agg
    `);

    const results: Array<{ id: string; name: string; before: number; after: number; status: string }> = [];

    for (const r of rows) {
      const quality = Number(r.published) * 2;
      const freshness =
        r.last_fetch_at && new Date(r.last_fetch_at).getTime() > Date.now() - 2 * 86400_000
          ? 10
          : r.last_fetch_at && new Date(r.last_fetch_at).getTime() > Date.now() - 7 * 86400_000
          ? 0
          : -10;
      const activity = Math.min(15, Number(r.recent_ingested));
      const riskPenalty = Number(r.comp_fail) * 5 + Number(r.comp_review) * 2;
      // Analytics signals: PV tier bonus (0/3/6/10), revenue bonus (0/3/5)
      const weekPv = Number(r.week_pv ?? 0);
      const pvBonus = weekPv >= 10000 ? 10 : weekPv >= 1000 ? 6 : weekPv >= 100 ? 3 : 0;
      const revenueBonus = Number(r.week_revenue ?? 0) >= 10 ? 5 : Number(r.week_revenue ?? 0) >= 1 ? 3 : 0;

      const raw = 50 + quality + freshness + activity - riskPenalty + pvBonus + revenueBonus;
      const score = Math.max(0, Math.min(100, Math.round(raw)));

      let risk_level: 'low' | 'medium' | 'high' = 'low';
      if (r.comp_fail >= 5) risk_level = 'high';
      else if (r.comp_fail >= 2 || r.comp_review >= 5) risk_level = 'medium';

      const stability = Math.max(
        0,
        Math.min(100, Math.round(50 + activity * 2 + (freshness === 10 ? 10 : freshness * 2))),
      );

      let status: 'active' | 'paused' | 'blacklist' = 'active';
      if (r.comp_fail >= 20) status = 'blacklist';
      else if (score < 20) status = 'paused';

      await q(
        `UPDATE sources
           SET score = $2,
               risk_level = $3,
               stability = $4,
               status = CASE WHEN status = 'inactive' THEN status ELSE $5 END
         WHERE id = $1`,
        [r.id, score, risk_level, stability, status],
      );

      results.push({
        id: r.id,
        name: r.name,
        before: r.before_score,
        after: score,
        status: r.before_status === 'inactive' ? 'inactive' : status,
      });
    }

    return { updated: results.length, samples: results };
  });
}
