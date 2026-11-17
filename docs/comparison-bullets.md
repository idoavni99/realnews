# Coverage-difference bullets

Approved by the owner 2026-11-17 (WhatsApp): compact bullets at the top of the story screen,
only for stories covered by both the right group and the left group. No feed badge. When no
clear difference exists, the site says so explicitly. Added output tokens in regular runs are
approved; no separate calls and no paid test runs.

## Contract

- Qualification: at least one article in the left group (left / center_left) and one in the
  right group (right / center_right). Only qualifying stories get the extended synthesis
  contract; every other story uses the unchanged sides-only schema and instructions, so
  non-qualifying stories pay nothing extra.
- One paid call per story as before. The response adds a `differences` array (at most 3
  bullets). Each bullet carries a short Hebrew fragment per side plus model-selected article
  citations limited to that side. An empty array means no clear difference.
- Deterministic validation (`validateComparison`): shape, bullet count, fragment length
  (250 chars), citations per side (4), cross-side citations, citation-without-text, and
  number support against the cited evidence. Invalid differences are dropped; they never
  fail or retry the summary on their own.
- Verification: the comparison becomes a second candidate in the same Decisions call
  (7 checks x 2 candidates = 14 questions), marked `citation_kind: claim_level` so the
  verifier treats its article IDs as claim-level citations, unlike summary side membership.
  A rejected comparison drops the bullets; the verified summary still publishes.
  A rejected summary fails the whole attempt as before.
- Cache: the envelope stores summary and comparison together; a dropped comparison stays
  dropped on later runs. Fingerprint version 11 includes the qualification flag, so old
  summary-only entries are not reused for qualifying stories.
- Publication gate strips an invalid `comparison` field from a story without touching the
  story or its summary.
- Failure isolation: a comparison failure (validation, verification, absence in an old
  edition) means the section simply does not render. Nothing else on the site changes.

## Cost bounds (code-enforced)

Bullets only for qualifying stories, at most 3 bullets, 250 chars per fragment, same 3,000
output-token cap, same 60-call cap, no backfill of old editions. The routed model and its
price remain variable under openrouter/auto; tokens are bounded, dollars are not.

## Honesty rules (prompt + code)

The model is instructed to describe only what the collected text contains, never to claim or
imply a side chose not to cover something, and to return an empty array when no difference
is evident. One-side bullets render with the code-owned phrasing "הוזכר רק בימין/שמאל" and
every section carries the code-owned caveat that a missing detail was not necessarily
unpublished. The explicit "לא נמצאו הבדלים ברורים" line is application text, not model text.
