import os
import sqlite3
import tempfile
import time
import unittest
from io import BytesIO
from unittest.mock import MagicMock, patch

from manager.app import Service
from manager.config import Config
from manager.files import FileStore
from manager.store import Store


SCHEMA = """CREATE TABLE message (
 pubsubTopic BLOB NOT NULL, contentTopic BLOB NOT NULL, payload BLOB,
 version INTEGER NOT NULL, id BLOB, messageHash BLOB, timestamp INTEGER NOT NULL, meta BLOB,
 CONSTRAINT messageIndex PRIMARY KEY (messageHash)) WITHOUT ROWID"""


class StoreTest(unittest.TestCase):
    def setUp(self):
        handle, self.path = tempfile.mkstemp(); os.close(handle)
        with sqlite3.connect(self.path) as db: db.execute(SCHEMA)
        self.store = Store(self.path, max_age_seconds=10, room_quota_bytes=10)

    def tearDown(self): os.unlink(self.path)

    def add(self, topic: bytes, payload: bytes, timestamp: int, key: bytes):
        with sqlite3.connect(self.path) as db:
            db.execute("INSERT INTO message VALUES(?,?,?,?,?,?,?,?)", (b"p", topic, payload, 0, None, key, timestamp, None))

    def test_cleanup_foreign_expired_and_quota(self):
        now = time.time_ns(); room = Store.topic("a" * 64)
        self.add(b"/other/1/x/json", b"x", now, b"f")
        self.add(room, b"old", now - 11_000_000_000, b"o")
        self.add(room, b"123456", now - 2, b"1")
        self.add(room, b"abcdef", now - 1, b"2")
        result = self.store.cleanup(now)
        self.assertEqual((result.foreign, result.expired, result.over_quota), (1, 1, 1))
        rows, more = self.store.history("a" * 64, 10, None)
        self.assertFalse(more); self.assertEqual([row[0] for row in rows], [b"abcdef"])

    def test_schema_guard(self):
        self.store.validate()
        with sqlite3.connect(self.path) as db: db.execute("ALTER TABLE message ADD COLUMN surprise TEXT")
        with self.assertRaises(RuntimeError): self.store.validate()


class FileStoreTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.files = FileStore(self.temp.name, max_file_bytes=32, chunk_bytes=4, max_age_seconds=10,
                               room_quota_bytes=32, max_total_bytes=64)
        self.room = "a" * 64

    def tearDown(self): self.temp.cleanup()

    def upload(self, body: bytes):
        import hashlib
        file_id = hashlib.sha256(body).hexdigest(); chunks = (len(body) + 3) // 4
        self.files.begin(self.room, file_id, len(body), chunks)
        for index in range(chunks):
            part=body[index*4:(index+1)*4]
            self.files.write_chunk(self.room, file_id, index, len(part), BytesIO(part))
        result = self.files.complete(self.room, file_id)
        return file_id, result

    def test_chunked_upload_checksum_and_read(self):
        file_id, result = self.upload(b"encrypted-file")
        self.assertTrue(result["complete"])
        path, size = self.files.locate(self.room, file_id)
        self.assertEqual((path.read_bytes(), size), (b"encrypted-file", 14))
        self.assertEqual(self.files.stats(), {"files": 1, "fileBytes": 14})

    def test_rejects_bad_checksum_and_prunes_expired(self):
        file_id = "b" * 64
        self.files.begin(self.room, file_id, 4, 1)
        self.files.write_chunk(self.room, file_id, 0, 4, BytesIO(b"nope"))
        with self.assertRaises(ValueError): self.files.complete(self.room, file_id)
        good, _ = self.upload(b"good")
        meta = self.files._meta(self.room, good)
        value = __import__("json").loads(meta.read_text()); value["createdNs"] = time.time_ns() - 11_000_000_000
        meta.write_text(__import__("json").dumps(value))
        self.assertEqual(self.files.prune_expired(), 1)
        with self.assertRaises(FileNotFoundError): self.files.locate(self.room, good)


class ServiceTest(unittest.TestCase):
    def test_submit_uses_isolated_node_topic_not_public_app_topic(self):
        with tempfile.TemporaryDirectory() as temp:
            response = MagicMock(); response.status = 200; response.read.return_value = b"OK"
            response.__enter__.return_value = response
            config = Config(store_db=os.path.join(temp, "store.sqlite3"), file_root=os.path.join(temp, "files"),
                            node_pubsub_topic="/waku/2/rs/0/7", pubsub_topic="/waku/2/rs/1/7")
            with patch("manager.app.urllib.request.urlopen", return_value=response) as send:
                result = Service(config).submit("a" * 64, "dGVzdA==")
            self.assertIn("%2Fwaku%2F2%2Frs%2F0%2F7", send.call_args.args[0].full_url)
            self.assertEqual(result["pubsubTopic"], "/waku/2/rs/0/7")


if __name__ == "__main__": unittest.main()
