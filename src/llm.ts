/**
 * The ONLY file that knows how to talk to a model provider.
 * Grouping, compaction, synthesis and verification all call `LlmClient.generateJson`.
 *
 * Contract:
 * - Every call is stateless: a fresh context made only of `system` + `input`. The caller
 *   owns all state (checkpoints) and never relies on provider-side conversation history.
 * - `schema` is a JSON schema in Gemini dialect (OBJECT/STRING). It is translated here.
 * - Returns parsed JSON. Callers validate it; the transport does not interpret content.
 * - On failure throw Error whose message contains `HTTP <status>` for HTTP errors
 *   (the pipeline stops calling after HTTP 429/503/403) and `Empty <label>` for no output.
 * - `usage` is optional provider-reported usage (tokens), recorded for review only.
 */
export interface LlmRequest {
  label: 'Synthesis' | 'Verification' | 'Grouping' | 'Reconciliation';
  system: string;
  input: unknown;
  schema: unknown;
  temperature: number;
  maxOutputTokens: number;
}
export interface LlmResponse { json: unknown; usage?: Record<string, unknown> }
export interface LlmClient { generateJson(req: LlmRequest): Promise<LlmResponse> }

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'openrouter/auto';

/** Gemini dialect (OBJECT/STRING/ARRAY/BOOLEAN) -> JSON Schema types OpenRouter expects. */
function toJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toJsonSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    out[k] = k === 'type' && typeof v === 'string' ? v.toLowerCase() : toJsonSchema(v);
  }
  return out;
}

/** OpenRouter chat completions. No SDK: one fetch, structured JSON via response_format. */
export function createOpenRouterClient(key: string, model = DEFAULT_MODEL): LlmClient {
  return {
    async generateJson(req) {
      const r = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          temperature: req.temperature,
          max_tokens: req.maxOutputTokens,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: JSON.stringify(req.input) },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: req.label, strict: true, schema: toJsonSchema(req.schema) },
          },
        }),
        signal: AbortSignal.timeout(90000),
      });
      if (!r.ok) throw new Error(`${req.label} HTTP ${r.status}: ${(await r.text()).slice(0, 1000)}`);
      const d = await r.json();
      const text = d.choices?.[0]?.message?.content;
      if (!text || typeof text !== 'string') throw new Error(`Empty ${req.label}`);
      return { json: JSON.parse(text), usage: d.usage };
    },
  };
}

/** Provider selection. Returns undefined when no provider is configured (feature stays off). */
export function createLlmClient(env: Record<string, string | undefined>): LlmClient | undefined {
  return env.OPENROUTER_API_KEY ? createOpenRouterClient(env.OPENROUTER_API_KEY, env.OPENROUTER_MODEL) : undefined;
}

export function asClient(c: LlmClient | string): LlmClient { return typeof c === 'string' ? createOpenRouterClient(c) : c; }
