# Soft Room on iPhone

The Capacitor 8 app bundles `dist` locally. It does not depend on a running development server or load the website as a remote wrapper. Waku, STUN and the TURN credential Worker remain public network services. Native location checks use the public site's Cloudflare trace endpoint, with the same regional rules as the website.

## Build

Requires Node 22+ and Xcode 26+. The minimum native deployment target is iOS 15; actual WebRTC behavior still needs testing on the target phone.

```sh
npm ci
npm run ios:sync
npm run ios:open
```

`npm run ios:ipa` creates `artifacts/Soft-Room-unsigned.ipa`, a Release arm64 device build awaiting signing. It deliberately contains no provisioning profile or signing keys. The manually triggered **iOS test build** GitHub Actions workflow performs the same build on macOS 26; it uses the account's standard Actions allowance and does not change billing settings. Download its private artifact to sign locally. Do not publish the unsigned artifact as a ready-to-install app.

The app declares camera, microphone and local-network usage. Microphone/camera acquisition remains controlled by the channel controls. The existing Keep Awake native plugin is included. App ID: `uk.wakukusmartrecipe.soft`.

## Free personal-device signing

Use [Sideloadly](https://sideloadly.io/) with your own free Apple account, or Xcode's Personal Team on a Mac with Xcode 26+.

1. Connect the iPhone by USB, unlock it and trust this Mac.
2. In Sideloadly, select the phone and the unsigned IPA. Keep the normal Apple ID sideloading mode; no tweaks or app modifications are needed.
3. Enter your Apple account and complete verification yourself in the tool. Never put passwords or signing keys in this repository or send them through chat.
4. Enable Developer Mode on the phone if requested. Trust the developer profile under Settings → General → VPN & Device Management when required, then open Soft Room.

Free Apple account provisioning normally expires after 7 days; re-sign when needed. This project does not assume a paid developer account. A compiled unsigned IPA is not evidence of successful signing or installation.

## Device acceptance

Open the app with the development server stopped. Test room creation/joining, shared links (which use the public website), Waku messages, voice/video permissions, push-to-talk release, screen wake lock, and two-device direct/TURN connections. Test foreground/background transitions and phone calls interrupting audio. Background recording or persistent background calls are not implemented.
