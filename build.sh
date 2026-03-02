#!/bin/bash
set -e

OUT="focus-guard.zip"

rm -f "$OUT"

zip -r "$OUT" \
  manifest.json \
  service-worker.js \
  popup.html \
  popup.js \
  popup.css \
  blocked.html \
  blocked.js \
  icons/ \
  lib/

echo "Built $OUT"
