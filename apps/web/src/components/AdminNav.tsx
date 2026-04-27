'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { getSprintStart, setSprintStart, computeDayLabel, todayISO } from '../lib/sprint';

const base: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  fontSize: 13,
  textDecoration: 'none',
  border: '1px solid transparent',
};

const active: React.CSSProperties = {
  background: '#111827',
  color: '#fff',
};

const inactive: React.CSSProperties = {
  background: '#fff',
  color: '#111827',
  borderColor: '#d1d5db',
};

export function AdminNav({ current }: { current: 'day1' | 'day2' | 'day3' | 'day4' | 'day5' | 'day6' | 'day7' }) {
  const [start, setStart] = useState(todayISO);

  useEffect(() => {
    setStart(getSprintStart());
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSprintStart(e.target.value);
    window.location.reload();
  }

  const d = (n: number) => computeDayLabel(start, n);

  return (
    <nav style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      <Link href="/workbench" style={{ ...base, background: '#111827', color: '#fff', borderColor: 'transparent', marginRight: 4 }}>
        ← 工作台
      </Link>
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#6b7280', marginRight: 4 }}>
        冲刺开始
        <input
          type="date"
          value={start}
          onChange={handleChange}
          style={{ fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4, padding: '2px 6px', color: '#111827' }}
        />
      </label>
      <Link href="/admin/day1" style={{ ...base, ...(current === 'day1' ? active : inactive) }}>
        {d(1)} · 基础设施
      </Link>
      <Link href="/admin" style={{ ...base, ...(current === 'day2' ? active : inactive) }}>
        {d(2)} · 采集
      </Link>
      <Link href="/admin/day3" style={{ ...base, ...(current === 'day3' ? active : inactive) }}>
        {d(3)} · 分类与标题
      </Link>
      <Link href="/admin/day4" style={{ ...base, ...(current === 'day4' ? active : inactive) }}>
        {d(4)} · 封面与合规
      </Link>
      <Link href="/admin/day5" style={{ ...base, ...(current === 'day5' ? active : inactive) }}>
        {d(5)} · 发布
      </Link>
      <Link href="/admin/day6" style={{ ...base, ...(current === 'day6' ? active : inactive) }}>
        {d(6)} · 分发
      </Link>
      <Link href="/admin/day7" style={{ ...base, ...(current === 'day7' ? active : inactive) }}>
        {d(7)} · 上线
      </Link>
    </nav>
  );
}
