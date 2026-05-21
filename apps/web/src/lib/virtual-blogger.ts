// 计算公开站点上博主卡片的显示身份。
//
// 现行策略:**直接使用上游源的真实名字**(sources.name)— 手工源用运营填的
// 名字,爬虫源用采集到的原平台名字。只有在 source 行根本没有 name(罕见
// 兜底场景)时,才退化为基于 source_id 哈希的"博主_XXXXX"。
//
// 早期版本曾把所有爬虫源哈希遮蔽,后取消 — 用户要的是能识别原博主。
//
// handle 仍走派生:从 name 抽出 ASCII 字段当 @ 句柄;中文名没有可派生
// 字段时,handle 退化为基于 source_id 的稳定后缀,保证同一博主每次显示
// 的 @ 一致。

export interface VirtualBlogger {
  /** 显示名: 通常就是 sources.name */
  name: string;
  /** @handle: 基于 name 派生或哈希兜底 */
  handle: string;
  /** 头像色块上的首字 */
  initial: string;
}

export function virtualBlogger(
  sourceId: string | null | undefined,
  opts?: { platform?: string | null; name?: string | null; externalId?: string | null },
): VirtualBlogger {
  if (!sourceId && !opts?.name) {
    return { name: '匿名博主', handle: '@anonymous', initial: '?' };
  }

  // 优先用原平台真实 @handle:X 上是 screen_name(=external_id),其它平台
  // 暂时只有 x 走这条路。这样 "我在故宫胡吃海喝" 这种中文 display name
  // 也能正确显示真实 @urgseukekcbdnrb,而不是哈希出来的 @blogger_XXXXX。
  const realHandle = opts?.platform === 'x' && opts.externalId?.trim()
    ? `@${opts.externalId.trim()}`
    : null;

  const rawName = opts?.name?.trim();
  if (rawName) {
    // handle 优先用真实 @handle;退到从名字 ASCII 派生;最后 sourceId 哈希兜底。
    const asciiOnly = rawName.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
    const handle = realHandle
      ?? (asciiOnly.length >= 3
        ? `@${asciiOnly.slice(0, 20)}`
        : `@blogger_${hashSuffix(sourceId ?? rawName)}`.toLowerCase());
    return { name: rawName, handle, initial: rawName.charAt(0).toUpperCase() };
  }

  // 兜底:没拿到 name — 用 source_id 哈希出一个稳定别名
  const suffix = hashSuffix(sourceId!);
  return {
    name:    `博主_${suffix}`,
    handle:  realHandle ?? `@blogger_${suffix.toLowerCase()}`,
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
