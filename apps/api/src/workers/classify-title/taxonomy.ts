/**
 * First-pass taxonomy. Keep it coarse — easier for the LLM, easier to adjust.
 * Categories are the public-facing Chinese labels stored directly on items.
 */
export const CATEGORIES = [
  'AI',
  // '硬件',
  // '软件工程',
  // '网络安全',
  // '互联网产品',
  // '创业与投资',
  // '金融市场',
  // '加密货币',
  // '物理与天文',
  // '生命科学',
  // '气候与环境',
  // '政治与政策',
  // '社会新闻',
  '文化艺术',
  // '生活方式',
  '探花',
  '丝袜',
  '偷拍',
  '调教',
  '自拍',
  '熟女',
  '自慰',
  '动漫',
  '萝莉',
  'SM',
  '剧情',
  '网曝门',
  '美乳',
  '内射',
  '口射',
  '巨乳',
  '反差',
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
