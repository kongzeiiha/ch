#!/usr/bin/env bash
# Build a fully static HTML site to apps/web/out/.
#
# What gets exported:  /, /a/<slug>/, /category/<slug>/, /robots.txt, /sitemap.xml
# What's skipped:      /api/* (server route handler), /admin/*, /workbench/*
#                      (client dashboards that fetch a localhost API)
#
# We move the skipped folders aside before building and restore them after,
# so dev mode keeps working untouched.
set -euo pipefail
cd "$(dirname "$0")/.."

APP=src/app
STASH=.staticexport-stash
SKIP_DIRS=(api admin workbench)

# Move excluded dirs OUT of src/app entirely — renaming in place would still
# expose them as routes (next.js scans src/app by directory name).
mkdir -p "$STASH"

restore() {
  for d in "${SKIP_DIRS[@]}"; do
    if [ -d "$STASH/$d" ]; then
      mv "$STASH/$d" "$APP/$d"
    fi
  done
  rmdir "$STASH" 2>/dev/null || true
}
trap restore EXIT

for d in "${SKIP_DIRS[@]}"; do
  if [ -d "$APP/$d" ]; then
    mv "$APP/$d" "$STASH/$d"
  fi
done

# Clean previous output.
rm -rf out .next/cache

echo '── Building static export…'
STATIC_EXPORT=1 npx next build

echo
echo '── Done. Output in: apps/web/out/'
echo "── Top-level: $(ls out/ | head -20 | tr '\n' ' ')"
echo "── Article pages: $(find out/a -name 'index.html' 2>/dev/null | wc -l | tr -d ' ')"
echo "── Category pages: $(find out/category -name 'index.html' 2>/dev/null | wc -l | tr -d ' ')"
