# Soft Room on Android

The Capacitor Android app bundles the web build. Waku, STUN, TURN, and the public site used for regional checks still require network access. Camera and microphone permissions are requested by the channel controls; the screen wake lock is released when the app is hidden.

## Release pipeline

The shared `.github/workflows/release.yml` runs when a `v*` tag matching `package.json` is pushed. Its Android job builds a **signed** `Soft-Room-android.apk`, verifies its signature, and publishes it with a SHA-256 file alongside the unsigned iOS IPA. The release is private, so testers need repository access. The Android update button downloads the latest APK; Android still asks the user to confirm installation.

Signing uses the stable `soft-room` key in `artifacts/android-release.p12` and password in `artifacts/android-release-password.txt` on the release maintainer's Mac. Both files are ignored by Git and have owner-only permissions. GitHub Actions has encrypted copies as `ANDROID_RELEASE_KEYSTORE_B64` and `ANDROID_RELEASE_STORE_PASSWORD`. **Back up these two local files securely.** Losing this key prevents seamless upgrades of installed APKs with the same app ID. Running `scripts/setup-android-signing.sh` again refuses to replace an existing key.

`versionName` and monotonically increasing `versionCode` come from the three-part version in `package.json`; bump it before each new tag. Do not publish an APK signed by a different key under the same app ID.

## Local development

Requires Node 22+, JDK 21, and Android SDK. This Mac currently has no Java runtime, so APK builds are verified by GitHub Actions rather than locally.

```sh
npm ci
npm run android:sync
bash android/gradlew -p android assembleDebug
```

The debug APK is for local testing only and is signed with a debug key. The release APK from GitHub uses the stable release key. Check room joining, Waku messages, voice/video permissions, push-to-talk, wake lock, and direct/TURN connections on an Android device. No Android device was connected for this initial pipeline acceptance.
