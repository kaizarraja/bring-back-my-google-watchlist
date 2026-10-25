#!/bin/sh
# Builds the download for the website: docs/bring-back-my-google-watchlist.zip (a folder
# of the same name holding the extension) and docs/version.json, which installed copies
# check daily to nudge people to update.
#
# Before running: bump "version" in extension/manifest.json and write what's new in
# release.json ("notes"; set "important": true only for updates people must not skip).
#   sh scripts/package.sh
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cp -R "$root/extension" "$tmp/bring-back-my-google-watchlist"
find "$tmp" -name .DS_Store -delete

rm -f "$root/docs/bring-back-my-google-watchlist.zip"
(cd "$tmp" && zip -qr -X "$root/docs/bring-back-my-google-watchlist.zip" bring-back-my-google-watchlist)

node -e '
const fs = require("fs");
const [manifest, release, out] = process.argv.slice(1);
const { version } = JSON.parse(fs.readFileSync(manifest, "utf8"));
const { notes = "", important = false } = JSON.parse(fs.readFileSync(release, "utf8"));
fs.writeFileSync(out, JSON.stringify({ version, notes, important: Boolean(important), released: new Date().toISOString().slice(0, 10) }, null, 2) + "\n");
console.log(`Packaged version ${version}${important ? " (important)" : ""} -> docs/bring-back-my-google-watchlist.zip`);
' "$root/extension/manifest.json" "$root/release.json" "$root/docs/version.json"
