"""Wave 7 lane G (G1) — the member's personal API (`/api/j2/personal`).

The rails, in the order the brief names them:

  * DARK: gate off -> every route 404 with FastAPI's own unknown-route body,
    and NOTHING is read or written (the service functions are spied).
  * TWO TOKEN KINDS, ONE CHECK: a personal token is refused at the Browser
    Capture routes and a capture token is refused here — by scope, 403.
  * TENANT SCOPING: member B's token can never append to member A's note, and
    the Browser Capture card never lists a personal token.
  * LOCKED -> 423, body untouched, `updated_at` unchanged.
  * THE DAILY DOOR: the SERVER's ET day, and exactly one daily note per member
    per day under two concurrent appends on a fresh day.
  * 30 requests a minute per token, then a 429 sentence.
  * Every refusal is `{"detail": "<a sentence>"}`.
"""
from __future__ import annotations

import importlib
import json
import os
import sqlite3
import tempfile
import threading
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw

GATE = "NOTEBOOK_PERSONAL_API_ENABLED"


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


@pytest.fixture(autouse=True)
def _fresh_rate_limit():
    from api.limiter import limiter
    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture
def gate_on(monkeypatch):
    monkeypatch.setenv(GATE, "1")


@pytest.fixture
def app(db_path):
    from api.routers import capture_auth as capture_router
    from api.routers import notebook_personal_api
    fa = FastAPI()
    fa.include_router(notebook_personal_api.router)
    fa.include_router(capture_router.router)
    yield fa
    fa.dependency_overrides.clear()


@pytest.fixture
def client(app):
    return TestClient(app)


def _as_member(app, user_id, *, paid=True):
    """A signed-in browser: both the plain and the plan-carrying dependency."""
    user = {"id": user_id, "role": "member", "plan": "pro" if paid else "free"}
    app.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)


def _signed_out(app):
    app.dependency_overrides.pop(authmw.get_current_user, None)
    app.dependency_overrides.pop(authmw.get_current_user_with_plan, None)


def _user() -> str:
    return "u-" + uuid.uuid4().hex[:10]


def _mint(user_id: str) -> str:
    from api.services.journal_two import capture_auth
    return capture_auth.mint_personal_token(user_id, "My iPhone")["token"]


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _note(user_id: str, title="Ideas", body=None) -> dict:
    from api.services.journal_two import notes
    return notes.create_note(user_id, {"title": title, "bodyJson": body or {"type": "doc", "content": []}})


def _row(note_id: str) -> sqlite3.Row:
    from api.services.auth_db import get_connection
    c = get_connection()
    try:
        return c.execute("SELECT * FROM j2_notes WHERE id = ?", (note_id,)).fetchone()
    finally:
        c.close()


def _body_text(note_id: str) -> str:
    return _row(note_id)["body_plain"] or ""


# ── dark ─────────────────────────────────────────────────────────────────────

ROUTES = [
    ("POST", "/api/j2/personal/tokens", {"label": "x"}),
    ("GET", "/api/j2/personal/tokens", None),
    ("DELETE", "/api/j2/personal/tokens/abc", None),
    ("POST", "/api/j2/personal/notes", {"title": "t", "markdown": "m"}),
    ("POST", "/api/j2/personal/notes/n1/append", {"markdown": "m"}),
    ("POST", "/api/j2/personal/daily/append", {"markdown": "m"}),
]


class TestDark:
    @pytest.mark.parametrize("value", [None, "", "0", "false", "maybe"])
    def test_gate_off_every_route_is_404_and_nothing_is_read_or_written(
            self, app, client, monkeypatch, value):
        from api.services.journal_two import capture_auth
        from api.services.journal_two import note_personal_api as papi
        if value is None:
            monkeypatch.delenv(GATE, raising=False)
        else:
            monkeypatch.setenv(GATE, value)
        called = []
        for mod, name in [(capture_auth, "mint_personal_token"), (capture_auth, "resolve_token"),
                          (capture_auth, "list_connections"), (capture_auth, "revoke_connection"),
                          (papi, "create_note_from_markdown"), (papi, "append_markdown"),
                          (papi, "append_to_daily")]:
            monkeypatch.setattr(mod, name, lambda *a, _n=name, **k: called.append(_n))
        uid = _user()
        _as_member(app, uid)          # even a paid, signed-in member
        for method, path, body in ROUTES:
            r = client.request(method, path, json=body, headers=_bearer("uctpat_x"))
            assert r.status_code == 404, (method, path, r.status_code, r.text)
            assert r.json() == {"detail": "Not Found"}, "must look like no route at all"
        assert called == []

    def test_the_gate_is_read_per_request(self, app, client, monkeypatch):
        uid = _user()
        _as_member(app, uid)
        monkeypatch.delenv(GATE, raising=False)
        assert client.get("/api/j2/personal/tokens").status_code == 404
        monkeypatch.setenv(GATE, "1")
        assert client.get("/api/j2/personal/tokens").status_code == 200
        monkeypatch.setenv(GATE, "0")
        assert client.get("/api/j2/personal/tokens").status_code == 404

    def test_a_malformed_body_while_dark_is_still_404(self, app, client, monkeypatch):
        """⛔ Fix round 1, M-1. A body PARAMETER is parsed before the router's
        gate runs, so `POST /tokens` with `{` answered 422 while dark -- a
        route that does not exist never answers 422. Every POST is sent a
        malformed body here, not only valid JSON."""
        monkeypatch.delenv(GATE, raising=False)
        _as_member(app, _user())
        for method, path, _body in ROUTES:
            if method != "POST":
                continue
            r = client.post(path, content=b"{", headers={**_bearer("uctpat_x"),
                                                        "Content-Type": "application/json"})
            assert r.status_code == 404 and r.json() == {"detail": "Not Found"}, (path, r.text)

    def test_lit_a_malformed_mint_body_is_a_sentence_not_a_422(self, app, client, gate_on):
        from api.routers import notebook_personal_api as router_mod
        _as_member(app, _user())
        r = client.post("/api/j2/personal/tokens", content=b"{",
                        headers={"Content-Type": "application/json"})
        assert r.status_code == 400 and r.json() == {"detail": router_mod.BAD_JSON_SENTENCE}
        ok = client.post("/api/j2/personal/tokens", json={"label": "Phone"})
        assert ok.status_code == 200 and ok.json()["label"] == "Phone"


# ── tokens ───────────────────────────────────────────────────────────────────

class TestTokens:
    def test_a_paid_member_mints_a_token_shown_once_and_never_listed(self, app, client, gate_on):
        from api.services.journal_two import capture_auth
        uid = _user()
        _as_member(app, uid)
        r = client.post("/api/j2/personal/tokens", json={"label": "  Shortcuts   on iPhone "})
        assert r.status_code == 200, r.text
        minted = r.json()
        assert minted["token"].startswith("uctpat_")
        assert minted["label"] == "Shortcuts on iPhone"
        assert minted["scopes"] == [capture_auth.SCOPE_NOTES_CREATE, capture_auth.SCOPE_NOTES_APPEND]
        expires = datetime.fromisoformat(minted["expiresAt"])
        assert timedelta(days=364) < expires - datetime.now(timezone.utc) <= timedelta(days=365)
        listed = client.get("/api/j2/personal/tokens")
        assert listed.status_code == 200
        [row] = listed.json()["tokens"]
        assert row["id"] == minted["tokenId"] and row["clientType"] == "personal_api"
        assert minted["token"] not in listed.text, "the bearer is never listed again"

    def test_minting_needs_a_paid_plan_but_listing_and_revoking_do_not(self, app, client, gate_on):
        uid = _user()
        token = _mint(uid)
        _as_member(app, uid, paid=False)
        r = client.post("/api/j2/personal/tokens", json={})
        assert r.status_code == 402 and r.json()["detail"] == "Personal API tokens require a paid plan"
        # a lapsed member can still SEE and KILL a year-long bearer
        [row] = client.get("/api/j2/personal/tokens").json()["tokens"]
        assert client.delete(f"/api/j2/personal/tokens/{row['id']}").json() == {"revoked": True}
        _signed_out(app)
        r = client.post("/api/j2/personal/notes", json={"title": "x"}, headers=_bearer(token))
        assert r.status_code == 401

    def test_token_management_is_session_only(self, app, client, gate_on):
        uid = _user()
        token = _mint(uid)
        _signed_out(app)
        for method, path, body in ROUTES[:3]:
            r = client.request(method, path, json=body, headers=_bearer(token))
            assert r.status_code == 401, (method, path, r.status_code)

    def test_the_browser_capture_card_never_lists_a_personal_token(self, app, client, gate_on):
        """⛔ `list_connections` defaults to everything BUT personal tokens, so the
        existing Browser Capture card is exactly what it was."""
        from api.services.journal_two import capture_auth as ca
        uid = _user()
        _mint(uid)
        redirect = "https://" + ("a" * 32) + ".chromiumapp.org/"
        code = ca.mint_authorization_code(uid, redirect)["code"]
        ca.exchange_authorization_code(code, redirect)
        _as_member(app, uid)
        capture = client.get("/api/j2/capture/connections").json()["connections"]
        assert [c["clientType"] for c in capture] == [ca.CLIENT_TYPE]
        personal = client.get("/api/j2/personal/tokens").json()["tokens"]
        assert [c["clientType"] for c in personal] == [ca.PERSONAL_CLIENT_TYPE]

    def test_revoking_is_per_member_and_per_kind(self, app, client, gate_on):
        from api.services.journal_two import capture_auth as ca
        a, b = _user(), _user()
        _mint(a)
        redirect = "https://" + ("a" * 32) + ".chromiumapp.org/"
        code = ca.mint_authorization_code(a, redirect)["code"]
        cap_id = ca.exchange_authorization_code(code, redirect)["tokenId"]
        _as_member(app, a)
        [mine] = client.get("/api/j2/personal/tokens").json()["tokens"]
        # the personal door refuses a Browser Capture id -- that has its own card
        assert client.delete(f"/api/j2/personal/tokens/{cap_id}").status_code == 404
        _as_member(app, b)
        assert client.delete(f"/api/j2/personal/tokens/{mine['id']}").status_code == 404
        _as_member(app, a)
        assert len(client.get("/api/j2/personal/tokens").json()["tokens"]) == 1

    def test_a_member_cannot_pile_up_live_tokens(self, app, client, gate_on, monkeypatch):
        from api.services.journal_two import capture_auth as ca
        monkeypatch.setattr(ca, "MAX_PERSONAL_TOKENS", 2)
        uid = _user()
        _as_member(app, uid)
        assert client.post("/api/j2/personal/tokens", json={}).status_code == 200
        assert client.post("/api/j2/personal/tokens", json={}).status_code == 200
        r = client.post("/api/j2/personal/tokens", json={})
        assert r.status_code == 400 and "Revoke one" in r.json()["detail"]


# ── the two token kinds never cross ──────────────────────────────────────────

class TestScopes:
    def test_a_personal_token_is_refused_at_the_browser_capture_routes(self, app, client, gate_on):
        token = _mint(_user())
        r = client.get("/api/j2/capture/destinations", headers=_bearer(token))
        assert r.status_code == 403

    def test_a_browser_capture_token_is_refused_here(self, app, client, gate_on):
        from api.services.journal_two import capture_auth as ca
        from api.routers import notebook_personal_api as router_mod
        uid = _user()
        redirect = "https://" + ("a" * 32) + ".chromiumapp.org/"
        code = ca.mint_authorization_code(uid, redirect)["code"]
        cap = ca.exchange_authorization_code(code, redirect)["token"]
        n = _note(uid)
        for path, body in [("/api/j2/personal/notes", {"title": "t"}),
                           (f"/api/j2/personal/notes/{n['id']}/append", {"markdown": "x"}),
                           ("/api/j2/personal/daily/append", {"markdown": "x"})]:
            r = client.post(path, json=body, headers=_bearer(cap))
            assert r.status_code == 403, (path, r.text)
            assert r.json() == {"detail": router_mod.FORBIDDEN_SENTENCE}

    def test_the_personal_scopes_intersect_nothing_the_extension_is_granted(self):
        from api.services.journal_two import capture_auth as ca
        assert set(ca.PERSONAL_SCOPES).isdisjoint(ca.GRANTED_SCOPES)
        assert ca.GRANTED_SCOPES == (ca.SCOPE_CAPTURE_WRITE, ca.SCOPE_DESTINATIONS_READ)
        assert set(ca.PERSONAL_SCOPES) <= ca.KNOWN_SCOPES

    def test_each_note_door_carries_the_census_marker_for_its_scope(self, app):
        """The capture-boundary census (tests/test_capture_auth_boundary.py)
        reads `_capture_scope` off the app's own dependency graph; these doors
        must be visible to it once the controller mounts the router."""
        from api.services.journal_two import capture_auth as ca
        found = {}

        def walk(dep, into):
            scope = getattr(getattr(dep, "call", None), "_capture_scope", None)
            if scope:
                into.add(scope)
            for sub in getattr(dep, "dependencies", []) or []:
                walk(sub, into)

        for route in app.routes:
            dependant = getattr(route, "dependant", None)
            if dependant is None or not route.path.startswith("/api/j2/personal"):
                continue
            s = set()
            walk(dependant, s)
            if s:
                found[route.path] = s
        assert found == {
            "/api/j2/personal/notes": {ca.SCOPE_NOTES_CREATE},
            "/api/j2/personal/notes/{note_id}/append": {ca.SCOPE_NOTES_APPEND},
            "/api/j2/personal/daily/append": {ca.SCOPE_NOTES_APPEND},
        }


# ── 401 sentences ────────────────────────────────────────────────────────────

class TestUnauthorized:
    def test_missing_wrong_expired_and_revoked_tokens_all_get_the_same_sentence(
            self, app, client, gate_on):
        from api.routers import notebook_personal_api as router_mod
        from api.services.auth_db import get_connection
        from api.services.journal_two import capture_auth as ca
        uid = _user()
        expired = _mint(uid)
        c = get_connection()
        c.execute("UPDATE j2_capture_tokens SET expires_at = ? WHERE token_hash = ?",
                  ("2020-01-01T00:00:00+00:00", ca._hash(expired)))
        c.commit()
        c.close()
        revoked = _mint(uid)
        ca.revoke_connection(uid, ca.resolve_token(revoked)["token_id"])
        for headers in [{}, _bearer("uctpat_nope"), _bearer(expired), _bearer(revoked),
                        {"Authorization": "Basic abc"}]:
            r = client.post("/api/j2/personal/notes", json={"title": "x"}, headers=headers)
            assert r.status_code == 401
            assert r.json() == {"detail": router_mod.UNAUTHORIZED_SENTENCE}


# ── create ───────────────────────────────────────────────────────────────────

class TestCreate:
    def test_markdown_becomes_a_note_in_a_folder_path_with_tags(self, app, client, gate_on):
        from api.services.journal_two import notes
        uid = _user()
        token = _mint(uid)
        md = "# Plan\n\nBuy **NVDA** on the retest.\n\n- one\n- two"
        r = client.post("/api/j2/personal/notes", headers=_bearer(token), json={
            "title": "Trade idea", "markdown": md, "folder": "Inbox/Ideas", "tags": ["setups"]})
        assert r.status_code == 200, r.text
        out = r.json()["note"]
        assert out["title"] == "Trade idea"
        assert out["url"] == f"https://uctintelligence.com/journal/notebook?note={out['id']}"
        note = notes.get_note(uid, out["id"])
        assert note["tags"] == ["setups"]
        types = [n["type"] for n in note["bodyJson"]["content"]]
        assert types == ["heading", "paragraph", "bulletList"]
        assert "Buy NVDA on the retest." in _body_text(out["id"])
        from api.services.auth_db import get_connection
        c = get_connection()
        try:
            folder = c.execute("SELECT name, parent_id FROM j2_note_folders WHERE id = ?",
                               (note["folderId"],)).fetchone()
            parent = c.execute("SELECT name FROM j2_note_folders WHERE id = ?",
                               (folder["parent_id"],)).fetchone()
        finally:
            c.close()
        assert (parent["name"], folder["name"]) == ("Inbox", "Ideas")

    def test_an_image_reference_triggers_no_fetch_and_becomes_text(self, app, client, gate_on, monkeypatch):
        # Loopback stays open: the test client's own event loop builds a
        # socketpair over 127.0.0.1 on Windows. Anything else is a fetch.
        import socket
        local = {"127.0.0.1", "::1", "localhost"}
        real_connect, real_gai = socket.socket.connect, socket.getaddrinfo

        def _connect(self, address, *a, **k):
            host = address[0] if isinstance(address, tuple) else address
            if host not in local:
                raise AssertionError(f"the personal API reached the network: {address!r}")
            return real_connect(self, address, *a, **k)

        def _getaddrinfo(host, *a, **k):
            if host not in local:
                raise AssertionError(f"the personal API resolved a host: {host!r}")
            return real_gai(host, *a, **k)

        monkeypatch.setattr(socket.socket, "connect", _connect)
        monkeypatch.setattr(socket, "getaddrinfo", _getaddrinfo)
        from api.services.journal_two import notes
        uid = _user()
        token = _mint(uid)
        md = "Chart: ![nvda](https://example.com/nvda.png)\n\n![](https://example.com/big.png)"
        r = client.post("/api/j2/personal/notes", headers=_bearer(token),
                        json={"title": "c", "markdown": md})
        assert r.status_code == 200, r.text
        body = json.dumps(notes.get_note(uid, r.json()["note"]["id"])["bodyJson"])
        assert '"image"' not in body and "import-ref://" not in body
        assert "[image: https://example.com/nvda.png]" in body
        assert "[image: https://example.com/big.png]" in body

    def test_refusals_are_sentences(self, app, client, gate_on):
        uid = _user()
        token = _mint(uid)
        h = _bearer(token)
        r = client.post("/api/j2/personal/notes", headers=h, json={})
        assert r.status_code == 400 and "title" in r.json()["detail"]
        r = client.post("/api/j2/personal/notes", headers={**h, "Content-Type": "application/json"},
                        content=b"not json")
        assert r.status_code == 400 and r.json()["detail"].startswith("Send a JSON body")
        r = client.post("/api/j2/personal/notes", headers=h, json={"title": "x" * 400})
        assert r.status_code == 400 and r.json()["detail"].startswith("The note wasn't saved")
        r = client.post("/api/j2/personal/notes", headers=h,
                        json={"title": "big", "markdown": "a" * (200 * 1024 + 1)})
        assert r.status_code == 413 and "200 KB" in r.json()["detail"]


# ── append ───────────────────────────────────────────────────────────────────

class TestAppend:
    def test_markdown_lands_at_the_end_of_the_note(self, app, client, gate_on):
        uid = _user()
        token = _mint(uid)
        n = _note(uid, body={"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "first line"}]}]})
        r = client.post(f"/api/j2/personal/notes/{n['id']}/append", headers=_bearer(token),
                        json={"markdown": "second line"})
        assert r.status_code == 200, r.text
        assert r.json()["note"]["id"] == n["id"]
        from api.services.journal_two import notes
        content = notes.get_note(uid, n["id"])["bodyJson"]["content"]
        assert [c["content"][0]["text"] for c in content] == ["first line", "second line"]

    def test_a_fresh_notes_empty_paragraph_is_not_left_above_the_text(self, app, client, gate_on):
        uid = _user()
        token = _mint(uid)
        n = _note(uid, body={"type": "doc", "content": [{"type": "paragraph"}]})
        client.post(f"/api/j2/personal/notes/{n['id']}/append", headers=_bearer(token),
                    json={"markdown": "only line"})
        from api.services.journal_two import notes
        content = notes.get_note(uid, n["id"])["bodyJson"]["content"]
        assert len(content) == 1 and content[0]["content"][0]["text"] == "only line"

    def test_another_members_token_cannot_touch_the_note(self, app, client, gate_on):
        from api.routers import notebook_personal_api as router_mod
        from api.services.journal_two import note_personal_api as papi
        a, b = _user(), _user()
        n = _note(a, body={"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "A's words"}]}]})
        before = _row(n["id"])
        r = client.post(f"/api/j2/personal/notes/{n['id']}/append", headers=_bearer(_mint(b)),
                        json={"markdown": "B was here"})
        assert r.status_code == 404
        assert r.json() == {"detail": papi.NOT_FOUND_SENTENCE}
        after = _row(n["id"])
        assert (after["body_json"], after["updated_at"]) == (before["body_json"], before["updated_at"])
        assert router_mod  # imported for the sentence table

    def test_another_members_LOCKED_note_is_still_just_404_never_an_oracle(self, app, client, gate_on):
        """⛔ The read itself is tenant-scoped, not only the write: were it not,
        B would be told A's note exists AND is locked (a 423 about a note B
        cannot see). `notes.update_note`'s own scoping cannot catch this one —
        the refusal would come before it runs."""
        from api.services.journal_two import note_personal_api as papi
        from api.services.journal_two import notes
        a, b = _user(), _user()
        n = _note(a)
        notes.update_note(a, n["id"], {"locked": True})
        r = client.post(f"/api/j2/personal/notes/{n['id']}/append", headers=_bearer(_mint(b)),
                        json={"markdown": "probe"})
        assert r.status_code == 404
        assert r.json() == {"detail": papi.NOT_FOUND_SENTENCE}

    def test_a_locked_note_refuses_with_423_and_is_not_touched(self, app, client, gate_on):
        from api.services.journal_two import note_personal_api as papi
        from api.services.journal_two import notes
        uid = _user()
        n = _note(uid, body={"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "kept"}]}]})
        notes.update_note(uid, n["id"], {"locked": True})
        before = _row(n["id"])
        r = client.post(f"/api/j2/personal/notes/{n['id']}/append", headers=_bearer(_mint(uid)),
                        json={"markdown": "should not land"})
        assert r.status_code == 423
        assert r.json() == {"detail": "This note is locked — unlock it in the Notebook first"}
        assert papi.LOCKED_SENTENCE == "This note is locked — unlock it in the Notebook first"
        after = _row(n["id"])
        assert after["body_json"] == before["body_json"]
        assert after["updated_at"] == before["updated_at"]

    def test_empty_and_oversized_markdown_are_refused_before_any_write(self, app, client, gate_on):
        uid = _user()
        token = _mint(uid)
        n = _note(uid)
        before = _row(n["id"])["updated_at"]
        r = client.post(f"/api/j2/personal/notes/{n['id']}/append", headers=_bearer(token),
                        json={"markdown": "   "})
        assert r.status_code == 400
        r = client.post(f"/api/j2/personal/notes/{n['id']}/append", headers=_bearer(token),
                        json={"markdown": "é" * (110 * 1024)})      # 220 KB in UTF-8
        assert r.status_code == 413
        assert _row(n["id"])["updated_at"] == before

    def test_the_append_is_a_compare_and_set_on_the_revision_it_read(self, monkeypatch, db_path):
        """⛔ D-G1(a): the write carries `expected_updated_at` = the revision read
        inside the lock, so a write that somehow landed between them is REFUSED
        rather than overwritten. Driven by making the read stale on purpose."""
        from api.services.journal_two import note_personal_api as papi
        from api.services.journal_two import notes
        uid = _user()
        n = _note(uid)
        seen = {}
        real = notes.update_note

        def spy(user_id, note_id, patch, conn=None, expected_updated_at=None, **kw):
            seen["expected"] = expected_updated_at
            return real(user_id, note_id, patch, conn=conn,
                        expected_updated_at="1999-01-01T00:00:00+00:00", **kw)

        monkeypatch.setattr(notes, "update_note", spy)
        with pytest.raises(papi.PersonalApiError) as e:
            papi.append_markdown(uid, n["id"], "x")
        assert e.value.status == 409
        assert seen["expected"] == n["updatedAt"]


# ── fix round 1 · M-8: a busy database is a sentence, not a bare 500 ─────────

class TestBusyDatabase:
    """A REAL lock, held by a second connection exactly as another writer on
    the pod would hold it -- not a monkeypatched exception. auth.db waits its
    3 s timeout, then SQLite raises `database is locked`."""

    def _append(self, client, token, note_id, text):
        return client.post(f"/api/j2/personal/notes/{note_id}/append", headers=_bearer(token),
                           json={"markdown": text})

    def test_a_locked_database_during_the_append_is_a_503_sentence(self, app, client, gate_on, db_path):
        from api.services.journal_two import note_personal_api as papi
        uid = _user()
        token = _mint(uid)
        n = _note(uid)
        # a first call stamps the token's last_used_at, so the locked call below
        # reaches the append itself (that stamp is written at most every 5 min)
        assert self._append(client, token, n["id"], "one").status_code == 200
        holder = sqlite3.connect(db_path, timeout=0)
        holder.execute("BEGIN IMMEDIATE")
        try:
            r = self._append(client, token, n["id"], "two")
        finally:
            holder.rollback()
            holder.close()
        assert r.status_code == 503, r.text
        assert r.json() == {"detail": papi.BUSY_SENTENCE}
        assert r.headers.get("retry-after") == "5"
        assert "two" not in _body_text(n["id"])
        # control: the lock released, the same append lands
        assert self._append(client, token, n["id"], "two").status_code == 200
        assert "two" in _body_text(n["id"])

    def test_a_locked_database_while_the_token_is_resolved_is_the_same_503(
            self, app, client, gate_on, db_path):
        """A token's FIRST use writes its `last_used_at`, inside the bearer
        dependency and before `_run` -- the same lock there is the same 503."""
        from api.services.journal_two import note_personal_api as papi
        uid = _user()
        token = _mint(uid)
        n = _note(uid)
        holder = sqlite3.connect(db_path, timeout=0)
        holder.execute("BEGIN IMMEDIATE")
        try:
            r = self._append(client, token, n["id"], "first")
        finally:
            holder.rollback()
            holder.close()
        assert r.status_code == 503 and r.json() == {"detail": papi.BUSY_SENTENCE}


# ── the daily door ───────────────────────────────────────────────────────────

class TestDaily:
    def test_the_day_is_the_servers_et_day(self, db_path):
        from api.services.journal_two import note_personal_api as papi
        uid = _user()
        # 02:30 UTC on the 25th is 22:30 ET on the 24th.
        out = papi.append_to_daily(uid, "late entry", now=datetime(2026, 9, 25, 2, 30, tzinfo=timezone.utc))
        assert out["day"] == "2026-09-24"
        assert out["note"]["title"] == "2026-09-24 · Thursday"
        assert out["created"] is True

    def test_first_append_makes_todays_note_and_the_next_one_reuses_it(self, app, client, gate_on):
        from api.services.journal_two import note_tasks
        uid = _user()
        token = _mint(uid)
        r1 = client.post("/api/j2/personal/daily/append", headers=_bearer(token), json={"markdown": "one"})
        r2 = client.post("/api/j2/personal/daily/append", headers=_bearer(token), json={"markdown": "two"})
        assert r1.status_code == r2.status_code == 200, (r1.text, r2.text)
        assert r1.json()["created"] is True and r2.json()["created"] is False
        assert r1.json()["day"] == note_tasks.today_et()
        assert r1.json()["note"]["id"] == r2.json()["note"]["id"]
        text = _body_text(r1.json()["note"]["id"])
        assert text.index("one") < text.index("two")

    def test_two_concurrent_appends_on_a_fresh_day_make_exactly_one_note(self, db_path, monkeypatch):
        """⛔ THE RACE IS FORCED, NOT HOPED FOR. Both requests are held right
        after their first "is there a daily note yet?" read until BOTH have read
        "no" — the exact interleaving that would make two notes. (Left to
        thread timing, a naive find-then-create passed this rail: measured.)"""
        from api.services.auth_db import get_connection
        from api.services.journal_two import note_personal_api as papi
        from api.services.journal_two import note_tasks, notes
        uid = _user()
        start = threading.Barrier(2)
        both_read = threading.Barrier(2)
        first_read = threading.local()
        real_find = notes.find_daily_note_id

        def racing_find(user_id, daily_date, conn):
            found = real_find(user_id, daily_date, conn)
            if not getattr(first_read, "done", False):
                first_read.done = True
                both_read.wait(timeout=10)
            return found

        monkeypatch.setattr(notes, "find_daily_note_id", racing_find)
        results, errors = [], []

        def go(text):
            try:
                start.wait(timeout=10)
                results.append(papi.append_to_daily(uid, text))
            except BaseException as e:  # noqa: BLE001 — surfaced below
                errors.append(repr(e))

        threads = [threading.Thread(target=go, args=(t,)) for t in ("alpha words", "bravo words")]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
        assert errors == []
        assert len(results) == 2
        c = get_connection()
        try:
            rows = c.execute("SELECT id FROM j2_notes WHERE user_id = ? AND daily_date = ?"
                             " AND deleted_at IS NULL", (uid, note_tasks.today_et())).fetchall()
        finally:
            c.close()
        assert len(rows) == 1, "exactly one daily note per member per ET day"
        assert {r["note"]["id"] for r in results} == {rows[0]["id"]}
        text = _body_text(rows[0]["id"])
        assert "alpha words" in text and "bravo words" in text, "neither append was lost"

    def test_a_LOCKED_daily_note_refuses_the_daily_door_with_423(self, app, client, gate_on):
        """Whole-branch tests shard I-1. D-G1(d)'s 423 had ONE rail, on the
        note-append door; the daily door reached it only because it happens to
        share `append_nodes`, and a mutation that unlocks the daily note before
        appending (G1) survived 167 tests. This is the review's rail, as given."""
        from api.services.journal_two import note_personal_api as papi, notes
        uid = _user(); token = _mint(uid)
        r1 = client.post("/api/j2/personal/daily/append", headers=_bearer(token), json={"markdown": "one"})
        nid = r1.json()["note"]["id"]
        notes.update_note(uid, nid, {"locked": True})
        before = _row(nid)
        r = client.post("/api/j2/personal/daily/append", headers=_bearer(token), json={"markdown": "two"})
        assert r.status_code == 423 and r.json() == {"detail": papi.LOCKED_SENTENCE}
        after = _row(nid)
        assert (after["body_json"], after["updated_at"]) == (before["body_json"], before["updated_at"])

    def test_the_members_daily_template_seeds_a_new_daily_note(self, db_path):
        from api.services import auth_service
        from api.services.journal_two import note_personal_api as papi
        from api.services.journal_two import note_templates, notes
        uid = _user()
        src = _note(uid, "Daily template", body={"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "Plan for today"}]}]})
        tpl = note_templates.create_from_note(uid, src["id"], "Daily")
        auth_service.set_user_preference(uid, "notebook_daily_template", tpl["id"])
        out = papi.append_to_daily(uid, "appended")
        text = json.dumps(notes.get_note(uid, out["note"]["id"])["bodyJson"])
        assert "Plan for today" in text and "appended" in text


# ── the rate limit ───────────────────────────────────────────────────────────

class TestRateLimit:
    def test_thirty_a_minute_per_token_then_a_sentence(self, app, client, gate_on):
        from api.routers import notebook_personal_api as router_mod
        uid = _user()
        token, other = _mint(uid), _mint(uid)
        # empty bodies: each is refused 400 AFTER the limiter has counted it,
        # so this spends the quota without writing a single note
        for i in range(30):
            r = client.post("/api/j2/personal/notes", headers=_bearer(token), json={})
            assert r.status_code == 400, (i, r.status_code)
        r = client.post("/api/j2/personal/notes", headers=_bearer(token), json={})
        assert r.status_code == 429
        assert r.json() == {"detail": router_mod.RATE_SENTENCE}
        # a DIFFERENT token has its own minute
        assert client.post("/api/j2/personal/notes", headers=_bearer(other), json={}).status_code == 400
