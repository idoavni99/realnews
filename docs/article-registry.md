# Article registry

A shared `Map<article_id, FeedItem>` holds captured articles before grouping. IDs retain the existing canonical-URL hash format. Same canonical URL aliases deduplicate; hash collisions between different URLs and conflicting source/side metadata fail rather than overwrite. The first observation is preserved. Group membership resolves only exact known IDs and rejects duplicates.

Grouping already sent only metadata and a bounded lead, not full bodies. This change makes that existing separation shared and persistent. Grouping still sends at most 280 lead characters by default. Summaries resolve the group's IDs against the registry. Numeric citation IDs remain local to that resolved list; each model evidence row now also carries its stable article_id. Public story metadata includes that stable ID, never the body.

The private `articles.json` checkpoint retains available article evidence and extraction status; it is uploaded only to the existing private review artifact, with one-day retention. It is not an external content archive or a publication approval. No extra fetching is introduced.

A successfully extracted explicit articleBody now retains all available normalized body text privately instead of cutting storage at 4000 characters. This does not guarantee the publisher supplied the entire article. Partial extraction remains partial, and RSS-only/failed extraction remains lead_only. No paywall is bypassed or missing body invented.

Model evidence remains bounded at 4000 characters per article in both synthesis and verification, with available_chars and evidence_truncated metadata. The private registry's storage and model context limits are separate. Partial extraction still retains at most 1500 characters. Stable-ID lookup does not itself fix bad grouping, synthesis or verification.
