#!/bin/sh
# Builds the download for the website: docs/bring-back-my-google-watchlist.zip (a folder
# of the same name holding the extension) and docs/version.json, which the extension
# checks for updates.
# Run after bumping "version" in extension/manifest.json:  sh scripts/package.sh
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
version=$(node -p "require('$root/extension/manifest.json').version")
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cp -R "$root/extension" "$tmp/bring-back-my-google-watchlist"
find "$tmp" -name .DS_Store -delete

rm -f "$root/docs/bring-back-my-google-watchlist.zip"
(cd "$tmp" && zip -qr -X "$root/docs/bring-back-my-google-watchlist.zip" bring-back-my-google-watchlist)
printf '{ "version": "%s" }\n' "$version" > "$root/docs/version.json"

echo "Packaged version $version -> docs/bring-back-my-google-watchlist.zip"
