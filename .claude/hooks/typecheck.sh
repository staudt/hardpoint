#!/usr/bin/env bash
# PostToolUse hook: after editing a .ts file, type-check the project.
# Exit 2 feeds errors back to Claude so they get fixed immediately.
set -uo pipefail
input="$(cat)"
file="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')"
case "$file" in
  *.ts) ;;
  *) exit 0 ;;
esac
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0
[ -d node_modules ] || exit 0
out="$(npx --no-install tsc --noEmit -p . 2>&1)"
if [ $? -ne 0 ]; then
  echo "TypeScript errors after editing $file:" >&2
  printf '%s\n' "$out" | head -40 >&2
  exit 2
fi
exit 0
