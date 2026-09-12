# Soft Room on iPhone

The Capacitor app bundles the website locally. It does not need a running development server. Waku, STUN, the TURN credential Worker, and the public site used for regional checks still require network access.

## Release artifact

Pushing a tag such as `v0.1.0` runs `.github/workflows/ios-release.yml` on GitHub's macOS 26 runner. The workflow checks that the tag matches `package.json`, builds the app without signing, verifies there is no embedded provisioning profile, and creates a GitHub Release containing `Soft-Room-unsigned.ipa` and its SHA-256 checksum. No Apple ID, certificate, provisioning profile, or private key is uploaded to GitHub. The release and source code require access to this private repository.

The unsigned IPA is **not installable**. Each tester signs it for their own device with a compatible sideloading tool and their own Apple ID. Alternatively, testers can download the release source and build/install it through Xcode. Xcode signs a project build; it does not directly sign a downloaded IPA.

## Build and sign with Xcode

Requires Node 22+, Xcode 26+, and a connected iPhone with Developer Mode enabled.

```sh
npm ci
npm run ios:sync
npm run ios:open
```

In Xcode, open the App target's **Signing & Capabilities**, enable automatic signing, select your Personal Team, and use a bundle ID available to that team if Xcode requests one. Select the iPhone as the run destination and run the app. Xcode will register the device and create a development profile when necessary. For a private release, each tester needs repository access to download the source or IPA.

## Sign an IPA for one of your own devices

Use a sideloading tool that signs the downloaded unsigned IPA with your Apple ID, or use the local `scripts/sign-ios-personal.sh` helper when you already have a valid Apple Development identity in Keychain and a provisioning profile for your device:

```sh
bash scripts/sign-ios-personal.sh Soft-Room-unsigned.ipa /path/to/profile.mobileprovision CERTIFICATE_SHA1 Soft-Room-my-device.ipa
```

The helper validates the profile, signs nested frameworks and the app, and verifies the resulting IPA. Keep this signed output local; it only installs on devices included in that profile. Free Personal Team profiles normally expire after seven days. The app's identity, names, and rooms are temporary session data, so back up invitation links before reinstalling or clearing the app.

## Device acceptance

With the development server stopped, test room creation/joining, Waku messages, voice/video permissions, push-to-talk release, screen wake lock, and two-device direct/TURN connections. Background recording and persistent background calls are not implemented.
