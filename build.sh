#!/bin/bash
# Build ZoteroOllama plugin into an .xpi file
set -e

PLUGIN_NAME="zotero-ollama"
VERSION=$(grep '"version"' manifest.json | sed 's/.*: "\(.*\)".*/\1/')
OUTPUT="${PLUGIN_NAME}-${VERSION}.xpi"

echo "Building ${OUTPUT}..."

# Remove old build
rm -f "${OUTPUT}"

# Create .xpi (which is just a zip)
zip -r "${OUTPUT}" \
  manifest.json \
  bootstrap.js \
  prefs.js \
  zotero-ollama.js \
  ollama.js \
  chrome/ \
  content/ \
  locale/ \
  icons/icon.png \
  icons/icon.svg \
  -x "*.DS_Store" \
  -x "__MACOSX/*"

echo "Built ${OUTPUT} ($(du -h "${OUTPUT}" | cut -f1))"
echo ""
echo "To install:"
echo "  1. Open Zotero"
echo "  2. Go to Tools > Add-ons"
echo "  3. Click the gear icon > Install Add-on From File..."
echo "  4. Select ${OUTPUT}"
