// B1 风格调色板（深色 + 粉红强调） — 公开站点专用。
// admin / workbench 单独维持 slate 深色调（独立审美），不引用此文件。
//
// 历史:本文件原本是 X.com 浅色风;改向 91-style 密集网格 + X timeline 视觉
// 时整体翻盘。token 名保留 X.* 不重命名,避免 11 个消费者全部 churn —
// 调色板含义按下面注释对照即可,不再代表 X.com 蓝色。
export const X = {
  // 背景 — X.com 默认 Light 主题(浏览器不开 dark mode 时看到的就是它)
  page:           '#ffffff',       // 主背景纯白
  surface:        '#ffffff',       // 卡片/timeline — 与页面同色,靠 border 勾边
  surfaceHover:   '#f7f9f9',       // hover 微灰(X timeline post hover)
  surfaceSoft:    '#f7f9f9',       // 右栏 trend block 软底
  surfaceInput:   '#eff3f4',       // search input 灰底

  // 边框 — X.com 的 hairline
  border:         '#eff3f4',       // post 分隔 / block 描边
  borderStrong:   '#cfd9de',       // input 描边 / 强调

  // 文本
  text:           '#0f1419',       // 主文字 near-black
  textSecondary:  '#536471',       // 次级 meta(handle、time、count)
  textMuted:      '#536471',       // X 只有一档次级灰

  // 主题色 — X 标志蓝(深浅主题一致)
  accent:         '#1d9bf0',       // X blue
  accentHover:    '#1a8cd8',       // hover 略深
  accentBg:       '#1d9bf01a',     // 10% 半透明,active/选中底色
  accentBgStrong: '#1d9bf033',     // 20% 半透明

  // 状态色
  success:        '#10b981',
  successBg:      '#10b9811a',
  danger:         '#ef4444',
  dangerBg:       '#ef44441a',
  warn:           '#f59e0b',
};

export const card: React.CSSProperties = {
  background: X.surface,
  border: `1px solid ${X.border}`,
  borderRadius: 12,                // 略小于原 16,贴近 91/X 风
};

export const chipBase: React.CSSProperties = {
  padding: '4px 12px',
  borderRadius: 9999,              // 胶囊
  fontSize: 13,
  textDecoration: 'none',
  border: `1px solid ${X.borderStrong}`,
  background: X.surface,
  color: X.text,
  fontWeight: 500,
};

export const chipActive: React.CSSProperties = {
  background: X.accent,            // 选中态粉红实心
  color: '#ffffff',
  borderColor: X.accent,
};
