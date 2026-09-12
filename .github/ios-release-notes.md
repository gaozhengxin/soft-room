Download `Soft-Room-unsigned.ipa` to sign it with your own Apple ID. This file cannot be installed before signing. Its SHA-256 checksum is provided alongside it.

- **Using Xcode:** Download this release's source code, run `npm ci` and `npm run ios:sync`, then open `ios/App/App.xcodeproj` in Xcode 26 or newer. In Signing & Capabilities, enable automatic signing, select your Personal Team, choose your connected iPhone and run the app. Xcode signs the project build; it does not sign the downloaded IPA directly.
- **Using a sideloading tool:** Give the unsigned IPA to a tool that supports signing with your own Apple ID, then install it on your iPhone. The free Personal Team profile must include your device and normally expires after seven days.

This repository is private, so access to the release and source code requires repository permission.

下载 `Soft-Room-unsigned.ipa` 后，需要用自己的 Apple ID 签名才能安装；旁边附有 SHA-256 校验文件。用 Xcode 的话，下载本版本源码，在 Xcode 26 或更新版本中打开 `ios/App/App.xcodeproj`，选择自己的 Personal Team 和 iPhone 来构建安装。Xcode 不直接给下载的 IPA 签名。也可以把未签名 IPA 交给支持 Apple ID 签名的侧载工具。免费个人描述文件通常七天到期；私有仓库的下载需要仓库权限。
