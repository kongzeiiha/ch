// 把采集源的真实名字(@chengrenshipin 之类)在展示层换成一个稳定化名,
// 避免直接暴露上游博主身份。同一个 source_id 永远映射到同一个化名,
// 这样列表 / 详情 / 推荐栏里同一博主的卡片一眼能认出来。
//
// 算法:source_id(UUID)→ 5 位 base36 后缀 → "博主_XXXXX"。
// UUID 有 122 位熵,取 base36 5 位(~26 bit)冲突率在万级源里仍 <0.01%。
// handle 取小写形式直接当 @ 句柄,跟 X 的 handle 风格一致。

export interface VirtualBlogger {
  /** 显示名: "博主_XK4Z2" */
  name: string;
  /** @handle: "@blogger_xk4z2" */
  handle: string;
  /** 首字母,头像里那个色块上的字:"X" */
  initial: string;
}

/**
 * 计算公开站点上博主的显示身份。
 *
 *   - 爬虫源(platform != 'manual'):走哈希化名 — 不暴露真实 @handle,
 *     同一 source_id 永远映射到同一个"博主_XXXXX"。
 *   - 手工源(platform === 'manual'):直接用运营在 /admin/post-new 创建时
 *     填写的 name 当显示名,handle 也基于该 name 派生 — 这是运营有意公开的
 *     虚拟身份,不该被哈希遮蔽。
 *
 *  opts 可选,不传走纯哈希路径 — 旧调用点不破坏。
 */
export function virtualBlogger(
  sourceId: string | null | undefined,
  opts?: { platform?: string | null; name?: string | null },
): VirtualBlogger {
  if (!sourceId) return { name: '匿名博主', handle: '@anonymous', initial: '?' };

  // 手工源:运营自取的名字直接当显示名。
  if (opts?.platform === 'manual' && opts.name && opts.name.trim()) {
    const name = opts.name.trim();
    // handle 用 name 的 ASCII 字符派生,中文名退化为基于 source_id 后缀的 handle
    const asciiOnly = name.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
    const handle = asciiOnly.length >= 3
      ? `@${asciiOnly.slice(0, 20)}`
      : `@blogger_${hashSuffix(sourceId)}`.toLowerCase();
    return { name, handle, initial: name.charAt(0).toUpperCase() };
  }

  // 默认路径:FNV-1a 哈希,稳定 + 跨平台一致。
  const suffix = hashSuffix(sourceId);
  return {
    name:    `博主_${suffix}`,
    handle:  `@blogger_${suffix.toLowerCase()}`,
    initial: suffix.charAt(0),
  };
}

function hashSuffix(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).toUpperCase().slice(0, 5).padStart(5, '0');
}
