# Run history (past editions)

The site keeps up to 3 previous digests next to the live one so older stories
stay viewable after a new run publishes.

## How it works

1. `src/pipeline.ts` calls `archiveCurrentEdition` (`src/editions.ts`) just
   before writing the new `site/data.json`. The previously published digest is
   copied byte-identically to `site/history/<edition-id>.json`, where the id is
   its `generated_at` at second precision (for example
   `2026-11-14T00-16-37Z`).
2. `site/history/index.json` lists the kept editions, newest first, with
   `generated_at` and story count. Only the 3 newest past editions are kept;
   older history files are deleted. A staged run (`REALNEWS_OUT` set) never
   touches the history.
3. `scripts/publish-digest.sh` commits `site/data.json` together with the
   `site/history/` changes (including pruned deletions). Anything else still
   blocks publication.
4. The frontend fetches `history/index.json`; when past editions exist, an
   edition selector appears in the header. The selected edition is persisted
   in the `edition` query parameter alongside the search/filter state, and
   past editions show a banner with a one-tap return to the latest digest.

The Pages workflow deploys all of `site/`, so archived editions go live with
the digest that archived them.

## Guarantees

- The live `data.json` never counts toward the 3-edition limit.
- Re-archiving the same digest is idempotent (the id comes from its own
  timestamp).
- A past edition renders exactly what was published then: the pipeline never
  edits archived files, only creates and prunes them.
