#!/bin/bash
set -e

VERSION=$(cat VERSION | tr -d '\n\r ')

if [ -z "$VERSION" ]; then
  echo "Error: VERSION file is empty"
  exit 1
fi

echo "Updating all manifests to version $VERSION..."

for manifest in firefox/manifest.json chrome-mv2/manifest.json chrome-mv3/manifest.json; do
  if [ -f "$manifest" ]; then
    jq --arg v "$VERSION" '.version = $v' "$manifest" > tmp.json && mv tmp.json "$manifest"
    echo "Updated $manifest"
  fi
done

echo "All manifests updated to version $VERSION"

