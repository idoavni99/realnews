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
Each group has `grouping: 'schema_assigned' | 'unvalidated'`. Invalid or unusable model output (`rejected`), HTTP 429/503/403 or any transport error (`unavailable`), the call cap (`skipped`), no provider, or an unfit checkpoint (`unresolved`) never merge anything, and the affected articles become separate **unvalidated** placeholders. A placeholder is not evidence that an article is a distinct event. The pipeline gives unvalidated stories NO generated summary (`synthesis_status: grouping_unvalidated`) and tags them `grouping_status: 'unvalidated'`. The result has `complete` (false if any article is unvalidated or an enabled reconcile did not finish) and `unvalidated_articles`; `data.json` carries `grouping: {mode, complete, unvalidated_articles}` whenever model grouping ran, so a partial run cannot pass as complete. Call cap `REALNEWS_GROUPING_MAX_CALLS` (default 30).

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

Schema assignment checks IDs and shape only, not event coherence. The Nov4 free-router run produced false merges despite schema-valid assignments; see test/fixtures/free-router-false-merges.json. Any group containing an unvalidated member remains unvalidated. Do not treat complete=true as a quality score.

## Local fixed sample
`OPENROUTER_API_KEY` supplied securely to `node scripts/sample-grouping.ts` runs ten fixed articles (two known paraphrase pairs and three captured unrelated false-merge pairs), with at most two grouping calls, no synthesis and no feed fetch or publication. Route is hardcoded to `openrouter/free`. One member per pair enters each batch. Output defaults to `/tmp/realnews-sample.json`. A schema-assigned answer is scored against the fixed labels separately; unvalidated pairs are not counted as model decisions.

The transport now requests `provider.require_parameters=true`, keeps model/provider/finish reason/usage metadata, and fails explicitly on length truncation, missing content and non-JSON. Raw malformed answer text is not logged. This improves diagnostics and routing compatibility; it does not prove event coherence or native strict-schema enforcement by every endpoint.

The sample caps articles per batch independently (`maxArticlesPerBatch:5`) while requesting2000completion tokens. `SAMPLE_MAX_CALLS=1` limits a diagnostic rerun to one call. A400token output cap exhausted all tokens in reasoning and returned zero answer characters in the first local test;2000allowed the same selected free model to return valid JSON (1244completion tokens,1067reasoning). The second batch was deliberately skipped at the approved aggregate call cap; pair recall/false-merge rates remain unmeasured.

`node scripts/sample-continuation.ts` performs ONE additional call from the five accepted singletons in `/tmp/realnews-sample-second.json` (or `SAMPLE_PREVIOUS`). Requires separate approval after a call bound is exhausted. It writes `/tmp/realnews-sample-continuation.json` and never starts the full pipeline.

Nov4 local targeted outcome: first call hit length after400reasoning tokens and no content; second call with2000allowance returned valid assignments for five unrelated articles. Separately approved continuation joined2/2known paraphrases and separated3/3known unrelated pairs, manually checked against IDs and titles. Router switched from Nvidia Nemotron3.5SuperVL to Dots3NotePreview between accepted batches. All three reported cost0 (5920tokens total). This is a tiny, selected regression sample, not general recall/precision evidence, a fixed-model benchmark, or permission to publish. Earlier full-feed false merges remain unresolved outside this sample.

`node scripts/evaluate-grouping.ts` is the broader labelled grouping-only check:22unique archived articles,14pair labels (4positives/10negatives), max4free-router calls,6articles/batch,4000completion-token cap. Pass requires complete grouping AND all14labels correct. Unscored pairs never count as passes. Nov4 first attempt stopped on upstream HTTP429 before any assignments; no semantic score or release authorization condition was satisfied. No automatic retry/fallback to paid routing.

Auto experiment requires explicit `EVALUATION_MODEL=openrouter/auto` and preflights GET/api/v1/key for a non-resetting lifetime cap <=$2 (the separately approved Nov4experiment bound); free remains default. Nov4auto result:4calls,$0.00234090612sum of response costs,14406tokens;3accepted batches/1unknown-story-ID rejection,6unvalidated articles.8pair checks correct/6unscored, so release gate failed. Immediate key-usage ledger lagged response costs; do not call that difference zero cost.

Existing-story ID field is now constrained by a per-call schema enum matching checkpoint IDs, plus empty string for no existing target. Runtime ID validation remains authoritative and rejects the whole batch on unknown IDs; no repair guesses. Bounded assignment IDs are retained in private batch diagnostics to make future contract failures inspectable. Schema enum bytes are included in heuristic input-budget estimation. No claim this prevents all provider noncompliance or semantic false merges.

Batch order is source-round-robin, not source-by-source: one article from each active source per round, with that round's source heads sorted by publication time. Each source queue stays chronological. Token/article boundaries keep the cursor, exhausted sources drop out, and late coverage is never excluded by a time threshold. Source fairness takes precedence over a globally closest-time ordering. Fixtures normalize known outlet aliases (Ynet/ynet etc.) for fair scheduling; owner ideology tags are unchanged.

Assignment schema uses an explicit oneOf for nonempty story_id versus nonempty new_key. Both-field ambiguity remains an error; the application never guesses which target the model intended.

Current assignment wire contract supersedes the earlier XOR/oneOf shape: every row has exactly required `article_id` and `target`. Article ID is an enum of the sent batch; target is an enum of checkpoint story IDs plus new:1..new:N, with shared new tokens forming a new group. No optional mutually exclusive fields or schema branching. Runtime still rejects missing/duplicate/invented IDs, unknown targets, extra fields and incomplete coverage. It never reconstructs omitted IDs or repairs previous malformed outputs. Transport mock checks confirm flat schema survives JSON-schema conversion. This improves contract simplicity; live provider compliance remains untested after the change.

## Preflight and release safety (November 4)

Grouping and synthesis are independent opt-ins. Requesting a model stage without a
provider, or an invalid numeric configuration, fails before ingestion/network I/O.
Batch estimates include the exact candidate's schema and payload and the full
requested completion allowance. They are character heuristics, not measured
context-token guarantees; a reasoning model can still exhaust its output budget.
No checkpoint story is evicted. Original article evidence remains in the group;
checkpoint compaction is deliberately lossy. Publication ranges and latest member
metadata survive compaction, but short titles are not event verification.

Incomplete grouping saves `.review/staged-data.json` and evidence, then fails
without overwriting `site/data.json`. The workflow's publication gate separately
rejects incomplete membership, failed summaries and experimental data lacking
human quality approval bound to the exact parsed JSON SHA-256. An approval file
is never created by an evaluator. No current experimental run has this approval.
Staged UI renders warn on incomplete membership and suppress misleading coverage
and absent-side assertions on unvalidated groups.

Every pipeline model attempt is recorded in review evidence with its stage,
returned routing/usage diagnostics when available, or bounded failure metadata.
Missing usage is counted, not treated as zero cost; the provider key ledger remains
the spending source of truth. Summary cache reuse is off unless explicitly enabled,
and fingerprints include the requested route, not a guarantee of the same auto model.

The labelled evaluator preserves original dates where available and otherwise
sends null, never synthetic source publication times. It reports pair-label
performance only, not temporal quality or release approval. Its estimated total
batch budget is 10000, including the unchanged 4000 completion allowance; call cap
remains four. Do not run it without the separately approved inference scope.

Clarified owner intent: missing publication time skips temporal ordering, NOT
history compaction. If any input timestamp is missing/invalid, preserve input
order within outlets and outlet encounter order in rounds. Continue the same
round-robin across batch boundaries, without guessed dates or hash/epoch sorting.
If all dates are known, chronological outlet queues and time-ordered heads apply.
Checkpoint compaction remains independently governed by the context budget.


## Authorized scheduled grouping rollout

Owner requested recurring auto grouping using the existing Actions key after
being told the observed sample price is not a full-feed price. Do not replace
that secret, change billing/top-ups, or enable generated summaries. Actions repo
variables `REALNEWS_GROUPING=model`, `OPENROUTER_MODEL=openrouter/auto`, and
`REALNEWS_AUTOPUBLISH_GROUPING=true` opt scheduled runs into this mode. Summary
flag stays false. Model grouping still obeys the per-run call cap and fails closed
if unavailable/incomplete; old site data stays unchanged. No numerical lifetime
cap is inferred for the owner's separate Actions key.

The publication gate accepts complete grouping-only data under that explicit
opt-in, without a human approval file for each digest. This is technical contract
validation, not independent event verification. The site labels automatic grouping
as fallible. Generated summaries still require exact-data quality approval; the
opt-in cannot bypass incomplete membership, failed summaries or unvalidated groups.
