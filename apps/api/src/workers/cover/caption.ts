import { callClaude, type Model } from '@ch/agents';

const MAX_COPY = 14;

/**
 * Short overlay phrase rendered on top of the cover image. Optional — the
 * pipeline doesn't block on caption failure.
 */
export async function generateCaption(
  title: string,
  opts: { model?: Model } = {},
): Promise<{ text: string; cost: number; model: string; usage: any } | null> {
  try {
    const r = await callClaude({
      model: opts.model ?? 'haiku',
      maxTokens: 48,
      temperature: 0.4,
      messages: [
        {
          role: 'user',
          content: `为下面的文章标题写一条封面短语,要求:
- 不超过 ${MAX_COPY} 个汉字
- 中文,有画面感或情绪
- 只输出短语本身,不要引号、不要解释

标题:${title}`,
        },
      ],
    });
    const text = r.text
      .trim()
      .replace(/^[『「《"]|[』」》"]$/g, '')
      .slice(0, MAX_COPY);
    if (!text) return null;
    return { text, cost: r.costUsd, model: r.model, usage: r.usage };
  } catch {
    return null;
  }
}
