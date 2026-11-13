# Default decision stages

This PR adds an offline-tested integration, not a quality-tested deployment. On merge, grouping and enabled-summary verification use Decisions by default. There is no grouping/verification opt-in flag. The synthesis model, current public data and coverage percentages are unchanged by the PR itself. This PR is still a draft and has not been merged or run. No provider call or new account is needed to run `npm test`.

## Configuration and activation boundary

The owner requested Decisions as the default, without a toggle. The pipeline therefore always uses decision grouping, and uses decision verification whenever synthesis runs. The workflow grouping input and legacy publication-enable variable are no longer consulted. Structural publication checks, invalid-summary removal and partial-edition checks remain intact. No repository setting or secret was changed, no workflow was dispatched, and nothing runs from this unmerged branch.

The owner selected `perplexity/pplx-decider-v1.3:free` for grouping and verification on November 13, 2026. This is the selected primary model. No provider request has been made. The owner selected a provisional 0.80 threshold for grouping and every verification check. This is not calibrated on Hebrew news, and it is not an 80% end-to-end accuracy guarantee. Synthesis remains unchanged.

The owner also selected `liquid/d1.1` and `typesafe/jev-1.14` as fallback candidates. The owner confirmed the order Perplexity, then Liquid, then Jev, only for provider unavailability or rate limits. The implemented chain advances on HTTP 408, 429, 500, 502, 503 and 504. It does not advance on valid answers, malformed output, evidence-size failure, content filtering, authentication, invalid requests or exhausted credits. Ambiguous network failures/timeouts without an HTTP response fail closed because completion and billing are unknown. Every actual provider attempt is separately audited and consumes the existing grouping cap or shared synthesis/verification cap, including failed attempts. No attempt cap is increased. The owner allocated the existing funded OpenRouter balance to realnews. No top-up, new billing or unrelated allocation is authorized. This unmerged draft performs no calls; provider access and funded balance have not been inspected. A valid negative or uncertain decision is not a transport failure and must not silently trigger another paid opinion.

Running the pipeline requires:

- `OPENROUTER_API_KEY`, server-side, as before.
- `REALNEWS_DECISION_MODEL` may explicitly override the selected Perplexity model with a compatible Decisions catalog model. An empty value or `openrouter/auto` is rejected; fallback follows only the approved configured order and trigger rules.
- `REALNEWS_DECISION_THRESHOLD` can override the selected 0.80 threshold. Missing or empty configuration uses 0.80. An override must be greater than 0.5 and less than 1. No threshold has been calibrated for Hebrew news in this PR.

`openrouter/auto` is unsupported on Decisions in the current catalog and rejected locally. It stays unchanged for generative synthesis. Decisions use `POST https://openrouter.ai/api/alpha/decisions`, not chat completions. The endpoint is alpha and its contract can change.

The adapter sends no generation, reasoning, temperature or output-budget parameters. It validates every required answer's type and finite probability. Missing or malformed answers, oversized requests and HTTP errors fail closed. There is no same-provider retry. The approved fallback chain applies only to the documented unavailability/rate-limit HTTP statuses. Failed or unsettled requests have unknown cost unless usage was returned, never an assumed zero.

## Grouping behavior

Code maintains stable article IDs and groups in the existing source round-robin order. The first unique article starts a singleton without inference. For each later article, a single request asks separate same-event questions against every member of every valid existing group. Grouping still sees title, publication time and at most 280 lead characters per article; lead truncation is explicitly marked. Publication time is not event time.

An article joins only if every member of exactly one group passes the configured threshold. No matching group, uncertain answers or multiple matching groups leave it as a separate valid story. The algorithm does not turn pairwise links into connected components: A-B and B-C acceptance cannot override an A-C rejection. Grouping remains order-sensitive, as discussed before implementation.

A transport/contract/size failure keeps that article and remaining articles as internal standalone stories marked unvalidated, which the existing publication policy omits from the edition. This differs from valid low-confidence answers, which remain separate published-eligible stories. A call-cap stop also holds remaining articles back. Existing valid groups remain available to the existing partial-publication policy. There is no lexical merge fallback and no new policy hiding coverage percentages.

There are at most N-1 grouping requests for N unique articles. The number of pair questions can be N(N-1)/2. This is a different cost/runtime shape from the old batch assignment call. `REALNEWS_GROUPING_MAX_CALLS` still caps grouping requests, not pair questions. The existing default cap can therefore stop a larger edition before all articles are assigned. No larger cap is silently granted here.

A conservative 60,000-byte request envelope rejects oversized evidence without truncating it further. This is an application safety bound, not the provider's tokenizer or advertised context guarantee. Larger feeds may remain partial. Candidate retrieval or a new batch algorithm would be a separate design decision.

## Verification behavior

Synthesis remains generative. Decision verification asks named checks for same event, source support, side attribution, negation, uncertainty, quantities and readable Hebrew. Every check must pass. The existing deterministic citation/side and number-presence validation runs before inference and remains active; it is not complete semantic or numeric verification.

Reasons such as `decision_check_not_accepted:uncertainty` are application-owned check labels, not generated explanations of a specific factual error. A low probability is lack of acceptance, not proof the text is wrong. Verification sees the existing maximum of 4,000 evidence characters per article with the existing truncation flags, not necessarily full articles.

The summary cache key includes decision model, threshold and policy version. Old LLM-verified cache entries and differently configured decision policies cannot bypass this verifier. Accepted summaries remain cached within the matching policy. The existing three-round retry loop and per-run synthesis/verification call cap remain in place; each physical fallback attempt also consumes the shared synthesis/verification cap, regardless of predicate count. Exhausting that cap stops before contacting the next provider.

## Evidence and next gate

Offline tests cover transport/contract shape, malformed answers, no-network size rejection, unique membership, ambiguity, transitive-chain prevention, uncertainty, failure/call caps, cache isolation and the synthesis-to-decision-verifier handoff. Mocks test control flow, not semantic model quality or real-provider compatibility.

Before a real-provider evaluation: confirm account access and remaining funded allocation, label independent Hebrew news cases, evaluate without publishing, calibrate the threshold, and measure billed input and latency. Existing provider-attempt caps remain unchanged. Include same topic/different event, later coverage of one event, missing event times, conflicting places, altered quantities, reversed negation, allegation changed to fact, cross-side claims, valid paraphrases and embedded adversarial instructions. Include true positives so a verifier that rejects everything cannot pass. Repeat option/article order where relevant. No such provider evaluation was run for this PR.

## Sources checked November 13, 2026

- https://openrouter.ai/api/v1/models?output_modalities=decisions
- https://openrouter.ai/api/v1/models?q=openrouter%2Fauto&output_modalities=all
- https://openrouter.ai/docs/guides/routing/routers/auto-router
- https://openrouter.ai/docs/guides/community/jev-tutorial
- https://openrouter.ai/docs/guides/community/typesafe-sdk
- https://docs.typesafe.ai/models
- https://docs.typesafe.ai/model-jaggedness
- https://docs.typesafe.ai/cookbooks/verify_llm_outputs.md

The current OpenRouter catalog lists Jev 1.14 and 1.13 at $0.042 per million input tokens with free output. This is not free inference or a quote per edition. TypeSafe direct and OpenRouter advertise different context defaults; do not combine deployment-specific limits. Availability in the public catalog does not establish this account's key access, credit balance or permission to spend.
