"""Tests for Evernote OAuth (Plan E Task 2): public client, PKCE derived from the signed state,
rotating refresh token persisted by compare-and-swap.

No network: every token/DCR call goes through `httpx.MockTransport`. The DB is a real temp-file
SQLite (each service call opens its own connection, as in production), same fixture as
`test_note_connectors_connections.py`.
"""

from __future__ import annotations

import asyncio
import importlib
import json
import threading
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from cryptography.fernet import Fernet

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.note_connectors import errors, evernote_oauth

PROD_CALLBACK = "https://uctintelligence.com/api/j2/notes/connectors/evernote/callback"
USER = "u-ev-1"


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.delenv("EVERNOTE_REDIRECT_URI", raising=False)
    monkeypatch.delenv("DASHBOARD_URL", raising=False)
    monkeypatch.setenv("EVERNOTE_CLIENT_ID", "cid-env")
    evernote_oauth._locks.clear()


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("NOTE_ENCRYPTION_KEY", Fernet.generate_key().decode())
    import api.services.crypto_box as cb
    importlib.reload(cb)
    import api.services.journal_two.note_connectors.connections as conns
    importlib.reload(conns)
    return conns


def _iso(delta_s: float) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=delta_s)).isoformat()


def _creds(rt: str, *, expires_in_s: float = -10, client_id: str = "cid-stored") -> dict:
    return {"accessToken": f"at-for-{rt}", "refreshToken": rt,
            "expiresAt": _iso(expires_in_s), "clientId": client_id}


def _token_reply(at: str, rt: str, expires_in: int = 3600) -> httpx.Response:
    return httpx.Response(200, json={"access_token": at, "refresh_token": rt,
                                     "token_type": "Bearer", "expires_in": expires_in,
                                     "scope": "read"})


class TokenServer:
    def __init__(self, reply):
        self.reply = reply
        self.requests: list[httpx.Request] = []
        self.lock = threading.Lock()

    def __call__(self, req: httpx.Request) -> httpx.Response:
        with self.lock:
            self.requests.append(req)
        return self.reply(req)

    def sync_client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self))

    def async_client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(self))


def _form(req: httpx.Request) -> dict[str, list[str]]:
    return parse_qs(req.content.decode("utf-8"))


def _raw_token_enc(user: str = USER) -> str:
    conn = auth_db.get_connection()
    try:
        return conn.execute(
            "SELECT token_enc FROM j2_note_connectors WHERE user_id = ? AND provider = 'evernote'",
            (user,)).fetchone()["token_enc"]
    finally:
        conn.close()


# --------------------------------------------------------------------------- constants


def test_constants():
    assert evernote_oauth.AUTH_BASE == "https://accounts.evernote.com"
    assert evernote_oauth.REGISTER_URL == "https://accounts.evernote.com/auth/register"
    assert evernote_oauth.AUTHORIZE_URL == "https://accounts.evernote.com/auth/authorize"
    assert evernote_oauth.TOKEN_URL == "https://accounts.evernote.com/auth/token"
    assert evernote_oauth.RESOURCE == "https://mcp.evernote.com"
    assert evernote_oauth.SCOPE == "read"


def test_client_id_is_read_live(monkeypatch):
    assert evernote_oauth.client_id() == "cid-env"
    monkeypatch.setenv("EVERNOTE_CLIENT_ID", "cid-2")
    assert evernote_oauth.client_id() == "cid-2"
    monkeypatch.delenv("EVERNOTE_CLIENT_ID")
    assert evernote_oauth.client_id() is None
    monkeypatch.setenv("EVERNOTE_CLIENT_ID", "")
    assert evernote_oauth.client_id() is None


# --------------------------------------------------------------------------- authorize + PKCE


def test_authorize_url_carries_pkce_resource_scope_and_production_callback(monkeypatch):
    monkeypatch.setenv("EVERNOTE_CLIENT_ID", "cid-1")
    url = evernote_oauth.authorize_url("st", b"k")
    parts = urlsplit(url)
    assert f"{parts.scheme}://{parts.netloc}{parts.path}" == evernote_oauth.AUTHORIZE_URL
    q = parse_qs(parts.query)
    assert q["code_challenge_method"] == ["S256"] and q["resource"] == ["https://mcp.evernote.com"]
    assert q["scope"] == ["read"] and q["client_id"] == ["cid-1"]
    assert q["redirect_uri"] == [PROD_CALLBACK]
    assert q["response_type"] == ["code"] and q["state"] == ["st"]
    assert q["code_challenge"] == [
        evernote_oauth.pkce_challenge(evernote_oauth.pkce_verifier("st", b"k"))]
    # The verifier itself never leaves the server.
    assert evernote_oauth.pkce_verifier("st", b"k") not in url


def test_authorize_url_without_client_id_is_not_configured(monkeypatch):
    monkeypatch.delenv("EVERNOTE_CLIENT_ID")
    with pytest.raises(errors.NoteConnNotConfigured):
        evernote_oauth.authorize_url("st", b"k")


def test_verifier_needs_the_secret():
    a = evernote_oauth.pkce_verifier("state-1", b"secret-A")
    b = evernote_oauth.pkce_verifier("state-1", b"secret-B")
    c = evernote_oauth.pkce_verifier("state-2", b"secret-A")
    assert a != b and a != c
    assert a == evernote_oauth.pkce_verifier("state-1", b"secret-A")  # derived, not random
    for v in (a, b, c):
        assert 43 <= len(v) <= 128
        assert "=" not in v
        assert set(v) <= set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
    assert len(a) == 43


def test_pkce_challenge_is_s256_of_the_verifier():
    # RFC 7636 appendix B test vector.
    verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    assert evernote_oauth.pkce_challenge(verifier) == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"


# --------------------------------------------------------------------------- exchange


async def test_exchange_posts_form_with_verifier_and_no_client_secret():
    server = TokenServer(lambda req: _token_reply("at0", "rt0"))
    async with server.async_client() as http:
        await evernote_oauth.exchange_code("code-1", "st", b"k", client=http)
    (req,) = server.requests
    assert req.method == "POST" and str(req.url) == evernote_oauth.TOKEN_URL
    assert req.headers["content-type"].startswith("application/x-www-form-urlencoded")
    assert "authorization" not in req.headers
    form = _form(req)
    assert form == {
        "grant_type": ["authorization_code"],
        "code": ["code-1"],
        "redirect_uri": [PROD_CALLBACK],
        "client_id": ["cid-env"],
        "code_verifier": [evernote_oauth.pkce_verifier("st", b"k")],
        "resource": ["https://mcp.evernote.com"],
    }
    assert "client_secret" not in form


async def test_exchange_stores_client_id_in_creds():
    server = TokenServer(lambda req: _token_reply("at0", "rt0", expires_in=3600))
    async with server.async_client() as http:
        creds = await evernote_oauth.exchange_code("code-1", "st", b"k", client=http)
    assert set(creds) == {"accessToken", "refreshToken", "expiresAt", "clientId"}
    assert creds["accessToken"] == "at0" and creds["refreshToken"] == "rt0"
    assert creds["clientId"] == "cid-env"
    expires = datetime.fromisoformat(creds["expiresAt"])
    assert timedelta(seconds=3500) < expires - datetime.now(timezone.utc) <= timedelta(seconds=3600)


async def test_exchange_rejected_code_raises_auth_error():
    server = TokenServer(lambda req: httpx.Response(400, json={"error": "invalid_grant"}))
    async with server.async_client() as http:
        with pytest.raises(errors.NoteConnAuthError):
            await evernote_oauth.exchange_code("bad", "st", b"k", client=http)


async def test_exchange_without_client_id_is_not_configured(monkeypatch):
    monkeypatch.delenv("EVERNOTE_CLIENT_ID")
    server = TokenServer(lambda req: _token_reply("at0", "rt0"))
    async with server.async_client() as http:
        with pytest.raises(errors.NoteConnNotConfigured):
            await evernote_oauth.exchange_code("c", "st", b"k", client=http)
    assert server.requests == []


# --------------------------------------------------------------------------- refresh


async def test_refresh_rotates_and_persists_the_new_refresh_token_encrypted(tmp_db):
    tmp_db.upsert_connector(USER, "evernote", _creds("rt0"))
    server = TokenServer(lambda req: _token_reply("at1", "rt1"))
    with server.sync_client() as http:
        out = await evernote_oauth.refresh_if_needed(USER, client=http)
    assert out["refreshToken"] == "rt1" and out["accessToken"] == "at1"
    assert out["clientId"] == "cid-stored"
    (req,) = server.requests
    form = _form(req)
    assert form == {"grant_type": ["refresh_token"], "refresh_token": ["rt0"],
                    "client_id": ["cid-stored"],  # the issuing client, not the env var
                    "resource": ["https://mcp.evernote.com"]}
    assert "authorization" not in req.headers
    assert tmp_db.get_token(USER, "evernote")["refreshToken"] == "rt1"
    raw = _raw_token_enc()
    assert "rt1" not in raw and "at1" not in raw and raw.startswith("v1:")


async def test_refresh_falls_back_to_the_env_client_id_for_a_credential_without_one(tmp_db):
    creds = _creds("rt0")
    del creds["clientId"]
    tmp_db.upsert_connector(USER, "evernote", creds)
    server = TokenServer(lambda req: _token_reply("at1", "rt1"))
    with server.sync_client() as http:
        out = await evernote_oauth.refresh_if_needed(USER, client=http)
    assert _form(server.requests[0])["client_id"] == ["cid-env"]
    assert out["clientId"] == "cid-env"


async def test_refresh_keeps_the_old_refresh_token_when_the_reply_omits_one(tmp_db):
    tmp_db.upsert_connector(USER, "evernote", _creds("rt0"))
    server = TokenServer(lambda req: httpx.Response(200, json={"access_token": "at1",
                                                               "expires_in": 3600}))
    with server.sync_client() as http:
        out = await evernote_oauth.refresh_if_needed(USER, client=http)
    assert out["refreshToken"] == "rt0" and out["accessToken"] == "at1"
    assert tmp_db.get_token(USER, "evernote")["accessToken"] == "at1"


async def test_refresh_not_needed_makes_no_post(tmp_db):
    stored = _creds("rt0", expires_in_s=3000)
    tmp_db.upsert_connector(USER, "evernote", stored)
    server = TokenServer(lambda req: _token_reply("at1", "rt1"))
    with server.sync_client() as http:
        out = await evernote_oauth.refresh_if_needed(USER, client=http)
    assert server.requests == []
    assert out == stored


async def test_refresh_inside_the_skew_window_posts(tmp_db):
    tmp_db.upsert_connector(USER, "evernote", _creds("rt0", expires_in_s=30))  # < 60 s skew
    server = TokenServer(lambda req: _token_reply("at1", "rt1"))
    with server.sync_client() as http:
        await evernote_oauth.refresh_if_needed(USER, client=http)
    assert len(server.requests) == 1


async def test_force_refresh_posts_even_when_not_expired(tmp_db):
    tmp_db.upsert_connector(USER, "evernote", _creds("rt0", expires_in_s=3000))
    server = TokenServer(lambda req: _token_reply("at1", "rt1"))
    with server.sync_client() as http:
        out = await evernote_oauth.refresh_if_needed(USER, force=True, client=http)
    assert len(server.requests) == 1 and out["refreshToken"] == "rt1"


async def test_forced_refresh_skips_the_post_when_a_concurrent_refresher_already_won(tmp_db):
    # Review m1: the caller saw at0 rejected; the store already holds a newer access token, so a
    # concurrent refresher rotated first. No second rotation.
    tmp_db.upsert_connector(USER, "evernote", _creds("rt1", expires_in_s=3600))  # at-for-rt1
    server = TokenServer(lambda req: _token_reply("at2", "rt2"))
    with server.sync_client() as http:
        out = await evernote_oauth.refresh_if_needed(
            USER, force=True, rejected_access_token="at-for-rt0", client=http)
    assert server.requests == []
    assert out["refreshToken"] == "rt1"


async def test_forced_refresh_posts_when_the_stored_access_token_is_the_rejected_one(tmp_db):
    tmp_db.upsert_connector(USER, "evernote", _creds("rt0", expires_in_s=3600))  # at-for-rt0
    server = TokenServer(lambda req: _token_reply("at1", "rt1"))
    with server.sync_client() as http:
        out = await evernote_oauth.refresh_if_needed(
            USER, force=True, rejected_access_token="at-for-rt0", client=http)
    assert len(server.requests) == 1 and out["refreshToken"] == "rt1"


def test_swap_retries_while_another_writer_holds_the_lock(tmp_db, monkeypatch):
    # Review I1: Evernote has already rotated rt0 -> rt1 when the swap runs. If auth.db is busy past
    # the 3 s busy timeout, the swap must retry, not lose rt1 and lock the member out.
    import sqlite3

    tmp_db.upsert_connector(USER, "evernote", _creds("rt0"))
    holder = sqlite3.connect(auth_db._DB_PATH, timeout=1, isolation_level=None,
                             check_same_thread=False)  # released from the refresh worker thread
    holder.execute("BEGIN IMMEDIATE")  # held across the first swap attempt
    sleeps: list[float] = []

    def fake_sleep(s):
        sleeps.append(s)
        if holder.in_transaction:
            holder.execute("COMMIT")  # release only after an attempt has failed on the lock

    monkeypatch.setattr(evernote_oauth, "_swap_sleep", fake_sleep)
    server = TokenServer(lambda req: _token_reply("at1", "rt1"))
    try:
        with server.sync_client() as http:
            out = asyncio.run(evernote_oauth.refresh_if_needed(USER, client=http))
    finally:
        if holder.in_transaction:
            holder.execute("ROLLBACK")
        holder.close()
    assert len(sleeps) >= 1  # at least one attempt hit the held lock
    assert out["refreshToken"] == "rt1"
    assert tmp_db.get_token(USER, "evernote")["refreshToken"] == "rt1"
    assert len(server.requests) == 1


def test_swap_retry_is_bounded_and_never_retries_other_errors(tmp_db, monkeypatch):
    import sqlite3

    calls = {"n": 0}

    def always_locked(*a, **kw):
        calls["n"] += 1
        raise sqlite3.OperationalError("database is locked")

    clock = {"t": 0.0}

    def fake_sleep(s):
        clock["t"] += s

    monkeypatch.setattr(evernote_oauth.connections, "swap_token_if_unchanged", always_locked)
    monkeypatch.setattr(evernote_oauth, "_swap_sleep", fake_sleep)
    monkeypatch.setattr(evernote_oauth, "_swap_clock", lambda: clock["t"])
    with pytest.raises(errors.NoteConnTransient) as ei:
        evernote_oauth._swap_with_retry(USER, "rt0-SECRET", _creds("rt1-SECRET"))
    assert "SECRET" not in str(ei.value)
    assert calls["n"] >= 3
    assert clock["t"] <= evernote_oauth.SWAP_RETRY_BUDGET_S

    def other_error(*a, **kw):
        raise sqlite3.OperationalError("no such table: j2_note_connectors")

    monkeypatch.setattr(evernote_oauth.connections, "swap_token_if_unchanged", other_error)
    with pytest.raises(sqlite3.OperationalError):
        evernote_oauth._swap_with_retry(USER, "rt0", _creds("rt1"))


def test_swap_retry_budget_constant():
    assert evernote_oauth.SWAP_RETRY_BUDGET_S == 30.0


async def test_refresh_without_a_connector_returns_none(tmp_db):
    server = TokenServer(lambda req: _token_reply("at1", "rt1"))
    with server.sync_client() as http:
        assert await evernote_oauth.refresh_if_needed("nobody", client=http) is None
        assert await evernote_oauth.refresh_if_needed("nobody", force=True, client=http) is None
    assert server.requests == []


async def test_forced_refresh_without_a_refresh_token_raises_token_expired(tmp_db):
    creds = _creds("rt0", expires_in_s=3000)
    del creds["refreshToken"]
    tmp_db.upsert_connector(USER, "evernote", creds)
    server = TokenServer(lambda req: _token_reply("at1", "rt1"))
    with server.sync_client() as http:
        with pytest.raises(errors.NoteConnTokenExpired):
            await evernote_oauth.refresh_if_needed(USER, force=True, client=http)
    assert server.requests == []


class _ProbedLock:
    """Wraps whatever lock `_lock_for` returns and counts arrivals at `acquire`, BEFORE acquiring,
    so the test can hold the first POST open until the second thread has reached the lock."""

    def __init__(self, inner, arrivals, both_arrived):
        self.inner, self.arrivals, self.both_arrived = inner, arrivals, both_arrived

    def __enter__(self):
        with self.arrivals["guard"]:
            self.arrivals["n"] += 1
            if self.arrivals["n"] >= 2:
                self.both_arrived.set()
        return self.inner.__enter__()

    def __exit__(self, *exc):
        return self.inner.__exit__(*exc)


def test_two_threads_racing_one_expired_token_post_once(tmp_db, monkeypatch):
    # Review m2: deterministic. The first POST does not return until the second thread has arrived
    # at the lock, so with a real per-user lock it is provably waiting while the first refreshes;
    # with a broken lock it runs its own POST (2 POSTs, red).
    tmp_db.upsert_connector(USER, "evernote", _creds("rt0"))
    arrivals = {"n": 0, "guard": threading.Lock()}
    both_arrived = threading.Event()
    real_lock_for = evernote_oauth._lock_for
    monkeypatch.setattr(evernote_oauth, "_lock_for",
                        lambda user_id: _ProbedLock(real_lock_for(user_id), arrivals, both_arrived))

    def reply(req):
        assert both_arrived.wait(10), "second thread never reached the refresh lock"
        return _token_reply("at1", "rt1")

    server = TokenServer(reply)
    http = server.sync_client()
    results: list = [None, None]
    failures: list = []

    def run(i):
        try:
            results[i] = asyncio.run(evernote_oauth.refresh_if_needed(USER, client=http))
        except BaseException as exc:  # pragma: no cover - surfaced below
            failures.append(exc)

    threads = [threading.Thread(target=run, args=(i,)) for i in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    http.close()
    assert failures == []
    assert both_arrived.is_set()
    assert len(server.requests) == 1
    assert results[0]["refreshToken"] == "rt1" and results[1]["refreshToken"] == "rt1"
    assert tmp_db.get_token(USER, "evernote")["refreshToken"] == "rt1"


async def test_lost_race_invalid_grant_returns_the_winners_tokens(tmp_db):
    tmp_db.upsert_connector(USER, "evernote", _creds("rt0"))
    winner = _creds("rt1", expires_in_s=3600)

    def reply(req):
        # Another process refreshed first: rt0 is spent and the store already holds rt1.
        tmp_db.upsert_connector(USER, "evernote", winner, record_consent=False)
        return httpx.Response(400, json={"error": "invalid_grant"})

    server = TokenServer(reply)
    with server.sync_client() as http:
        out = await evernote_oauth.refresh_if_needed(USER, client=http)
    assert out == winner


async def test_invalid_grant_with_unchanged_store_raises_token_expired(tmp_db):
    tmp_db.upsert_connector(USER, "evernote", _creds("rt0"))
    server = TokenServer(lambda req: httpx.Response(400, json={"error": "invalid_grant"}))
    with server.sync_client() as http:
        with pytest.raises(errors.NoteConnTokenExpired):
            await evernote_oauth.refresh_if_needed(USER, client=http)
    assert tmp_db.get_token(USER, "evernote")["refreshToken"] == "rt0"


async def test_refresh_transport_error_is_transient_and_never_carries_the_token(tmp_db):
    tmp_db.upsert_connector(USER, "evernote", _creds("rt0-SECRET"))

    def reply(req):
        raise httpx.ConnectError("boom refresh_token=rt0-SECRET", request=req)

    server = TokenServer(reply)
    with server.sync_client() as http:
        with pytest.raises(errors.NoteConnTransient) as ei:
            await evernote_oauth.refresh_if_needed(USER, client=http)
    assert "rt0-SECRET" not in str(ei.value)


async def test_refresh_never_overwrites_a_reconnect(tmp_db):
    tmp_db.upsert_connector(USER, "evernote", _creds("rt0"))
    reconnect = _creds("rtR", expires_in_s=3600, client_id="cid-env")

    def reply(req):
        # The member reconnects while this refresh's POST is in flight.
        tmp_db.upsert_connector(USER, "evernote", reconnect)
        return _token_reply("at1", "rt1")

    server = TokenServer(reply)
    with server.sync_client() as http:
        out = await evernote_oauth.refresh_if_needed(USER, client=http)
    assert tmp_db.get_token(USER, "evernote") == reconnect
    assert out == reconnect  # the freshly stored creds, never the losing rt1
    # And directly: a swap that expects rt0 refuses to touch the reconnect.
    assert tmp_db.swap_token_if_unchanged(USER, "evernote", "rt0", _creds("rtX")) is False
    assert tmp_db.get_token(USER, "evernote") == reconnect


# --------------------------------------------------------------------------- swap


def test_swap_token_if_unchanged_is_atomic_and_encrypted(tmp_db, monkeypatch):
    tmp_db.upsert_connector(USER, "evernote", _creds("rt0"))
    statements: list[str] = []
    real_get_connection = tmp_db.get_connection

    def traced():
        conn = real_get_connection()
        conn.set_trace_callback(statements.append)
        return conn

    monkeypatch.setattr(tmp_db, "get_connection", traced)
    new = _creds("rt1", expires_in_s=3600)
    assert tmp_db.swap_token_if_unchanged(USER, "evernote", "rt0", new) is True
    monkeypatch.setattr(tmp_db, "get_connection", real_get_connection)

    # Compare and write inside ONE immediate transaction: the write lock is taken BEFORE the read.
    upper = [s.strip().upper() for s in statements]
    begin = upper.index("BEGIN IMMEDIATE")
    select = next(i for i, s in enumerate(upper) if s.startswith("SELECT") and "TOKEN_ENC" in s)
    update = next(i for i, s in enumerate(upper) if s.startswith("UPDATE J2_NOTE_CONNECTORS"))
    commit = next(i for i, s in enumerate(upper) if s == "COMMIT")
    assert begin < select < update < commit

    assert tmp_db.get_token(USER, "evernote") == new
    raw = _raw_token_enc()
    assert "rt1" not in raw and raw.startswith("v1:")

    # A stale expectation writes nothing.
    assert tmp_db.swap_token_if_unchanged(USER, "evernote", "rt0", _creds("rt2")) is False
    assert tmp_db.get_token(USER, "evernote") == new
    # No connector row: nothing to swap.
    assert tmp_db.swap_token_if_unchanged("nobody", "evernote", "rt0", _creds("rt2")) is False
    assert tmp_db.get_token("nobody", "evernote") is None


def test_swap_from_two_threads_writes_exactly_once(tmp_db):
    tmp_db.upsert_connector(USER, "evernote", _creds("rt0"))
    barrier = threading.Barrier(2)
    results: list = [None, None]

    def run(i):
        barrier.wait(5)
        results[i] = tmp_db.swap_token_if_unchanged(
            USER, "evernote", "rt0", _creds(f"rt-{i}", expires_in_s=3600))

    threads = [threading.Thread(target=run, args=(i,)) for i in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(15)
    assert sorted(results) == [False, True]
    winner = results.index(True)
    assert tmp_db.get_token(USER, "evernote")["refreshToken"] == f"rt-{winner}"


def test_upsert_and_swap_share_one_encrypt_helper(tmp_db, monkeypatch):
    seen: list[dict] = []
    real = tmp_db._encrypt_token

    def spy(token):
        seen.append(token)
        return real(token)

    monkeypatch.setattr(tmp_db, "_encrypt_token", spy)
    tmp_db.upsert_connector(USER, "evernote", _creds("rt0"))
    tmp_db.swap_token_if_unchanged(USER, "evernote", "rt0", _creds("rt1"))
    assert [t["refreshToken"] for t in seen] == ["rt0", "rt1"]


# --------------------------------------------------------------------------- DCR


def _registration(**overrides) -> dict:
    reply = {"client_id": "cid-new", "token_endpoint_auth_method": "none",
             "redirect_uris": [PROD_CALLBACK],
             "grant_types": ["authorization_code", "refresh_token"]}
    reply.update(overrides)
    return reply


@pytest.mark.parametrize("bad", [
    {"redirect_uris": ["https://evil.example/cb"]},
    {"redirect_uris": [PROD_CALLBACK, "https://evil.example/cb"]},
    {"redirect_uris": None},
    {"token_endpoint_auth_method": "client_secret_basic"},
    {"token_endpoint_auth_method": None},
])
async def test_register_client_refuses_a_reply_that_does_not_echo_the_request(bad):
    # Review m4: a server that silently altered the registration is caught at deploy.
    reply = {k: v for k, v in _registration(**bad).items() if v is not None}
    server = TokenServer(lambda req: httpx.Response(201, json=reply))
    async with server.async_client() as http:
        with pytest.raises(evernote_oauth.RegistrationMismatch):
            await evernote_oauth.register_client(PROD_CALLBACK, client=http)


async def test_register_client_body_matches_the_probe():
    server = TokenServer(lambda req: httpx.Response(201, json=_registration()))
    async with server.async_client() as http:
        out = await evernote_oauth.register_client(PROD_CALLBACK, client=http)
    assert out["client_id"] == "cid-new"
    (req,) = server.requests
    assert req.method == "POST" and str(req.url) == evernote_oauth.REGISTER_URL
    assert "authorization" not in req.headers
    assert json.loads(req.content) == {
        "client_name": "UCT Notebook Sync",
        "redirect_uris": [PROD_CALLBACK],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
        "scope": "read",
    }


async def test_register_client_failure_raises():
    server = TokenServer(lambda req: httpx.Response(400, json={"error": "invalid_redirect_uri"}))
    async with server.async_client() as http:
        with pytest.raises(errors.NoteConnError):
            await evernote_oauth.register_client(PROD_CALLBACK, client=http)


def test_register_tool_refuses_a_non_production_redirect(monkeypatch, capsys):
    import importlib.util
    import pathlib

    path = pathlib.Path(__file__).resolve().parents[3] / "tools" / "evernote_register_client.py"
    spec = importlib.util.spec_from_file_location("evernote_register_client_tool", path)
    tool = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tool)

    called = []

    async def fake_register(redirect_uri, *, client=None):
        called.append(redirect_uri)
        return {"client_id": "cid-printed"}

    monkeypatch.setattr(tool.evernote_oauth, "register_client", fake_register)

    monkeypatch.setenv("DASHBOARD_URL", "http://localhost:8077")
    assert tool.main([]) != 0
    out = capsys.readouterr()
    assert "http://localhost:8077/api/j2/notes/connectors/evernote/callback" in out.out + out.err
    assert called == []

    monkeypatch.delenv("DASHBOARD_URL")
    assert tool.main([]) == 0
    out = capsys.readouterr().out
    assert "cid-printed" in out and PROD_CALLBACK in out
    assert called == [PROD_CALLBACK]

    # Review m4: Evernote's reply did not echo the request -> exit 2, no client id handed over.
    async def mismatched(redirect_uri, *, client=None):
        raise evernote_oauth.RegistrationMismatch(
            "evernote registration reply does not match the request: redirect_uris")

    monkeypatch.setattr(tool.evernote_oauth, "register_client", mismatched)
    assert tool.main([]) == 2
    captured = capsys.readouterr()
    assert "REFUSED" in captured.err and "client_id:" not in captured.out


# --------------------------------------------------------------------------- revoke (final review M5)
# Evernote publishes `revocation_endpoint` in its authorization-server metadata
# (https://accounts.evernote.com/.well-known/oauth-authorization-server, read 2026-11-03).


def test_revoke_url_is_the_published_endpoint():
    assert evernote_oauth.REVOKE_URL == "https://accounts.evernote.com/auth/revoke"


async def test_revoke_posts_the_refresh_then_the_access_token_as_a_public_client():
    server = TokenServer(lambda req: httpx.Response(200))
    async with server.async_client() as http:
        await evernote_oauth.revoke_token({"accessToken": "at-9", "refreshToken": "rt-9", "clientId": "cid-x"},
                                          client=http)
    assert [str(r.url) for r in server.requests] == [evernote_oauth.REVOKE_URL] * 2
    assert [_form(r) for r in server.requests] == [
        {"token": ["rt-9"], "token_type_hint": ["refresh_token"], "client_id": ["cid-x"]},
        {"token": ["at-9"], "token_type_hint": ["access_token"], "client_id": ["cid-x"]},
    ]
    assert all("authorization" not in r.headers for r in server.requests)


async def test_revoke_raises_on_a_refusal_without_leaking_the_token():
    server = TokenServer(lambda req: httpx.Response(400, json={"error": "invalid_request"}))
    async with server.async_client() as http:
        with pytest.raises(errors.NoteConnError) as info:
            await evernote_oauth.revoke_token({"accessToken": "at-SECRET", "refreshToken": "rt-SECRET",
                                               "clientId": "cid-x"}, client=http)
    assert "SECRET" not in str(info.value)


async def test_each_revoke_request_carries_a_five_second_timeout():
    """Final re-review N1: per request, whoever built the client (the router's budget bounds the
    whole revoke on top)."""
    server = TokenServer(lambda req: httpx.Response(200))
    async with httpx.AsyncClient(transport=httpx.MockTransport(server), timeout=60.0) as http:
        await evernote_oauth.revoke_token({"accessToken": "a", "refreshToken": "r", "clientId": "c"}, client=http)
    assert evernote_oauth.REVOKE_TIMEOUT_S == 5.0
    assert len(server.requests) == 2
    for req in server.requests:
        assert set(req.extensions["timeout"].values()) == {5.0}
