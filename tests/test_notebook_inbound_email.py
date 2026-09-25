"""Wave 7 lane G (G3) — email-in (`/api/j2/inbound-email`).

The rails, in the brief's order:

  * DARK: gate off -> every route 404 (FastAPI's own body) and nothing is read,
    verified or written (the service functions are spied).
  * HMAC: a wrong secret, a stale or future timestamp, a tampered body, a
    replay under a fresh timestamp, a missing header, no server secret -> a
    BARE 401 and nothing written.
  * UNKNOWN TOKEN -> 202 and no note (never an oracle); a rotated address
    drops like one that never existed.
  * TENANT SCOPING: an address writes only into its own member's Notebook,
    and the address endpoints are per member.
  * The note: subject title (or "Email <ET date>"), text via Markdown or HTML,
    images referenced by URL never fetched, Inbox folder, attachments through
    the Notebook's own save functions — a refused one is one line, never a
    failure — and each saved one handed to `on_attachment_saved`.
  * The Cloudflare worker's signer and payload builder, RUN under Node, agree
    byte-for-byte with the server.
"""
from __future__ import annotations

import base64
import importlib
import io
import json
import os
import shutil
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw

GATE = "NOTEBOOK_INBOUND_EMAIL_ENABLED"
SECRET = "test-inbound-secret-" + "x" * 20
REPO = Path(__file__).resolve().parents[1]
SIGN_JS = REPO / "cloudflare" / "inbound-email-worker" / "src" / "sign.js"


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
    from api.services.journal_two import notes as notes_svc
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "j2_attachments")
    yield tmp_path


@pytest.fixture(autouse=True)
def _no_background_extraction(monkeypatch):
    from api.services.journal_two import document_extraction
    monkeypatch.setattr(document_extraction, "queue_extraction", lambda document_id: None)


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv(GATE, "1")
    monkeypatch.setenv("NOTEBOOK_INBOUND_EMAIL_SECRET", SECRET)
    monkeypatch.delenv("NOTEBOOK_INBOUND_EMAIL_DOMAIN", raising=False)


@pytest.fixture
def app(db_path, attachment_root):
    from api.routers import notebook_inbound_email
    fa = FastAPI()
    fa.include_router(notebook_inbound_email.router)
    yield fa
    fa.dependency_overrides.clear()


@pytest.fixture
def client(app):
    return TestClient(app)


def _user() -> str:
    return "u-" + uuid.uuid4().hex[:10]


def _as_member(app, user_id, *, paid=True):
    user = {"id": user_id, "role": "member", "plan": "pro" if paid else "free"}
    app.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)


def _address(user_id: str) -> str:
    from api.services.journal_two import inbound_email
    return inbound_email.get_or_create_address(user_id)["address"]


def _signed(payload, *, secret=SECRET, ts=None, body=None):
    raw = body if body is not None else json.dumps(payload).encode("utf-8")
    ts = str(int(time.time())) if ts is None else str(ts)
    from api.services.journal_two import inbound_email
    sig = inbound_email.expected_signature(secret, ts, raw)
    return raw, {"X-UCT-Timestamp": ts, "X-UCT-Signature": sig, "Content-Type": "application/json"}


def _send(client, payload, **kw):
    raw, headers = _signed(payload, **kw)
    return client.post("/api/j2/inbound-email", content=raw, headers=headers)


def _notes(user_id: str) -> list[dict]:
    from api.services.auth_db import get_connection
    c = get_connection()
    try:
        return [dict(r) for r in c.execute(
            "SELECT id, title, folder_id, body_json, body_plain FROM j2_notes WHERE user_id = ?",
            (user_id,)).fetchall()]
    finally:
        c.close()


def _all_note_count() -> int:
    from api.services.auth_db import get_connection
    c = get_connection()
    try:
        return c.execute("SELECT COUNT(*) FROM j2_notes").fetchone()[0]
    finally:
        c.close()


def _png(size=(8, 6)) -> bytes:
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", size, (1, 2, 3)).save(buf, "PNG")
    return buf.getvalue()


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


# ── dark ─────────────────────────────────────────────────────────────────────

class TestDark:
    @pytest.mark.parametrize("value", [None, "", "0", "false", "maybe"])
    def test_gate_off_every_route_is_404_and_nothing_happens(self, app, client, monkeypatch, value):
        from api.services.journal_two import inbound_email
        if value is None:
            monkeypatch.delenv(GATE, raising=False)
        else:
            monkeypatch.setenv(GATE, value)
        monkeypatch.setenv("NOTEBOOK_INBOUND_EMAIL_SECRET", SECRET)
        called = []
        for name in ("ingest", "get_or_create_address", "rotate", "resolve", "verify_signature"):
            monkeypatch.setattr(inbound_email, name, lambda *a, _n=name, **k: called.append(_n))
        _as_member(app, _user())
        r = _send(client, {"to": "notes+" + "a" * 24 + "@uctintelligence.com", "subject": "x"})
        assert r.status_code == 404 and r.json() == {"detail": "Not Found"}
        for method in ("GET", "POST"):
            r = client.request(method, "/api/j2/inbound-email/address")
            assert r.status_code == 404 and r.json() == {"detail": "Not Found"}
        assert called == []

    def test_the_gate_is_read_per_request(self, app, client, monkeypatch):
        monkeypatch.setenv("NOTEBOOK_INBOUND_EMAIL_SECRET", SECRET)
        _as_member(app, _user())
        monkeypatch.delenv(GATE, raising=False)
        assert client.get("/api/j2/inbound-email/address").status_code == 404
        monkeypatch.setenv(GATE, "1")
        assert client.get("/api/j2/inbound-email/address").status_code == 200
        monkeypatch.setenv(GATE, "off")
        assert client.get("/api/j2/inbound-email/address").status_code == 404


# ── the signature ────────────────────────────────────────────────────────────

class TestSignature:
    def _payload(self, user_id):
        return {"to": _address(user_id), "from": "me@example.com", "subject": "Signed",
                "text": "hello", "html": "", "attachments": []}

    def test_a_good_signature_is_accepted(self, client, on):
        uid = _user()
        r = _send(client, self._payload(uid))
        assert r.status_code == 202 and r.json() == {"accepted": True}
        assert [n["title"] for n in _notes(uid)] == ["Signed"]

    @pytest.mark.parametrize("case", [
        "wrong_secret", "stale", "future", "tampered", "replayed_with_fresh_ts",
        "no_signature", "no_timestamp", "not_a_number", "no_server_secret",
    ])
    def test_every_bad_signature_is_a_bare_401_and_writes_nothing(self, client, on, monkeypatch, case):
        from api.services.journal_two import inbound_email
        uid = _user()
        payload = self._payload(uid)
        raw, headers = _signed(payload)
        now = int(time.time())
        if case == "wrong_secret":
            raw, headers = _signed(payload, secret="not-the-secret")
        elif case == "stale":
            raw, headers = _signed(payload, ts=now - inbound_email.REPLAY_WINDOW_SECONDS - 5)
        elif case == "future":
            raw, headers = _signed(payload, ts=now + inbound_email.REPLAY_WINDOW_SECONDS + 5)
        elif case == "tampered":
            raw = raw.replace(b"hello", b"HELLO")
        elif case == "replayed_with_fresh_ts":
            _, old = _signed(payload, ts=now - 3600)
            headers = {**headers, "X-UCT-Signature": old["X-UCT-Signature"]}
        elif case == "no_signature":
            headers.pop("X-UCT-Signature")
        elif case == "no_timestamp":
            headers.pop("X-UCT-Timestamp")
        elif case == "not_a_number":
            headers["X-UCT-Timestamp"] = "12a4"
        elif case == "no_server_secret":
            monkeypatch.delenv("NOTEBOOK_INBOUND_EMAIL_SECRET", raising=False)
        ingested = []
        monkeypatch.setattr(inbound_email, "ingest", lambda p: ingested.append(p))
        before = _all_note_count()
        r = client.post("/api/j2/inbound-email", content=raw, headers=headers)
        assert r.status_code == 401, case
        assert r.content == b"", "a refusal says nothing about which check failed"
        assert ingested == [] and _all_note_count() == before

    def test_an_oversized_body_is_refused_before_it_is_verified(self, client, on, monkeypatch):
        from api.routers import notebook_inbound_email as router_mod
        from api.services.journal_two import inbound_email
        monkeypatch.setattr(router_mod, "MAX_BODY_BYTES", 100)
        seen = []
        monkeypatch.setattr(inbound_email, "verify_signature", lambda *a, **k: seen.append(1) or True)
        r = _send(client, {"to": "x", "text": "y" * 200})
        assert r.status_code == 413 and seen == []


# ── what a signed email becomes ──────────────────────────────────────────────

class TestIngest:
    def test_an_unknown_address_is_accepted_and_dropped(self, client, on, monkeypatch):
        from api.services.journal_two import notes
        created = []
        real = notes.create_note
        monkeypatch.setattr(notes, "create_note", lambda *a, **k: created.append(1) or real(*a, **k))
        before = _all_note_count()
        for to in ["notes+" + "0" * 24 + "@uctintelligence.com",   # well-formed, nobody
                   "notes+nothex@uctintelligence.com",              # malformed
                   "someone@example.com", ""]:
            r = _send(client, {"to": to, "subject": "probe", "text": "x"})
            assert r.status_code == 202 and r.json() == {"accepted": True}, to
        assert created == [] and _all_note_count() == before

    def test_a_rotated_address_drops_and_the_new_one_works(self, client, on):
        from api.services.journal_two import inbound_email
        uid = _user()
        old = _address(uid)
        new = inbound_email.rotate(uid)["address"]
        assert new != old
        assert _send(client, {"to": old, "subject": "old", "text": "x"}).status_code == 202
        assert _send(client, {"to": new, "subject": "new", "text": "x"}).status_code == 202
        assert [n["title"] for n in _notes(uid)] == ["new"]

    def test_an_address_writes_only_into_its_own_members_notebook(self, client, on):
        a, b = _user(), _user()
        _address(b)
        _send(client, {"to": _address(a), "subject": "for A", "text": "x"})
        assert [n["title"] for n in _notes(a)] == ["for A"]
        assert _notes(b) == []

    def test_a_text_email_becomes_a_note_in_the_inbox_folder(self, client, on):
        from api.services.auth_db import get_connection
        uid = _user()
        text = "Earnings recap\n\n- beat on **revenue**\n- guided up"
        _send(client, {"to": f"UCT Notes <{_address(uid).upper()}>", "subject": "  NVDA   Q3 ",
                       "text": text, "html": "<p>ignored when text exists</p>"})
        [n] = _notes(uid)
        assert n["title"] == "NVDA Q3"
        body = json.loads(n["body_json"])
        assert [c["type"] for c in body["content"]] == ["paragraph", "bulletList"]
        assert "ignored" not in n["body_plain"]
        c = get_connection()
        try:
            folder = c.execute("SELECT name, parent_id FROM j2_note_folders WHERE id = ?",
                               (n["folder_id"],)).fetchone()
        finally:
            c.close()
        assert folder["name"] == "Inbox" and not folder["parent_id"]

    def test_an_html_only_email_is_walked_and_its_remote_images_are_never_fetched(
            self, client, on, monkeypatch):
        import socket
        local = {"127.0.0.1", "::1", "localhost"}
        real_connect, real_gai = socket.socket.connect, socket.getaddrinfo

        def _connect(self, address, *a, **k):
            host = address[0] if isinstance(address, tuple) else address
            if host not in local:
                raise AssertionError(f"email-in reached the network: {address!r}")
            return real_connect(self, address, *a, **k)

        def _gai(host, *a, **k):
            if host not in local:
                raise AssertionError(f"email-in resolved a host: {host!r}")
            return real_gai(host, *a, **k)

        monkeypatch.setattr(socket.socket, "connect", _connect)
        monkeypatch.setattr(socket, "getaddrinfo", _gai)
        uid = _user()
        html = ('<h2>Weekly</h2><p>See <b>this</b>:</p>'
                '<img src="https://tracker.example.com/pixel.gif">')
        _send(client, {"to": _address(uid), "subject": "HTML", "text": "", "html": html})
        [n] = _notes(uid)
        body = n["body_json"]
        assert '"image"' not in body and "import-ref://" not in body
        assert "[image: https://tracker.example.com/pixel.gif]" in body
        assert "Weekly" in n["body_plain"]

    def test_no_subject_titles_the_note_by_the_et_day(self, client, on):
        from api.services.journal_two import note_tasks
        uid = _user()
        _send(client, {"to": _address(uid), "subject": "   ", "text": "x"})
        assert [n["title"] for n in _notes(uid)] == [f"Email {note_tasks.today_et()}"]

    def test_attachments_are_saved_linked_and_handed_to_the_document_seam(
            self, client, on, monkeypatch, attachment_root):
        from api.services.journal_two import document_extraction
        seam = []
        monkeypatch.setattr(document_extraction, "on_attachment_saved",
                            lambda uid, nid, att, ct, *, kind: seam.append((nid, att["url"], ct, kind)))
        uid = _user()
        pdf = b"%PDF-1.4\n% minimal\n"
        _send(client, {"to": _address(uid), "subject": "With files", "text": "see attached",
                       "attachments": [
                           {"name": "chart.png", "content_type": "image/png", "base64": _b64(_png())},
                           {"name": "report.pdf", "content_type": "application/pdf", "base64": _b64(pdf)},
                       ]})
        [n] = _notes(uid)
        content = json.loads(n["body_json"])["content"]
        image = next(c for c in content if c["type"] == "image")
        chip = next(c for c in content if c["type"] == "attachmentChip")
        assert "/inline/" in image["attrs"]["src"] and image["attrs"]["alt"] == "chart.png"
        assert chip["attrs"]["name"] == "report.pdf" and chip["attrs"]["size"] == len(pdf)
        assert chip["attrs"]["href"].endswith(".pdf")
        assert [(s[0], s[2], s[3]) for s in seam] == [
            (n["id"], "image/png", "image"), (n["id"], "application/pdf", "file")]
        assert {s[1] for s in seam} == {image["attrs"]["src"], chip["attrs"]["href"]}
        stored = list((attachment_root / "j2_attachments").rglob("*.*"))
        assert len(stored) == 2

    @pytest.mark.parametrize("att,sentence", [
        ({"name": "IMG_1.HEIC", "content_type": "image/heic", "base64": "AAAA"},
         "Attachment not saved: IMG_1.HEIC — HEIC photos aren't accepted. Send it as a JPEG instead."),
        ({"name": "tool.exe", "content_type": "application/x-msdownload", "base64": "AAAA"},
         "Attachment not saved: tool.exe — this kind of file isn't accepted."),
        ({"name": "bad.png", "content_type": "image/png", "base64": "@@not base64@@"},
         "Attachment not saved: bad.png — it could not be read."),
        ({"name": "empty.pdf", "content_type": "application/pdf", "base64": ""},
         "Attachment not saved: empty.pdf — it was empty."),
        ("not even a dict", "Attachment not saved: it could not be read."),
    ])
    def test_a_refused_attachment_is_one_line_never_a_failure(self, client, on, att, sentence):
        uid = _user()
        r = _send(client, {"to": _address(uid), "subject": "s", "text": "body text",
                           "attachments": [att]})
        assert r.status_code == 202
        [n] = _notes(uid)
        assert sentence in n["body_plain"]
        assert "body text" in n["body_plain"]

    def test_an_attachment_past_the_limit_is_refused_before_it_is_decoded(self, client, on, monkeypatch):
        from api.services.journal_two import notes
        monkeypatch.setattr(notes, "_MAX_IMAGE_BYTES", 10)
        uid = _user()
        _send(client, {"to": _address(uid), "subject": "s", "text": "t", "attachments": [
            {"name": "big.png", "content_type": "image/png", "base64": _b64(_png((40, 40)))}]})
        [n] = _notes(uid)
        assert "Attachment not saved: big.png — it is larger than the limit." in n["body_plain"]

    def test_too_many_attachments_are_counted_not_dropped_silently(self, client, on, monkeypatch):
        from api.services.journal_two import inbound_email
        monkeypatch.setattr(inbound_email, "MAX_ATTACHMENTS", 1)
        uid = _user()
        att = {"name": "a.txt", "content_type": "text/plain", "base64": _b64(b"hello")}
        _send(client, {"to": _address(uid), "subject": "s", "text": "t", "attachments": [att, att, att]})
        [n] = _notes(uid)
        assert "2 more attachments were not saved (the limit is 1 per email)." in n["body_plain"]

    @pytest.mark.parametrize("to,expected", [
        ("notes+abcdef0123456789abcdef01@uctintelligence.com", "abcdef0123456789abcdef01"),
        ("Notes <NOTES+ABCDEF0123456789ABCDEF01@UCTINTELLIGENCE.COM>", "abcdef0123456789abcdef01"),
        (["x@y.com", "notes+abcdef0123456789abcdef01@uctintelligence.com"], "abcdef0123456789abcdef01"),
        ("notes+abcdef0123456789abcdef01@evil.example", None),
        ("notes@uctintelligence.com", None),
        (None, None),
    ])
    def test_the_recipient_names_the_token_only_on_our_domain(self, on, to, expected):
        from api.services.journal_two import inbound_email
        assert inbound_email.recipient_token(to) == expected

    def test_the_mail_domain_is_a_setting(self, on, monkeypatch, db_path):
        from api.services.journal_two import inbound_email
        monkeypatch.setenv("NOTEBOOK_INBOUND_EMAIL_DOMAIN", "In.UCTintelligence.com")
        addr = inbound_email.get_or_create_address(_user())["address"]
        assert addr.endswith("@in.uctintelligence.com")
        assert inbound_email.recipient_token(addr) == addr.split("+")[1].split("@")[0]
        assert inbound_email.recipient_token(addr.replace("@in.", "@")) is None


# ── the member's address ─────────────────────────────────────────────────────

class TestAddress:
    def test_get_mints_once_and_post_rotates_per_member(self, app, client, on):
        a, b = _user(), _user()
        _as_member(app, a)
        first = client.get("/api/j2/inbound-email/address").json()
        assert first["address"].startswith("notes+") and first["address"].endswith("@uctintelligence.com")
        assert len(first["address"].split("+")[1].split("@")[0]) == 24
        assert client.get("/api/j2/inbound-email/address").json()["address"] == first["address"]
        rotated = client.post("/api/j2/inbound-email/address").json()
        assert rotated["address"] != first["address"] and rotated["rotatedAt"]
        _as_member(app, b)
        other = client.get("/api/j2/inbound-email/address").json()["address"]
        assert other not in (first["address"], rotated["address"])
        from api.services.journal_two import inbound_email
        tok = rotated["address"].split("+")[1].split("@")[0]
        assert inbound_email.resolve(tok) == a

    def test_the_address_needs_a_paid_plan(self, app, client, on):
        _as_member(app, _user(), paid=False)
        for method in ("GET", "POST"):
            r = client.request(method, "/api/j2/inbound-email/address")
            assert r.status_code == 402
            assert r.json() == {"detail": "Email to Notebook requires a paid plan"}

    def test_account_deletion_takes_the_address_with_it(self, on, db_path):
        from api.services.auth_db import get_connection
        from api.services.journal_two import account_purge, inbound_email
        assert "j2_inbound_addresses" in account_purge._DIRECT_USER_TABLES
        uid = _user()
        tok = _address(uid).split("+")[1].split("@")[0]
        c = get_connection()
        try:
            account_purge.purge_user_data(uid, c)
        finally:
            c.close()
        assert inbound_email.resolve(tok) is None


# ── the worker agrees with the server, byte for byte ─────────────────────────

def _node(script_input: dict) -> dict:
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not on PATH — the worker parity rail cannot run here")
    js = (
        f"import {{ signBody, buildPayload }} from {json.dumps(SIGN_JS.resolve().as_uri())};\n"
        "let data = ''; for await (const c of process.stdin) data += c;\n"
        "const inp = JSON.parse(data);\n"
        "const sig = await signBody(inp.secret, inp.ts, inp.body);\n"
        "const payload = buildPayload(inp.envelope, inp.parsed);\n"
        "process.stdout.write(JSON.stringify({ sig, payload }));\n"
    )
    out = subprocess.run([node, "--input-type=module", "-e", js], input=json.dumps(script_input),
                         capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip(), "node printed nothing -- the parity rail would compare nothing"
    return json.loads(out.stdout)


class TestWorkerParity:
    def test_the_workers_signature_is_the_servers(self):
        from api.services.journal_two import inbound_email
        body = json.dumps({"subject": "Café — 5% ✓", "text": "multi\nline"}, ensure_ascii=False)
        got = _node({"secret": SECRET, "ts": "1760000000", "body": body,
                     "envelope": {}, "parsed": {}})
        assert got["sig"] == inbound_email.expected_signature(SECRET, "1760000000", body.encode("utf-8"))
        assert got["sig"] != inbound_email.expected_signature("other", "1760000000", body.encode("utf-8"))

    def test_the_workers_payload_is_what_the_server_ingests(self, client, on):
        uid = _user()
        parsed = {"subject": "From the worker", "text": "Plain body.", "html": "<p>h</p>",
                  "attachments": [{"filename": "n.txt", "mimeType": "text/plain",
                                   "content": _b64(b"note text")},
                                  {"filename": None, "mimeType": "text/csv", "content": _b64(b"a,b")}]}
        got = _node({"secret": SECRET, "ts": "1", "body": "",
                     "envelope": {"to": _address(uid), "from": "me@example.com"}, "parsed": parsed})
        payload = got["payload"]
        assert payload == {
            "to": _address(uid), "from": "me@example.com", "subject": "From the worker",
            "text": "Plain body.", "html": "<p>h</p>",
            "attachments": [{"name": "n.txt", "content_type": "text/plain", "base64": _b64(b"note text")},
                            {"name": "attachment", "content_type": "text/csv", "base64": _b64(b"a,b")}],
        }
        r = _send(client, payload)
        assert r.status_code == 202
        [n] = _notes(uid)
        assert n["title"] == "From the worker"
        chips = [c for c in json.loads(n["body_json"])["content"] if c["type"] == "attachmentChip"]
        assert [c["attrs"]["name"] for c in chips] == ["n.txt", "attachment"]
