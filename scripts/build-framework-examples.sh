#!/usr/bin/env bash
# Installs (from each app's lockfile) and builds the framework examples in examples/frameworks.
# They depend on the library through file:, which resolves to the built dist/ (build it first).
set -euo pipefail
cd "$(dirname "$0")/../examples/frameworks"
for app in react vue svelte angular; do
  t=$SECONDS
  (cd "$app" && bun install --frozen-lockfile --silent && bun run build >/dev/null)
  echo "  ✓ $app ($((SECONDS - t))s)"
done
