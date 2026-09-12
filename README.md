# Soft Room

一个可直接部署到 Cloudflare Pages 的纯静态加密聊天室。Vanilla TypeScript + Vite，无运行时 Node 后端。三套新拟物皮肤，中英文、桌面折叠侧栏和手机抽屉。界面图标优先使用 Lucide。

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

`src/transport.ts` 在浏览器直接创建 @waku/sdk 轻节点，SDK 默认仅连接安全 WebSocket；加入官方阿姆斯特丹、美国中部、香港共六个 cluster 1 节点，并保留 DNS 与 Peer Exchange 自动发现。保留既有 room content topic 和网络配置，发送密文使用 LightPush、实时接收使用 Filter，历史恢复使用 Store。SDK 维护发现和底层连接；应用使用官方 FilterCore 定期向各节点请求真实订阅确认，确认绑定具体连接，至少一个有效节点即可继续。备用节点断开不影响健康节点；LightPushCore 并行发送，任一确认即成功。切换房间或离开时停止旧轻节点。发送失败保留文字，节点确认不等于所有成员已收到。浏览器所处网络必须能够访问公共节点和 DNS-over-HTTPS，本站不再为手机提供代理。

旧 `/waku-api` 和 `/access/check` 已删除。开发与生产都使用相同浏览器传输代码。SDK 主应用包约 913 KB（gzip 284 KB），入口检查通过后才加载；不使用 CDN 脚本。

## 入口检查与地区

`src/entry.ts` 先识别设备与浏览器。根据 `navigator.languages` 选择中文/英文，已手动选择的会话语言优先。拒绝微信、抖音、QQ、支付宝等已知内置浏览器，提供复制链接和外部打开指引。Android 可尝试浏览器 Intent；宿主 App 可能禁止跳转，iOS 使用菜单或复制打开。

`localhost`、`127.0.0.1`、`192.168.x.x` 跳过地区查询。其他地址从 **本站 `/cdn-cgi/trace`** 读取 Cloudflare 提供的 `ip` 和 `loc`，`CN/HK/MO` 显示不提供服务。该路径由 Cloudflare 自动提供，不是项目后端，不需要付费 API 或密钥。只使用访问者地区 `loc`，不使用边缘节点 `colo`。请求不带邀请码、聊天数据或 cookies。解析失败/不可用时显示重试，不视为通过。

地区检测针对 Cloudflare Pages/经 Cloudflare 代理的域名；若搬到其他静态托管平台，需要更换地区查询来源。没有 country.is 外部查询或本机 GeoIP 数据库。浏览器 UA 可伪装、IP 可受代理/VPN 影响，属于页面入口检查，不是网络层不可绕过的访问控制。

参考：[Cloudflare /cdn-cgi/](https://developers.cloudflare.com/fundamentals/reference/cdn-cgi-endpoint/)。

## 房间与密码学

- 身份使用随机 Ed25519 密钥；完整公钥作为身份，名称只用于展示。
- 消息用房间密钥做 XChaCha20-Poly1305 加密，签名、名称、nonce 和 epoch 都在密文内。校验签名和 PoW 后才接收。限制文字消息 2000 字符（mesh 信令另限 12000 字符）、密文 16000 字节、正常消息时间差 5 分钟。
- 新 PoW 房间使用 `sr2.` base64url 邀请，只携带 seed、名称和版本参数。Read PoW 为 seed 的 32 字节连续做恰好一百万次 SHA-256，结果作为房间密钥。创建者与加入者都在 Worker 中执行。
- Write PoW 绑定房间、公钥和 UTC 自然日；SHA-256 前 48 位小于 `floor(2^48 / 1,000,000)`，平均一百万次尝试。接收端要求消息 epoch 等于接收当天和消息时间所属日期。
- 每天 UTC 00:00（北京时间 08:00）更新发言证明，跨日延迟到达的旧消息被拒绝，已显示消息不删除。Read PoW 结果随本标签页缓存，不必每天重算。等待发言证明期间可读，可取消再继续。
- 无 PoW 及旧 `sr1` 邀请保持原协议，旧房间不做静默迁移。持有派生密钥的成员可以分享密钥绕开 Read PoW。Write PoW 是每身份每日成本，不是逐消息限速，也不减轻所有网络层负担。

## 名称、心跳与页面记忆

全局名称在“我的身份”中设置；房间昵称在当前房间身份卡设置，优先于全局名称。消息/心跳中的 nickname 声明当前有效名称。按完整公钥跟踪：首次看到不提示，之后名称变化显示一行提示。早于已知名称的旧消息不触发倒退改名。

发言证明有效时每约 5 秒发送隐藏心跳，带最新名称，仍需通过签名、加密和 PoW 检查。30 秒没有新心跳标记离线；潜水、不发心跳或被浏览器暂停时，通过下一次发言仍可更新名称。成员列表仅显示本页面见过的人、完整公钥及在线/离线状态，没有持久成员名册。

身份私钥、全局名称、房间信息/密钥、证明、语言和皮肤保存在本标签页 sessionStorage。刷新保留这些数据，并从 Store 尝试恢复可用的文字记录；在线状态仍由新心跳确认。关闭标签页或重启浏览器可能丢失；浏览器会话恢复也可能保留。提供清除按钮。最多保存 100 个房间，每房间最多显示 1000 条记录并记住最近 2000 个消息 ID。

没有永久存档、房主特权、踢人、前向保密或密钥轮换。消息标记 ephemeral 不能强迫其他参与者删除副本。

## 验证

```sh
npm run build
npm test
# 先运行 npm run preview，需本机安装 Chrome，或指定 BROWSER_PATH
npm run test:lan
```

`test:lan` 使用两个独立 Chrome 会话加载静态站点，实际执行 Read/Write PoW，双向 Waku 消息、心跳改名、离线超时和自动重连，并断言没有本机 API/WebSocket 请求。它是桌面浏览器自动测试，不等于实体手机网络测试。

## WebRTC 频道

房间标题栏的“频道”入口打开频道卡片列表，列表没有独立加入/退出按钮。创建入口打开独立子页面，填写名称并选择纯语音、视频或对讲机；创建后直接进入频道。点击整张频道卡片也会进入。频道页覆盖房间聊天区，一次只参加一个频道；返回按钮和浏览器返回只收起频道页，继续保持频道连接和已经开启的媒体。点击「离开频道」、加入另一个频道、离开房间或卸载页面才退出并释放采集设备。刷新后不会自动重新加入。创建者普通退出不解散其他参与者；创建者主动关闭频道则停止该频道连接。

`mesh-wire.ts` 定义创建者签名的网络描述，绑定随机网络 ID、房间 ID、名称、公钥。每个参与者在原有 5 秒隐藏心跳中携带该描述和新的加入实例 ID，只声明自己的参与状态。离开声明为 null，旧心跳不会覆盖较新的声明。频道 v3 描述额外签名绑定 enabled 和单调 revision，只有创建人可以开关；旧 revision 不会覆盖新状态。隐藏心跳最多携带四条已知频道公告，轮转传播，关闭状态也会被其他房间用户转发。当前页面按房间保留最多 64 个已知频道，离开房间再返回仍保留，刷新后清空。频道关闭后断开其 WebRTC 与采集设备；重新开启后成员需主动进入。没有服务端名册或强一致性，状态需要通过消息网络传播。30 秒没有声明且没有活跃直连时，参与者从在线频道人数中过期，频道卡片仍保留。

`mesh.ts` 是独立于 DOM 的标准 WebRTC 模块。公钥字典序较小的一方发起 offer，每对成员只有一条 RTCPeerConnection。信令以 `kind: mesh` 通过现有 Waku 房间发送，依然做房间加密、Ed25519 签名、每日 PoW 和短时效检查。携带接收者、网络、双方加入实例和连接 ID，避免串网与旧连接回复。信令不进入聊天记录。首次协商最多等待 300 毫秒收集初始 ICE，之后每 3 秒重发最新 SDP 并补入迟到候选地址、未建成的连接每约 45 秒重试。退出、切房间及销毁时关闭连接。发送 Waku 信令时不占用 WebRTC 协商锁，避免发送确认尚未返回时丢弃应答。

数据通道发送隐藏的 ping/pong、频道文字和媒体状态。三种模式都支持频道内文字，独立于房间 Waku 聊天；文字仅发送给当前已连通成员，连接不可用时保留草稿并提示。频道文字最多 2000 字符、当前页面最多 300 条，不补发离线记录，退出清空。媒体轨道经 WebRTC RTP 传输，不通过 Waku。进入时麦克风和摄像头关闭，由用户点击开启；对讲机按住说话，松开、失焦或切后台时静音。权限请求晚于退出或松手返回时，也会立即停止或保持静音。Waku 仅负责发现、心跳及建立连接的信令。Waku 发现在线与 WebRTC 直连状态分开：Waku 暂时断开时，仍正常回应数据探测的连接继续保留。每天发言 PoW 更新期间可维持已有数据通道，新信令等待证明恢复。

默认启用公共 STUN `stun:stun.cloudflare.com:3478`，使用 `max-bundle` 减少候选地址和连接开销；首次发送不等待公共 ICE 服务完成，后续候选地址随最新 SDP 重传；接收端按媒体段和 ICE generation 去重补入，不重建已建立的协商。支持尝试跨 NAT 直连；同机浏览器成功不代表所有网络都能互通。Cloudflare TURN 通过独立 Worker 签发临时凭据；未配置 Worker 时只使用 STUN，因此部分 5G/VPN 环境仍可能无法直连。`RoomMesh` 的 `rtcConfiguration` 是后续注入 ICE 服务配置的入口；不要将长期 TURN 密钥写入静态包。全连接 N 人共 N(N-1)/2 条连接，当前面向小规模使用。

```sh
npm run test:mesh
```

该测试使用三个独立 Chrome 会话、真实 Waku 公共服务节点和真实 WebRTC 数据通道，覆盖晚加入、三人全连接、创建者退出、重新加入、多网络隔离及刷新重入。与实体手机、iOS 原生容器验证分开报告。

## 后续 Capacitor 封装

新组网模块仅用标准浏览器 API，没有 Node 服务、浏览器扩展 API、动态远程脚本或音视频权限依赖。Capacitor 核心库负责识别原生容器，`platform.ts` 使用 CapacitorHttp 执行原生地区查询，避免 `capacitor://localhost` 的跨域限制；浏览器继续使用同域 fetch。原生容器不会被第三方内置浏览器检查误拦，也不会由于本地 hostname 而跳过地区规则。

封装时配置 `VITE_PUBLIC_ORIGIN=https://实际的Cloudflare域名` 并重新构建，作为地区查询和可分享邀请地址。缺失配置时原生地区检查失败关闭；邀请构造不会泄漏不可访问的 capacitor:// 地址，可退回原始邀请码。需按 Capacitor 流程添加 iOS 工程、同步 core 原生插件并配置网络权限/ATS；这里尚未创建 iOS 工程。WebKit 自动测试不等于 iPhone WKWebView 真机验证。

iOS 后台可能暂停 JavaScript 和网络；不能保证锁屏常驻 mesh。当前在页面恢复可见后检查连接并恢复信令，后续封装需要接入 App 生命周期和邀请深链接；后台语音、来电与持久身份不在本轮范围内。

补充引擎恢复测试：`npm run test:mesh:engine` 使用真实 WebRTC，模拟 Waku 信令丢包、重复和中断；`MESH_ENGINE=webkit npm run test:mesh:engine` 在 WebKit 上运行同一测试。`MESH_ENGINE=webkit npm run test:mesh` 则运行完整页面和真实 Waku 流程。首次使用 WebKit 需 `npx playwright-core install webkit`。CapacitorHttp 使用 core 内置原生实现，不启用全局 fetch/XHR 补丁，以免改变 Waku SDK 的网络行为。

## 频道模式与屏幕常亮

新的频道描述采用 v2，名称、模式、房间及创建者都绑定签名，参与者不能篡改模式；仍识别旧 v1 网络描述。音视频使用预先协商的收发 transceiver，开启设备后 replaceTrack，无需为每次开关重新协商。视频默认请求 640×360、15fps（上限 24fps），纯语音与对讲机不请求摄像头。浏览器阻止自动播放时提供“播放声音”按钮。

手机/平板进入应用后请求 Screen Wake Lock；页面隐藏或卸载时释放，恢复可见或用户再次交互时重试。浏览器不支持、低电量或系统拒绝时不会用视频循环等方式强行绕过。未来 Capacitor 原生包使用 `@capacitor-community/keep-awake`（需同步原生插件），不等于获得后台常驻权限。常亮 API 自动测试不能代替实体手机熄屏验收。

后续 iOS 封装还需添加 `NSMicrophoneUsageDescription`、`NSCameraUsageDescription` 并配置原生 WebView 的媒体权限。当前未创建 iOS 工程、未做 iPhone 真机录音/视频或锁屏测试。

`npm run test:channels` 用两套真实浏览器会话、Waku 和模拟采集设备验证三种模式、独立文字、音视频 RTP、对讲机松手静音、页面返回及设备释放；不会使用真实麦克风/摄像头。引擎测试另验证 WebKit 下生成音视频轨道的收发和 Waku 中断期间的频道文字。

频道显示连接等待、部分连接和持续失败状态；没有可用连接时禁用发送按钮，输入内容保留。


### Cloudflare TURN setup

The site stays static. `workers/turn` is a separate Cloudflare Worker which issues temporary credentials; the computer serving the website is not a relay or credential server.

1. Create a TURN key in Cloudflare Realtime. Keep its Key ID and API token in Worker Secrets (`TURN_KEY_ID`, `TURN_API_TOKEN`). Do not put the token in `VITE_*`, Git, or chat.
2. Set exact browser origins in `workers/turn/wrangler.jsonc` (`ALLOWED_ORIGINS`), including the LAN preview origin and future Capacitor origin. The Worker accepts only these origins and rate-limits issuance to 10 requests per minute per IP per Cloudflare location. Origin checking is not user authentication; this toy endpoint has no membership authentication or global spend cap.
3. Run `npx wrangler secret put TURN_KEY_ID --config workers/turn/wrangler.jsonc` and the equivalent for `TURN_API_TOKEN`, then `npx wrangler deploy --config workers/turn/wrangler.jsonc` in your chosen account. Namespace `5173001` must not collide with an unrelated limiter in that account.
4. Set `VITE_TURN_CREDENTIALS_URL=https://<worker>.workers.dev/ice` in `.env.local`, rebuild and refresh every device. No API key is exposed by this variable.

The default relay requires an identity-bound proof for each fixed two-hour UTC epoch. GET /challenge returns a server-authenticated deterministic challenge; POST /ice verifies its HMAC, epoch, difficulty, nonce and Ed25519 signature before calling Cloudflare. GET /ice is disabled. Difficulty is set by the Worker (TURN_POW_BITS=23, expected 8,388,608 SHA256 attempts). The client mines in a dedicated Worker with cancellation and elapsed-time feedback; completed proofs are cached in sessionStorage for the current identity and epoch. Verification is fast and stateless, not a client-only delay.

Credentials expire before the current epoch ends, with a 10-second issuance margin. Direct connectivity is attempted first; the default relay proof starts only when connections remain pending. If direct connectivity succeeds during mining, work is cancelled. On credential expiry, compliant clients close their affected managed relay connections and obtain a new proof, retaining the channel and media tracks. Already-direct paths are retained. A prior deployment's 24-hour credentials remain valid until their own expiry; this gate does not retroactively revoke them. TURN credentials are bearer credentials and can be shared; PoW protects issuance, not every byte of traffic or credential redistribution. Cloudflare's server allocation cleanup semantics are separate from the client epoch boundary.

On-device channel advanced settings accept a custom TURN URL list, username and password. These are held only in that page's channel map, are not included in signed channel descriptions or Waku messages, and bypass the default credential service and PoW. The panel never populates the built-in service's address or credentials; browser network inspection can still reveal the built-in endpoints.

Initial timing measurement: desktop Chrome approximately 264k hashes/s, with 4x CPU throttling approximately 132k hashes/s (about 64 seconds expected at 23 bits). This is an emulator estimate, not a real-phone benchmark. PoW completion times are random and device dependent. Do not derive server difficulty from a client-provided benchmark.

Sources: https://developers.cloudflare.com/realtime/turn/generate-credentials/ and https://fleets.waku.org/data.json (fleet snapshot 2026-09-11).

当前本地预览已接入 `https://soft-room-turn.zhengxingao.workers.dev/ice`。Worker 已部署，长期密钥仅在 Cloudflare Secrets 中；更换站点域名时更新允许的 Origin。

单网关实测：`GATEWAY_HOST=node-01.gc-us-central1-a.waku.sandbox.status.im node tests/browser-gateway.mjs`，测试会阻断其他所有 WSS 节点。强制中继测试：`TURN_TEST_URL=https://soft-room-turn.zhengxingao.workers.dev/ice npm run test:mesh:engine`，检查实际选中 relay candidate，避免把局域网直连误认为 TURN 成功。

2026-09-11 验证：47 项单元测试通过；真实 Waku 双浏览器消息、心跳、离线恢复通过；仅美国单一 WSS 网关可达时双向消息通过；Cloudflare TURN 强制 relay 的三人连接、音视频 RTP、文字、断线重建与信令中断测试通过。实体手机 5G/VPN 网络仍需用户验收。

## 聊天历史

房间文字通过非 ephemeral 编码器发送，Store 保存的是已有房间加密密文。心跳与频道信令保持 ephemeral。之前版本发送的文字没有要求节点保存，可能无法恢复。公共 Store 的留存策略和可用性不受本应用控制，不保证完整性。

进入房间并接通实时订阅后异步查询 Store，最多尝试三个已连接 Store 节点，每个最多十页、每页 50 条，总查询约 45 秒超时；按签名时间保留最近七天，合并去重后最多 1000 条。查询失败可单独重试。返回顺序不影响显示顺序，旧名称不会覆盖更新的名称，旧记录不产生在线心跳或频道动作。历史解密独立验证签名、房间、消息类型和消息日期对应的每日 PoW，实时接收仍保留五分钟及当前 epoch 限制。

加载提示覆盖在聊天区上方，不改变聊天区高度；插入消息时按可见消息 ID 与像素偏移恢复滚动位置。在底部时跟随消息，阅读上方时不会自动拉到底部。

验证：`node tests/browser-history.mjs` 检查手机宽度的历史插入、新消息滚动保留及新连接从公网 Store 找回密文消息；`tests/history.test.ts` 检查历史认证、跨日 PoW 与在线状态隔离。

频道连接回归：`node tests/browser-ice-delay.mjs` 使用真实 WebRTC 延迟 16 秒公开候选地址，旧版本超时，新版补发后连通并传输文字。`CHANNEL_CROSS_BROWSER=1 node tests/browser-channels.mjs` 检查 WebKit/Chrome 页面通过实际 Waku 完成三种频道模式的协商和文字传输（音视频采集另由默认 Chrome 测试覆盖）。

## Cloudflare 静态部署

Pages 项目 `soft-room`，生产分支 `codex/initial`，默认地址 https://soft-room.pages.dev ，自定义域名 https://blink.wakukusmartrecipe.uk 。自定义域名需在 Cloudflare DNS 添加 CNAME `blink` → `soft-room.pages.dev` 并等待 Pages 验证和 HTTPS 证书生效。域名主站保持独立。

`.env.production` 只包含公开站点及 TURN Worker 地址，长期凭证留在 Worker Secrets。部署命令：

```sh
npm run build
npx wrangler deploy --config workers/turn/wrangler.jsonc
npx wrangler pages deploy dist --project-name soft-room --branch codex/initial
```

TURN Worker 允许两个公开站点来源和原有本地调试来源；地区识别继续使用访问站点的 `/cdn-cgi/trace`，沿用原有地区规则。静态部署不依赖开发电脑。

`node tests/browser-channel-lifecycle.mjs` 验证返回后继续收发及采集、创建人开关、关闭目录、重开、切换频道和离开房间。可以通过 `STATIC_ORIGIN` 检查公开部署，通过 `BROWSER_PROXY` 指定测试浏览器网络。
