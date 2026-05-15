'use client';

import { useEffect, useState, useCallback } from 'react';
import { AdminNav } from '../../../components/AdminNav';
import Link from 'next/link';

type Check = {
  ok: boolean;
  latencyMs: number;
  detail?: string;
  error?: string;
};

type InfraResp = {
  database: Check;
  redis: Check;
  minio: Check;
  env: {
    hasLLMKey: boolean;
    models: { large: string; medium: string; small: string };
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
  background: '#1e293b',
  border: '1px solid #3e4144',
  borderRadius: 8,
  padding: 16,
};
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontSize: 11,
  fontWeight: 600,
  color: '#71767b',
  borderBottom: '1px solid #3e4144',
  background: '#0f172a',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};
const td: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 13,
  borderBottom: '1px solid #3e4144',
  verticalAlign: 'top',
  color: '#e7e9ea',
};
const btn: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 12,
  border: '1px solid #3e4144',
  borderRadius: 6,
  background: 'transparent',
  color: '#71767b',
  cursor: 'pointer',
};
const btnPrimary: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  border: '1px solid #6366f1',
  borderRadius: 6,
  background: '#6366f1',
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
};

function Badge({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <span
      style={{
        fontSize: 11,
        padding: '2px 8px',
        borderRadius: 10,
        background: ok ? '#14532d' : '#7f1d1d',
        color: ok ? '#86efac' : '#fca5a5',
        fontWeight: 600,
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
        <strong style={{ fontSize: 14, color: '#e7e9ea' }}>{title}</strong>
        {check ? <Badge ok={check.ok} /> : <Badge ok={false} label="未知" />}
      </div>
      <div style={{ marginTop: 10, fontSize: 12, color: '#71767b', lineHeight: 1.6 }}>
        {check ? (
          <>
            <div>延迟:<span style={{ color: '#e7e9ea' }}>{check.latencyMs} ms</span></div>
            {check.detail && <div>详情:<span style={{ color: '#e7e9ea' }}>{check.detail}</span></div>}
            {check.error && <div style={{ color: '#fca5a5' }}>错误:{check.error}</div>}
          </>
        ) : (
          <div>加载中…</div>
        )}
      </div>
    </div>
  );
}

export default function Day1Page() {
  const [infra, setInfra] = useState<InfraResp | null>(null);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [llmBusy, setLlmBusy] = useState(false);
  const [llm, setLlm] = useState<LLMResp | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [i, q] = await Promise.all([
        getJSON<InfraResp>('/api/admin/infra/health'),
        getJSON<{ queues: Queue[] }>('/api/admin/infra/queues'),
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
      const r = await getJSON<LLMResp>('/api/admin/infra/test-llm', { method: 'POST' });
      setLlm(r);
    } catch (e: any) {
      setLlm({ ok: false, error: e.message });
    } finally {
      setLlmBusy(false);
    }
  }

  const totalOk = infra && infra.database.ok && infra.redis.ok && infra.minio.ok ? true : infra ? false : null;
  const sectionTitle: React.CSSProperties = { fontSize: 12, color: '#71767b', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 };

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e7e9ea', fontFamily: 'system-ui, -apple-system, PingFang SC, sans-serif' }}>
      <header style={{ background: '#020617', borderBottom: '1px solid #1e293b', padding: '0 24px', height: 52, display: 'flex', alignItems: 'center', gap: 16, position: 'sticky', top: 0, zIndex: 100 }}>
        <span style={{ color: '#e7e9ea', fontSize: 16, fontWeight: 800 }}>内容中台</span>
        <span style={{ color: '#3e4144' }}>/</span>
        <span style={{ fontSize: 13, color: '#71767b' }}>基础设施验收</span>
        {totalOk !== null && (
          <span style={{ marginLeft: 8 }}>
            <Badge ok={totalOk} label={totalOk ? '全部正常' : '存在异常'} />
          </span>
        )}
        <div style={{ marginLeft: 'auto' }}>
          <Link href="/workbench" style={{ ...btn, textDecoration: 'none', color: '#e7e9ea', display: 'inline-flex', alignItems: 'center' }}>← 工作台</Link><button style={btn} onClick={refresh}>↻ 刷新</button>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 20px 60px' }}>
        <AdminNav current="infra" />

        {err && (
          <div style={{ ...card, borderColor: '#7f1d1d', background: '#450a0a', color: '#fca5a5', marginBottom: 16, fontSize: 13 }}>
            ⚠ {err}
          </div>
        )}

        {/* Infra */}
        <h3 style={sectionTitle}>1. 基础设施健康</h3>
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
          <InfraCard title="MySQL · 主库" check={infra?.database} />
          <InfraCard title="Redis · BullMQ" check={infra?.redis} />
          <InfraCard title="MinIO · 对象存储" check={infra?.minio} />
        </section>

        {/* Env */}
        {infra && (
          <>
            <h3 style={sectionTitle}>2. 环境配置</h3>
            <section style={{ ...card, marginBottom: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, fontSize: 13 }}>
                <div>
                  <div style={{ color: '#71767b', fontSize: 11, marginBottom: 4 }}>GROQ_API_KEY</div>
                  {infra.env.hasLLMKey ? <Badge ok label="已配置" /> : <Badge ok={false} label="未配置" />}
                </div>
                <div>
                  <div style={{ color: '#71767b', fontSize: 11, marginBottom: 4 }}>调度器</div>
                  <Badge ok={infra.env.scheduler === 'enabled'} label={infra.env.scheduler === 'enabled' ? '已启用' : '已停用'} />
                </div>
                <div style={{ gridColumn: '1 / -1', color: '#71767b', fontSize: 12, lineHeight: 1.7, paddingTop: 4 }}>
                  模型配置 —— Large: <code style={{ background: '#0f172a', padding: '1px 6px', borderRadius: 3, color: '#a5b4fc' }}>{infra.env.models.large}</code>
                  &nbsp;· Medium: <code style={{ background: '#0f172a', padding: '1px 6px', borderRadius: 3, color: '#a5b4fc' }}>{infra.env.models.medium}</code>
                  &nbsp;· Small: <code style={{ background: '#0f172a', padding: '1px 6px', borderRadius: 3, color: '#a5b4fc' }}>{infra.env.models.small}</code>
                </div>
              </div>
            </section>
          </>
        )}

        {/* Queues */}
        <h3 style={sectionTitle}>3. 9 个 BullMQ 队列</h3>
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
                const alive = q.counts.waiting >= 0;
                return (
                  <tr key={q.name}>
                    <td style={td}><code style={{ fontSize: 12, color: '#a5b4fc' }}>{q.name}</code></td>
                    <td style={td}>{q.counts.waiting}</td>
                    <td style={{ ...td, color: q.counts.active > 0 ? '#fbbf24' : '#e7e9ea' }}>{q.counts.active}</td>
                    <td style={{ ...td, color: '#71767b' }}>{q.counts.delayed}</td>
                    <td style={{ ...td, color: '#71767b' }}>{q.counts.completed}</td>
                    <td style={{ ...td, color: q.counts.failed > 0 ? '#fca5a5' : '#71767b', fontWeight: q.counts.failed > 0 ? 600 : 400 }}>
                      {q.counts.failed}
                    </td>
                    <td style={td}><Badge ok={alive} label={alive ? '在线' : '离线'} /></td>
                  </tr>
                );
              })}
              {queues.length === 0 && (
                <tr><td style={{ ...td, color: '#71767b' }} colSpan={7}>加载中…</td></tr>
              )}
            </tbody>
          </table>
        </section>

        {/* LLM test */}
        <h3 style={sectionTitle}>4. LLM 封装 · 实调测试</h3>
        <section style={{ ...card, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 16 }}>
            <div style={{ fontSize: 13, color: '#71767b', lineHeight: 1.6 }}>
              调用 Groq 小模型发一条 ping,验证 API key、重试、成本计算、<code style={{ color: '#a5b4fc' }}>agent_runs</code> 审计写入全链路。
            </div>
            <button style={btnPrimary} disabled={llmBusy} onClick={testLlm}>
              {llmBusy ? '调用中…' : '测试 LLM 调用'}
            </button>
          </div>

          {llm && llm.ok && (
            <div style={{ background: '#052e16', border: '1px solid #16a34a', borderRadius: 6, padding: 12, fontSize: 13 }}>
              <div style={{ marginBottom: 8 }}>
                <Badge ok label="调用成功" /> <code style={{ marginLeft: 6, color: '#a5b4fc' }}>{llm.model}</code>
              </div>
              <div style={{ color: '#86efac' }}>回复:<b>{llm.text}</b></div>
              <div style={{ marginTop: 8, display: 'flex', gap: 16, color: '#86efac', fontSize: 12, flexWrap: 'wrap' }}>
                <span>延迟:{llm.latencyMs} ms</span>
                <span>输入 tokens:{llm.usage.input_tokens}</span>
                <span>输出 tokens:{llm.usage.output_tokens}</span>
                {llm.usage.cache_read_input_tokens ? <span>缓存命中:{llm.usage.cache_read_input_tokens}</span> : null}
                <span>成本:${llm.costUsd.toFixed(6)}</span>
              </div>
            </div>
          )}
          {llm && !llm.ok && (
            <div style={{ background: '#450a0a', border: '1px solid #1d9bf0', borderRadius: 6, padding: 12, fontSize: 13, color: '#fca5a5' }}>
              <Badge ok={false} label="调用失败" />
              <div style={{ marginTop: 6 }}>{llm.error}</div>
            </div>
          )}
        </section>

        <footer style={{ marginTop: 20, textAlign: 'center', color: '#475569', fontSize: 11 }}>
          每 5 秒自动刷新 · API 通过 /api/* 代理到 :4000
        </footer>
      </div>
    </div>
  );
}
