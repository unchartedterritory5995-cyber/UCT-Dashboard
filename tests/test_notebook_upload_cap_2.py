"""Wave 14 (cap 2) -- the same while-read body cap on the Journal upload doors
and the three small JSON readers.

The open items of `docs/notebook/wave14-upload-cap.md`:

  * `POST /api/j2/trades/{id}/attachments`            5 MB image
  * `POST /api/j2/calendar/day/{date}/attachments`    5 MB image
  * `POST /api/j2/trades/import/preview`              10 MB CSV
  * `POST /api/j2/trades/import/preview-mapped`       10 MB CSV (had NO size check at all)
  * `_read_json` in entry_context (8 KB), plan_grades (16 KB), template_gallery (256 KB)

Each one took the whole body -- a `File(...)` parameter FastAPI parses in full
before any dependency (so before the session check too), or `await
request.body()` -- and only then measured it. They now go through the one
helper, `api/services/request_body_cap.py`.

Same instrument as `tests/test_notebook_upload_cap.py` (imported, not copied):
a hand-rolled ASGI `receive` that hands the body over chunk by chunk from a
GENERATOR and counts what the app PULLED. Per door:

  * chunked, no Content-Length, over the cap -> 413 with the route's own
    sentence, nothing persisted, every spooled temp file closed and gone
  * far over the cap                         -> stopped within a chunk of it
  * at the cap                               -> accepted
  * a lying Content-Length (declared small)  -> 413, stopped at the cap
  * a declared Content-Length over the cap   -> 413 before ONE byte is read
  * an ordinary request (test client)        -> accepted
  * no session                               -> refused before ONE byte is read
"""
from __future__ import annotations

from pathlib import Path
from typing import Iterator

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.services import request_body_cap as cap
from api.services.journal_two import calendar as calendar_svc
from api.services.journal_two import csv_import as csv_svc
from api.services.journal_two import trade_attachments as trade_att_svc
from tests.test_notebook_upload_cap import (  # noqa: F401  (fixtures by import)
    BOUNDARY, CHUNK, MiB, Drive, _assert_spools_gone, _files_under, _multipart,
    _multipart_len, _post, db_path, spools,
)

TRADE_ID = "t-cap"
TRADE_REF = "id:tcap"
DAY = "2026-10-05"
CSV_CAP = 256 * 1024     # the CSV routes read csv_svc.MAX_BYTES per request; a test moves it


# ── the journal app ──────────────────────────────────────────────────────────

@pytest.fixture
def attachment_root(tmp_path, monkeypatch):
    root = tmp_path / "j2_attachments"
    monkeypatch.setattr(calendar_svc, "_ATTACHMENT_ROOT", root)
    monkeypatch.setattr(trade_att_svc, "_ATTACHMENT_ROOT", root)
    return root


@pytest.fixture
def journal_app(db_path, attachment_root, monkeypatch):
    from api.routers import journal_two
    monkeypatch.setattr(journal_two.trades_service, "get_trade_detail",
                        lambda uid, tid: {"tradeRef": TRADE_REF} if tid == TRADE_ID else None)
    monkeypatch.setattr(journal_two.trades_service, "count_csv_duplicates", lambda uid, trades: 0)
    fa = FastAPI()
    fa.include_router(journal_two.router)
    yield fa
    fa.dependency_overrides.clear()


def _login(app, user_id="j-cap"):
    from api.services import auth_db
    conn = auth_db.get_connection()
    try:
        conn.execute("INSERT OR IGNORE INTO users (id, email, password_hash, display_name, role)"
                     " VALUES (?, ?, 'x', 'T', 'member')", (user_id, f"{user_id}@test.local"))
        conn.commit()
    finally:
        conn.close()
    app.dependency_overrides[authmw.get_current_user] = lambda: {"id": user_id, "role": "member"}


def _csv_bytes(size: int, chunk: int = CHUNK) -> Iterator[bytes]:
    """A parseable CSV of exactly `size` bytes, produced lazily."""
    head = b"Symbol,Qty\n"
    yield head
    left = size - len(head)
    row = b"AAPL,1\n"
    block = row * (chunk // len(row))
    while left > 0:
        n = min(len(block), left)
        yield block[:n]
        left -= n


def _csv_multipart(size: int, chunk: int = CHUNK) -> Iterator[bytes]:
    yield (f"--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; "
           f"filename=\"trades.csv\"\r\nContent-Type: text/csv\r\n\r\n").encode()
    yield from _csv_bytes(size, chunk)
    yield f"\r\n--{BOUNDARY}--\r\n".encode()


# Each door: (id, path, body(size) -> lazy multipart, limit(), sentence(), persisted(root) -> list)
def _image_body(size):
    return _multipart("file", "shot.png", "image/png", size)


def _image_len(size):
    return _multipart_len("file", "shot.png", "image/png", size)


def _csv_len(size):
    return sum(len(c) for c in _csv_multipart(0)) - len(b"Symbol,Qty\n") + size


DOORS = [
    ("trade-attachment", f"/api/j2/trades/{TRADE_ID}/attachments", _image_body, _image_len,
     lambda: trade_att_svc._MAX_IMAGE_BYTES, lambda: trade_att_svc.IMAGE_TOO_BIG_SENTENCE),
    ("day-attachment", f"/api/j2/calendar/day/{DAY}/attachments", _image_body, _image_len,
     lambda: calendar_svc._MAX_IMAGE_BYTES, lambda: calendar_svc.IMAGE_TOO_BIG_SENTENCE),
    ("csv-preview", "/api/j2/trades/import/preview", _csv_multipart, _csv_len,
     lambda: csv_svc.MAX_BYTES, lambda: csv_svc.too_big_sentence()),
    ("csv-preview-mapped", "/api/j2/trades/import/preview-mapped", _csv_multipart, _csv_len,
     lambda: csv_svc.MAX_BYTES, lambda: csv_svc.too_big_sentence()),
]
IDS = [d[0] for d in DOORS]


@pytest.fixture(params=DOORS, ids=IDS)
def door(request, monkeypatch):
    if request.param[0].startswith("csv"):
        monkeypatch.setattr(csv_svc, "MAX_BYTES", CSV_CAP)
    return request.param


def test_journal_upload_just_over_the_cap_with_no_length_is_413_and_nothing_survives(
        journal_app, attachment_root, spools, door):
    _id, path, body, _len, limit, sentence = door
    _login(journal_app)
    d = _post(journal_app, path, body(limit() + 1))
    assert d.status == 413, d.payload[:300]
    assert d.json()["detail"] == sentence()
    assert _files_under(attachment_root) == []
    _assert_spools_gone(spools)


def test_journal_upload_far_over_the_cap_stops_being_read_at_the_cap(
        journal_app, attachment_root, spools, door):
    _id, path, body, _len, limit, sentence = door
    _login(journal_app)
    d = _post(journal_app, path, body(3 * limit()))
    assert d.status == 413
    assert d.pulled <= limit() + cap.FRAMING_SLACK + CHUNK, d.pulled
    assert _files_under(attachment_root) == []
    _assert_spools_gone(spools)


def test_journal_upload_at_the_cap_is_accepted(journal_app, attachment_root, spools, door):
    _id, path, body, _len, limit, sentence = door
    _login(journal_app)
    d = _post(journal_app, path, body(limit()))
    assert d.status == 200, d.payload[:300]
    if "attachment" in _id:
        assert len(_files_under(attachment_root)) == 1
    else:
        assert d.json()["trades"] or d.json().get("format") is not None
    assert all(f.closed for f in spools.files), "the form's temp file outlived the request"


def test_journal_upload_with_a_lying_content_length_is_still_stopped_at_the_cap(
        journal_app, attachment_root, spools, door):
    _id, path, body, _len, limit, sentence = door
    _login(journal_app)
    d = _post(journal_app, path, body(3 * limit()), declared=1000)
    assert d.status == 413
    assert d.json()["detail"] == sentence()
    assert d.pulled <= limit() + cap.FRAMING_SLACK + CHUNK, d.pulled
    assert _files_under(attachment_root) == []
    _assert_spools_gone(spools)


def test_journal_upload_declared_over_the_cap_is_refused_before_a_byte_is_read(
        journal_app, attachment_root, door):
    _id, path, body, length, limit, sentence = door
    _login(journal_app)
    size = limit() + cap.FRAMING_SLACK + 1
    d = _post(journal_app, path, body(size), declared=length(size))
    assert d.status == 413 and d.json()["detail"] == sentence()
    assert d.pulled == 0


def test_journal_upload_ordinary_case_through_the_test_client(journal_app, attachment_root, door):
    _id, path, body, _len, limit, sentence = door
    _login(journal_app)
    if "attachment" in _id:
        files = {"file": ("shot.png", b"\x89PNG-ish" * 64, "image/png")}
    else:
        files = {"file": ("trades.csv", b"Symbol,Qty\nAAPL,1\n", "text/csv")}
    r = TestClient(journal_app).post(path, files=files)
    assert r.status_code == 200, r.text


def test_journal_upload_without_a_session_reads_no_body(journal_app, attachment_root, door):
    _id, path, body, _len, limit, sentence = door
    d = _post(journal_app, path, body(min(limit(), 4 * MiB)))
    assert d.status == 401
    assert d.pulled == 0, "an anonymous caller made the process read the upload"


def test_journal_a_missing_file_field_is_the_same_422_a_File_parameter_gave(journal_app):
    _login(journal_app)
    r = TestClient(journal_app).post(f"/api/j2/trades/{TRADE_ID}/attachments", data={"other": "x"})
    assert r.status_code == 422
    assert r.json()["detail"][0]["loc"] == ["body", "file"]


def test_journal_the_caps_are_the_services_constants_not_copies():
    """The router holds no number of its own for these four doors."""
    from api.routers import journal_two
    src = Path(journal_two.__file__).read_text(encoding="utf-8")
    assert "trade_attachments_service._MAX_IMAGE_BYTES" in src
    assert "calendar_service._MAX_IMAGE_BYTES" in src
    assert "csv_import_service.MAX_BYTES" in src
    assert _file_param_defaults(src) == [], "a route still parses an upload before auth"
    assert csv_svc.MAX_BYTES == 10 * MiB
    assert csv_svc.too_big_sentence() == "File exceeds 10 MB limit"
    assert trade_att_svc.IMAGE_TOO_BIG_SENTENCE == "Image must be < 5 MB"
    assert calendar_svc.IMAGE_TOO_BIG_SENTENCE == "Image must be < 5 MB"


# ── the three small JSON readers ─────────────────────────────────────────────

def _reader(name):
    import importlib
    mod = importlib.import_module(f"api.routers.{name}")
    return mod


READERS = ["notebook_entry_context", "notebook_plan_grades", "notebook_template_gallery"]


@pytest.fixture(params=READERS)
def reader_app(request):
    mod = _reader(request.param)
    fa = FastAPI()

    @fa.post("/echo")
    async def echo(req: Request):
        body = await mod._read_json(req)
        return {"keys": sorted(body)}

    return fa, mod.MAX_BODY_BYTES, mod.TOO_LARGE_SENTENCE


def _json_chunks(total: int, chunk: int = 4 * 1024) -> Iterator[bytes]:
    head, tail = b'{"why": "', b'"}'
    yield head
    left = total - len(head) - len(tail)
    while left > 0:
        n = min(chunk, left)
        yield b"a" * n
        left -= n
    yield tail


def _post_json(app, body, *, declared=None, path="/echo", method="POST"):
    headers = {"content-type": "application/json"}
    if declared is not None:
        headers["content-length"] = str(declared)
    else:
        headers["transfer-encoding"] = "chunked"
    return Drive(app, path, body, headers=headers, method=method).run()


def test_reader_just_over_the_cap_with_no_length_is_413(reader_app):
    app, limit, sentence = reader_app
    d = _post_json(app, _json_chunks(limit + 1))
    assert d.status == 413 and d.json()["detail"] == sentence == "Request too large"


def test_reader_far_over_the_cap_stops_being_read_at_the_cap(reader_app):
    app, limit, sentence = reader_app
    d = _post_json(app, _json_chunks(20 * limit))
    assert d.status == 413
    assert d.pulled <= limit + 4 * 1024, d.pulled


def test_reader_at_the_cap_is_accepted(reader_app):
    app, limit, sentence = reader_app
    d = _post_json(app, _json_chunks(limit))
    assert d.status == 200 and d.json() == {"keys": ["why"]}


def test_reader_lying_content_length_is_stopped_at_the_cap(reader_app):
    app, limit, sentence = reader_app
    d = _post_json(app, _json_chunks(20 * limit), declared=64)
    assert d.status == 413 and d.pulled <= limit + 4 * 1024


def test_reader_declared_over_the_cap_reads_nothing(reader_app):
    app, limit, sentence = reader_app
    d = _post_json(app, _json_chunks(limit + 1), declared=limit + 1)
    assert d.status == 413 and d.pulled == 0


def test_reader_ordinary_body(reader_app):
    app, limit, sentence = reader_app
    r = TestClient(app).post("/echo", json={"why": "hi", "title": "t"})
    assert r.status_code == 200 and r.json() == {"keys": ["title", "why"]}


def test_reader_empty_and_non_object_bodies_keep_their_answers(reader_app):
    app, limit, sentence = reader_app
    c = TestClient(app)
    assert c.post("/echo", content=b"").json() == {"keys": []}
    r = c.post("/echo", content=b"[1]", headers={"content-type": "application/json"})
    assert r.status_code == 422 and r.json()["detail"] == "Send a JSON object"


# The real write doors: the reader runs only after the session check.
REAL_WRITE_DOORS = [
    ("notebook_entry_context", "api.services.journal_two.entry_context", "PUT", "/api/j2/entry-context/why"),
    ("notebook_plan_grades", "api.services.journal_two.plan_grading", "POST", "/api/j2/plan-grades/trades/t1/relink"),
    ("notebook_template_gallery", "api.services.journal_two.template_gallery", "POST", "/api/j2/template-gallery"),
    ("notebook_template_gallery", "api.services.journal_two.template_gallery", "POST", "/api/j2/template-gallery/g1/report"),
]


@pytest.mark.parametrize("door", REAL_WRITE_DOORS, ids=[d[3] for d in REAL_WRITE_DOORS])
def test_reader_door_without_a_session_reads_no_body(db_path, monkeypatch, door):
    import importlib
    name, svc_name, method, path = door
    svc = importlib.import_module(svc_name)
    monkeypatch.setenv(svc.FLAG, "1")
    mod = _reader(name)
    fa = FastAPI()
    fa.include_router(mod.router)
    d = _post_json(fa, _json_chunks(4 * mod.MAX_BODY_BYTES), path=path, method=method)
    assert d.status == 401, d.payload[:200]
    assert d.pulled == 0, "an anonymous caller made the process read the body"


def _calls(src: str, attr: str) -> list[int]:
    """Line numbers of every `<x>.<attr>(...)` call (code, never comments)."""
    import ast
    return [n.lineno for n in ast.walk(ast.parse(src))
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == attr]


def _file_param_defaults(src: str) -> list[int]:
    """Line numbers of every parameter default that is a `File(...)` call."""
    import ast
    out = []
    for n in ast.walk(ast.parse(src)):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for d in n.args.defaults + n.args.kw_defaults:
                if isinstance(d, ast.Call) and getattr(d.func, "id", None) == "File":
                    out.append(d.lineno)
    return out


def test_the_source_probes_can_see_what_they_look_for():
    """Non-vacuity: both AST probes find the construct when it is there."""
    assert _calls("async def f(request):\n    raw = await request.body()\n", "body") == [2]
    assert _file_param_defaults("def f(file=File(...)):\n    pass\n") == [1]


def test_readers_no_longer_buffer_the_whole_body_first():
    for name in READERS:
        src = Path(_reader(name).__file__).read_text(encoding="utf-8")
        assert _calls(src, "body") == [], name
        assert _calls(src, "read_capped_body"), name
