/**
 * First-pass taxonomy. Keep it coarse — easier for the LLM, easier to adjust.
 * Categories are the public-facing Chinese labels stored directly on items.
 */
// 顺序很重要 — rule classifier 用 strict `>` 比较打分,先到先得。
// 把更"具体"的分类(番号 / 美乳 / 美腿)放在更"宽泛"的(探花 / 调教 /
// 剧情)前面,避免被宽规则抢走。'其他' 永远放最后做兜底。
export const CATEGORIES = [
  'AI',
  '文化艺术',
  // ── 高特征性 ──
  '番号',      // AV 编号:MIAB-358 / MVSD-542 等(letter-letter-数字)
  '潮吹',
  '颜射',
  '内射',
  '口射',
  '美乳',
  '巨乳',
  '美腿',
  '美臀',
  '丝袜',
  '黑丝',
  '肛交',      // 肛交/菊花/后庭/后入(91porny 高频特征类)
  '孕妇',      // 孕妇/怀孕(独立 fetish 类别)
  '制服',      // JK / 制服 / 角色扮演
  '露出',      // 户外露出 / 公共
  '熟女',
  '萝莉',
  '反差',
  '多人',      // 3P / 4P / 多人运动
  // ── 关系/身份类别 ──
  'NTR',       // 出轨/绿帽/绿奴/换妻/淫妻/偷情(关系背叛主题)
  '网红',      // 网红/主播/明星/idol/抖音/推特 等流量类
  // ── 行为 / 场景 ──
  '足控',      // 足穴/玉足/丝足/腿法
  '校园',      // 校花/班花/学姐/学妹/idol
  '投稿',      // 女友分享/投稿/网友投稿 — UGC 类
  '自拍',
  '偷拍',
  '探花',      // 探花/约炮系列
  '自慰',
  'SM',
  '动漫',
  '剧情',
  '调教',
  '网曝门',
  '其他',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const TAXONOMY_PROMPT = `你是内容分类助手。请为一篇文章选择**一个**最合适的分类,并抽取标签与关键词。

可选分类(只能从下列中选一个,返回的 category 必须完全一致):
${CATEGORIES.map((c) => `- ${c}`).join('\n')}

规则:
- category 必须是上面列表中的精确文本。
- tags 3-8 个,短语形式(每个不超过 6 字),反映文章主题/实体/技术栈。
- keywords 3-10 个,用于 SEO,包含可能的搜索词。
- 中英文视正文语言而定,tags/keywords 都用原文语言即可。
- 如果无法确定分类,请选择 "其他"。`;
