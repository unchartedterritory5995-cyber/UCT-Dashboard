"""OPEN_READS_GATE -- the staged gate over TERM-026's anonymous reads.

WHAT THIS FILE EXISTS TO MAKE IMPOSSIBLE
----------------------------------------
TERM-026's census recorded 158 GET/HEAD routes answering an anonymous caller;
the owner confirmed three on production (`/api/live/massive/recent`,
`/openapi.json`, `/api/fundamentals/NVDA` -> 200). `api/open_reads_gate.py`
puts them behind ONE dependency and ONE flag. The rails, each failing for a
different reason:

  (i)   ENFORCE refuses an anonymous caller on a representative route of every
        family AND every mounting style (local router, partner router at its
        include site, a route defined in main.py, the re-served docs, the flow
        proxy) -- and admits the session each family is for.
  (ii)  UNSET is today's behaviour -- the gate returns before it reads anything.
  (iii) SHADOW counts and logs a would-deny, once per (route, minute), and never
        blocks; the log line carries no secret.
  (iv)  The one free page keeps every read it makes, for a free member, and the
        anonymously-read reference data stays anonymous.
  (v)   The auditor's census sees the gating, and `recorded_open` is a ceiling.

Plus the wiring rail: every table entry must be a real read route that
actually CARRIES the dependency -- a table row whose mount forgot the gate would
otherwise be a promise nothing keeps.

NO NETWORK. Every test here runs with outbound (non-loopback) sockets refused,
so a handler that tried to reach a provider fails loudly instead of quietly.
Sessions are synthetic: `validate_session` / `get_user_plan` are patched on
`api.services.auth_service`, which is exactly where the gate reads them (a lazy
import at call time), so the gate itself always runs.
"""
from __future__ import annotations

import json
import logging
import os
import socket
import sys

import httpx
import pytest
from fastapi import APIRouter, Depends, FastAPI
from fastapi.responses import Response
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api import auth_surface_check as asc  # noqa: E402
from api import open_reads_gate as g  # noqa: E402

REFUSALS = {401, 402, 403}

FREE = {"id": "free-1", "email": "free@example.test", "role": "member"}
PAID = {"id": "paid-1", "email": "paid@example.test", "role": "member"}
ADMIN = {"id": "adm-1", "email": "adm@example.test", "role": "admin"}
TOKENS = {"tok-free": FREE, "tok-paid": PAID, "tok-admin": ADMIN}
PLANS = {"paid-1": "pro"}

# ── representatives: one per family AND per mounting style ───────────────────
#: (path, family, how it is mounted). Refusal needs no handler to run, so any
#: route can stand here; the ADMIT list below is restricted to handlers that
#: are local and deterministic on a dev box.
REFUSE_REPS = [
    ("/api/flow-scoreboard", g.PAID, "local router include site"),
    ("/api/live/massive/recent", g.PAID, "PARTNER router (live_massive) include site"),
    ("/api/schwab/ytd-performance", g.PAID, "PARTNER router (schwab) include site"),
    ("/api/fundamentals/NVDA", g.PAID, "research family (owner-confirmed leak)"),
    ("/Darkpool-data.csv", g.PAID, "route defined in api/main.py"),
    ("/api/live/massive/status", g.ADMIN, "PARTNER router, admin family"),
    ("/api/admin/yfinance-guard", g.ADMIN, "local router, admin family"),
    ("/api/watchdog/status", g.ADMIN, "router mounted inside a try block"),
    ("/api/massive/status", g.ADMIN, "route defined in api/main.py"),
    ("/openapi.json", g.ADMIN, "FastAPI docs, re-served by install_docs"),
    ("/docs", g.ADMIN, "FastAPI docs, re-served by install_docs"),
    ("/redoc", g.ADMIN, "FastAPI docs, re-served by install_docs"),
    ("/api/auth/avatar/free-1", g.MEMBER, "member family (the free page)"),
]
ADMIT_PAID = ["/api/flow-scoreboard", "/api/live/massive/recent"]
ADMIT_ADMIN = ["/api/admin/yfinance-guard", "/api/watchdog/status",
               "/api/live/massive/status", "/openapi.json"]
ADMIT_MEMBER = ["/api/auth/avatar/free-1"]


# ── fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    real = socket.socket.connect

    def guarded(self, addr):
        host = addr[0] if isinstance(addr, tuple) else str(addr)
        if host in ("127.0.0.1", "::1", "localhost"):
            return real(self, addr)
        raise OSError(f"test_open_reads_gate: outbound network refused ({addr})")

    monkeypatch.setattr(socket.socket, "connect", guarded)


@pytest.fixture(autouse=True)
def sessions(monkeypatch):
    import api.services.auth_service as auth
    monkeypatch.setattr(auth, "validate_session",
                        lambda tok: dict(TOKENS[tok]) if tok in TOKENS else None)
    monkeypatch.setattr(auth, "get_user_plan", lambda uid: PLANS.get(uid, "free"))
    monkeypatch.delenv("PUSH_SECRET", raising=False)
    monkeypatch.delenv(g.FLAG, raising=False)
    g._COUNTS.clear()
    g._LAST_LOGGED_MINUTE.clear()


@pytest.fixture(scope="module")
def app():
    """THE REAL APP -- the object main.py hands uvicorn. A locally-built app is
    how a severed wire stays green (`test_exposed_routes_gated.py`'s lesson)."""
    from api.main import app as real_app
    return real_app


def _client(app, token=None, **headers):
    c = TestClient(app, raise_server_exceptions=False)
    if token:
        c.cookies.set("uct_session", token)
    if headers:
        c.headers.update(headers)
    return c


def _mode(monkeypatch, value):
    if value is None:
        monkeypatch.delenv(g.FLAG, raising=False)
    else:
        monkeypatch.setenv(g.FLAG, value)


# ── (i) ENFORCE ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("path,family,how", REFUSE_REPS,
                         ids=[p for p, _, _ in REFUSE_REPS])
def test_i_ENFORCE_refuses_an_anonymous_caller(app, monkeypatch, path, family, how):
    _mode(monkeypatch, "enforce")
    resp = _client(app).get(path)
    assert resp.status_code == 401, (
        f"{path} ({family}, {how}) answered an ANONYMOUS caller "
        f"{resp.status_code} under OPEN_READS_GATE=enforce -- the gate is not on "
        f"this route's mount: {resp.text[:160]}")
    assert resp.json() == {"detail": "Not authenticated"}


def test_i_ENFORCE_status_and_body_match_the_existing_gates(app, monkeypatch):
    _mode(monkeypatch, "enforce")
    free = _client(app, "tok-free")
    r = free.get("/api/flow-scoreboard")
    assert r.status_code == 402 and "paid plan" in r.json()["detail"]
    r = free.get("/api/admin/yfinance-guard")
    assert (r.status_code, r.json()) == (403, {"detail": "Admin access required"})
    r = _client(app, "tok-paid").get("/api/admin/yfinance-guard")
    assert r.status_code == 403, "a paid member is not an admin"


@pytest.mark.parametrize("path", ADMIT_PAID)
def test_i_ENFORCE_admits_a_PAID_session(app, monkeypatch, path):
    _mode(monkeypatch, "enforce")
    resp = _client(app, "tok-paid").get(path)
    assert resp.status_code == 200, (path, resp.status_code, resp.text[:200])


@pytest.mark.parametrize("path", ADMIT_ADMIN)
def test_i_ENFORCE_admits_an_ADMIN_session(app, monkeypatch, path):
    _mode(monkeypatch, "enforce")
    resp = _client(app, "tok-admin").get(path)
    assert resp.status_code == 200, (path, resp.status_code, resp.text[:200])


@pytest.mark.parametrize("path", ADMIT_MEMBER)
def test_i_ENFORCE_admits_a_FREE_member_on_the_member_family(app, monkeypatch, path):
    _mode(monkeypatch, "enforce")
    assert _client(app, "tok-free").get(path).status_code == 200


def test_i_the_PUSH_SECRET_bearer_is_the_one_bypass(app, monkeypatch):
    _mode(monkeypatch, "enforce")
    monkeypatch.setenv("PUSH_SECRET", "s3cret-for-test")
    ok = _client(app, Authorization="Bearer s3cret-for-test").get("/api/admin/yfinance-guard")
    assert ok.status_code == 200
    bad = _client(app, Authorization="Bearer wrong").get("/api/admin/yfinance-guard")
    assert bad.status_code == 401
    monkeypatch.setenv("PUSH_SECRET", "")
    blank = _client(app, Authorization="Bearer ").get("/api/admin/yfinance-guard")
    assert blank.status_code == 401, "a blank PUSH_SECRET must never open the gate"


# ── (ii) UNSET = today ───────────────────────────────────────────────────────

@pytest.mark.parametrize("value", [None, "", "off", "0", "false"])
def test_ii_UNSET_or_off_answers_exactly_as_before_and_reads_nothing(app, monkeypatch, value):
    """Off must return before the gate reads a cookie or a database: `decide`
    is replaced by a tripwire, so any call to it fails the test."""
    _mode(monkeypatch, value)

    def tripwire(*_a, **_k):
        raise AssertionError("OPEN_READS_GATE off must not evaluate a session")

    monkeypatch.setattr(g, "decide", tripwire)
    anon = _client(app)
    for path in ADMIT_PAID + ADMIT_ADMIN + ADMIT_MEMBER:
        resp = anon.get(path)
        assert resp.status_code == 200, (value, path, resp.status_code)
        assert "private" not in (resp.headers.get("cache-control") or "")
    assert g.status_snapshot()["denials"] == []


def test_ii_the_docs_still_serve_the_SAME_schema_when_off(app, monkeypatch):
    _mode(monkeypatch, None)
    anon = _client(app)
    assert anon.get("/openapi.json").json() == app.openapi()
    for path in ("/docs", "/redoc", "/docs/oauth2-redirect"):
        r = anon.get(path)
        assert r.status_code == 200 and "text/html" in r.headers["content-type"], path
    assert anon.head("/docs").status_code == 200


# ── (iii) SHADOW ─────────────────────────────────────────────────────────────

def test_iii_SHADOW_logs_a_would_deny_once_per_minute_and_never_blocks(app, monkeypatch, caplog):
    _mode(monkeypatch, "shadow")
    caplog.set_level(logging.WARNING, logger="api.open_reads_gate")
    anon = _client(app, **{"User-Agent": "python-requests/2.31",
                           "Referer": "https://uctintelligence.com/r/calendar?token=SEKRIT"})
    anon.cookies.set("uct_session", "not-a-real-session-VALUE")
    for _ in range(3):
        assert anon.get("/api/flow-scoreboard").status_code == 200   # never blocked

    lines = [r.getMessage() for r in caplog.records if "would-deny" in r.getMessage()]
    assert len(lines) == 1, lines          # once per (route, minute), not per hit
    line = lines[0]
    for needle in ("mode=shadow", "route=/api/flow-scoreboard", "method=GET",
                   "family=paid", "status=401", "ua=python",
                   "referer=uctintelligence.com/r", "session_cookie=present",
                   "bearer=absent"):
        assert needle in line, (needle, line)
    # ⛔ nothing secret or identifying reaches the log
    for secret in ("not-a-real-session-VALUE", "SEKRIT", "token=", "testclient"):
        assert secret not in line, (secret, line)

    snap = g.status_snapshot()
    assert snap["mode"] == "shadow"
    assert {"mode": "shadow", "route": "/api/flow-scoreboard", "family": "paid",
            "status": 401, "count": 3} in snap["denials"]


def test_iii_SHADOW_is_silent_for_a_caller_who_would_be_ADMITTED(app, monkeypatch, caplog):
    _mode(monkeypatch, "shadow")
    caplog.set_level(logging.WARNING, logger="api.open_reads_gate")
    assert _client(app, "tok-paid").get("/api/flow-scoreboard").status_code == 200
    assert not [r for r in caplog.records if "would-deny" in r.getMessage()]


def test_iii_an_UNKNOWN_mode_is_shadow_never_a_block_and_never_silent(app, monkeypatch, caplog):
    _mode(monkeypatch, "enforec")                     # a typo
    caplog.set_level(logging.WARNING, logger="api.open_reads_gate")
    g._warned_modes.discard("enforec")
    assert _client(app).get("/api/flow-scoreboard").status_code == 200
    msgs = " ".join(r.getMessage() for r in caplog.records)
    assert "treating it as 'shadow'" in msgs and "would-deny" in msgs


# ── (iv) THE FREE PAGE ───────────────────────────────────────────────────────

def test_iv_no_free_page_read_is_in_the_PAID_or_ADMIN_family():
    """FREE_PAGES = ['/morning-wire']. Every read that page (and its TickerPopup)
    makes must stay readable by a free member: never PAID, never ADMIN."""
    bad = sorted(p for p in g.FREE_PAGE_READS if g.family_of(p) in (g.PAID, g.ADMIN))
    assert not bad, ("free-page reads moved behind a paid/admin gate -- a free "
                     "member would lose /morning-wire:\n  " + "\n  ".join(bad))


def test_iv_the_anonymously_read_reference_data_stays_ANONYMOUS(app, monkeypatch):
    """The free page's popup ALSO reads these, and so do readers with no session
    at all (Discord Activity, the /r/chart renderer): they are in no family, and
    under enforce an anonymous GET is not refused by the gate."""
    anon_reads = ("/api/ticker-search", "/api/ticker-meta/{ticker}",
                  "/api/ticker-ipo/{ticker}", "/api/discord/activity/handoff",
                  "/api/research/snapshot/{sym}", "/api/stream/prices",
                  "/api/chart/markers/{ticker}", "/api/calendar")
    gated = sorted(p for p in anon_reads if g.family_of(p))
    assert not gated, f"anonymously-read reference data is now gated: {gated}"
    _mode(monkeypatch, "enforce")
    r = _client(app).get("/api/discord/activity/handoff?channel_id=1")
    assert r.status_code == 200, r.text[:200]


def test_iv_a_FREE_member_keeps_every_free_page_read_under_ENFORCE(app, monkeypatch):
    """End to end on the served route table: for every free-page read that is
    mounted here, the gate does not refuse a free member. Measured at the GATE
    (`classify` + `decide`), so no handler has to run."""
    from starlette.requests import Request
    by_path: dict = {}
    for r in app.routes:                      # FastAPI serves the FIRST registration
        by_path.setdefault(getattr(r, "path", None), r)
    checked = 0
    for path in g.FREE_PAGE_READS:
        route = by_path.get(path)
        if route is None:
            continue
        scope = {"type": "http", "method": "GET", "path": path, "route": route,
                 "headers": [(b"cookie", b"uct_session=tok-free")], "query_string": b""}
        hit = g.classify_request(Request(scope))
        if hit is None:
            checked += 1
            continue
        assert g.decide(Request(scope), hit[1]) is None, (
            f"{path} would refuse a FREE member ({hit[1]}) -- /morning-wire breaks")
        checked += 1
    assert checked >= 10, f"only {checked} free-page reads found in the route table"


# ── (v) THE CENSUS ───────────────────────────────────────────────────────────

#: A CEILING, not a count to match: TERM-026 measured 158 open reads on
#: 2026-09-27 and this change leaves 7, each with a written BLOCKED reason.
#: Raising it is a visible sentence in a diff: "an anonymous read was added".
OPEN_CEILING = 7


def test_v_the_census_reflects_the_gating(app):
    res = asc.audit_surface(app)
    reads = res["reads"]
    assert res["ok"] is True, (reads["ungated"], res["stale_baseline"])

    base = json.load(open(asc.READ_BASELINE_PATH, encoding="utf-8"))
    recorded_open = [r for r in base["routes"] if r["kind"] == "open"]
    assert reads["recorded"]["open"] == len(recorded_open)
    assert reads["recorded"]["open"] <= OPEN_CEILING
    for row in recorded_open:
        assert not g.family_of(row["path"]), row["path"]
        assert row["reason"].startswith("NOT GATED"), row["path"]

    # every (method, path) whose template the table classifies is counted as
    # OPEN_READS_GATE-staged -- derived from the route table, never typed.
    # A classified read that ALSO carries a hard gate (TERM-053: /api/gex/compare
    # behind get_current_user at its mount) is counted as hard-gated, which is
    # what it is: it refuses an anonymous caller whatever the flag says.
    seen, expected = set(), 0
    for route in app.routes:
        for m in sorted(getattr(route, "methods", None) or ()):
            key = (m, getattr(route, "path", ""))
            if m in ("GET", "HEAD") and key not in seen:
                seen.add(key)
                if g.family_of(key[1]) and not (
                        asc._guard_names_for(route) & asc.GUARD_NAMES):
                    expected += 1
    assert reads["flag_gated"] == expected > 0
    assert reads["flag_mode"] == g.mode()
    assert f"recorded_open={len(recorded_open)}" in asc.format_denominator(res)
    assert "OPEN_READS_GATE-staged=" in asc.format_denominator(res)


def test_v_every_table_entry_is_a_real_read_route_that_CARRIES_the_gate(app):
    """A classified template whose mount forgot the dependency is a promise
    nothing keeps. Named, so the red says which mount."""
    first: dict[str, object] = {}
    for route in app.routes:
        p = getattr(route, "path", None)
        if p and p not in first and ({"GET", "HEAD"} & set(getattr(route, "methods", None) or ())):
            first[p] = route
    missing = sorted(p for p in g.GATED_READS if p not in first)
    assert not missing, f"table entries with no served read route: {missing}"
    unwired = sorted(p for p in g.GATED_READS
                     if asc.READ_GATE_NAME not in asc._guard_names_for(first[p]))
    assert not unwired, ("classified but NOT carrying open_reads_gate (check the "
                         "include_router in api/main.py):\n  " + "\n  ".join(unwired))


def test_v_the_read_gate_is_NOT_a_gate_for_the_mutating_boot_verdict():
    """It rides on whole routers, so it sits in the tree of POSTs it never
    governs. In GUARD_NAMES it would hide an ungated POST from the boot page."""
    assert asc.READ_GATE_NAME not in asc.GUARD_NAMES
    app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)
    r = APIRouter()
    r.post("/api/flow/fixture-write")(lambda: 1)
    r.get("/api/flow/not-in-the-table")(lambda: 1)
    app.include_router(r, dependencies=[Depends(g.open_reads_gate)])
    assert ("POST", "/api/flow/fixture-write") in asc.audit_routes(app)["ungated"]
    res = asc.audit_surface(app, baseline={})
    assert ("GET", "/api/flow/not-in-the-table") in res["reads"]["ungated"], (
        "an UNCLASSIFIED read under the gate's router must still be a finding")


# ── the flow proxy: gated on web BEFORE it is forwarded ──────────────────────

@pytest.fixture
def proxy_app(monkeypatch):
    from api import flow_proxy
    calls = []

    def upstream(request: httpx.Request):
        calls.append(str(request.url))
        # a STREAMED body, as a real transport returns: the proxy reads it with
        # aiter_raw(), which refuses an already-buffered mock response
        return httpx.Response(200, headers={"content-type": "application/json"},
                              stream=httpx.ByteStream(b'{"ok": true, "via": "worker"}'))

    client = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
    monkeypatch.setattr(flow_proxy, "WORKER_INTERNAL_URL", "http://worker.test")
    monkeypatch.setattr(flow_proxy, "_get_client", lambda: client)
    a = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)
    a.include_router(flow_proxy.build_flow_proxy_router())
    return a, calls


def test_the_TAPE_is_refused_on_web_and_never_forwarded_under_enforce(proxy_app, monkeypatch):
    a, calls = proxy_app
    _mode(monkeypatch, "enforce")
    for path in ("/api/live/massive/recent", "/api/live/massive/restart-log",
                 "/api/oi-snapshot/lookup"):
        r = _client(a).get(path)
        assert r.status_code == 401, (path, r.status_code, r.text[:120])
    assert calls == [], f"an anonymous tape read reached flow-worker: {calls}"

    r = _client(a, "tok-paid").get("/api/live/massive/recent")
    assert r.status_code == 200 and r.json()["via"] == "worker"
    assert len(calls) == 1


def test_the_proxy_forwards_exactly_as_before_when_OFF(proxy_app, monkeypatch):
    a, calls = proxy_app
    _mode(monkeypatch, None)
    assert _client(a).get("/api/live/massive/recent").status_code == 200
    assert len(calls) == 1


def test_the_proxy_leaves_unclassified_paths_and_writes_alone(proxy_app, monkeypatch):
    a, calls = proxy_app
    _mode(monkeypatch, "enforce")
    assert _client(a).get("/api/flow/some-unclassified-read").status_code == 200
    assert _client(a).post("/api/live/massive/recent").status_code == 200
    assert len(calls) == 2


# ── the gate's own contract, on a fixture app ────────────────────────────────

def _fixture_app(monkeypatch):
    monkeypatch.setitem(g.GATED_READS, "/fixture/csv/{t}", g.PAID)
    monkeypatch.setattr(g, "_COMPILED", None)
    a = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)
    r = APIRouter()
    r.get("/fixture/csv/{t}")(
        lambda t: Response("a,b", headers={"Cache-Control": "public, max-age=300"}))
    r.post("/fixture/csv/{t}")(lambda t: {"wrote": t})
    a.include_router(r, dependencies=[Depends(g.open_reads_gate)])
    a.add_middleware(g.PrivateCacheForGatedReads)
    return a


def test_an_ENFORCED_admitted_answer_is_marked_PRIVATE_so_no_edge_cache_replays_it(monkeypatch):
    a = _fixture_app(monkeypatch)
    _mode(monkeypatch, "enforce")
    r = _client(a, "tok-paid").get("/fixture/csv/X")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "private, max-age=300"
    _mode(monkeypatch, None)
    r = _client(a).get("/fixture/csv/X")
    assert r.headers["cache-control"] == "public, max-age=300", "off must not touch headers"


def test_a_WRITE_method_under_a_gated_router_is_never_touched(monkeypatch):
    a = _fixture_app(monkeypatch)
    _mode(monkeypatch, "enforce")
    assert _client(a).post("/fixture/csv/X").status_code == 200


def test_the_flag_is_declared_as_a_MODE_with_OFF_as_its_default():
    from pathlib import Path
    from api.services import feature_flag_index as ffi
    repo = Path(__file__).resolve().parents[1]
    found = ffi.mode_flags([repo / "api"], repo)
    assert found[g.FLAG]["default"] == g.MODE_OFF
    assert set(found[g.FLAG]["allowed"]) == {g.MODE_OFF, g.MODE_SHADOW, g.MODE_ENFORCE}
    ledger = json.loads((repo / "docs" / "feature_flags.json").read_text(encoding="utf-8"))
    assert g.FLAG in ledger["flags"], "OPEN_READS_GATE must be declared in the ledger"


def test_the_write_shaped_GETs_are_all_ADMIN():
    assert g.WRITE_SHAPED_GETS
    for p in g.WRITE_SHAPED_GETS:
        assert g.family_of(p) == g.ADMIN, p
