"""Wave 14 (cap 2, round 2) -- the while-read body cap on the rest of the app's
upload doors, and the helper extension that carries a multipart form's text
fields.

Every door here declared `UploadFile = File(...)` BEFORE its auth dependency, so
FastAPI parsed the whole upload -- spooled to a temp file -- before the session
check ran, and measured it (when it measured it at all) after:

  * POST /api/auth/tickets/{t}/messages/{m}/attachments   5 MB  (support_attachments)
  * POST /api/auth/avatar                                 2 MB
  * POST /api/community/images                            5 MB
  * POST /api/desk/team/{id}/photo                        4 MB  (admin)
  * POST /api/indicator-vision/candidates                 5 MB image + bars + note
  * POST /api/voice/vision/upload                         5 MB
  * POST /api/voice/documents/upload                      10 MB
  * POST /api/voice/transcribe                            25 MB (Whisper's limit)
  * POST /api/voice/oneshot                               25 MB (Whisper's limit)

Each now takes its file (and its text fields) through ONE helper,
`request_body_cap.capped_multipart` (or `capped_upload`, built on it), declared
after the auth dependency. Same instrument as `tests/test_notebook_upload_cap.py`,
imported, never copied: a hand-rolled ASGI `receive` handing the body over chunk
by chunk from a GENERATOR and counting what the app PULLED.

Per door: no Content-Length just over the cap (413 with the route's own sentence,
nothing written, every spooled part closed and gone), far over (stopped within a
chunk), at the cap (accepted), a lying Content-Length (413, stopped), a declared
length over the cap (413, 0 bytes read), an ordinary request through the test
client, and no session (refused, 0 bytes read).
"""
from __future__ import annotations

import io
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import pytest
from fastapi import Depends, FastAPI, Request
from fastapi.testclient import TestClient
from starlette.formparsers import MultiPartParser

from api.middleware import auth_middleware as authmw
from api.services import request_body_cap as cap
from tests.test_notebook_upload_cap import (  # noqa: F401  (fixtures by import)
    BOUNDARY, CHUNK, MiB, Drive, _assert_spools_gone, _files_under, _multipart,
    _multipart_len, _post, db_path, spools,
)

USER = {"id": "u-cap3", "role": "member", "plan": "pro", "email": "u@test.local"}
ADMIN = {"id": "a-cap3", "role": "admin", "plan": "pro", "email": "a@test.local"}


def _png() -> bytes:
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (200, 30, 30)).save(buf, format="PNG")
    return buf.getvalue()


PNG = _png()   # a real image; the padding after IEND is ignored by every decoder


# ── the doors ────────────────────────────────────────────────────────────────

@dataclass
class Door:
    id: str
    path: str
    field: str
    filename: str
    ctype: str
    limit: Callable[[], int]
    sentence: Callable[[], str]
    build: Callable            # (monkeypatch, tmp_path, authed: bool) -> (app, written_dir, calls)
    fields: dict = field(default_factory=dict)
    head: bytes = b""
    extra: int = 0             # text parts the body cap allows beyond the file
    over_status: int = 413     # what "one byte over the FILE cap" answers
    ok: Callable = lambda d: True


def _calls():
    return {"n": 0, "sizes": []}


def _build_ticket(monkeypatch, tmp_path, authed):
    from api.routers import auth as auth_router
    from api.services import support_attachments as att
    calls = _calls()
    monkeypatch.setattr(auth_router, "get_ticket_thread",
                        lambda tid, user_id=None: {"messages": [{"id": "m1"}]})

    def save(user_id, ticket_id, message_id, raw):
        calls["n"] += 1
        calls["sizes"].append(len(raw))
        return {"id": "x", "filename": "x.webp", "width": 8, "height": 8}

    monkeypatch.setattr(att, "save_attachment", save)
    fa = FastAPI()
    fa.include_router(auth_router.router)
    if authed:
        fa.dependency_overrides[authmw.get_current_user] = lambda: dict(USER)
    return fa, tmp_path / "none", calls


def _build_avatar(monkeypatch, tmp_path, authed):
    from api.routers import avatar
    monkeypatch.setattr(avatar, "AVATAR_DIR", tmp_path / "avatars")
    fa = FastAPI()
    fa.include_router(avatar.router)
    if authed:
        fa.dependency_overrides[authmw.get_current_user] = lambda: dict(USER)
    return fa, tmp_path / "avatars", _calls()


def _build_community(monkeypatch, tmp_path, authed):
    from api.routers import community
    monkeypatch.setenv("COMMUNITY_UPLOAD_DIR", str(tmp_path / "community"))
    monkeypatch.setattr(community.store, "has_ack", lambda uid: True)
    monkeypatch.setattr(community.store, "is_muted", lambda uid: False)
    fa = FastAPI()
    fa.include_router(community.router)
    if authed:
        fa.dependency_overrides[community.require_community] = lambda: dict(USER)
    return fa, tmp_path / "community", _calls()


def _build_desk(monkeypatch, tmp_path, authed):
    from api.routers import desk
    monkeypatch.setattr(desk, "TEAM_PHOTO_DIR", tmp_path / "team")
    monkeypatch.setattr(desk.desk_store, "get_member", lambda mid: {"id": mid})
    monkeypatch.setattr(desk.desk_store, "set_member_photo", lambda mid, v: None)
    fa = FastAPI()
    fa.include_router(desk.router)
    if authed:
        fa.dependency_overrides[authmw.require_admin] = lambda: dict(ADMIN)
    return fa, tmp_path / "team", _calls()


def _build_indicator(monkeypatch, tmp_path, authed):
    from api.routers import indicator_vision as iv
    from api.routers import user_definitions
    calls = _calls()
    real = iv.svc.candidates_from_image
    monkeypatch.setattr(iv.svc, "vision_enabled", lambda: True)
    monkeypatch.setattr(iv, "_charge", lambda uid, now=None: None)
    monkeypatch.setattr(iv.telemetry, "log_event", lambda *a, **k: None)

    def candidates(*, image_bytes, media_type, user_id, bars, note):
        calls["n"] += 1
        calls["sizes"].append(len(image_bytes))
        calls["bars"], calls["note"] = bars, note
        if len(image_bytes) > iv.svc.MAX_IMAGE_BYTES:      # the service's own graceful refusal
            return real(image_bytes=image_bytes, media_type=media_type, user_id=user_id,
                        bars=bars, note=note)
        return {"ok": True, "candidates": []}

    monkeypatch.setattr(iv.svc, "candidates_from_image", candidates)
    fa = FastAPI()
    fa.include_router(iv.router)
    if authed:
        fa.dependency_overrides[user_definitions.require_paid] = lambda: dict(USER)
    return fa, tmp_path / "none", calls


def _build_voice(monkeypatch, tmp_path, authed):
    from api.limiter import limiter
    from api.routers import voice
    calls = _calls()
    monkeypatch.setattr(limiter, "enabled", False)

    def rec(tag):
        def f(*a, **k):
            calls["n"] += 1
            for v in list(a) + list(k.values()):
                if isinstance(v, (bytes, bytearray)):
                    calls["sizes"].append(len(v))
            if tag == "describe":
                calls["sizes"].append(len(__import__("base64").b64decode(k["image_b64"])))
                return {"ok": True}
            if tag == "ingest":
                return {"ok": True, "title": k.get("title")}
            if tag == "transcribe":
                if len(a[0]) > voice.MAX_AUDIO_BYTES:                 # the service's own check
                    raise ValueError(voice.audio_too_big_sentence())
                return "hello"
            return None
        return f

    import api.services.voice_chart_vision as vcv
    import api.services.voice_document_service as vds
    import api.services.voice_openai as vo
    monkeypatch.setattr(vcv, "describe_chart", rec("describe"))
    monkeypatch.setattr(vds, "ingest_text", rec("ingest"))
    monkeypatch.setattr(vds, "ingest_pdf_bytes", rec("ingest"))
    monkeypatch.setattr(vo, "_get_client", lambda: object())
    monkeypatch.setattr(voice, "transcribe_audio", rec("transcribe"))
    monkeypatch.setattr(voice, "cleanup_transcript", lambda t: t.upper())
    monkeypatch.setattr(voice, "get_voice_settings", lambda uid: {"enabled": True, "voice": "alloy", "speed": 1.0})
    monkeypatch.setattr(voice, "is_within_mode_d_cap", lambda uid, is_admin=False: True)
    monkeypatch.setattr(voice, "is_within_mode_b_cap", lambda uid, is_admin=False: True)
    monkeypatch.setattr(voice, "record_mode_d_seconds", lambda uid, s: None)
    monkeypatch.setattr(voice, "record_mode_b_call", lambda uid: None)
    monkeypatch.setattr(voice, "run_oneshot", lambda transcript, context, user: {"narration": f"{context}:{transcript}", "tool": ""})
    monkeypatch.setattr(voice, "synthesize_speech_stream", lambda text, voice=None, speed=None: iter([b"mp3"]))
    fa = FastAPI()
    fa.state.limiter = limiter
    fa.include_router(voice.router)
    if authed:
        fa.dependency_overrides[authmw.requires_voice_access] = lambda: dict(USER)
    return fa, tmp_path / "none", calls


def _lazy(name, attr):
    def get():
        import importlib
        v = getattr(importlib.import_module(name), attr)
        return v() if callable(v) else v
    return get


DOORS = [
    Door("ticket", "/api/auth/tickets/t1/messages/m1/attachments", "file", "s.png", "image/png",
         _lazy("api.services.support_attachments", "MAX_SOURCE_BYTES"),
         _lazy("api.services.support_attachments", "TOO_BIG_SENTENCE"), _build_ticket, head=PNG),
    Door("avatar", "/api/auth/avatar", "file", "a.png", "image/png",
         _lazy("api.routers.avatar", "MAX_SIZE"), _lazy("api.routers.avatar", "TOO_BIG_SENTENCE"),
         _build_avatar, head=PNG),
    Door("community", "/api/community/images", "file", "c.png", "image/png",
         _lazy("api.routers.community", "_MAX_IMAGE_BYTES"),
         _lazy("api.routers.community", "IMAGE_SIZE_SENTENCE"), _build_community, head=PNG),
    Door("desk", "/api/desk/team/7/photo", "file", "p.png", "image/png",
         _lazy("api.routers.desk", "MAX_PHOTO_SIZE"), _lazy("api.routers.desk", "PHOTO_TOO_BIG_SENTENCE"),
         _build_desk, head=PNG),
    Door("indicator", "/api/indicator-vision/candidates", "file", "i.png", "image/png",
         _lazy("api.services.indicator_from_image", "MAX_IMAGE_BYTES"),
         _lazy("api.services.indicator_from_image", "upload_too_large_sentence"), _build_indicator,
         fields={"note": "rsi", "bars": "[]"}, head=PNG, extra=2 * MultiPartParser.max_part_size,
         over_status=200),
    Door("voice-vision", "/api/voice/vision/upload", "image", "v.png", "image/png",
         _lazy("api.routers.voice", "VISION_MAX_BYTES"), _lazy("api.routers.voice", "VISION_TOO_BIG_SENTENCE"),
         _build_voice, fields={"symbol": "NVDA"}),
    Door("voice-document", "/api/voice/documents/upload", "file", "d.txt", "text/plain",
         _lazy("api.routers.voice", "DOCUMENT_MAX_BYTES"),
         _lazy("api.routers.voice", "DOCUMENT_TOO_BIG_SENTENCE"), _build_voice, fields={"title": "Plan"}),
    Door("voice-transcribe", "/api/voice/transcribe", "audio", "a.webm", "audio/webm",
         _lazy("api.routers.voice", "MAX_AUDIO_BYTES"), _lazy("api.routers.voice", "audio_too_big_sentence"),
         _build_voice, fields={"cleanup": "true"}),
    Door("voice-oneshot", "/api/voice/oneshot", "audio", "a.webm", "audio/webm",
         _lazy("api.routers.voice", "MAX_AUDIO_BYTES"), _lazy("api.routers.voice", "audio_too_big_sentence"),
         _build_voice, fields={"context": "chart"}),
]


@pytest.fixture(params=DOORS, ids=[d.id for d in DOORS])
def door(request):
    return request.param


def _body(d: Door, size: int):
    return _multipart(d.field, d.filename, d.ctype, size, fields=d.fields, head=d.head)


def _ceiling(d: Door) -> int:
    """The most body the app may PULL before it refuses: the cap the helper arms
    plus one chunk (the pull that crosses it)."""
    return d.limit() + cap.FRAMING_SLACK + d.extra + CHUNK


def _app(d, monkeypatch, tmp_path, authed=True):
    return d.build(monkeypatch, tmp_path, authed)


def test_just_over_the_cap_with_no_length_is_refused_and_nothing_survives(door, db_path, monkeypatch, tmp_path, spools):
    app, written, calls = _app(door, monkeypatch, tmp_path)
    dd = _post(app, door.path, _body(door, door.limit() + 1))
    assert dd.status == door.over_status, dd.payload[:300]
    if door.over_status == 413:
        assert dd.json()["detail"] == door.sentence()
        assert calls["n"] == 0, "the service ran on an over-cap upload"
    else:   # indicator: the service's own graceful refusal, unchanged
        assert dd.json()["gate"] == "vision:image-too-large"
    assert _files_under(written) == []
    _assert_spools_gone(spools)


def test_far_over_the_cap_stops_being_read_at_the_cap(door, db_path, monkeypatch, tmp_path, spools):
    app, written, calls = _app(door, monkeypatch, tmp_path)
    dd = _post(app, door.path, _body(door, 3 * door.limit() + door.extra))
    assert dd.status == 413, dd.payload[:300]
    assert dd.json()["detail"] == door.sentence()
    assert dd.pulled <= _ceiling(door), dd.pulled
    assert calls["n"] == 0 and _files_under(written) == []
    _assert_spools_gone(spools)


def test_at_the_cap_is_accepted(door, db_path, monkeypatch, tmp_path, spools):
    app, written, calls = _app(door, monkeypatch, tmp_path)
    dd = _post(app, door.path, _body(door, door.limit()))
    assert dd.status == 200, dd.payload[:300]
    if calls["sizes"]:
        assert door.limit() in calls["sizes"], calls["sizes"]
    assert all(f.closed for f in spools.files), "the form's temp file outlived the request"


def test_a_lying_content_length_is_still_stopped_at_the_cap(door, db_path, monkeypatch, tmp_path, spools):
    app, written, calls = _app(door, monkeypatch, tmp_path)
    dd = _post(app, door.path, _body(door, 3 * door.limit() + door.extra), declared=1000)
    assert dd.status == 413 and dd.json()["detail"] == door.sentence()
    assert dd.pulled <= _ceiling(door), dd.pulled
    assert calls["n"] == 0 and _files_under(written) == []
    _assert_spools_gone(spools)


def test_a_declared_length_over_the_cap_is_refused_before_a_byte_is_read(door, db_path, monkeypatch, tmp_path):
    app, written, calls = _app(door, monkeypatch, tmp_path)
    size = door.limit() + cap.FRAMING_SLACK + door.extra + 1
    dd = _post(app, door.path, _body(door, size),
               declared=_multipart_len(door.field, door.filename, door.ctype, size, door.fields))
    assert dd.status == 413 and dd.json()["detail"] == door.sentence()
    assert dd.pulled == 0


def test_an_ordinary_request_through_the_test_client(door, db_path, monkeypatch, tmp_path):
    app, written, calls = _app(door, monkeypatch, tmp_path)
    payload = (PNG + b"\x00" * 64) if door.head else b"hello world " * 64
    r = TestClient(app).post(door.path, files={door.field: (door.filename, payload, door.ctype)},
                             data=door.fields)
    assert r.status_code == 200, r.text


def test_without_a_session_reads_no_body(door, db_path, monkeypatch, tmp_path):
    app, written, calls = _app(door, monkeypatch, tmp_path, authed=False)
    dd = _post(app, door.path, _body(door, min(door.limit(), 2 * MiB)))
    assert dd.status == 401, dd.payload[:200]
    assert dd.pulled == 0, "an anonymous caller made the process read the upload"


# ── the text fields still arrive, typed as before ────────────────────────────

def test_voice_document_title_and_vision_symbol_reach_the_service(db_path, monkeypatch, tmp_path):
    import api.services.voice_chart_vision as vcv
    app, _, _ = _build_voice(monkeypatch, tmp_path, True)
    seen = {}
    monkeypatch.setattr(vcv, "describe_chart", lambda **k: seen.update(k) or {"ok": True})
    c = TestClient(app)
    r = c.post("/api/voice/vision/upload", files={"image": ("v.png", b"x" * 10, "image/png")},
               data={"symbol": "NVDA"})
    assert r.status_code == 200 and seen["symbol"] == "NVDA"
    r = c.post("/api/voice/documents/upload", files={"file": ("plan.txt", b"x" * 10, "text/plain")},
               data={"title": "My plan"})
    assert r.status_code == 200 and r.json()["title"] == "My plan"
    r = c.post("/api/voice/documents/upload", files={"file": ("plan.txt", b"x" * 10, "text/plain")})
    assert r.status_code == 200 and r.json()["title"] == "plan"      # the default still applies


def test_voice_transcribe_cleanup_is_still_parsed_as_a_bool(db_path, monkeypatch, tmp_path):
    app, _, _ = _build_voice(monkeypatch, tmp_path, True)
    c = TestClient(app)
    audio = {"audio": ("a.webm", b"x" * 10, "audio/webm")}
    assert c.post("/api/voice/transcribe", files=audio, data={"cleanup": "true"}).json()["text"] == "HELLO"
    assert c.post("/api/voice/transcribe", files=audio, data={"cleanup": "false"}).json()["text"] == "hello"
    assert c.post("/api/voice/transcribe", files=audio).json()["text"] == "hello"
    r = c.post("/api/voice/transcribe", files=audio, data={"cleanup": "maybe"})
    assert r.status_code == 422 and r.json()["detail"][0]["loc"] == ["body", "cleanup"]


def test_voice_oneshot_context_defaults_to_global(db_path, monkeypatch, tmp_path):
    app, _, _ = _build_voice(monkeypatch, tmp_path, True)
    r = TestClient(app).post("/api/voice/oneshot", files={"audio": ("a.webm", b"x" * 10, "audio/webm")})
    assert r.status_code == 200
    assert r.headers["x-voice-narration"].startswith("global")


def test_indicator_bars_and_note_reach_the_service(db_path, monkeypatch, tmp_path):
    app, _, calls = _build_indicator(monkeypatch, tmp_path, True)
    r = TestClient(app).post("/api/indicator-vision/candidates",
                             files={"file": ("i.png", PNG, "image/png")},
                             data={"note": "my rsi", "bars": '[{"t": 1, "c": 2}]'})
    assert r.status_code == 200, r.text
    assert calls["note"] == "my rsi" and calls["bars"] == [{"t": 1, "c": 2}]


def test_a_missing_file_is_the_same_422_a_File_parameter_gave(db_path, monkeypatch, tmp_path):
    app, _, _ = _build_avatar(monkeypatch, tmp_path, True)
    r = TestClient(app).post("/api/auth/avatar", data={"other": "x"})
    assert r.status_code == 422 and r.json()["detail"][0]["loc"] == ["body", "file"]


# ── the helper extension itself ──────────────────────────────────────────────

def _helper_app(**kw):
    dep = cap.capped_multipart("file", lambda: 64 * 1024, lambda: "too big", **kw)
    fa = FastAPI()

    @fa.post("/x")
    async def x(parts: cap.CappedMultipart = Depends(dep)):
        return {"size": parts.file.size, "fields": parts.fields}

    return fa


def test_capped_multipart_returns_the_named_text_fields_and_none_for_absent_ones():
    r = TestClient(_helper_app(fields=("a", "b"))).post(
        "/x", files={"file": ("f", b"x" * 10, "text/plain")}, data={"a": "1", "zzz": "ignored"})
    assert r.status_code == 200 and r.json() == {"size": 10, "fields": {"a": "1", "b": None}}


def test_capped_multipart_refuses_a_second_file_even_in_a_text_field():
    """`max_files=1`: a file sent where a text field belongs is a second file,
    refused by Starlette's parser (400) before any field is read."""
    r = TestClient(_helper_app(fields=("a",))).post(
        "/x", files={"file": ("f", b"x", "text/plain"), "a": ("g", b"y", "text/plain")})
    assert r.status_code == 400


def test_capped_multipart_exact_false_lets_the_route_judge_a_file_just_over_its_cap():
    over = 64 * 1024 + 10
    exact = TestClient(_helper_app()).post("/x", files={"file": ("f", b"x" * over, "text/plain")})
    loose = TestClient(_helper_app(exact=False)).post("/x", files={"file": ("f", b"x" * over, "text/plain")})
    assert exact.status_code == 413 and exact.json()["detail"] == "too big"
    assert loose.status_code == 200 and loose.json()["size"] == over


def test_capped_multipart_text_parts_widen_the_body_cap_by_that_many_part_ceilings():
    """A 300 KiB text part is over FRAMING_SLACK: refused without `text_parts`,
    accepted with one."""
    big = "y" * (300 * 1024)
    narrow = TestClient(_helper_app(fields=("a",))).post(
        "/x", files={"file": ("f", b"x", "text/plain")}, data={"a": big})
    wide = TestClient(_helper_app(fields=("a",), text_parts=1)).post(
        "/x", files={"file": ("f", b"x", "text/plain")}, data={"a": big})
    assert narrow.status_code == 413
    assert wide.status_code == 200 and len(wide.json()["fields"]["a"]) == len(big)


def test_capped_upload_is_built_on_capped_multipart_not_a_copy():
    """ONE helper: `capped_upload`'s dependency resolves `capped_multipart`'s."""
    import inspect
    dep = cap.capped_upload("file", lambda: 1, lambda: "s")
    (param,) = inspect.signature(dep).parameters.values()
    assert param.default.dependency.__qualname__.startswith("capped_multipart.")


def test_no_door_in_these_routers_declares_a_File_parameter():
    import ast
    import importlib
    for name in ("api.routers.auth", "api.routers.avatar", "api.routers.community", "api.routers.desk",
                 "api.routers.indicator_vision", "api.routers.voice", "api.routers.journal_two"):
        src = Path(importlib.import_module(name).__file__).read_text(encoding="utf-8")
        bad = [d.lineno for n in ast.walk(ast.parse(src)) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
               for d in n.args.defaults + n.args.kw_defaults
               if isinstance(d, ast.Call) and getattr(d.func, "id", None) in ("File", "Form")]
        assert bad == [], (name, bad)
