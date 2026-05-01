import type { ReactNode } from 'react';

export const metadata = {
  title: '内容中台',
  description: '基于 8 个 Agent 的内容流水线',
};

// Global keyframes used by status indicators across the workbench. Inlined
// here so all pages get them without needing a separate CSS file.
const GLOBAL_CSS = `
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.45; }
  }
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh">
      <head>
        <style dangerouslySetInnerHTML={{ __html: GLOBAL_CSS }} />
      </head>
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>{children}</body>
    </html>
  );
}
