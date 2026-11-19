# Generation routing: auto primary, free on provider error

Future Daily digest workflow runs request `openrouter/auto` for synthesis. This is pinned in the workflow, so an older `OPENROUTER_MODEL` repository variable cannot silently keep regular runs on the free router. Local callers can still select a model explicitly; the local default stays free.

The pipeline makes one `openrouter/free` attempt only after the auto request returns HTTP 408, 429, 500, 502, 503 or 504. A successful auto response never triggers free. Auto is a paid router with a variable price; the Nov19 user decision accepts that as the primary cost so summaries stop dying to free-tier latency and rate limits. There is no new dollar cap, balance top-up or billing change.

No fallback happens on HTTP 400/401/402/403/404/413/422, malformed or truncated output, content filtering, or a network timeout/failure without an HTTP response. Those failures are not evidence of provider unavailability, and an ambiguous timeout could already have completed. A valid response later rejected by structural validation or fact verification does not trigger an immediate second attempt on the other router. Existing story-round retries remain unchanged: each round starts on the primary again.

Each physical generation attempt, including a failed auto call and the free fallback, is separately journaled in private `calls.json` and consumes the existing synthesis/verification attempt budget. Decisions verification shares that budget. The cap remains 60; spending it sooner can leave more stories without verified summaries. No retries increase that cap.

The two managed routers back each other up symmetrically (`backupRouterModel`): whichever of `openrouter/auto` and `openrouter/free` is primary gets the other as its only fallback. An explicit model gets no automatic backup, as before.

`free_test` remains available for staged free-only generation: it pins `openrouter/free` and disables the router fallback. This does not change the separately configured Decisions chain.

Grouping and verification still use the approved Decisions API chain: free Perplexity primary, then the existing Liquid and Jev fallbacks only on the existing provider-error conditions. `openrouter/free` and `openrouter/auto` are generation routers, not substitutes for those Decisions models.

Free routing chooses among available free models. Availability, latency, Hebrew output quality and rate limits can vary, so the free fallback does not guarantee every story will produce a verified summary or comparison. The UI, comparison contract, cache and publication checks are unchanged.

This change becomes active only when merged to the default branch used by future runs. It does not rerun or rewrite an existing edition. All regression checks use mocked providers; no live inference run is required or authorized for this PR.

Sources checked on 2026-11-17:
- https://openrouter.ai/api/v1/models
- https://openrouter.ai/api/v1/models?output_modalities=decisions
- https://openrouter.ai/docs/guides/routing/routers/free-router
- https://openrouter.ai/docs/api-reference/limits
