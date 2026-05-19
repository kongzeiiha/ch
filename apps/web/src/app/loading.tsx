import { X } from './_components/theme';

// 全站导航过渡时 Next.js 自动渲染这个组件,直到目标页的 server components
// 完成渲染。先前没 loading.tsx — 用户点击左栏后整页空白,SSR 完才一次性
// 替换,体感"卡 1-2 秒"。加上骨架后点击瞬间就有占位,SSR 流过来再 swap。
//
// 这里画的是和 XLayout 三栏对齐的骨架,middle 区放 6 行卡片占位 + 顶部
// 一道蓝色细条作为"正在加载"提示。
export default function Loading() {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '240px minmax(0, 600px) 300px',
      justifyContent: 'center',
      minHeight: '100vh',
      background: X.page,
    }}>
      <style>{`
        @keyframes loading-bar {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(100%);  }
        }
        @keyframes pulse-block {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.55; }
        }
      `}</style>

      {/* Left nav placeholder — 跟 XSideNav 视觉一致的 logo + 8 行图标占位 */}
      <aside style={{
        borderRight: `1px solid ${X.border}`,
        padding: '12px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}>
        <div style={{ width: 52, height: 52, borderRadius: '50%', margin: '4px 0 8px',
          background: X.surfaceHover, animation: 'pulse-block 1.4s ease-in-out infinite' }} />
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 16,
            padding: '12px 16px',
          }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%',
              background: X.surfaceHover,
              animation: `pulse-block 1.4s ease-in-out ${i * 0.05}s infinite` }} />
            <div style={{ width: 80, height: 16, borderRadius: 8,
              background: X.surfaceHover,
              animation: `pulse-block 1.4s ease-in-out ${i * 0.05}s infinite` }} />
          </div>
        ))}
      </aside>

      {/* Middle — 顶部细蓝条 + 6 行卡片骨架 */}
      <main style={{ borderRight: `1px solid ${X.border}`, position: 'relative' }}>
        {/* 顶部蓝色动画条 — X.com 跳转时也有类似的进度反馈 */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          overflow: 'hidden', background: 'transparent',
        }}>
          <div style={{
            width: '40%', height: '100%', background: X.accent,
            animation: 'loading-bar 1.1s ease-in-out infinite',
          }} />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{
            display: 'flex', gap: 12,
            padding: '14px 16px',
            borderBottom: `1px solid ${X.border}`,
          }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%',
              background: X.surfaceHover, flexShrink: 0,
              animation: `pulse-block 1.4s ease-in-out ${i * 0.07}s infinite` }} />
            <div style={{ flex: 1 }}>
              <div style={{ width: '50%', height: 14, borderRadius: 4,
                background: X.surfaceHover, marginBottom: 8,
                animation: `pulse-block 1.4s ease-in-out ${i * 0.07}s infinite` }} />
              <div style={{ width: '90%', height: 16, borderRadius: 4,
                background: X.surfaceHover, marginBottom: 6,
                animation: `pulse-block 1.4s ease-in-out ${i * 0.07}s infinite` }} />
              <div style={{ width: '70%', height: 14, borderRadius: 4,
                background: X.surfaceHover,
                animation: `pulse-block 1.4s ease-in-out ${i * 0.07}s infinite` }} />
            </div>
          </div>
        ))}
      </main>

      {/* Right rail — 一个搜索框形状 + 一个块占位 */}
      <aside style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ height: 42, borderRadius: 9999, background: X.surfaceHover,
          animation: 'pulse-block 1.4s ease-in-out infinite' }} />
        <div style={{ height: 240, borderRadius: 16, background: X.surfaceHover,
          animation: 'pulse-block 1.4s ease-in-out 0.2s infinite' }} />
        <div style={{ height: 220, borderRadius: 16, background: X.surfaceHover,
          animation: 'pulse-block 1.4s ease-in-out 0.4s infinite' }} />
      </aside>
    </div>
  );
}
