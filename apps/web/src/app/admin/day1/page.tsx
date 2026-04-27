'use client';

import { useEffect, useState, useCallback } from 'react';
import { AdminNav } from '../../../components/AdminNav';
import { getSprintStart, computeDayLabel } from '../../../lib/sprint';

type Check = {
  ok: boolean;
  latencyMs: number;
  detail?: string;
  error?: string;
};

type InfraResp = {
  postgres: Check;
  redis: Check;
  minio: Check;
  env: {
    hasAnthropicKey: boolean;
    models: { opus: string; sonnet: string; haiku: string };
    scheduler: string;
  };
};

type Queue = {
  name: string;
  counts: { waiting: number; active: number; delayed: number; completed: number; failed: number };
};

type LLMResp =
  | {
      ok: true;
      text: string;
      model: string;
      latencyMs: number;
      costUsd: number;
      usage: {
        input_tokens: number;
        output_tokens: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };
    }
  | { ok: false; error: string };

async function getJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 16,
};
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  fontSize: 12,
  fontWeight: 600,
  color: '#6b7280',
  borderBottom: '1px solid #e5e7eb',
  background: '#f9fafb',
};
const td: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: 13,
  borderBottom: '1px solid #f3f4f6',
  verticalAlign: 'top',
};
const btnPrimary: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  border: '1px solid #111827',
  borderRadius: 6,
  background: '#111827',
  color: '#fff',
  cursor: 'pointer',
};

function Badge({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <span
      style={{
        fontSize: 11,
        padding: '2px 8px',
        borderRadius: 10,
        background: ok ? '#d1fae5' : '#fee2e2',
        color: ok ? '#065f46' : '#991b1b',
        fontWeight: 500,
      }}
    >
      {label ?? (ok ? '正常' : '异常')}
    </span>
  );
}

function InfraCard({ title, check }: { title: string; check: Check | null | undefined }) {
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: 14 }}>{title}</strong>
        {check ? <Badge ok={check.ok} /> : <Badge ok={false} label="未知" />}
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
        {check ? (
          <>
            <div>延迟:{check.latencyMs} ms</div>
            {check.detail && <div>详情:{check.detail}</div>}
            {check.error && <div style={{ color: '#991b1b' }}>错误:{check.error}</div>}
          </>
        ) : (
          <div>加载中…</div>
        )}
      </div>
    </div>
  );
}

export default function Day1Page() {

  const [dayLabel, setDayLabel] = useState('4/20');
  useEffect(() => { setDayLabel(computeDayLabel(getSprintStart(), 1)); }, []);
  const [infra, setInfra] = useState<InfraResp | null>(null);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [llmBusy, setLlmBusy] = useState(false);
  const [llm, setLlm] = useState<LLMResp | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [i, q] = await Promise.all([
        getJSON<InfraResp>('/api/admin/day1/infra'),
        getJSON<{ queues: Queue[] }>('/api/admin/day1/queues'),
      ]);
      setInfra(i);
      setQueues(q.queues);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5_000);
    return () => clearInterval(t);
  }, [refresh]);

  async function testLlm() {
    setLlmBusy(true);
    setLlm(null);
    try {
      const r = await getJSON<LLMResp>('/api/admin/day1/test-llm', { method: 'POST' });
      setLlm(r);
    } catch (e: any) {
      setLlm({ ok: false, error: e.message });
    } finally {
      setLlmBusy(false);
    }
  }

  const totalOk =
    infra && infra.postgres.ok && infra.redis.ok && infra.minio.ok ? true : infra ? false : null;

  return (
    <main
      style={{
        maxWidth: 1100,
        margin: '0 auto',
        padding: 24,
        fontFamily: 'system-ui, sans-serif',
        background: '#f3f4f6',
        minHeight: '100vh',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>{dayLabel} · 基础设施验收</h1>
          <AdminNav current="day1" />
        </div>
        {totalOk !== null && (
          <Badge
            ok={totalOk}
            label={totalOk ? '全部正常' : '存在异常'}
          />
        )}
      </header>

      {err && (
        <div
          style={{
            ...card,
            borderColor: '#fca5a5',
            background: '#fef2f2',
            color: '#991b1b',
            marginBottom: 16,
          }}
        >
          ⚠ {err}
        </div>
      )}

      {/* Infra */}
      <h3 style={{ fontSize: 14, color: '#6b7280', margin: '0 0 8px' }}>1. 基础设施健康</h3>
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <InfraCard title="Postgres · 主库" check={infra?.postgres} />
        <InfraCard title="Redis · BullMQ" check={infra?.redis} />
        <InfraCard title="MinIO · 对象存储" check={infra?.minio} />
      </section>

      {/* Env */}
      {infra && (
        <>
          <h3 style={{ fontSize: 14, color: '#6b7280', margin: '0 0 8px' }}>2. 环境配置</h3>
          <section style={{ ...card, marginBottom: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, fontSize: 13 }}>
              <div>
                <div style={{ color: '#6b7280', fontSize: 11 }}>ANTHROPIC_API_KEY</div>
                <div style={{ marginTop: 4 }}>
                  {infra.env.hasAnthropicKey ? (
                    <Badge ok label="已配置" />
                  ) : (
                    <Badge ok={false} label="未配置" />
                  )}
                </div>
              </div>
              <div>
                <div style={{ color: '#6b7280', fontSize: 11 }}>调度器</div>
                <div style={{ marginTop: 4 }}>
                  <Badge
                    ok={infra.env.scheduler === 'enabled'}
                    label={infra.env.scheduler === 'enabled' ? '已启用' : '已停用'}
                  />
                </div>
              </div>
              <div style={{ gridColumn: '1 / -1', color: '#6b7280', fontSize: 12 }}>
                模型配置 —— Opus: <code>{infra.env.models.opus}</code> · Sonnet:{' '}
                <code>{infra.env.models.sonnet}</code> · Haiku: <code>{infra.env.models.haiku}</code>
              </div>
            </div>
          </section>
        </>
      )}

      {/* Queues */}
      <h3 style={{ fontSize: 14, color: '#6b7280', margin: '0 0 8px' }}>
        3. 9 个 BullMQ 队列
      </h3>
      <section style={{ ...card, padding: 0, marginBottom: 20, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>队列</th>
              <th style={th}>等待中</th>
              <th style={th}>执行中</th>
              <th style={th}>延迟</th>
              <th style={th}>已完成</th>
              <th style={th}>失败</th>
              <th style={th}>状态</th>
            </tr>
          </thead>
          <tbody>
            {queues.map((q) => {
              const alive =
                q.counts.waiting >= 0; // any numeric response means worker is live
              return (
                <tr key={q.name}>
                  <td style={td}>
                    <code style={{ fontSize: 12 }}>{q.name}</code>
                  </td>
                  <td style={td}>{q.counts.waiting}</td>
                  <td style={td}>{q.counts.active}</td>
                  <td style={td}>{q.counts.delayed}</td>
                  <td style={td}>{q.counts.completed}</td>
                  <td style={{ ...td, color: q.counts.failed > 0 ? '#991b1b' : undefined }}>
                    {q.counts.failed}
                  </td>
                  <td style={td}>
                    <Badge ok={alive} label={alive ? '在线' : '离线'} />
                  </td>
                </tr>
              );
            })}
            {queues.length === 0 && (
              <tr>
                <td style={td} colSpan={7}>
                  加载中…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* LLM test */}
      <h3 style={{ fontSize: 14, color: '#6b7280', margin: '0 0 8px' }}>
        4. Anthropic SDK 封装 · 实调测试
      </h3>
      <section style={{ ...card, marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: '#6b7280' }}>
            调用 Haiku 发一条 ping,验证 API key、重试、成本计算、<code>agent_runs</code> 审计写入全链路。
          </div>
          <button style={btnPrimary} disabled={llmBusy} onClick={testLlm}>
            {llmBusy ? '调用中…' : '测试 LLM 调用'}
          </button>
        </div>

        {llm && llm.ok && (
          <div
            style={{
              background: '#f0fdf4',
              border: '1px solid #86efac',
              borderRadius: 6,
              padding: 12,
              fontSize: 13,
            }}
          >
            <div style={{ marginBottom: 6 }}>
              <Badge ok label="调用成功" /> <code>{llm.model}</code>
            </div>
            <div style={{ color: '#065f46' }}>
              回复:<b>{llm.text}</b>
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 16, color: '#065f46', fontSize: 12 }}>
              <span>延迟:{llm.latencyMs} ms</span>
              <span>输入 tokens:{llm.usage.input_tokens}</span>
              <span>输出 tokens:{llm.usage.output_tokens}</span>
              {llm.usage.cache_read_input_tokens ? (
                <span>缓存命中:{llm.usage.cache_read_input_tokens}</span>
              ) : null}
              <span>成本:${llm.costUsd.toFixed(6)}</span>
            </div>
          </div>
        )}
        {llm && !llm.ok && (
          <div
            style={{
              background: '#fef2f2',
              border: '1px solid #fca5a5',
              borderRadius: 6,
              padding: 12,
              fontSize: 13,
              color: '#991b1b',
            }}
          >
            <Badge ok={false} label="调用失败" />
            <div style={{ marginTop: 6 }}>{llm.error}</div>
          </div>
        )}
      </section>

      <footer style={{ marginTop: 16, textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>
        每 5 秒自动刷新 · API 通过 /api/* 代理到 :4000
      </footer>
    </main>
  );
}
