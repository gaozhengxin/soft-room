Soft Room for iPhone and Android. This private release requires repository access.

- **Android:** `Soft-Room-android.apk` is signed and ready to install. Download it on your Android phone and confirm the browser's install prompt. Future updates must use the same signing certificate and a newer version code; the update button downloads the latest APK but does not install it silently. Check `Soft-Room-android.apk.sha256` if desired.
- **iPhone:** `Soft-Room-unsigned.ipa` needs your own Apple ID signature before installation. A compatible sideloading tool can sign it. With Xcode 26+, download the release source, run `npm ci` and `npm run ios:sync`, then open `ios/App/App.xcodeproj`, select your Personal Team and connected phone, and build. Xcode signs its project build rather than the downloaded IPA. Check `Soft-Room-unsigned.ipa.sha256` if desired.

Android：下载已签名的 `Soft-Room-android.apk`，在手机上确认安装。升级按钮只负责下载，安装仍需你确认。iPhone：下载 `Soft-Room-unsigned.ipa` 后，用自己的 Apple ID 通过侧载工具签名；也可以在 Xcode 26 或更新版本中打开本版本源码，选择自己的 Personal Team 构建安装。私有仓库的下载需要仓库权限。
