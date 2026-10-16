"""Archive chart images: private storage, paid-only serving (owner decision 4, 2026-10-16).

SYNTHETIC tiny images only -- the repo is public.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. an image served to an unpaid member (402), to anyone with the flag off (404), or to anonymous;
2. a non-image (or a disguised one) accepted because of its declared type or name;
3. a re-upload creating a second row or a second object (idempotency by content);
4. R2 configured but the object not written there, or a read that skips R2 when the cache is empty;
5. record payloads not carrying the ids of their stored images (or carrying another record's);
6. the import route reachable without the push secret.
"""
from __future__ import annotations

import base64
import hashlib
import io

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import wisdom_archive
from api.services.wisdom.archive import images
from api.services.wisdom.core import store
from tests.authclients import FREE_MEMBER, PAID_MEMBER, authorize

SECRET = "s3cret-archive-images-test"
AUTH = {"Authorization": f"Bearer {SECRET}"}
BATCH = "/api/internal/wisdom/archive/batch"
UPLOAD = "/api/internal/wisdom/archive/image"


def _png(color=(10, 20, 30), size=(4, 3)) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    monkeypatch.setenv("WISDOM_ARCHIVE_IMAGE_DIR", str(tmp_path / "imgs"))
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "1")
    monkeypatch.setenv("PUSH_SECRET", SECRET)
    for k in ("DATA_SYNC_ENDPOINT_URL", "DATA_SYNC_ACCESS_KEY", "DATA_SYNC_SECRET_KEY", "DATA_SYNC_BUCKET"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(images, "_cache_bytes", None)
    store.init_db()
    return tmp_path


def _client(user=None):
    app = FastAPI()
    app.include_router(wisdom_archive.member_router)
    app.include_router(wisdom_archive.internal_router)
    if user is not None:
        authorize(app, user)
    return TestClient(app, raise_server_exceptions=False)


def _upload(c, data: bytes, record_id="t9101", ordinal=0, headers=AUTH):
    return c.post(UPLOAD, json={"record_id": record_id, "ordinal": ordinal,
                                "data_b64": base64.b64encode(data).decode()}, headers=headers)


def _seed_records():
    c = _client()
    recs = [{"record_id": "t9101", "author_id": "tsdr", "stated_date": "2025-01-02", "record_type": "CALL",
             "tickers": ["ZZTA"], "note": "synthetic chart post", "quote": "", "image_count": 1},
            {"record_id": "t9102", "author_id": "bracco", "stated_date": "2025-01-03", "record_type": "LESSON",
             "tickers": ["ZZTA"], "note": "synthetic post without charts", "quote": "", "image_count": 0}]
    assert c.post(BATCH, json={"kind": "records", "items": recs}, headers=AUTH).json()["inserted"] == 2


# ── 1. the gates ─────────────────────────────────────────────────────────────

def test_paid_gets_the_bytes_unpaid_402_anonymous_refused(env):
    png = _png()
    res = _upload(_client(), png)
    assert res.status_code == 200 and res.json()["status"] == "inserted"
    iid = hashlib.sha256(png).hexdigest()
    paid = _client(PAID_MEMBER).get(f"/api/wisdom/archive/image/{iid}")
    assert paid.status_code == 200 and paid.content == png
    assert paid.headers["content-type"] == "image/png"
    assert paid.headers["cache-control"].startswith("private")             # never a shared cache
    assert _client(FREE_MEMBER).get(f"/api/wisdom/archive/image/{iid}").status_code == 402
    assert _client(None).get(f"/api/wisdom/archive/image/{iid}").status_code in (401, 403)


def test_flag_off_is_404_for_the_image_and_the_upload(env, monkeypatch):
    png = _png()
    assert _upload(_client(), png).status_code == 200
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "0")
    iid = hashlib.sha256(png).hexdigest()
    assert _client(PAID_MEMBER).get(f"/api/wisdom/archive/image/{iid}").status_code == 404
    assert _upload(_client(), _png((1, 2, 3))).status_code == 404


def test_unknown_or_malformed_id_is_404(env):
    paid = _client(PAID_MEMBER)
    assert paid.get(f"/api/wisdom/archive/image/{'0' * 64}").status_code == 404
    assert paid.get("/api/wisdom/archive/image/not-an-id").status_code == 404


def test_upload_requires_the_push_secret(env):
    assert _upload(_client(), _png(), headers={}).status_code in (401, 403)
    assert _upload(_client(), _png(), headers={"Authorization": "Bearer wrong"}).status_code in (401, 403)


# ── 2. validation by bytes ───────────────────────────────────────────────────

@pytest.mark.parametrize("data", [
    b"<html>not an image</html>",
    b"GIF89a" + b"\x00" * 20,                       # a real image type we do not accept
    b"%PDF-1.4 synthetic",
    b"",
])
def test_non_images_are_refused_whatever_they_claim(env, data):
    res = _upload(_client(), data)
    assert res.status_code == 422, res.text


def test_jpeg_and_webp_are_accepted_by_their_magic_bytes(env):
    from PIL import Image

    for fmt, ctype in (("JPEG", "image/jpeg"), ("WEBP", "image/webp")):
        buf = io.BytesIO()
        Image.new("RGB", (5, 5), (200, 10, 10)).save(buf, format=fmt)
        res = _upload(_client(), buf.getvalue(), ordinal=1 if fmt == "JPEG" else 2)
        assert res.status_code == 200, (fmt, res.text)
        iid = res.json()["image_id"]
        got = _client(PAID_MEMBER).get(f"/api/wisdom/archive/image/{iid}")
        assert got.headers["content-type"] == ctype


def test_oversize_is_refused(env, monkeypatch):
    monkeypatch.setattr(images, "MAX_BYTES", 50)
    assert _upload(_client(), _png(size=(40, 40))).status_code == 422


def test_bad_base64_and_bad_record_id_are_422(env):
    c = _client()
    assert c.post(UPLOAD, json={"record_id": "t1", "ordinal": 0, "data_b64": "@@@"}, headers=AUTH).status_code == 422
    assert _upload(c, _png(), record_id="../etc").status_code == 422


# ── 3. idempotency ───────────────────────────────────────────────────────────

def test_reupload_is_unchanged_one_row_one_file(env):
    png = _png()
    c = _client()
    assert _upload(c, png).json()["status"] == "inserted"
    assert _upload(c, png).json()["status"] == "unchanged"
    with store.read() as conn:
        assert conn.execute("SELECT COUNT(*) FROM wisdom_archive_images").fetchone()[0] == 1
    files = list((env / "imgs").iterdir())
    assert [f.name for f in files] == [hashlib.sha256(png).hexdigest()]


def test_missing_reports_only_what_is_not_stored(env):
    a, b = _png((1, 1, 1)), _png((2, 2, 2))
    c = _client()
    _upload(c, a)
    ia, ib = hashlib.sha256(a).hexdigest(), hashlib.sha256(b).hexdigest()
    res = c.post("/api/internal/wisdom/archive/images/missing", json={"image_ids": [ia, ib, "junk"]}, headers=AUTH)
    assert res.json()["missing"] == [ib]


# ── 4. R2 path ───────────────────────────────────────────────────────────────

class FakeR2:
    def __init__(self):
        self.objects = {}

    def put_object(self, Bucket, Key, Body, ContentType):
        self.objects[(Bucket, Key)] = (Body, ContentType)

    def get_object(self, Bucket, Key):
        body, _ = self.objects[(Bucket, Key)]
        return {"Body": io.BytesIO(body)}


def test_with_r2_the_object_goes_to_r2_and_a_cold_cache_reads_through(env, monkeypatch):
    r2 = FakeR2()
    monkeypatch.setattr(images, "_r2", lambda: (r2, "bkt"))
    png = _png((9, 9, 9))
    iid = hashlib.sha256(png).hexdigest()
    assert _upload(_client(), png).status_code == 200
    assert ("bkt", f"wisdom_archive_images/{iid}.png") in r2.objects                 # written to R2
    (env / "imgs" / iid).unlink()                                                   # cold cache
    got = _client(PAID_MEMBER).get(f"/api/wisdom/archive/image/{iid}")
    assert got.status_code == 200 and got.content == png                            # read through R2
    assert (env / "imgs" / iid).exists()                                            # and re-cached


def test_a_corrupted_r2_object_is_not_served(env, monkeypatch):
    r2 = FakeR2()
    monkeypatch.setattr(images, "_r2", lambda: (r2, "bkt"))
    png = _png((7, 7, 7))
    iid = hashlib.sha256(png).hexdigest()
    _upload(_client(), png)
    (env / "imgs" / iid).unlink()
    r2.objects[("bkt", f"wisdom_archive_images/{iid}.png")] = (b"tampered", "image/png")
    assert _client(PAID_MEMBER).get(f"/api/wisdom/archive/image/{iid}").status_code == 404


# ── 5. payloads carry their own record's image ids ───────────────────────────

def test_ticker_payload_lists_image_ids_only_on_the_record_that_has_them(env):
    _seed_records()
    png = _png((3, 3, 3))
    _upload(_client(), png, record_id="t9101")
    t = _client(PAID_MEMBER).get("/api/wisdom/archive/ticker/ZZTA").json()
    by_id = {r["record_id"]: r for r in t["records"]}
    assert by_id["t9101"]["images"] == [hashlib.sha256(png).hexdigest()]
    assert "images" not in by_id["t9102"]                                           # control


def test_attach_survives_a_missing_table(env):
    with store.write() as conn:
        conn.execute("DROP TABLE wisdom_archive_images")
    payload = {"records": [{"record_id": "t1"}]}
    assert images.attach(payload) == {"records": [{"record_id": "t1"}]}


def test_image_sql_names_only_the_image_table():
    import re

    text = open(images.__file__, encoding="utf-8").read()
    found = {t for t in re.findall(r"(?:FROM|INTO|UPDATE|JOIN)\s+(\w+)", text) if t.startswith(("wisdom", "sqlite"))}
    assert found and found <= {"wisdom_archive_images", "sqlite_master"}, found
