import re
import sqlite3
import threading
import time
from dataclasses import dataclass


ROOM_TOPIC = re.compile(rb"^/soft-room/1/[0-9a-f]{64}/json$")
EXPECTED_COLUMNS = {
    "pubsubTopic", "contentTopic", "payload", "version", "id",
    "messageHash", "timestamp", "meta",
}


@dataclass
class CleanupResult:
    foreign: int = 0
    expired: int = 0
    over_quota: int = 0

    @property
    def total(self) -> int:
        return self.foreign + self.expired + self.over_quota


class Store:
    def __init__(self, path: str, max_age_seconds: int, room_quota_bytes: int):
        self.path = path
        self.max_age_seconds = max_age_seconds
        self.room_quota_bytes = room_quota_bytes
        self._write_lock = threading.Lock()

    def connect(self, read_only: bool = False) -> sqlite3.Connection:
        target = f"file:{self.path}?mode=ro" if read_only else self.path
        conn = sqlite3.connect(target, uri=read_only, timeout=5)
        conn.execute("PRAGMA busy_timeout=5000")
        conn.row_factory = sqlite3.Row
        return conn

    def validate(self) -> None:
        with self.connect(True) as conn:
            cols = {row[1] for row in conn.execute("PRAGMA table_info(message)")}
        if cols != EXPECTED_COLUMNS:
            raise RuntimeError(f"unsupported message schema: {sorted(cols)}")

    @staticmethod
    def topic(room_id: str) -> bytes:
        return f"/soft-room/1/{room_id}/json".encode()

    def history(self, room_id: str, limit: int, before: int | None):
        sql = """SELECT payload,timestamp,messageHash FROM message
                 WHERE contentTopic=?"""
        params: list[object] = [self.topic(room_id)]
        if before is not None:
            sql += " AND timestamp < ?"
            params.append(before)
        sql += " ORDER BY timestamp DESC, messageHash DESC LIMIT ?"
        params.append(limit + 1)
        with self.connect(True) as conn:
            rows = conn.execute(sql, params).fetchall()
        return rows[:limit], len(rows) > limit

    def stats(self) -> dict:
        self.validate()
        with self.connect(True) as conn:
            row = conn.execute(
                "SELECT count(*),coalesce(sum(length(payload)),0),count(DISTINCT contentTopic) FROM message"
            ).fetchone()
        return {"messages": row[0], "payloadBytes": row[1], "topics": row[2]}

    def entries(self) -> list[tuple[str, bytes, int, int]]:
        result = []
        with self.connect(True) as conn:
            for row in conn.execute("SELECT contentTopic,messageHash,timestamp,coalesce(length(payload),0)+coalesce(length(meta),0) FROM message"):
                topic = bytes(row[0]).decode("ascii", "ignore")
                match = re.fullmatch(r"/soft-room/1/([0-9a-f]{64})/json", topic)
                if match: result.append((match.group(1), bytes(row[1]), int(row[2]), int(row[3])))
        return result

    def delete_entries(self, hashes: list[bytes]) -> int:
        with self._write_lock, self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            deleted = self._delete_hashes(conn, hashes)
            conn.commit(); conn.execute("PRAGMA wal_checkpoint(PASSIVE)")
            return deleted

    def prune_base(self, now_ns: int | None = None) -> CleanupResult:
        self.validate()
        cutoff = (now_ns if now_ns is not None else time.time_ns()) - self.max_age_seconds * 1_000_000_000
        result = CleanupResult()
        with self._write_lock, self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            foreign = [row[0] for row in conn.execute("SELECT messageHash,contentTopic FROM message") if not ROOM_TOPIC.fullmatch(bytes(row[1]))]
            result.foreign = self._delete_hashes(conn, foreign)
            result.expired = conn.execute("DELETE FROM message WHERE timestamp < ?", (cutoff,)).rowcount
            conn.commit(); conn.execute("PRAGMA wal_checkpoint(PASSIVE)")
        return result

    def cleanup(self, now_ns: int | None = None) -> CleanupResult:
        result = self.prune_base(now_ns)
        with self._write_lock, self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            topics = [row[0] for row in conn.execute("SELECT DISTINCT contentTopic FROM message")]
            for topic in topics:
                used = 0
                remove: list[bytes] = []
                for row in conn.execute(
                    "SELECT messageHash,coalesce(length(payload),0)+coalesce(length(meta),0) AS bytes "
                    "FROM message WHERE contentTopic=? ORDER BY timestamp DESC,messageHash DESC", (topic,)
                ):
                    used += row[1]
                    if used > self.room_quota_bytes:
                        remove.append(row[0])
                result.over_quota += self._delete_hashes(conn, remove)
            conn.commit()
            conn.execute("PRAGMA wal_checkpoint(PASSIVE)")
        return result

    @staticmethod
    def _delete_hashes(conn: sqlite3.Connection, hashes: list[bytes]) -> int:
        deleted = 0
        for start in range(0, len(hashes), 200):
            batch = hashes[start:start + 200]
            if not batch:
                continue
            marks = ",".join("?" for _ in batch)
            deleted += conn.execute(f"DELETE FROM message WHERE messageHash IN ({marks})", batch).rowcount
        return deleted
