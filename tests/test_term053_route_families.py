"""TERM-053 (FB-S9-02) -- the six route families ARCH-06 §2.2 found dependency-less.

WHAT THE SIX ARE (security-entitlement-architecture.md §2.2, the red rows)
---------------------------------------------------------------------------
  1. GET /api/gex/compare                         -- four lines below the OI-17-gated /data
  2. GET /api/dealer-positioning/{status,sample,flow-sources}
  3. GET /api/stream/prices                       -- the real-time price SSE
  4. GET /api/flow-scoreboard                     -- "open by design" per its docstring
  5. GET /api/r/*                                 -- the render panels, token-gated
  6. GET /api/breadth-monitor/{live-diag,live/reconcile}  -- "not determined"

WHAT EACH ONE IS NOW, measured 2026-09-29 against api.main:app
--------------------------------------------------------------
  1. HARD-GATED here: `get_current_user` attached at the gex router's MOUNT, so
     every route it has or later gains needs a session. OPEN_READS_GATE still
     layers PAID on top under `enforce`. No caller anywhere (this repo, morning-
     wire, uct-intelligence, uct-sunday-scan, uct-clips, uct-monitor).
  2. STAGED by OPEN_READS_GATE (family ADMIN) at BOTH web layers -- the local
     include site and flow_proxy's forwarder (the router is also mounted on
     flow-worker, which web forwards to). Its two POSTs are `require_flow_admin`.
     Not hard-gated here: web's only layer under the proxy is the forwarder, and
     the flag is the owner's switch for that layer.
  3. OPEN, BLOCKED ON AN OWNER CALL: the free page opens it for a free member and
     the Discord Activity (/r/activity) opens it with NO session. Recorded
     `kind=open` in the read baseline with that reason.
  4. STAGED by OPEN_READS_GATE (family PAID). Live readers are the paid Flow
     Record page and the Dashboard tile; its "public by design" docstring is the
     owner's to overrule, which the enforce flip does.
  5. INLINE token (`_check_token`, fail-closed, constant-time). The token is baked
     into the frontend bundle (VITE_CHART_RENDER_TOKEN), so it is effectively
     public; closing that needs the build var removed + a rotation (OI-13), a
     Railway/owner action. Readers: morning-wire panelshot, /buzz, Sunday Scan,
     the headless /r/* pages.
  6. ALREADY CLOSED, INLINE: `_check_auth` (PUSH_SECRET bearer) is the first
     statement of each handler -- 401 anonymous. ARCH-06 had not read the body.
     This item made the compare constant-time (responses unchanged).

Each test names its family so a red says which door moved.

NO NETWORK. Outbound sockets are refused; sessions are synthetic, patched where
BOTH gates read them (`get_current_user` imports `validate_session` by name).
"""
from __future__ import annotations

import json
import os
import socket
import sys
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api import auth_surface_check as asc  # noqa: E402
from api import open_reads_gate as g  # noqa: E402

FREE = {"id": "free-53", "email": "free53@example.test", "role": "member"}
PAID = {"id": "paid-53", "email": "paid53@example.test", "role": "member"}
ADMIN = {"id": "adm-53", "email": "adm53@example.test", "role": "admin"}
TOKENS = {"tok53-free": FREE, "tok53-paid": PAID, "tok53-admin": ADMIN}
PLANS = {"paid-53": "pro"}

PUSH = "term053-push-secret"
RENDER_TOKEN = "term053-render-token"

GEX_PREFIX = "/api/gex"
DEALER_READS = ("/api/dealer-positioning/status", "/api/dealer-positioning/sample",
                "/api/dealer-positioning/flow-sources")
BREADTH_DIAG = ("/api/breadth-monitor/live-diag", "/api/breadth-monitor/live/reconcile")
FAMILY_PREFIXES = ("/api/gex", "/api/dealer-positioning", "/api/stream",
                   "/api/flow-scoreboard", "/api/r/", "/api/breadth-monitor")


# ── fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    real = socket.socket.connect

    def guarded(self, addr):
        host = addr[0] if isinstance(addr, tuple) else str(addr)
        if host in ("127.0.0.1", "::1", "localhost"):
            return real(self, addr)
        raise OSError(f"test_term053: outbound network refused ({addr})")

    monkeypatch.setattr(socket.socket, "connect", guarded)


@pytest.fixture(autouse=True)
def sessions(monkeypatch):
    import api.middleware.auth_middleware as mw
    import api.services.auth_service as auth
    lookup = (lambda tok: dict(TOKENS[tok]) if tok in TOKENS else None)
    monkeypatch.setattr(auth, "validate_session", lookup)
    monkeypatch.setattr(mw, "validate_session", lookup)   # get_current_user's own name
    monkeypatch.setattr(auth, "get_user_plan", lambda uid: PLANS.get(uid, "free"))
    monkeypatch.setenv("PUSH_SECRET", PUSH)
    monkeypatch.delenv(g.FLAG, raising=False)
    g._COUNTS.clear()
    g._LAST_LOGGED_MINUTE.clear()


@pytest.fixture(scope="module")
def app():
    """THE REAL APP -- a locally-built one cannot see a severed mount."""
    from api.main import app as real_app
    return real_app


def _client(app, token=None, **headers):
    c = TestClient(app, raise_server_exceptions=False)
    if token:
        c.cookies.set("uct_session", token)
    if headers:
        c.headers.update(headers)
    return c


def _first_route(app, method, path):
    for r in app.routes:
        if getattr(r, "path", None) == path and method in (getattr(r, "methods", None) or ()):
            return r
    raise AssertionError(f"{method} {path} is not registered on api.main:app")


def _verdict(app, method, path):
    """The census's own classification for one (method, path), from the same
    predicates `audit_surface` uses -- never retyped."""
    route = _first_route(app, method, path)
    names = asc._guard_names_for(route)
    if names & asc.GUARD_NAMES:
        return "hard"
    if asc.READ_GATE_NAME in names and g.family_of(path):
        return f"staged:{g.family_of(path)}"
    entry = asc.load_read_baseline().get((method, path))
    if entry is None:
        return "UNRECORDED"
    if entry["kind"] == "inline":
        assert asc._handler_mentions(route.endpoint, entry["marker"]), (
            f"{path}: baseline says inline {entry['marker']} but the handler no "
            "longer calls it")
        return f"inline:{entry['marker']}"
    return entry["kind"]


# ── the census reports every family as the verdict above ─────────────────────

def test_census_family_1_gex_every_read_is_HARD_gated(app):
    reads = [(m, r.path) for r in app.routes
             if getattr(r, "path", "").startswith(GEX_PREFIX + "/")
             for m in (getattr(r, "methods", None) or ()) if m == "GET"]
    assert {p for _, p in reads} >= {"/api/gex/data", "/api/gex/compare"}, reads
    for m, p in reads:
        assert _verdict(app, m, p) == "hard", p


def test_census_family_1_gex_gate_lives_at_the_MOUNT_not_the_route():
    """The class, not the instance: /compare's own route declares no auth, so
    the session requirement it now has comes from the include site -- and a
    route added to this router tomorrow inherits it."""
    from api.gex_router import router as gex_router
    compare = next(r for r in gex_router.routes if r.path.endswith("/compare"))
    assert not (asc._guard_names_for(compare) & asc.GUARD_NAMES), (
        "the /compare route itself now declares a gate -- fine, but then the "
        "mount-level gate is no longer what this test proves")


def test_census_family_2_dealer_reads_staged_ADMIN_writes_hard(app):
    for p in DEALER_READS:
        assert _verdict(app, "GET", p) == "staged:admin", p
        # the forwarder layer: flow_proxy classifies the CONCRETE path
        assert g.classify_concrete(p) == (p, g.ADMIN), p
    for p in ("/api/dealer-positioning/backfill", "/api/dealer-positioning/compute/{snap_date}"):
        assert _verdict(app, "POST", p) == "hard", p


def test_census_family_3_stream_prices_recorded_OPEN_with_the_owner_blocker(app):
    assert _verdict(app, "GET", "/api/stream/prices") == "open"
    entry = asc.load_read_baseline()[("GET", "/api/stream/prices")]
    assert entry["reason"].startswith("NOT GATED - BLOCKED")
    for needle in ("Discord Activity", "owner call"):
        assert needle in entry["reason"], needle
    # and it is deliberately NOT in the staged table: the Discord Activity reads
    # it with no session. (Until 2026-10-02 the free page was a second reason and
    # it sat in FREE_PAGE_READS; the "everything is paywall" ruling emptied that.)
    assert g.family_of("/api/stream/prices") is None
    assert "/api/stream/prices" not in g.FREE_PAGE_READS


def test_census_family_4_flow_scoreboard_staged_PAID(app):
    for p in ("/api/flow-scoreboard", "/api/flow-scoreboard/"):
        assert _verdict(app, "GET", p) == "staged:paid", p


def test_census_family_5_render_panels_inline_TOKEN(app):
    panels = sorted({r.path for r in app.routes
                     if getattr(r, "path", "").startswith("/api/r/")
                     and "GET" in (getattr(r, "methods", None) or ())
                     and getattr(r.endpoint, "__module__", "") == "api.routers.render_panels"})
    assert len(panels) >= 12, panels   # ARCH-06 named twelve
    for p in panels:
        assert _verdict(app, "GET", p) == "inline:_check_token", p


def test_census_family_6_breadth_diag_inline_PUSH_SECRET(app):
    for p in BREADTH_DIAG:
        assert _verdict(app, "GET", p) == "inline:_check_auth", p


def test_census_no_family_route_is_unrecorded_or_stale(app):
    res = asc.audit_surface(app)
    fam = lambda k: k[1].startswith(FAMILY_PREFIXES)  # noqa: E731
    assert not [k for k in res["reads"]["ungated"] if fam(k)]
    assert not [k for k in res["stale_baseline"] if fam(k)]
    assert not [k for k in res["inline_marker_missing"] if fam(k)]


def test_every_WRITE_in_the_six_families_is_gated(app):
    """A write needs no shadow period. Derived from the route table: every
    mutating route under the six prefixes carries a Depends gate or calls its
    router's inline PUSH_SECRET check first thing. The census's own boot check
    does not audit these prefixes, so this is where a new ungated POST shows."""
    inline_markers = {"api.routers.breadth_monitor": "_check_auth",
                      "api.routers.chart_edge_service": "_push_secret_ok"}
    seen, bad = 0, []
    for r in app.routes:
        p = getattr(r, "path", "") or ""
        if not p.startswith(FAMILY_PREFIXES):
            continue
        for m in sorted(getattr(r, "methods", None) or ()):
            if m not in asc.MUTATING:
                continue
            seen += 1
            if asc._guard_names_for(r) & asc.GUARD_NAMES:
                continue
            marker = inline_markers.get(getattr(r.endpoint, "__module__", ""))
            if marker and asc._handler_mentions(r.endpoint, marker):
                continue
            bad.append((m, p))
    # non-vacuity: the families really do have writes (breadth pushes, dealer
    # backfill, the edge token) -- an empty walk would pass everything.
    assert seen >= 20, seen
    assert not bad, bad


def test_the_write_rail_can_see_a_missing_gate(app):
    """Control: an inline marker the handler does not call is caught."""
    route = _first_route(app, "POST", "/api/breadth-monitor/push")
    assert asc._handler_mentions(route.endpoint, "_check_auth")
    assert not asc._handler_mentions(route.endpoint, "_no_such_gate_term053")


# ── family 1: GEX -- anonymous 401, a session admitted ───────────────────────

@pytest.fixture
def gex_stub():
    with patch("api.gex_router.get_gex_compare", new_callable=AsyncMock,
               return_value={"ticker": "SPY", "stub": "term053"}) as m:
        yield m


def test_family_1_gex_compare_ANONYMOUS_is_401_with_the_flag_OFF(app, gex_stub):
    r = _client(app).get("/api/gex/compare?ticker=SPY")
    assert r.status_code == 401, r.text[:200]
    assert r.json() == {"detail": "Not authenticated"}
    gex_stub.assert_not_called()


def test_family_1_gex_compare_bearer_is_not_a_session(app, gex_stub):
    """No internal reader exists; the machine credential is not honoured here
    (get_current_user reads a session only)."""
    r = _client(app, authorization=f"Bearer {PUSH}").get("/api/gex/compare?ticker=SPY")
    assert r.status_code == 401
    gex_stub.assert_not_called()


def test_family_1_gex_compare_SESSION_is_admitted(app, gex_stub):
    r = _client(app, "tok53-free").get("/api/gex/compare?ticker=SPY")
    assert r.status_code == 200, r.text[:200]
    assert r.json()["stub"] == "term053"


def test_family_1_gex_compare_under_ENFORCE_needs_PAID(app, gex_stub, monkeypatch):
    monkeypatch.setenv(g.FLAG, "enforce")
    assert _client(app).get("/api/gex/compare?ticker=SPY").status_code == 401
    assert _client(app, "tok53-free").get("/api/gex/compare?ticker=SPY").status_code == 402
    assert _client(app, "tok53-paid").get("/api/gex/compare?ticker=SPY").status_code == 200


def test_family_1_gex_data_unchanged(app):
    with patch("api.gex_router.get_gex_data", new_callable=AsyncMock,
               return_value={"ticker": "SPY", "strikes": []}):
        assert _client(app).get("/api/gex/data?ticker=SPY").status_code == 401
        assert _client(app, "tok53-free").get("/api/gex/data?ticker=SPY").status_code == 200


# ── family 2: dealer positioning -- staged ADMIN ─────────────────────────────

@pytest.mark.parametrize("path", DEALER_READS)
def test_family_2_dealer_ENFORCE_refuses_anonymous_and_members(app, monkeypatch, path):
    monkeypatch.setenv(g.FLAG, "enforce")
    assert _client(app).get(path).status_code == 401
    r = _client(app, "tok53-paid").get(path)
    assert (r.status_code, r.json()) == (403, {"detail": "Admin access required"})


@pytest.mark.parametrize("path", DEALER_READS)
def test_family_2_dealer_ENFORCE_admits_admin_and_the_machine_bearer(app, monkeypatch, path):
    monkeypatch.setenv(g.FLAG, "enforce")
    for c in (_client(app, "tok53-admin"), _client(app, authorization=f"Bearer {PUSH}")):
        assert c.get(path).status_code not in (401, 402, 403), path


# ── family 3: stream/prices -- left open, and stays so under enforce ─────────

def test_family_3_stream_prices_is_not_refused_under_enforce(app, monkeypatch):
    """Documented-open: the gate must not close it (the free page + Activity).
    Called in-process -- a refusal raises before the stream is built."""
    import asyncio
    from starlette.requests import Request
    monkeypatch.setenv(g.FLAG, "enforce")
    route = _first_route(app, "GET", "/api/stream/prices")
    scope = {"type": "http", "method": "GET", "path": "/api/stream/prices",
             "headers": [], "query_string": b"tickers=SPY", "route": route}
    assert asyncio.run(g.open_reads_gate(Request(scope))) is None


# ── family 4: flow scoreboard -- staged PAID ─────────────────────────────────

def test_family_4_flow_scoreboard_ENFORCE_anonymous_401_free_402_paid_admitted(app, monkeypatch):
    monkeypatch.setenv(g.FLAG, "enforce")
    assert _client(app).get("/api/flow-scoreboard").status_code == 401
    assert _client(app, "tok53-free").get("/api/flow-scoreboard").status_code == 402
    assert _client(app, "tok53-paid").get("/api/flow-scoreboard").status_code == 200


# ── family 5: render panels -- the render token ──────────────────────────────

@pytest.fixture
def render_token(monkeypatch):
    from api.routers import render_panels as rp
    monkeypatch.setenv("CHART_RENDER_TOKEN", RENDER_TOKEN)
    monkeypatch.delenv("CHART_RENDER_TOKEN_PREVIOUS", raising=False)
    monkeypatch.delenv("ADMIN_EMAILS", raising=False)
    monkeypatch.setattr(rp, "_RL", [])
    monkeypatch.setattr(rp, "_RL_BUCKETS", {})
    yield


def test_family_5_render_panel_without_or_with_a_wrong_token_is_403(app, render_token):
    c = _client(app)
    assert c.get("/api/r/chart-settings").status_code == 403
    assert c.get("/api/r/chart-settings?token=wrong").status_code == 403


def test_family_5_render_panel_with_the_render_token_is_admitted(app, render_token):
    r = _client(app).get(f"/api/r/chart-settings?token={RENDER_TOKEN}")
    assert r.status_code == 200, r.text[:200]
    assert r.json()["chart_settings"] is None   # ADMIN_EMAILS unset -> safe default


# ── family 6: breadth diagnostics -- PUSH_SECRET bearer ──────────────────────

@pytest.fixture
def breadth_push(monkeypatch):
    from api.routers import breadth_monitor as bm
    from api.services import breadth_live as bl
    monkeypatch.setattr(bm, "_PUSH_SECRET", PUSH)
    monkeypatch.setattr(bl, "enabled", lambda: False)
    monkeypatch.setattr(bl, "reconcile", lambda date, basis=None: {"stub": "term053"})
    yield


@pytest.mark.parametrize("path", [
    "/api/breadth-monitor/live-diag",
    "/api/breadth-monitor/live/reconcile?date=2026-09-25",
])
def test_family_6_breadth_diag_anonymous_and_wrong_bearer_are_401(app, breadth_push, path):
    assert _client(app).get(path).status_code == 401
    assert _client(app, authorization="Bearer nope").get(path).status_code == 401
    # a member session is not the machine credential
    assert _client(app, "tok53-admin").get(path).status_code == 401


def test_family_6_breadth_diag_the_bearer_is_admitted(app, breadth_push):
    c = _client(app, authorization=f"Bearer {PUSH}")
    assert c.get("/api/breadth-monitor/live-diag").json() == {"enabled": False}
    r = c.get("/api/breadth-monitor/live/reconcile?date=2026-09-25")
    assert (r.status_code, r.json()) == (200, {"stub": "term053"})


def test_family_6_the_compare_is_constant_time():
    """`!=` on a secret leaks the matched-prefix length; the check must go
    through hmac.compare_digest like push.py's `_bearer_ok`."""
    import ast
    import inspect
    from api.routers import breadth_monitor as bm
    tree = ast.parse(inspect.getsource(bm._check_auth))
    calls = {ast.unparse(n.func) for n in ast.walk(tree) if isinstance(n, ast.Call)}
    assert "hmac.compare_digest" in calls, calls
    assert not [n for n in ast.walk(tree)
                if isinstance(n, ast.Compare) and any(isinstance(o, ast.NotEq) for o in n.ops)]


def test_family_6_unset_secret_still_500(app, monkeypatch):
    from api.routers import breadth_monitor as bm
    monkeypatch.setattr(bm, "_PUSH_SECRET", "")
    r = _client(app, authorization="Bearer ").get("/api/breadth-monitor/live-diag")
    assert r.status_code == 500


# ── the baseline file carries every left-open family with its reason ─────────

def test_every_route_left_open_is_recorded_with_a_reason():
    base = json.load(open(asc.READ_BASELINE_PATH, encoding="utf-8"))
    by_key = {(r["method"], r["path"]): r for r in base["routes"]}
    left_open = [("GET", "/api/stream/prices")] + [("GET", p) for p in BREADTH_DIAG]
    for k in left_open:
        assert k in by_key and by_key[k]["reason"].strip(), k
    renders = [k for k in by_key if k[1].startswith("/api/r/")]
    assert len(renders) >= 12
    for k in renders:
        assert "EFFECTIVELY PUBLIC" in by_key[k]["reason"].upper() \
            or "effectively public" in by_key[k]["reason"], k
