/**
 * 广告检测 — 用于"首条置顶若是广告则过滤"规则。
 *
 * 不走 LLM,走关键词命中:成本零,延迟零,假阳率比纯 LLM 低
 * (LLM 容易把"会员价 9.9"这种正文里的内容也判成广告)。
 * 命中两个或以上才算广告,降低单关键词误杀。
 */

// 推广 / 商业引流的高信号词
const AD_TOKENS = [
  '推广', '广告', '招商', '代理', '加盟',
  '优惠', '限时', '福利专享', '免费领',
  '加微', '加群', '私聊', '私我', '扫码', '点击链接',
  '飞机', 'telegram', 'tg 群', '联系客服',
  '包月', '包年', '永久会员', '会员价',
  '官网', '官方网址', '注册送', '邀请码',
];

// 短链域名 — 单独出现一两个属于正常分享,跟其他广告词共存就是广告强信号
const SHORTLINK_DOMAINS = ['bit.ly', 't.co', 'tinyurl', 'lnk.to', 'goo.gl', 'rb.gy'];

// 强信号正则(单独命中算 1 个,跟关键词叠加更稳)
const STRONG_PATTERNS: Array<{ name: string; re: RegExp }> = [
  // 微信号别名:vx + 数字/字母 / wx + 数字 / 微信号: / wechat: / v 信
  { name: 'wechat-id', re: /\b(?:vx|wx)\s*[:：]?\s*[a-z0-9_-]{3,}\b|微信号|v\s*信|wechat\s*[:：]/i },
  // QQ 号广告
  { name: 'qq-id', re: /\bq\s*q\s*[:：]?\s*\d{5,}\b|qq群\s*\d/i },
  // 3 个及以上 @ mention(垂钓引流的典型)
  { name: 'mention-spam', re: /(?:@\S+[\s,;。]+){3,}/ },
];

export interface AdCheckResult {
  isAd: boolean;
  /** 命中的具体词,debug 用 */
  hits: string[];
}

export function checkAd(text: string | null | undefined): AdCheckResult {
  if (!text) return { isAd: false, hits: [] };
  const lower = text.toLowerCase();
  const hits: string[] = [];
  let strongMatched = false;

  for (const tok of AD_TOKENS) {
    if (lower.includes(tok.toLowerCase())) hits.push(tok);
  }
  for (const d of SHORTLINK_DOMAINS) {
    if (lower.includes(d)) hits.push(d);
  }
  for (const { name, re } of STRONG_PATTERNS) {
    if (re.test(text)) {
      hits.push(name);
      strongMatched = true;
    }
  }

  // 判定规则:
  //   - 强信号正则(wechat-id / qq-id / mention-spam)单独命中即广告 — 这些
  //     模式在普通博文里几乎不会出现,误杀风险低。
  //   - 普通关键词阈值 ≥2,避免单个"优惠"误杀。
  return { isAd: strongMatched || hits.length >= 2, hits };
}
