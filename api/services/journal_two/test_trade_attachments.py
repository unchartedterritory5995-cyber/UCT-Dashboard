"""Trade screenshots side table + service — validation, storage, traversal guard.

Async tests run under the repo's pytest.ini `asyncio_mode = auto`.
"""
import importlib
import io

import pytest


@pytest.fixture()
def env(tmp_path, monkeypatch):
    """Point the attachment root + auth DB at tmp, reload the modules that read
    them at import time, and init the schema."""
    monkeypatch.setenv("J2_ATTACHMENT_ROOT", str(tmp_path / "att"))
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    from api.services import auth_db
    importlib.reload(auth_db)
    # calendar defines _ATTACHMENT_ROOT at import — reload so it reads our env
    from api.services.journal_two import calendar as cal
    importlib.reload(cal)
    from api.services.journal_two import trade_attachments as ta
    importlib.reload(ta)
    from api.services.journal_two import db as j2db
    importlib.reload(j2db)
    conn = auth_db.get_connection()
    j2db.ensure_schema(conn)
    conn.commit()
    conn.close()
    return ta


class _FakeUpload:
    def __init__(self, data: bytes, filename: str, content_type: str):
        self._buf = io.BytesIO(data)
        self.filename = filename
        self.content_type = content_type

    async def read(self) -> bytes:
        return self._buf.read()


_PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


async def test_save_list_url_roundtrip(env):
    ta = env
    out = await ta.save_trade_attachment("u1", "id:t1", _FakeUpload(_PNG, "chart.png", "image/png"))
    assert out["url"] == f"/api/j2/trades/attachments/u1/id_t1/{out['id']}.png"
    assert out["label"] == "chart.png"
    listed = ta.list_trade_attachments("u1", "id:t1")
    assert len(listed) == 1 and listed[0]["id"] == out["id"]
    assert listed[0]["url"] == out["url"]


async def test_broker_ref_dir_sanitized(env):
    ta = env
    out = await ta.save_trade_attachment("u1", "ext:bk:abc", _FakeUpload(_PNG, "x.png", "image/png"))
    # ':' → '_' so the path is Windows-safe and can't inject a directory
    assert "/ext_bk_abc/" in out["url"]


async def test_reject_oversize(env):
    ta = env
    big = _PNG + b"0" * (5 * 1024 * 1024 + 1)
    with pytest.raises(ta.TradeAttachmentError):
        await ta.save_trade_attachment("u1", "id:t1", _FakeUpload(big, "big.png", "image/png"))


async def test_reject_wrong_mime(env):
    ta = env
    with pytest.raises(ta.TradeAttachmentError):
        await ta.save_trade_attachment("u1", "id:t1", _FakeUpload(b"hello", "note.txt", "text/plain"))


async def test_delete_removes_row_and_file(env):
    ta = env
    out = await ta.save_trade_attachment("u1", "id:t1", _FakeUpload(_PNG, "x.png", "image/png"))
    from api.services.journal_two.calendar import _ATTACHMENT_ROOT
    disk = _ATTACHMENT_ROOT / "u1" / "trades" / "id_t1" / f"{out['id']}.png"
    assert disk.exists()
    assert ta.delete_trade_attachment("u1", out["id"]) is True
    assert ta.list_trade_attachments("u1", "id:t1") == []
    assert not disk.exists()
    # idempotent: deleting again is a no-op returning False
    assert ta.delete_trade_attachment("u1", out["id"]) is False


async def test_delete_scoped_to_owner(env):
    ta = env
    out = await ta.save_trade_attachment("u1", "id:t1", _FakeUpload(_PNG, "x.png", "image/png"))
    assert ta.delete_trade_attachment("u2", out["id"]) is False
    assert len(ta.list_trade_attachments("u1", "id:t1")) == 1


async def test_serve_path_rejects_traversal(env):
    ta = env
    out = await ta.save_trade_attachment("u1", "id:t1", _FakeUpload(_PNG, "x.png", "image/png"))
    fname = f"{out['id']}.png"
    assert ta.serve_trade_attachment_path("u1", "id_t1", fname) is not None
    assert ta.serve_trade_attachment_path("u1", "id_t1", "../secret.png") is None
    assert ta.serve_trade_attachment_path("u1", "../../etc", fname) is None
    assert ta.serve_trade_attachment_path("u1", "id_t1", "nope.png") is None
