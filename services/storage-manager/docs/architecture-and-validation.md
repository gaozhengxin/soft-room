# Soft Room Store Manager：架构与验证记录

更新日期：2026-09-16  
实现位置：Soft Room 仓库 `services/storage-manager`  
运行主机：Mac mini（Colima，Linux ARM64）

## 1. 目标与边界

这套服务为 Soft Room 提供一份自主管理的历史消息副本，同时保留 Waku 的分布式读取路径。

- App 正常发送时继续使用 Waku LightPush。
- App 读取时并行查询公共 Waku Store 与 Mac mini 副本，再合并去重。
- Mac mini 保存 Soft Room 消息副本，用于其他 Store 节点不可用或历史不完整时兜底。
- Mac mini 的查询 API 属于 App 默认补齐路径；任一来源失败不阻塞另一个来源。
- 本机删除只影响 Mac mini 保存的数据，不代表消息从其他 Waku Store 节点删除。
- Store 是尽力而为的历史服务，不承诺全网永久保存或每条消息都被每个节点收录。

```text
                           ┌─→ 随机 Waku Store A ─┐
Soft Room App ──LightPush──┼─→ 随机 Waku Store B ─┼─→ 默认历史查询
       │                   └─→ 其他 Waku 节点 ────┘
       │
       └─ HTTPS API ─────→ Mac mini Store Manager ─┬→ 本地 SQLite 消息副本
                                                   └→ 加密文件对象
```

## 2. Mac mini 部署形态

服务保持官方 Logos Delivery 节点不变，在它旁边运行独立管理进程。

| 组件 | 当前名称 | 职责 |
| --- | --- | --- |
| 官方节点 | `soft-room-logos-node` | 接受本地归档提交，使用官方 SQLite Store |
| 管理进程 | `soft-room-store-manager` | API、校验、历史读取、定期清理、健康状态 |
| 数据卷 | `soft-room-store-check-data` | 保存 `store.sqlite3` 及 WAL 文件 |
| 内网入口 | `http://storage-host.local:8788` | 当前局域网测试 API |
| 公网入口 | `https://storage.wakukusmartrecipe.uk` | Cloudflare Tunnel，仅允许配置的浏览器 Origin |

两个容器均配置 `restart: unless-stopped`。管理进程每 30 秒执行一次维护，并在启动时检查官方数据库表结构。若官方升级改变表结构，管理进程拒绝继续写删并通过健康接口报告错误，避免按未知结构执行 SQL。

当前官方 `wakuorg/nwaku:v0.38.1` 镜像只有测试到的 amd64 版本，在 ARM64 Colima 上通过兼容模式运行。功能已验证，长期性能尚未评估。

## 3. Topic 与网络路由

Soft Room 房间使用：

```text
/soft-room/1/{64位小写十六进制roomId}/json
```

`@waku/sdk` 默认网络为 cluster 1、8 个自动分片。Soft Room 的 application/version 固定为 `soft-room/1`，因此所有房间都映射到：

```text
/waku/2/rs/1/7
```

生产方向的 Waku 消息仍应通过 App 当前的随机 LightPush 节点发送到 cluster 1。Mac mini 当前没有配置 cluster 1 所需的链上 RLN RPC 和成员凭证；直接以 cluster 1 启动官方节点会停在 RLN 初始化阶段。因此当前本地副本使用隔离的 `/waku/2/rs/0/7` 归档，查询 API 按 content topic 读取，不依赖本地 pubsub topic。

这意味着当前 API 已能完成本地托底存取，但在 RLN 或独立发布器接入前，不能代替 App 现有的 Waku LightPush 发布路径。

## 4. App 行为

### 4.1 发送

App 对普通聊天消息执行两条相互独立的操作：

1. 通过现有随机 LightPush 网关发送到 Waku 网络。
2. 将相同的加密 payload 提交到 Mac mini API 保存副本。

Waku 发送成功但本机副本提交失败时，App 不应把消息显示成发送失败。Mac mini 是托底存储，不应成为 Waku 发送的单点依赖。

心跳和 Mesh 信令属于 ephemeral 消息，不提交到长期存储 API。

### 4.2 查询

App 并行查询最多约定数量的公共 Store 节点和 Mac mini API。两边返回的
加密 payload 都经过同一套房间解密、签名、PoW、时间窗口和消息类型校验，
再按解密后的 Soft Room message ID 去重并按时间排序。任一来源失败时，另一
来源仍可独立完成；Mac mini 不加入 Waku Store peer 的随机选择。

## 5. API

当前 API 版本为 `v1`。

### `GET /v1/health`

返回管理进程运行时间、SQLite 统计、官方节点健康状态、最近一次清理结果及清理错误。

```bash
curl -sS http://storage-host.local:8788/v1/health
```

### `GET /v1/config`

返回 App 可使用的公开限制：

```json
{
  "apiVersion": 1,
  "maxPayloadBytes": 16384,
  "roomQuotaBytes": 209715200,
  "maxAgeSeconds": 604800,
  "maxFileBytes": 201326592,
  "fileChunkBytes": 4194304,
  "pubsubTopic": "/waku/2/rs/1/7"
}
```

```bash
curl -sS http://storage-host.local:8788/v1/config
```

### `POST /v1/messages`

提交一条已由 Soft Room 加密的普通消息：

```json
{
  "roomId": "64位小写十六进制roomId",
  "payload": "Base64编码的加密payload"
}
```

服务端生成 content topic，客户端不能提交任意 topic。解码后的 payload 必须为 1–16384 字节。

```bash
BASE=http://storage-host.local:8788
ROOM=1111111111111111111111111111111111111111111111111111111111111111
PAYLOAD=$(printf 'encrypted-test-payload' | base64)

curl -sS -X POST "$BASE/v1/messages" \
  -H 'Content-Type: application/json' \
  --data "{\"roomId\":\"$ROOM\",\"payload\":\"$PAYLOAD\"}"
```

`202` 表示 Mac mini 上的官方节点已经接受本地归档提交，不表示远端 Waku Store 已保存。

### `GET /v1/rooms/{roomId}/messages`

读取本机兜底历史，默认返回最新 50 条，最多 100 条，结果按新到旧排列。

```bash
curl -sS "$BASE/v1/rooms/$ROOM/messages?limit=50"
```

如果返回 `nextBefore`，使用它获取更旧的一页：

```bash
curl -sS "$BASE/v1/rooms/$ROOM/messages?limit=50&before=<nextBefore>"
```

### 加密文件 API

文件内容由浏览器使用房间密钥加密；服务端只保存不透明密文。客户端先向
`POST /v1/files` 提交 room ID、完整密文 SHA-256（作为 file ID）、大小和
分片数，再按顺序或重试需要向 `PUT /v1/files/{roomId}/{fileId}/chunks/{index}`
上传固定 4 MiB 分片，最后调用 `POST /v1/files/{roomId}/{fileId}/complete`。
完成接口重新计算完整密文 SHA-256，匹配后原子发布。

`GET /v1/files/{roomId}/{fileId}` 返回密文并支持标准单区间 `Range`。当前
单对象密文上限 192 MiB；未完成上传 24 小时后删除。请求按来源 IP 限制
每分钟请求次数和上传字节数。服务端不知道原文件名、MIME 类型、房间密钥
或明文，文件索引与展示信息只存在于房间加密的 Waku 消息中。

### `POST /v1/maintenance/run`

立即执行清理。该接口需要只保存在 Mac mini 上的维护令牌：

```bash
curl -sS -X POST "$BASE/v1/maintenance/run" \
  -H "Authorization: Bearer $MAINTENANCE_TOKEN"
```

维护接口供运维使用，不供 App 调用。

## 6. 清理规则

每次维护按以下顺序执行：

1. 删除 content topic 不严格匹配 `/soft-room/1/[0-9a-f]{64}/json` 的记录。
2. 删除本机归档时间超过 7 天的记录。
3. 合并计算每个房间的消息逻辑大小和加密文件对象大小。
4. 房间超过 200MiB 时按时间保留最新消息和文件，从最旧对象开始删除。
5. 删除超过 7 天的加密文件和超过 24 小时的未完成上传。
6. 执行被动 WAL checkpoint，并限制文件卷的全局容量。

SQLite 删除后会复用页面，但数据库文件不保证立即缩小。在线维护不会运行 `VACUUM`，避免长时间阻塞官方节点。

## 7. API 验证结果

测试日期：2026-09-16。测试从另一台局域网 Mac 访问 `storage-host.local:8788`，不是在容器内部自测。

| 场景 | HTTP 状态 | 结果 |
| --- | ---: | --- |
| 健康检查 | 200 | 通过 |
| 配置查询 | 200 | 通过 |
| 连续提交三条消息 | 202 | 全部通过 |
| 历史第一页 | 200 | 返回两条及 `nextBefore` |
| 历史第二页 | 200 | 返回剩余一条 |
| 非法 room ID | 400 | 正确拒绝 |
| 非法 Base64 | 400 | 正确拒绝 |
| 空 payload | 400 | 正确拒绝 |
| 16385 字节 payload | 400 | 正确拒绝 |
| 损坏 JSON | 400 | 正确拒绝 |
| `limit=101` | 400 | 正确拒绝 |
| 不存在的路由 | 404 | 正确返回 |
| 未带令牌执行维护 | 401 | 正确拒绝 |
| 已授权执行维护 | 200 | 通过 |
| 允许的 CORS 来源 | 204 | 返回正确 CORS headers |
| 未允许的 CORS 来源 | 403 | 正确拒绝 |
| 公网 Tunnel 健康检查 | 200 | `storage.wakukusmartrecipe.uk` 通过 |
| 约 1 MiB 随机密文分片上传 | 201/200 | 通过 |
| 完成时 SHA-256 校验 | 200 | 通过 |
| 公网完整下载与 SHA-256 比较 | 200 | 逐字节摘要一致 |
| 本机普通与后缀 Range | 206 | 均返回指定 100 字节 |

维护测试另外写入了一条 `/other-app/1/maintenance/json` 记录。执行维护后：

- 非 Soft Room 记录从 1 条变为 0 条；
- 5 条 Soft Room 测试记录仍然存在；
- 接口报告 `foreign: 1`、`total: 1`；
- `cleanupError` 为 `null`。

所有测试消息和文件随后已经删除，最终统计为 0 条消息、0 个文件。

## 8. 其他 Waku Store 节点拉取验证

测试日期：2026-09-16。测试使用真实 Chrome、Soft Room 当前 `@waku/sdk`、正式 content topic 结构和官方 bootstrap 节点。

验证步骤：

1. 创建独立测试房间 content topic。
2. 生成唯一 payload `cross-store-1789538023330`。
3. 通过一个 LightPush 节点发送非 ephemeral 消息。
4. 记录实际确认发送的 peer ID。
5. 枚举支持 Store 的已连接节点。
6. 查询时明确排除发送 peer。
7. 从不同 Store peer 返回的数据中逐字节比较 payload。

实测证据：

```text
LightPush发送节点:
16Uiu2HAmRv1iQ3NoMMcjbtRmKxPuYBbF9nLYz2SDv9MTN8WhGuUU

Store返回节点:
16Uiu2HAmDCp8XJ9z1ev18zuv8NHekAsjNyezAvmMfFEJkiharitG

首次成功查询等待: 约3秒
浏览器连接数: 4
Payload逐字节相同: 是
发送节点与查询节点不同: 是
Mac mini查询API参与: 否
```

这项测试证明当前 App 所需的默认分布式路径可用：消息经一个 LightPush 节点发送后，可以从另一个 Store 节点取回。测试只证明这一次实际路径成功，不构成所有节点、所有时间和所有消息都可用的保证。

该测试 payload 无敏感内容。第三方 Store 的副本遵循对方保留策略，无法由我们主动删除。

## 9. 当前已验证与待完成

已验证：

- 官方 SQLite Store 的字段满足外部管理需要。
- 节点运行期间可以通过短事务安全删除测试记录。
- 删除后 Store 查询立即不再返回该记录。
- 容器重启后本地记录仍然存在。
- 管理 API 的正常、异常、鉴权、CORS 和分页路径。
- 不同 LightPush 与 Store 节点之间的真实网络发送和取回。
- App 已接入消息双写、公共 Store 与本机 API 并行合并。
- Cloudflare Tunnel 公网 HTTPS、允许来源 CORS、加密文件分片上传、摘要校验与完整下载。
- 文件过期、房间消息与文件共享配额、损坏摘要拒绝及过期未完成上传清理。

待完成：

- 决定 cluster 1 发布采用 RLN 节点凭证还是独立轻客户端发布器。
- 观察 ARM64 Mac mini 上 amd64 官方镜像的长期资源占用。
- 在接近 200MiB 的真实数据库上进行配额清理压力测试。
- 在实体 iOS/Android 上分别验证长视频转码、前后台切换和大文件内存峰值。
