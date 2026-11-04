# Model-led batched grouping with compaction (branch synthesis-review)

Status: implemented and tested with a mock model only. NOT run against any real model, NOT published, off by default.

## Flow
1. Articles are deduplicated by canonical URL and get a stable id `a_<sha256(url)[:12]>`.
2. They are sorted oldest first and cut into batches by an ESTIMATED token budget (`estTokens = chars/2`, a heuristic, not a measured count). `REALNEWS_GROUPING_BATCH_TOKENS`, default 6000.
3. Each batch is one NEW stateless model call with: fixed instructions, a compact checkpoint of existing stories (`id`, representative title, short brief, count) and the batch's articles (`id`, source, title, lead). No side labels, no earlier prompts, no earlier answers, no other article text.
4. The model returns only ids: each new article goes to an existing checkpoint story id or to a new story key. Code validates that every id was sent, nothing is missing or duplicated, and exactly one target is given. Code then updates the checkpoint.
5. Checkpoint compaction when it exceeds 40% of the batch budget: drop briefs, then drop the smallest and oldest stories from the SENT checkpoint (they stay in state and are recorded in `checkpoint_dropped`; later articles cannot join them, which is a known recall loss).
6. Optional reconciliation (`REALNEWS_GROUPING_RECONCILE=true`, off by default): one call over the compact story descriptors to merge same-event stories across batches. Skipped if the descriptors do not fit the budget. It sees less evidence than the batch pass, so it is the riskiest step.
7. Only after membership is final do the existing stages run: sides-only cited summaries and the verifier.

## Fail closed
Invalid or unusable model output never merges anything: that batch's articles stay separate stories (`status: rejected`). HTTP 429/503/403 or any non-validation error stops further calls (`status: unavailable`) and the remaining articles stay separate. Call cap `REALNEWS_GROUPING_MAX_CALLS` (default 30).

## Evidence and review
`.review/evidence.json` (gitignored, 1-day private artifact on non-published staged runs) now also has `grouping`: per batch ids, estimated size, checkpoint level, dropped stories, exact model input, usage, status and errors. Original articles stay in memory under their stable ids for validation. Story ids `s1..` are run-scoped; group ids are `e_<hash of earliest member id>`; article ids are the stable identifiers.

## Enabling (staged only)
Workflow dispatch with `synthesis=true` and `grouping=true`, `publish=false`. Scheduled runs never enable it. Without a configured provider or flags, the existing exact-headline clustering runs unchanged.

## Provider boundary
`src/llm.ts` is the only provider-specific file. `LlmClient.generateJson({label, system, input, schema, temperature, maxOutputTokens})` returns `{json, usage?}`; contract in the file header. Grouping, reconciliation, synthesis and verification all use it. The current Gemini implementation is kept as is. Replace `createGeminiClient` and `createLlmClient` to change provider. `schema` is still written in Gemini dialect (OBJECT/STRING), so a provider needing another dialect must translate it inside `llm.ts`.

## Not verified
- Real model quality: same-event recall and false merges are unmeasured. The 11 labeled pairs in `test/fixtures/grouping-evaluation.json` are the first thing to run (generation-free baseline was 0/4 recall).
- Token estimates are heuristic. Batch size, 40% checkpoint share and prompt wording are untuned.
- Free-tier rate limits at this call volume (about 5 grouping calls per 90 articles plus summaries and verification).
