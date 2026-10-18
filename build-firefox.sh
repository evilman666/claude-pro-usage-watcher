#!/bin/sh
# Builds usage-pacer-firefox.zip (manifest.firefox.json becomes manifest.json).
set -e
cd "$(dirname "$0")"
tmp=$(mktemp -d)
cp pace.js hook.js content.js styles.css "$tmp/"
cp manifest.firefox.json "$tmp/manifest.json"
rm -f usage-pacer-firefox.zip
(cd "$tmp" && zip -qr - .) > usage-pacer-firefox.zip
rm -rf "$tmp"
echo "Built usage-pacer-firefox.zip"
