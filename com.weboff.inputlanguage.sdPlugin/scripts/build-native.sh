#!/bin/bash
set -euo pipefail
plugin_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
native_build_tmp="$(mktemp -d "${TMPDIR:-/tmp}/input-language-native.XXXXXX")"
trap 'rm -rf "$native_build_tmp"' EXIT
for native_arch in arm64 x86_64; do
  xcrun --sdk macosx swiftc -O -target "${native_arch}-apple-macosx13.0" \
    -module-cache-path "$native_build_tmp/module-cache" \
    "$plugin_root/native/InputSourceHelper.swift" -o "$native_build_tmp/helper-$native_arch"
done
lipo -create "$native_build_tmp/helper-arm64" "$native_build_tmp/helper-x86_64" \
  -output "$native_build_tmp/input-source-helper"
codesign --force --sign - --timestamp=none "$native_build_tmp/input-source-helper"
lipo "$native_build_tmp/input-source-helper" -verify_arch arm64
lipo "$native_build_tmp/input-source-helper" -verify_arch x86_64
cp "$native_build_tmp/input-source-helper" "$plugin_root/native/input-source-helper"
chmod 755 "$plugin_root/native/input-source-helper"
