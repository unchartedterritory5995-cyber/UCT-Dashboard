"""Plan A Task 9 [B A2]: `POST /api/j2/notes/media/fetch` -- the member-scoped fetch door
Plan B's file importer uses to copy a hotlinked image into UCT storage.

Body `{url, noteImportKey?}`. The server resolves `noteImportKey` to the member's OWN
non-trashed note (media storage is per note); absent or unknown => 404 `{"detail": "Not found"}`.
The fetch goes through the shared SSRF-guarded hotlink path (`allow_http=True`, the guard on
every redirect hop), then `normalize_media` + `store_media`. 200 => `{src, kind, filename}`;
a refusal => 422 `{"reason", "markerText"}` at the top level. Rate-limited per member
(scope `notebook-media-fetch`).

No network: the door's client is a mock transport, and DNS is stubbed.
"""
from __future__ import annotations

import asyncio
import importlib
import io
import os
import tempfile

import httpx
import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from PIL import Image

from api.middleware import auth_middleware as authmw

_HOT = "http://cdn.example.com/a.png"


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (8, 6), (200, 30, 30)).save(buf, "PNG")
    return buf.getvalue()


PNG = _png()


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
def _fresh_limiter():
    from api.limiter import limiter
    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture(autouse=True)
def _fresh_inflight(monkeypatch):
    from api.routers import journal_two as journal_two_router
    monkeypatch.setattr(journal_two_router, "_MEDIA_FETCH_SEM",
                        asyncio.Semaphore(journal_two_router.MEDIA_FETCH_GLOBAL_INFLIGHT))
    monkeypatch.setattr(journal_two_router, "_media_fetch_inflight", {})


@pytest.fixture
def web(monkeypatch):
    """What the door's client answers, per URL; every request is recorded."""
    from api.routers import journal_two as journal_two_router
    from api.services.journal_two.note_connectors.providers import base as base_module

    async def _public(host):
        return ["142.250.0.1"]

    monkeypatch.setattr(base_module, "_resolve_host", _public)
    state = {"routes": {}, "calls": []}

    async def handler(request: httpx.Request) -> httpx.Response:
        # An http hop is sent to the checked IP with the original Host (fix round 1, I1).
        url = f"{request.url.scheme}://{request.headers['host']}{request.url.raw_path.decode()}"
        state["calls"].append(url)
        state.setdefault("headers", []).append(dict(request.headers))
        answer = state["routes"].get(url)
        if answer is None:
            raise AssertionError(f"unexpected request to {url}")
        out = answer()
        return await out if asyncio.iscoroutine(out) else out

    monkeypatch.setattr(journal_two_router, "_media_fetch_client",
                        lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    return state


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


def _imported(client, key: str) -> str:
    r = client.post("/api/j2/notes/import/confirm", json={"source": "notion", "notes": [
        {"importKey": key, "title": "Imported", "bodyJson": {"type": "doc", "content": []}, "tags": []}]})
    assert r.status_code == 200, r.text
    created = r.json()["created"][0]
    return created["id"] if isinstance(created, dict) else created


def _fetch(client, url=_HOT, key="notion:page-1"):
    body = {"url": url}
    if key is not None:
        body["noteImportKey"] = key
    return client.post("/api/j2/notes/media/fetch", json=body)


def test_media_fetch_door_copies_an_http_hotlink(app, client, web):
    _login_as(app, "u1")
    note_id = _imported(client, "notion:page-1")
    web["routes"][_HOT] = lambda: httpx.Response(200, content=PNG, headers={"content-type": "image/png"})

    r = _fetch(client)
    assert r.status_code == 200, r.text
    out = r.json()
    assert set(out) == {"src", "kind", "filename"}
    assert out["kind"] == "image" and out["filename"] == "a.png"
    assert out["src"].startswith(f"/api/j2/notes/attachments/u1/{note_id}/")
    assert web["calls"] == [_HOT]
    served = client.get(out["src"])                         # what we serve is our own URL
    assert served.status_code == 200 and served.content == PNG


def test_media_fetch_door_names_itself_to_the_image_host(app, client, web):
    """Live gate 2026-11-02: Wikimedia answered 403 to httpx's default `python-httpx/<v>`
    agent, so a hotlinked image a browser loads fine became a marker. Every hop now sends a
    descriptive User-Agent and an image Accept."""
    from api.services.journal_two.note_connectors.providers import base as base_module
    _login_as(app, "u1")
    _imported(client, "notion:page-1")
    web["routes"][_HOT] = lambda: httpx.Response(200, content=PNG, headers={"content-type": "image/png"})

    assert _fetch(client).status_code == 200
    sent = web["headers"][0]
    assert sent["user-agent"] == base_module.MEDIA_USER_AGENT
    assert "python-httpx" not in sent["user-agent"]
    assert sent["accept"].startswith("image/*")
    assert sent["accept-encoding"] == "identity"


def test_media_fetch_door_follows_a_redirect(app, client, web):
    _login_as(app, "u1")
    _imported(client, "notion:page-1")
    web["routes"][_HOT] = lambda: httpx.Response(302, headers={"location": "https://cdn2.example.com/real.png"})
    web["routes"]["https://cdn2.example.com/real.png"] = lambda: httpx.Response(
        200, content=PNG, headers={"content-type": "image/png"})
    r = _fetch(client)
    assert r.status_code == 200, r.text
    assert web["calls"] == [_HOT, "https://cdn2.example.com/real.png"]


def test_media_fetch_door_hands_stored_media_to_documents_like_the_upload_doors(app, client, web, monkeypatch):
    """Plan B R7 (a): a fetched image is searchable (OCR) exactly as an uploaded one is."""
    from api.services.journal_two import document_extraction
    seen = []
    monkeypatch.setattr(document_extraction, "on_attachment_saved",
                        lambda user_id, note_id, saved, content_type, *, kind: seen.append(
                            (user_id, note_id, saved["url"], content_type, kind)))
    _login_as(app, "u1")
    note_id = _imported(client, "notion:page-1")
    web["routes"][_HOT] = lambda: httpx.Response(200, content=PNG, headers={"content-type": "image/png"})
    r = _fetch(client)
    assert r.status_code == 200, r.text
    assert seen == [("u1", note_id, r.json()["src"], "image/png", "image")]


def test_a_failed_document_hand_off_never_costs_the_fetch(app, client, web, monkeypatch):
    from api.services.journal_two import document_extraction

    def boom(*a, **k):
        raise RuntimeError("auth.db busy")

    monkeypatch.setattr(document_extraction, "on_attachment_saved", boom)
    _login_as(app, "u1")
    _imported(client, "notion:page-1")
    web["routes"][_HOT] = lambda: httpx.Response(200, content=PNG, headers={"content-type": "image/png"})
    assert _fetch(client).status_code == 200


def test_media_fetch_door_returns_the_kept_original(app, client, web, monkeypatch):
    """Plan B R7 (b): when the policy keeps an original (a HEIC source, an animation), the door
    returns it so the importer inserts its chip -- never an orphan file on the member's cap."""
    from api.services.journal_two import media_policy
    real = media_policy.normalize_media
    heic = b"\x00\x00\x00\x18ftypheic-the-source"

    def with_original(data, content_type, filename):
        out = real(data, content_type, filename)
        return media_policy.MediaResult(kind=out.kind, mime=out.mime, data=out.data, filename=out.filename,
                                        original=media_policy.MediaResult(
                                            kind="file", mime="image/heic", data=heic, filename="a.heic"))

    monkeypatch.setattr(media_policy, "normalize_media", with_original)
    _login_as(app, "u1")
    note_id = _imported(client, "notion:page-1")
    web["routes"][_HOT] = lambda: httpx.Response(200, content=PNG, headers={"content-type": "image/png"})
    r = _fetch(client)
    assert r.status_code == 200, r.text
    out = r.json()
    assert set(out) == {"src", "kind", "filename", "original"}
    assert out["original"]["name"] == "a.heic"
    assert out["original"]["url"].startswith(f"/api/j2/notes/attachments/u1/{note_id}/file/")
    assert client.get(out["original"]["url"]).content == heic


def test_media_fetch_door_unsafe_redirect_is_422(app, client, web, attachment_root):
    _login_as(app, "u1")
    _imported(client, "notion:page-1")
    web["routes"][_HOT] = lambda: httpx.Response(302, headers={"location": "http://169.254.169.254/latest/meta-data/"})

    r = _fetch(client)
    assert r.status_code == 422, r.text
    out = r.json()
    assert set(out) == {"reason", "markerText"}               # top level, not inside `detail`
    assert out["reason"] == "unsafe"
    assert isinstance(out["markerText"], str) and out["markerText"]
    assert web["calls"] == [_HOT]                            # the metadata address is never asked
    assert not attachment_root.exists() or not any(p.is_file() for p in attachment_root.rglob("*"))


@pytest.mark.parametrize("url", ["http://127.0.0.1/a.png", "file:///etc/passwd", "javascript:alert(1)",
                                 "data:image/png;base64,AAAA"])
def test_media_fetch_door_refuses_an_unsafe_url_without_a_request(app, client, web, url):
    _login_as(app, "u1")
    _imported(client, "notion:page-1")
    r = _fetch(client, url=url)
    assert r.status_code == 422 and r.json()["reason"] == "unsafe"
    assert web["calls"] == []


def test_media_fetch_door_names_a_failed_download(app, client, web):
    _login_as(app, "u1")
    _imported(client, "notion:page-1")
    web["routes"][_HOT] = lambda: httpx.Response(404, content=b"gone")
    r = _fetch(client)
    assert r.status_code == 422
    assert r.json()["reason"] == "fetch_failed"
    assert "a.png" in r.json()["markerText"]


def test_media_fetch_door_names_a_web_page_refusal(app, client, web):
    _login_as(app, "u1")
    _imported(client, "notion:page-1")
    web["routes"][_HOT] = lambda: httpx.Response(
        200, content=b"<!doctype html><html><body>login</body></html>", headers={"content-type": "text/html"})
    r = _fetch(client)
    assert r.status_code == 422
    assert r.json()["reason"] == "unsupported"


def test_media_fetch_door_404s_without_a_member_note(app, client, web):
    _login_as(app, "u2")
    _imported(client, "notion:theirs")
    _login_as(app, "u1")
    trashed = _imported(client, "notion:trashed")
    assert client.delete(f"/api/j2/notes/{trashed}").status_code == 200
    for key in (None, "notion:unknown", "notion:theirs", "notion:trashed", ""):
        r = _fetch(client, key=key)
        assert r.status_code == 404, (key, r.text)
        assert r.json() == {"detail": "Not found"}
    assert web["calls"] == []                                # nothing fetched for a refused key


def test_media_fetch_door_rejects_a_non_string_url(app, client, web):
    _login_as(app, "u1")
    _imported(client, "notion:page-1")
    r = client.post("/api/j2/notes/media/fetch", json={"url": 5, "noteImportKey": "notion:page-1"})
    assert r.status_code == 400
    assert web["calls"] == []


def test_media_fetch_door_is_rate_limited(app, client, web, monkeypatch):
    from api.routers import journal_two as journal_two_router
    assert journal_two_router.NOTE_MEDIA_FETCH_RATE == "120/minute"
    assert journal_two_router.SCOPE_NOTE_MEDIA_FETCH == "notebook-media-fetch"
    monkeypatch.setattr(journal_two_router, "NOTE_MEDIA_FETCH_RATE", "2/minute")
    web["routes"][_HOT] = lambda: httpx.Response(200, content=PNG, headers={"content-type": "image/png"})
    _login_as(app, "u1")
    _imported(client, "notion:page-1")
    assert _fetch(client).status_code == 200
    assert _fetch(client, key="notion:unknown").status_code == 404     # a probe spends budget too
    limited = _fetch(client)
    assert limited.status_code == 429
    assert len(web["calls"]) == 1                            # the limited call fetched nothing
    _login_as(app, "u2")                                     # keyed on the member
    _imported(client, "notion:page-2")
    assert _fetch(client, key="notion:page-2").status_code == 200


# ---------------------------------------------------------------------------
# Task 9 fix round 1 (I2): one deadline for the whole fetch; in-flight caps
# ---------------------------------------------------------------------------


def _members_by_header(app):
    """Concurrent requests from different members: the member is the `x-user` header."""
    def who(request: Request):
        return {"id": request.headers["x-user"], "role": "member"}

    app.dependency_overrides[authmw.get_current_user] = who


def _async_client(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")


async def _afetch(ac, user, key, url=_HOT):
    return await ac.post("/api/j2/notes/media/fetch", json={"url": url, "noteImportKey": key},
                         headers={"x-user": user})


async def _until(pred, timeout=5.0):
    loop = asyncio.get_running_loop()
    end = loop.time() + timeout
    while not pred():
        assert loop.time() < end, "condition never became true"
        await asyncio.sleep(0.01)


def test_a_slow_drip_fetch_hits_the_deadline_as_a_named_422(app, client, web, monkeypatch):
    from api.routers import journal_two as journal_two_router
    monkeypatch.setattr(journal_two_router, "MEDIA_FETCH_DEADLINE_S", 0.2)
    _login_as(app, "u1")
    _imported(client, "notion:page-1")

    async def drip():
        await asyncio.sleep(30)                              # never answers inside the deadline
        return httpx.Response(200, content=PNG)

    web["routes"][_HOT] = drip
    r = _fetch(client)
    assert r.status_code == 422, r.text
    assert r.json() == {"reason": "fetch_failed", "markerText": r.json()["markerText"]}
    assert "a.png" in r.json()["markerText"]
    assert journal_two_router._media_fetch_inflight == {}    # the slot is given back


async def test_a_member_over_their_in_flight_cap_gets_429_at_once(app, client, web):
    from api.routers import journal_two as journal_two_router
    _login_as(app, "u1")
    _imported(client, "notion:page-1")
    release = asyncio.Event()

    async def held():
        await release.wait()
        return httpx.Response(200, content=PNG, headers={"content-type": "image/png"})

    web["routes"][_HOT] = held
    _members_by_header(app)
    async with _async_client(app) as ac:
        first = [asyncio.create_task(_afetch(ac, "u1", "notion:page-1")) for _ in range(2)]
        await _until(lambda: len(web["calls"]) == 2)
        third = await asyncio.wait_for(_afetch(ac, "u1", "notion:page-1"), 2)   # not queued
        assert third.status_code == 429
        assert len(web["calls"]) == 2                        # the refused call fetched nothing
        release.set()
        assert [t.status_code for t in await asyncio.gather(*first)] == [200, 200]
    assert journal_two_router._media_fetch_inflight == {}


async def test_the_whole_pod_runs_at_most_the_global_cap_at_once(app, client, web, monkeypatch):
    from api.routers import journal_two as journal_two_router
    monkeypatch.setattr(journal_two_router, "_MEDIA_FETCH_SEM", asyncio.Semaphore(1))
    for user, key in (("u1", "notion:a"), ("u2", "notion:b")):
        _login_as(app, user)
        _imported(client, key)
    release = asyncio.Event()

    async def held():
        await release.wait()
        return httpx.Response(200, content=PNG, headers={"content-type": "image/png"})

    web["routes"][_HOT] = held
    _members_by_header(app)
    async with _async_client(app) as ac:
        a = asyncio.create_task(_afetch(ac, "u1", "notion:a"))
        await _until(lambda: len(web["calls"]) == 1)
        b = asyncio.create_task(_afetch(ac, "u2", "notion:b"))
        await asyncio.sleep(0.2)
        assert len(web["calls"]) == 1                        # u2 waits for the one global slot
        release.set()
        assert (await a).status_code == 200 and (await b).status_code == 200
    assert len(web["calls"]) == 2
