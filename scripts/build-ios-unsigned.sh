#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
xcode_major=$(xcodebuild -version | awk '/^Xcode / {split($2, v, "."); print v[1]}')
if [[ "$xcode_major" -lt 26 ]]; then
  echo 'Capacitor 8 requires Xcode 26+. Use the GitHub iOS release workflow on this Mac.' >&2
  exit 1
fi
mkdir -p artifacts
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -derivedDataPath ios/DerivedData \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY='' build
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/Payload"
ditto ios/DerivedData/Build/Products/Release-iphoneos/App.app "$stage/Payload/Soft Room.app"
# A device build awaiting the user's Apple ID signature, not an installable signed IPA.
ditto -c -k --keepParent "$stage/Payload" artifacts/Soft-Room-unsigned.ipa
(cd artifacts && LC_ALL=C shasum -a 256 Soft-Room-unsigned.ipa > Soft-Room-unsigned.ipa.sha256)
