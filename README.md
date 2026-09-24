# Soft Room

Soft Room 是一个基于 Logos Messaging / Waku 的实验性通信应用，包含浏览器、Android 和 iOS 客户端，提供加密房间、文件消息和 WebRTC 实时频道。

项目优先采用点对点和分布式通信，不把房间、身份和访问权限交给单一中心服务器；存储、信令与中继只作为可替换的辅助服务。客户端保护消息、密钥和身份材料，但无法隐藏 IP 地址、连接时间和流量大小等全部网络元数据，用户需要妥善保管设备、邀请链接和身份恢复文件。

项目仍在开发中，协议、数据格式和客户端行为可能继续调整。

## 本地运行

需要 Node.js 和 npm。

```sh
npm ci
npm run dev
```

执行检查和生产构建：

```sh
npm test
npm run build
```

## 移动端

Android 安装包和可重新签名的 iOS 安装包发布在 [GitHub Releases](https://github.com/gaozhengxin/soft-room/releases)。

iOS 安装包不包含开发者签名，需要使用自己的 Apple ID 和 Personal Team 签名后安装。
