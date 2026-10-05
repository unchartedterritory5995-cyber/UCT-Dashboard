"""Wave 14 -- an upload is capped WHILE it is read, on every notebook upload door.

Census row :264 (voice notes) and S-3 (note image / hero / attachment) in
`docs/notebook/security-review-notebook-routes.md`: a body with no declared
length, a chunked one, or one whose Content-Length lied, was parsed IN FULL --
spooled to a temp file or buffered in memory -- before any size check ran. The
fix is one shared helper, `api/services/request_body_cap.py`.

These tests drive the real routers through a hand-rolled ASGI `receive` that
hands the body over chunk by chunk from a GENERATOR and counts what the app
PULLED. That count is the claim under test: "capped while read" means the app
stops pulling at the cap, which a test client that buffers the whole body first
cannot show. Bodies are generated lazily -- the over-cap ones are never
materialised past the point the app stops reading.

Per route:
  * chunked, no Content-Length, just over the cap  -> 413, nothing persisted,
    every spooled temp file closed and gone
  * chunked, no Content-Length, far over the cap   -> 413, and the app stopped
    pulling within one chunk of the cap
  * at the cap exactly                             -> accepted
  * a lying Content-Length (declared small)        -> 413, stopped at the cap
  * a declared Content-Length over the cap         -> 413 before ONE byte is read
  * an ordinary upload through the test client     -> accepted
  * no session                                     -> refused before ONE byte is read
"""
from __future__ import annotations

import asyncio
import importlib
import json
import os
import tempfile
from pathlib import Path
from typing import Iterator

import pytest
import starlette.formparsers as formparsers
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.services import request_body_cap as cap
from api.services.journal_two import notes as notes_svc
from api.services.journal_two import voice_notes as vn

MiB = 1024 * 1024
CHUNK = 256 * 1024
BOUNDARY = "w14capBOUNDARY"


# ── the lazy body and the counting ASGI driver ───────────────────────────────

def _multipart(field: str, filename: str, ctype: str, size: int,
               fields: dict[str, str] | None = None, chunk: int = CHUNK) -> Iterator[bytes]:
    """A multipart body whose file part is `size` bytes, produced chunk by chunk."""
    for name, value in (fields or {}).items():
        yield (f"--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n"
               f"{value}\r\n").encode()
    yield (f"--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"{field}\"; "
           f"filename=\"{filename}\"\r\nContent-Type: {ctype}\r\n\r\n").encode()
    left = size
    block = b"\x89" * chunk
    while left > 0:
        n = min(chunk, left)
        yield block[:n]
        left -= n
    yield f"\r\n--{BOUNDARY}--\r\n".encode()


def _multipart_len(field, filename, ctype, size, fields=None) -> int:
    framing = sum(len(c) for c in _multipart(field, filename, ctype, 0, fields))
    return framing + size


class Drive:
    """One request through the app's ASGI callable. `pulled` is every body byte
    the app asked `receive` for."""

    def __init__(self, app, path: str, body: Iterator[bytes], *, headers: dict[str, str]):
        self.app, self.path, self.body, self.headers = app, path, body, headers
        self.pulled = 0
        self.status: int | None = None
        self.payload = b""

    def run(self) -> "Drive":
        asyncio.run(self._run())
        return self

    async def _run(self):
        done = False

        async def receive():
            nonlocal done
            if done:
                await asyncio.sleep(3600)          # a disconnect never arrives mid-request
            try:
                part = next(self.body)
            except StopIteration:
                done = True
                return {"type": "http.request", "body": b"", "more_body": False}
            self.pulled += len(part)
            return {"type": "http.request", "body": part, "more_body": True}

        async def send(message):
            if message["type"] == "http.response.start":
                self.status = message["status"]
            elif message["type"] == "http.response.body":
                self.payload += message.get("body", b"")

        scope = {
            "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
            "method": "POST", "scheme": "http", "path": self.path,
            "raw_path": self.path.encode(), "query_string": b"", "root_path": "",
            "headers": [(k.lower().encode(), v.encode()) for k, v in self.headers.items()],
            "client": ("127.0.0.1", 5000), "server": ("testserver", 80),
        }
        await self.app(scope, receive, send)

    def json(self):
        return json.loads(self.payload or b"null")


def _post(app, path, body, *, declared: int | None = None):
    headers = {"content-type": f"multipart/form-data; boundary={BOUNDARY}"}
    if declared is not None:
        headers["content-length"] = str(declared)
    else:
        headers["transfer-encoding"] = "chunked"
    return Drive(app, path, body, headers=headers).run()


# ── every spooled part is recorded, so "temp removed" is a measurement ───────

class _Recorder:
    def __init__(self):
        self.files: list = []
        self.paths: list[str] = []


@pytest.fixture
def spools(monkeypatch):
    """Starlette spools each file part into a SpooledTemporaryFile. Record every
    one, and force it to roll to a REAL disk file after one byte, so the test
    can assert both that it was closed and that the file is gone from disk."""
    rec = _Recorder()
    real = formparsers.SpooledTemporaryFile

    class Recording(real):
        def __init__(self, *a, **kw):
            kw["max_size"] = 1
            super().__init__(*a, **kw)
            rec.files.append(self)

        def rollover(self):
            super().rollover()
            name = getattr(self._file, "name", None)
            if isinstance(name, str):
                rec.paths.append(name)

    monkeypatch.setattr(formparsers, "SpooledTemporaryFile", Recording)
    return rec


def _assert_spools_gone(rec: _Recorder):
    assert rec.files, "non-vacuity: the parser spooled nothing, so nothing was tested"
    assert all(f.closed for f in rec.files), "a spooled upload part was left open"
    for p in rec.paths:
        assert not os.path.exists(p), f"a spooled temp file is still on disk: {p}"


# ── fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    try:
        os.unlink(tmp.name)
    except OSError:
        pass


@pytest.fixture
def attachment_root(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    root = tmp_path / "j2_attachments"
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", root)
    return root


@pytest.fixture(autouse=True)
def _quiet(monkeypatch):
    from api.services.entity_master import api as entity_master
    from api.services.journal_two import document_extraction
    monkeypatch.setattr(entity_master, "resolve",
                        lambda alias, as_of=None, **kw: entity_master.ResolveResult(status="not_found"))
    monkeypatch.setattr(document_extraction, "queue_extraction", lambda document_id: None)


@pytest.fixture
def j2_app(db_path, attachment_root):
    from api.routers import journal_two
    fa = FastAPI()
    fa.include_router(journal_two.router)
    yield fa
    fa.dependency_overrides.clear()


def _login(app, user_id="m-cap"):
    from api.services import auth_db
    conn = auth_db.get_connection()
    try:
        conn.execute("INSERT OR IGNORE INTO users (id, email, password_hash, display_name, role)"
                     " VALUES (?, ?, 'x', 'T', 'member')", (user_id, f"{user_id}@test.local"))
        conn.commit()
    finally:
        conn.close()
    app.dependency_overrides[authmw.get_current_user] = lambda: {"id": user_id, "role": "member"}


def _new_note(app) -> str:
    r = TestClient(app).post("/api/j2/notes", json={"title": "cap"})
    assert r.status_code == 200, r.text
    return r.json()["note"]["id"]


def _files_under(root: Path) -> list[Path]:
    return [p for p in root.rglob("*") if p.is_file()] if root.exists() else []


# ── the note doors: image, hero, attachment ──────────────────────────────────

NOTE_DOORS = [
    # (suffix, MIME, the route's own cap, the route's own sentence)
    ("images", "image/png", lambda: notes_svc._MAX_IMAGE_BYTES, lambda: notes_svc.IMAGE_TOO_BIG_SENTENCE),
    ("hero", "image/png", lambda: notes_svc._MAX_IMAGE_BYTES, lambda: notes_svc.IMAGE_TOO_BIG_SENTENCE),
    ("attachments", "text/plain", lambda: notes_svc._MAX_FILE_BYTES, lambda: notes_svc.FILE_TOO_BIG_SENTENCE),
]
IDS = [d[0] for d in NOTE_DOORS]


@pytest.mark.parametrize("door", NOTE_DOORS, ids=IDS)
def test_note_upload_just_over_the_cap_with_no_length_is_413_and_nothing_survives(
        j2_app, attachment_root, spools, door):
    suffix, ctype, limit, sentence = door
    _login(j2_app)
    note = _new_note(j2_app)
    d = _post(j2_app, f"/api/j2/notes/{note}/{suffix}", _multipart("file", "x.bin", ctype, limit() + 1))
    assert d.status == 413, d.payload
    assert d.json()["detail"] == sentence()
    assert _files_under(attachment_root) == []
    _assert_spools_gone(spools)


@pytest.mark.parametrize("door", NOTE_DOORS, ids=IDS)
def test_note_upload_far_over_the_cap_stops_being_read_at_the_cap(j2_app, attachment_root, spools, door):
    suffix, ctype, limit, sentence = door
    _login(j2_app)
    note = _new_note(j2_app)
    d = _post(j2_app, f"/api/j2/notes/{note}/{suffix}", _multipart("file", "x.bin", ctype, 3 * limit()))
    assert d.status == 413
    assert d.pulled <= limit() + cap.FRAMING_SLACK + CHUNK, d.pulled
    assert _files_under(attachment_root) == []
    _assert_spools_gone(spools)


@pytest.mark.parametrize("door", NOTE_DOORS, ids=IDS)
def test_note_upload_at_the_cap_is_accepted(j2_app, attachment_root, spools, door):
    suffix, ctype, limit, sentence = door
    _login(j2_app)
    note = _new_note(j2_app)
    d = _post(j2_app, f"/api/j2/notes/{note}/{suffix}", _multipart("file", "x.bin", ctype, limit()))
    assert d.status == 200, d.payload[:300]
    assert len(_files_under(attachment_root)) == 1
    assert all(f.closed for f in spools.files), "the form's temp file outlived the request"


@pytest.mark.parametrize("door", NOTE_DOORS, ids=IDS)
def test_note_upload_with_a_lying_content_length_is_still_stopped_at_the_cap(
        j2_app, attachment_root, spools, door):
    suffix, ctype, limit, sentence = door
    _login(j2_app)
    note = _new_note(j2_app)
    d = _post(j2_app, f"/api/j2/notes/{note}/{suffix}",
              _multipart("file", "x.bin", ctype, 3 * limit()), declared=1000)
    assert d.status == 413
    assert d.pulled <= limit() + cap.FRAMING_SLACK + CHUNK
    assert _files_under(attachment_root) == []
    _assert_spools_gone(spools)


@pytest.mark.parametrize("door", NOTE_DOORS, ids=IDS)
def test_note_upload_declared_over_the_cap_is_refused_before_a_byte_is_read(j2_app, attachment_root, door):
    suffix, ctype, limit, sentence = door
    _login(j2_app)
    note = _new_note(j2_app)
    size = limit() + cap.FRAMING_SLACK + 1
    d = _post(j2_app, f"/api/j2/notes/{note}/{suffix}", _multipart("file", "x.bin", ctype, size),
              declared=_multipart_len("file", "x.bin", ctype, size))
    assert d.status == 413 and d.json()["detail"] == sentence()
    assert d.pulled == 0


@pytest.mark.parametrize("door", NOTE_DOORS, ids=IDS)
def test_note_upload_ordinary_case_through_the_test_client(j2_app, attachment_root, door):
    suffix, ctype, limit, sentence = door
    _login(j2_app)
    note = _new_note(j2_app)
    r = TestClient(j2_app).post(f"/api/j2/notes/{note}/{suffix}",
                                files={"file": ("x.bin", b"\x89PNG-ish" * 64, ctype)})
    assert r.status_code == 200, r.text


@pytest.mark.parametrize("door", NOTE_DOORS, ids=IDS)
def test_note_upload_without_a_session_reads_no_body(j2_app, attachment_root, door):
    suffix, ctype, limit, sentence = door
    d = _post(j2_app, f"/api/j2/notes/n1/{suffix}", _multipart("file", "x.bin", ctype, 4 * MiB))
    assert d.status == 401
    assert d.pulled == 0, "an anonymous caller made the process read the upload"


def test_a_missing_file_field_is_the_same_422_a_File_parameter_gave(j2_app, attachment_root):
    _login(j2_app)
    note = _new_note(j2_app)
    r = TestClient(j2_app).post(f"/api/j2/notes/{note}/images", data={"other": "x"})
    assert r.status_code == 422
    assert r.json()["detail"][0]["loc"] == ["body", "file"]


# ── voice notes ──────────────────────────────────────────────────────────────

VOICE_CAP = 2 * MiB      # the route reads vn.MAX_UPLOAD_BYTES per request; a test moves it


@pytest.fixture
def voice_app(db_path, monkeypatch, tmp_path):
    from api.routers import notebook_voice_notes
    monkeypatch.setenv(vn.GATE, "1")
    monkeypatch.setattr(vn, "jobs_root", lambda: tmp_path / "voice-jobs")
    monkeypatch.setattr(vn, "transcription_available", lambda: True)
    monkeypatch.setattr(vn, "MAX_UPLOAD_BYTES", VOICE_CAP)
    monkeypatch.setattr(vn, "probe_duration", lambda path: 30.0)

    def split(src, out_dir, chunk_seconds=vn.CHUNK_SECONDS, **_kw):
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "part0000.flac").write_bytes(b"flac")
        return vn.ordered_parts(out_dir)

    monkeypatch.setattr(vn, "split_audio", split)
    with vn._JOBS_LOCK:
        vn._JOBS.clear()
    fa = FastAPI()
    fa.include_router(notebook_voice_notes.router)
    user = {"id": "v-cap", "role": "member", "plan": "pro"}
    from api.services import auth_db
    conn = auth_db.get_connection()
    try:
        conn.execute("INSERT OR IGNORE INTO users (id, email, password_hash, display_name, role)"
                     " VALUES ('v-cap', 'v-cap@test.local', 'x', 'T', 'member')")
        conn.commit()
    finally:
        conn.close()
    fa.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    fa.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)
    yield fa, tmp_path / "voice-jobs"
    fa.dependency_overrides.clear()
    with vn._JOBS_LOCK:
        vn._JOBS.clear()


def _audio(size):
    return _multipart("audio", "memo.m4a", "audio/mp4", size, fields={"source": "upload"})


def _no_voice_job(jobs_dir: Path):
    assert _files_under(jobs_dir) == []
    with vn._JOBS_LOCK:
        assert not vn._JOBS


def test_voice_just_over_the_cap_with_no_length_is_413_and_nothing_survives(voice_app, spools):
    app, jobs = voice_app
    d = _post(app, "/api/j2/voice-notes/jobs", _audio(VOICE_CAP + 1))
    assert d.status == 413 and d.json()["detail"] == vn.TOO_BIG_SENTENCE
    _no_voice_job(jobs)
    _assert_spools_gone(spools)


def test_voice_far_over_the_cap_stops_being_read_at_the_cap(voice_app, spools):
    app, jobs = voice_app
    d = _post(app, "/api/j2/voice-notes/jobs", _audio(5 * VOICE_CAP))
    assert d.status == 413
    assert d.pulled <= VOICE_CAP + cap.FRAMING_SLACK + CHUNK, d.pulled
    _no_voice_job(jobs)
    _assert_spools_gone(spools)


def test_voice_at_the_cap_is_accepted(voice_app, spools):
    app, jobs = voice_app
    d = _post(app, "/api/j2/voice-notes/jobs", _audio(VOICE_CAP))
    assert d.status == 200, d.payload[:300]
    with vn._JOBS_LOCK:
        assert len(vn._JOBS) == 1
    assert all(f.closed for f in spools.files)


def test_voice_with_a_lying_content_length_is_still_stopped_at_the_cap(voice_app, spools):
    app, jobs = voice_app
    d = _post(app, "/api/j2/voice-notes/jobs", _audio(5 * VOICE_CAP), declared=2048)
    assert d.status == 413
    assert d.pulled <= VOICE_CAP + cap.FRAMING_SLACK + CHUNK
    _no_voice_job(jobs)
    _assert_spools_gone(spools)


def test_voice_declared_over_the_cap_is_refused_before_a_byte_is_read(voice_app):
    app, jobs = voice_app
    size = VOICE_CAP + cap.FRAMING_SLACK + 1
    d = _post(app, "/api/j2/voice-notes/jobs", _audio(size),
              declared=_multipart_len("audio", "memo.m4a", "audio/mp4", size, {"source": "upload"}))
    assert d.status == 413 and d.pulled == 0


def test_voice_ordinary_upload_through_the_test_client(voice_app):
    app, jobs = voice_app
    r = TestClient(app).post("/api/j2/voice-notes/jobs",
                             files={"audio": ("memo.m4a", b"\x00" * 4096, "audio/mp4")},
                             data={"source": "upload"})
    assert r.status_code == 200, r.text


def test_voice_the_real_cap_is_the_services_constant_not_a_copy():
    """The route holds no number of its own: it reads `vn.MAX_UPLOAD_BYTES`
    per request (the tests above move it and the route follows)."""
    from api.routers import notebook_voice_notes
    src = Path(notebook_voice_notes.__file__).read_text(encoding="utf-8")
    assert "_MAX_REQUEST_BYTES" not in src
    assert "vn.MAX_UPLOAD_BYTES" in src
    assert vn.MAX_UPLOAD_BYTES == 90 * MiB   # the fixture is not active here


def test_voice_a_free_member_reads_no_body(db_path, monkeypatch):
    from api.routers import notebook_voice_notes
    monkeypatch.setenv(vn.GATE, "1")
    fa = FastAPI()
    fa.include_router(notebook_voice_notes.router)
    fa.dependency_overrides[authmw.get_current_user_with_plan] = lambda: {"id": "f", "role": "member", "plan": "free"}
    d = _post(fa, "/api/j2/voice-notes/jobs", _audio(MiB))
    assert d.status == 402 and d.pulled == 0


# ── the personal API's JSON body ─────────────────────────────────────────────

@pytest.fixture
def papi_app():
    from api.routers import notebook_personal_api as r
    fa = FastAPI()

    @fa.post("/echo")
    async def echo(request: Request):
        body = await r._json_body(request)
        return {"keys": sorted(body)}

    return fa, r._MAX_BODY_BYTES, r.papi.TOO_LARGE_SENTENCE


def _json_chunks(total: int, chunk: int = 32 * 1024) -> Iterator[bytes]:
    head, tail = b'{"markdown": "', b'"}'
    yield head
    left = total - len(head) - len(tail)
    while left > 0:
        n = min(chunk, left)
        yield b"a" * n
        left -= n
    yield tail


def _post_json(app, body, *, declared=None):
    headers = {"content-type": "application/json"}
    if declared is not None:
        headers["content-length"] = str(declared)
    else:
        headers["transfer-encoding"] = "chunked"
    return Drive(app, "/echo", body, headers=headers).run()


def test_personal_api_just_over_the_cap_with_no_length_is_413(papi_app):
    app, limit, sentence = papi_app
    d = _post_json(app, _json_chunks(limit + 1))
    assert d.status == 413 and d.json()["detail"] == sentence


def test_personal_api_far_over_the_cap_stops_being_read_at_the_cap(papi_app):
    app, limit, sentence = papi_app
    d = _post_json(app, _json_chunks(20 * limit))
    assert d.status == 413
    assert d.pulled <= limit + 32 * 1024, d.pulled


def test_personal_api_at_the_cap_is_accepted(papi_app):
    app, limit, sentence = papi_app
    d = _post_json(app, _json_chunks(limit))
    assert d.status == 200 and d.json() == {"keys": ["markdown"]}


def test_personal_api_lying_content_length_is_stopped_at_the_cap(papi_app):
    app, limit, sentence = papi_app
    d = _post_json(app, _json_chunks(20 * limit), declared=64)
    assert d.status == 413 and d.pulled <= limit + 32 * 1024


def test_personal_api_declared_over_the_cap_reads_nothing(papi_app):
    app, limit, sentence = papi_app
    d = _post_json(app, _json_chunks(limit + 1), declared=limit + 1)
    assert d.status == 413 and d.pulled == 0


def test_personal_api_ordinary_body(papi_app):
    app, limit, sentence = papi_app
    r = TestClient(app).post("/echo", json={"markdown": "hi", "title": "t"})
    assert r.status_code == 200 and r.json() == {"keys": ["markdown", "title"]}


# ── the helper's own edges ───────────────────────────────────────────────────

def test_a_malformed_content_length_is_a_400_not_a_parse(papi_app):
    app, limit, sentence = papi_app
    d = Drive(app, "/echo", iter([b"{}"]),
              headers={"content-type": "application/json", "content-length": "lots"}).run()
    assert d.status == 400 and d.pulled == 0


def test_the_helper_does_no_work_at_import():
    """The 10/02 boot lesson: module constants only."""
    import ast
    tree = ast.parse(Path(cap.__file__).read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Expr) and not isinstance(node.value, ast.Constant):
            pytest.fail(f"a top-level call runs at import: line {node.lineno}")
