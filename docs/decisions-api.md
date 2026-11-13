# Opt-in decision stages

This PR adds an offline-tested integration, not a quality-tested deployment. Existing workflow defaults, scheduled stages, synthesis model, public data and coverage percentages are unchanged. No provider call or new account is needed to run `npm test`.

## Configuration and activation boundary

Decision stages remain off unless the process explicitly sets `REALNEWS_GROUPING=decisions` and/or `REALNEWS_VERIFICATION=decisions`. No workflow input, repository variable or secret is changed by this PR. Existing `model` grouping and LLM verification remain available until a separately approved activation.

The owner selected `perplexity/pplx-decider-v1.3:free` for grouping and verification on November 13, 2026. This is now the default decision-model configuration only. Both decision stages remain off, no threshold is configured, and no provider request has been made. Synthesis remains unchanged.

The owner also selected `liquid/d1.1` and `typesafe/jev-1.14` as fallback candidates. Their IDs are recorded in `DISABLED_FALLBACK_CANDIDATES`, in the order mentioned, but no runtime failover consumes this list. Fallback order, triggering conditions, provider-attempt accounting and an approved paid budget must be settled before implementing or enabling failover. A valid negative or uncertain decision is not a transport failure and must not silently trigger another paid opinion.

An enabled decision stage requires:

- `OPENROUTER_API_KEY`, server-side, as before.
- `REALNEWS_DECISION_MODEL` may explicitly override the selected Perplexity model with a compatible Decisions catalog model. An empty value or `openrouter/auto` is rejected; there is no provider fallback.
- `REALNEWS_DECISION_THRESHOLD`, an explicitly evaluated acceptance threshold greater than 0.5 and less than 1. No threshold has been calibrated for Hebrew news in this PR.

`openrouter/auto` is unsupported on Decisions in the current catalog and rejected locally. It stays unchanged for generative synthesis. Decisions use `POST https://openrouter.ai/api/alpha/decisions`, not chat completions. The endpoint is alpha and its contract can change.

The adapter sends no generation, reasoning, temperature or output-budget parameters. It validates every required answer's type and finite probability. Missing or malformed answers, oversized requests and HTTP errors fail closed. There is no automatic provider fallback or request retry. Failed or unsettled requests have unknown cost unless usage was returned, never an assumed zero.

## Grouping behavior

Code maintains stable article IDs and groups in the existing source round-robin order. The first unique article starts a singleton without inference. For each later article, a single request asks separate same-event questions against every member of every valid existing group. Grouping still sees title, publication time and at most 280 lead characters per article; lead truncation is explicitly marked. Publication time is not event time.

An article joins only if every member of exactly one group passes the configured threshold. No matching group, uncertain answers or multiple matching groups leave it as a separate valid story. The algorithm does not turn pairwise links into connected components: A-B and B-C acceptance cannot override an A-C rejection. Grouping remains order-sensitive, as discussed before implementation.

A transport/contract/size failure keeps that article and remaining articles as internal standalone stories marked unvalidated, which the existing publication policy omits from the edition. This differs from valid low-confidence answers, which remain separate published-eligible stories. A call-cap stop also holds remaining articles back. Existing valid groups remain available to the existing partial-publication policy. There is no lexical merge fallback and no new policy hiding coverage percentages.

There are at most N-1 grouping requests for N unique articles. The number of pair questions can be N(N-1)/2. This is a different cost/runtime shape from the old batch assignment call. `REALNEWS_GROUPING_MAX_CALLS` still caps grouping requests, not pair questions. The existing default cap can therefore stop a larger edition before all articles are assigned. No larger cap is silently granted here.

A conservative 60,000-byte request envelope rejects oversized evidence without truncating it further. This is an application safety bound, not the provider's tokenizer or advertised context guarantee. Larger feeds may remain partial. Candidate retrieval or a new batch algorithm would be a separate design decision.

## Verification behavior

Synthesis remains generative. Decision verification asks named checks for same event, source support, side attribution, negation, uncertainty, quantities and readable Hebrew. Every check must pass. The existing deterministic citation/side and number-presence validation runs before inference and remains active; it is not complete semantic or numeric verification.

Reasons such as `decision_check_not_accepted:uncertainty` are application-owned check labels, not generated explanations of a specific factual error. A low probability is lack of acceptance, not proof the text is wrong. Verification sees the existing maximum of 4,000 evidence characters per article with the existing truncation flags, not necessarily full articles.

The summary cache key includes decision model, threshold and policy version. Old LLM-verified cache entries and differently configured decision policies cannot bypass this verifier. Accepted summaries remain cached within the matching policy. The existing three-round retry loop and per-run synthesis/verification call cap remain in place; each verification request is counted once regardless of predicate count.

## Evidence and next gate

Offline tests cover transport/contract shape, malformed answers, no-network size rejection, unique membership, ambiguity, transitive-chain prevention, uncertainty, failure/call caps, cache isolation and the synthesis-to-decision-verifier handoff. Mocks test control flow, not semantic model quality or real-provider compatibility.

Before enabling: confirm account access to the selected model, label independent Hebrew news cases, evaluate without publishing, calibrate the threshold, measure billed input and latency, and agree on the spend/call ceiling. Include same topic/different event, later coverage of one event, missing event times, conflicting places, altered quantities, reversed negation, allegation changed to fact, cross-side claims, valid paraphrases and embedded adversarial instructions. Include true positives so a verifier that rejects everything cannot pass. Repeat option/article order where relevant. No such provider evaluation was run for this PR.

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
