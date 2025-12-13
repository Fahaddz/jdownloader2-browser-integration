#!/bin/bash
set -e

VERSION=$(cat VERSION | tr -d '\n\r ')
BUILD_DIR="build"
ICONS_SRC="src/icons"

if [ -z "$VERSION" ]; then
  echo "Error: VERSION file is empty"
  exit 1
fi

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

echo "Building version $VERSION..."

echo "Building Firefox extension..."
mkdir -p "$BUILD_DIR/firefox-temp"
cp firefox/manifest.json "$BUILD_DIR/firefox-temp/"
cp firefox/background.js "$BUILD_DIR/firefox-temp/"
cp -r "$ICONS_SRC" "$BUILD_DIR/firefox-temp/icons"
cd "$BUILD_DIR/firefox-temp"
zip -r "../jdownloader2-browser-integration-firefox-v${VERSION}.xpi" .
cd ../..

echo "Building Chrome MV2 extension..."
mkdir -p "$BUILD_DIR/chrome-mv2-temp"
cp chrome-mv2/manifest.json "$BUILD_DIR/chrome-mv2-temp/"
cp chrome-mv2/background.js "$BUILD_DIR/chrome-mv2-temp/"
cp -r "$ICONS_SRC" "$BUILD_DIR/chrome-mv2-temp/icons"
cd "$BUILD_DIR/chrome-mv2-temp"
zip -r "../jdownloader2-browser-integration-chrome-mv2-v${VERSION}.zip" .
cd ../..

echo "Building Chrome MV3 extension..."
mkdir -p "$BUILD_DIR/chrome-mv3-temp"
cp chrome-mv3/manifest.json "$BUILD_DIR/chrome-mv3-temp/"
cp chrome-mv3/background.js "$BUILD_DIR/chrome-mv3-temp/"
cp -r "$ICONS_SRC" "$BUILD_DIR/chrome-mv3-temp/icons"
cd "$BUILD_DIR/chrome-mv3-temp"
zip -r "../jdownloader2-browser-integration-chrome-mv3-v${VERSION}.zip" .
cd ../..

rm -rf "$BUILD_DIR/firefox-temp" "$BUILD_DIR/chrome-mv2-temp" "$BUILD_DIR/chrome-mv3-temp"

echo "Build complete! Files in $BUILD_DIR:"
ls -la "$BUILD_DIR"
