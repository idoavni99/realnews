# Model-led batched grouping with compaction (branch synthesis-review)

Status: implemented and tested with a mock model only. NOT run against any real model, NOT published, off by default.

## Flow
1. Articles are deduplicated by canonical URL and get a stable id `a_<sha256(url)[:12]>`.
2. They are sorted oldest first and cut into batches by an ESTIMATED token budget. `estTokens = chars/2` is a HEURISTIC with no guarantee; the provider's real tokenizer may count more, so keep `batchTokens` (env `REALNEWS_GROUPING_BATCH_TOKENS`, default 6000) well under the real model limit. The budget covers instructions + schema + checkpoint + new articles (measured on the exact JSON payload, wrappers included) + an output reserve (50 + 30 per article, also capped by half of `maxOutputTokens`). Articles are given back to the queue until the payload fits.
3. Each batch is one NEW stateless model call with: fixed instructions, a compact checkpoint of ALL existing stories (`id`, representative title, short brief, count) and the batch's articles (`id`, source, title, lead). No side labels, no earlier prompts, no earlier answers, no other article text.
4. The model returns only ids: each new article goes to an existing checkpoint story id or to a new story key. Code validates that every id was sent, nothing is missing or duplicated, and exactly one target is given. Code then updates the canonical membership.
5. Checkpoint compaction never evicts a story. When the checkpoint exceeds 40% of the batch budget: first drop briefs, then shorten titles to 50 chars. Ids, counts and membership are always kept. If even the shortest form cannot leave room for one article, semantic grouping STOPS: that batch is recorded `unresolved`, no further model calls are made, and all remaining articles are left as unvalidated placeholders.
6. Optional reconciliation (`REALNEWS_GROUPING_RECONCILE=true`, off by default): one call over the compact story descriptors to merge same-event stories across batches. Skipped (and the run marked incomplete) if the descriptors do not fit the budget or any article is unvalidated. It sees less evidence than the batch pass, so it is the riskiest step.
7. Only after membership is final do the existing stages run: sides-only cited summaries and the verifier.

## Fail closed, and what is NOT validated
Each group has `grouping: 'model_validated' | 'unvalidated'`. Invalid or unusable model output (`rejected`), HTTP 429/503/403 or any transport error (`unavailable`), the call cap (`skipped`), no provider, or an unfit checkpoint (`unresolved`) never merge anything, and the affected articles become separate **unvalidated** placeholders. A placeholder is not evidence that an article is a distinct event. The pipeline gives unvalidated stories NO generated summary (`synthesis_status: grouping_unvalidated`) and tags them `grouping_status: 'unvalidated'`. The result has `complete` (false if any article is unvalidated or an enabled reconcile did not finish) and `unvalidated_articles`; `data.json` carries `grouping: {mode, complete, unvalidated_articles}` whenever model grouping ran, so a partial run cannot pass as complete. Call cap `REALNEWS_GROUPING_MAX_CALLS` (default 30).

## Evidence and review
`.review/evidence.json` (gitignored, 1-day private artifact on non-published staged runs) now also has `grouping`: per batch ids, estimated size, checkpoint level, dropped stories, exact model input, usage, status and errors. Original articles stay in memory under their stable ids for validation. Story ids `s1..` are run-scoped; group ids are `e_<hash of earliest member id>`; article ids are the stable identifiers.

## Enabling (staged only)
Workflow dispatch with `synthesis=true` and `grouping=true`, `publish=false`. Scheduled runs never enable it. Without a configured provider or flags, the existing exact-headline clustering runs unchanged.

## Provider boundary
`src/llm.ts` is the only provider-specific file. `LlmClient.generateJson({label, system, input, schema, temperature, maxOutputTokens})` returns `{json, usage?}`; contract in the file header. Grouping, reconciliation, synthesis and verification all use it. The transport is OpenRouter (`OPENROUTER_API_KEY`, optional `OPENROUTER_MODEL`, default `openrouter/auto`) via `fetch` to `/api/v1/chat/completions`. Callers still pass Gemini-dialect schemas (OBJECT/STRING); `llm.ts` lowercases those types into JSON Schema.

## Not verified
- Real model quality: same-event recall and false merges are unmeasured. The 11 labeled pairs in `test/fixtures/grouping-evaluation.json` are the first thing to run (generation-free baseline was 0/4 recall).
- Token estimates are heuristic with no hard guarantee. Batch size, 40% checkpoint share and prompt wording are untuned. With roughly 100+ stories the checkpoint can stop fitting, which stops grouping as incomplete rather than evicting stories.
- Free-tier rate limits at this call volume (about 5 grouping calls per 90 articles plus summaries and verification).
