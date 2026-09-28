#!/usr/bin/env bash
# Browser tests (tests/browser): Chromium, Firefox and WebKit via Playwright. Installs the pinned
# browsers first (with their system libraries on Linux). Arguments go to `playwright test`.
set -euo pipefail
cd "$(dirname "$0")/.."
PW="node node_modules/@playwright/test/cli.js"
if [ "$(uname)" = "Linux" ]; then
  $PW install --with-deps chromium firefox webkit
else
  $PW install chromium firefox webkit
fi
exec $PW test -c tests/browser "$@"
