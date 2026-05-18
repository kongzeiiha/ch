// 线条风简洁 SVG 图标集 — 替代 emoji,跨平台渲染一致。
// 风格:24×24 viewBox,stroke=2,linecap/linejoin=round,inherit currentColor。
// 都是自绘的通用形状,不复刻任何商业产品的具体图标设计。

interface IconProps {
  size?: number;
  filled?: boolean;
}

function base({ size = 24 }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
}

export function HomeIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M3 11.5 12 3l9 8.5V21h-6v-7H9v7H3z" fill={p.filled ? 'currentColor' : 'none'} />
    </svg>
  );
}

export function FlameIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 3c2 4 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3-1-3 0-6 1-8z" fill={p.filled ? 'currentColor' : 'none'} />
    </svg>
  );
}

export function PlayIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="3" y="5" width="18" height="14" rx="3" fill={p.filled ? 'currentColor' : 'none'} />
      <path d="M10 9.5v5l4-2.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ImageIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="3" y="4" width="18" height="16" rx="3" fill={p.filled ? 'currentColor' : 'none'} />
      <circle cx="9" cy="10" r="1.6" fill="currentColor" stroke="none" />
      <path d="m4 18 5-5 4 4 3-3 4 4" />
    </svg>
  );
}

export function HashIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16" />
    </svg>
  );
}

export function NewspaperIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="3" y="5" width="18" height="14" rx="2" fill={p.filled ? 'currentColor' : 'none'} />
      <path d="M7 9h10M7 13h10M7 17h6" />
    </svg>
  );
}

export function SearchIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </svg>
  );
}

export function CogIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8h0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

export function UsersIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="9" cy="8" r="3.5" fill={p.filled ? 'currentColor' : 'none'} />
      <circle cx="16" cy="9" r="2.5" fill={p.filled ? 'currentColor' : 'none'} />
      <path d="M3 20c0-3 3-5 6-5s6 2 6 5" />
      <path d="M14 16c1-1.5 3-2 4-2s3 1 3 3" />
    </svg>
  );
}

export function StarIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.9-5.2-2.8L6.8 19.2l1-5.9L3.5 9.2l5.9-.9z" fill={p.filled ? 'currentColor' : 'none'} />
    </svg>
  );
}

// Action row 图标:评论 / 转发 / 点赞 / 浏览 / 分享
export function CommentIcon(p: IconProps) {
  return (
    <svg {...base({ ...p, size: p.size ?? 18 })}>
      <path d="M21 12a8 8 0 0 1-12 7L4 21l1-4a8 8 0 1 1 16-5z" />
    </svg>
  );
}

export function RepostIcon(p: IconProps) {
  return (
    <svg {...base({ ...p, size: p.size ?? 18 })}>
      <path d="m4 8 4-4 4 4M8 4v12h8M20 16l-4 4-4-4M16 20V8H8" />
    </svg>
  );
}

export function HeartIcon(p: IconProps) {
  return (
    <svg {...base({ ...p, size: p.size ?? 18 })}>
      <path d="M12 21s-7-4.35-7-10.5C5 7.4 7.4 5 10.5 5 12 5 13.3 5.7 14 7c.7-1.3 2-2 3.5-2C20.6 5 23 7.4 23 10.5 23 16.65 16 21 16 21" transform="translate(-2 0)" fill={p.filled ? 'currentColor' : 'none'} />
    </svg>
  );
}

export function EyeIcon(p: IconProps) {
  return (
    <svg {...base({ ...p, size: p.size ?? 18 })}>
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" fill={p.filled ? 'currentColor' : 'none'} />
    </svg>
  );
}

export function ShareIcon(p: IconProps) {
  return (
    <svg {...base({ ...p, size: p.size ?? 18 })}>
      <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 3v13M7 8l5-5 5 5" />
    </svg>
  );
}
