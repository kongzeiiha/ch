import type { FastifyInstance } from 'fastify';
import axios from 'axios';
import { query } from '@ch/db';
import { callClaude, getAllQueueStats, pingRedis, withRun } from '@ch/agents';

interface Check {
  ok: boolean;
  latencyMs: number;
  detail?: string;
  error?: string;
}

async function checkPostgres(): Promise<Check> {
  const start = Date.now();
  try {
    const rows = await query<{ version: string }>('SELECT version() AS version');
    return {
      ok: true,
      latencyMs: Date.now() - start,
      detail: rows[0]?.version?.split(' ').slice(0, 2).join(' '),
    };
  } catch (e: any) {
    return { ok: false, latencyMs: Date.now() - start, error: e?.message ?? String(e) };
  }
}

async function checkRedis(): Promise<Check> {
  const r = await pingRedis();
  return { ok: r.ok, latencyMs: r.latencyMs, error: r.error, detail: r.ok ? 'PONG' : undefined };
}

async function checkMinio(): Promise<Check> {
  const start = Date.now();
  const endpoint = process.env.S3_ENDPOINT ?? 'http://localhost:9000';
  try {
    const res = await axios.get(`${endpoint}/minio/health/ready`, {
      timeout: 3_000,
      validateStatus: () => true,
    });
    return {
      ok: res.status === 200,
      latencyMs: Date.now() - start,
      detail: `HTTP ${res.status}`,
    };
  } catch (e: any) {
    return { ok: false, latencyMs: Date.now() - start, error: e?.message ?? String(e) };
  }
}

export async function registerInfra(app: FastifyInstance): Promise<void> {
  app.get('/admin/infra/health', async () => {
    const [postgres, redis, minio] = await Promise.all([
      checkPostgres(),
      checkRedis(),
      checkMinio(),
    ]);
    return {
      postgres,
      redis,
      minio,
      env: {
        hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
        models: {
          opus: process.env.ANTHROPIC_MODEL_OPUS ?? 'claude-opus-4-7',
          sonnet: process.env.ANTHROPIC_MODEL_SONNET ?? 'claude-sonnet-4-6',
          haiku: process.env.ANTHROPIC_MODEL_HAIKU ?? 'claude-haiku-4-5-20251001',
        },
        scheduler: process.env.DISABLE_SCHEDULER === '1' ? 'disabled' : 'enabled',
      },
    };
  });

  app.get('/admin/infra/queues', async () => {
    const queues = await getAllQueueStats();
    return { queues };
  });

  app.post('/admin/infra/test-llm', async () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      return { ok: false, error: 'ANTHROPIC_API_KEY 未配置 — 请在 .env 中填入后重启 api' };
    }
    try {
      const result = await withRun({ agent: 'infra:test-llm' }, async () => {
        const r = await callClaude({
          model: 'haiku',
          maxTokens: 32,
          temperature: 0,
          messages: [{ role: 'user', content: '回复两个字:pong。' }],
        });
        return {
          output: {
            ok: true,
            text: r.text,
            model: r.model,
            latencyMs: r.latencyMs,
            costUsd: r.costUsd,
            usage: r.usage,
          },
          model: r.model,
          usage: r.usage,
          cost: r.costUsd,
        };
      });
      return result;
    } catch (e: any) {
      return { ok: false, error: e?.message ?? String(e) };
    }
  });
}
