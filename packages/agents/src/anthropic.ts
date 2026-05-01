import OpenAI from 'openai';

export type Model = 'opus' | 'sonnet' | 'haiku';

const MODEL_ID: Record<Model, string> = {
  opus:   process.env.GROQ_MODEL_LARGE  ?? 'llama-3.3-70b-versatile',
  sonnet: process.env.GROQ_MODEL_MEDIUM ?? 'llama-3.3-70b-versatile',
  haiku:  process.env.GROQ_MODEL_SMALL  ?? 'llama-3.1-8b-instant',
};

// Groq pricing USD per 1M tokens (as of 2025)
const PRICE: Record<Model, { input: number; output: number }> = {
  opus:   { input: 0.59, output: 0.79 },
  sonnet: { input: 0.59, output: 0.79 },
  haiku:  { input: 0.05, output: 0.08 },
};

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    });
  }
  return _client;
}

export interface SystemBlock {
  text: string;
  cache?: boolean; // no-op for Groq, kept for API compatibility
}

export interface CallOptions {
  model: Model;
  system?: string | SystemBlock[];
  messages: Array<{ role: 'user' | 'assistant'; content: any }>;
  tools?: any[];
  toolChoice?: any;
  maxTokens?: number;
  temperature?: number;
  maxRetries?: number;
}

export interface CallResult {
  model: string;
  content: any[];
  text: string;
  toolUse: { name: string; input: any } | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  latencyMs: number;
  costUsd: number;
}

// Build system text from string or SystemBlock array
function systemText(system: CallOptions['system']): string {
  if (!system) return '';
  if (typeof system === 'string') return system;
  return system.map((s) => s.text).join('\n');
}

// Build OpenAI messages array. When tools are present we inject the schema into
// the system prompt and use JSON mode instead of native function calling — this
// is far more reliable across Groq's small models.
function buildMessages(
  system: CallOptions['system'],
  messages: CallOptions['messages'],
  toolName?: string,
  toolSchema?: any,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  let sysText = systemText(system);
  if (toolName && toolSchema) {
    const schemaStr = JSON.stringify(toolSchema, null, 2);
    sysText =
      `${sysText}\n\n` +
      `你必须以 JSON 格式回复，且 JSON 必须严格符合以下 schema（仅输出 JSON，不要加任何说明文字）：\n` +
      `函数名：${toolName}\n` +
      `Schema：\n${schemaStr}`;
  }
  if (sysText) result.push({ role: 'system', content: sysText });

  for (const m of messages) {
    if (Array.isArray(m.content)) {
      const text = m.content
        .map((b: any) => {
          if (typeof b === 'string') return b;
          if (b.type === 'text') return b.text;
          if (b.type === 'tool_result') return JSON.stringify(b.content ?? '');
          return '';
        })
        .filter(Boolean)
        .join('\n');
      result.push({ role: m.role as any, content: text });
    } else {
      result.push({ role: m.role as any, content: m.content });
    }
  }
  return result;
}

export async function callClaude(opts: CallOptions): Promise<CallResult> {
  const maxRetries = opts.maxRetries ?? 3;
  const modelId = MODEL_ID[opts.model];

  // Determine if we should use JSON mode (forced single-tool call)
  const forcedToolName =
    opts.toolChoice?.type === 'tool' ? opts.toolChoice.name : undefined;
  const forcedTool = forcedToolName
    ? opts.tools?.find((t) => t.name === forcedToolName)
    : undefined;
  const useJsonMode = !!forcedTool;

  let attempt = 0;
  let lastErr: any;

  while (attempt <= maxRetries) {
    const start = Date.now();
    try {
      const messages = buildMessages(
        opts.system,
        opts.messages,
        useJsonMode ? forcedToolName : undefined,
        useJsonMode ? forcedTool.input_schema : undefined,
      );

      const resp = await client().chat.completions.create({
        model: modelId,
        max_tokens: opts.maxTokens ?? 2048,
        temperature: opts.temperature ?? 0.3,
        messages,
        ...(useJsonMode
          ? { response_format: { type: 'json_object' } }
          : opts.tools
          ? {
              tools: opts.tools.map((t) => ({
                type: 'function' as const,
                function: {
                  name: t.name,
                  description: t.description ?? '',
                  parameters: t.input_schema ?? {},
                },
              })),
              ...(opts.toolChoice
                ? {
                    tool_choice: (() => {
                      const tc = opts.toolChoice;
                      if (tc.type === 'tool')
                        return { type: 'function', function: { name: tc.name } };
                      if (tc.type === 'any') return 'required';
                      return 'auto';
                    })(),
                  }
                : {}),
            }
          : {}),
      });

      const latencyMs = Date.now() - start;
      const u = resp.usage;
      const p = PRICE[opts.model];
      const costUsd =
        (((u?.prompt_tokens ?? 0) * p.input) +
          ((u?.completion_tokens ?? 0) * p.output)) /
        1_000_000;

      const msg = resp.choices[0]?.message;
      const rawText = msg?.content ?? '';

      let toolUse: { name: string; input: any } | null = null;

      if (useJsonMode && forcedToolName) {
        // Parse JSON from text response
        try {
          // Strip possible markdown code fences
          const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
          const parsed = JSON.parse(cleaned);
          toolUse = { name: forcedToolName, input: parsed };
        } catch {
          throw new Error(`JSON parse failed for tool ${forcedToolName}: ${rawText.slice(0, 300)}`);
        }
      } else {
        // Normal tool_calls path
        const tc = msg?.tool_calls?.[0];
        if (tc?.type === 'function') {
          try {
            toolUse = { name: tc.function.name, input: JSON.parse(tc.function.arguments) };
          } catch {
            toolUse = { name: tc.function.name, input: {} };
          }
        }
      }

      const text = useJsonMode ? '' : rawText;
      const content: any[] = [];
      if (text) content.push({ type: 'text', text });
      if (toolUse) content.push({ type: 'tool_use', name: toolUse.name, input: toolUse.input });

      return {
        model: modelId,
        content,
        text,
        toolUse,
        usage: {
          input_tokens: u?.prompt_tokens ?? 0,
          output_tokens: u?.completion_tokens ?? 0,
        },
        latencyMs,
        costUsd,
      };
    } catch (e: any) {
      lastErr = e;
      const status: number | undefined = e?.status ?? e?.response?.status;
      const retryable =
        status === 408 ||
        status === 429 ||
        status === 529 ||
        (typeof status === 'number' && status >= 500 && status < 600);
      if (!retryable || attempt === maxRetries) throw e;

      // Honor Retry-After (seconds) from the provider when present — Groq's
      // 429 includes both an HTTP header and "try again in X.XXs" in the body.
      // Without this our 500ms→1s→2s schedule retries before the rate-limit
      // window expires, burning the 3-attempt budget on the same hot minute.
      const headers = e?.headers ?? e?.response?.headers;
      const retryAfterSec = Number(
        headers?.['retry-after'] ?? headers?.['Retry-After'] ?? NaN,
      );
      const bodyMatch = String(e?.message ?? '').match(/try again in ([\d.]+)s/i);
      const hinted = Number.isFinite(retryAfterSec)
        ? retryAfterSec * 1000
        : bodyMatch
        ? Number(bodyMatch[1]) * 1000
        : 0;

      // For 429 use a longer base so concurrent workers don't all retry in lockstep.
      const base = status === 429 ? 2_000 : 500;
      const expo = Math.min(30_000, base * 2 ** attempt);
      const backoff = Math.max(hinted, expo) + Math.random() * 500;
      await new Promise((r) => setTimeout(r, backoff));
      attempt++;
    }
  }
  throw lastErr;
}
