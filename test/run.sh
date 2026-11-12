#!/usr/bin/env bash
# Runs test/e2e.js in a throwaway VS Code instance (own profile, no other extensions).
set -euo pipefail
cd "$(dirname "$0")/.."

CODE="/Applications/Visual Studio Code.app/Contents/MacOS/Code"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/user/User" "$TMP/ext" "$TMP/ws"
echo '{ "fahq.enabled": true, "fahq.volume": 0, "workbench.startupEditor": "none", "security.workspace.trust.enabled": false }' > "$TMP/user/User/settings.json"
printf "hello\n" > "$TMP/ws/code.txt"

status=0
"$CODE" \
  --user-data-dir "$TMP/user" \
  --extensions-dir "$TMP/ext" \
  --extensionDevelopmentPath "$PWD" \
  --extensionTestsPath "$PWD/test/e2e.js" \
  "$TMP/ws" >/dev/null 2>&1 || status=$?

cat "$TMP/ws/results.txt" 2>/dev/null || echo "No results: the test didn't finish."
exit $status
