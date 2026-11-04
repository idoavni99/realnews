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

Blind verifier check: one additional call with opaque random UUIDs, randomized
order, and no labels/expected verdicts in model input. Three supported candidates
and seven corruptions all matched manual expected verdicts. Corruptions covered
five years, two hours, garbled duration, cross-source minister attribution,
reversed denial, rumor promoted to fact, and invented deaths/source attribution.
The valid digit/word paraphrase was accepted. This small set reuses two stories;
it does not establish broad reliability or independence from generator errors.
Numeric normalization now accepts תשע/9 without accepting 19 as 9, and rejects
five years or two hours when unsupported. Twenty local tests pass. Not deployed.

Three independent archived leads (six calls) tested accusation/lawyer attribution,
conditional opinion, and preliminary memorandum versus completed project. Core
summaries matched the leads, but the model generated a nonsensical access caveat
("fork") and verifier approved it. This is a real verifier miss, preserved as a
fixture. Access caveats now come solely from metadata, outside generation; output
schema rejects model caveats. Verifier prompt now also asks for readable language,
but that prompt change is untested. Feature remains off and unshipped.

Final sides-only schema (no generated caveats), refreshed verifier prompt: one
real two-source generation plus one verification passed. Manual source comparison
matched both leads. This does not cure the demonstrated verifier miss. Local UI
renders cited side summaries, deterministic access caveat, absent side and rejected/
unavailable states. Actual 390px accepted and 320px unavailable previews inspected;
no clipping or horizontal overflow seen. Evidence screenshots are local previews,
not production. Twenty-two tests pass. No production publication or secret install.

Current-news staged run41687722830: 93 articles,44 full-text,30 stories.
Two summaries accepted, one numeric rejection, then503stopped all remaining calls
(27unavailable). Manual review found two different accidents under one headline;
release blocked. Original artifact preserved as staged-cluster-failure fixture.
A conservative pre-synthesis gate now only merges exact punctuation-normalized
headlines from different outlets. Near matches stay separate; this deliberately
reduces cross-source recall, and exact generic headlines can still be ambiguous.
It is not a semantic matching solution. No further model calls after this finding.
Private .review evidence snapshots capture exact capped model evidence and draft/
verdict/error, upload only as1day artifact in the private repo staging run, never
site content. This capture code has not been exercised in a new staged run yet.
