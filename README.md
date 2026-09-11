# Soft Room

一个可直接部署到 Cloudflare Pages 的纯静态加密聊天室。Vanilla TypeScript + Vite，无运行时 Node 后端。两套新拟物皮肤，中英文、桌面折叠侧栏和手机抽屉。界面图标优先使用 Lucide。

## 本地运行与部署

```sh
npm ci
npm run build
npm run preview
```

`npm run preview` 用 HTTPS 静态服务器在 `0.0.0.0:5173` 提供 **dist 中的文件**，没有 HMR、API、WebSocket 代理或本地广播。现有开发证书放在 `.certs/`，不提交、不进入 dist；首次本地开发可运行 `npm run dev` 生成证书。手机使用 `https://192.168.2.112:5173/`，按浏览器提示信任开发证书。IP 不同需调整本地证书 SAN。每次修改源码后重新构建再刷新。

Cloudflare Pages 上传 `dist` 即可，或设置构建命令 `npm run build`、输出目录 `dist`。不需要 Pages Functions、Worker、数据库、后端环境变量或常驻个人电脑。静态预览脚本仅用于本地服务文件，部署时不上传/运行。

## 浏览器接入 Waku

```text
浏览器：临时身份、PoW、签名、加密、Waku SDK
  ↕ 公共 WSS（DNS 发现 + Peer Exchange）
Waku 公共服务节点：LightPush / Filter
```

`src/transport.ts` 在浏览器直接创建 @waku/sdk 轻节点，SDK 默认仅连接安全 WebSocket，最多选择两个合适服务节点。保留既有 room content topic 和网络配置，发送密文使用 LightPush、接收使用 Filter，不查询 Store。SDK 维护节点发现、连接与订阅，应用在断开后重试房间订阅。切换房间或离开时停止旧轻节点。发送失败保留文字，节点确认不等于所有成员已收到。浏览器所处网络必须能够访问公共节点和 DNS-over-HTTPS，本站不再为手机提供代理。

旧 `/waku-api` 和 `/access/check` 已删除。开发与生产都使用相同浏览器传输代码。SDK 主应用包约 913 KB（gzip 284 KB），入口检查通过后才加载；不使用 CDN 脚本。

## 入口检查与地区

`src/entry.ts` 先识别设备与浏览器。根据 `navigator.languages` 选择中文/英文，已手动选择的会话语言优先。拒绝微信、抖音、QQ、支付宝等已知内置浏览器，提供复制链接和外部打开指引。Android 可尝试浏览器 Intent；宿主 App 可能禁止跳转，iOS 使用菜单或复制打开。

`localhost`、`127.0.0.1`、`192.168.x.x` 跳过地区查询。其他地址从 **本站 `/cdn-cgi/trace`** 读取 Cloudflare 提供的 `ip` 和 `loc`，`CN/HK/MO` 显示不提供服务。该路径由 Cloudflare 自动提供，不是项目后端，不需要付费 API 或密钥。只使用访问者地区 `loc`，不使用边缘节点 `colo`。请求不带邀请码、聊天数据或 cookies。解析失败/不可用时显示重试，不视为通过。

地区检测针对 Cloudflare Pages/经 Cloudflare 代理的域名；若搬到其他静态托管平台，需要更换地区查询来源。没有 country.is 外部查询或本机 GeoIP 数据库。浏览器 UA 可伪装、IP 可受代理/VPN 影响，属于页面入口检查，不是网络层不可绕过的访问控制。

参考：[Cloudflare /cdn-cgi/](https://developers.cloudflare.com/fundamentals/reference/cdn-cgi-endpoint/)。

## 房间与密码学

- 身份使用随机 Ed25519 密钥；完整公钥作为身份，名称只用于展示。
- 消息用房间密钥做 XChaCha20-Poly1305 加密，签名、名称、nonce 和 epoch 都在密文内。校验签名和 PoW 后才接收。限制消息 2000 字符、密文 16000 字节、正常消息时间差 5 分钟。
- 新 PoW 房间使用 `sr2.` base64url 邀请，只携带 seed、名称和版本参数。Read PoW 为 seed 的 32 字节连续做恰好一百万次 SHA-256，结果作为房间密钥。创建者与加入者都在 Worker 中执行。
- Write PoW 绑定房间、公钥和 UTC 自然日；SHA-256 前 48 位小于 `floor(2^48 / 1,000,000)`，平均一百万次尝试。接收端要求消息 epoch 等于接收当天和消息时间所属日期。
- 每天 UTC 00:00（北京时间 08:00）更新发言证明，跨日延迟到达的旧消息被拒绝，已显示消息不删除。Read PoW 结果随本标签页缓存，不必每天重算。等待发言证明期间可读，可取消再继续。
- 无 PoW 及旧 `sr1` 邀请保持原协议，旧房间不做静默迁移。持有派生密钥的成员可以分享密钥绕开 Read PoW。Write PoW 是每身份每日成本，不是逐消息限速，也不减轻所有网络层负担。

## 名称、心跳与页面记忆

全局名称在“我的身份”中设置；房间昵称在当前房间身份卡设置，优先于全局名称。消息/心跳中的 nickname 声明当前有效名称。按完整公钥跟踪：首次看到不提示，之后名称变化显示一行提示。早于已知名称的旧消息不触发倒退改名。

发言证明有效时每约 5 秒发送隐藏心跳，带最新名称，仍需通过签名、加密和 PoW 检查。30 秒没有新心跳标记离线；潜水、不发心跳或被浏览器暂停时，通过下一次发言仍可更新名称。成员列表仅显示本页面见过的人、完整公钥及在线/离线状态，没有持久成员名册。

身份私钥、全局名称、房间信息/密钥、证明、语言和皮肤保存在本标签页 sessionStorage。刷新保留这些数据，清空聊天、名称跟踪和成员记忆。关闭标签页或重启浏览器可能丢失；浏览器会话恢复也可能保留。提供清除按钮。最多保存 100 个房间，每房间最多显示 300 条记录并记住最近 2000 个消息 ID。

没有历史恢复、房主特权、踢人、前向保密或密钥轮换。消息标记 ephemeral 不能强迫其他参与者删除副本。

## 验证

```sh
npm run build
npm test
# 先运行 npm run preview，需本机安装 Chrome，或指定 BROWSER_PATH
npm run test:lan
```

`test:lan` 使用两个独立 Chrome 会话加载静态站点，实际执行 Read/Write PoW，双向 Waku 消息、心跳改名、离线超时和自动重连，并断言没有本机 API/WebSocket 请求。它是桌面浏览器自动测试，不等于实体手机网络测试。
