# Per-side prose, application-owned membership

The synthesis model returns only `{sides:{left:string,center:string,right:string}}`. Missing sides are empty strings. No model-generated article IDs, citations, headline, overall summary or source list is requested.

The application attaches all known articles from each side to that side's prose and marks the association `evidence_kind: side_membership`. These are context sources, not claim-level citations or proof every source supports every claim. The UI labels this distinction. The verifier receives actual source evidence and must check every claim using only the matching side, plus same-event consistency, quantities, negation and allegations. Local number checks use the same bounded evidence supplied to the models. Unknown source affiliation is not guessed into a side.

Owner categories center_left and center_right map to left and right for summaries, respectively. This is separate from the coverage bar's half-weighted display. A center-only two-outlet experiment cannot validate left/right model quality.

The cache fingerprint is changed to avoid reusing earlier citation-contract summaries. Historical cited summaries remain readable, but new generation must use the prose-only model shape. Publication still requires the existing quality gate and exact-data approval. No live verifier pass or publication is implied by local validation.

This branch does not merge the pending output-budget prompt branch, change output limits or reasoning settings, or adopt the obsolete numeric-citation-output alternative.
