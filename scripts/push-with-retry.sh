#!/usr/bin/env bash
# Push with up to 3 attempts, retrying ONLY on transient GitHub server errors (5xx).
# Any other failure (non-fast-forward, auth, rejected hook) stops immediately.
# Never pulls, rebases, or force-pushes, so concurrent edits on main are never overwritten.
set -u
PUSH_CMD="${PUSH_CMD:-git push}"
DELAYS=(${RETRY_DELAYS:-20 60})
MAX=3
out=$(mktemp)
for attempt in $(seq 1 "$MAX"); do
  if $PUSH_CMD >"$out" 2>&1; then
    cat "$out"
    exit 0
  fi
  cat "$out"
  if ! grep -qiE 'Internal Server Error|error: ?5[0-9]{2}|returned error: ?5[0-9]{2}|HTTP ?5[0-9]{2}|50[0-9] (Bad Gateway|Service Unavailable|Gateway Time-?out)|Bad Gateway|Service Unavailable|Gateway Time-?out' "$out"; then
    echo "push failed with a non-retryable error; stopping" >&2
    exit 1
  fi
  if [ "$attempt" -lt "$MAX" ]; then
    d="${DELAYS[$((attempt-1))]:-60}"
    echo "transient server error on attempt $attempt/$MAX; retrying in ${d}s" >&2
    sleep "$d"
  fi
done
echo "push failed after $MAX attempts" >&2
exit 1
