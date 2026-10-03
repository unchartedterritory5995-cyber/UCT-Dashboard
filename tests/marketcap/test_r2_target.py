"""publication.R2Target semantics against a fake S3 client (no network, no credentials): absent vs error are distinct,
write-once refuses an existing key, and a read error can never masquerade as "no pointer" during compare-and-set."""
from __future__ import annotations

import io

import pytest
from botocore.exceptions import ClientError

from api.services.marketcap import publication as P, release_contract as C


class FakeS3:
    def __init__(self):
        self.objs, self.fail = {}, set()

    def _err(self, code):
        return ClientError({"Error": {"Code": code, "Message": code}}, "op")

    def get_object(self, Bucket, Key):
        if Key in self.fail:
            raise self._err("InternalError")
        if Key not in self.objs:
            raise self._err("NoSuchKey")
        return {"Body": io.BytesIO(self.objs[Key])}

    def head_object(self, Bucket, Key):
        if Key in self.fail:
            raise self._err("503")
        if Key not in self.objs:
            raise self._err("404")
        return {}

    def put_object(self, Bucket, Key, Body, ContentType=None):
        self.objs[Key] = bytes(Body)

    def upload_file(self, path, bucket, key):
        self.objs[key] = open(path, "rb").read()


@pytest.fixture
def r2(monkeypatch):
    from api.services import data_sync
    fake = FakeS3()
    monkeypatch.setattr(data_sync, "_client", lambda: fake)
    monkeypatch.setattr(data_sync, "_bucket", lambda: "private-bucket")
    return P.R2Target(), fake


def test_not_configured_is_refused(monkeypatch):
    from api.services import data_sync
    monkeypatch.setattr(data_sync, "_client", lambda: None)
    with pytest.raises(P.PublishError, match="NOT CONFIGURED"):
        P.R2Target()


def test_absent_vs_error(r2):
    t, fake = r2
    assert t.get("k") is None and t.exists("k") is False
    fake.fail.add("k")
    with pytest.raises(P.PublishError):
        t.get("k")
    with pytest.raises(P.PublishError):
        t.exists("k")


def test_write_once(r2):
    t, _ = r2
    t.put_new("a", b"1")
    with pytest.raises(P.PublishError, match="write-once"):
        t.put_new("a", b"2")
    assert t.get("a") == b"1"


def test_pointer_read_error_blocks_advance(r2, tmp_path):
    from .lifecycle_fixtures import make_build, make_prices, manifest_fields, passing_validation
    t, fake = r2
    bid = "MCAP_V1-20261002T050000Z"
    db = make_build(str(tmp_path / "b.db"), bid)
    r = P.publish_build(t, build_db=db, prices_db=make_prices(str(tmp_path / "p.db")),
                        manifest_fields=manifest_fields(bid, P.file_sha(db)[0]), validation=passing_validation())
    fake.fail.add(C.AUTHORITY_KEY)                          # a transient read failure on the pointer
    with pytest.raises(P.PublishError):
        P.advance(t, bid, r["manifest_sha256"], expect_current=None, by="o", reason="r", acceptance="HUMAN_CUTOVER")
    assert C.AUTHORITY_KEY not in fake.objs                  # never written on an unreadable pointer
    fake.fail.clear()
    P.advance(t, bid, r["manifest_sha256"], expect_current=None, by="o", reason="r", acceptance="HUMAN_CUTOVER")
    assert P.read_pointer(t)["build_id"] == bid
