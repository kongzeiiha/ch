/**
 * L1 regex blacklist — cheap, deterministic, runs before any LLM call.
 * Three categories illustrate the structure; extend per your domain.
 *
 * Keep entries short and precise. False positives here mean legitimate
 * content gets rejected, so tune with real traffic.
 */

export interface BlacklistHit {
  category: 'politics_sensitive' | 'nsfw_explicit' | 'copyright_watermark';
  pattern: string;
}

const LISTS: { category: BlacklistHit['category']; patterns: RegExp[] }[] = [
  {
    category: 'politics_sensitive',
    patterns: [
      // Intentionally empty placeholder — plug in your regulator-aligned list.
      // e.g. /specific_banned_phrase/i,
    ],
  },
  {
    category: 'nsfw_explicit',
    patterns: [
      /\b(hardcore\s+porn|xxx\s+adult)\b/i,
      // /(露骨色情|赤裸性交)/,
      // ── Chinese soft-NSFW gallery markers commonly seen on
      //    pic-aggregator sites (knit.bid / 2ksg / aizuyun family).
      //    Tune carefully — false positives here block legitimate posts.
      // /(调教|淫荡|裸体|露点|私拍|偷拍|走光|无圣光|无码|福利图|擦边)/,
      // "[写真] ... 80P" gallery + photo-count pattern. The brackets +
      // the "NN P" suffix together is the strongest signal; either alone
      // is fine (e.g. a regular tech article might mention "80P video").
      // /\[写真\][\s\S]{0,80}\d+\s*P\b/,
      // Soft body / fetish phrases. Combined with the gallery context above
      // these are reliable; in plain prose they can be metaphorical, so we
      // require the "NN P" suffix elsewhere in the text.
      // /(低胸|美胸|美腿|大尺度|嫩模|蕾丝|睡袍|内衣|丝袜)[\s\S]{0,60}\d+\s*P\b/,
      // /(粉色妹子|清纯小妹|嫩妹)[\s\S]{0,60}\d+\s*P\b/,
    ],
  },
  {
    category: 'copyright_watermark',
    patterns: [
      /(版权所有[,,]未经授权不得转载)/,
      /©\s*\d{4}.+all\s+rights\s+reserved/i,
      /(shutterstock|gettyimages)\s+watermark/i,
    ],
  },
];

export function runBlacklist(text: string): BlacklistHit[] {
  const hits: BlacklistHit[] = [];
  for (const { category, patterns } of LISTS) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        hits.push({ category, pattern: pattern.source });
      }
    }
  }
  return hits;
}
