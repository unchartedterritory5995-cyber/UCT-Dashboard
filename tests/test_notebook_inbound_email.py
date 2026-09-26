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
from datetime import datetime
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw

GATE = "NOTEBOOK_INBOUND_EMAIL_ENABLED"
# Tests shard M-4: a subject-less email is titled by THE SERVER'S ET DAY, so the
# rail pins the clock the server reads it from (`note_tasks._now`). A day far
# from today, one second before its own midnight.
PINNED_ET_DAY = "2031-03-14"
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
def pinned_clock(monkeypatch):
    """`note_tasks._now` is the module clock the server's ET day is read from
    (looked up at call time), pinned one second before PINNED_ET_DAY's midnight."""
    from api.services.journal_two import note_tasks
    from api.services.journal_two.timeutil import ET
    monkeypatch.setattr(note_tasks, "_now", lambda: datetime(2031, 3, 14, 23, 59, 59, tzinfo=ET))


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


from api.services.journal_two import inbound_email as _inbound_email_module  # noqa: E402

_REAL_PLAN_CHECK = _inbound_email_module._member_can_receive


@pytest.fixture(autouse=True)
def _members_are_paid(monkeypatch):
    """These rails use made-up user ids with no `users` row, so the M-12 plan
    re-check would drop every email. It is answered "paid" here; the
    `real_plan_check` fixture below puts the real one back for the rails that
    are ABOUT it (they use real user rows and a real subscription)."""
    monkeypatch.setattr(_inbound_email_module, "_member_can_receive", lambda user_id: True)


@pytest.fixture
def real_plan_check(monkeypatch):
    monkeypatch.setattr(_inbound_email_module, "_member_can_receive", _REAL_PLAN_CHECK)
    monkeypatch.setenv("J2_TRIAL_ENABLED", "0")    # the plan alone decides


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
        for name in ("ingest", "get_or_create_address", "get_address", "rotate", "resolve",
                     "verify_signature", "claim_delivery"):
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

    def test_no_subject_titles_the_note_by_the_et_day(self, client, on, pinned_clock):
        uid = _user()
        _send(client, {"to": _address(uid), "subject": "   ", "text": "x"})
        assert [n["title"] for n in _notes(uid)] == [f"Email {PINNED_ET_DAY}"]

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
    def test_get_NEVER_mints_and_post_creates_or_rotates_per_member(self, app, client, on):
        """Backend review M-10 / frontend M-1: the GET used to MINT on first ask,
        and the Settings card GETs on mount -- so every paid member who merely
        opened Settings got a live `notes+<token>@` address (a write capability)
        they never asked for, from a GET with a side effect. The contract now:
        GET answers `{"address": null}` until one exists and never mints; POST
        creates the address the first time and rotates it after that. The card
        shows a "Create my address" button against exactly this."""
        from api.services.journal_two import inbound_email
        url = "/api/j2/inbound-email/address"
        a, b = _user(), _user()
        _as_member(app, a)
        assert client.get(url).json() == {"address": None}
        assert client.get(url).json() == {"address": None}, "a second view minted"
        assert inbound_email.get_address(a) is None, "a GET left an address behind"
        created = client.post(url).json()
        assert created["address"].startswith("notes+") and created["address"].endswith("@uctintelligence.com")
        assert len(created["address"].split("+")[1].split("@")[0]) == 24
        assert client.get(url).json()["address"] == created["address"]
        rotated = client.post(url).json()
        assert rotated["address"] != created["address"] and rotated["rotatedAt"]
        assert client.get(url).json()["address"] == rotated["address"]
        _as_member(app, b)
        assert client.get(url).json() == {"address": None}, "one member's address answered another's"
        other = client.post(url).json()["address"]
        assert other not in (created["address"], rotated["address"])
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


# ── fix round 1 · I-1: per-address AND per-member limits ─────────────────────

def _drops(uid):
    from api.services.journal_two import inbound_email
    return [(d["reason"], d["count"]) for d in inbound_email.drops(uid)]


class TestLimits:
    def test_over_the_address_rate_the_mail_is_dropped_with_the_same_202_and_recorded(
            self, client, on, monkeypatch):
        from api.services.journal_two import inbound_email
        monkeypatch.setattr(inbound_email, "ADDRESS_MAX_MESSAGES_PER_HOUR", 2)
        uid = _user()
        answers = [_send(client, {"to": _address(uid), "subject": f"m{i}", "text": "x"})
                   for i in range(3)]
        # ⛔ NO ORACLE: the dropped one is answered exactly like the two kept
        assert {(r.status_code, r.content) for r in answers} == {(202, b'{"accepted":true}')}
        assert sorted(n["title"] for n in _notes(uid)) == ["m0", "m1"]
        assert _drops(uid) == [(inbound_email.DROP_ADDRESS_RATE, 1)]

    def test_rotating_the_address_does_not_reset_the_members_limit(self, client, on, monkeypatch):
        """The address limit resets with a new address -- that is the point of
        rotating after a leak. The MEMBER limit does not, or rotation would
        multiply the allowance."""
        from api.services.journal_two import inbound_email
        monkeypatch.setattr(inbound_email, "ADDRESS_MAX_MESSAGES_PER_HOUR", 2)
        monkeypatch.setattr(inbound_email, "MEMBER_MAX_MESSAGES_PER_HOUR", 3)
        uid = _user()
        first = _address(uid)
        for i in range(2):
            _send(client, {"to": first, "subject": f"a{i}", "text": "x"})
        second = inbound_email.rotate(uid)["address"]
        for i in range(2):
            _send(client, {"to": second, "subject": f"b{i}", "text": "x"})
        assert sorted(n["title"] for n in _notes(uid)) == ["a0", "a1", "b0"]
        assert _drops(uid) == [(inbound_email.DROP_MEMBER_RATE, 1)]

    def test_volume_is_counted_in_bytes_of_the_signed_body(self, client, on, monkeypatch):
        from api.services.journal_two import inbound_email
        uid = _user()
        big = {"to": _address(uid), "subject": "big0", "text": "y" * 5_000}
        size = len(_signed(big)[0])                 # every "bigN" below is this long
        monkeypatch.setattr(inbound_email, "ADDRESS_MAX_BYTES_PER_DAY", size * 2)
        for i in range(3):
            _send(client, {**big, "subject": f"big{i}"})
        assert sorted(n["title"] for n in _notes(uid)) == ["big0", "big1"]
        assert _drops(uid) == [(inbound_email.DROP_ADDRESS_VOLUME, 1)]

    def test_the_windows_are_an_hour_for_rate_and_a_day_for_volume(self, db_path, monkeypatch):
        from api.services.journal_two import inbound_email as ie
        monkeypatch.setattr(ie, "ADDRESS_MAX_MESSAGES_PER_HOUR", 1)
        monkeypatch.setattr(ie, "ADDRESS_MAX_BYTES_PER_DAY", 100)
        uid, tok = _user(), "a" * 24
        t0 = 1_760_000_000.0
        assert ie.admit(uid, tok, 10, now=t0) is None
        assert ie.admit(uid, tok, 10, now=t0 + 3599) == ie.DROP_ADDRESS_RATE
        assert ie.admit(uid, tok, 85, now=t0 + 3601) is None       # a new hour; 95 bytes today
        assert ie.admit(uid, tok, 10, now=t0 + 7300) == ie.DROP_ADDRESS_VOLUME
        # ⛔ a DROPPED email is not counted, or a flood would keep its own window full
        assert ie.admit(uid, tok, 5, now=t0 + 7300) is None        # 100 bytes: exactly the cap
        assert ie.admit(uid, tok, 1, now=t0 + 86_400 + 3602) is None  # yesterday has aged out

    def test_simultaneous_emails_cannot_both_take_the_last_slot(self, db_path, monkeypatch):
        """`admit` reads the window and writes the charge in ONE `BEGIN
        IMMEDIATE`, so six emails racing for one slot get exactly one.

        ⛔ THE INTERLEAVING IS FORCED, NOT HOPED FOR: every write of a charge is
        held for 150 ms. Inside one transaction the other racers are waiting on
        the lock for those 150 ms; with the read and the write split apart they
        read the window during it and every one of them is admitted. (Unforced,
        that window is microseconds wide and the split passes -- measured.)"""
        import threading
        import time as _time
        from api.services import auth_db
        from api.services.journal_two import inbound_email as ie
        monkeypatch.setattr(ie, "ADDRESS_MAX_MESSAGES_PER_HOUR", 1)
        uid, tok = _user(), "b" * 24
        real_connect = auth_db.get_connection

        class SlowCharge:
            def __init__(self, conn):
                self._c = conn

            def execute(self, sql, *args):
                if sql.startswith("INSERT INTO j2_inbound_usage"):
                    _time.sleep(0.15)
                return self._c.execute(sql, *args)

            def __getattr__(self, name):
                return getattr(self._c, name)

        monkeypatch.setattr(ie, "get_connection", lambda: SlowCharge(real_connect()))
        gate = threading.Barrier(6)
        results, errors = [], []

        def race():
            gate.wait()
            try:
                results.append(ie.admit(uid, tok, 1))
            except Exception as e:  # noqa: BLE001
                errors.append(repr(e))

        threads = [threading.Thread(target=race) for _ in range(6)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
        assert errors == []
        assert results.count(None) == 1 and len(results) == 6, results

    def test_the_limits_are_charged_before_anything_is_parsed(self, client, on, monkeypatch):
        from api.services.journal_two import inbound_email
        monkeypatch.setattr(inbound_email, "ADDRESS_MAX_MESSAGES_PER_HOUR", 0)
        parsed = []
        monkeypatch.setattr(inbound_email, "_body_nodes", lambda *a: parsed.append(1) or [])
        uid = _user()
        assert _send(client, {"to": _address(uid), "text": "x"}).status_code == 202
        assert parsed == [] and _notes(uid) == []


# ── whole-branch fix · M-6: a replayed signed request is dropped ──────────────

def _usage_count(uid):
    from api.services.auth_db import get_connection
    c = get_connection()
    try:
        return c.execute("SELECT COUNT(*) FROM j2_inbound_usage WHERE user_id = ?", (uid,)).fetchone()[0]
    finally:
        c.close()


class TestReplay:
    """⚰️ Backend review M-6. A captured signed request verifies for its whole
    five-minute window, so it could be REPLAYED up to the address's 20/hour --
    each replay passed `admit()` and spent the address's rolling allowance, so
    the member's genuine mail was then silently dropped (`address_rate`) for up
    to an hour, as well as the note being duplicated 20 times. The docs said a
    replay "would make a second copy of the note". Now each signature is
    delivered ONCE: the second arrival is answered like any other (202, no
    oracle) and makes nothing, and the record is durable (auth.db), pruned with
    the window."""

    def test_a_REPLAYED_request_is_answered_the_same_and_makes_nothing(self, client, on):
        uid = _user()
        raw, headers = _signed({"to": _address(uid), "subject": "once", "text": "x"})
        first = client.post("/api/j2/inbound-email", content=raw, headers=headers)
        replays = [client.post("/api/j2/inbound-email", content=raw, headers=headers) for _ in range(3)]
        assert {(r.status_code, r.content) for r in [first, *replays]} == {(202, b'{"accepted":true}')}
        assert [n["title"] for n in _notes(uid)] == ["once"]
        assert _usage_count(uid) == 1, "a replay was charged against the allowance"

    def test_a_replay_cannot_burn_the_hourly_allowance(self, client, on, monkeypatch):
        from api.services.journal_two import inbound_email
        monkeypatch.setattr(inbound_email, "ADDRESS_MAX_MESSAGES_PER_HOUR", 2)
        uid = _user()
        raw, headers = _signed({"to": _address(uid), "subject": "captured", "text": "x"})
        for _ in range(5):
            client.post("/api/j2/inbound-email", content=raw, headers=headers)
        assert _send(client, {"to": _address(uid), "subject": "genuine", "text": "y"}).status_code == 202
        assert sorted(n["title"] for n in _notes(uid)) == ["captured", "genuine"]
        assert _drops(uid) == [], "genuine mail was dropped after a replay burst"

    def test_CONTROL_two_different_emails_signed_in_the_same_second_both_land(self, client, on):
        uid = _user()
        ts = int(time.time())
        _send(client, {"to": _address(uid), "subject": "first", "text": "x"}, ts=ts)
        _send(client, {"to": _address(uid), "subject": "second", "text": "x"}, ts=ts)
        assert sorted(n["title"] for n in _notes(uid)) == ["first", "second"]

    def test_the_record_is_DURABLE_and_pruned_with_the_window(self, db_path):
        from api.services.auth_db import get_connection
        from api.services.journal_two import inbound_email as ie
        t0 = 1_760_000_000
        assert ie.claim_delivery("a" * 64, str(t0), now=t0) is True
        assert ie.claim_delivery("A" * 64, str(t0), now=t0 + 10) is False     # the same signature
        # still inside the window from the other side: still refused
        assert ie.claim_delivery("a" * 64, str(t0), now=t0 + ie.REPLAY_WINDOW_SECONDS) is False
        # a later claim prunes every record whose signature can no longer verify
        assert ie.claim_delivery("b" * 64, str(t0 + 900), now=t0 + 900) is True
        c = get_connection()
        try:
            rows = c.execute("SELECT COUNT(*) FROM j2_inbound_seen").fetchone()[0]
        finally:
            c.close()
        assert rows == 1, "the record outlived the window it guards"

    def test_a_bad_signature_is_never_recorded(self, client, on, monkeypatch):
        from api.services.journal_two import inbound_email
        claimed = []
        monkeypatch.setattr(inbound_email, "claim_delivery", lambda *a, **k: claimed.append(a) or True)
        raw, headers = _signed({"to": "x", "text": "y"}, secret="not-the-secret")
        assert client.post("/api/j2/inbound-email", content=raw, headers=headers).status_code == 401
        assert claimed == []

    # ── backend re-review N2: the window's last second ───────────────────────

    def test_a_replay_verified_at_the_windows_EDGE_is_refused_however_late_its_claim(self, db_path):
        """The re-reviewer's probe. A replay verifies at T+300 (the window's last
        second) and its claim starts later -- a large body's parse, a busy pool.
        ⚰️ The record expired at T+301, so a claim at T+301.5 found it pruned
        and DELIVERED the replay. The record now outlives the window by a real
        margin, so a request that verified can never be claimed after it."""
        from api.services.journal_two import inbound_email as ie
        t0 = 1_760_000_000
        raw = json.dumps({"to": "x", "text": "edge"}).encode("utf-8")
        sig = ie.expected_signature(SECRET, str(t0), raw)
        assert ie.claim_delivery(sig, str(t0), now=t0 + 5) is True          # the delivery
        edge = t0 + ie.REPLAY_WINDOW_SECONDS
        assert ie.verify_signature(SECRET, str(t0), sig, raw, now=edge)     # the replay verifies
        for late in (1.5, 5, 60):
            assert ie.claim_delivery(sig, str(t0), now=edge + late) is False, (
                f"a replay that verified was delivered by a claim {late}s after the window")

    def test_the_claim_is_judged_at_the_instant_the_request_VERIFIED(self, client, on, monkeypatch):
        """The router reads the clock ONCE per request, and the claim is judged
        at that instant, however long the body takes to parse. The clock here
        jumps far past any margin DURING the parse: a claim that read its own
        clock would find the record pruned and deliver the replay."""
        from api.routers import notebook_inbound_email as door
        from api.services.journal_two import inbound_email as ie
        uid = _user()
        t0 = int(time.time())
        raw, headers = _signed({"to": _address(uid), "subject": "edge", "text": "x"}, ts=t0)
        assert client.post("/api/j2/inbound-email", content=raw, headers=headers).status_code == 202

        class Clock:
            def __init__(self, t):
                self.t = float(t)

            def time(self):
                return self.t

            def __getattr__(self, name):
                return getattr(time, name)

        clock = Clock(t0 + ie.REPLAY_WINDOW_SECONDS)       # the replay verifies at the edge

        class SlowParse:
            def loads(self, s, *a, **k):
                clock.t += 10 * ie.REPLAY_WINDOW_SECONDS  # ...and the parse outlasts any margin
                return json.loads(s, *a, **k)

            def __getattr__(self, name):
                return getattr(json, name)

        monkeypatch.setattr(ie, "time", clock)
        monkeypatch.setattr(door, "time", clock, raising=False)
        monkeypatch.setattr(door, "json", SlowParse())
        replay = client.post("/api/j2/inbound-email", content=raw, headers=headers)
        assert (replay.status_code, replay.content) == (202, b'{"accepted":true}')
        assert clock.t > t0 + 2 * ie.REPLAY_WINDOW_SECONDS, "non-vacuity: the parse never moved the clock"
        assert [n["title"] for n in _notes(uid)] == ["edge"], "the replay was delivered"
        assert _usage_count(uid) == 1


# ── ruling D-H12: the body parse never runs on the event loop ────────────────

def test_the_body_PARSE_never_stalls_the_loop(app, on, monkeypatch):
    """Ruling D-H12. The web pod has ONE event loop for every member, and a
    signed body may be up to MAX_BODY_BYTES (~34 MB): `json.loads` of that ON
    the loop stalls everyone. The parse is stubbed to take 0.6 s (standing for a
    large body's real parse) while an unrelated 10 ms heartbeat runs on the same
    loop: it must never pause 0.25 s or more, and the email must still land."""
    import asyncio

    import httpx

    from api.routers import notebook_inbound_email as door
    uid = _user()
    raw, headers = _signed({"to": _address(uid), "subject": "big", "text": "x"})
    took: list[float] = []

    class SlowParse:
        def loads(self, s, *a, **k):
            t = time.perf_counter()
            time.sleep(0.6)
            out = json.loads(s, *a, **k)
            took.append(time.perf_counter() - t)
            return out

        def __getattr__(self, name):
            return getattr(json, name)

    monkeypatch.setattr(door, "json", SlowParse())

    async def run():
        loop = asyncio.get_running_loop()
        gaps, done = [], asyncio.Event()

        async def unrelated_request():
            last = loop.time()
            while not done.is_set():
                await asyncio.sleep(0.01)
                now = loop.time()
                gaps.append(now - last)
                last = now

        beat = asyncio.create_task(unrelated_request())
        await asyncio.sleep(0.05)                      # the other request is already beating
        try:
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://door") as c:
                r = await c.post("/api/j2/inbound-email", content=raw, headers=headers)
        finally:
            done.set()
            await beat
        return r, gaps

    r, gaps = asyncio.run(run())
    assert (r.status_code, r.content) == (202, b'{"accepted":true}')
    assert max(gaps) < 0.25, (
        f"the loop stalled {max(gaps):.3f}s for every member while a body was parsed")
    assert took and took[0] >= 0.5, "non-vacuity: the parse never took long enough to matter"
    assert [n["title"] for n in _notes(uid)] == ["big"]


# ── fix round 1 · M-12: a lapsed plan stops the address making notes ─────────

class TestPlanRecheck:
    def _member(self, email):
        from api.services import auth_service
        return auth_service.create_user(email, "a-password-1234")["id"]

    def test_mail_to_a_lapsed_members_address_is_dropped_and_recorded(
            self, client, on, real_plan_check):
        from api.services import auth_service
        from api.services.journal_two import inbound_email
        email = f"m12-{uuid.uuid4().hex[:8]}@example.com"
        uid = self._member(email)
        to = _address(uid)
        r = _send(client, {"to": to, "subject": "while free", "text": "x"})
        assert r.status_code == 202 and r.json() == {"accepted": True}
        assert _notes(uid) == []
        assert _drops(uid) == [(inbound_email.DROP_NOT_PAID, 1)]
        # control: the same member, now on a paid plan, gets the note
        auth_service.comp_user_access(email, True)
        _send(client, {"to": to, "subject": "while paid", "text": "x"})
        assert [n["title"] for n in _notes(uid)] == ["while paid"]


# ── fix round 1 · M-2: hostile header bytes are a 401, never a 500 ───────────

class TestHostileHeaders:
    @pytest.mark.parametrize("ts,sig", [
        (b"\xb2", None),                   # latin-1 '²' passes isdigit(), breaks int()
        (b"9" * 5000, None),               # past int()'s digit limit
        (None, b"\xe9" * 64),              # a non-ASCII signature
    ])
    def test_every_hostile_header_is_a_bare_401(self, on, db_path, ts, sig):
        """Driven with the RAW header bytes. ⚰️ Through the test client these
        rows were vacuous: it re-encodes a header value as UTF-8, so the pod
        received `Â²` (which already fails `isdigit()`) instead of `²`."""
        from api.routers import notebook_inbound_email as router_mod
        payload = {"to": _address(_user()), "text": "x"}
        raw, headers = _signed(payload)
        headers = {k: v.encode("ascii") for k, v in headers.items()}
        if ts is not None:
            headers["X-UCT-Timestamp"] = ts
        if sig is not None:
            headers["X-UCT-Signature"] = sig
        resp, _reads = _drive(router_mod.receive_email, headers=headers, chunks=[raw])
        assert resp.status_code == 401 and resp.body == b""

    def test_the_verifier_itself_never_raises(self):
        from api.services.journal_two import inbound_email as ie
        for ts, sig in [("²", "a" * 64), ("9" * 5000, "a" * 64), ("1760000000", "é" * 64),
                        (" 1760000000", "a" * 64), ("1760000000", "")]:
            assert ie.verify_signature(SECRET, ts, sig, b"{}", now=1760000000) is False


# ── fix round 1 · M-3: the cap limits BUFFERING, not only parsing ────────────

def _drive(handler, *, headers, chunks):
    """Call the door directly with a request whose body arrives in `chunks`,
    counting how many of them the door actually READ."""
    import asyncio
    from starlette.requests import Request
    sent = []

    async def receive():
        i = len(sent)
        sent.append(1)
        if i < len(chunks):
            return {"type": "http.request", "body": chunks[i], "more_body": i + 1 < len(chunks)}
        return {"type": "http.disconnect"}

    scope = {"type": "http", "method": "POST", "path": "/api/j2/inbound-email",
             "headers": [(k.lower().encode(), v if isinstance(v, bytes) else v.encode())
                         for k, v in headers.items()],
             "query_string": b""}
    resp = asyncio.run(handler(Request(scope, receive)))
    return resp, len(sent)


class TestBodyCap:
    def test_a_declared_length_past_the_cap_is_refused_before_a_byte_is_read(
            self, on, db_path, monkeypatch):
        from api.routers import notebook_inbound_email as router_mod
        monkeypatch.setattr(router_mod, "MAX_BODY_BYTES", 10_000)
        resp, reads = _drive(router_mod.receive_email,
                             headers={"content-length": "10001"}, chunks=[b"x" * 1000] * 11)
        assert resp.status_code == 413 and reads == 0

    def test_an_undeclared_stream_is_abandoned_as_soon_as_it_passes_the_cap(
            self, on, db_path, monkeypatch):
        from api.routers import notebook_inbound_email as router_mod
        monkeypatch.setattr(router_mod, "MAX_BODY_BYTES", 10_000)
        resp, reads = _drive(router_mod.receive_email, headers={}, chunks=[b"x" * 1000] * 100)
        assert resp.status_code == 413
        assert reads == 11, f"read {reads} chunks of 100 -- the body was buffered past the cap"


# ── fix round 1 · M-4: a body the converter cannot handle is still a note ────

class TestBodyFallback:
    def test_two_thousand_nested_divs_become_a_note_not_a_bounce(self, client, on):
        from api.services.journal_two import inbound_email
        uid = _user()
        html = "<div>" * 2000 + "deeply buried words" + "</div>" * 2000
        r = _send(client, {"to": _address(uid), "subject": "nested", "html": html})
        assert r.status_code == 202
        [n] = _notes(uid)
        assert "deeply buried words" in n["body_plain"]
        assert inbound_email.FALLBACK_SENTENCE in n["body_plain"]


# ── fix round 1 · M-5: hostile HTML shapes never reach a member's note ───────

class TestHostileHtml:
    def _body(self, client, html):
        uid = _user()
        assert _send(client, {"to": _address(uid), "subject": "h", "html": html}).status_code == 202
        [n] = _notes(uid)
        return n["body_json"]

    def test_a_script_shaped_link_keeps_its_words_and_loses_its_href(self, client, on):
        body = self._body(client, '<p><a href="java&#9;script:alert(document.domain)">'
                                  'click me</a> and <a href="https://example.com/x">safe</a></p>')
        assert "click me" in body and "script:" not in body
        assert "https://example.com/x" in body, "control: an allowed link survives"

    def test_an_import_attachment_placeholder_becomes_a_line_of_text(self, client, on):
        body = self._body(client, '<p><a href="import-attachment-ref://report.pdf">report</a></p>')
        assert "attachmentChip" not in body and "import-ref://" not in body
        assert "[attachment: report.pdf]" in body


# ── fix round 1 · M-6: attachments are appended to what the note holds NOW ───

class TestAttachmentLinking:
    def test_an_edit_made_while_attachments_save_is_kept_and_they_are_still_linked(
            self, client, on, monkeypatch):
        """The member edits the brand-new note while its attachments are being
        saved. ⚰️ The old compare-and-set lost the race: the attachments were
        saved and never linked, and nothing in the note said so."""
        from api.services.journal_two import inbound_email, notes
        real_save = inbound_email._save_attachment

        def save_then_member_edits(user_id, note_id, att):
            out = real_save(user_id, note_id, att)
            note = notes.get_note(user_id, note_id)
            notes.update_note(user_id, note_id, {"bodyJson": {"type": "doc", "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": "member edit"}]}]}},
                expected_updated_at=note["updatedAt"])
            return out

        monkeypatch.setattr(inbound_email, "_save_attachment", save_then_member_edits)
        uid = _user()
        _send(client, {"to": _address(uid), "subject": "race", "text": "original",
                       "attachments": [{"name": "n.txt", "content_type": "text/plain",
                                        "base64": _b64(b"hello")}]})
        [n] = _notes(uid)
        body = json.loads(n["body_json"])["content"]
        assert "member edit" in json.dumps(body), "the member's edit was overwritten"
        assert [c["attrs"]["name"] for c in body if c["type"] == "attachmentChip"] == ["n.txt"]


    def test_a_note_LOCKED_while_its_attachments_save_is_not_touched(self, client, on, monkeypatch, caplog):
        """Whole-branch tests shard I-1, second half: email-in's attachment link
        is the third door through `append_nodes`, and it CAN reach a locked
        note -- the member locks the brand-new note in the milliseconds its
        attachments take to save. The link is refused (423) like the personal
        API's appends: the note is left exactly as locked, the email is still
        answered 202, and the refusal is one log line naming the status. The
        files stay saved (the same stance as the deleted-note case)."""
        import logging
        from api.services.journal_two import inbound_email, notes
        real_save = inbound_email._save_attachment

        def save_then_member_locks(user_id, note_id, att):
            out = real_save(user_id, note_id, att)
            notes.update_note(user_id, note_id, {"locked": True})
            return out

        monkeypatch.setattr(inbound_email, "_save_attachment", save_then_member_locks)
        caplog.set_level(logging.WARNING, logger=inbound_email.log.name)
        uid = _user()
        r = _send(client, {"to": _address(uid), "subject": "locked", "text": "original",
                           "attachments": [{"name": "n.txt", "content_type": "text/plain",
                                            "base64": _b64(b"hello")}]})
        assert r.status_code == 202 and r.json() == {"accepted": True}
        [n] = _notes(uid)
        body = json.loads(n["body_json"])["content"]
        assert not any(c["type"] == "attachmentChip" for c in body), "a locked note was appended to"
        assert "original" in n["body_plain"]
        assert notes.get_note(uid, n["id"])["locked"] is True
        lines = [rec.getMessage() for rec in caplog.records if "attachments not linked" in rec.getMessage()]
        assert len(lines) == 1 and "423" in lines[0]


# ── the worker agrees with the server, byte for byte ─────────────────────────

def _node(script_input: dict) -> dict:
    node = shutil.which("node")
    if node is None:
        # ⛔ A HARD FAILURE, NOT A SKIP (fix round 1, M-11). This rail is the
        # only proof the worker signs exactly the bytes the server verifies;
        # skipped, it reads as coverage it never gave. CI installs node for
        # every pytest shard (.github/workflows/full-suite-report.yml), and
        # tests/test_ast_interpret.py fails the same way for the same reason.
        pytest.fail("node is not on PATH -- the worker parity rail cannot run, "
                    "and a skipped parity rail is how it rots")
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
