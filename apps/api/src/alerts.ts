import { getAllQueueStats, QUEUE_NAMES } from '@ch/agents';
import { query } from '@ch/db';
import { captureException } from './sentry.js';

const QUEUE_BACKLOG_THRESHOLD = Number(process.env.ALERT_QUEUE_THRESHOLD ?? 100);
const LLM_FAIL_RATE_THRESHOLD = Number(process.env.ALERT_LLM_FAIL_RATE ?? 0.15);
const LLM_FAIL_WINDOW_MINUTES = 60;

export interface AlertResult {
  level: 'ok' | 'warn' | 'critical';
  message: string;
  value: number;
  threshold: number;
}

export interface AlertsReport {
  checkedAt: string;
  alerts: AlertResult[];
  healthy: boolean;
}

async function checkQueueBacklog(): Promise<AlertResult[]> {
  const stats = await getAllQueueStats();
  const results: AlertResult[] = [];
  for (const s of stats) {
    const waiting = s.counts.waiting + s.counts.delayed;
    if (waiting >= QUEUE_BACKLOG_THRESHOLD) {
      const level = waiting >= QUEUE_BACKLOG_THRESHOLD * 3 ? 'critical' : 'warn';
      const msg = `[alert] queue=${s.name} backlog=${waiting} (threshold=${QUEUE_BACKLOG_THRESHOLD})`;
      console.warn(msg);
      captureException(new Error(msg), { queue: s.name, waiting });
      results.push({ level, message: `队列 ${s.name} 积压 ${waiting} 条`, value: waiting, threshold: QUEUE_BACKLOG_THRESHOLD });
    } else {
      results.push({ level: 'ok', message: `队列 ${s.name} 正常 (${waiting})`, value: waiting, threshold: QUEUE_BACKLOG_THRESHOLD });
    }
  }
  return results;
}

async function checkLlmFailRate(): Promise<AlertResult[]> {
  const rows = await query<{ total: number; failed: number }>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
     FROM agent_runs
     WHERE started_at >= NOW() - INTERVAL '${LLM_FAIL_WINDOW_MINUTES} minutes'
       AND agent NOT IN ('ingestion:fanout', 'source-scoring')`,
  );
  const { total, failed } = rows[0] ?? { total: 0, failed: 0 };
  if (total === 0) {
    return [{ level: 'ok', message: `近 ${LLM_FAIL_WINDOW_MINUTES}min 无 LLM 调用`, value: 0, threshold: LLM_FAIL_RATE_THRESHOLD }];
  }
  const rate = failed / total;
  if (rate >= LLM_FAIL_RATE_THRESHOLD) {
    const level = rate >= LLM_FAIL_RATE_THRESHOLD * 2 ? 'critical' : 'warn';
    const msg = `[alert] LLM 失败率 ${(rate * 100).toFixed(1)}% (${failed}/${total})`;
    console.warn(msg);
    captureException(new Error(msg), { rate, failed, total });
    return [{ level, message: `LLM 失败率 ${(rate * 100).toFixed(1)}% (${failed}/${total})`, value: rate, threshold: LLM_FAIL_RATE_THRESHOLD }];
  }
  return [{ level: 'ok', message: `LLM 失败率 ${(rate * 100).toFixed(1)}% 正常`, value: rate, threshold: LLM_FAIL_RATE_THRESHOLD }];
}

export async function runAlertChecks(): Promise<AlertsReport> {
  const [queueAlerts, llmAlerts] = await Promise.all([
    checkQueueBacklog(),
    checkLlmFailRate(),
  ]);
  const alerts = [...queueAlerts, ...llmAlerts];
  const healthy = alerts.every((a) => a.level === 'ok');
  return { checkedAt: new Date().toISOString(), alerts, healthy };
}

// Per-agent cost/latency summary for the last 24h
export async function agentRunsSummary() {
  return query<{
    agent: string;
    total: number;
    success: number;
    failed: number;
    avg_latency_ms: number;
    total_cost_usd: number;
  }>(
    `SELECT agent,
            COUNT(*)::int                                     AS total,
            COUNT(*) FILTER (WHERE status='success')::int     AS success,
            COUNT(*) FILTER (WHERE status='failed')::int      AS failed,
            ROUND(AVG(latency_ms))::int                       AS avg_latency_ms,
            ROUND(SUM(cost_usd)::numeric, 4)                  AS total_cost_usd
     FROM agent_runs
     WHERE started_at >= NOW() - INTERVAL '24 hours'
     GROUP BY agent
     ORDER BY total DESC`,
  );
}

// Start periodic alert polling (every ALERT_INTERVAL_MINUTES)
export function startAlertPoller(): NodeJS.Timeout {
  const intervalMs = Number(process.env.ALERT_INTERVAL_MINUTES ?? 5) * 60_000;
  return setInterval(async () => {
    try {
      await runAlertChecks();
    } catch (e) {
      captureException(e, { context: 'alert-poller' });
    }
  }, intervalMs);
}
