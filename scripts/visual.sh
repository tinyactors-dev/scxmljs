#!/usr/bin/env bash
# Screenshot comparisons, always inside the pinned Playwright image, so the pixels don't depend
# on the host's fonts. `scripts/visual.sh --update-snapshots` rewrites the baselines in
# tests/browser/specs/__screenshots__/. Without Docker it skips (and says so) unless
# SCXML_VISUAL_REQUIRED=1, which scripts/ci sets on Linux, where Docker is expected.
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE="mcr.microsoft.com/playwright:v1.63.0-noble" # keep in step with @playwright/test in package.json
BUN_VERSION="$(grep -E '^bun *=' mise.toml | sed -E 's/.*"(.*)".*/\1/')"

if ! docker info >/dev/null 2>&1; then
  if [ "${SCXML_VISUAL_REQUIRED:-0}" = "1" ]; then
    echo "visual tests need Docker, and it isn't available" >&2
    exit 1
  fi
  echo "visual tests: skipped (no Docker). They run in CI, or wherever Docker is available."
  exit 0
fi

# node_modules live in Docker volumes: the container installs Linux binaries without touching the host's
exec docker run --rm --ipc=host --init \
  -v "$PWD":/work -w /work \
  -v scxmljs-visual-nm:/work/node_modules \
  -v scxmljs-visual-nm-pkg:/work/packages/scxmljs/node_modules \
  -v scxmljs-visual-nm-playground:/work/examples/playground/node_modules \
  -e CI=1 -e SCXML_VISUAL=1 \
  "$IMAGE" bash -c "
    set -euo pipefail
    npm install -g --silent bun@${BUN_VERSION} >/dev/null
    bun install --frozen-lockfile >/dev/null
    (cd packages/scxmljs && bun run build >/dev/null)
    node node_modules/@playwright/test/cli.js test -c tests/browser $*
  "
