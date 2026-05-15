'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { AdminNav } from '../../../components/AdminNav';

const API = process.env.NEXT_PUBLIC_API_URL ?? '/api';

// ── Types ─────────────────────────────────────────────────────────────────
interface FeedbackStats {
  byCount: Record<string, number>;
  overrideRate: {
    compliance:   { reviews: number; total: number; rate: number };
    distribution: { edits: number;   total: number; rate: number };
  };
  recentlyHarvested: Array<{ source: string; count: number; latest: string }>;
}

interface TrainingExample {
  id: string;
  source: string;
  item_id: string | null;
  input_data:    { title?: string; category?: string; channel?: string };
  machine_output: any;
  human_label:   { decision?: string; reason?: string; copy?: string };
  agreement: boolean;
  used_for_training: boolean;
  created_at: string;
}

interface MemoryRule {
  id: string;
  domain: string;
  scope: string | null;
  rule: string;
  origin: 'human' | 'derived';
  status: 'active' | 'paused' | 'deprecated';
  hit_count: number;
  last_used_at: string | null;
  notes: string | null;
  created_at: string;
}

// ── Styles ────────────────────────────────────────────────────────────────
const card: React.CSSProperties = { background: '#1e293b', border: '1px solid #3e4144', borderRadius: 8, padding: 16 };
const th: React.CSSProperties   = { textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600, color: '#71767b', borderBottom: '1px solid #3e4144', background: '#0f172a', textTransform: 'uppercase', letterSpacing: 0.4 };
const td: React.CSSProperties   = { padding: '10px 12px', fontSize: 13, borderBottom: '1px solid #3e4144', verticalAlign: 'top', color: '#e7e9ea' };
const btn: React.CSSProperties  = { padding: '6px 12px', fontSize: 12, border: '1px solid #3e4144', borderRadius: 6, background: 'transparent', color: '#71767b', cursor: 'pointer' };
const btnPrimary: React.CSSProperties  = { ...btn, background: '#6366f1', color: '#fff', borderColor: '#6366f1', fontWeight: 600 };
const btnSuccess: React.CSSProperties  = { ...btn, background: '#16a34a', color: '#fff', borderColor: '#16a34a', fontWeight: 600 };
const btnDanger:  React.CSSProperties  = { ...btn, background: '#1d9bf0', color: '#fff', borderColor: '#1d9bf0', fontWeight: 600 };
const input: React.CSSProperties = { padding: '6px 10px', fontSize: 12, border: '1px solid #3e4144', borderRadius: 6, background: '#0f172a', color: '#e7e9ea', outline: 'none' };

function KPI({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div style={{ ...card, minWidth: 130, textAlign: 'center' }}>
      <div style={{ fontSize: 10, color: '#71767b', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: accent ?? '#e7e9ea' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#71767b', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function FeedbackPage() {
  const [stats,     setStats]     = useState<FeedbackStats | null>(null);
  const [examples,  setExamples]  = useState<TrainingExample[]>([]);
  const [exTotal,   setExTotal]   = useState(0);
  const [exPage,    setExPage]    = useState(0);
  const [exDomain,  setExDomain]  = useState<'all' | 'compliance' | 'distribution'>('all');
  const [rules,     setRules]     = useState<MemoryRule[]>([]);
  const [rDomain,   setRDomain]   = useState<'all' | 'compliance' | 'distribution'>('all');
  const [msg,       setMsg]       = useState('');
  const [busy,      setBusy]      = useState(false);

  // New-rule form
  const [newDomain, setNewDomain] = useState<'compliance' | 'distribution'>('compliance');
  const [newRule,   setNewRule]   = useState('');
  const [newScope,  setNewScope]  = useState('');
  const [showForm,  setShowForm]  = useState(false);

  const PAGE_SIZE = 20;

  const loadStats = useCallback(async () => {
    const r = await fetch(`${API}/admin/feedback-stats`).then((r) => r.json()).catch(() => null);
    if (r) setStats(r);
  }, []);

  const loadExamples = useCallback(async () => {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(exPage * PAGE_SIZE),
    });
    if (exDomain !== 'all') params.set('source', exDomain);
    const r = await fetch(`${API}/admin/training-data?${params}`).then((r) => r.json()).catch(() => ({ examples: [], total: 0 }));
    setExamples(r.examples ?? []);
    setExTotal(r.total ?? 0);
  }, [exPage, exDomain]);

  const loadRules = useCallback(async () => {
    const params = new URLSearchParams({ status: 'active' });
    if (rDomain !== 'all') params.set('domain', rDomain);
    const r = await fetch(`${API}/admin/memory-rules?${params}`).then((r) => r.json()).catch(() => ({ rules: [] }));
    setRules(r.rules ?? []);
  }, [rDomain]);

  useEffect(() => { loadStats(); loadExamples(); loadRules(); }, [loadStats, loadExamples, loadRules]);

  async function doHarvest() {
    setBusy(true); setMsg('');
    try {
      const r = await fetch(`${API}/admin/training-data/harvest`, { method: 'POST' }).then((r) => r.json());
      setMsg(`✓ 采集完成：合规 +${r.compliance?.inserted ?? 0} 条，分发 +${r.distribution?.inserted ?? 0} 条`);
      await loadStats(); await loadExamples();
    } catch (e) { setMsg(`✗ ${e}`); }
    setBusy(false);
  }

  async function doDerive(domain: 'compliance' | 'distribution') {
    setBusy(true); setMsg('');
    try {
      const r = await fetch(`${API}/admin/training-data/derive-rules?domain=${domain}`, { method: 'POST' }).then((r) => r.json());
      setMsg(`✓ ${domain} 归纳完成：从 ${r.examplesRead} 条样本生成 ${r.rulesCreated} 条规则`);
      await loadRules();
    } catch (e) { setMsg(`✗ ${e}`); }
    setBusy(false);
  }

  async function doExport(source: 'compliance' | 'distribution') {
    const url = `${API}/admin/training-data/export?source=${source}`;
    window.open(url, '_blank');
  }

  async function addRule() {
    if (!newRule.trim()) return;
    setBusy(true);
    try {
      await fetch(`${API}/admin/memory-rules`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain: newDomain, rule: newRule, scope: newScope || null }),
      });
      setNewRule(''); setNewScope(''); setShowForm(false);
      await loadRules();
      setMsg('✓ 规则已添加');
    } catch (e) { setMsg(`✗ ${e}`); }
    setBusy(false);
  }

  async function toggleRule(id: string, status: 'active' | 'paused') {
    await fetch(`${API}/admin/memory-rules/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    await loadRules();
  }

  async function deleteRule(id: string) {
    if (!confirm('确认删除此规则？')) return;
    await fetch(`${API}/admin/memory-rules/${id}`, { method: 'DELETE' });
    await loadRules();
  }

  const compRate  = stats?.overrideRate.compliance;
  const distRate  = stats?.overrideRate.distribution;
  const totalEx   = Object.values(stats?.byCount ?? {}).reduce((a, b) => a + b, 0);
  const totalPages = Math.ceil(exTotal / PAGE_SIZE);

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e7e9ea', fontFamily: 'system-ui, -apple-system, PingFang SC, sans-serif' }}>
      <header style={{ background: '#020617', borderBottom: '1px solid #1e293b', padding: '0 24px', height: 52, display: 'flex', alignItems: 'center', gap: 16, position: 'sticky', top: 0, zIndex: 100 }}>
        <span style={{ fontSize: 16, fontWeight: 800 }}>内容中台</span>
        <span style={{ color: '#3e4144' }}>/</span>
        <span style={{ fontSize: 13, color: '#71767b' }}>反馈闭环</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Link href="/workbench" style={{ ...btn, textDecoration: 'none', color: '#e7e9ea', display: 'inline-flex', alignItems: 'center' }}>← 工作台</Link>
          <button style={btn} onClick={() => { loadStats(); loadExamples(); loadRules(); }}>↻ 刷新</button>
          <button style={btnPrimary} disabled={busy} onClick={doHarvest}>⬇ 立即采集反馈</button>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 20px 60px' }}>
        <AdminNav current="feedback" />

        {msg && (
          <div style={{ ...card, marginBottom: 16, fontSize: 13, color: msg.startsWith('✓') ? '#86efac' : '#fca5a5', borderColor: msg.startsWith('✓') ? '#16a34a' : '#1d9bf0', background: msg.startsWith('✓') ? '#052e16' : '#450a0a' }}>
            {msg}
          </div>
        )}

        {/* ── KPI tiles ─────────────────────────────────────── */}
        <section style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          <KPI label="总训练样本" value={totalEx} accent="#a78bfa" />
          <KPI
            label="合规人工介入率"
            value={compRate ? `${(compRate.rate * 100).toFixed(1)}%` : '—'}
            sub={compRate ? `${compRate.reviews}/${compRate.total} 次` : undefined}
            accent={compRate && compRate.rate > 0.1 ? '#fbbf24' : '#86efac'}
          />
          <KPI
            label="分发文案修改率"
            value={distRate ? `${(distRate.rate * 100).toFixed(1)}%` : '—'}
            sub={distRate ? `${distRate.edits}/${distRate.total} 次` : undefined}
            accent={distRate && distRate.rate > 0.2 ? '#fbbf24' : '#86efac'}
          />
          <KPI label="compliance 样本" value={stats?.byCount?.compliance ?? 0} accent="#60a5fa" />
          <KPI label="distribution 样本" value={stats?.byCount?.distribution ?? 0} accent="#34d399" />
        </section>

        {/* ── Memory rules ──────────────────────────────────── */}
        <section style={{ ...card, padding: 0, marginBottom: 20, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #3e4144' }}>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#e7e9ea' }}>
              Agent 记忆规则
              <span style={{ color: '#71767b', fontWeight: 400, marginLeft: 8 }}>（注入到每次 LLM 推理的 system prompt）</span>
            </h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select value={rDomain} onChange={(e) => setRDomain(e.target.value as any)}
                style={{ ...input, fontSize: 11 }}>
                <option value="all">全部域</option>
                <option value="compliance">compliance</option>
                <option value="distribution">distribution</option>
              </select>
              <button style={btnSuccess} disabled={busy} onClick={() => doDerive('compliance')}>⚡ 归纳 compliance</button>
              <button style={btnSuccess} disabled={busy} onClick={() => doDerive('distribution')}>⚡ 归纳 distribution</button>
              <button style={btnPrimary} onClick={() => setShowForm((v) => !v)}>+ 手动添加</button>
            </div>
          </div>

          {showForm && (
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #3e4144', background: '#0f172a', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <div style={{ fontSize: 11, color: '#71767b', marginBottom: 4 }}>域</div>
                <select value={newDomain} onChange={(e) => setNewDomain(e.target.value as any)} style={input}>
                  <option value="compliance">compliance</option>
                  <option value="distribution">distribution</option>
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 260 }}>
                <div style={{ fontSize: 11, color: '#71767b', marginBottom: 4 }}>规则内容 <span style={{ color: '#ef4444' }}>*</span></div>
                <input value={newRule} onChange={(e) => setNewRule(e.target.value)}
                  style={{ ...input, width: '100%', boxSizing: 'border-box' }}
                  placeholder="例：凡标题含「免费赚钱」应将金融诱导评分调高至 3" />
              </div>
              <div style={{ width: 160 }}>
                <div style={{ fontSize: 11, color: '#71767b', marginBottom: 4 }}>Scope（可选）</div>
                <input value={newScope} onChange={(e) => setNewScope(e.target.value)}
                  style={input} placeholder="e.g. category=AI" />
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={btnPrimary} disabled={busy || !newRule.trim()} onClick={addRule}>保存</button>
                <button style={btn} onClick={() => { setShowForm(false); setNewRule(''); setNewScope(''); }}>取消</button>
              </div>
            </div>
          )}

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>域 / Scope</th>
                <th style={th}>规则</th>
                <th style={th}>来源</th>
                <th style={th}>命中</th>
                <th style={th}>最近使用</th>
                <th style={th}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td style={td}>
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: r.domain === 'compliance' ? '#1e3a5f' : '#14532d', color: r.domain === 'compliance' ? '#7dd3fc' : '#86efac' }}>
                      {r.domain}
                    </span>
                    {r.scope && <div style={{ fontSize: 10, color: '#71767b', marginTop: 3 }}>{r.scope}</div>}
                  </td>
                  <td style={{ ...td, maxWidth: 420 }}>
                    <span style={{ fontSize: 12, color: '#e7e9ea' }}>{r.rule}</span>
                    {r.notes && <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{r.notes}</div>}
                  </td>
                  <td style={td}>
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: r.origin === 'human' ? '#2d1657' : '#1a2e1a', color: r.origin === 'human' ? '#c4b5fd' : '#6ee7b7' }}>
                      {r.origin === 'human' ? '人工' : 'AI 归纳'}
                    </span>
                  </td>
                  <td style={{ ...td, color: '#fbbf24', fontWeight: 600 }}>{r.hit_count}</td>
                  <td style={{ ...td, color: '#71767b', fontSize: 11 }}>{r.last_used_at ? new Date(r.last_used_at).toLocaleString() : '—'}</td>
                  <td style={{ ...td, display: 'flex', gap: 4 }}>
                    <button style={btn} onClick={() => toggleRule(r.id, r.status === 'active' ? 'paused' : 'active')}>
                      {r.status === 'active' ? '暂停' : '启用'}
                    </button>
                    <button style={btnDanger} onClick={() => deleteRule(r.id)}>删</button>
                  </td>
                </tr>
              ))}
              {rules.length === 0 && (
                <tr>
                  <td style={{ ...td, color: '#475569' }} colSpan={6}>暂无激活规则 — 点击「手动添加」或「⚡ 归纳」来生成</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {/* ── Training examples ─────────────────────────────── */}
        <section style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #3e4144', flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#e7e9ea' }}>
              训练样本
              <span style={{ color: '#71767b', fontWeight: 400, marginLeft: 8 }}>共 {exTotal} 条 · 第 {exPage + 1}/{totalPages || 1} 页</span>
            </h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select value={exDomain} onChange={(e) => { setExDomain(e.target.value as any); setExPage(0); }}
                style={{ ...input, fontSize: 11 }}>
                <option value="all">全部域</option>
                <option value="compliance">compliance</option>
                <option value="distribution">distribution</option>
              </select>
              <button style={btn} disabled={exPage <= 0} onClick={() => setExPage((p) => p - 1)}>‹ 上页</button>
              <button style={btn} disabled={exPage + 1 >= totalPages} onClick={() => setExPage((p) => p + 1)}>下页 ›</button>
              <button style={btn} onClick={() => doExport('compliance')}>↓ 导出 compliance JSONL</button>
              <button style={btn} onClick={() => doExport('distribution')}>↓ 导出 distribution JSONL</button>
            </div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>来源</th>
                <th style={th}>内容摘要</th>
                <th style={th}>机器输出</th>
                <th style={th}>人工纠正</th>
                <th style={th}>已用于训练</th>
                <th style={th}>时间</th>
              </tr>
            </thead>
            <tbody>
              {examples.map((ex) => {
                const macComp = ex.source === 'compliance' ? ex.machine_output?.scores : null;
                const maxScore = macComp
                  ? Math.max(...Object.values(macComp).map(Number))
                  : null;
                return (
                  <tr key={ex.id}>
                    <td style={td}>
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: ex.source === 'compliance' ? '#1e3a5f' : '#14532d', color: ex.source === 'compliance' ? '#7dd3fc' : '#86efac' }}>
                        {ex.source}
                      </span>
                    </td>
                    <td style={{ ...td, maxWidth: 200, fontSize: 12 }}>
                      {ex.input_data?.title
                        ? <span title={ex.input_data.title}>{ex.input_data.title.slice(0, 60)}{ex.input_data.title.length > 60 ? '…' : ''}</span>
                        : <span style={{ color: '#475569' }}>—</span>}
                      {ex.input_data?.category && <div style={{ fontSize: 10, color: '#71767b' }}>{ex.input_data.category}</div>}
                    </td>
                    <td style={{ ...td, fontSize: 11, color: '#71767b', maxWidth: 160 }}>
                      {ex.source === 'compliance'
                        ? (maxScore !== null ? <span style={{ color: maxScore >= 2 ? '#f87171' : '#71767b' }}>最高分 {maxScore}</span> : '—')
                        : <span title={ex.machine_output?.copy}>{String(ex.machine_output?.copy ?? '').slice(0, 60)}…</span>}
                    </td>
                    <td style={{ ...td, fontSize: 11, maxWidth: 200 }}>
                      {ex.source === 'compliance'
                        ? <span style={{ color: ex.human_label?.decision === 'approve' ? '#86efac' : '#f87171', fontWeight: 600 }}>
                            {ex.human_label?.decision === 'approve' ? '✓ 放行' : '✗ 拒绝'}
                            {ex.human_label?.reason && <span style={{ color: '#71767b', fontWeight: 400 }}> — {ex.human_label.reason}</span>}
                          </span>
                        : <span title={ex.human_label?.copy}>{String(ex.human_label?.copy ?? '').slice(0, 60)}…</span>}
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      {ex.used_for_training
                        ? <span style={{ color: '#86efac', fontSize: 11 }}>✓</span>
                        : <span style={{ color: '#475569', fontSize: 11 }}>—</span>}
                    </td>
                    <td style={{ ...td, color: '#71767b', fontSize: 11, whiteSpace: 'nowrap' }}>
                      {new Date(ex.created_at).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
              {examples.length === 0 && (
                <tr>
                  <td style={{ ...td, color: '#475569' }} colSpan={6}>暂无样本 — 先在「待复核」或「待分发」节点执行人工操作，再点击「立即采集反馈」</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <footer style={{ marginTop: 16, textAlign: 'center', color: '#3e4144', fontSize: 11 }}>
          规则在每次 LLM 推理时自动注入 · 样本每 5 min 后台自动采集 · 规则每 7 天自动归纳一次
        </footer>
      </div>
    </div>
  );
}
