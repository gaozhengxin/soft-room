# Soft Room

一个基于 **Logos Messaging（原 Waku）** 的本地小聊天室。Vite + 原生 TypeScript + CSS，加一个只传密文的本地 Waku 网关；无 React、账户系统或数据库。

## 开始玩

要求 Node.js 22.18+（本机使用 24.10.0）。

```bash
cd ~/waku/soft-room
npm ci
npm run dev
```

打开终端打印的 **Network HTTPS 地址**，例如 `https://192.168.2.112:5173/`。桌面与手机都用这个地址，避免从 localhost 复制出其他设备无法访问的链接。IP 可能随 Wi-Fi 改变。

1. 第一次访问会提示本地自签名证书，允许访问这个本机地址。此证书仅供局域网调试，不自动安装到系统信任库。
2. 首次打开生成临时 Ed25519 身份，同一标签页刷新会恢复身份与房间。新建房间默认开启阅读与每日发言 PoW，也可关闭。
3. 点击「复制邀请链接」，私下发给同一局域网的朋友。也可把 `sr1.` 开头的邀请码粘到加入框。
4. PoW 在后台 Worker 计算，显示耗时与等待动画，可随时取消。解锁房间后即可阅读，发言验证完成后才能发送文字。取消发言计算仍可阅读，也可点击继续验证。Enter 发送，Shift+Enter 换行。
5. 房间标题下可设置独立昵称，随该房间缓存，从下一条消息开始向其他成员显示。留空使用默认身份名称；消息仍附身份短码，昵称不影响身份或入场凭证。
6. 「我的房间」可以重新进入、复制邀请或移除本地房间；语言菜单支持中文 / English，即时切换，不中断计算或聊天。

电脑需要保持运行；手机和电脑处于能互访的网络，防火墙允许 5173 端口。App 在本机托管，默认仍需要互联网连接官方 Waku 节点，不是离线局域网聊天。

## 网络与开发代理

当前环境直连官方节点 8000 端口超时，经本机已有 HTTP 代理可以连接。默认由一个随 Vite 启动的轻量、无状态网关连接官方 Waku 网络：

```
浏览器（临时身份、房间密钥、签名、加密、PoW）
  → 本机 HTTPS / WebSocket 网关（密文 + content topic）
  → 官方 Waku 节点（LightPush / Filter）
  → 网关的另一个独立 Waku 客户端 → 另一浏览器解密
```

网关代码在 `server/gateway.ts`，每个浏览器对应一个真正的 Waku light client。网关不持有房间钥匙，不建房、不保存消息，也不在本地广播消息：客户端收到的密文来自官方 Filter 回调。临时身份签名与密钥始终由浏览器掌握。网关能观察连接、主题和消息长度等元数据。

网关通过官方 DNS 自动发现节点，复用启动环境中的 `https_proxy` / `HTTPS_PROXY`；若当前没有配置代理，则尝试直连。手机无需单独配置代理。`npm run preview` 也包含相同网关，不能把 dist 放到普通静态服务器后就期待它自己完成收发。

这是本地玩具，网关同时允许最多 12 个浏览器连接；没有账号、数据库或房间目录。电脑仍需联网，这不是离线 LAN 聊天。如果要换端口，修改 `vite.config.ts`；各设备重新用新地址打开即可。

## 最小协议

- 身份：首次生成随机 Ed25519 密钥；身份私钥、房间密钥、房间列表、完成的 PoW 凭证、语言和当前房间保存到本标签页 sessionStorage。恢复时从私钥重算公钥，并重新验证缓存的 PoW。昵称取公钥前 8 个十六进制字符，签名验证完整公钥。
- 邀请：新 PoW 房间使用 `sr2.` + base64url JSON，只含版本、256 位随机 seed、房间名和 PoW 设置，不含派生密钥。无 PoW 和旧房间继续使用 `sr1.`，其中包含密钥。链接使用 URL fragment，解析后从地址栏清除。
- 房间主题：v2 对版本、seed、名称和 PoW 设置做 SHA-256 承诺；v1 对密钥、名称和 PoW 设置做承诺。派生密钥前后 topic 不变；修改参数会产生不同房间。
- 加密：XChaCha20-Poly1305，每条随机 24 字节 nonce，以 content topic 作关联数据。明文正文先经 Ed25519 签名，再整体加密。邀请码持有人才有解密钥匙。
- Read PoW：将 seed 解码成 32 字节，顺序做恰好 1,000,000 次 SHA-256，最后 32 字节作为房间密钥。创建者与加入者使用同一算法，在 Worker 内计算。完成的密钥随本标签页会话缓存，刷新不必重算。
- Write PoW：SHA-256 前 48 位小于 `floor(2^48 / 1,000,000)`，平均约一百万次尝试。前缀绑定 v2 房间 ID、完整公钥、UTC 自然日 epoch。消息的 epoch 随正文签名加密；接收端要求 epoch 同时等于接收当天和消息时间所属日期，并验证 nonce。每日 UTC 00:00（北京时间 08:00）更新；旧证明不能用于新收到的消息，跨日延迟到达的旧消息也会被拒绝，已显示消息不删除。
- 状态：Read PoW 完成后订阅 Waku，随后自动计算 Write PoW。写入计算、取消或跨日更新期间可读不可写；计算跨日时继续计算新一天的证明。每秒、页面重新可见和窗口聚焦时检查日期，发送前再检查一次。
- 兼容：旧 `sr1` 房间保持原密钥、主题和一次性 PoW，不做静默迁移。新机制只用于新建 `sr2` PoW 房间。
- 昵称：每个房间独立设置，最多 24 个 UTF-16 单元，去除首尾空白，拒绝控制字符。昵称随消息一同签名和加密；旧消息缺少昵称时显示身份名称。改名只影响之后发送的消息，不需要重算 PoW。
- 消息：最多 2,000 字符，接收端拒绝超过 16 KB 的密文、无效签名/工作量以及与本机时间相差超过 5 分钟的消息。近期 ID 去重，界面最多保留 300 条。设备需正常校时。
- SDK（网关侧）：安装并核对 `@waku/sdk` 0.0.36 的实际 API，使用 `node.createEncoder/createDecoder`、`filter.subscribe`、`lightPush.send`；锁文件固定安装结果。

## 会话缓存与房间管理

使用 sessionStorage，不使用 localStorage 或数据库保存身份/房间。刷新恢复原身份、房间、凭证和语言；切换房间会停止旧连接与计算，完成的凭证继续保留。最多保存 100 个房间。移除只删除本标签页缓存，不解散远端房间；清除会话会停止连接/Worker、删除房间和凭证，并生成新身份。消息仅保存在页面内存中。

关闭标签页或重启浏览器可能丢失这些信息，请自行保存邀请链接。[浏览器会话恢复可能保留 sessionStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage)，因此页面不能诚实地保证「重启必定删除」。提供「清除会话」用于立即清除本标签页；其他标签页独立。顶部、身份提示、房间管理区、复制邀请反馈和 PoW 等待区都有生命周期提醒。缓存被浏览器禁用或写入失败时，提示仅保存在内存、刷新即丢失。

## 玩具边界

仅接收当前在线时的消息；不查询 Store、不恢复历史，刷新保留本标签页的身份与房间，但丢失页面消息记录。消息设置 ephemeral，但无法强迫外部节点或参与者删除副本。发送成功只表示 LightPush 节点确认接收，不等于所有成员已读。失败时保留文字供重试，网络超时下重试可能产生重复内容。

持有新邀请码可通过阅读计算获得密钥；已有成员可直接转发派生密钥，绕开 Read PoW。Write PoW 每身份每天付出一次成本，不是逐条消息限速；接收端过滤仍消耗带宽、解密与验证成本。没有踢人、密钥轮换、前向保密、加入前历史隔离、房主特权或持久身份。不是官方 RLN。传输节点仍能观察连接/主题等元数据。本机提供的页面代码需要被信任。

## 验证

```bash
npm run build             # TypeScript + production build，包括 Worker
npm test                  # 协议、缓存、中英文与打包后 Worker 求解/取消测试
NODE_USE_ENV_PROXY=1 npm run test:network   # 两个真实 SDK 客户端，通过公共网络
# 先启动 npm run dev；使用本地开发证书，双向测试实际 HTTPS 网关、Waku、加密与 PoW
npm run test:lan
```

网络测试仅发送测试消息。PoW 测试使用公开、确定性的测试身份与房间 fixture，不可用于真实聊天；此凭证已通过实际搜索得到，避免每次网络检查重新随机耗费数分钟。`test:lan` 创建两个独立 HTTPS 客户端，双向发送，收到后校验签名、密钥和 PoW。实体手机/桌面浏览器之间的人工联调仍需按上面的步骤操作；没有把 SDK 测试冒充实体设备验证。

## 官方实现简析

[Logos Messaging](https://docs.logos.co/messaging) 把 Delivery 传输和 Chat 群聊库分开。Delivery 提供 Relay、Filter、LightPush、Store；[官方 Chat](https://github.com/logos-messaging/logos-chat-nim) 使用 de-MLS 做群组加密，解决更完整的群组状态问题。

[官方 JS 示例](https://github.com/logos-messaging/examples.waku.org) 展示 LightPush/Filter、Store 及与以太坊地址相关的加密私聊；该示例仓库已归档。这里参考传输层分工，不搬钱包、完整群组协议或历史存储。需求是「有邀请码就能进」的小应用，使用每房共享秘密更直接。

[JS SDK 源码](https://github.com/logos-messaging/logos-delivery-js) 与 [收发教程](https://docs.waku.org/build/javascript/light-send-receive/) 有 API 版本差异，以已安装类型和真实收发测试为准。[官方本地节点方案](https://docs.waku.org/build/javascript/local-dev-env) 使用 Docker 的 `@waku/run`；本次不引入 Docker/数据库。

新双阶段 PoW 的实际网络验证：`TEST_DAILY_POW=1 npm run test:lan`。测试现场派生阅读密钥并计算当天发言证明。
