import base64
import binascii
import hashlib
import ipaddress
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .config import CONFIG, Config
from .files import FileStore
from .store import Store


ROOM_ID = re.compile(r"^[0-9a-f]{64}$")


class Service:
    def __init__(self, config: Config):
        self.config = config
        self.store = Store(config.store_db, config.max_age_seconds, config.room_quota_bytes)
        self.files = FileStore(config.file_root, config.max_file_bytes, config.file_chunk_bytes, config.max_age_seconds,
                               config.room_quota_bytes, config.max_total_file_bytes)
        self.started = time.time()
        self.last_cleanup: dict | None = None
        self.last_cleanup_error: str | None = None
        self._stop = threading.Event()
        self._rates: dict[str, deque[float]] = defaultdict(deque)
        self._rate_lock = threading.Lock()
        self._upload_rates: dict[str, deque[tuple[float, int]]] = defaultdict(deque)

    def rate_allowed(self, key: str) -> bool:
        now = time.monotonic()
        with self._rate_lock:
            q = self._rates[key]
            while q and q[0] < now - 60:
                q.popleft()
            if len(q) >= self.config.request_limit_per_minute:
                return False
            q.append(now)
            return True

    def upload_allowed(self, key: str, size: int) -> bool:
        now = time.monotonic()
        with self._rate_lock:
            q = self._upload_rates[key]
            while q and q[0][0] < now - 60: q.popleft()
            if sum(item[1] for item in q) + size > self.config.upload_bytes_per_minute: return False
            q.append((now, size)); return True

    def node_json(self, path: str, timeout: float = 4) -> dict:
        with urllib.request.urlopen(self.config.node_url + path, timeout=timeout) as response:
            return json.loads(response.read())

    def submit(self, room_id: str, payload_b64: str) -> dict:
        try:
            payload = base64.b64decode(payload_b64, validate=True)
        except (binascii.Error, ValueError):
            raise ValueError("payload must be valid base64")
        if not payload or len(payload) > self.config.max_payload_bytes:
            raise ValueError(f"decoded payload must be 1-{self.config.max_payload_bytes} bytes")
        content_topic = f"/soft-room/1/{room_id}/json"
        body = json.dumps({"payload": payload_b64, "contentTopic": content_topic, "ephemeral": False}).encode()
        path = "/relay/v1/messages/" + urllib.parse.quote(self.config.node_pubsub_topic, safe="")
        req = urllib.request.Request(self.config.node_url + path, data=body, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                response.read()
                if response.status != 200:
                    raise RuntimeError(f"Logos node returned {response.status}")
        except urllib.error.HTTPError as error:
            raise RuntimeError(f"Logos node returned {error.code}") from error
        return {"accepted": True, "contentTopic": content_topic, "pubsubTopic": self.config.node_pubsub_topic,
                "payloadSha256": hashlib.sha256(payload).hexdigest()}

    def cleanup(self) -> dict:
        now = time.time_ns()
        result = self.store.prune_base(now)
        file_expired = self.files.prune_expired(now)
        by_room: dict[str, list[tuple[int, int, str, object]]] = defaultdict(list)
        for room_id, message_hash, timestamp, size in self.store.entries():
            by_room[room_id].append((timestamp, size, "message", message_hash))
        for entry in self.files.entries():
            by_room[entry.room_id].append((entry.created_ns, entry.size, "file", entry))
        message_remove, file_remove = [], []
        for items in by_room.values():
            used = 0
            for _, size, kind, key in sorted(items, key=lambda item: item[0], reverse=True):
                used += size
                if used > self.config.room_quota_bytes:
                    (message_remove if kind == "message" else file_remove).append(key)
        message_quota = self.store.delete_entries(message_remove) if message_remove else 0
        file_quota = self.files.delete(file_remove) if file_remove else 0
        deleted = {"foreign": result.foreign, "expired": result.expired, "messageOverQuota": message_quota,
                   "fileExpired": file_expired, "fileOverQuota": file_quota}
        deleted["total"] = sum(deleted.values())
        value = {"at": int(time.time()), "deleted": deleted}
        self.last_cleanup, self.last_cleanup_error = value, None
        return value

    def cleanup_loop(self):
        while not self._stop.wait(self.config.cleanup_interval_seconds):
            try:
                self.cleanup()
            except Exception as error:
                self.last_cleanup_error = str(error)


def handler(service: Service):
    class Handler(BaseHTTPRequestHandler):
        server_version = "soft-room-store-manager/1"

        def source_ip(self):
            address = self.client_address[0]
            if address in ("127.0.0.1", "::1"):
                forwarded = self.headers.get("CF-Connecting-IP", "")
                try:
                    return str(ipaddress.ip_address(forwarded))
                except ValueError:
                    pass
            return address

        def log_message(self, fmt, *args):
            print(json.dumps({"remote": self.source_ip(), "message": fmt % args}))

        def cors(self):
            origin = self.headers.get("Origin")
            return origin if origin and origin in service.config.allowed_origins else None

        def respond(self, status: int, value: dict):
            data = json.dumps(value, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            origin = self.cors()
            if origin:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.end_headers()
            self.wfile.write(data)

        def send_file(self, path, size: int):
            start, end, status = 0, size - 1, 200
            value = self.headers.get("Range")
            if value:
                match = re.fullmatch(r"bytes=(\d*)-(\d*)", value)
                if not match or not any(match.groups()): return self.respond(416, {"error": "invalid range"})
                try:
                    if not match.group(1):
                        length = int(match.group(2)); start, end = max(0, size-length), size-1
                    else:
                        start = int(match.group(1))
                        if match.group(2): end = int(match.group(2))
                    if start < 0 or end < start or end >= size: raise ValueError()
                except ValueError: return self.respond(416, {"error": "invalid range"})
                status = 206
            length = end - start + 1
            self.send_response(status)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(length)); self.send_header("Accept-Ranges", "bytes")
            self.send_header("Cache-Control", "private, max-age=604800, immutable")
            if status == 206: self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            origin = self.cors()
            if origin:
                self.send_header("Access-Control-Allow-Origin", origin); self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Expose-Headers", "Content-Length,Content-Range,Accept-Ranges")
            self.end_headers()
            with path.open("rb") as source:
                source.seek(start); remaining = length
                while remaining:
                    data = source.read(min(65536, remaining))
                    if not data: break
                    self.wfile.write(data); remaining -= len(data)

        def do_OPTIONS(self):
            origin = self.cors()
            if not origin:
                return self.respond(403, {"error": "origin not allowed"})
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type,Authorization,Range")
            self.send_header("Access-Control-Max-Age", "600")
            self.end_headers()

        def do_GET(self):
            if not service.rate_allowed(self.source_ip()):
                return self.respond(429, {"error": "rate limit exceeded"})
            path = urllib.parse.urlsplit(self.path)
            if path.path == "/v1/config":
                return self.respond(200, {"apiVersion": 1, "maxPayloadBytes": service.config.max_payload_bytes,
                    "roomQuotaBytes": service.config.room_quota_bytes, "maxAgeSeconds": service.config.max_age_seconds,
                    "maxFileBytes": service.config.max_file_bytes, "fileChunkBytes": service.config.file_chunk_bytes,
                    "pubsubTopic": service.config.pubsub_topic, "archivePubsubTopic": service.config.node_pubsub_topic})
            if path.path == "/v1/health":
                db, node, status = None, None, 200
                try: db = {**service.store.stats(), **service.files.stats()}
                except Exception as error: db, status = {"error": str(error)}, 503
                try: node = service.node_json("/health")
                except Exception as error: node, status = {"error": str(error)}, 503
                return self.respond(status, {"status": "ok" if status == 200 else "degraded", "uptimeSeconds": int(time.time()-service.started),
                    "database": db, "node": node, "lastCleanup": service.last_cleanup, "cleanupError": service.last_cleanup_error})
            match = re.fullmatch(r"/v1/rooms/([0-9a-f]{64})/messages", path.path)
            if match:
                args = urllib.parse.parse_qs(path.query)
                try:
                    limit = int(args.get("limit", ["50"])[0]); before_raw = args.get("before", [None])[0]
                    before = int(before_raw) if before_raw is not None else None
                    if not 1 <= limit <= 100 or (before is not None and before <= 0): raise ValueError()
                except ValueError: return self.respond(400, {"error": "invalid pagination"})
                try: rows, more = service.store.history(match.group(1), limit, before)
                except Exception as error: return self.respond(503, {"error": str(error)})
                messages = [{"payload": base64.b64encode(row[0]).decode(), "timestamp": row[1],
                    "messageHash": "0x" + bytes(row[2]).hex()} for row in rows]
                return self.respond(200, {"messages": messages, **({"nextBefore": rows[-1][1]} if more and rows else {})})
            match = re.fullmatch(r"/v1/files/([0-9a-f]{64})/([0-9a-f]{64})", path.path)
            if match:
                try: file_path, size = service.files.locate(match.group(1), match.group(2))
                except FileNotFoundError: return self.respond(404, {"error": "file not found"})
                return self.send_file(file_path, size)
            self.respond(404, {"error": "not found"})

        def do_POST(self):
            if not service.rate_allowed(self.source_ip()):
                return self.respond(429, {"error": "rate limit exceeded"})
            if self.path == "/v1/maintenance/run":
                token = service.config.maintenance_token
                if not token or self.headers.get("Authorization") != f"Bearer {token}":
                    return self.respond(401, {"error": "unauthorized"})
                try: return self.respond(200, service.cleanup())
                except Exception as error: return self.respond(503, {"error": str(error)})
            path = urllib.parse.urlsplit(self.path).path
            complete = re.fullmatch(r"/v1/files/([0-9a-f]{64})/([0-9a-f]{64})/complete", path)
            if complete:
                try: return self.respond(200, service.files.complete(complete.group(1), complete.group(2)))
                except FileNotFoundError as error: return self.respond(404, {"error": str(error)})
                except ValueError as error: return self.respond(400, {"error": str(error)})
                except Exception as error: return self.respond(503, {"error": str(error)})
            if path not in ("/v1/messages", "/v1/files"): return self.respond(404, {"error": "not found"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > 30000: raise ValueError("invalid body size")
                value = json.loads(self.rfile.read(length))
                if path == "/v1/files":
                    room_id, file_id, size, chunks = value.get("roomId"), value.get("fileId"), value.get("size"), value.get("chunks")
                    if not isinstance(room_id, str) or not ROOM_ID.fullmatch(room_id): raise ValueError("invalid roomId")
                    if not isinstance(file_id, str) or not ROOM_ID.fullmatch(file_id): raise ValueError("invalid fileId")
                    if not isinstance(size, int) or not isinstance(chunks, int): raise ValueError("invalid file manifest")
                    return self.respond(201, service.files.begin(room_id, file_id, size, chunks))
                room_id, payload = value.get("roomId"), value.get("payload")
                if not isinstance(room_id, str) or not ROOM_ID.fullmatch(room_id): raise ValueError("invalid roomId")
                if not isinstance(payload, str): raise ValueError("payload must be base64")
                return self.respond(202, service.submit(room_id, payload))
            except (ValueError, json.JSONDecodeError) as error: return self.respond(400, {"error": str(error)})
            except Exception as error: return self.respond(502, {"error": str(error)})

        def do_PUT(self):
            source = self.source_ip()
            if not service.rate_allowed(source):
                return self.respond(429, {"error": "rate limit exceeded"})
            path = urllib.parse.urlsplit(self.path).path
            match = re.fullmatch(r"/v1/files/([0-9a-f]{64})/([0-9a-f]{64})/chunks/(\d+)", path)
            if not match: return self.respond(404, {"error": "not found"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > service.config.file_chunk_bytes: raise ValueError("invalid chunk size")
                if not service.upload_allowed(source, length): return self.respond(429, {"error": "upload byte limit exceeded"})
                written = service.files.write_chunk(match.group(1), match.group(2), int(match.group(3)), length, self.rfile)
                return self.respond(200, {"accepted": True, "size": written})
            except FileNotFoundError as error: return self.respond(404, {"error": str(error)})
            except ValueError as error: return self.respond(400, {"error": str(error)})
            except Exception as error: return self.respond(503, {"error": str(error)})
    return Handler


def main():
    service = Service(CONFIG)
    service.store.validate()
    service.cleanup()
    threading.Thread(target=service.cleanup_loop, daemon=True).start()
    ThreadingHTTPServer((CONFIG.host, CONFIG.port), handler(service)).serve_forever()


if __name__ == "__main__":
    main()
