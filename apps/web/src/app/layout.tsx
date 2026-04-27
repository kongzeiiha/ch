import type { ReactNode } from 'react';

export const metadata = {
  title: '内容中台',
  description: '基于 9 个 Agent 的内容流水线',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>{children}</body>
    </html>
  );
}
