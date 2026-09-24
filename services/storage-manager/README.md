# Soft Room Store Manager

完整架构、App 数据流和实测记录见
[docs/architecture-and-validation.md](docs/architecture-and-validation.md)。

Private deployment for the Soft Room fallback store. It runs beside an unmodified
Logos Delivery (`nwaku`) node, exposes an HTTP API for encrypted history and
opaque encrypted files, and prunes both stores.

## API

The origin listens at `http://<mac-mini-ip>:8788`. The deployed browser endpoint
is `https://storage.wakukusmartrecipe.uk` through Cloudflare Tunnel; port 8788 is
not exposed directly to the public Internet.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/health` | Manager, database, and Logos node health |
| `GET` | `/v1/config` | Public limits and Waku routing information |
| `POST` | `/v1/messages` | Submit one encrypted Soft Room payload |
| `GET` | `/v1/rooms/{roomId}/messages` | Read this node's fallback history |
| `POST` | `/v1/files` | Begin or resume one encrypted object upload |
| `PUT` | `/v1/files/{roomId}/{fileId}/chunks/{index}` | Upload one fixed-size ciphertext chunk |
| `POST` | `/v1/files/{roomId}/{fileId}/complete` | Verify SHA-256 and atomically publish the object |
| `GET` | `/v1/files/{roomId}/{fileId}` | Download ciphertext, with byte-range support |
| `POST` | `/v1/maintenance/run` | Trigger cleanup immediately (LAN operations endpoint) |

`POST /v1/messages` body:

```json
{
  "roomId": "64 lowercase hex characters",
  "payload": "base64 encoded encrypted Soft Room payload"
}
```

The service derives `/soft-room/1/{roomId}/json` and the fixed pubsub topic
`/waku/2/rs/1/7`. It rejects malformed room IDs, invalid Base64, empty payloads,
and decoded payloads over 16 KiB. A `202` means the local Logos REST endpoint
accepted the publication. It does not promise that a remote peer stored it.

The present Mac mini deployment uses `NODE_PUBSUB_TOPIC=/waku/2/rs/0/7` for its
isolated local archive because a cluster 1 relay requires RLN configuration. The
public routing value remains `/waku/2/rs/1/7`; network propagation must be added
before the app treats this API as its only Waku publisher.

History query parameters:

- `limit`: 1-100, default 50.
- `before`: exclusive Waku timestamp in nanoseconds, for backwards pagination.

Results are newest first. `nextBefore` is present when another page may exist.

`fileId` is the lowercase SHA-256 of the complete encrypted object. The default
chunk size is 4 MiB and the default encrypted-object limit is 192 MiB. The
manager verifies every chunk length and the final digest before an atomic rename.
It never receives the room key, plaintext, original filename, or media type.
Incomplete uploads older than 24 hours are removed. Upload requests are limited
per source IP by both request count and bytes per minute.

The maintenance endpoint is intentionally bound by the same LAN listener. Set
`MAINTENANCE_TOKEN` and send it as `Authorization: Bearer ...` in deployment.

## Retention

Every cleanup pass:

1. removes rows whose content topic is not exactly a Soft Room room topic;
2. removes rows received more than 7 days ago using the Waku archive timestamp;
3. keeps the newest messages and encrypted files in each room within one shared
   200 MiB logical quota;
4. enforces the configured global encrypted-file capacity.

SQLite pages are reused after deletion. The manager performs a passive WAL
checkpoint but does not run online `VACUUM`, so the database file need not shrink
immediately. The official node also has a global 7-day retention policy.

## LAN smoke tests

```bash
BASE=http://storage-host.local:8788
ROOM=0000000000000000000000000000000000000000000000000000000000000000

curl -sS "$BASE/v1/health"
curl -sS "$BASE/v1/config"

PAYLOAD=$(printf 'soft-room-api-check' | base64)
curl -sS -X POST "$BASE/v1/messages" \
  -H 'Content-Type: application/json' \
  --data "{\"roomId\":\"$ROOM\",\"payload\":\"$PAYLOAD\"}"

curl -sS "$BASE/v1/rooms/$ROOM/messages?limit=10"

curl -sS -X POST "$BASE/v1/maintenance/run" \
  -H "Authorization: Bearer $MAINTENANCE_TOKEN"
```

Browser CORS is disabled unless `ALLOWED_ORIGINS` is set to a comma-separated
allowlist. The current deployment allows the production Pages domains and
Capacitor origins. Do not use `*` for the deployed web app.

## Local verification

```bash
python3 -m unittest discover -s tests -v
python3 -m py_compile manager/*.py
```

Deployment uses [deploy/docker-compose.yml](deploy/docker-compose.yml). Secrets
belong only in the Mac mini `.env`; `.env` is ignored by Git.
