# Synthesis: blocked, not deployed

As of 2026-11-03, the working production site still uses its original source digest.
The integrated event/left/center/right synthesis is unfinished and unvalidated.

The separate realnews Gemini project has no billing account. Standard free
Gemini 3.5 Flash-Lite answered real Hebrew news tests but changed nine years to
"two hours" and then "five years". The preserved rejected-duration fixture is
one real rejected response. Gemini 3.6/3.8 Flash and 3.1 Flash-Lite returned HTTP
503 high demand. Retries stopped. No paid fallback, billing, or production key
installation took place.

Local preparation includes strict response shape, citation and side validation,
narrow number regressions, bounded calls, hash-based caching, and a default-off
REALNEWS_SYNTHESIS_ENABLED switch. These checks do not prove semantic fidelity.
No synthesized output should be released on their strength alone.

Next steps when a suitable free model is available:
- Run a bounded representative Hebrew fidelity evaluation against actual source
  text, including numbers, attribution, allegations, negation and source limits.
- Keep unavailable summaries explicitly unavailable, rather than relabeling
  source leads as synthesis. Reject invalid responses without paid fallback.
- Finish internal story view with cited event/side summaries, honest missing
  sides and partial-access caveats. Never force the user to visit news sites.
- Validate absent-side behavior and cache invalidation, test the full pipeline,
  visually inspect mobile rendering, then install only the server-side secret
  in this repository and verify the private deployment.

The API key remains in the vault; temporary local secret copy was deleted.

## 2026-11-03 later sides-only tests
User narrowed output to per-side summaries only, with existing UI headline kept
outside generation. One same-input Flash-Lite sample preserved both original
leads; a digit-versus-Hebrew-number false positive remains in the numeric guard.
A second real archived Walla lead tested rumor attribution and police denial.
Generation preserved both. A separate same-model verifier call accepted that
output and a supported synthetic control, rejected a reversed denial and a
fabricated source/death claim. The candidate IDs were descriptive, not blinded;
this is a small, weak initial verifier evaluation, not a reliability guarantee.
Verification module remains experimental and unwired to production. No deployment.
