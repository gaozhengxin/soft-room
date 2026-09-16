import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    host: str = os.getenv("HOST", "0.0.0.0")
    port: int = int(os.getenv("PORT", "8788"))
    store_db: str = os.getenv("STORE_DB", "/data/store.sqlite3")
    file_root: str = os.getenv("FILE_ROOT", "/files")
    node_url: str = os.getenv("NODE_URL", "http://logos-node:8645")
    max_payload_bytes: int = int(os.getenv("MAX_PAYLOAD_BYTES", "16384"))
    max_file_bytes: int = int(os.getenv("MAX_FILE_BYTES", str(192 * 1024 * 1024)))
    file_chunk_bytes: int = int(os.getenv("FILE_CHUNK_BYTES", str(4 * 1024 * 1024)))
    max_total_file_bytes: int = int(os.getenv("MAX_TOTAL_FILE_BYTES", str(10 * 1024 * 1024 * 1024)))
    upload_bytes_per_minute: int = int(os.getenv("UPLOAD_BYTES_PER_MINUTE", str(64 * 1024 * 1024)))
    room_quota_bytes: int = int(os.getenv("ROOM_QUOTA_BYTES", str(200 * 1024 * 1024)))
    max_age_seconds: int = int(os.getenv("MAX_AGE_SECONDS", str(7 * 24 * 60 * 60)))
    cleanup_interval_seconds: int = int(os.getenv("CLEANUP_INTERVAL_SECONDS", "30"))
    request_limit_per_minute: int = int(os.getenv("REQUEST_LIMIT_PER_MINUTE", "120"))
    allowed_origins: tuple[str, ...] = tuple(
        item.strip() for item in os.getenv("ALLOWED_ORIGINS", "").split(",") if item.strip()
    )
    maintenance_token: str = os.getenv("MAINTENANCE_TOKEN", "")
    node_pubsub_topic: str = os.getenv("NODE_PUBSUB_TOPIC", "/waku/2/rs/0/7")
    pubsub_topic: str = "/waku/2/rs/1/7"


CONFIG = Config()
