'use client';

import Link from 'next/link';

// Dark-theme nav matching the workbench palette (#0f172a body / #1e293b cards
// / #6366f1 indigo accent). Active tab fills with indigo, inactive tabs are
// transparent with slate-700 borders.
const base: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  fontSize: 13,
  textDecoration: 'none',
  border: '1px solid transparent',
  fontWeight: 500,
};

const active: React.CSSProperties = {
  background: '#6366f1',
  color: '#fff',
  borderColor: '#6366f1',
};

const inactive: React.CSSProperties = {
  background: 'transparent',
  color: '#94a3b8',
  borderColor: '#334155',
};

export type AdminTab =
  | 'infra'
  | 'source-scoring'
  | 'ingestion'
  | 'classify-title'
  | 'cover-compliance'
  | 'publishing'
  | 'distribution'
  | 'ops'
  | 'feedback';

export function AdminNav({ current }: { current: AdminTab }) {
  return (
    <nav style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      <Link href="/admin/infra"            style={{ ...base, ...(current === 'infra' ? active : inactive) }}>基础设施</Link>
      <Link href="/admin/source-scoring"   style={{ ...base, ...(current === 'source-scoring' ? active : inactive) }}>Source 评分</Link>
      <Link href="/admin"                  style={{ ...base, ...(current === 'ingestion' ? active : inactive) }}>采集</Link>
      <Link href="/admin/classify-title"   style={{ ...base, ...(current === 'classify-title' ? active : inactive) }}>分类与标题</Link>
      <Link href="/admin/cover-compliance" style={{ ...base, ...(current === 'cover-compliance' ? active : inactive) }}>封面与合规</Link>
      <Link href="/admin/publishing"       style={{ ...base, ...(current === 'publishing' ? active : inactive) }}>发布</Link>
      <Link href="/admin/distribution"     style={{ ...base, ...(current === 'distribution' ? active : inactive) }}>分发</Link>
      <Link href="/admin/ops"              style={{ ...base, ...(current === 'ops' ? active : inactive) }}>上线</Link>
      <Link href="/admin/feedback"         style={{ ...base, ...(current === 'feedback' ? active : inactive) }}>反馈闭环</Link>
    </nav>
  );
}
