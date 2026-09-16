Soft Room for iPhone and Android. This private release requires repository access.

Version 0.2.1 adds a session-scoped access-code path on the blocked-region screen for invited testers. It also includes the encrypted room file sharing introduced in 0.2.0: images, video, audio, PDF and Markdown can be viewed in a room, while every attachment keeps a prominent original-file download. Images support compact previews, supported browsers can create lower-bitrate audio/video previews, and unsupported mobile engines safely keep the original. This build includes the current Waku history fallback, WebRTC channels, Cloudflare TURN configuration and browser/Android/iOS attachment compatibility paths.

- **Android:** `Soft-Room-android.apk` is signed and ready to install. Download it on your Android phone and confirm the browser's install prompt. Future updates must use the same signing certificate and a newer version code; the update button downloads the latest APK but does not install it silently. Check `Soft-Room-android.apk.sha256` if desired.
- **iPhone:** `Soft-Room-unsigned.ipa` needs your own Apple ID signature before installation. A compatible sideloading tool can sign it. With Xcode 26+, download the release source, run `npm ci` and `npm run ios:sync`, then open `ios/App/App.xcodeproj`, select your Personal Team and connected phone, and build. Xcode signs its project build rather than the downloaded IPA. Check `Soft-Room-unsigned.ipa.sha256` if desired.

Android：下载已签名的 `Soft-Room-android.apk`，在手机上确认安装。升级按钮只负责下载，安装仍需你确认。iPhone：下载 `Soft-Room-unsigned.ipa` 后，用自己的 Apple ID 通过侧载工具签名；也可以在 Xcode 26 或更新版本中打开本版本源码，选择自己的 Personal Team 构建安装。私有仓库的下载需要仓库权限。

The built-in Cloudflare TURN credential service is configured in this build. Direct/STUN is still attempted first, and a custom TURN service remains available in channel advanced settings.
