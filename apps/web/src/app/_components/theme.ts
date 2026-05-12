// B1 风格调色板（深色 + 粉红强调） — 公开站点专用。
// admin / workbench 单独维持 slate 深色调（独立审美），不引用此文件。
//
// 历史:本文件原本是 X.com 浅色风;改向 91-style 密集网格 + X timeline 视觉
// 时整体翻盘。token 名保留 X.* 不重命名,避免 11 个消费者全部 churn —
// 调色板含义按下面注释对照即可,不再代表 X.com 蓝色。
export const X = {
  // 背景 — 整站统一纯黑,卡片靠 border 而非底色区分(避免"卡片浮岛"层级)
  page:           '#000000',       // 站点主背景
  surface:        '#000000',       // 卡片 / header bar — 与页面同色,只靠 border 勾边
  surfaceHover:   '#16181c',       // hover 才微亮,提供反馈
  surfaceSoft:    '#000000',       // 输入框 / inset section — 同色,靠 border 区分

  // 边框
  border:         '#2f3336',       // X.com 风极淡分割线
  borderStrong:   '#536471',       // chip / input / 强调边框

  // 文本
  text:           '#e2e8f0',       // 主文字
  textSecondary:  '#94a3b8',       // 次级(meta、时间、来源)
  textMuted:      '#64748b',       // 三级(占位、淡说明)

  // 主题色 — 红色
  // 选 red-600(#dc2626)而非 red-500,和 danger(#ef4444)拉开半档亮度避免混淆
  accent:         '#dc2626',       // 主红
  accentHover:    '#b91c1c',       // hover 更深
  accentBg:       '#dc26261a',     // 10% 半透明,active/选中底色
  accentBgStrong: '#dc262633',     // 20% 半透明

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
