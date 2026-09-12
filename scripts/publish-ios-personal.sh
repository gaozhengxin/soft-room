#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ $# -ne 4 ]]; then
  echo 'Usage: publish-ios-personal.sh GITHUB_RUN_ID VERSION_TAG PROVISIONING_PROFILE SIGNING_IDENTITY' >&2
  exit 2
fi
run_id=$1
tag=$2
profile=$3
identity=$4
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Version tag must look like v1.0.0.' >&2; exit 1; }
[[ -f "$profile" ]] || { echo 'Provisioning profile is missing.' >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo 'Commit all code before publishing.' >&2; exit 1; }
head=$(git rev-parse HEAD)
branch=$(git branch --show-current)
[[ "$branch" == 'codex/initial' ]] || { echo 'Switch to codex/initial before publishing.' >&2; exit 1; }
run_sha=$(gh run view "$run_id" --json headSha,conclusion --jq 'select(.conclusion == "success") | .headSha')
[[ "$run_sha" == "$head" ]] || { echo 'The successful iOS build must use the current commit.' >&2; exit 1; }
if gh release view "$tag" >/dev/null 2>&1; then
  echo 'This release tag already exists.' >&2
  exit 1
fi
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
gh run download "$run_id" --pattern "Soft-Room-signing-input-$head" --dir "$stage/input"
unsigned="$stage/input/Soft-Room-signing-input-$head/Soft-Room-unsigned.ipa"
[[ -f "$unsigned" ]] || unsigned="$stage/input/Soft-Room-unsigned.ipa"
[[ -f "$unsigned" ]] || { echo 'Build artifact is missing its unsigned IPA.' >&2; exit 1; }
signed="$stage/Soft-Room.ipa"
bash scripts/sign-ios-personal.sh "$unsigned" "$profile" "$identity" "$signed"
cat > "$stage/release-notes.md" <<EOF
Soft Room for iPhone, built from commit \`$head\` and signed with a Personal Team profile.

This IPA installs only on the devices included in that profile and stops launching when the profile expires, normally after 7 days. Each tester must use their own Apple ID to sign the unsigned build for their device. Downloading an IPA does not install it automatically.
EOF
gh release create "$tag" "$signed#Soft-Room.ipa" --target "$head" --title "Soft Room $tag" --notes-file "$stage/release-notes.md"
gh release view "$tag" --json url,assets --jq '{url, assets: [.assets[].name]}'
