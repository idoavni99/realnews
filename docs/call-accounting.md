# Private call accounting

Each pipeline invocation starts a new calls.json snapshot with a random run_id. Calls retain a per-run numeric ID, start/completion timestamps, stage, status and returned usage/diagnostics. No prompts, article bodies or generated responses are stored in this file. A started call without returned usage has unknown cost, not zero.

Every update writes the complete JSON object to a private temporary file, fsyncs it, renames it atomically to calls.json, then fsyncs the directory. Readers see the previous or next valid snapshot, never a partially overwritten JSON document. Abrupt cancellation can lose the latest not-yet-renamed update, so an unsettled call is still unknown. A new invocation resets the local snapshot rather than mixing call zero from multiple runs. Separate run artifacts retain separate runs. Concurrent invocations must use separate output directories.

Actions uploads calls.json with the existing private review evidence in its always-run cleanup. Loss of the runner or cleanup can still prevent upload. The snapshot is diagnostic accounting, not a billing ledger or publication approval. This does not recover costs from runs before this change.
