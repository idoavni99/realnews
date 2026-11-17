# Comparison diagnostics

The regular pipeline prints `comparison outcomes` with aggregate counts, then `comparison story` rows for each eligible story. Each row uses the zero-based story index in the generated edition, article count, summary status, cache-hit indicator, comparison outcome, bullet count and attempt rounds.

Attempt rows distinguish comparison generation/validation from comparison verification rejection and summary-attempt failure. Invalid comparisons use fixed reason classes: shape, citation, unsupported number or length. Summary failures use fixed classes for verification rejection, attempt-budget exhaustion, HTTP status, output limit, generation output or unknown generation/verification error. Unknown error text is never echoed.

The publication gate prints the number of comparison objects before and after the gate and how many were stripped. This separates generation/verification absence from gate stripping without changing gate behavior.

The logs contain no headline, URL, article ID, source text, prompt, model response, raw error body, cache fingerprint or credential. Story indexes refer to the current edition only, not persistent identifiers. A cache hit with no comparison is logged honestly: the cache does not retain why the comparison was originally absent. Attempt counters count attempts, not unique stories. A failed summary attempt may contain a generated comparison that is never eligible for publication; the final outcome and attempt history are separate.

This is diagnosis, not a rerun or repair of old data. It adds no calls and does not invalidate cached summaries. Changes to prompts, verification, cache policy or UI are out of scope.

Existing limits remain separate: synthesis and summary verification share the default 60 physical-attempt budget; grouping has its own default 30. The whole pipeline is not capped at 60. Fallbacks consume their applicable budget. No limit is increased here.
