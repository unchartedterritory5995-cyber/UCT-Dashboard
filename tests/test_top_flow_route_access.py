"""Three access fixes on the Top Flow routes and the option quote route (2026-11-17).

  * POST /api/top-flow/snapshot   one sweep at a time; a second request is answered at once.
                                  Gate unchanged (any signed-in session): its in-app caller is
                                  the Tracker tab's "Fetch Live Prices" button, which every
                                  member has.
  * POST /api/top-flow/save       admin session or service token, like the other write routes
                                  in that router. Its one in-app caller runs only after the
                                  admin-gated Discord push answers ok.
  * POST /api/schwab/options-quotes  signed-in session or service token (it had no check).

Each router is mounted on a small app of its own. No vendor is called: the Unusual Whales batch
(the route's first source since Schwab was retired the same day)
function and the tracker's sweep are replaced, and a signed-in request is a cookie the
faked session check recognises.
"""
from __future__ import annotations

import asyncio
import pathlib
import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.flow_admin_auth as flow_auth
import api.schwab_router as schwab_router
import api.uw_service as uw
import api.top_flow_router as top_flow_router
import api.top_flow_tracker as tracker

REPO = pathlib.Path(__file__).resolve().parents[1]
SESSIONS = {"member-cookie": {"id": "u1", "role": "member"}, "admin-cookie": {"id": "u2", "role": "admin"}}
MEMBER = {"uct_session": "member-cookie"}
ADMIN = {"uct_session": "admin-cookie"}


@pytest.fixture
def auth(monkeypatch):
    monkeypatch.setattr(flow_auth, "validate_session", lambda cookie: SESSIONS.get(cookie))
    monkeypatch.setenv("PUSH_SECRET", "test-push-secret")
    monkeypatch.delenv("FLOW_PROXY_TRUST", raising=False)


def _client(router, cookies=None):
    app = FastAPI()
    app.include_router(router)
    return TestClient(app, cookies=cookies or {})


def _app_sources():
    """Every script file under app/src (the app's own code; no data files)."""
    return [p for p in (REPO / "app" / "src").rglob("*")
            if p.suffix in (".js", ".jsx", ".ts", ".tsx", ".mjs") and "node_modules" not in p.parts]


def _gate_names(router, method, path):
    route = next(r for r in router.routes if r.path == path and method in r.methods)
    return {d.call.__name__ for d in route.dependant.dependencies if d.call is not None}


# ── POST /api/top-flow/save ───────────────────────────────────────────────────

PICKS = [{"sym": "AAPL", "cp": "C", "strike": 200, "exp": "12/18/2026", "entry": 5.0, "grade": "A"}]


@pytest.fixture
def save_spy(monkeypatch):
    calls = []

    def _save(picks):
        calls.append(picks)
        return {"added": len(picks), "updated": 0, "total": len(picks)}

    monkeypatch.setattr(tracker, "save_picks", _save)
    return calls


def test_save_refuses_a_signed_out_caller_and_a_signed_in_member(auth, save_spy):
    assert _client(top_flow_router.router).post("/api/top-flow/save", json=PICKS).status_code == 403
    assert _client(top_flow_router.router, MEMBER).post("/api/top-flow/save", json=PICKS).status_code == 403
    assert save_spy == []                                   # refused before the handler ran


def test_save_serves_an_admin_session_and_the_service_token(auth, save_spy):
    resp = _client(top_flow_router.router, ADMIN).post("/api/top-flow/save", json=PICKS)
    assert resp.status_code == 200 and resp.json() == {"added": 1, "updated": 0, "total": 1}
    resp = _client(top_flow_router.router).post("/api/top-flow/save", json=PICKS,
                                                headers={"Authorization": "Bearer test-push-secret"})
    assert resp.status_code == 200
    assert len(save_spy) == 2 and save_spy[0][0]["sym"] == "AAPL"


def test_the_save_gate_is_the_admin_door_its_neighbours_use():
    assert _gate_names(top_flow_router.router, "POST", "/api/top-flow/save") == {"require_flow_admin"}
    for path in ("/api/top-flow/wipe", "/api/top-flow/archive-now", "/api/top-flow/migrate-entries",
                 "/api/top-flow/purge-old/{keep_days}"):
        assert _gate_names(top_flow_router.router, "POST", path) == {"require_flow_admin"}, path


def test_the_one_in_app_caller_of_save_runs_only_after_the_admin_gated_discord_push():
    """Why the admin gate breaks no member: the only `/api/top-flow/save` call in the app is
    inside wlPushDiscord, after `/api/discord/push` (require_flow_admin) answered ok. If a
    second caller appears, or the push loses its gate, this fails and the gate needs a rethink."""
    src = (REPO / "app" / "src" / "pages" / "OptionsFlow.jsx").read_text(encoding="utf-8")
    calls = [m.start() for m in re.finditer(r'fetch\(\s*"/api/top-flow/save"', src)]
    assert len(calls) == 1
    start = src.index("const wlPushDiscord = async")
    push = src.index('fetch("/api/discord/push"', start)
    ok = src.index("if (data.ok)", push)
    assert start < push < ok < calls[0]
    assert src.index("\n  const ", start + 10) > calls[0]   # still inside that one function
    others = [p.name for p in _app_sources() if p.name != "OptionsFlow.jsx"
              and re.search(r"/api/top-flow/save[\"'`]", p.read_text(encoding="utf-8", errors="replace"))]
    assert others == []
    discord = (REPO / "api" / "discord_watchlist.py").read_text(encoding="utf-8")
    gate = discord[discord.index('@app_or_router.post("/api/discord/push")'):][:400]
    assert "Depends(require_flow_admin)" in gate


# ── POST /api/top-flow/snapshot ───────────────────────────────────────────────

def test_snapshot_keeps_its_signed_in_gate(auth, monkeypatch):
    assert _gate_names(top_flow_router.router, "POST", "/api/top-flow/snapshot") == {"require_flow_user"}
    assert _client(top_flow_router.router).post("/api/top-flow/snapshot").status_code == 401


def test_a_second_snapshot_request_is_answered_at_once_and_starts_nothing(monkeypatch):
    monkeypatch.setattr(top_flow_router, "_snapshot_task", None)
    monkeypatch.setattr(tracker, "_snapshot_running", False)
    started = []

    async def scenario():
        release = asyncio.Event()

        async def _sweep():
            started.append(1)
            await release.wait()
            return {"status": "ok"}

        monkeypatch.setattr(tracker, "snapshot_prices", _sweep)
        first = await top_flow_router.trigger_snapshot(_auth={})
        await asyncio.sleep(0)                              # let the sweep begin
        second = await top_flow_router.trigger_snapshot(_auth={})
        third = await top_flow_router.trigger_snapshot(_auth={})
        running = len(started)
        release.set()
        await top_flow_router._snapshot_task
        after = await top_flow_router.trigger_snapshot(_auth={})
        await top_flow_router._snapshot_task
        return first, second, third, running, after

    first, second, third, running, after = asyncio.run(scenario())
    assert first["status"] == "started"
    assert second["status"] == "already_running" and third["status"] == "already_running"
    assert running == 1                                     # the repeats started no sweep
    assert after["status"] == "started" and len(started) == 2      # once it finished, a new one may start


def test_a_request_made_before_the_first_sweep_has_begun_is_still_refused(monkeypatch):
    """Two clicks in the same instant: the first task exists but has not run a line yet."""
    monkeypatch.setattr(top_flow_router, "_snapshot_task", None)
    monkeypatch.setattr(tracker, "_snapshot_running", False)
    started = []

    async def scenario():
        async def _sweep():
            started.append(1)
            return {"status": "ok"}

        monkeypatch.setattr(tracker, "snapshot_prices", _sweep)
        first = await top_flow_router.trigger_snapshot(_auth={})
        second = await top_flow_router.trigger_snapshot(_auth={})   # no await in between
        await top_flow_router._snapshot_task
        return first, second

    first, second = asyncio.run(scenario())
    assert (first["status"], second["status"]) == ("started", "already_running") and started == [1]


def test_the_manual_route_stands_down_while_the_scheduled_sweep_runs(monkeypatch):
    monkeypatch.setattr(top_flow_router, "_snapshot_task", None)
    monkeypatch.setattr(tracker, "_snapshot_running", True)         # the 4:30 PM run is in flight
    called = []

    async def _sweep():
        called.append(1)

    monkeypatch.setattr(tracker, "snapshot_prices", _sweep)
    answer = asyncio.run(top_flow_router.trigger_snapshot(_auth={}))
    assert answer["status"] == "already_running" and called == []
    assert top_flow_router._snapshot_task is None


def test_a_sweep_that_fails_does_not_wedge_the_route(monkeypatch):
    monkeypatch.setattr(top_flow_router, "_snapshot_task", None)
    monkeypatch.setattr(tracker, "_snapshot_running", False)

    async def scenario():
        async def _dies():
            raise RuntimeError("sweep failed")

        monkeypatch.setattr(tracker, "snapshot_prices", _dies)
        first = await top_flow_router.trigger_snapshot(_auth={})
        await top_flow_router._snapshot_task                # the route's own wrapper swallows it
        return first, await top_flow_router.trigger_snapshot(_auth={})

    first, again = asyncio.run(scenario())
    assert first["status"] == "started" and again["status"] == "started"


# ── POST /api/schwab/options-quotes ───────────────────────────────────────────

# a contract that has not expired on the day the test runs (the route's own expiry check is real)
_EXP = (__import__("datetime").date.today() + __import__("datetime").timedelta(days=45)).isoformat()
BODY = [{"symbol": "AAPL", "strike": 200, "expDate": _EXP, "cp": "C"}]
QUOTE = {"symbol": "AAPL", "strike": 200.0, "cp": "C", "mark": 6.3, "last": 6.2, "bid": 6.2, "ask": 6.4,
         "openInterest": 1400, "underlyingPrice": 231.5, "volume": 320, "iv": 0.3, "delta": 0.5,
         "gamma": 0.01, "theta": -0.1}
SERVED = {**QUOTE, "_source": "uw"}       # the route marks which source priced a contract


@pytest.fixture
def quotes_spy(monkeypatch):
    calls = []

    async def _batch(contracts):
        calls.append(contracts)
        return [dict(QUOTE) for _ in contracts]

    monkeypatch.setattr(uw, "get_batch_quotes", _batch)
    return calls


def test_options_quotes_refuses_a_signed_out_request(auth, quotes_spy):
    resp = _client(schwab_router.router).post("/api/schwab/options-quotes", json=BODY)
    assert resp.status_code == 401 and resp.json() == {"detail": "Not authenticated"}
    assert quotes_spy == []                                 # refused before any vendor was asked
    # a cookie that is not a session is signed out too
    assert _client(schwab_router.router, {"uct_session": "stale"}).post(
        "/api/schwab/options-quotes", json=BODY).status_code == 401


def test_options_quotes_serves_a_signed_in_member_and_the_service_token(auth, quotes_spy):
    resp = _client(schwab_router.router, MEMBER).post("/api/schwab/options-quotes", json=BODY)
    assert resp.status_code == 200
    assert resp.json() == {"quotes": [SERVED]}
    resp = _client(schwab_router.router).post("/api/schwab/options-quotes", json=BODY,
                                              headers={"Authorization": "Bearer test-push-secret"})
    assert resp.status_code == 200 and len(quotes_spy) == 2


def test_the_gate_is_the_one_its_sibling_routes_use():
    assert _gate_names(schwab_router.router, "POST", "/api/schwab/options-quotes") == {"require_flow_user"}
    assert _gate_names(schwab_router.router, "GET", "/api/schwab/market-narrative") == {"require_flow_user"}


def test_a_plain_function_call_still_gets_its_answer_with_no_session(quotes_spy):
    """The gate is a default argument the body never reads, so calling the handler as a plain
    function works. api/oi_snapshots.py used to do exactly that (also on flow-worker, which has no
    session to offer); since 2026-11-17 it reads open interest from Massive alone and no longer
    imports this router."""
    out = asyncio.run(schwab_router.options_quotes_batch(BODY))
    assert out == {"quotes": [SERVED]} and len(quotes_spy) == 1
    caller = (REPO / "api" / "oi_snapshots.py").read_text(encoding="utf-8")
    assert "options_quotes_batch" not in caller and "schwab_router" not in caller


def test_the_page_calls_are_same_origin_so_the_session_cookie_rides_along():
    src = (REPO / "app" / "src" / "pages" / "OptionsFlow.jsx").read_text(encoding="utf-8")
    calls = list(re.finditer(r'fetch\(\s*"([^"]*/api/schwab/options-quotes)"', src))
    assert len(calls) == 3
    for m in calls:
        assert m.group(1) == "/api/schwab/options-quotes"   # relative: same origin
        options = src[m.end():src.index("});", m.end())]
        assert "method" in options and "credentials" not in options     # the default sends the cookie same-origin
    # OptionsFlow_admin.jsx is the standalone copy (cross-origin API_BASE, mounted on no route)
    others = [p.name for p in _app_sources() if p.name not in ("OptionsFlow.jsx", "OptionsFlow_admin.jsx")
              and "/api/schwab/options-quotes" in p.read_text(encoding="utf-8", errors="replace")]
    assert others == []
