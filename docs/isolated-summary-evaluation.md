# Isolated summary checks

This runner starts with saved article evidence. It does not collect feeds, group articles or publish anything. The production summary and verification functions are unchanged. No model calls are authorized by adding this runner.

Offline replay:

```
node scripts/evaluate-summary-replay.ts test/fixtures/fullfeed-semantic-failure.json /path/to/responses.json /tmp/private-summary-result.json
```

Responses is an array of response objects, each with `json`, and optionally `usage` and `diagnostics`, consumed in synthesis then verification order. The fixture retains an independently labeled different-event grouping failure. A model verifier saying supported must not overwrite that ground truth.

Results separate synthesis contract failures from verification failures/rejections, record duration and available usage for each call, and fingerprint the exact evidence. Replay duration and replay cost are not live model performance or actual spending. Missing cost is counted explicitly, never converted to a known zero.

Offline tests cover malformed citations, cross-side attribution, absent-side prose, unsupported numbers, forbidden overall headlines, truncated synthesis, truncated verification, incomplete verdicts, verifier rejection and mock acceptance. Existing tests cover additional number/attribution constraints. These prove control flow, not semantic quality.

Before any live experiment, agree a call/spend bound and exact key/account. Use a small fixed positive and negative corpus, including negation, allegations, attribution, quantities and the known different-event failure. Score against independent expected facts, not only the model's own verdict. Compare routing/reasoning and output budgets one variable at a time. Capture request-start and settled usage privately. Do not loosen citation/fidelity gates to make the test pass.

Known production runtime findings from morning run 41991398549: serial summary/verification, 10-second sleep per processed story, no automatic per-story retries, 3000/2000 output limits. Grouping low-reasoning hint does not currently apply to summaries/verifiers. A 60-call summary-stage cap cannot cover 76 stories with two calls each. Changing these is separate from this offline harness.
