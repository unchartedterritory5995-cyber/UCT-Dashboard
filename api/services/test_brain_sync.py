import io
import json
import os
import sqlite3
import tarfile
import time

import pytest

from api.services import brain_sync


def _make_pack_bytes(ts, kb_rows=2, member_prefix=""):
    buf = io.BytesIO()
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        db_path = os.path.join(td, "db")
        conn = sqlite3.connect(db_path)
        conn.execute("CREATE TABLE knowledge_base (id INTEGER PRIMARY KEY)")
        conn.executemany("INSERT INTO knowledge_base VALUES (?)", [(i,) for i in range(kb_rows)])
        conn.commit()
        conn.close()
        with tarfile.open(fileobj=buf, mode="w:gz") as tf:
            code = b"VERSION = 2\n"
            info = tarfile.TarInfo(member_prefix + "uct_intelligence/__init__.py")
            info.size = len(code)
            tf.addfile(info, io.BytesIO(code))
            tf.add(db_path, arcname=member_prefix + "data/uct_intelligence.db")
            blob = json.dumps({"ts": ts, "kb_rows": kb_rows}).encode()
            info = tarfile.TarInfo(member_prefix + "PACK_MANIFEST.json")
            info.size = len(blob)
            tf.addfile(info, io.BytesIO(blob))
    return buf.getvalue()


class _FakeS3:
    def __init__(self, objects):
        self.objects = objects
    def get_object(self, Bucket, Key):
        if Key not in self.objects:
            raise KeyError(Key)
        return {"Body": io.BytesIO(self.objects[Key])}


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.delenv("BRAIN_DIR", raising=False)
    monkeypatch.setenv("DATA_SYNC_BUCKET", "b")
    return tmp_path


def test_sync_installs_new_pack(data_dir):
    ts = int(time.time())
    s3 = _FakeS3({"brain/latest.txt": str(ts).encode(),
                  f"brain/{ts}.tar.gz": _make_pack_bytes(ts)})
    assert brain_sync.sync_brain_pack(s3=s3) is True
    bd = brain_sync.brain_dir()
    assert os.path.isfile(os.path.join(bd, "uct_intelligence", "__init__.py"))
    assert os.path.isfile(os.path.join(bd, "data", "uct_intelligence.db"))
    assert brain_sync.installed_ts() == ts


def test_sync_skips_when_current(data_dir):
    ts = int(time.time())
    s3 = _FakeS3({"brain/latest.txt": str(ts).encode(),
                  f"brain/{ts}.tar.gz": _make_pack_bytes(ts)})
    assert brain_sync.sync_brain_pack(s3=s3) is True
    assert brain_sync.sync_brain_pack(s3=s3) is False  # same ts -> skip


def test_sync_rejects_path_traversal(data_dir):
    ts = int(time.time())
    evil = _make_pack_bytes(ts, member_prefix="../")
    s3 = _FakeS3({"brain/latest.txt": str(ts).encode(),
                  f"brain/{ts}.tar.gz": evil})
    assert brain_sync.sync_brain_pack(s3=s3) is False
    assert brain_sync.installed_ts() == 0


def test_sync_fires_on_install_callbacks(data_dir):
    ts = int(time.time())
    s3 = _FakeS3({"brain/latest.txt": str(ts).encode(),
                  f"brain/{ts}.tar.gz": _make_pack_bytes(ts)})
    seen = []
    brain_sync.on_install(lambda: seen.append(1))
    try:
        brain_sync.sync_brain_pack(s3=s3)
    finally:
        brain_sync._INSTALL_CALLBACKS.clear()
    assert seen == [1]
