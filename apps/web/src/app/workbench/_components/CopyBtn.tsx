'use client';

import { useState } from 'react';

export function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}
      style={{ padding: '3px 10px', borderRadius: 4, border: '1px solid #374151', background: done ? '#064e3b' : '#1f2937', color: done ? '#6ee7b7' : '#9ca3af', fontSize: 12, cursor: 'pointer' }}>
      {done ? '✓ 已复制' : '复制文案'}
    </button>
  );
}
