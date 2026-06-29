#!/usr/bin/env bash
# Convert every citizens JSON in output-excel/ to an .xlsx via pdf-to-sheet.js
set -euo pipefail

cd "$(dirname "$0")"

SRC_DIR="output-excel"

shopt -s nullglob
files=("$SRC_DIR"/citizens-*.json)

if [ ${#files[@]} -eq 0 ]; then
  echo "No citizens-*.json files found in $SRC_DIR/"
  exit 1
fi

for f in "${files[@]}"; do
  # citizens-S08A22P220.json -> S08A22P220
  id=$(basename "$f" .json)
  id=${id#citizens-}
  echo "==> $id"
  node pdf-to-sheet.js "$id.pdf"
done

echo "Done: ${#files[@]} file(s)."
