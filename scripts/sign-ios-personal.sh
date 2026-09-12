#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo 'Usage: sign-ios-personal.sh INPUT_UNSIGNED_IPA PROVISIONING_PROFILE SIGNING_IDENTITY OUTPUT_IPA' >&2
  exit 2
fi
input=$1
profile=$2
identity=$3
output=$4
[[ -f "$input" && -f "$profile" ]] || { echo 'IPA or provisioning profile is missing.' >&2; exit 1; }
[[ "$output" != "$input" ]] || { echo 'Output must differ from input.' >&2; exit 1; }
[[ ! -e "$output" ]] || { echo 'Output already exists.' >&2; exit 1; }

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
ditto -x -k "$input" "$stage"
app="$stage/Payload/Soft Room.app"
[[ -d "$app" ]] || { echo 'Expected Soft Room.app is missing.' >&2; exit 1; }
security cms -D -i "$profile" -o "$stage/profile.plist" >/dev/null
python3 - "$stage/profile.plist" "$app/Info.plist" "$stage/entitlements.plist" <<'PY'
import datetime, plistlib, sys
profile_path, info_path, entitlements_path = sys.argv[1:]
with open(profile_path, 'rb') as file:
    profile = plistlib.load(file)
with open(info_path, 'rb') as file:
    info = plistlib.load(file)
entitlements = profile['Entitlements']
bundle = info['CFBundleIdentifier']
team = profile['TeamIdentifier'][0]
if bundle != 'uk.wakukusmartrecipe.soft':
    raise SystemExit('Unexpected bundle ID')
if entitlements.get('application-identifier') != f'{team}.{bundle}':
    raise SystemExit('Provisioning profile does not match the app')
if profile['ExpirationDate'].replace(tzinfo=datetime.timezone.utc) <= datetime.datetime.now(datetime.timezone.utc):
    raise SystemExit('Provisioning profile has expired')
if not profile.get('ProvisionedDevices'):
    raise SystemExit('Provisioning profile has no registered devices')
with open(entitlements_path, 'wb') as file:
    plistlib.dump(entitlements, file)
print(f'Profile permits {len(profile["ProvisionedDevices"])} device(s); expires {profile["ExpirationDate"].isoformat()} UTC.')
PY
ditto "$profile" "$app/embedded.mobileprovision"
if [[ -d "$app/Frameworks" ]]; then
  while IFS= read -r -d '' nested; do
    codesign --force --sign "$identity" --timestamp=none "$nested"
  done < <(find "$app/Frameworks" -mindepth 1 -maxdepth 1 \( -name '*.framework' -o -name '*.dylib' \) -print0)
fi
codesign --force --sign "$identity" --timestamp=none --entitlements "$stage/entitlements.plist" --generate-entitlement-der "$app"
codesign --verify --deep --strict "$app"
ditto -c -k --keepParent "$stage/Payload" "$output"
unzip -tq "$output"
shasum -a 256 "$output"
