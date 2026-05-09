'use client';

import { useState } from 'react';
import type { CredentialRow } from './types';
import { API } from './constants';

export function CredentialsPanel({
  credentials, refreshingCredId, reload, onRefreshOne, flash, confirmAsync,
}: {
  credentials: CredentialRow[];
  refreshingCredId: string | null;
  reload: () => Promise<void>;
  onRefreshOne: (id: string) => Promise<void>;
  flash: (msg: string, ok?: boolean) => void;
  confirmAsync: (opts: { title: string; body: React.ReactNode; danger?: boolean; confirmLabel?: string; cancelLabel?: string }) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<CredentialRow | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Edit-drawer state
  const [name, setName] = useState('');
  const [cookie, setCookie] = useState('');
  const [ua, setUa] = useState('');
  const [status, setStatus] = useState<'active'|'expired'|'revoked'>('active');
  const [secretUser, setSecretUser] = useState('');
  const [secretPass, setSecretPass] = useState('');
  const [busy, setBusy] = useState(false);

  // Inline-create state
  const [cName, setCName] = useState('');
  const [cPlatform, setCPlatform] = useState<'x'|'knit'|'2ksg'|'bluesky'>('x');
  const [cCookie, setCCookie] = useState('');
  const [cUa, setCUa] = useState('');
  const [cSecretUser, setCSecretUser] = useState('');
  const [cSecretPass, setCSecretPass] = useState('');

  const startEdit = (c: CredentialRow) => {
    setEditing(c);
    setName(c.name);
    setCookie('');           // never pre-fill cookie — too long, and we don't return it from /admin/credentials
    setUa(c.user_agent ?? '');
    setStatus((['active','expired','revoked'].includes(c.status) ? c.status : 'active') as any);
    setSecretUser(c.secret_username ?? '');
    setSecretPass('');
  };
  const closeEdit = () => { setEditing(null); setBusy(false); };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {};
      if (name.trim() && name.trim() !== editing.name) body.name = name.trim();
      if (cookie.trim()) body.cookie = cookie.trim();
      if (ua.trim() !== (editing.user_agent ?? '')) body.user_agent = ua.trim() || null;
      if (status !== editing.status) body.status = status;

      if (Object.keys(body).length === 0 && !secretUser.trim() && !secretPass.trim()) {
        flash('没有变更', false);
        return;
      }

      if (Object.keys(body).length > 0) {
        const r = await fetch(`${API}/admin/credentials/${editing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!r.ok) { const t = await r.text(); flash(`保存失败：${t.slice(0,160)}`, false); return; }
      }

      // Optionally update auto-refresh secret. We require BOTH user+pass to
      // touch it — if either is blank the user is just editing other fields.
      if (secretUser.trim() && secretPass.trim()) {
        const sr = await fetch(`${API}/admin/credentials/${editing.id}/secret`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: secretUser.trim(), password: secretPass }),
        });
        if (!sr.ok) {
          const t = await sr.text();
          flash(`其他字段已保存,但 secret 失败：${t.slice(0,140)}`, false);
        }
      }

      flash(`已保存凭证 ${editing.name}`);
      setSecretPass('');  // clear from memory
      closeEdit();
      await reload();
    } catch (e) {
      flash(`保存失败：${e}`, false);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    const ok = await confirmAsync({
      title: '删除凭证',
      body: `凭证「${editing.name}」将被删除。挂在它上面的 ${editing.source_count} 个源会回到无凭证状态（运行时会报缺 cookie）。`,
      danger: true,
      confirmLabel: '删除凭证',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await fetch(`${API}/admin/credentials/${editing.id}`, { method: 'DELETE' });
      if (!r.ok) { const t = await r.text(); flash(`删除失败：${t.slice(0,160)}`, false); return; }
      flash(`已删除 ${editing.name}`);
      closeEdit();
      await reload();
    } finally { setBusy(false); }
  };

  const removeSecret = async () => {
    if (!editing) return;
    const ok = await confirmAsync({
      title: '移除自动刷新账密',
      body: '凭证保留，但绑定的用户名/密码会被清除。此后 cookie 过期需要手动粘贴新值。',
      danger: true,
      confirmLabel: '移除 secret',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await fetch(`${API}/admin/credentials/${editing.id}/secret`, { method: 'DELETE' });
      if (!r.ok) { const t = await r.text(); flash(`移除失败：${t.slice(0,160)}`, false); return; }
      flash('已移除 secret');
      closeEdit();
      await reload();
    } finally { setBusy(false); }
  };

  const create = async () => {
    if (!cName.trim() || !cCookie.trim()) { flash('名字 + cookie 必填', false); return; }
    setBusy(true);
    try {
      const r = await fetch(`${API}/admin/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: cPlatform,
          name: cName.trim(),
          cookie: cCookie.trim(),
          user_agent: cUa.trim() || null,
        }),
      });
      if (!r.ok) { const t = await r.text(); flash(`创建失败：${t.slice(0,160)}`, false); return; }
      const d = await r.json();
      if (cSecretUser.trim() && cSecretPass.trim()) {
        await fetch(`${API}/admin/credentials/${d.credential.id}/secret`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: cSecretUser.trim(), password: cSecretPass }),
        });
      }
      flash(`已新建凭证 ${cName}`);
      setCName(''); setCCookie(''); setCUa(''); setCSecretUser(''); setCSecretPass('');
      setShowCreate(false);
      await reload();
    } finally { setBusy(false); }
  };

  const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString('zh-CN') : '—';

  const statusBadge = (s: string) => {
    const colors: Record<string, [string, string]> = {
      active:  ['#14532d', '#86efac'],
      expired: ['#78350f', '#fbbf24'],
      revoked: ['#7f1d1d', '#fca5a5'],
    };
    const [bg, fg] = colors[s] ?? ['#1e293b', '#94a3b8'];
    const label = s === 'active' ? '活跃' : s === 'expired' ? '已过期' : s === 'revoked' ? '已吊销' : s;
    return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: bg, color: fg, fontWeight: 600 }}>{label}</span>;
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: '#94a3b8' }}>
          共 <strong style={{ color: '#e2e8f0' }}>{credentials.length}</strong> 个凭证 ·&nbsp;
          <span style={{ color: '#22c55e' }}>活跃 {credentials.filter(c => c.status === 'active').length}</span>&nbsp;/
          <span style={{ color: '#fbbf24' }}> 过期 {credentials.filter(c => c.status === 'expired').length}</span>&nbsp;/
          <span style={{ color: '#f87171' }}> 吊销 {credentials.filter(c => c.status === 'revoked').length}</span>
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={reload}
            title="重新拉取一次列表(只刷新页面数据,不影响任何凭证的 cookie)"
            style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>
            ↻ 重新加载列表
          </button>
          <button onClick={() => setShowCreate(true)}
            style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#6366f1', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            + 新建凭证
          </button>
        </div>
      </div>

      {/* Rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {credentials.map(c => {
          const failed = (c.secret_consecutive_failures ?? 0) > 0;
          return (
            <div key={c.id} style={{
              background: '#1e293b',
              border: `1px solid ${c.status === 'active' ? '#334155' : '#1e293b'}`,
              borderLeft: `3px solid ${c.status === 'active' ? '#22c55e' : c.status === 'expired' ? '#d97706' : '#dc2626'}`,
              borderRadius: 8, padding: '12px 16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9' }}>{c.name}</span>
                    <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 8, background: '#0ea5e933', color: '#7dd3fc' }}>{c.platform}</span>
                    {statusBadge(c.status)}
                    {c.has_secret && (
                      <span title={`auto-refresh 账号: ${c.secret_username}`} style={{ fontSize: 10, padding: '1px 7px', borderRadius: 8, background: '#312e81', color: '#c7d2fe' }}>
                        🔁 自动刷新
                      </span>
                    )}
                    {failed && (
                      <span title={c.secret_last_refresh_error ?? undefined} style={{ fontSize: 10, padding: '1px 7px', borderRadius: 8, background: '#7f1d1d', color: '#fca5a5' }}>
                        连续失败 {c.secret_consecutive_failures} 次
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    <span>cookie {c.cookie_len > 0 ? `${c.cookie_len} 字符` : '空'}</span>
                    <span>{c.source_count} 个源在用</span>
                    <span>上次使用: {fmt(c.last_used_at)}</span>
                    <span>上次校验: {fmt(c.last_auth_check_at)}{c.last_auth_ok === false ? ' ❌' : c.last_auth_ok === true ? ' ✓' : ''}</span>
                    {c.has_secret && <span>上次刷新: {fmt(c.secret_last_refresh_at)}{c.secret_last_refresh_ok === false ? ' ❌' : c.secret_last_refresh_ok ? ' ✓' : ''}</span>}
                  </div>
                  {failed && c.secret_last_refresh_error && (
                    <div style={{ fontSize: 11, color: '#fca5a5', marginTop: 4, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-word' }}>
                      ⚠ {c.secret_last_refresh_error.slice(0, 220)}{c.secret_last_refresh_error.length > 220 ? '…' : ''}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {c.has_secret && (
                    <button onClick={() => onRefreshOne(c.id)} disabled={refreshingCredId === c.id}
                      title="用账号密码 stealth 登录刷一次 cookie"
                      style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid #334155', background: refreshingCredId === c.id ? '#1e293b' : 'transparent', color: refreshingCredId === c.id ? '#475569' : '#a5b4fc', fontSize: 11, cursor: refreshingCredId === c.id ? 'not-allowed' : 'pointer' }}>
                      {refreshingCredId === c.id ? '刷新中…' : '🔁 立即刷新'}
                    </button>
                  )}
                  <button onClick={() => startEdit(c)}
                    style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontSize: 11, cursor: 'pointer' }}>
                    编辑
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        {credentials.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: '#334155', background: '#0f172a', borderRadius: 10, border: '1px dashed #334155' }}>
            暂无凭证 · 点击「+ 新建凭证」
          </div>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div onClick={() => !busy && setShowCreate(false)}
          style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#1e293b', border: '1px solid #6366f1', borderRadius: 12, padding: 22, maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#a5b4fc' }}>新建凭证</div>
              <button onClick={() => !busy && setShowCreate(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>平台</span>
                <select value={cPlatform} onChange={e => setCPlatform(e.target.value as any)}
                  style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, colorScheme: 'dark' }}>
                  <option value="x">X (Twitter)</option>
                  {/* Other platforms hidden until their credential workflows are wired up. */}
                  {/* <option value="knit">knit</option> */}
                  {/* <option value="2ksg">2ksg</option> */}
                  {/* <option value="bluesky">bluesky</option> */}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>名字</span>
                <input value={cName} onChange={e => setCName(e.target.value)}
                  placeholder="如 main-x-2026-04"
                  style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }} />
              </label>
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>Cookie(完整 Cookie 头)</span>
              <textarea value={cCookie} onChange={e => setCCookie(e.target.value)} rows={4}
                placeholder="auth_token=…; ct0=…; …"
                style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'ui-monospace, monospace', resize: 'vertical' }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>User-Agent(可选)</span>
              <input value={cUa} onChange={e => setCUa(e.target.value)}
                placeholder="Mozilla/5.0 …"
                style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'ui-monospace, monospace' }} />
            </label>

            {cPlatform === 'x' && (
              <details style={{ marginBottom: 12 }}>
                <summary style={{ fontSize: 11, color: '#a5b4fc', cursor: 'pointer', marginBottom: 6 }}>
                  🔁 配置自动刷新(X 用户名 + 密码,加密存储)
                </summary>
                <div style={{ marginTop: 6, padding: '8px 10px', background: '#0f172a', borderRadius: 5, border: '1px solid #312e81' }}>
                  <input value={cSecretUser} onChange={e => setCSecretUser(e.target.value)} autoComplete="off"
                    placeholder="X 用户名 / 邮箱 / 手机号"
                    style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, marginBottom: 6 }} />
                  <input type="password" value={cSecretPass} onChange={e => setCSecretPass(e.target.value)} autoComplete="new-password"
                    placeholder="X 密码"
                    style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }} />
                </div>
              </details>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
              <button onClick={() => setShowCreate(false)} disabled={busy}
                style={{ padding: '6px 14px', borderRadius: 5, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>取消</button>
              <button onClick={create} disabled={busy || !cName.trim() || !cCookie.trim()}
                style={{ padding: '6px 14px', borderRadius: 5, border: 'none', background: busy || !cName.trim() || !cCookie.trim() ? '#1e293b' : '#6366f1', color: busy || !cName.trim() || !cCookie.trim() ? '#475569' : '#fff', fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>
                {busy ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit drawer */}
      {editing && (
        <div onClick={() => !busy && closeEdit()}
          style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#1e293b', border: '1px solid #6366f1', borderRadius: 12, padding: 22, maxWidth: 580, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#a5b4fc' }}>编辑凭证</div>
              <button onClick={() => !busy && closeEdit()} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 12 }}>
              {editing.platform} · 当前 {editing.cookie_len} 字符 cookie · {editing.source_count} 个源在用
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>名字</span>
              <input value={name} onChange={e => setName(e.target.value)}
                style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }} />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>Cookie(留空则不动,贴新值会替换并重置 last_auth_check)</span>
              <textarea value={cookie} onChange={e => setCookie(e.target.value)} rows={4}
                placeholder="auth_token=…; ct0=…; …"
                style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'ui-monospace, monospace', resize: 'vertical' }} />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>User-Agent</span>
              <input value={ua} onChange={e => setUa(e.target.value)}
                style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'ui-monospace, monospace' }} />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>状态(改成 active 会同时重置自动刷新失败计数)</span>
              <select value={status} onChange={e => setStatus(e.target.value as any)}
                style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, colorScheme: 'dark' }}>
                <option value="active">active(活跃)</option>
                <option value="expired">expired(过期,scheduler 会尝试自动刷)</option>
                <option value="revoked">revoked(吊销,scheduler 跳过)</option>
              </select>
            </label>

            {editing.platform === 'x' && (
              <details style={{ marginBottom: 12 }} open={!editing.has_secret ? false : undefined}>
                <summary style={{ fontSize: 11, color: '#a5b4fc', cursor: 'pointer', marginBottom: 6 }}>
                  🔁 自动刷新账密 {editing.has_secret ? `(已绑定 ${editing.secret_username})` : '(未配置)'}
                </summary>
                <div style={{ marginTop: 6, padding: '8px 10px', background: '#0f172a', borderRadius: 5, border: '1px solid #312e81' }}>
                  <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6, lineHeight: 1.5 }}>
                    填了之后,cookie 过期时系统会自动重新登录刷新。两个字段都填才会更新;留空不动。
                    密码用 AES-256-GCM 加密入库。
                  </div>
                  <input value={secretUser} onChange={e => setSecretUser(e.target.value)} autoComplete="off"
                    placeholder="X 用户名 / 邮箱 / 手机号"
                    style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, marginBottom: 6 }} />
                  <input type="password" value={secretPass} onChange={e => setSecretPass(e.target.value)} autoComplete="new-password"
                    placeholder={editing.has_secret ? '留空保留旧密码' : 'X 密码'}
                    style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, marginBottom: 6 }} />
                  {editing.has_secret && (
                    <button onClick={removeSecret} disabled={busy}
                      style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid #7f1d1d', background: 'transparent', color: '#fca5a5', fontSize: 11, cursor: 'pointer' }}>
                      移除自动刷新
                    </button>
                  )}
                </div>
              </details>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <button onClick={remove} disabled={busy}
                style={{ padding: '6px 14px', borderRadius: 5, border: '1px solid #7f1d1d', background: 'transparent', color: '#fca5a5', fontSize: 12, cursor: 'pointer' }}>
                删除凭证
              </button>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={closeEdit} disabled={busy}
                  style={{ padding: '6px 14px', borderRadius: 5, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>取消</button>
                <button onClick={save} disabled={busy}
                  style={{ padding: '6px 14px', borderRadius: 5, border: 'none', background: busy ? '#1e293b' : '#6366f1', color: busy ? '#475569' : '#fff', fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>
                  {busy ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
