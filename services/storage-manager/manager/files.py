import hashlib
import json
import os
import re
import shutil
import threading
import time
from dataclasses import dataclass
from pathlib import Path


HEX64 = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True)
class FileEntry:
    room_id: str
    file_id: str
    size: int
    created_ns: int


class FileStore:
    def __init__(self, root: str, max_file_bytes: int, chunk_bytes: int, max_age_seconds: int,
                 room_quota_bytes: int, max_total_bytes: int):
        self.root = Path(root)
        self.uploads = self.root / ".uploads"
        self.max_file_bytes = max_file_bytes
        self.chunk_bytes = chunk_bytes
        self.max_age_seconds = max_age_seconds
        self.room_quota_bytes = room_quota_bytes
        self.max_total_bytes = max_total_bytes
        self._lock = threading.RLock()
        self.root.mkdir(parents=True, exist_ok=True)
        self.uploads.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _valid(value: str) -> str:
        if not HEX64.fullmatch(value):
            raise ValueError("invalid identifier")
        return value

    def _room(self, room_id: str) -> Path:
        return self.root / self._valid(room_id)

    def _blob(self, room_id: str, file_id: str) -> Path:
        return self._room(room_id) / (self._valid(file_id) + ".blob")

    def _meta(self, room_id: str, file_id: str) -> Path:
        return self._room(room_id) / (self._valid(file_id) + ".json")

    def _upload(self, room_id: str, file_id: str) -> Path:
        return self.uploads / self._valid(room_id) / self._valid(file_id)

    @staticmethod
    def _write_json(path: Path, value: dict):
        temp = path.with_suffix(path.suffix + ".tmp")
        temp.write_text(json.dumps(value, separators=(",", ":")), encoding="utf-8")
        os.replace(temp, path)

    def begin(self, room_id: str, file_id: str, size: int, chunks: int) -> dict:
        self._valid(room_id); self._valid(file_id)
        expected = (size + self.chunk_bytes - 1) // self.chunk_bytes
        if size <= 0 or size > self.max_file_bytes or chunks != expected:
            raise ValueError("invalid encrypted file size or chunk count")
        with self._lock:
            blob = self._blob(room_id, file_id)
            if blob.exists():
                return {"fileId": file_id, "complete": True}
            complete = self.entries()
            active = []
            for manifest in self.uploads.glob("*/*/manifest.json"):
                try: active.append(json.loads(manifest.read_text(encoding="utf-8")))
                except (OSError, ValueError, json.JSONDecodeError): pass
            room_used = sum(item.size for item in complete if item.room_id == room_id) + sum(int(item.get("size", 0)) for item in active if item.get("roomId") == room_id and item.get("fileId") != file_id)
            total_used = sum(item.size for item in complete) + sum(int(item.get("size", 0)) for item in active if (item.get("roomId"), item.get("fileId")) != (room_id, file_id))
            if room_used + size > self.room_quota_bytes: raise ValueError("room file quota exceeded")
            if total_used + size > self.max_total_bytes: raise ValueError("file storage is full")
            target = self._upload(room_id, file_id)
            target.mkdir(parents=True, exist_ok=True)
            self._write_json(target / "manifest.json", {
                "roomId": room_id, "fileId": file_id, "size": size,
                "chunks": chunks, "createdNs": time.time_ns(),
            })
        return {"fileId": file_id, "complete": False, "chunkBytes": self.chunk_bytes}

    def _manifest(self, room_id: str, file_id: str) -> tuple[Path, dict]:
        target = self._upload(room_id, file_id)
        try:
            value = json.loads((target / "manifest.json").read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError) as error:
            raise FileNotFoundError("upload not found") from error
        if value.get("roomId") != room_id or value.get("fileId") != file_id:
            raise ValueError("invalid upload manifest")
        return target, value

    def write_chunk(self, room_id: str, file_id: str, index: int, length: int, body) -> int:
        with self._lock:
            target, manifest = self._manifest(room_id, file_id)
            chunks = int(manifest["chunks"])
            if index < 0 or index >= chunks:
                raise ValueError("invalid chunk index")
            remaining = int(manifest["size"]) - index * self.chunk_bytes
            expected = min(self.chunk_bytes, remaining)
            if length != expected: raise ValueError("invalid chunk size")
            temp = target / f"{index}.part.tmp"
            digest = hashlib.sha256(); written = 0
            with temp.open("wb") as output:
                while written < expected:
                    data = body.read(min(65536, expected - written))
                    if not data:
                        break
                    output.write(data); digest.update(data); written += len(data)
            if written != expected:
                temp.unlink(missing_ok=True)
                raise ValueError("invalid chunk size")
            os.replace(temp, target / f"{index}.part")
            self._write_json(target / f"{index}.json", {"size": written, "sha256": digest.hexdigest()})
            return written

    def complete(self, room_id: str, file_id: str) -> dict:
        with self._lock:
            blob = self._blob(room_id, file_id)
            if blob.exists():
                return {"fileId": file_id, "complete": True, "size": blob.stat().st_size}
            target, manifest = self._manifest(room_id, file_id)
            room = self._room(room_id); room.mkdir(parents=True, exist_ok=True)
            temp = room / (file_id + ".blob.tmp")
            digest = hashlib.sha256(); total = 0
            try:
                with temp.open("wb") as output:
                    for index in range(int(manifest["chunks"])):
                        with (target / f"{index}.part").open("rb") as source:
                            while data := source.read(65536):
                                output.write(data); digest.update(data); total += len(data)
                if total != int(manifest["size"]) or digest.hexdigest() != file_id:
                    raise ValueError("encrypted file checksum mismatch")
                os.replace(temp, blob)
                self._write_json(self._meta(room_id, file_id), {
                    "fileId": file_id, "size": total, "createdNs": int(manifest["createdNs"])
                })
                shutil.rmtree(target)
            except Exception:
                temp.unlink(missing_ok=True)
                raise
            return {"fileId": file_id, "complete": True, "size": total}

    def locate(self, room_id: str, file_id: str) -> tuple[Path, int]:
        blob = self._blob(room_id, file_id)
        if not blob.is_file():
            raise FileNotFoundError("file not found")
        return blob, blob.stat().st_size

    def entries(self) -> list[FileEntry]:
        result: list[FileEntry] = []
        with self._lock:
            for room in self.root.iterdir():
                if not room.is_dir() or not HEX64.fullmatch(room.name):
                    continue
                for meta in room.glob("*.json"):
                    try:
                        value = json.loads(meta.read_text(encoding="utf-8")); file_id = meta.stem
                        if not HEX64.fullmatch(file_id): continue
                        blob = self._blob(room.name, file_id)
                        result.append(FileEntry(room.name, file_id, blob.stat().st_size, int(value["createdNs"])))
                    except (OSError, ValueError, KeyError, json.JSONDecodeError):
                        continue
        return result

    def delete(self, entries: list[FileEntry]) -> int:
        deleted = 0
        with self._lock:
            for entry in entries:
                blob = self._blob(entry.room_id, entry.file_id)
                if blob.exists(): blob.unlink(); deleted += 1
                self._meta(entry.room_id, entry.file_id).unlink(missing_ok=True)
                try: blob.parent.rmdir()
                except OSError: pass
        return deleted

    def prune_expired(self, now_ns: int | None = None) -> int:
        now = now_ns if now_ns is not None else time.time_ns()
        cutoff = now - self.max_age_seconds * 1_000_000_000
        expired = [entry for entry in self.entries() if entry.created_ns < cutoff]
        with self._lock:
            upload_cutoff = time.time() - 24 * 60 * 60
            for manifest in self.uploads.glob("*/*/manifest.json"):
                try:
                    if manifest.stat().st_mtime < upload_cutoff: shutil.rmtree(manifest.parent)
                except OSError: pass
        return self.delete(expired)

    def stats(self) -> dict:
        entries = self.entries()
        return {"files": len(entries), "fileBytes": sum(item.size for item in entries)}
