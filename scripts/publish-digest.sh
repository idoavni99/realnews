#!/usr/bin/env bash
# Publish only the generated digest, preserving concurrent main edits.
set -euo pipefail
base=$(git rev-parse HEAD)
script_dir=$(cd "$(dirname "$0")" && pwd)
output=$(mktemp)
trap 'rm -f "$output"' EXIT

git add site/data.json
if git diff --cached --quiet; then
  echo 'Digest unchanged; nothing to publish'
  exit 0
fi
if [ "$(git diff --cached --name-only)" != 'site/data.json' ] || ! git diff --quiet; then
  echo 'Publication blocked: expected only the generated site/data.json change' >&2
  exit 1
fi
git commit -m "Daily digest $(date -u +%Y-%m-%d)"

for attempt in 1 2 3; do
  git fetch --no-tags origin main
  remote=$(git rev-parse FETCH_HEAD)
  if [ "$remote" != "$base" ]; then
    git merge-base --is-ancestor "$base" "$remote" || {
      echo 'Publication blocked: main history changed; run a fresh digest' >&2; exit 1;
    }
    # UI/docs edits cannot invalidate generation. Workflow changes are safe only
    # when confined to cron/timezone lines (the cause of the original race).
    while IFS= read -r path; do
      case "$path" in
        site/data.json) echo 'Publication blocked: another digest changed main; run a fresh digest' >&2; exit 1 ;;
        site/*|docs/*|README.md) ;;
        .github/workflows/daily.yml)
          changes=$(git diff --no-ext-diff --unified=0 "$base" "$remote" -- "$path" | grep -E '^[+-]' | grep -vE '^(---|\+\+\+)' || true)
          if printf '%s\n' "$changes" | grep -qEv '^[+-][[:space:]]*(-[[:space:]]*)?(cron|timezone):'; then
            echo 'Publication blocked: workflow behavior changed; run a fresh digest' >&2; exit 1
          fi ;;
        *) echo "Publication blocked: generation inputs changed ($path); run a fresh digest" >&2; exit 1 ;;
      esac
    done < <(git diff --name-only "$base" "$remote")
    git rebase --onto "$remote" "$base"
    base=$remote
  fi
  if PUSH_CMD='git push origin HEAD:refs/heads/main' bash "$script_dir/push-with-retry.sh" >"$output" 2>&1; then
    cat "$output"
    exit 0
  fi
  cat "$output"
  if ! grep -qE '\[rejected\].*(fetch first|non-fast-forward)' "$output"; then exit 1; fi
  echo "main advanced again; checking safe publication retry $attempt/3" >&2
done
echo 'Publication stopped after 3 concurrent updates; run a fresh digest' >&2
exit 1
