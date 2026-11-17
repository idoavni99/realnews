# Generation routing: free primary, auto on provider error

Future Daily digest workflow runs request `openrouter/free` for synthesis. This is pinned in the workflow, so an older `OPENROUTER_MODEL` repository variable cannot silently keep regular runs on paid auto. Local callers can still select a model explicitly; the default is free.

The pipeline makes one `openrouter/auto` attempt only after the free request returns HTTP 408, 429, 500, 502, 503 or 504. A successful free response never triggers auto. The paid fallback can have a variable price. There is no new dollar cap, balance top-up or billing change.

No fallback happens on HTTP 400/401/402/403/404/413/422, malformed or truncated output, content filtering, or a network timeout/failure without an HTTP response. Those failures are not evidence of provider unavailability, and an ambiguous timeout could already have completed. A valid response later rejected by structural validation or fact verification does not trigger an immediate paid second opinion. Existing story-round retries remain unchanged: each round starts free again.

Each physical generation attempt, including a failed free call and the auto fallback, is separately journaled in private `calls.json` and consumes the existing synthesis/verification attempt budget. Decisions verification shares that budget. The cap remains 60; spending it sooner can leave more stories without verified summaries. No retries increase that cap.

`free_test` remains available for staged free-only generation: it disables the auto fallback. This does not change the separately configured Decisions chain.

Grouping and verification still use the approved Decisions API chain: free Perplexity primary, then the existing Liquid and Jev fallbacks only on the existing provider-error conditions. `openrouter/free` and `openrouter/auto` are generation routers, not substitutes for those Decisions models.

Free routing chooses among available free models. Availability, latency, Hebrew output quality and rate limits can vary, so switching does not guarantee every story will produce a verified summary or comparison. The UI, comparison contract, cache and publication checks are unchanged.

This change becomes active only when merged to the default branch used by future runs. It does not rerun or rewrite an existing edition. All regression checks use mocked providers; no live inference run is required or authorized for this PR.

Sources checked on 2026-11-17:
- https://openrouter.ai/api/v1/models
- https://openrouter.ai/api/v1/models?output_modalities=decisions
- https://openrouter.ai/docs/guides/routing/routers/free-router
- https://openrouter.ai/docs/api-reference/limits
