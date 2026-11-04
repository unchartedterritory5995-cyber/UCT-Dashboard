"""Plan A Task 8 [B A1]: the editor's two upload doors run the ONE media policy.

`POST /api/j2/notes/{id}/images` and `/attachments` read the raw bytes, call
`media_policy.normalize_media` then `media_policy.store_media` under the member's
`MediaBudget`, and answer the additive shape
`{url, kind, name, size, mime, width, height, original: {url, name} | null}`. A refusal is
400 `{"detail": <marker text>, "reason": <reason>}`. `/hero` is unchanged.

Same standalone-FastAPI-app + temp-auth.db pattern as test_journal_two_documents_router.py.
"""
from __future__ import annotations

import importlib
import io
import os
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from api.middleware import auth_middleware as authmw


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


@pytest.fixture
def attachment_root(tmp_path, monkeypatch):
    from api.services.journal_two import media_policy
    from api.services.journal_two import notes as notes_svc
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "j2_attachments")
    media_policy._USAGE_MEMO.clear()
    yield tmp_path / "j2_attachments"


@pytest.fixture(autouse=True)
def _no_background_extraction(monkeypatch):
    from api.services.journal_two import document_extraction
    monkeypatch.setattr(document_extraction, "queue_extraction", lambda document_id: None)


@pytest.fixture
def app(db_path, attachment_root):
    from api.routers import journal_two as journal_two_router
    fa = FastAPI()
    fa.include_router(journal_two_router.router)
    yield fa
    fa.dependency_overrides.clear()


@pytest.fixture
def client(app):
    return TestClient(app)


def _login_as(app, user_id):
    app.dependency_overrides[authmw.get_current_user] = lambda: {"id": user_id, "role": "member"}


def _note(client) -> str:
    r = client.post("/api/j2/notes", json={"title": "A note"})
    assert r.status_code == 200
    return r.json()["note"]["id"]


def _img(fmt="JPEG", size=(8, 6)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (200, 30, 30)).save(buf, fmt)
    return buf.getvalue()


def _files(root) -> list:
    return [p for p in root.rglob("*") if p.is_file()] if root.exists() else []


SHAPE = {"url", "kind", "name", "size", "mime", "width", "height", "original"}


def test_images_door_accepts_raw_bytes_under_declared_mime(app, client):
    _login_as(app, "u1")
    note = _note(client)
    jpeg = _img("JPEG")
    r = client.post(f"/api/j2/notes/{note}/images",
                    files={"file": ("shot.png", jpeg, "image/png; charset=binary")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == SHAPE
    assert (body["kind"], body["mime"], body["name"], body["size"]) == ("image", "image/jpeg", "shot.png", len(jpeg))
    assert (body["width"], body["height"]) == (8, 6) and body["original"] is None
    assert body["url"].endswith(".jpg") and "/inline/" in body["url"]
    served = client.get(body["url"])
    assert served.status_code == 200 and served.content == jpeg


def test_images_door_converts_heic_and_reports_the_original(app, client):
    pi_heif = pytest.importorskip("pi_heif")
    pi_heif.register_heif_opener()
    _login_as(app, "u1")
    note = _note(client)
    # Fixture: 32x16 HEIC with EXIF Orientation=6, written once with pillow-heif (a one-off
    # scratch install, NOT a project dependency; pi-heif is decode-only and cannot encode).
    import pathlib
    heic = (pathlib.Path(__file__).resolve().parent / "fixtures" / "media" / "rotated_32x16_orient6.heic").read_bytes()
    r = client.post(f"/api/j2/notes/{note}/images", files={"file": ("IMG.heic", heic, "image/heic")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "image" and body["mime"] == "image/jpeg"
    assert (body["width"], body["height"]) == (16, 32)  # orientation applied
    assert body["original"]["name"] == "IMG.heic" and body["original"]["url"].endswith(".heic")


def test_images_door_refuses_heic_visibly_while_pi_heif_is_absent(app, client):
    try:
        import pi_heif  # noqa: F401
        pytest.skip("pi_heif is installed")
    except ImportError:
        pass
    _login_as(app, "u1")
    note = _note(client)
    fake = b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic" + b"\x00" * 64
    r = client.post(f"/api/j2/notes/{note}/images", files={"file": ("IMG.heic", fake, "image/heic")})
    assert r.status_code == 400
    assert r.json() == {"detail": "IMG.heic can't be shown here", "reason": "unsupported"}


def test_images_door_accepts_an_8mb_photo_and_downscales_it(app, client):
    _login_as(app, "u1")
    note = _note(client)
    w, h = 3200, 2700
    buf = io.BytesIO()
    Image.frombytes("RGB", (w, h), os.urandom(w * h * 3)).save(buf, "JPEG", quality=95)
    photo = buf.getvalue()
    assert 6 * 1024 * 1024 < len(photo) <= 25 * 1024 * 1024, len(photo)
    r = client.post(f"/api/j2/notes/{note}/images", files={"file": ("photo.jpg", photo, "image/jpeg")})
    assert r.status_code == 200, r.text      # was a 413 at 5 MB
    body = r.json()
    assert body["kind"] == "image" and body["size"] <= 5 * 1024 * 1024
    assert max(body["width"], body["height"]) <= 4096


def test_images_door_refusal_carries_a_reason(app, client, attachment_root):
    _login_as(app, "u1")
    note = _note(client)
    html = b"<!DOCTYPE html><html><body><script>alert(document.cookie)</script></body></html>"
    for door in ("images", "attachments"):
        r = client.post(f"/api/j2/notes/{note}/{door}", files={"file": ("chart.png", html, "image/png")})
        assert r.status_code == 400, (door, r.text)
        assert r.json() == {"detail": "chart.png can't be shown here", "reason": "unsupported"}
    assert _files(attachment_root) == []


def test_the_member_cap_refuses_an_upload_with_storage_limit(app, client, monkeypatch, attachment_root):
    from api.services.journal_two import media_policy
    _login_as(app, "u1")
    note = _note(client)
    png = _img("PNG")
    monkeypatch.setattr(media_policy, "MEMBER_IMPORT_MEDIA_CAP_BYTES", len(png) + 10)
    assert client.post(f"/api/j2/notes/{note}/images", files={"file": ("a.png", png, "image/png")}).status_code == 200
    r = client.post(f"/api/j2/notes/{note}/attachments", files={"file": ("b.csv", b"x" * 11, "text/csv")})
    assert r.status_code == 400
    # M1: the door's own sentence; nothing retries an editor upload, so no promise of one.
    assert r.json() == {"reason": "storage_limit", "detail": media_policy.UPLOAD_STORAGE_LIMIT_SENTENCE}
    assert "once space frees" not in media_policy.UPLOAD_STORAGE_LIMIT_SENTENCE
    assert len(_files(attachment_root)) == 1


@pytest.mark.parametrize("name,data,ctype", [
    ("IMG.heic", b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic" + b"\x00" * 64, "image/heic"),
    ("broken.png", b"\x89PNG\r\n\x1a\n" + b"corrupt" * 10, "image/png"),
])
def test_attachments_door_keeps_an_image_it_cannot_decode(app, client, name, data, ctype):
    """I5: an attachment is never decoded, so a HEIC with no decoder or a corrupt PNG is still
    attached as the member's file (the /images door would refuse both)."""
    _login_as(app, "u1")
    note = _note(client)
    r = client.post(f"/api/j2/notes/{note}/attachments", files={"file": (name, data, ctype)})
    assert r.status_code == 200, r.text
    assert (r.json()["kind"], r.json()["size"]) == ("file", len(data))
    assert client.get(r.json()["url"]).content == data


def test_attachments_door_keeps_an_oversize_photo_byte_for_byte(app, client):
    _login_as(app, "u1")
    note = _note(client)
    w, h = 2600, 2000
    buf = io.BytesIO()
    Image.frombytes("RGB", (w, h), os.urandom(w * h * 3)).save(buf, "JPEG", quality=95)
    photo = buf.getvalue()
    assert len(photo) > 5 * 1024 * 1024
    r = client.post(f"/api/j2/notes/{note}/attachments", files={"file": ("photo.jpg", photo, "image/jpeg")})
    assert r.status_code == 200 and r.json()["size"] == len(photo)


def test_a_disk_error_is_a_named_400_never_a_500(app, client, monkeypatch):
    from api.services.journal_two import notes as notes_svc

    def disk_error(*a, **k):
        raise OSError(5, "I/O error")

    monkeypatch.setattr(notes_svc, "save_note_attachment_bytes", disk_error)
    _login_as(app, "u1")
    note = _note(client)
    r = client.post(f"/api/j2/notes/{note}/attachments", files={"file": ("a.csv", b"a,b", "text/csv")})
    assert r.status_code == 400
    assert r.json() == {"detail": "Couldn't copy a.csv", "reason": "fetch_failed"}


@pytest.mark.parametrize("name,data,ctype,mime", [
    ("clip.mov", b"\x00\x00\x00\x14ftypqt  \x00\x00\x00\x00qt  " + b"\x00" * 32, "video/quicktime", "video/quicktime"),
    ("deck.pptx", b"PK\x03\x04" + b"\x00" * 64,
     "application/vnd.openxmlformats-officedocument.presentationml.presentation",
     "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
    ("notes.csv", b"a,b,c", "text/csv", "text/csv"),
])
def test_attachments_door_keeps_any_file_type(app, client, name, data, ctype, mime):
    _login_as(app, "u1")
    note = _note(client)
    r = client.post(f"/api/j2/notes/{note}/attachments", files={"file": (name, data, ctype)})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == SHAPE
    assert (body["kind"], body["mime"], body["name"], body["size"]) == ("file", mime, name, len(data))
    assert body["url"].endswith(os.path.splitext(name)[1]) and "/file/" in body["url"]


def test_attachments_door_stores_an_image_as_a_file_never_inline(app, client):
    _login_as(app, "u1")
    note = _note(client)
    png = _img("PNG")
    r = client.post(f"/api/j2/notes/{note}/attachments", files={"file": ("shot.png", png, "image/png")})
    assert r.status_code == 200
    body = r.json()
    assert body["kind"] == "file" and "/file/" in body["url"] and body["url"].endswith(".png")
    assert client.get(body["url"]).content == png


def test_hero_door_is_unchanged(app, client):
    from api.services.journal_two import notes as notes_svc
    _login_as(app, "u1")
    note = _note(client)
    big = b"\x89PNG\r\n\x1a\n" + b"\x00" * (6 * 1024 * 1024)
    r = client.post(f"/api/j2/notes/{note}/hero", files={"file": ("h.png", big, "image/png")})
    assert r.status_code == 413
    assert r.json() == {"detail": notes_svc.IMAGE_TOO_BIG_SENTENCE}
    r = client.post(f"/api/j2/notes/{note}/hero", files={"file": ("h.svg", b"<svg/>", "image/svg+xml")})
    assert r.status_code == 400 and r.json() == {"detail": "Only PNG/JPG/GIF/WebP images allowed"}
    ok = client.post(f"/api/j2/notes/{note}/hero", files={"file": ("h.png", _img("PNG"), "image/png")})
    assert ok.status_code == 200 and set(ok.json()) == {"heroImageUrl", "note"}


def test_upload_doors_404_for_another_members_note(app, client, attachment_root):
    _login_as(app, "u1")
    note = _note(client)
    _login_as(app, "u2")
    for door in ("images", "attachments"):
        r = client.post(f"/api/j2/notes/{note}/{door}", files={"file": ("a.png", _img("PNG"), "image/png")})
        assert r.status_code == 404, door
    assert _files(attachment_root) == []


def test_svg_attachment_is_served_download_only(app, client):
    _login_as(app, "u1")
    note = _note(client)
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    r = client.post(f"/api/j2/notes/{note}/images", files={"file": ("logo.svg", svg, "image/svg+xml")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "file" and body["url"].endswith(".svg")       # never inline
    served = client.get(body["url"])
    assert served.status_code == 200
    assert served.headers["content-disposition"].startswith("attachment")
    assert served.headers["content-security-policy"] == "sandbox"
    assert served.headers["x-content-type-options"] == "nosniff"


BUSY = {"detail": "Too many uploads at once. Try again in a moment."}


@pytest.fixture
def gate(monkeypatch):
    from api.routers import journal_two as jt
    monkeypatch.setattr(jt, "_UPLOAD_GATE", jt._UploadGate())
    return jt._UPLOAD_GATE


def test_a_member_with_two_uploads_in_flight_gets_429_at_once(app, client, gate, attachment_root, monkeypatch):
    """Final review I3: queued HEIC/large uploads parked the shared threadpool. The door
    refuses BEFORE it enters the threadpool: no decode, no file, an immediate 429."""
    from api.services.journal_two import media_policy
    _login_as(app, "u1")
    note = _note(client)
    decoded = []
    real = media_policy.normalize_media
    monkeypatch.setattr(media_policy, "normalize_media", lambda *a: decoded.append(1) or real(*a))
    gate.by_member["u1"] = 2
    gate.total = 2
    for door in ("images", "attachments"):
        r = client.post(f"/api/j2/notes/{note}/{door}", files={"file": ("a.png", _img("PNG"), "image/png")})
        assert (r.status_code, r.json()) == (429, BUSY), door
    assert decoded == [] and _files(attachment_root) == []
    # another member is not held up by u1's uploads
    _login_as(app, "u2")
    note2 = _note(client)
    ok = client.post(f"/api/j2/notes/{note2}/images", files={"file": ("a.png", _img("PNG"), "image/png")})
    assert ok.status_code == 200, ok.text
    assert (gate.total, gate.by_member) == (2, {"u1": 2})        # u2's slot came back


def test_the_whole_pod_caps_uploads_in_flight(app, client, gate, attachment_root):
    from api.routers import journal_two as jt
    _login_as(app, "u3")
    note = _note(client)
    gate.total = jt.UPLOAD_GLOBAL_INFLIGHT
    r = client.post(f"/api/j2/notes/{note}/images", files={"file": ("a.png", _img("PNG"), "image/png")})
    assert (r.status_code, r.json()) == (429, BUSY)
    assert _files(attachment_root) == [] and "u3" not in gate.by_member
    gate.total = jt.UPLOAD_GLOBAL_INFLIGHT - 1
    r = client.post(f"/api/j2/notes/{note}/images", files={"file": ("a.png", _img("PNG"), "image/png")})
    assert r.status_code == 200, r.text


def test_an_upload_slot_comes_back_on_every_exit(app, gate, monkeypatch):
    from api.services.journal_two import media_policy
    _login_as(app, "u1")
    client = TestClient(app, raise_server_exceptions=False)
    note = _note(client)

    def boom(*a, **k):
        raise RuntimeError("disk on fire")

    real_store = media_policy.store_media
    monkeypatch.setattr(media_policy, "store_media", boom)
    for _ in range(3):              # more than the per-member cap: a leaked slot would 429
        r = client.post(f"/api/j2/notes/{note}/images", files={"file": ("a.png", _img("PNG"), "image/png")})
        assert r.status_code == 500
    assert (gate.total, gate.by_member) == (0, {})
    monkeypatch.setattr(media_policy, "store_media", real_store)
    monkeypatch.setattr(media_policy, "MEMBER_IMPORT_MEDIA_CAP_BYTES", 0)
    for _ in range(3):              # a refusal (400) releases too
        r = client.post(f"/api/j2/notes/{note}/images", files={"file": ("a.png", _img("PNG"), "image/png")})
        assert r.status_code == 400 and r.json()["reason"] == "storage_limit"
    assert (gate.total, gate.by_member) == (0, {})


def test_concurrent_uploads_past_the_cap_are_refused_not_queued(app, gate, monkeypatch):
    """Two of a member's uploads are decoding (held); a third answers 429 immediately instead
    of waiting for a threadpool thread or a decode slot."""
    import threading as _t
    from api.services.journal_two import media_policy
    _login_as(app, "u1")
    inside, release = _t.Semaphore(0), _t.Event()
    real = media_policy.normalize_media

    def held(*a):
        inside.release()
        assert release.wait(10)
        return real(*a)

    with TestClient(app) as client:          # one portal: every request on ONE event loop
        note = _note(client)
        monkeypatch.setattr(media_policy, "normalize_media", held)
        results = []

        def post():
            results.append(client.post(f"/api/j2/notes/{note}/images",
                                       files={"file": ("a.png", _img("PNG"), "image/png")}).status_code)

        workers = [_t.Thread(target=post) for _ in range(2)]
        for w in workers:
            w.start()
        assert inside.acquire(timeout=10) and inside.acquire(timeout=10)
        third = client.post(f"/api/j2/notes/{note}/images", files={"file": ("a.png", _img("PNG"), "image/png")})
        assert (third.status_code, third.json()) == (429, BUSY)
        release.set()
        for w in workers:
            w.join(10)
    assert sorted(results) == [200, 200]
    assert (gate.total, gate.by_member) == (0, {})


def test_every_served_file_is_nosniff_and_a_pdf_still_opens_inline(app, client):
    _login_as(app, "u1")
    note = _note(client)
    r = client.post(f"/api/j2/notes/{note}/attachments",
                    files={"file": ("r.pdf", b"%PDF-1.4\n%%EOF\n", "application/pdf")})
    served = client.get(r.json()["url"])
    assert served.headers["x-content-type-options"] == "nosniff"
    assert "content-security-policy" not in served.headers
    assert not served.headers.get("content-disposition", "").startswith("attachment")
