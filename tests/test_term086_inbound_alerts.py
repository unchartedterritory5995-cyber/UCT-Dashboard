"""TERM-086 (item 14 WF-B06) -- the inbound alert receiver: TradingView as an
upstream sensor.

WHAT THIS FILE EXISTS TO MAKE IMPOSSIBLE
----------------------------------------
An inbound webhook is an UNAUTHENTICATED POST by nature -- TradingView can carry
no session, no header and no signature, only a URL. So the URL is the password,
and each rail below guards one way that goes wrong:

  1. DARK: flag off, the routes answer EXACTLY what the app answers when the
     router is not mounted -- proven against an app WITHOUT the router, in both
     the bare shape (404) and a catch-all shape (405), never against the real
     SPA catch-all (it exists only with a built app/dist).
  2. A bad token is refused and COUNTED; a rotated or revoked one is refused
     with a NAMED reason (PROD-1: an old sender must learn why it failed).
  3. The token NEVER reaches a log line -- asserted over captured records, with
     a control proving the capture saw this module's lines at all.
  4. Member A's token cannot aim an alert at member B, whatever the body says.
  5. Oversize and malformed payloads are refused before anything is recorded.
  6. A replayed payload does not deliver twice -- including two identical
     requests racing each other.
  7. Delivery goes through deliver_alert_payload to the OWNER, and never the
     admin Discord (TERM-011).

No network: delivery is spied or its transports are patched. The clock is
injected (`inbound_alerts._clock`).
"""
from __future__ import annotations

import io
import json
import logging
import sqlite3
import threading
import time
import tokenize
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.limiter import limiter
from api.middleware.auth_middleware import get_current_user
from api.routers import inbound_alerts as iar
from api.services import inbound_alerts as ia

REPO = Path(__file__).resolve().parents[1]
T0 = 1_790_000_000.0
U_A, U_B = "member-aaa-086", "member-bbb-086"
EMAILS = {U_A: "a@example.test", U_B: "b@example.test"}
UNKNOWN_ROUTE = "/api/zz-term086-no-such-route/"
GOOD = {"ticker": "NASDAQ:NVDA", "price": 123.45, "message": "Crossed my level"}


# ── fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def env(tmp_path, monkeypatch):
    db = tmp_path / "auth.db"
    c = sqlite3.connect(db)
    c.execute("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT)")
    c.executemany("INSERT INTO users VALUES (?, ?)", list(EMAILS.items()))
    c.commit()
    c.close()

    def _conn():
        k = sqlite3.connect(db, timeout=5)
        k.row_factory = sqlite3.Row
        return k

    import api.services.auth_db as adb
    monkeypatch.setattr(adb, "get_connection", _conn)
    monkeypatch.delenv(ia.FLAG, raising=False)
    monkeypatch.delenv(ia.RATE_ENV, raising=False)
    monkeypatch.delenv("RATE_LIMIT_POLICY", raising=False)
    clock = {"t": T0}
    monkeypatch.setattr(ia, "_clock", lambda: clock["t"])
    ia._reset_state()
    monkeypatch.setattr(limiter, "enabled", True)
    limiter.reset()

    delivered: list[dict] = []

    def spy(user_id, sym, title, message, source="indicator_alert",
            extra_data=None, severity="warning"):
        delivered.append({"user_id": user_id, "sym": sym, "title": title,
                          "message": message, "source": source,
                          "extra_data": dict(extra_data or {}), "severity": severity})
        return {"claimed": True, "channels": {"in_app": "ok"}, "channels_ok": 1,
                "channels_failed": 0, "errors": {}}

    import api.services.watchlist_alert_service as was
    monkeypatch.setattr(was, "deliver_alert_payload", spy)
    monkeypatch.setattr(iar, "_dispatch", lambda fn, *a: fn(*a))

    from api.main import app
    who = {"id": U_A}
    app.dependency_overrides[iar.require_paid] = lambda: dict(who, plan="pro")
    app.dependency_overrides[get_current_user] = lambda: dict(who)
    client = TestClient(app, raise_server_exceptions=False)
    try:
        yield {"client": client, "app": app, "db": db, "who": who, "clock": clock,
               "delivered": delivered, "monkeypatch": monkeypatch}
    finally:
        app.dependency_overrides.pop(iar.require_paid, None)
        app.dependency_overrides.pop(get_current_user, None)
        limiter.reset()


def _on(env):
    env["monkeypatch"].setenv(ia.FLAG, "1")


def _off(env):
    env["monkeypatch"].delenv(ia.FLAG, raising=False)


def _as(env, uid):
    env["who"]["id"] = uid


def _mint(env, uid=U_A):
    _as(env, uid)
    r = env["client"].post(iar.RECEIVER_PATH)
    assert r.status_code == 201, r.text
    return r.json()["url"].rsplit("/", 1)[1]


def _fire(env, token, payload=GOOD, raw=None):
    body = raw if raw is not None else json.dumps(payload).encode()
    return env["client"].post(iar.HOOK_PREFIX + token, content=body,
                              headers={"content-type": "application/json"})


def _receipts(env):
    c = sqlite3.connect(env["db"])
    try:
        return c.execute("SELECT user_id, sym, status FROM inbound_alert_receipts "
                         "ORDER BY id").fetchall()
    except sqlite3.OperationalError:
        return []
    finally:
        c.close()


def _shape(r):
    return r.status_code, r.content, sorted(r.headers.items())


# ── 1. DARK ──────────────────────────────────────────────────────────────────

def test_flag_OFF_the_hook_is_BYTE_IDENTICAL_to_an_unknown_route(env):
    _on(env)
    token = _mint(env)
    _off(env)
    hook = _fire(env, token)
    unknown = env["client"].post(UNKNOWN_ROUTE + token, content=json.dumps(GOOD).encode(),
                                 headers={"content-type": "application/json"})
    # Not a literal 404: with a built app/dist the SPA catch-all answers a POST
    # with 405, and "as if not mounted" means whatever an unknown route answers.
    assert hook.status_code == unknown.status_code and hook.status_code in (404, 405)
    assert _shape(hook) == _shape(unknown)
    assert env["delivered"] == [] and _receipts(env) == []


def test_flag_OFF_every_route_answers_as_if_the_router_were_NOT_MOUNTED(env):
    """The stronger claim, in BOTH shapes: bare (404) and with a catch-all GET
    like the SPA's (405 for a POST) -- built locally, never the real one."""
    def build(with_router, catch_all):
        a = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)
        if with_router:
            a.include_router(iar.router)
        if catch_all:
            a.get("/{full_path:path}")(lambda full_path: {"spa": True})
        return TestClient(a, raise_server_exceptions=False)

    concrete = [("POST", iar.HOOK_PREFIX + "tvr_whatever"), ("GET", iar.RECEIVER_PATH),
                ("POST", iar.RECEIVER_PATH), ("POST", iar.ROTATE_PATH),
                ("DELETE", iar.RECEIVER_PATH), ("GET", iar.STATUS_PATH)]
    declared = {(m, r.path) for r in iar.router.routes for m in r.methods}
    assert len(declared) == len(concrete), "a route was added; name it here"
    for catch_all in (False, True):
        with_r, without = build(True, catch_all), build(False, catch_all)
        for method, path in concrete:
            a = with_r.request(method, path, content=b"{}")
            b = without.request(method, path, content=b"{}")
            assert _shape(a) == _shape(b), (catch_all, method, path)

    # CONTROL: with the flag ON the same comparison SEES the router.
    _on(env)
    a = build(True, True).post(iar.HOOK_PREFIX + "tvr_whatever", content=b"{}")
    b = build(False, True).post(iar.HOOK_PREFIX + "tvr_whatever", content=b"{}")
    assert a.status_code == 401 and b.status_code == 405


def test_the_flag_is_read_PER_REQUEST(env):
    _on(env)
    token = _mint(env)
    assert _fire(env, token).status_code == 202
    _off(env)
    off = _fire(env, token, {"ticker": "AMD"})
    unknown = env["client"].post(UNKNOWN_ROUTE + token, content=json.dumps(GOOD).encode(),
                                 headers={"content-type": "application/json"})
    assert off.status_code == unknown.status_code and off.status_code in (404, 405)
    _on(env)
    assert _fire(env, token, {"ticker": "AMD"}).status_code == 202


# ── 2. refusals, counted and named ───────────────────────────────────────────

@pytest.mark.parametrize("token", ["tvr_" + "x" * 43, "not-a-token", "tvr_" + "y" * 200])
def test_an_UNKNOWN_token_is_refused_401_and_COUNTED(env, token):
    _on(env)
    r = _fire(env, token)
    assert r.status_code == 401 and r.json()["detail"] == iar.UNKNOWN_SENTENCE
    assert ia.counts().get(ia.REFUSED_UNKNOWN) == 1
    assert env["delivered"] == [] and _receipts(env) == []


def test_a_ROTATED_token_is_refused_with_a_NAMED_reason_and_counted(env):
    _on(env)
    old = _mint(env)
    r = env["client"].post(iar.ROTATE_PATH)
    assert r.status_code == 200
    new = r.json()["url"].rsplit("/", 1)[1]
    assert new != old
    refused = _fire(env, old)
    assert refused.status_code == 403 and refused.json()["detail"] == iar.ROTATED_SENTENCE
    assert ia.counts().get(ia.REFUSED_ROTATED) == 1
    assert env["client"].get(iar.RECEIVER_PATH).json()["old_url_refusals"] == 1
    assert _fire(env, new).status_code == 202
    assert [d["user_id"] for d in env["delivered"]] == [U_A]


def test_a_REVOKED_token_is_refused_and_the_member_can_RECOVER(env):
    _on(env)
    token = _mint(env)
    assert env["client"].delete(iar.RECEIVER_PATH).json() == {"revoked": 1}
    r = _fire(env, token)
    assert r.status_code == 403 and r.json()["detail"] == iar.REVOKED_SENTENCE
    assert ia.counts().get(ia.REFUSED_REVOKED) == 1
    assert env["client"].get(iar.RECEIVER_PATH).json()["active"] is False
    fresh = _mint(env)                      # the recovery path, in the same commit
    assert _fire(env, fresh).status_code == 202


def test_ONE_active_token_per_member_and_status_never_returns_it(env):
    _on(env)
    token = _mint(env)
    again = env["client"].post(iar.RECEIVER_PATH)
    assert again.status_code == 409 and again.json()["detail"] == iar.ACTIVE_SENTENCE
    st = env["client"].get(iar.RECEIVER_PATH).json()
    assert st["active"] is True and st["hint"] == token[:8]
    assert token not in json.dumps(st)
    c = sqlite3.connect(env["db"])
    try:
        stored = [r[0] for r in c.execute("SELECT token_hash FROM inbound_alert_tokens")]
        dump = "\n".join(c.iterdump())
    finally:
        c.close()
    assert stored == [ia.digest(token)]
    assert token not in dump and token[4:] not in dump, "the token is stored in the clear"


def test_a_store_failure_REFUSES_never_admits(env):
    _on(env)
    token = _mint(env)

    def broken():
        raise sqlite3.OperationalError("database is locked")

    import api.services.auth_db as adb
    env["monkeypatch"].setattr(adb, "get_connection", broken)
    r = _fire(env, token)
    assert r.status_code == 503 and env["delivered"] == []


# ── 3. the token never reaches a log line ────────────────────────────────────

def test_a_token_NEVER_reaches_a_log_line(env, caplog):
    """⚠️ `api/services/log_redaction.py` masks `token=<value>` in every record by
    PARAMETER NAME, so a `token=%s` leak is redacted before this capture sees it
    (measured while mutation-proving this rail). The receiver's credential is a
    PATH SEGMENT with no such name, which is the leak shape this rail exists for
    -- mutation-proved with a bare `%s` of the token and of the issued URL."""
    caplog.set_level(logging.DEBUG)
    _on(env)
    tokens = [_mint(env, U_A)]
    tokens.append(env["client"].post(iar.ROTATE_PATH).json()["url"].rsplit("/", 1)[1])
    _fire(env, tokens[0])                   # rotated: refused, logged by user+verdict
    _fire(env, tokens[1])
    _fire(env, tokens[1], raw=b"not json")
    _fire(env, "tvr_" + "z" * 43)
    env["client"].delete(iar.RECEIVER_PATH)
    _fire(env, tokens[1])                   # revoked

    text = "\n".join(f"{r.name} {r.getMessage()} {r.args!r}" for r in caplog.records)
    # CONTROL: the capture saw THIS module's lines, so silence below means something.
    assert "[inbound-alerts] receiver minted user=" + U_A in text
    assert "[inbound-alerts] refused user=" + U_A in text
    for tok in tokens:
        for needle in (tok, tok[len(ia.TOKEN_PREFIX):], ia.digest(tok)):
            assert needle not in text, "a receiver token (or its digest) reached a log line"


def test_the_ACCESS_LOG_backstop_redacts_the_hook_path():
    """uvicorn's access line carries the PATH; access logging is silenced in
    main.py, and this filter is the backstop if that ever changes."""
    from api import logging_redaction as lr
    token = "tvr_" + "s" * 43
    rec = logging.LogRecord("uvicorn.access", logging.INFO, __file__, 1,
                            '%s - "%s %s HTTP/%s" %d',
                            ("1.2.3.4:5", "POST", iar.HOOK_PREFIX + token, "1.1", 202), None)
    assert token in rec.getMessage()        # CONTROL: unfiltered, it is right there
    assert lr.ShareQueryRedactionFilter().filter(rec) is True
    assert token not in rec.getMessage()
    assert iar.HOOK_PREFIX in rec.getMessage()
    assert lr.REDACTED_PATH_PREFIXES == (iar.HOOK_PREFIX,)


# ── 4. A's token cannot target B ─────────────────────────────────────────────

def test_member_A_token_CANNOT_target_member_B(env):
    _on(env)
    tok_a = _mint(env, U_A)
    tok_b = _mint(env, U_B)
    hostile = dict(GOOD, user_id=U_B, user=U_B, email=EMAILS[U_B], member=U_B)
    assert _fire(env, tok_a, hostile).status_code == 202
    assert [d["user_id"] for d in env["delivered"]] == [U_A]
    assert not any(U_B in json.dumps(d["extra_data"]) for d in env["delivered"])
    # B revoking touches only B's token; A's still works.
    _as(env, U_B)
    assert env["client"].delete(iar.RECEIVER_PATH).json() == {"revoked": 1}
    assert _fire(env, tok_b).status_code == 403
    assert _fire(env, tok_a, {"ticker": "AMD"}).status_code == 202
    assert [d["user_id"] for d in env["delivered"]] == [U_A, U_A]


# ── 5. oversize and malformed ────────────────────────────────────────────────

def test_an_OVERSIZE_payload_is_refused_413_declared_or_streamed(env):
    _on(env)
    token = _mint(env)
    big = json.dumps({"ticker": "NVDA", "message": "x" * ia.MAX_BODY_BYTES}).encode()
    assert _fire(env, token, raw=big).status_code == 413
    streamed = env["client"].post(iar.HOOK_PREFIX + token,
                                  content=iter([big[:3000], big[3000:]]))
    assert streamed.status_code == 413
    assert ia.counts().get(ia.REFUSED_OVERSIZE) == 2
    assert env["delivered"] == [] and _receipts(env) == []


@pytest.mark.parametrize("raw,status", [
    (b"NVDA crossed 120", 400),
    (b"\xff\xfe\x00", 400),
    (b"[1, 2]", 422),
    (b"{}", 422),
    (b'{"ticker": ""}', 422),
    (b'{"ticker": "AAPL; DROP TABLE"}', 422),
    (b'{"ticker": 42}', 422),
    (b'{"ticker": "AAPL", "price": "abc"}', 422),
    (b'{"ticker": "AAPL", "price": true}', 422),
    (b'{"ticker": "AAPL", "price": "NaN"}', 422),
    (b'{"ticker": "AAPL", "title": 5}', 422),
    (json.dumps({"ticker": "AAPL", "title": "t" * 121}).encode(), 422),
    (b'{"ticker": "AAPL", "exchange": "NAS DAQ"}', 422),
])
def test_a_MALFORMED_payload_is_refused_and_records_nothing(env, raw, status):
    _on(env)
    token = _mint(env)
    r = _fire(env, token, raw=raw)
    assert r.status_code == status, r.text
    assert isinstance(r.json()["detail"], str) and r.json()["detail"]
    assert ia.counts().get(ia.REFUSED_MALFORMED) == 1
    assert env["delivered"] == [] and _receipts(env) == []


def test_UNKNOWN_fields_are_ignored_and_known_ones_normalised(env):
    _on(env)
    token = _mint(env)
    body = {"ticker": " nasdaq:nvda ", "price": "123.5", "interval": "5",
            "junk": {"deep": [1, 2]}, "strategy": "anything", "time": "2026-09-28T14:30:00Z"}
    assert _fire(env, token, body).status_code == 202
    (d,) = env["delivered"]
    assert d["sym"] == "NVDA" and d["source"] == ia.SOURCE and d["severity"] == "info"
    assert d["extra_data"] == {"origin": "tradingview", "receipt_id": 1, "price": 123.5,
                               "time": "2026-09-28T14:30:00Z", "interval": "5",
                               "exchange": "NASDAQ"}


# ── 6. replay dedup ──────────────────────────────────────────────────────────

def test_a_REPLAYED_payload_does_not_double_deliver(env):
    _on(env)
    token = _mint(env)
    first = _fire(env, token)
    replay = _fire(env, token)
    assert first.status_code == 202
    assert replay.status_code == 200 and replay.json() == {"accepted": True, "duplicate": True}
    assert len(env["delivered"]) == 1
    assert ia.counts().get(ia.DEDUPED) == 1
    assert _fire(env, token, dict(GOOD, price=124.0)).status_code == 202   # a new fire
    assert len(env["delivered"]) == 2
    env["clock"]["t"] += ia.BODY_DEDUP_WINDOW_S + 1                        # the same words, later
    assert _fire(env, token).status_code == 202
    assert len(env["delivered"]) == 3


def test_an_explicit_ID_dedups_for_its_longer_window_and_per_member(env):
    _on(env)
    tok_a, tok_b = _mint(env, U_A), _mint(env, U_B)
    assert _fire(env, tok_a, {"ticker": "NVDA", "id": "fire-1"}).status_code == 202
    env["clock"]["t"] += 86400
    assert _fire(env, tok_a, {"ticker": "NVDA", "id": "fire-1", "price": 1}).status_code == 200
    assert _fire(env, tok_b, {"ticker": "NVDA", "id": "fire-1"}).status_code == 202
    assert [d["user_id"] for d in env["delivered"]] == [U_A, U_B]


def test_two_IDENTICAL_requests_RACING_claim_exactly_once(env):
    _on(env)
    token = _mint(env)
    verdict, uid, h = ia.verify(token)
    assert verdict == ia.VALID
    payload = ia.parse_payload(json.dumps(GOOD).encode())
    results, barrier = [], threading.Barrier(8)

    def go():
        barrier.wait()
        results.append(ia.claim_receipt(uid, payload, h))

    threads = [threading.Thread(target=go) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    assert len(results) == 8
    assert sum(1 for r in results if r is not None) == 1, results


# ── 7. delivery: the owner's bell, never the admin Discord ──────────────────

def test_delivery_goes_through_deliver_alert_payload_to_the_OWNER(env):
    _on(env)
    token = _mint(env)
    assert _fire(env, token).status_code == 202
    (d,) = env["delivered"]
    assert d["user_id"] == U_A and d["sym"] == "NVDA"
    assert d["title"] == "TradingView alert: NVDA"
    assert d["message"] == "Crossed my level (price 123.45)"
    assert _receipts(env) == [(U_A, "NVDA", "delivered")]
    assert ia.counts().get(ia.DELIVERED) == 1


def test_the_REAL_delivery_never_reaches_the_admin_discord(env):
    """No spy on the hook itself: the real deliver_alert_payload runs, with every
    transport under test control and a webhook URL SET, so a Discord post would
    be attempted if anything routed one."""
    import api.services.alerts as alerts_svc
    import api.services.alert_durability as durable
    import api.services.watchlist_alert_service as was
    from api.services.cache import cache
    env["monkeypatch"].undo()               # restores the real deliver_alert_payload …
    import api.services.auth_db as adb      # … so re-apply only what this test needs
    db = env["db"]

    def _conn():
        k = sqlite3.connect(db, timeout=5)
        k.row_factory = sqlite3.Row
        return k

    mp = pytest.MonkeyPatch()
    try:
        mp.setattr(adb, "get_connection", _conn)
        # watchlist_alert_service binds get_connection at IMPORT, so the owner's
        # email lookup needs its own patch (measured: without it the result
        # depended on which suite ran first).
        mp.setattr(was, "get_connection", _conn)
        mp.setattr(ia, "_clock", lambda: T0)
        mp.setattr(iar, "_dispatch", lambda fn, *a: fn(*a))
        mp.setattr(durable, "should_persist", lambda alert: False)
        mp.setenv(ia.FLAG, "1")
        mp.setenv("DISCORD_WEBHOOK_URL", "https://discord.invalid/api/webhooks/1/x")
        posts, emails = [], []
        mp.setattr(alerts_svc, "_fire_discord", lambda alert: posts.append(alert) or True)
        import requests
        mp.setattr(requests, "post", lambda *a, **k: posts.append(a))
        mp.setattr(was, "send_email", lambda to, subj, html: emails.append(to) or True)
        cache.invalidate(alerts_svc._user_key(U_A))
        cache.invalidate(alerts_svc._user_key(U_B))
        broadcast_before = list(cache.get(alerts_svc._BROADCAST_KEY) or [])

        token = _mint(env, U_A)
        assert _fire(env, token).status_code == 202
        mine = cache.get(alerts_svc._user_key(U_A)) or []
        assert [a["type"] for a in mine] == [ia.SOURCE]
        assert mine[0]["user_id"] == U_A and mine[0]["data"]["origin"] == "tradingview"
        assert not (cache.get(alerts_svc._user_key(U_B)) or [])
        assert (cache.get(alerts_svc._BROADCAST_KEY) or []) == broadcast_before
        assert emails == [EMAILS[U_A]]
        assert posts == [], "a member's private TradingView alert reached a Discord webhook"
        assert _receipts(env) == [(U_A, "NVDA", "delivered")]
    finally:
        mp.undo()
        cache.invalidate(alerts_svc._user_key(U_A))


def test_the_3_SECOND_BUDGET_holds_while_delivery_is_slow(env):
    """TradingView drops a webhook not answered in 3 s. Delivery (an email is up
    to a 10 s call) must therefore run AFTER the answer."""
    _on(env)
    token = _mint(env)
    release, started = threading.Event(), threading.Event()
    import api.services.watchlist_alert_service as was

    def slow(*a, **k):
        started.set()
        release.wait(10)
        return {"claimed": True, "channels": {}, "channels_ok": 1,
                "channels_failed": 0, "errors": {}}

    env["monkeypatch"].setattr(was, "deliver_alert_payload", slow)
    env["monkeypatch"].setattr(iar, "_dispatch", lambda fn, *a: iar._POOL.submit(fn, *a))
    try:
        t = time.monotonic()
        r = _fire(env, token)
        elapsed = time.monotonic() - t
        assert r.status_code == 202
        assert elapsed < 3.0, f"the hook took {elapsed:.2f}s"
        assert started.wait(5), "delivery never started"
    finally:
        release.set()


def test_the_per_TOKEN_rate_limit_refuses_and_leaves_other_members_alone(env):
    _on(env)
    env["monkeypatch"].setenv(ia.RATE_ENV, "2/minute")
    tok_a, tok_b = _mint(env, U_A), _mint(env, U_B)
    assert _fire(env, tok_a, {"ticker": "A1"}).status_code == 202
    assert _fire(env, tok_a, {"ticker": "A2"}).status_code == 202
    limited = _fire(env, tok_a, {"ticker": "A3"})
    assert limited.status_code == 429 and limited.headers["retry-after"] == "60"
    assert ia.counts().get(ia.RATE_LIMITED) == 1
    assert _fire(env, tok_b, {"ticker": "B1"}).status_code == 202


# ── the audit, the census, the boundary ──────────────────────────────────────

def _route(app, method, path):
    return next(r for r in app.routes
                if getattr(r, "path", "") == path and method in (r.methods or ()))


def test_the_ALLOWED_OPEN_hook_still_calls_verify(env):
    """The pairing `auth_surface_check.ALLOWED_OPEN` demands of every entry: the
    open route's inline credential check must still be in its CODE."""
    from api import auth_surface_check as asc
    key = ("POST", iar.HOOK_PATH)
    assert key in asc.ALLOWED_OPEN
    assert iar.HOOK_PATH.startswith(asc.AUDITED_PREFIXES)
    endpoint = _route(env["app"], "POST", iar.HOOK_PATH).endpoint
    # tokens are joined by spaces in the comment-stripped code
    assert asc._handler_mentions(endpoint, "ia . verify")
    assert not asc._handler_mentions(endpoint, "no_such_gate_call")      # CONTROL
    res = asc.audit_routes(env["app"])
    assert res["ok"] is True, res["ungated"]
    assert not [k for k in res["ungated"] if "inbound-alerts" in k[1]]


def test_every_OTHER_route_is_gated_by_a_real_dependency(env):
    from api import auth_surface_check as asc
    app = env["app"]
    want = {("GET", iar.RECEIVER_PATH): "get_current_user",
            ("DELETE", iar.RECEIVER_PATH): "get_current_user",
            ("POST", iar.RECEIVER_PATH): "require_paid",
            ("POST", iar.ROTATE_PATH): "require_paid",
            ("GET", iar.STATUS_PATH): "require_admin"}
    for (method, path), gate in want.items():
        assert gate in asc._guard_names_for(_route(app, method, path)), (method, path)
    assert not (asc._guard_names_for(_route(app, "POST", iar.HOOK_PATH)) & asc.GUARD_NAMES)
    # and with no session at all, a member route refuses (flag on).
    app.dependency_overrides.pop(get_current_user, None)
    _on(env)
    assert env["client"].get(iar.RECEIVER_PATH).status_code == 401


def test_the_rate_limit_census_declares_the_family():
    from api import rate_limit_policy as rlp
    hit = rlp.classify(iar.HOOK_PATH)
    assert hit == (rlp.KIND_FAMILY, "inbound-alerts", "/api/inbound-alerts")
    assert rlp.classify(iar.RECEIVER_PATH)[1] == "inbound-alerts"


_FORBIDDEN = ("order", "broker", "position", "snaptrade", "execution")


def _names(path: Path) -> set[str]:
    src = path.read_text(encoding="utf-8")
    return {t.string.lower() for t in tokenize.generate_tokens(io.StringIO(src).readline)
            if t.type == tokenize.NAME}


def test_INBOUND_ONLY_no_order_position_or_broker_write_vocabulary():
    """Acceptance (c): nothing in the receiver can name an order path, a
    position write or a brokerage call. Identifiers only -- the docstrings say
    what the boundary IS, which is why prose is excluded."""
    files = [REPO / "api" / "services" / "inbound_alerts.py",
             REPO / "api" / "routers" / "inbound_alerts.py"]
    for f in files:
        bad = sorted(n for n in _names(f) if any(w in n for w in _FORBIDDEN))
        assert not bad, f"{f.name}: {bad}"
    # CONTROL: the scan sees identifiers at all, and would see a forbidden one.
    assert "deliver_alert_payload" in _names(files[0])
    probe = REPO / "api" / "services" / "journal_two" / "broker" / "sync.py"
    assert any("broker" in n for n in _names(probe))
