'use client';

import { useState, useEffect, useRef, FormEvent, ChangeEvent, DragEvent } from 'react';
import Link from 'next/link';
import { AdminNav } from '../../../components/AdminNav';

// 手工发帖页 v2 — 文件上传 + 草稿自动保存 + 预览。
//
//   1. 文件上传:点击 or 拖拽 → POST /api/admin/posts/upload(multipart)→ 拿到
//      MinIO URL → 自动塞进 media/video URL 列表;同时支持手动粘 URL。
//   2. 草稿自动保存:输入停顿 500ms 后整张表单写 localStorage,刷新页面恢复。
//      成功提交后清空草稿,避免下次再恢复出已发的内容。
//   3. 预览:切到"预览"标签 → 按 /a/<slug> 文章页样式渲染正文 + 媒体,
//      帮运营提交前 sanity-check。
//
// 仍然走 /api/admin/posts/manual,后端逻辑不变。
const DRAFT_KEY = 'admin:post-new:draft:v1';
const AUTOSAVE_MS = 500;

const card: React.CSSProperties = {
  background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: 16,
};
const label: React.CSSProperties = {
  display: 'block', fontSize: 12, color: '#94a3b8', fontWeight: 600, marginBottom: 6,
};
const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  background: '#0f172a', border: '1px solid #334155', borderRadius: 6,
  padding: '8px 12px', color: '#e2e8f0', fontSize: 13, outline: 'none',
};

interface DraftV1 {
  title: string;
  content: string;
  category: string;
  tagsRaw: string;
  mediaUrlsRaw: string;
  videoUrlsRaw: string;
  skipAuto: boolean;
  sourceId: string;        // 「发帖人」选择,空字符串 = fallback 到"手工录入"源
  savedAt: number;
}

interface SourceOption {
  id: string;
  name: string;
  platform: string;
}

export default function PostNewPage() {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('');
  const [tagsRaw, setTagsRaw] = useState('');
  const [mediaUrlsRaw, setMediaUrlsRaw] = useState('');
  const [videoUrlsRaw, setVideoUrlsRaw] = useState('');
  const [skipAuto, setSkipAuto] = useState(false);
  const [sourceId, setSourceId] = useState('');   // '' = 默认走 manual source

  const [sources, setSources] = useState<SourceOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [draftStatus, setDraftStatus] = useState<string>('');
  const [result, setResult] = useState<{ ok: boolean; msg: string; itemId?: string } | null>(null);

  // 「+ 新建发帖人」内联表单
  const [newSourceOpen, setNewSourceOpen] = useState(false);
  const [newSourceName, setNewSourceName] = useState('');
  const [creatingSource, setCreatingSource] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<NodeJS.Timeout | null>(null);
  const restoredRef = useRef(false);

  // ── 草稿恢复(首次挂载) ───────────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as DraftV1;
      // 只在用户没主动开始输入时恢复;首次挂载所有字段都为空,直接装填
      setTitle(d.title ?? '');
      setContent(d.content ?? '');
      setCategory(d.category ?? '');
      setTagsRaw(d.tagsRaw ?? '');
      setMediaUrlsRaw(d.mediaUrlsRaw ?? '');
      setVideoUrlsRaw(d.videoUrlsRaw ?? '');
      setSkipAuto(d.skipAuto ?? false);
      setSourceId(d.sourceId ?? '');
      restoredRef.current = true;
      const ago = Math.max(1, Math.floor((Date.now() - (d.savedAt ?? Date.now())) / 60000));
      setDraftStatus(`已恢复 ${ago}m 前的草稿`);
      setTimeout(() => setDraftStatus(''), 5000);
    } catch {/* 草稿坏了直接忽略 */}
  }, []);

  // ── 拉发帖人下拉列表(挂载时一次性) ─────────────────────────────────
  useEffect(() => {
    fetch('/api/admin/sources', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : { sources: [] })
      .then((d) => {
        const list: SourceOption[] = (d.sources ?? [])
          .filter((s: any) => s.status === 'active')
          .map((s: any) => ({ id: s.id, name: s.name, platform: s.platform }));
        // 按 platform 分组排序:manual 永远在最前
        list.sort((a, b) => {
          if (a.platform === 'manual') return -1;
          if (b.platform === 'manual') return 1;
          return a.name.localeCompare(b.name, 'zh-CN');
        });
        setSources(list);
      })
      .catch(() => {/* 拉不到只是没下拉,UI 不阻塞 */});
  }, []);

  // ── 草稿自动保存(debounce) ──────────────────────────────────────────
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const draft: DraftV1 = {
        title, content, category, tagsRaw, mediaUrlsRaw, videoUrlsRaw, skipAuto, sourceId,
        savedAt: Date.now(),
      };
      const hasContent = title || content || category || tagsRaw || mediaUrlsRaw || videoUrlsRaw;
      try {
        if (hasContent) {
          localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
          setDraftStatus(`草稿已保存 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`);
        } else {
          localStorage.removeItem(DRAFT_KEY);
        }
      } catch {/* localStorage 配额满等情况静默 */}
    }, AUTOSAVE_MS);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [title, content, category, tagsRaw, mediaUrlsRaw, videoUrlsRaw, skipAuto, sourceId]);

  // ── 上传文件 ─────────────────────────────────────────────────────────
  async function uploadFiles(files: FileList | File[]) {
    if (!files || (files as FileList).length === 0) return;
    setUploading(true);
    try {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append('files', f, f.name);
      const r = await fetch('/api/admin/posts/upload', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      // 拿到 [{url, kind: image|video, ...}],分别拼到 media / video 行末
      const images: string[] = d.files.filter((f: any) => f.kind === 'image').map((f: any) => f.url);
      const videos: string[] = d.files.filter((f: any) => f.kind === 'video').map((f: any) => f.url);
      if (images.length) setMediaUrlsRaw((s) => [s.trim(), ...images].filter(Boolean).join('\n'));
      if (videos.length) setVideoUrlsRaw((s) => [s.trim(), ...videos].filter(Boolean).join('\n'));
    } catch (e: any) {
      setResult({ ok: false, msg: `上传失败:${e?.message ?? e}` });
    } finally {
      setUploading(false);
    }
  }

  function onFilesPicked(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) uploadFiles(e.target.files);
    if (fileInputRef.current) fileInputRef.current.value = '';   // 允许同一文件再次选择
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
  }

  // ── 提交 ─────────────────────────────────────────────────────────────
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    const splitLines = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
    try {
      const r = await fetch('/api/admin/posts/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          content: content.trim(),
          category: category.trim() || undefined,
          tags: tagsRaw ? splitLines(tagsRaw) : undefined,
          mediaUrls: mediaUrlsRaw ? splitLines(mediaUrlsRaw) : undefined,
          videoUrls: videoUrlsRaw ? splitLines(videoUrlsRaw) : undefined,
          skipAutoPipeline: skipAuto,
          sourceId: sourceId || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setResult({ ok: false, msg: d.error || `HTTP ${r.status}` });
      } else {
        setResult({ ok: true, msg: d.hint || '已提交', itemId: d.itemId });
        // 成功 → 清草稿 + 清表单,方便连发(sourceId 保留,通常连发同一个发帖人)
        try { localStorage.removeItem(DRAFT_KEY); } catch {}
        setTitle(''); setContent(''); setCategory('');
        setTagsRaw(''); setMediaUrlsRaw(''); setVideoUrlsRaw('');
        setDraftStatus('');
      }
    } catch (e: any) {
      setResult({ ok: false, msg: e?.message ?? '网络错误' });
    } finally {
      setBusy(false);
    }
  }

  // ── 新建发帖人 ────────────────────────────────────────────────────────
  async function createNewSource() {
    const name = newSourceName.trim();
    if (!name) return;
    setCreatingSource(true);
    try {
      const r = await fetch('/api/admin/posts/manual-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      // 插入或替换下拉列表项,然后自动选中
      setSources((prev) => {
        const filtered = prev.filter((s) => s.id !== d.source.id);
        return [...filtered, { id: d.source.id, name: d.source.name, platform: d.source.platform }]
          .sort((a, b) => {
            if (a.platform === 'manual' && b.platform !== 'manual') return -1;
            if (b.platform === 'manual' && a.platform !== 'manual') return 1;
            return a.name.localeCompare(b.name, 'zh-CN');
          });
      });
      setSourceId(d.source.id);
      setNewSourceOpen(false);
      setNewSourceName('');
    } catch (e: any) {
      setResult({ ok: false, msg: `新建发帖人失败:${e?.message ?? e}` });
    } finally {
      setCreatingSource(false);
    }
  }

  function clearDraft() {
    if (!confirm('清空当前表单 + 草稿?')) return;
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    setTitle(''); setContent(''); setCategory('');
    setTagsRaw(''); setMediaUrlsRaw(''); setVideoUrlsRaw('');
    setSkipAuto(false);
    setDraftStatus('草稿已清除');
    setTimeout(() => setDraftStatus(''), 2000);
  }

  // ── 渲染预览 ─────────────────────────────────────────────────────────
  const splitLines = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
  const previewImages = splitLines(mediaUrlsRaw);
  const previewVideos = splitLines(videoUrlsRaw);
  const previewTags = splitLines(tagsRaw);

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', padding: 20 }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>手工发帖</h1>
        <AdminNav current="post-new" />

        <div style={{ ...card, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12, color: '#94a3b8', flex: 1, minWidth: 240, lineHeight: 1.7 }}>
            手工录入跳过爬虫直接进 raw_items + items,默认<strong style={{ color: '#a5b4fc' }}>自动入队</strong> classify-title。
            草稿每 0.5s 自动存到浏览器,刷新不丢。
          </div>
          {draftStatus && (
            <span style={{ fontSize: 11, color: '#86efac', padding: '4px 10px', background: '#052e16', borderRadius: 4, whiteSpace: 'nowrap' }}>
              💾 {draftStatus}
            </span>
          )}
          <button type="button" onClick={clearDraft}
            style={{ padding: '5px 12px', background: 'transparent', color: '#94a3b8', border: '1px solid #334155', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
            清除草稿
          </button>
        </div>

        {/* 模式切换 — 编辑 / 预览 */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 14, borderBottom: '1px solid #334155' }}>
          <button type="button" onClick={() => setMode('edit')} style={tabStyle(mode === 'edit')}>编辑</button>
          <button type="button" onClick={() => setMode('preview')} style={tabStyle(mode === 'preview')}>
            预览{title || content ? '' : ' (空)'}
          </button>
        </div>

        {mode === 'edit' ? (
          <form onSubmit={onSubmit} style={{ ...card, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={label}>发帖人 <span style={{ fontWeight: 400, color: '#64748b' }}>(留空 = 默认"手工录入")</span></label>
              <div style={{ display: 'flex', gap: 8 }}>
                <select
                  value={sourceId}
                  onChange={(e) => setSourceId(e.target.value)}
                  style={{ ...input, cursor: 'pointer', flex: 1 }}
                >
                  <option value="">手工录入（默认，公开名走哈希）</option>
                  {sources.filter((s) => s.platform === 'manual').length > 0 && (
                    <optgroup label="—— 手工创建的发帖人 ——">
                      {sources.filter((s) => s.platform === 'manual').map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </optgroup>
                  )}
                  {sources.filter((s) => s.platform !== 'manual').length > 0 && (
                    <optgroup label="—— 已采集的真实博主 ——">
                      {sources.filter((s) => s.platform !== 'manual').map((s) => (
                        <option key={s.id} value={s.id}>{s.name} · {s.platform}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <button type="button" onClick={() => setNewSourceOpen((v) => !v)}
                  style={{
                    padding: '0 14px', background: 'transparent',
                    color: newSourceOpen ? '#a5b4fc' : '#94a3b8',
                    border: '1px solid #334155', borderRadius: 6,
                    fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
                  }}>
                  {newSourceOpen ? '取消' : '+ 新建发帖人'}
                </button>
              </div>

              {newSourceOpen && (
                <div style={{ marginTop: 8, padding: 12, background: '#0f172a', border: '1px solid #334155', borderRadius: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    style={{ ...input, flex: 1 }}
                    autoFocus
                    value={newSourceName}
                    onChange={(e) => setNewSourceName(e.target.value)}
                    placeholder="输入虚拟博主名,例:摄影师A / 文艺生活 / 老张"
                    maxLength={64}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); createNewSource(); }
                      if (e.key === 'Escape') { e.preventDefault(); setNewSourceOpen(false); setNewSourceName(''); }
                    }}
                  />
                  <button type="button" onClick={createNewSource} disabled={creatingSource || !newSourceName.trim()}
                    style={{
                      padding: '8px 18px',
                      background: creatingSource ? '#475569' : '#6366f1',
                      color: '#fff', border: 'none', borderRadius: 6,
                      fontSize: 13, fontWeight: 700,
                      cursor: creatingSource ? 'wait' : 'pointer',
                    }}>{creatingSource ? '创建中…' : '创建'}</button>
                </div>
              )}

              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                <strong style={{ color: '#94a3b8' }}>手工创建的发帖人</strong>：公开站点直接用你填的名字。
                <strong style={{ color: '#94a3b8' }}>已采集真实博主</strong>：公开站点用 virtualBlogger 哈希化名(不暴露上游 @handle)。
              </div>
            </div>

            <div>
              <label style={label}>标题 <span style={{ color: '#f87171' }}>*</span></label>
              <input style={input} value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="一句话标题,LLM 会基于此再候选 3 个" maxLength={500} required />
            </div>

            <div>
              <label style={label}>正文 <span style={{ color: '#f87171' }}>*</span>（纯文本，回车空行=新段落）</label>
              <textarea style={{ ...input, fontFamily: 'inherit', minHeight: 180, lineHeight: 1.7, resize: 'vertical' }}
                value={content} onChange={(e) => setContent(e.target.value)}
                placeholder="正文内容,最少 10 字" maxLength={50_000} required />
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{content.length} 字 / 上限 50,000</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <label style={label}>分类（可选）</label>
                <input style={input} value={category} onChange={(e) => setCategory(e.target.value)}
                  placeholder="例:自拍 / 调教 / 偷拍" maxLength={64} />
              </div>
              <div>
                <label style={label}>标签（逗号或换行分隔）</label>
                <input style={input} value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)}
                  placeholder="AI, 福利, 周末" />
              </div>
            </div>

            {/* 上传区 — 拖拽 / 点击,上传后自动追加到 URL 列表 */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                padding: '20px 16px',
                border: `2px dashed ${dragOver ? '#6366f1' : '#334155'}`,
                borderRadius: 8,
                background: dragOver ? '#312e81' : '#0f172a',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'border 0.15s, background 0.15s',
              }}>
              <div style={{ fontSize: 13, color: dragOver ? '#c7d2fe' : '#cbd5e1', fontWeight: 600, marginBottom: 4 }}>
                {uploading ? '📤 上传中…' : dragOver ? '松手上传' : '📎 点击选择文件 / 拖拽到此处'}
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>
                图片(jpg/png/webp/gif/avif) + 视频(mp4/webm/mov),单文件 ≤ 50MB,一次最多 10 个
              </div>
              <input ref={fileInputRef} type="file" multiple
                accept="image/*,video/mp4,video/webm,video/quicktime"
                style={{ display: 'none' }}
                onChange={onFilesPicked} />
            </div>

            <div>
              <label style={label}>图片 URL（上传或手动粘贴，每行一个）</label>
              <textarea style={{ ...input, fontFamily: 'inherit', minHeight: 70, resize: 'vertical' }}
                value={mediaUrlsRaw} onChange={(e) => setMediaUrlsRaw(e.target.value)}
                placeholder={'https://...\n或上传后自动追加'} />
            </div>

            <div>
              <label style={label}>视频 URL（mp4 直链，每行一个）</label>
              <textarea style={{ ...input, fontFamily: 'inherit', minHeight: 50, resize: 'vertical' }}
                value={videoUrlsRaw} onChange={(e) => setVideoUrlsRaw(e.target.value)}
                placeholder={'https://...\n或上传后自动追加'} />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#cbd5e1', cursor: 'pointer' }}>
              <input type="checkbox" checked={skipAuto} onChange={(e) => setSkipAuto(e.target.checked)}
                style={{ accentColor: '#6366f1' }} />
              不自动入队（停在 INGESTED，到工作台逐步推进）
            </label>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button type="submit" disabled={busy || uploading} style={{
                padding: '9px 22px',
                background: (busy || uploading) ? '#475569' : '#6366f1',
                color: '#fff', border: 'none', borderRadius: 6,
                fontSize: 14, fontWeight: 700,
                cursor: (busy || uploading) ? 'wait' : 'pointer',
              }}>{busy ? '提交中…' : uploading ? '等上传…' : '提交'}</button>

              {result && (
                <div style={{
                  padding: '6px 12px', borderRadius: 6, fontSize: 13,
                  background: result.ok ? '#052e16' : '#450a0a',
                  border: `1px solid ${result.ok ? '#16a34a' : '#dc2626'}`,
                  color: result.ok ? '#86efac' : '#fca5a5',
                }}>
                  {result.ok ? '✓ ' : '✗ '}{result.msg}
                  {result.itemId && (
                    <>
                      {' · '}
                      <Link href="/workbench" style={{ color: '#a5b4fc' }}>去工作台 →</Link>
                      {' · '}
                      <code style={{ color: '#64748b', fontSize: 11 }}>{result.itemId.slice(0, 8)}</code>
                    </>
                  )}
                </div>
              )}
            </div>
          </form>
        ) : (
          /* ── 预览模式 — 按 /a/<slug> 详情页样式渲染 ── */
          <div style={{ ...card, color: '#cbd5e1' }}>
            {!title && !content ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
                编辑里填一些内容再切到这里看效果
              </div>
            ) : (
              <article style={{ lineHeight: 1.85 }}>
                <h1 style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.3, marginBottom: 8, color: '#f1f5f9' }}>
                  {title || '(未填标题)'}
                </h1>
                <div style={{ fontSize: 13, color: '#71767b', marginBottom: 20 }}>
                  {category && <span style={{ color: '#1d9bf0', fontWeight: 700, marginRight: 8 }}>{category}</span>}
                  <span>预览模式 · 提交后实际由 LLM 重写候选标题、生成 slug、选封面</span>
                </div>

                {previewImages.length === 1 && (
                  // 单图当 og 大图,跟文章详情页 og-image 显示一致
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewImages[0]} alt="" style={{ width: '100%', maxWidth: 720, aspectRatio: '16/9', objectFit: 'cover', borderRadius: 12, background: '#000', display: 'block', marginBottom: 20 }} />
                )}

                {content && (
                  <div style={{ fontSize: 16, color: '#cbd5e1', whiteSpace: 'pre-wrap' }}>
                    {content}
                  </div>
                )}

                {previewVideos.length > 0 && (
                  <section style={{ marginTop: 24 }}>
                    {previewVideos.length > 1 && (
                      <div style={{ fontSize: 12, color: '#71767b', fontWeight: 700, marginBottom: 12, textTransform: 'uppercase' }}>
                        视频 · {previewVideos.length}
                      </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {previewVideos.map((v, i) => (
                        // eslint-disable-next-line jsx-a11y/media-has-caption
                        <video key={i} src={v} controls preload="metadata"
                          style={{ width: '100%', maxWidth: 720, borderRadius: 12, background: '#000' }} />
                      ))}
                    </div>
                  </section>
                )}

                {previewImages.length > 1 && (
                  <section style={{ marginTop: 24 }}>
                    <div style={{ fontSize: 12, color: '#71767b', fontWeight: 700, marginBottom: 12, textTransform: 'uppercase' }}>
                      图片 · {previewImages.length}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {previewImages.map((m, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={i} src={m} alt="" style={{ width: '100%', maxWidth: 720, borderRadius: 12, background: '#000', display: 'block' }} />
                      ))}
                    </div>
                  </section>
                )}

                {previewTags.length > 0 && (
                  <div style={{ marginTop: 28, paddingTop: 16, borderTop: '1px solid #334155', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <span style={{ fontSize: 12, color: '#71767b', marginRight: 4, fontWeight: 600 }}>标签</span>
                    {previewTags.map((t) => (
                      <span key={t} style={{ fontSize: 12, padding: '3px 10px', background: 'transparent', border: '1px solid #334155', color: '#cbd5e1', borderRadius: 9999 }}>
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: '10px 18px',
    background: 'transparent',
    border: 'none',
    color: active ? '#e2e8f0' : '#71767b',
    fontSize: 14,
    fontWeight: active ? 700 : 500,
    borderBottom: active ? '3px solid #6366f1' : '3px solid transparent',
    cursor: 'pointer',
    marginBottom: -1,
  };
}
