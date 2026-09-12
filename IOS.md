# Soft Room on iPhone

The Capacitor 8 app bundles `dist` locally. It does not depend on a running development server or load the website as a remote wrapper. Waku, STUN and the TURN credential Worker remain public network services. Native location checks use the public site's Cloudflare trace endpoint, with the same regional rules as the website.

## Build

Requires Node 22+ and Xcode 26+. The minimum native deployment target is iOS 15; actual WebRTC behavior still needs testing on the target phone.

```sh
npm ci
npm run ios:sync
npm run ios:open
```

`npm run ios:ipa` creates `artifacts/Soft-Room-unsigned.ipa`, a Release arm64 device build awaiting signing. It contains no provisioning profile or signing keys. The manually triggered **iOS release build** GitHub Actions workflow builds the same source on macOS 26 and uploads this intermediate as a private, seven-day Actions artifact. Only a locally signed IPA is attached to a GitHub Release; no Apple account credentials or private signing key are stored in GitHub.

After committing and pushing the version, run the workflow and publish its successful build from this Mac:

```sh
gh workflow run ios-release-build.yml --ref codex/initial
gh run list --workflow ios-release-build.yml --limit 1
bash scripts/publish-ios-personal.sh RUN_ID v1.0.0 /path/to/profile.mobileprovision CERTIFICATE_SHA1
```

`publish-ios-personal.sh` checks that the Actions build matches the current commit, validates the device profile, signs the app and nested frameworks using the local Keychain, verifies the IPA, and creates a private release with a stable `Soft-Room.ipa` asset name. Version tags must be unique. The release page is linked in the app sidebar, and mobile layouts link to the latest IPA download. The browser may require GitHub login for this private repository. iOS can download the IPA, but cannot silently install or re-sign it.

The app declares camera, microphone and local-network usage. Microphone/camera acquisition remains controlled by the channel controls. The existing Keep Awake native plugin is included. App ID: `uk.wakukusmartrecipe.soft`.

## Free personal-device signing

Use [Sideloadly](https://sideloadly.io/) with your own free Apple account, or Xcode's Personal Team. A Personal Team profile includes specific registered devices; the published signed IPA installs only on those devices. Other testers must sign for their own device using the private Actions build or a future distribution service.

1. Connect the iPhone by USB, unlock it and trust this Mac.
2. In Sideloadly, select the phone and the unsigned IPA. Keep the normal Apple ID sideloading mode; no tweaks or app modifications are needed.
3. Enter your Apple account and complete verification yourself in the tool. Never put passwords or signing keys in this repository or send them through chat.
4. Enable Developer Mode on the phone if requested. Trust the developer profile under Settings → General → VPN & Device Management when required, then open Soft Room.

Free Apple account provisioning normally expires after 7 days; re-sign when needed. This project does not assume a paid developer account. A compiled unsigned IPA is not evidence of successful signing or installation.

## Device acceptance

Open the app with the development server stopped. Test room creation/joining, shared links (which use the public website), Waku messages, voice/video permissions, push-to-talk release, screen wake lock, and two-device direct/TURN connections. Test foreground/background transitions and phone calls interrupting audio. Background recording or persistent background calls are not implemented.
