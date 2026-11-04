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
export interface LlmDiagnostics { requested_model: string; model?: string; provider?: string; finish_reason?: string; native_finish_reason?: string; usage?: Record<string, unknown>; content_chars: number; http_status?: number; retry_after?: string }
export class LlmOutputError extends Error {
  diagnostics?: LlmDiagnostics;
  constructor(message: string, diagnostics?: LlmDiagnostics) { super(message); this.name = 'LlmOutputError'; this.diagnostics = diagnostics; }
}
export interface LlmResponse { json: unknown; usage?: Record<string, unknown>; diagnostics?: LlmDiagnostics }
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
          provider: { require_parameters: true },
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
      if (!r.ok) throw new LlmOutputError(`${req.label} HTTP ${r.status}`, {requested_model:model,content_chars:0,http_status:r.status,retry_after:r.headers.get('retry-after')?.slice(0,120)});
      const d = await r.json();
      const c = d.choices?.[0];
      const text = c?.message?.content;
      const diagnostics: LlmDiagnostics = { requested_model: model, model: d.model, provider: d.provider,
        finish_reason: c?.finish_reason, native_finish_reason: c?.native_finish_reason,
        usage: d.usage, content_chars: typeof text === 'string' ? text.length : 0 };
      if (c?.finish_reason === 'length') throw new LlmOutputError(`Truncated ${req.label}: output token limit`, diagnostics);
      if (!text || typeof text !== 'string') throw new LlmOutputError(`Empty ${req.label}`, diagnostics);
      let json: unknown;
      try { json = JSON.parse(text); }
      catch { throw new LlmOutputError(`Invalid JSON ${req.label}`, diagnostics); }
      return { json, usage: d.usage, diagnostics };
    },
  };
}

/** Provider selection. Returns undefined when no provider is configured (feature stays off). */
export function createLlmClient(env: Record<string, string | undefined>): LlmClient | undefined {
  return env.OPENROUTER_API_KEY ? createOpenRouterClient(env.OPENROUTER_API_KEY, env.OPENROUTER_MODEL) : undefined;
}

export function asClient(c: LlmClient | string): LlmClient { return typeof c === 'string' ? createOpenRouterClient(c) : c; }
