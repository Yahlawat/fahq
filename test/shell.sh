#!/usr/bin/env bash
# Tests shell/fahq.zsh in a real interactive zsh: once clean, once with your ~/.zshrc.
set -uo pipefail
cd "$(dirname "$0")/.."

status=0
for mode in clean real; do
  TMP=$(mktemp -d)
  expect test/shell.exp "$mode" "$PWD/shell/fahq.zsh" "$TMP" || status=1
  rm -rf "$TMP"
done

# Inside VS Code/Cursor terminals the extension handles it, so the hook must not load.
loaded=$(TERM_PROGRAM=vscode zsh -f -c "source '$PWD/shell/fahq.zsh'; print \${+functions[_fahq_precmd]}")
if [[ $loaded == 0 ]]; then echo "PASS  skipped inside VS Code terminals"; else echo "FAIL  loaded inside VS Code terminals"; status=1; fi

exit $status
