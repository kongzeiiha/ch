'use client';

import { useState, useEffect } from 'react';
import type { Source, CredentialRow } from './types';
import { API } from './constants';
import { buildStealthOpts, parseKsgLine } from './utils';

// Custom checkbox tuned for the slate palette. Native <input type="checkbox">
// renders with the OS theme on macOS/Windows and clashes with the dark
// surface; this version is fully styled and supports an indeterminate state
// for the "all-selected" header toggle.
function Checkbox({
  checked, indeterminate, onClick, ariaLabel,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  ariaLabel?: string;
}) {
  const active = checked || indeterminate;
  return (
    <span
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={ariaLabel}
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onClick?.(e as unknown as React.MouseEvent);
        }
      }}
      style={{
        width: 14, height: 14,
        border: `1.5px solid ${active ? '#6366f1' : '#475569'}`,
        borderRadius: 3,
        background: active ? '#6366f1' : '#0f172a',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
        cursor: 'pointer',
        transition: 'all 0.12s',
      }}>
      {checked && (
        <svg viewBox="0 0 14 14" width={10} height={10} aria-hidden>
          <path d="M2 7 L6 11 L12 3" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {indeterminate && !checked && (
        <span style={{ width: 6, height: 2, background: '#fff', borderRadius: 1, display: 'block' }} />
      )}
    </span>
  );
}

// Heroicons-style trash glyph. Uses currentColor so it inherits whatever
// `color` the parent button sets — that's how we get the red icon to track
// the red button without hard-coding the hex twice.
function TrashIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

export function SourcesPanel({
  sources, editingSource, showAddSource,
  setEditingSource, setShowAddSource,
  onSave, onDelete, onBulkDelete, onToggleStatus, onIngest,
  onAfterBatch, flash,
  credentials, refreshingCredId, reloadCredentials, refreshCredential,
}: {
  sources: Source[];
  editingSource: Source | null;
  showAddSource: boolean;
  setEditingSource: (s: Source | null) => void;
  setShowAddSource: (v: boolean) => void;
  onSave: (data: any) => void;
  onDelete: (s: Source) => void;
  onBulkDelete: (srcs: Source[]) => void;
  onToggleStatus: (s: Source) => void;
  onIngest: (s: Source) => void;
  onAfterBatch: () => void;
  flash: (msg: string, ok?: boolean) => void;
  credentials: CredentialRow[];
  refreshingCredId: string | null;
  reloadCredentials: () => Promise<void>;
  refreshCredential: (id: string) => Promise<void>;
}) {
  // Multi-select state. Drop ids that disappear from `sources` (e.g. after a
  // bulk delete) so the toolbar doesn't keep ghost selections around.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    setSelected((prev) => {
      const live = new Set(sources.map((s) => s.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (live.has(id)) next.add(id); else changed = true;
      }
      return changed ? next : prev;
    });
  }, [sources]);
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const allSelected = sources.length > 0 && selected.size === sources.length;
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(sources.map((s) => s.id)));
  };
  // Batch-import modal state. Lives inside SourcesPanel because it's coupled
  // to this surface; surfacing it through the global state machine isn't worth
  // the indirection.
  const [showBatch, setShowBatch] = useState(false);
  const [batchPlatform, setBatchPlatform] = useState<'x' | 'bluesky' | 'reddit'>('x');
  const [batchHandles, setBatchHandles] = useState('');
  const [batchCookie, setBatchCookie] = useState('');
  const [batchUserAgent, setBatchUserAgent] = useState('');
  const [batchLimit, setBatchLimit] = useState(20);
  const [batchSkipRetweets, setBatchSkipRetweets] = useState(true);
  const [batchTriggerFetch, setBatchTriggerFetch] = useState(true);
  // Reddit-specific knobs (sort/time controlling /r/<sub>/<sort>.json?t=<time>)
  const [batchRedditSort, setBatchRedditSort] = useState<'hot'|'new'|'top'|'rising'>('top');
  const [batchRedditTime, setBatchRedditTime] = useState<'hour'|'day'|'week'|'month'|'year'|'all'>('day');
  // credentials / refreshingCredId / reloadCredentials / refreshCredential
  // are now lifted to WorkbenchPage and passed as props above.
  const [batchCredentialId, setBatchCredentialId] = useState<string>('');
  // Inline-create-credential affordance (no need to leave the modal)
  const [showCreateCred, setShowCreateCred] = useState(false);
  const [newCredName, setNewCredName] = useState('');
  const [newCredCookie, setNewCredCookie] = useState('');
  const [newCredUA, setNewCredUA] = useState('');
  // Optional auto-refresh secret (X username + password). When filled, the
  // refresh worker can re-login when this credential's cookie expires.
  const [newCredXUser, setNewCredXUser] = useState('');
  const [newCredXPass, setNewCredXPass] = useState('');
  const [credBusy, setCredBusy] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResult, setBatchResult] = useState<null | {
    created: { handle: string; sourceId: string }[];
    updated: { handle: string; sourceId: string }[];
    failed: { handle: string; reason: string }[];
  }>(null);

  // ── Keyword discovery (search X People timeline) ────────────────────────
  interface DiscoveredUser {
    screen_name: string;
    name: string;
    description: string;
    followers_count: number;
    profile_image_url: string;
    verified: boolean;
    alreadyImported: boolean;
  }
  const [showDiscover, setShowDiscover] = useState(false);
  const [discoverQuery, setDiscoverQuery] = useState('');
  const [discoverCredentialId, setDiscoverCredentialId] = useState<string>('');
  const [discoverLimit, setDiscoverLimit] = useState(30);
  const [discoverBusy, setDiscoverBusy] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discoverResults, setDiscoverResults] = useState<DiscoveredUser[]>([]);
  const [discoverSelected, setDiscoverSelected] = useState<Set<string>>(new Set());
  const [discoverImportBusy, setDiscoverImportBusy] = useState(false);

  const openDiscoverModal = () => {
    // Pre-select the first active X credential, same default as batch-import.
    const firstX = credentials.find((c) => c.platform === 'x' && c.status === 'active');
    setDiscoverCredentialId(firstX?.id ?? '');
    setDiscoverQuery('');
    setDiscoverResults([]);
    setDiscoverSelected(new Set());
    setDiscoverError(null);
    setShowDiscover(true);
  };

  const runDiscover = async () => {
    if (!discoverQuery.trim()) { setDiscoverError('请输入关键词'); return; }
    if (!discoverCredentialId)  { setDiscoverError('请选择一个 X 凭证'); return; }
    setDiscoverBusy(true);
    setDiscoverError(null);
    try {
      const r = await fetch(`${API}/admin/sources/discover-users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'x',
          query: discoverQuery.trim(),
          credentialId: discoverCredentialId,
          limit: discoverLimit,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setDiscoverError(j.error ?? `HTTP ${r.status}`);
        setDiscoverResults([]);
      } else {
        setDiscoverResults(j.users ?? []);
        setDiscoverSelected(new Set());
      }
    } catch (e: any) {
      setDiscoverError(e?.message ?? String(e));
    } finally {
      setDiscoverBusy(false);
    }
  };

  const importDiscovered = async () => {
    if (discoverSelected.size === 0) return;
    setDiscoverImportBusy(true);
    try {
      const handles = [...discoverSelected];
      const r = await fetch(`${API}/admin/sources/batch-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'x',
          handles,
          credentialId: discoverCredentialId,
          triggerFetch: true,
          sharedConfig: { limit: 20, skipRetweets: true },
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setDiscoverError(j.error ?? `HTTP ${r.status}`);
      } else {
        // Mark imported screen_names in the result list so user sees progress
        // without closing the modal.
        setDiscoverResults((prev) => prev.map((u) =>
          discoverSelected.has(u.screen_name) ? { ...u, alreadyImported: true } : u
        ));
        const total = (j.created?.length ?? 0) + (j.updated?.length ?? 0);
        flash(`✓ 已导入 ${total} 个 X 信源,采集已入队`, true);
        setDiscoverSelected(new Set());
        // Refresh outer source list so the new rows appear under the modal.
        onAfterBatch();
      }
    } catch (e: any) {
      setDiscoverError(e?.message ?? String(e));
    } finally {
      setDiscoverImportBusy(false);
    }
  };

  // Default-fill cookie+UA from the most recent X source so the user doesn't
  // re-paste a 4KB cookie for every batch.
  const openBatchModal = () => {
    const lastX = sources.find(s => s.platform === 'x' && (s.config?.cookie as string));
    setBatchCookie((lastX?.config?.cookie as string) ?? '');
    setBatchUserAgent((lastX?.config?.userAgent as string) ?? '');
    setBatchHandles('');
    setBatchResult(null);
    setShowBatch(true);
  };

  const submitBatch = async () => {
    const handles = batchHandles
      .split(/[\n,，;\s]+/)
      .map(h => h.trim())
      .filter(Boolean);
    if (handles.length === 0) {
      flash('请粘贴至少一个 handle', false);
      return;
    }
    const sharedConfig: Record<string, unknown> = { limit: Number(batchLimit) || 20 };
    const usingCred = !!batchCredentialId;
    if (batchPlatform === 'x') {
      if (!usingCred && !batchCookie.trim()) { flash('X 需要 cookie 或选择一个凭证', false); return; }
      if (!usingCred) sharedConfig.cookie = batchCookie.trim();
      if (!usingCred && batchUserAgent.trim()) sharedConfig.userAgent = batchUserAgent.trim();
      sharedConfig.skipRetweets = batchSkipRetweets;
    }
    if (batchPlatform === 'reddit') {
      sharedConfig.sort = batchRedditSort;
      sharedConfig.time = batchRedditTime;
      if (batchUserAgent.trim()) sharedConfig.userAgent = batchUserAgent.trim();
    }
    setBatchBusy(true);
    try {
      const r = await fetch(`${API}/admin/sources/batch-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: batchPlatform,
          handles,
          sharedConfig,
          credentialId: batchCredentialId || undefined,
          triggerFetch: batchTriggerFetch,
        }),
      });
      if (!r.ok) {
        const txt = await r.text();
        flash(`导入失败：${txt.slice(0, 160)}`, false);
        return;
      }
      const d = await r.json();
      const failed = d.failed ?? [];
      setBatchResult({ created: d.created ?? [], updated: d.updated ?? [], failed });
      flash(`导入完成：新建 ${d.created?.length ?? 0} · 更新 ${d.updated?.length ?? 0} · 失败 ${failed.length}`);
      onAfterBatch();
      // Close the modal automatically on full success — the toast carries the
      // summary. Keep it open when anything failed so the user can see which
      // handles to fix.
      if (failed.length === 0) {
        setShowBatch(false);
        setBatchResult(null);
      }
    } catch (e: any) {
      flash(`导入异常：${e?.message ?? e}`, false);
    } finally {
      setBatchBusy(false);
    }
  };

  const [form, setForm] = useState({ name: '', url: '', platform: 'x', external_id: '', htmlUrls: '', perImage: false, useBrowser: false, extractAll: false, htmlMode: 'article' as 'article'|'per-image'|'crawl', crawlEntry: '', crawlMaxDepth: 2, crawlMaxPages: 30, crawlPattern: '', ksgIds: '', ksgBucket: '5', ksgHost: 'uib.2ksg.com', ksgToken: '', ksgReferer: 'https://uib.2ksg.com/app/', ksgCrawlList: false, ksgMaxIds: 30, knitUrls: '', knitCookie: '', knitUserAgent: '', redditSubs: '', redditSort: 'top' as 'hot'|'new'|'top'|'rising', redditTime: 'day' as 'hour'|'day'|'week'|'month'|'year'|'all', redditLimit: 25, redditUA: '', bskyMode: 'author' as 'author'|'search', bskyActor: '', bskyQuery: '', bskyLimit: 25, sitemapUrl: '', sitemapLimit: 200, sitemapPattern: '', xMode: 'user' as 'user'|'search', xScreenName: '', xQuery: '', xCookie: '', xUserAgent: '', xLimit: 20, htmlWaitFor: '', htmlExtraHeaders: '', htmlCookies: '', htmlLocale: '', htmlTimezone: '' });

  // Reliable sync: whenever editingSource changes (or list refresh swaps the
  // object identity), repopulate the form from the source's current values.
  useEffect(() => {
    if (!editingSource) return;
    const existingUrls = Array.isArray(editingSource.config?.urls)
      ? (editingSource.config!.urls as string[]).join('\n')
      : '';
    setForm({
      name: editingSource.name,
      url: (editingSource.config?.feed_url as string) ?? editingSource.url ?? '',
      platform: editingSource.platform,
      external_id: editingSource.external_id,
      htmlUrls: existingUrls,
      perImage: editingSource.config?.mode === 'per-image',
      useBrowser: editingSource.config?.render === 'browser',
      extractAll: editingSource.config?.extractAll === true,
      htmlMode: (editingSource.config?.mode === 'crawl' ? 'crawl'
                : editingSource.config?.mode === 'per-image' ? 'per-image'
                : 'article') as 'article'|'per-image'|'crawl',
      crawlEntry: (editingSource.config?.entry as string) ?? '',
      crawlMaxDepth: Number(editingSource.config?.maxDepth ?? 2),
      crawlMaxPages: Number(editingSource.config?.maxPages ?? 30),
      crawlPattern: (editingSource.config?.urlPattern as string) ?? '',
      ksgIds: Array.isArray(editingSource.config?.ids)
        ? (editingSource.config!.ids as string[]).join('\n')
        : '',
      ksgBucket: (editingSource.config?.bucket as string) ?? '5',
      ksgHost: (editingSource.config?.host as string) ?? 'uib.2ksg.com',
      ksgToken: (editingSource.config?.token as string) ?? '',
      ksgReferer: (editingSource.config?.referer as string) ?? 'https://uib.2ksg.com/app/',
      ksgCrawlList: editingSource.config?.crawlList === true,
      ksgMaxIds: Number(editingSource.config?.maxIds ?? 30),
      knitUrls: Array.isArray(editingSource.config?.urls) && editingSource.platform === 'knit'
        ? (editingSource.config!.urls as string[]).join('\n')
        : '',
      knitCookie: (editingSource.config?.cookie as string) ?? '',
      knitUserAgent: (editingSource.config?.userAgent as string) ?? '',
      redditSubs: Array.isArray(editingSource.config?.subreddits)
        ? (editingSource.config!.subreddits as string[]).join('\n')
        : '',
      redditSort: ((editingSource.config?.sort as string) ?? 'top') as 'hot'|'new'|'top'|'rising',
      redditTime: ((editingSource.config?.time as string) ?? 'day') as 'hour'|'day'|'week'|'month'|'year'|'all',
      redditLimit: Number(editingSource.config?.limit ?? 25),
      redditUA: (editingSource.config?.userAgent as string) ?? '',
      bskyMode: ((editingSource.config?.mode as string) ?? 'author') as 'author'|'search',
      bskyActor: (editingSource.config?.actor as string) ?? '',
      bskyQuery: (editingSource.config?.query as string) ?? '',
      bskyLimit: Number(editingSource.config?.limit ?? 25),
      sitemapUrl: (editingSource.config?.sitemapUrl as string) ?? '',
      sitemapLimit: Number(editingSource.config?.limit ?? 200),
      sitemapPattern: (editingSource.config?.pagePattern as string) ?? '',
      xMode: ((editingSource.config?.mode as string) ?? 'user') as 'user'|'search',
      xScreenName: (editingSource.config?.screenName as string) ?? '',
      xQuery: (editingSource.config?.query as string) ?? '',
      xCookie: (editingSource.config?.cookie as string) ?? '',
      xUserAgent: (editingSource.config?.userAgent as string) ?? '',
      xLimit: Number(editingSource.config?.limit ?? 20),
      htmlWaitFor: (editingSource.config?.waitForSelector as string) ?? '',
      htmlExtraHeaders: editingSource.config?.extraHeaders
        ? JSON.stringify(editingSource.config.extraHeaders, null, 2)
        : '',
      htmlCookies: Array.isArray(editingSource.config?.cookies)
        ? JSON.stringify(editingSource.config.cookies, null, 2)
        : '',
      htmlLocale: (editingSource.config?.locale as string) ?? '',
      htmlTimezone: (editingSource.config?.timezone as string) ?? '',
    });
  }, [editingSource?.id]);

  const startEdit = (src: Source) => {
    setEditingSource(src);
    setShowAddSource(false);
    // useEffect above will populate the form when editingSource updates.
  };

  const resetForm = () => {
    // Inherit site-level settings (token / host / bucket / referer) from the
    // most recent 2ksg source that has them set. Saves the user from having
    // to re-enter token every time they add a new gallery.
    const lastKsg = sources.find(s => s.platform === '2ksg' && (s.config?.token as string));
    const lastKnit = sources.find(s => s.platform === 'knit' && (s.config?.cookie as string));
    setForm({
      name: '', url: '', platform: 'x', external_id: '', htmlUrls: '',
      perImage: false, useBrowser: false, extractAll: false,
      htmlMode: 'article' as 'article'|'per-image'|'crawl',
      crawlEntry: '', crawlMaxDepth: 2, crawlMaxPages: 30, crawlPattern: '',
      ksgIds: '',
      ksgBucket: (lastKsg?.config?.bucket as string) ?? '5',
      ksgHost:   (lastKsg?.config?.host   as string) ?? 'uib.2ksg.com',
      ksgToken:  (lastKsg?.config?.token  as string) ?? '',
      ksgReferer:(lastKsg?.config?.referer as string) ?? 'https://uib.2ksg.com/app/',
      ksgCrawlList: false,
      ksgMaxIds: 30,
      knitUrls: '',
      knitCookie:    (lastKnit?.config?.cookie    as string) ?? '',
      knitUserAgent: (lastKnit?.config?.userAgent as string) ?? '',
      redditSubs: '',
      redditSort: 'top' as 'hot'|'new'|'top'|'rising',
      redditTime: 'day' as 'hour'|'day'|'week'|'month'|'year'|'all',
      redditLimit: 25,
      redditUA: '',
      bskyMode: 'author' as 'author'|'search',
      bskyActor: '',
      bskyQuery: '',
      bskyLimit: 25,
      sitemapUrl: '',
      sitemapLimit: 200,
      sitemapPattern: '',
      xMode: 'user' as 'user'|'search',
      xScreenName: '',
      xQuery: '',
      xCookie: (sources.find((s) => s.platform === 'x' && (s.config?.cookie as string))?.config?.cookie as string) ?? '',
      xUserAgent: (sources.find((s) => s.platform === 'x' && (s.config?.userAgent as string))?.config?.userAgent as string) ?? '',
      xLimit: 20,
      htmlWaitFor: '',
      htmlExtraHeaders: '',
      htmlCookies: '',
      htmlLocale: '',
      htmlTimezone: '',
    });
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: '#94a3b8' }}>
          共 <strong style={{ color: '#e2e8f0' }}>{sources.length}</strong> 个来源 ·&nbsp;
          <span style={{ color: '#22c55e' }}>活跃 {sources.filter(s => s.status === 'active').length}</span>
          &nbsp;/ <span style={{ color: '#475569' }}>停用 {sources.filter(s => s.status !== 'active').length}</span>
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Batch-delete button — mirrors the 批量导入博主 button (transparent
              bg + colored 1px border + matching text), swapped to red so the
              destructive action reads at-a-glance. Two states share the same
              shell: no-selection seeds the multi-select via toggleAll, then
              with selection the same slot becomes the actual delete trigger.
              The trash glyph is an inline SVG (not the 🗑 emoji) so it picks
              up the button's red `color` via stroke="currentColor" — emoji
              ignores CSS color and would render as a gray waste basket. */}
          {sources.length > 0 && selected.size === 0 && (
            <button
              onClick={toggleAll}
              title="全选当前列表，便于批量删除"
              style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #dc2626', background: 'transparent', color: '#fca5a5', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <TrashIcon /> 批量删除信源
            </button>
          )}
          {selected.size > 0 && (
            <button
              onClick={() => onBulkDelete(sources.filter((s) => selected.has(s.id)))}
              title={`批量删除选中的 ${selected.size} 个采集源`}
              style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #dc2626', background: 'transparent', color: '#fca5a5', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <TrashIcon /> 批量删除 ({selected.size})
            </button>
          )}
          <button
            onClick={openDiscoverModal}
            title="按关键词在 X 上搜账号(走 SearchTimeline·People),勾选后一键批量导入"
            style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #14532d', background: 'transparent', color: '#86efac', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            🔍 关键词找博主
          </button>
          <button
            onClick={openBatchModal}
            title="批量粘贴博主 handle（X / Bluesky），系统自动建源 + 抓取 + 分类"
            style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #6366f1', background: 'transparent', color: '#a5b4fc', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            ⚡ 批量导入博主
          </button>
          <button
            onClick={() => { resetForm(); setShowAddSource(true); setEditingSource(null); }}
            style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#6366f1', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            + 添加来源
          </button>
        </div>
      </div>

      {/* Keyword-discover modal — search X for accounts by keyword */}
      {showDiscover && (
        <div
          onClick={() => !discoverBusy && !discoverImportBusy && setShowDiscover(false)}
          style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#1e293b', border: '1px solid #14532d', borderRadius: 12, padding: 22, maxWidth: 760, width: '100%', maxHeight: '88vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#86efac' }}>🔍 关键词找博主</div>
              <button onClick={() => !discoverBusy && !discoverImportBusy && setShowDiscover(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>

            <div style={{ fontSize: 11.5, color: '#64748b', marginBottom: 14, lineHeight: 1.7 }}>
              用 X 的 SearchTimeline · People 接口按关键词搜账号，按粉丝数倒序。勾选后走和「批量导入博主」相同的链路建源 + 触发抓取。
            </div>

            {/* Query + credential + limit */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <input
                value={discoverQuery}
                onChange={(e) => setDiscoverQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runDiscover()}
                placeholder="关键词,如:美食 / AI / 摄影"
                disabled={discoverBusy}
                style={{ flex: 1, minWidth: 200, padding: '7px 12px', background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 6, fontSize: 13 }}
              />
              <select
                value={discoverCredentialId}
                onChange={(e) => setDiscoverCredentialId(e.target.value)}
                disabled={discoverBusy}
                style={{ padding: '7px 10px', background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 6, fontSize: 12, minWidth: 160 }}>
                <option value="">选择 X 凭证</option>
                {credentials.filter((c) => c.platform === 'x' && c.status === 'active').map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                max={50}
                value={discoverLimit}
                onChange={(e) => setDiscoverLimit(Math.min(50, Math.max(1, Number(e.target.value) || 30)))}
                disabled={discoverBusy}
                title="返回条数 1-50"
                style={{ width: 64, padding: '7px 10px', background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 6, fontSize: 13 }}
              />
              <button
                onClick={runDiscover}
                disabled={discoverBusy || !discoverQuery.trim() || !discoverCredentialId}
                style={{ padding: '7px 18px', background: discoverBusy ? '#334155' : '#14532d', color: '#86efac', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: discoverBusy ? 'wait' : 'pointer' }}>
                {discoverBusy ? '搜索中…' : '搜索'}
              </button>
            </div>

            {discoverError && (
              <div style={{ marginBottom: 10, padding: '8px 12px', background: '#450a0a', border: '1px solid #7f1d1d', color: '#fca5a5', borderRadius: 6, fontSize: 12 }}>
                {discoverError}
              </div>
            )}

            {/* Results list */}
            {discoverResults.length > 0 && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '12px 0 8px' }}>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>
                    找到 <strong style={{ color: '#86efac' }}>{discoverResults.length}</strong> 个账号 · 已选 <strong style={{ color: '#a5b4fc' }}>{discoverSelected.size}</strong>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => setDiscoverSelected(new Set(discoverResults.filter((u) => !u.alreadyImported).map((u) => u.screen_name)))}
                      style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontSize: 11, cursor: 'pointer' }}>
                      全选可导入
                    </button>
                    <button
                      onClick={() => setDiscoverSelected(new Set())}
                      style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontSize: 11, cursor: 'pointer' }}>
                      清除
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 380, overflowY: 'auto', marginBottom: 12 }}>
                  {discoverResults.map((u) => {
                    const checked = discoverSelected.has(u.screen_name);
                    const disabled = u.alreadyImported;
                    return (
                      <div
                        key={u.screen_name}
                        onClick={() => {
                          if (disabled) return;
                          setDiscoverSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(u.screen_name)) next.delete(u.screen_name);
                            else next.add(u.screen_name);
                            return next;
                          });
                        }}
                        style={{
                          display: 'flex', alignItems: 'flex-start', gap: 10,
                          padding: '8px 12px',
                          background: checked ? '#1e2a4d' : '#0f172a',
                          border: `1px solid ${checked ? '#6366f1' : '#1e293b'}`,
                          borderRadius: 8,
                          cursor: disabled ? 'not-allowed' : 'pointer',
                          opacity: disabled ? 0.5 : 1,
                        }}>
                        <input
                          type="checkbox"
                          readOnly
                          checked={checked}
                          disabled={disabled}
                          style={{ marginTop: 4, accentColor: '#6366f1', cursor: disabled ? 'not-allowed' : 'pointer' }}
                        />
                        {u.profile_image_url && (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={u.profile_image_url} alt="" loading="lazy"
                            style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, background: '#1e293b' }} />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{u.name || u.screen_name}</span>
                            <span style={{ fontSize: 11, color: '#64748b' }}>@{u.screen_name}</span>
                            {u.verified && <span style={{ fontSize: 10, padding: '0 6px', borderRadius: 8, background: '#1e3a8a', color: '#93c5fd' }}>verified</span>}
                            {disabled && <span style={{ fontSize: 10, padding: '0 6px', borderRadius: 8, background: '#1e293b', color: '#64748b' }}>已导入</span>}
                          </div>
                          {u.description && (
                            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                              {u.description}
                            </div>
                          )}
                          <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 3 }}>
                            {u.followers_count.toLocaleString()} followers
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid #334155', paddingTop: 12 }}>
                  <button
                    onClick={() => !discoverImportBusy && setShowDiscover(false)}
                    style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>
                    关闭
                  </button>
                  <button
                    onClick={importDiscovered}
                    disabled={discoverImportBusy || discoverSelected.size === 0}
                    style={{ padding: '7px 18px', borderRadius: 6, border: 'none', background: discoverSelected.size === 0 ? '#334155' : '#14532d', color: '#86efac', fontSize: 13, fontWeight: 700, cursor: discoverImportBusy ? 'wait' : discoverSelected.size === 0 ? 'not-allowed' : 'pointer' }}>
                    {discoverImportBusy ? '导入中…' : `导入选中 ${discoverSelected.size} 个`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Batch-import modal */}
      {showBatch && (
        <div
          onClick={() => !batchBusy && setShowBatch(false)}
          style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#1e293b', border: '1px solid #6366f1', borderRadius: 12, padding: 22, maxWidth: 640, width: '100%', maxHeight: '88vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#a5b4fc' }}>⚡ 批量导入博主</div>
              <button onClick={() => !batchBusy && setShowBatch(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>

            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14, lineHeight: 1.6 }}>
              粘贴一批 handle，系统会为每个建一条独立的采集源（共享下面的 cookie / 限制），
              并按 fanout 节奏自动抓取 + 走完分类→标题→封面→合规→发布全流程。
            </div>

            {/* Platform */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {(['x', 'bluesky', 'reddit'] as const).map(p => (
                <button key={p} onClick={() => setBatchPlatform(p)}
                  disabled={batchBusy}
                  style={{
                    flex: 1, padding: '7px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                    border: '1px solid', borderColor: batchPlatform === p ? '#6366f1' : '#334155',
                    background: batchPlatform === p ? '#312e81' : 'transparent',
                    color: batchPlatform === p ? '#c7d2fe' : '#64748b', cursor: 'pointer',
                  }}>
                  {p === 'x' ? 'X (Twitter)' : p === 'bluesky' ? 'Bluesky' : 'Reddit'}
                </button>
              ))}
            </div>

            {/* Credential picker — for X only (knit/bluesky can use it too in future). */}
            {(batchPlatform === 'x') && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>凭证池（推荐）</span>
                  {!showCreateCred && (
                    <button onClick={() => { setShowCreateCred(true); setNewCredName(''); setNewCredCookie(''); setNewCredUA(''); }}
                      disabled={batchBusy}
                      style={{ background: 'none', border: 'none', color: '#a5b4fc', fontSize: 11, cursor: 'pointer', padding: 0 }}>
                      + 新建凭证
                    </button>
                  )}
                </div>
                <select
                  value={batchCredentialId}
                  onChange={e => setBatchCredentialId(e.target.value)}
                  disabled={batchBusy || showCreateCred}
                  style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, colorScheme: 'dark' }}>
                  <option value="">— 不用凭证池（粘贴 cookie 到下方）—</option>
                  {credentials
                    .filter(c => c.platform === batchPlatform)
                    .map(c => {
                      const statusIcon = c.status === 'active' ? '✓' : c.status === 'expired' ? '⚠ expired' : '✗ revoked';
                      const refreshIcon = c.has_secret ? ' · 🔁 自动刷新' : '';
                      const sourceUse = c.source_count > 0 ? ` · ${c.source_count} 源` : '';
                      return (
                        <option key={c.id} value={c.id}>
                          {c.name} · {statusIcon}{refreshIcon}{sourceUse}
                        </option>
                      );
                    })}
                </select>
                {/* Selected-credential action row: show refresh button + status detail */}
                {batchCredentialId && (() => {
                  const c = credentials.find(x => x.id === batchCredentialId);
                  if (!c) return null;
                  const lastRefresh = c.secret_last_refresh_at ? new Date(c.secret_last_refresh_at).toLocaleString('zh-CN') : '—';
                  const failedSinceLast = (c.secret_consecutive_failures ?? 0) > 0;
                  return (
                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: '#64748b' }}>
                      {c.has_secret ? (
                        <>
                          <span>账号 <strong style={{ color: '#cbd5e1' }}>{c.secret_username}</strong></span>
                          <span>· 上次刷新 {lastRefresh}</span>
                          {failedSinceLast && (
                            <span style={{ color: '#f87171' }} title={c.secret_last_refresh_error ?? undefined}>
                              · 连续失败 {c.secret_consecutive_failures} 次
                            </span>
                          )}
                          <button
                            onClick={() => refreshCredential(batchCredentialId)}
                            disabled={refreshingCredId === batchCredentialId || batchBusy}
                            title="用账号密码 stealth 登录刷一次 cookie（约 15-30 秒）"
                            style={{ marginLeft: 'auto', padding: '3px 10px', borderRadius: 5, border: '1px solid #334155', background: refreshingCredId === batchCredentialId ? '#1e293b' : 'transparent', color: refreshingCredId === batchCredentialId ? '#475569' : '#a5b4fc', fontSize: 11, cursor: refreshingCredId === batchCredentialId ? 'not-allowed' : 'pointer' }}>
                            {refreshingCredId === batchCredentialId ? '刷新中…' : '🔁 立即刷新'}
                          </button>
                        </>
                      ) : (
                        <span style={{ color: '#64748b' }}>
                          未配置自动刷新 · 当 cookie 过期时需要手动重新粘贴
                        </span>
                      )}
                    </div>
                  );
                })()}
                {showCreateCred && (
                  <div style={{ marginTop: 8, padding: 10, background: '#0f172a', border: '1px dashed #334155', borderRadius: 6 }}>
                    <div style={{ fontSize: 11, color: '#a5b4fc', fontWeight: 600, marginBottom: 6 }}>新建凭证</div>
                    <input
                      value={newCredName}
                      onChange={e => setNewCredName(e.target.value)}
                      placeholder="凭证名（如 main-x-account-2026-04）"
                      disabled={credBusy}
                      style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, marginBottom: 6 }} />
                    <textarea
                      value={newCredCookie}
                      onChange={e => setNewCredCookie(e.target.value)}
                      rows={3}
                      placeholder="auth_token=…; ct0=…; …"
                      disabled={credBusy}
                      style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'ui-monospace, monospace', resize: 'vertical', marginBottom: 6 }} />
                    <input
                      value={newCredUA}
                      onChange={e => setNewCredUA(e.target.value)}
                      placeholder="User-Agent（可选）"
                      disabled={credBusy}
                      style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'ui-monospace, monospace', marginBottom: 8 }} />

                    {/* Optional auto-refresh secret */}
                    {batchPlatform === 'x' && (
                      <details style={{ marginBottom: 8 }}>
                        <summary style={{ fontSize: 11, color: '#a5b4fc', cursor: 'pointer', marginBottom: 6 }}>
                          🔁 配置自动刷新（X 用户名 + 密码，加密存储）
                        </summary>
                        <div style={{ marginTop: 6, padding: '8px 10px', background: '#1e293b', borderRadius: 5, border: '1px solid #312e81' }}>
                          <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6, lineHeight: 1.5 }}>
                            填了之后，cookie 过期时系统会自动用账号密码重新登录刷新。
                            遇到 Arkose / 2FA / 邮件验证码时刷新失败，仍需人工处理。
                            密码用 AES-256-GCM 加密后入库，不会以明文返回。
                          </div>
                          <input
                            value={newCredXUser}
                            onChange={e => setNewCredXUser(e.target.value)}
                            placeholder="X 用户名 / 邮箱 / 手机号"
                            disabled={credBusy}
                            autoComplete="off"
                            style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, marginBottom: 6 }} />
                          <input
                            type="password"
                            value={newCredXPass}
                            onChange={e => setNewCredXPass(e.target.value)}
                            placeholder="X 密码"
                            disabled={credBusy}
                            autoComplete="new-password"
                            style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }} />
                        </div>
                      </details>
                    )}

                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button onClick={() => setShowCreateCred(false)} disabled={credBusy}
                        style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontSize: 11, cursor: 'pointer' }}>
                        取消
                      </button>
                      <button
                        disabled={credBusy || !newCredName.trim() || !newCredCookie.trim()}
                        onClick={async () => {
                          setCredBusy(true);
                          try {
                            const r = await fetch(`${API}/admin/credentials`, {
                              method: 'POST', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                platform: batchPlatform,
                                name: newCredName.trim(),
                                cookie: newCredCookie.trim(),
                                user_agent: newCredUA.trim() || null,
                              }),
                            });
                            if (!r.ok) {
                              const txt = await r.text();
                              flash(`创建失败：${txt.slice(0, 160)}`, false);
                              return;
                            }
                            const d = await r.json();
                            // If user filled the auto-refresh secret, attach it
                            if (newCredXUser.trim() && newCredXPass.trim()) {
                              const sr = await fetch(`${API}/admin/credentials/${d.credential.id}/secret`, {
                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ username: newCredXUser.trim(), password: newCredXPass }),
                              });
                              if (!sr.ok) {
                                const txt = await sr.text();
                                flash(`凭证已建，但保存账密失败：${txt.slice(0, 120)}`, false);
                              }
                            }
                            await reloadCredentials();
                            setBatchCredentialId(d.credential.id);
                            setShowCreateCred(false);
                            // Clear the password from memory ASAP
                            setNewCredXPass('');
                            flash(`已新建凭证 "${d.credential.name}"`);
                          } finally { setCredBusy(false); }
                        }}
                        style={{ padding: '4px 12px', borderRadius: 5, border: 'none', background: credBusy ? '#1e293b' : '#6366f1', color: credBusy ? '#475569' : '#fff', fontSize: 11, fontWeight: 600, cursor: credBusy ? 'not-allowed' : 'pointer' }}>
                        {credBusy ? '保存中…' : '保存凭证'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Cookie & UA — only for X, and only when no credential picked */}
            {batchPlatform === 'x' && !batchCredentialId && (
              <>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>共享 Cookie（须含 auth_token + ct0）</span>
                  <textarea
                    value={batchCookie}
                    onChange={e => setBatchCookie(e.target.value)}
                    rows={3}
                    placeholder="auth_token=…; ct0=…; …"
                    disabled={batchBusy}
                    style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'ui-monospace, monospace', resize: 'vertical' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>User-Agent（可选，与 cookie 抓取的浏览器一致）</span>
                  <input
                    value={batchUserAgent}
                    onChange={e => setBatchUserAgent(e.target.value)}
                    placeholder="Mozilla/5.0 (Macintosh; …) Chrome/147.0.0.0"
                    disabled={batchBusy}
                    style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'ui-monospace, monospace' }} />
                </label>
              </>
            )}

            {/* Reddit-specific knobs */}
            {batchPlatform === 'reddit' && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>排序</span>
                  <select
                    value={batchRedditSort}
                    onChange={e => setBatchRedditSort(e.target.value as any)}
                    disabled={batchBusy}
                    style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, colorScheme: 'dark' }}>
                    <option value="top">top</option>
                    <option value="hot">hot</option>
                    <option value="new">new</option>
                    <option value="rising">rising</option>
                  </select>
                </label>
                <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>时间窗（仅 sort=top）</span>
                  <select
                    value={batchRedditTime}
                    onChange={e => setBatchRedditTime(e.target.value as any)}
                    disabled={batchBusy || batchRedditSort !== 'top'}
                    style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, colorScheme: 'dark' }}>
                    <option value="hour">hour</option>
                    <option value="day">day</option>
                    <option value="week">week</option>
                    <option value="month">month</option>
                    <option value="year">year</option>
                    <option value="all">all</option>
                  </select>
                </label>
                <label style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>User-Agent（可选）</span>
                  <input
                    value={batchUserAgent}
                    onChange={e => setBatchUserAgent(e.target.value)}
                    placeholder="ch-agents/0.1 (+content-pipeline)"
                    disabled={batchBusy}
                    style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'ui-monospace, monospace' }} />
                </label>
              </div>
            )}

            {/* Handles */}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>
                {batchPlatform === 'x'
                  ? '博主 handle 列表（每行一个，自动去 @ / 去重）'
                  : batchPlatform === 'reddit'
                    ? 'subreddit 列表（每行一个，自动去 r/ 前缀 / 去重）'
                    : 'actor handle 列表（每行一个）'}
              </span>
              <textarea
                value={batchHandles}
                onChange={e => setBatchHandles(e.target.value)}
                rows={8}
                placeholder={
                  batchPlatform === 'x'
                    ? 'natgeo\n@elonmusk\nphotoblog123\n…\n（最多 500 个）'
                    : batchPlatform === 'reddit'
                      ? 'EarthPorn\nr/photographs\n/r/itookapicture\n…'
                      : 'pfrazee.com\nbsky.app\n…'
                }
                disabled={batchBusy}
                style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'ui-monospace, monospace', resize: 'vertical', lineHeight: 1.5 }} />
            </label>

            {/* Knobs */}
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8' }}>
                <span>每次抓取</span>
                <input
                  type="number" min={1} max={100}
                  value={batchLimit}
                  onChange={e => setBatchLimit(Math.max(1, Math.min(100, Number(e.target.value) || 20)))}
                  disabled={batchBusy}
                  style={{ width: 70, background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '4px 8px', color: '#e2e8f0', fontSize: 12 }} />
                <span style={{ color: '#475569' }}>条/源</span>
              </label>
              {batchPlatform === 'x' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8', cursor: 'pointer' }}>
                  <input type="checkbox" checked={batchSkipRetweets} onChange={e => setBatchSkipRetweets(e.target.checked)} disabled={batchBusy} />
                  跳过转推（避免重复入库）
                </label>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8', cursor: 'pointer' }}>
                <input type="checkbox" checked={batchTriggerFetch} onChange={e => setBatchTriggerFetch(e.target.checked)} disabled={batchBusy} />
                立即触发首次采集
              </label>
            </div>

            {/* Result */}
            {batchResult && (
              <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 12 }}>
                <div style={{ marginBottom: 6 }}>
                  <span style={{ color: '#22c55e', fontWeight: 700 }}>✓ 新建 {batchResult.created.length}</span>
                  <span style={{ color: '#475569', margin: '0 8px' }}>·</span>
                  <span style={{ color: '#60a5fa', fontWeight: 700 }}>↻ 更新 {batchResult.updated.length}</span>
                  <span style={{ color: '#475569', margin: '0 8px' }}>·</span>
                  <span style={{ color: batchResult.failed.length > 0 ? '#f87171' : '#475569', fontWeight: 700 }}>✗ 失败 {batchResult.failed.length}</span>
                </div>
                {batchResult.failed.length > 0 && (
                  <details style={{ marginTop: 6 }}>
                    <summary style={{ cursor: 'pointer', color: '#f87171', fontSize: 11 }}>展开失败详情 ({batchResult.failed.length})</summary>
                    <div style={{ marginTop: 6, maxHeight: 160, overflowY: 'auto', fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#fca5a5' }}>
                      {batchResult.failed.map((f, i) => (
                        <div key={i} style={{ padding: '2px 0' }}>
                          <strong>{f.handle}</strong>: {f.reason}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => !batchBusy && setShowBatch(false)} disabled={batchBusy}
                style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontSize: 12, cursor: batchBusy ? 'not-allowed' : 'pointer' }}>
                {batchResult ? '关闭' : '取消'}
              </button>
              <button onClick={submitBatch} disabled={batchBusy}
                style={{ padding: '7px 16px', borderRadius: 6, border: 'none', background: batchBusy ? '#1e293b' : '#6366f1', color: batchBusy ? '#475569' : '#fff', fontSize: 12, fontWeight: 700, cursor: batchBusy ? 'not-allowed' : 'pointer' }}>
                {batchBusy ? '导入中…' : (batchResult ? '再导一批' : '⚡ 开始导入')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit form — modal overlay */}
      {(showAddSource || editingSource) && (
        <div
          onClick={() => { setEditingSource(null); setShowAddSource(false); }}
          style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 9000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, overflowY: 'auto' }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#1e293b', border: '1px solid #6366f1', borderRadius: 10, padding: 16, width: '100%', maxWidth: 880, maxHeight: 'calc(100vh - 48px)', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#a5b4fc' }}>
              {editingSource ? `编辑：${editingSource.name}` : '新增采集源'}
            </div>
            <button
              onClick={() => { setEditingSource(null); setShowAddSource(false); }}
              style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
              aria-label="关闭">✕</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>名称</span>
              <input
                value={form.name}
                onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="BBC History Extra"
                style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>Platform</span>
              <select
                value={form.platform}
                onChange={e => setForm(prev => ({ ...prev, platform: e.target.value }))}
                style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}>
                {/* Only X is exposed for new sources right now. Other platforms
                    stay editable for existing rows so we can see/edit them. */}
                <option value="x">x — Twitter cookie 注入</option>
                {editingSource && editingSource.platform !== 'x' && (
                  <option value={editingSource.platform}>{editingSource.platform}（已有源，只读）</option>
                )}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>ID (slug)</span>
              <input
                value={form.external_id}
                onChange={e => setForm(prev => ({ ...prev, external_id: e.target.value }))}
                placeholder="bbc-history-extra"
                style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}
              />
            </label>
            {form.platform === 'rss' ? (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>Feed URL</span>
                <input
                  value={form.url}
                  onChange={e => setForm(prev => ({ ...prev, url: e.target.value }))}
                  placeholder="https://example.com/feed/"
                  style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}
                />
              </label>
            ) : (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>站点主页（可选，仅用于显示）</span>
                <input
                  value={form.url}
                  onChange={e => setForm(prev => ({ ...prev, url: e.target.value }))}
                  placeholder="https://example.com"
                  style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}
                />
              </label>
            )}
          </div>

          {/* 2ksg JSON API 配置 */}
          {form.platform === '2ksg' && (
            <div style={{ marginTop: 10, padding: '10px 12px', background: '#0f172a', border: '1px solid #ec4899', borderRadius: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#ec4899', marginBottom: 8 }}>
                🎀 2ksg / aizuyun JSON API 模式 — 直连图册接口，绕过 SPA 反爬
              </div>
              {(() => {
                const parsed = form.ksgIds.split('\n').map(parseKsgLine);
                const validIds = parsed.filter(p => p.id);
                const invalid = form.ksgIds.split('\n').filter(s => s.trim()).length - validIds.length;
                return (
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                    <span style={{ fontSize: 11, color: '#64748b' }}>
                      图册 URL 或 ID 列表（每行一个，可直接粘贴 detail 页地址）
                    </span>
                    <textarea
                      value={form.ksgIds}
                      onChange={e => {
                        const v = e.target.value;
                        const lines = v.split('\n').map(parseKsgLine);
                        const newHost = lines.find(p => p.host)?.host;
                        const newBucket = lines.find(p => p.tid)?.tid?.[0];
                        setForm(prev => ({
                          ...prev,
                          ksgIds: v,
                          ...(newHost ? { ksgHost: newHost } : {}),
                          ...(newBucket ? { ksgBucket: newBucket } : {}),
                        }));
                      }}
                      placeholder={'45499\nhttps://uib.2ksg.com/app/#/detail?mode=img&tid=591&sid=&id=78902'}
                      rows={4}
                      style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace', lineHeight: 1.6, resize: 'vertical' }}
                    />
                    <div style={{ fontSize: 10, color: validIds.length ? '#22c55e' : '#64748b', marginTop: 2 }}>
                      ✓ 已识别 <strong>{validIds.length}</strong> 个 ID
                      {invalid > 0 && <span style={{ color: '#f87171', marginLeft: 8 }}>· {invalid} 行无法解析</span>}
                    </div>
                  </label>
                );
              })()}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>Host</span>
                  <input
                    value={form.ksgHost}
                    onChange={e => setForm(prev => ({ ...prev, ksgHost: e.target.value }))}
                    placeholder="uib.2ksg.com"
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>
                    Bucket 种子（找不到会自动探测 0-9）
                  </span>
                  <input
                    value={form.ksgBucket}
                    onChange={e => setForm(prev => ({ ...prev, ksgBucket: e.target.value }))}
                    placeholder="5"
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}
                  />
                </label>
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  token 头（从 DevTools 复制）
                  {!form.ksgToken && <span style={{ color: '#f87171', marginLeft: 6 }}>· 必填,空则采集会失败</span>}
                </span>
                <input
                  value={form.ksgToken}
                  onChange={e => setForm(prev => ({ ...prev, ksgToken: e.target.value }))}
                  placeholder="6208330590a87f"
                  style={{
                    background: '#020617',
                    border: `1px solid ${form.ksgToken ? '#334155' : '#7f1d1d'}`,
                    borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace',
                  }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>Referer</span>
                <input
                  value={form.ksgReferer}
                  onChange={e => setForm(prev => ({ ...prev, ksgReferer: e.target.value }))}
                  placeholder="https://uib.2ksg.com/app/"
                  style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontSize: 12, color: '#cbd5e1', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.ksgCrawlList}
                  onChange={e => setForm(prev => ({ ...prev, ksgCrawlList: e.target.checked }))}
                  style={{ accentColor: '#ec4899' }}
                />
                <span>同时跟进 data.list[] 里的相关图册（最多 <input type="number" value={form.ksgMaxIds} min={1} max={200} onChange={e => setForm(prev => ({ ...prev, ksgMaxIds: Number(e.target.value) }))} style={{ width: 50, background: '#020617', border: '1px solid #334155', borderRadius: 4, padding: '2px 6px', color: '#e2e8f0', fontSize: 12 }} /> 个）</span>
              </label>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 8 }}>
                每个 ID 拉一次 detail.json → 解码 → 抽出图册全部图片。比 SPA 渲染快 10x，稳定 100x。
              </div>
            </div>
          )}

          {/* knit 配置 */}
          {form.platform === 'knit' && (
            <div style={{ marginTop: 10, padding: '10px 12px', background: '#0f172a', border: '1px solid #f59e0b', borderRadius: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#f59e0b', marginBottom: 8 }}>
                ☁️ knit / Cloudflare 模式 — 借浏览器 cookie 绕过 CF + 自动补全 1..N 张
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  文章 URL 列表（每行一个，如 https://xx.knit.bid/article/30689/）
                </span>
                <textarea
                  value={form.knitUrls}
                  onChange={e => setForm(prev => ({ ...prev, knitUrls: e.target.value }))}
                  placeholder={'https://xx.knit.bid/article/30689/\nhttps://xx.knit.bid/article/30690/'}
                  rows={4}
                  style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace', lineHeight: 1.6, resize: 'vertical' }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  Cookie（DevTools → Network → 主请求 → Request Headers → Cookie 整行）
                  {!form.knitCookie && <span style={{ color: '#f87171', marginLeft: 6 }}>· 必填</span>}
                </span>
                <textarea
                  value={form.knitCookie}
                  onChange={e => setForm(prev => ({ ...prev, knitCookie: e.target.value }))}
                  placeholder="cf_clearance=...; user_segment=anon; ..."
                  rows={3}
                  style={{
                    background: '#020617',
                    border: `1px solid ${form.knitCookie ? '#334155' : '#7f1d1d'}`,
                    borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all', resize: 'vertical',
                  }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  User-Agent（必须和 cookie 配对，CF 会校验）
                </span>
                <input
                  value={form.knitUserAgent}
                  onChange={e => setForm(prev => ({ ...prev, knitUserAgent: e.target.value }))}
                  placeholder="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ..."
                  style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace' }}
                />
              </label>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 4, lineHeight: 1.6 }}>
                cookie 里 cf_clearance 通常 30 分钟到几小时过期；过期后采集会失败，重抓一次 Cookie 刷新即可。
                自动从 HTML 第一张图推断 URL 模板，从标题里 "<strong>NN P</strong>" 推断总数，生成 1..N 全部 URL。
              </div>
            </div>
          )}

          {/* reddit 配置 */}
          {form.platform === 'reddit' && (
            <div style={{ marginTop: 10, padding: '10px 12px', background: '#0f172a', border: '1px solid #f97316', borderRadius: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#f97316', marginBottom: 8 }}>
                🦊 Reddit 公开 JSON API · 无需 OAuth
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  Subreddit 列表（每行一个，可带或不带 r/）
                </span>
                <textarea
                  value={form.redditSubs}
                  onChange={e => setForm(prev => ({ ...prev, redditSubs: e.target.value }))}
                  placeholder={'EarthPorn\nphotographs\ncosplay'}
                  rows={3}
                  style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace', lineHeight: 1.6, resize: 'vertical' }}
                />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>排序</span>
                  <select value={form.redditSort} onChange={e => setForm(prev => ({ ...prev, redditSort: e.target.value as any }))}
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}>
                    <option value="hot">hot</option>
                    <option value="new">new</option>
                    <option value="top">top</option>
                    <option value="rising">rising</option>
                  </select>
                </label>
                {(form.redditSort === 'top') && (
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 11, color: '#64748b' }}>时间范围</span>
                    <select value={form.redditTime} onChange={e => setForm(prev => ({ ...prev, redditTime: e.target.value as any }))}
                      style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}>
                      <option value="hour">hour</option>
                      <option value="day">day</option>
                      <option value="week">week</option>
                      <option value="month">month</option>
                      <option value="year">year</option>
                      <option value="all">all</option>
                    </select>
                  </label>
                )}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>每个 sub 限数 (1-100)</span>
                  <input type="number" min={1} max={100} value={form.redditLimit}
                    onChange={e => setForm(prev => ({ ...prev, redditLimit: Number(e.target.value) }))}
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }} />
                </label>
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>User-Agent（Reddit 强制要求,留空用默认。机房 IP 容易被屏蔽）</span>
                <input value={form.redditUA} onChange={e => setForm(prev => ({ ...prev, redditUA: e.target.value }))}
                  placeholder="ch-agents/0.1 (by /u/yourname)"
                  style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace' }} />
              </label>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 6, lineHeight: 1.6 }}>
                注:Reddit 2024 后大量屏蔽机房 IP,从家庭 IP 跑通常没问题。被屏蔽时会触发 authFail 红条提示。
              </div>
            </div>
          )}

          {/* bluesky 配置 */}
          {form.platform === 'bluesky' && (
            <div style={{ marginTop: 10, padding: '10px 12px', background: '#0f172a', border: '1px solid #38bdf8', borderRadius: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#38bdf8', marginBottom: 8 }}>
                🦋 Bluesky · AT Protocol 公开 API
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>采集模式</span>
                <select value={form.bskyMode} onChange={e => setForm(prev => ({ ...prev, bskyMode: e.target.value as any }))}
                  style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}>
                  <option value="author">author — 拉取指定用户的发文</option>
                  <option value="search">search — 关键词/话题搜索</option>
                </select>
              </label>
              {form.bskyMode === 'author' ? (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>Handle (e.g. pfrazee.com / natgeo.com)</span>
                  <input value={form.bskyActor} onChange={e => setForm(prev => ({ ...prev, bskyActor: e.target.value }))}
                    placeholder="pfrazee.com"
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace' }} />
                </label>
              ) : (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>搜索词或 #hashtag</span>
                  <input value={form.bskyQuery} onChange={e => setForm(prev => ({ ...prev, bskyQuery: e.target.value }))}
                    placeholder="#photography"
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }} />
                </label>
              )}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>每次拉取数量 (1-100)</span>
                <input type="number" min={1} max={100} value={form.bskyLimit}
                  onChange={e => setForm(prev => ({ ...prev, bskyLimit: Number(e.target.value) }))}
                  style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }} />
              </label>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 6, lineHeight: 1.6 }}>
                public.api.bsky.app 完全免费无需 token。author 模式稳定;search 模式可能被防爬限流。
              </div>
            </div>
          )}

          {/* sitemap-images 配置 */}
          {form.platform === 'sitemap-images' && (
            <div style={{ marginTop: 10, padding: '10px 12px', background: '#0f172a', border: '1px solid #84cc16', borderRadius: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#84cc16', marginBottom: 8 }}>
                🗺️ 站点地图 · 解析 &lt;image:image&gt; 扩展
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>Sitemap URL</span>
                <input value={form.sitemapUrl} onChange={e => setForm(prev => ({ ...prev, sitemapUrl: e.target.value }))}
                  placeholder="https://example.com/sitemap-image.xml"
                  style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace' }} />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8, marginBottom: 4 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>最大图数 (1-5000)</span>
                  <input type="number" min={1} max={5000} value={form.sitemapLimit}
                    onChange={e => setForm(prev => ({ ...prev, sitemapLimit: Number(e.target.value) }))}
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>页面 URL 正则 (可选,只跟进匹配的页面)</span>
                  <input value={form.sitemapPattern} onChange={e => setForm(prev => ({ ...prev, sitemapPattern: e.target.value }))}
                    placeholder="/blog/|/article/"
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace' }} />
                </label>
              </div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 6, lineHeight: 1.6 }}>
                自动识别 sitemap-index(含子 sitemap 列表)并递归。
                每张图独立成 1 个 raw_item。
              </div>
            </div>
          )}

          {/* X (Twitter) 配置 */}
          {form.platform === 'x' && (() => {
            // If this source is bound to the credential pool, cookie/UA live on
            // the credential — not on the source row. Without this banner the
            // empty cookie textarea + red "必填" warning makes users think the
            // batch import "didn't add cookie", when in fact it's working as
            // designed (resolveAuth reads cookie from credentials table at
            // runtime).
            const boundCred = editingSource?.credential_id
              ? credentials.find(c => c.id === editingSource.credential_id)
              : null;
            return (
            <div style={{ marginTop: 10, padding: '10px 12px', background: '#0f172a', border: '1px solid #71717a', borderRadius: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#e4e4e7', marginBottom: 8 }}>
                𝕏 X (Twitter) · Cookie 注入(GraphQL 回放)
              </div>
              {boundCred && (
                <div style={{ marginBottom: 10, padding: '8px 12px', background: '#312e81', border: '1px solid #6366f1', borderRadius: 5, fontSize: 11, color: '#c7d2fe', lineHeight: 1.6 }}>
                  <div style={{ fontWeight: 700, marginBottom: 3 }}>
                    🔑 已绑定凭证池中的 <span style={{ color: '#fff' }}>{boundCred.name}</span>
                    <span style={{ marginLeft: 6, opacity: 0.7 }}>
                      (状态:{boundCred.status} · cookie {boundCred.cookie_len} 字符
                      {boundCred.user_agent ? ` · UA ${String(boundCred.user_agent).slice(0, 40)}…` : ' · 无 UA'})
                    </span>
                  </div>
                  <div style={{ opacity: 0.85 }}>
                    cookie / User-Agent 由凭证池统一管理,不需要在这里再贴一遍。运行时 X 适配器会从 credentials 表里读。要换 cookie 请去 工作台 → 凭证池 → {boundCred.name} → 编辑。
                  </div>
                </div>
              )}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>采集模式</span>
                <select
                  value={form.xMode === 'user' && form.xLimit === 20 ? 'user-20' : form.xMode}
                  onChange={e => {
                    const v = e.target.value;
                    if (v === 'user-20') {
                      // Preset: user mode + force latest 20.
                      setForm(prev => ({ ...prev, xMode: 'user', xLimit: 20 }));
                    } else {
                      setForm(prev => ({ ...prev, xMode: v as 'user' | 'search' }));
                    }
                  }}
                  style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}>
                  <option value="user">user — 拉取指定账号最近发文</option>
                  <option value="user-20">user — 拉取最近的 20 条</option>
                  <option value="search">search — 关键词搜索 Latest</option>
                </select>
              </label>
              {form.xMode === 'user' ? (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>账号 handle (不带 @)</span>
                  <input value={form.xScreenName} onChange={e => setForm(prev => ({ ...prev, xScreenName: e.target.value }))}
                    placeholder="natgeo"
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace' }} />
                </label>
              ) : (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>搜索词或 #hashtag</span>
                  <input value={form.xQuery} onChange={e => setForm(prev => ({ ...prev, xQuery: e.target.value }))}
                    placeholder="#aurora min_faves:10"
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }} />
                </label>
              )}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  Cookie{boundCred ? '(凭证池模式留空即可)' : '(必须含 auth_token 和 ct0)'}
                  {!boundCred && <span style={{ color: '#f87171', marginLeft: 6, fontWeight: 600 }}>· 必填</span>}
                </span>
                <textarea value={form.xCookie}
                  onChange={e => setForm(prev => ({ ...prev, xCookie: e.target.value }))}
                  placeholder={boundCred ? '— 由凭证池接管,留空 —' : 'auth_token=...; ct0=...; guest_id=...'}
                  rows={3}
                  style={{
                    background: '#020617',
                    border: `1px solid ${(form.xCookie || boundCred) ? '#334155' : '#7f1d1d'}`,
                    borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all', resize: 'vertical',
                    opacity: boundCred ? 0.55 : 1,
                  }}
                />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>
                    User-Agent {boundCred ? '(凭证池接管)' : '(建议跟你浏览器一致)'}
                    {!boundCred && <span style={{ color: '#f87171', marginLeft: 6, fontWeight: 600 }}>· 必填</span>}
                  </span>
                  <input value={form.xUserAgent} onChange={e => setForm(prev => ({ ...prev, xUserAgent: e.target.value }))}
                    placeholder={boundCred ? '— 由凭证池接管,留空 —' : 'Mozilla/5.0 ... Chrome/147.0 ...'}
                    style={{
                      background: '#020617',
                      border: `1px solid ${(form.xUserAgent || boundCred) ? '#334155' : '#7f1d1d'}`,
                      borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace',
                      opacity: boundCred ? 0.55 : 1,
                    }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>拉取最近多少条 (1-100)</span>
                  <input type="number" min={1} max={100} value={form.xLimit}
                    onChange={e => setForm(prev => ({ ...prev, xLimit: Number(e.target.value) }))}
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }} />
                </label>
              </div>
              {/* Quick presets: 10 / 20 / 40 / 80 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 11, color: '#64748b' }}>
                <span>快选:</span>
                {[10, 20, 40, 80].map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setForm(prev => ({ ...prev, xLimit: n }))}
                    style={{
                      padding: '2px 10px', borderRadius: 4,
                      border: `1px solid ${form.xLimit === n ? '#71717a' : '#334155'}`,
                      background: form.xLimit === n ? '#27272a' : 'transparent',
                      color: form.xLimit === n ? '#e4e4e7' : '#94a3b8',
                      fontSize: 11, cursor: 'pointer', fontWeight: form.xLimit === n ? 600 : 400,
                    }}>
                    {n}
                  </button>
                ))}
                <span style={{ marginLeft: 'auto', fontSize: 10, color: '#475569' }}>
                  (X 单次最多 ~40 条;含图比例约 5-30%,实际入库会少于 N)
                </span>
              </div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 6, lineHeight: 1.6 }}>
                Cookie 用 <code>document.cookie</code> 在 <code>x.com</code> 控制台复制。auth_token 通常 30+ 天有效;X 改 GraphQL 时需要更新 opIds。
              </div>
            </div>
            );
          })()}

          {/* HTML 模式三选一 */}
          {form.platform === 'html' && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>采集模式</span>
              <select
                value={form.htmlMode}
                onChange={e => setForm(prev => ({ ...prev, htmlMode: e.target.value as any }))}
                style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}>
                <option value="article">article — 每个 URL = 1 篇文章</option>
                <option value="per-image">per-image — 每张图独立成一个 item</option>
                <option value="crawl">crawl — 入口递归爬取（同域名）</option>
              </select>
            </label>
          )}

          {/* article / per-image：URL 列表 */}
          {form.platform === 'html' && form.htmlMode !== 'crawl' && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>
                文章 URL 列表（每行一个，共 {form.htmlUrls.split('\n').filter(s => s.trim()).length} 条）
              </span>
              <textarea
                value={form.htmlUrls}
                onChange={e => setForm(prev => ({ ...prev, htmlUrls: e.target.value }))}
                placeholder={'https://example.com/article/1\nhttps://example.com/article/2'}
                rows={5}
                style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'SF Mono, Menlo, monospace', lineHeight: 1.6, resize: 'vertical' }}
              />
            </label>
          )}

          {/* crawl 模式：入口 + 深度 + 页数 + 正则 */}
          {form.platform === 'html' && form.htmlMode === 'crawl' && (
            <div style={{ marginTop: 10, padding: '10px 12px', background: '#0f172a', border: '1px solid #f97316', borderRadius: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#f97316', marginBottom: 8 }}>
                🕷 爬虫模式 — 从入口页 BFS 同域链接，按 per-image 抽图
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>入口 URL</span>
                <input
                  value={form.crawlEntry}
                  onChange={e => setForm(prev => ({ ...prev, crawlEntry: e.target.value }))}
                  placeholder="https://www.smithsonianmag.com/history/"
                  style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}
                />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>最大深度（0-5）</span>
                  <input
                    type="number" min={0} max={5}
                    value={form.crawlMaxDepth}
                    onChange={e => setForm(prev => ({ ...prev, crawlMaxDepth: Number(e.target.value) }))}
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>最多页数（1-80）</span>
                  <input
                    type="number" min={1} max={80}
                    value={form.crawlMaxPages}
                    onChange={e => setForm(prev => ({ ...prev, crawlMaxPages: Number(e.target.value) }))}
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }}
                  />
                </label>
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>URL 正则（可选，只跟进匹配的链接）</span>
                <input
                  value={form.crawlPattern}
                  onChange={e => setForm(prev => ({ ...prev, crawlPattern: e.target.value }))}
                  placeholder="/history/[^/]+-\\d+/$"
                  style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace' }}
                />
              </label>
              <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 8 }}>
                注意：仅同域名爬取。开 JS 渲染后每页 5-8s，30 页 ≈ 3-4 分钟。
              </div>
            </div>
          )}

          {/* JS 渲染（headless 浏览器）开关 */}
          {form.platform === 'html' && (
            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 8,
              padding: '10px 12px', background: '#0f172a',
              border: `1px solid ${form.useBrowser ? '#14b8a6' : '#334155'}`,
              borderRadius: 6, cursor: 'pointer',
            }}>
              <input
                type="checkbox"
                checked={form.useBrowser}
                onChange={e => setForm(prev => ({ ...prev, useBrowser: e.target.checked }))}
                style={{ marginTop: 2, accentColor: '#14b8a6' }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: form.useBrowser ? '#14b8a6' : '#cbd5e1' }}>
                  JS 渲染（浏览器模式）
                </div>
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 3, lineHeight: 1.6 }}>
                  用 headless Chromium 跑 JS 再抓 HTML，适合 SPA / 动态图片站（Vue/React 前端）。
                  <span style={{ color: '#f59e0b' }}>每页慢 3-8 秒。已开启 stealth 反检测(navigator.webdriver / plugins / WebGL 等 17 项 patch)。</span>
                </div>
              </div>
            </label>
          )}

          {/* JS 渲染高级选项 (仅在 useBrowser=true 时显示) */}
          {form.platform === 'html' && form.useBrowser && (
            <details style={{ marginTop: 8, padding: '8px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 6 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#14b8a6' }}>
                浏览器模式高级选项(可选)
              </summary>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>等待选择器(CSS,渲染完成的标志)</span>
                  <input value={form.htmlWaitFor}
                    onChange={e => setForm(prev => ({ ...prev, htmlWaitFor: e.target.value }))}
                    placeholder="img[src], .article-content, [data-loaded]"
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace' }} />
                  <span style={{ fontSize: 10, color: '#475569' }}>留空则等 networkidle。SPA 推荐填写。</span>
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 11, color: '#64748b' }}>Locale</span>
                    <input value={form.htmlLocale}
                      onChange={e => setForm(prev => ({ ...prev, htmlLocale: e.target.value }))}
                      placeholder="en-US 或 zh-CN"
                      style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 11, color: '#64748b' }}>Timezone</span>
                    <input value={form.htmlTimezone}
                      onChange={e => setForm(prev => ({ ...prev, htmlTimezone: e.target.value }))}
                      placeholder="America/New_York 或 Asia/Shanghai"
                      style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 12 }} />
                  </label>
                </div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>Cookies (JSON 数组,登录态注入)</span>
                  <textarea value={form.htmlCookies}
                    onChange={e => setForm(prev => ({ ...prev, htmlCookies: e.target.value }))}
                    placeholder={'[{"name":"session","value":"xxx","domain":".example.com","path":"/"}]'}
                    rows={3}
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace', resize: 'vertical' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>额外 HTTP 头 (JSON 对象)</span>
                  <textarea value={form.htmlExtraHeaders}
                    onChange={e => setForm(prev => ({ ...prev, htmlExtraHeaders: e.target.value }))}
                    placeholder={'{"Authorization": "Bearer ...", "X-Custom": "value"}'}
                    rows={3}
                    style={{ background: '#020617', border: '1px solid #334155', borderRadius: 5, padding: '6px 10px', color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace', resize: 'vertical' }} />
                </label>
              </div>
            </details>
          )}

          {/* 抓取全部图片（不过滤） */}
          {form.platform === 'html' && form.htmlMode !== 'article' && (
            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 8,
              padding: '10px 12px', background: '#0f172a',
              border: `1px solid ${form.extractAll ? '#a855f7' : '#334155'}`,
              borderRadius: 6, cursor: 'pointer',
            }}>
              <input
                type="checkbox"
                checked={form.extractAll}
                onChange={e => setForm(prev => ({ ...prev, extractAll: e.target.checked }))}
                style={{ marginTop: 2, accentColor: '#a855f7' }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: form.extractAll ? '#a855f7' : '#cbd5e1' }}>
                  抓取全部图片（不过滤）
                </div>
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 3, lineHeight: 1.6 }}>
                  绕过尺寸/黑名单/最小描述的过滤，每页最多 500 张；额外解析 srcset 与 &lt;picture&gt;。
                  <span style={{ color: '#f59e0b' }}>会抓到 logo/icon/小图等噪音。</span>
                </div>
              </div>
            </label>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              onClick={() => {
                // Stealth-mode advanced options (only valid when useBrowser=true)
                const stealthOpts = form.useBrowser ? buildStealthOpts(form) : {};
                const config: Record<string, unknown> = form.platform === 'html'
                  ? (form.htmlMode === 'crawl'
                      ? {
                          mode: 'crawl',
                          entry: form.crawlEntry,
                          maxDepth: form.crawlMaxDepth,
                          maxPages: form.crawlMaxPages,
                          ...(form.crawlPattern ? { urlPattern: form.crawlPattern } : {}),
                          ...(form.useBrowser ? { render: 'browser' } : {}),
                          ...(form.extractAll ? { extractAll: true } : {}),
                          ...stealthOpts,
                        }
                      : {
                          urls: form.htmlUrls.split('\n').map(s => s.trim()).filter(Boolean),
                          mode: form.htmlMode,
                          ...(form.useBrowser ? { render: 'browser' } : {}),
                          ...(form.extractAll ? { extractAll: true } : {}),
                          ...stealthOpts,
                        })
                  : form.platform === '2ksg'
                  ? {
                      ids: form.ksgIds.split('\n').map(parseKsgLine).map(p => p.id).filter((x): x is string => !!x),
                      bucket: form.ksgBucket || '5',
                      host: form.ksgHost || 'uib.2ksg.com',
                      token: form.ksgToken,
                      referer: form.ksgReferer || 'https://uib.2ksg.com/app/',
                      ...(form.ksgCrawlList ? { crawlList: true, maxIds: form.ksgMaxIds } : {}),
                    }
                  : form.platform === 'knit'
                  ? {
                      urls: form.knitUrls.split('\n').map(s => s.trim()).filter(Boolean),
                      cookie: form.knitCookie,
                      userAgent: form.knitUserAgent || undefined,
                    }
                  : form.platform === 'reddit'
                  ? {
                      subreddits: form.redditSubs.split('\n').map(s => s.trim().replace(/^\/?r\//i, '')).filter(Boolean),
                      sort: form.redditSort,
                      time: form.redditTime,
                      limit: form.redditLimit,
                      ...(form.redditUA ? { userAgent: form.redditUA } : {}),
                    }
                  : form.platform === 'bluesky'
                  ? {
                      mode: form.bskyMode,
                      ...(form.bskyMode === 'author' ? { actor: form.bskyActor.trim().replace(/^@/, '') } : {}),
                      ...(form.bskyMode === 'search' ? { query: form.bskyQuery } : {}),
                      limit: form.bskyLimit,
                    }
                  : form.platform === 'sitemap-images'
                  ? {
                      sitemapUrl: form.sitemapUrl,
                      limit: form.sitemapLimit,
                      ...(form.sitemapPattern ? { pagePattern: form.sitemapPattern } : {}),
                    }
                  : form.platform === 'x'
                  ? {
                      mode: form.xMode,
                      ...(form.xMode === 'user'   ? { screenName: form.xScreenName.trim().replace(/^@/, '') } : {}),
                      ...(form.xMode === 'search' ? { query: form.xQuery } : {}),
                      cookie: form.xCookie,
                      ...(form.xUserAgent ? { userAgent: form.xUserAgent } : {}),
                      limit: form.xLimit,
                    }
                  : { feed_url: form.url, limit: 20 };
                onSave(editingSource
                  ? { ...editingSource, ...form, config }
                  : { ...form, config });
              }}
              style={{ padding: '6px 18px', borderRadius: 6, border: 'none', background: '#6366f1', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              {editingSource ? '保存' : '添加'}
            </button>
            <button
              onClick={() => { setEditingSource(null); setShowAddSource(false); }}
              style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #334155', background: 'transparent', color: '#64748b', fontSize: 12, cursor: 'pointer' }}>
              取消
            </button>
          </div>
          </div>
        </div>
      )}

      {/* Sources list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {sources.map(src => {
          const isSelected = selected.has(src.id);
          return (
          <div key={src.id} style={{
            background: isSelected ? '#1e2a4d' : '#1e293b',
            border: `1px solid ${isSelected ? '#6366f1' : src.status === 'active' ? '#334155' : '#1e293b'}`,
            borderLeft: `3px solid ${src.status === 'active' ? '#22c55e' : '#374151'}`,
            borderRadius: 8, padding: '16px 18px',
            opacity: src.status === 'active' ? 1 : 0.55,
            boxShadow: isSelected ? '0 0 0 1px rgba(99,102,241,0.25)' : 'none',
            transition: 'background 0.12s, border-color 0.12s, box-shadow 0.12s',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {src.name}
                  {src.credential_id && (
                    <span title={`使用凭证池中的 ${src.credential_name}（${src.credential_status ?? '未知状态'}）。cookie 不在源里,运行时从 credentials 表读取。`}
                      style={{
                        fontSize: 10, fontWeight: 600,
                        padding: '1px 7px', borderRadius: 10,
                        background: src.credential_status === 'active' ? '#312e81' : '#7f1d1d',
                        color: src.credential_status === 'active' ? '#c7d2fe' : '#fca5a5',
                      }}>
                      🔑 {src.credential_name ?? src.credential_id.slice(0, 6)}
                    </span>
                  )}
                  {!src.credential_id && (src.config?.cookie as string) && (
                    <span title="该源在 config 里内联存了 cookie(legacy 模式)" style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, background: '#374151', color: '#9ca3af' }}>
                      🍪 inline
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                  {src.platform} · {src.external_id}
                  {src.last_fetch_at && ` · 最近采集: ${src.last_fetch_at.slice(0, 16)}`}
                </div>
                <div style={{ fontSize: 11, color: '#475569', marginTop: 1, wordBreak: 'break-all' }}>
                  {(src.config?.feed_url as string) ?? src.url}
                </div>
              </div>
              {src.score !== null && (() => {
                const score = Number(src.score);
                const scoreColor = score >= 70 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#f87171';
                const risk = src.risk_level ?? 'low';
                const riskColor = risk === 'high' ? '#f87171' : risk === 'medium' ? '#fbbf24' : '#34d399';
                const riskLabel = risk === 'high' ? '高风险' : risk === 'medium' ? '中风险' : '低风险';
                return (
                  <div style={{
                    flexShrink: 0, display: 'flex', gap: 14, alignItems: 'center',
                    padding: '4px 14px', borderRadius: 8, background: '#0f172a',
                    border: '1px solid #1e293b',
                  }}>
                    <div style={{ textAlign: 'center', minWidth: 36 }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: scoreColor, lineHeight: 1.1 }}>{score.toFixed(0)}</div>
                      <div style={{ fontSize: 9, color: '#64748b', marginTop: 1 }}>评分</div>
                    </div>
                    <div style={{ textAlign: 'center', minWidth: 38 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: riskColor, lineHeight: 1.1, padding: '2px 0' }}>{riskLabel}</div>
                      <div style={{ fontSize: 9, color: '#64748b', marginTop: 1 }}>风险</div>
                    </div>
                    {src.stability !== null && (
                      <div style={{ textAlign: 'center', minWidth: 32 }}>
                        <div style={{ fontSize: 16, fontWeight: 700, color: '#a5b4fc', lineHeight: 1.1 }}>{Number(src.stability).toFixed(0)}</div>
                        <div style={{ fontSize: 9, color: '#64748b', marginTop: 1 }}>稳定</div>
                      </div>
                    )}
                  </div>
                );
              })()}
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button onClick={() => onToggleStatus(src)} style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid #334155', background: src.status === 'active' ? '#14532d' : '#1e293b', color: src.status === 'active' ? '#86efac' : '#475569', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                  {src.status === 'active' ? '活跃' : '停用'}
                </button>
                <button onClick={() => onIngest(src)} disabled={src.status !== 'active'} style={{ padding: '4px 10px', borderRadius: 5, border: 'none', background: src.status === 'active' ? '#0ea5e9' : '#1e293b', color: src.status === 'active' ? '#fff' : '#334155', fontSize: 11, cursor: src.status === 'active' ? 'pointer' : 'not-allowed', fontWeight: 600 }}>
                  采集
                </button>
                <button onClick={() => startEdit(src)} style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontSize: 11, cursor: 'pointer' }}>编辑</button>
                <button onClick={() => onDelete(src)} style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid #334155', background: 'transparent', color: '#f87171', fontSize: 11, cursor: 'pointer' }}>删除</button>
                {selected.size > 0 && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', paddingLeft: 4, marginLeft: 2, borderLeft: '1px solid #334155' }}>
                    <Checkbox checked={isSelected} onClick={() => toggleOne(src.id)} ariaLabel={`选中 ${src.name}`} />
                  </span>
                )}
              </div>
            </div>
          </div>
          );
        })}
        {sources.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: '#334155' }}>暂无采集源，点击「+ 添加来源」</div>
        )}
      </div>
    </div>
  );
}
