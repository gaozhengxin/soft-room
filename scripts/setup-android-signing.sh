#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

key=artifacts/android-release.p12
password=artifacts/android-release-password.txt
if [[ -e "$key" || -e "$password" ]]; then
  echo 'Android release key already exists. Refusing to replace the update identity.' >&2
  exit 1
fi
umask 077
mkdir -p artifacts
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
openssl rand -hex 32 | tr -d '\n' > "$password"
openssl req -x509 -newkey rsa:4096 -sha256 -nodes -days 10000 \
  -keyout "$stage/private.pem" -out "$stage/certificate.pem" \
  -subj '/CN=Soft Room Android Update Key' >/dev/null 2>&1
openssl pkcs12 -export -inkey "$stage/private.pem" -in "$stage/certificate.pem" \
  -name soft-room -out "$key" -passout "file:$password"
base64 < "$key" | tr -d '\n' | gh secret set ANDROID_RELEASE_KEYSTORE_B64
gh secret set ANDROID_RELEASE_STORE_PASSWORD < "$password"
openssl x509 -in "$stage/certificate.pem" -noout -fingerprint -sha256
echo 'Android release key was saved locally and uploaded to GitHub Actions Secrets.'
