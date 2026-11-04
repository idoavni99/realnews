/**
 * The ONLY file that knows how to talk to a model provider.
 * Grouping, compaction, synthesis and verification all call `LlmClient.generateJson`.
 * To change provider (e.g. OpenRouter), replace `createGeminiClient` / `createLlmClient`
 * and keep this contract; no orchestration code needs to change.
 *
 * Contract:
 * - Every call is stateless: a fresh context made only of `system` + `input`. The caller
 *   owns all state (checkpoints) and never relies on provider-side conversation history.
 * - `schema` is a JSON schema (Gemini OBJECT/STRING style today). A provider that needs
 *   a different dialect translates it here.
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

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent';

/** Existing Gemini transport, behavior unchanged from before the interface was extracted. */
export function createGeminiClient(key: string): LlmClient {
  return {
    async generateJson(req) {
      const r = await fetch(GEMINI_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ parts: [{ text: JSON.stringify(req.input) }] }],
          generationConfig: { temperature: req.temperature, responseMimeType: 'application/json', responseSchema: req.schema, maxOutputTokens: req.maxOutputTokens },
        }),
        signal: AbortSignal.timeout(90000),
      });
      if (!r.ok) throw new Error(`${req.label} HTTP ${r.status}: ${(await r.text()).slice(0, 1000)}`);
      const d = await r.json();
      const text = d.candidates?.[0]?.content?.parts?.filter((p: { text?: string; thought?: boolean }) => p.text && !p.thought).map((p: { text: string }) => p.text).join('');
      if (!text) throw new Error(`Empty ${req.label}`);
      return { json: JSON.parse(text), usage: d.usageMetadata };
    },
  };
}

/** Provider selection. Returns undefined when no provider is configured (feature stays off). */
export function createLlmClient(env: Record<string, string | undefined>): LlmClient | undefined {
  return env.GEMINI_API_KEY ? createGeminiClient(env.GEMINI_API_KEY) : undefined;
}

export function asClient(c: LlmClient | string): LlmClient { return typeof c === 'string' ? createGeminiClient(c) : c; }
