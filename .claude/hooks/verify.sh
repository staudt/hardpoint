#!/usr/bin/env bash
# Stop hook: before Claude finishes a turn, run the full verification suite
# (typecheck, lint, unit tests, build, headless smoke test) if any source
# changed since the last green run. Exit 2 blocks the stop and shows failures.
set -uo pipefail
input="$(cat)"
# Avoid infinite loops: if we already blocked once this turn, let Claude stop
# (it must then report the failure to the user honestly).
if [ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false')" = "true" ]; then
  exit 0
fi
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0
[ -f package.json ] && [ -d node_modules ] || exit 0

hash_file=.claude/.verify-hash
current="$(find src tests scripts public index.html package.json tsconfig.json vite.config.ts \
  playwright.config.ts eslint.config.js -type f 2>/dev/null | sort | xargs sha1sum | sha1sum | cut -d' ' -f1)"
if [ -f "$hash_file" ] && [ "$(cat "$hash_file")" = "$current" ]; then
  exit 0
fi

log="$(mktemp)"
if npm run verify >"$log" 2>&1; then
  echo "$current" >"$hash_file"
  rm -f "$log"
  exit 0
fi
echo "npm run verify FAILED — fix before finishing (full log: $log). Tail:" >&2
grep -v '^\s*$' "$log" | tail -40 >&2
exit 2
