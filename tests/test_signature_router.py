"""Task 6: `/api/signature/*` — where Tasks 1-5 meet the network.

Everything under test here is a SEAM, and every seam below has already been
wrong once in this repo:

* the bars store's daily key is "D"; "1D" is the product label the ledger row
  carries. Getting them backwards returns 0 bars (silent "no signal") or
  writes a row the receipt can never join.
* `record_signal` RAISES by design, and ServeStale's cold `build()` has no
  try/except (serve_stale.py:143) — an unwrapped raise is a 500 on a user.
* `asyncio.run` inside an `async def` raises RuntimeError, so the GEX route
  must stay a plain `def`.
* an auth-down GEX envelope is never remembered by `good()`, so without a
  negative cache every request pays the cold ~20s Schwab call on an anyio
  worker.
"""
import inspect
import logging
import time
from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import signature as sig
from api.middleware.auth_middleware import get_current_user_with_plan


@pytest.fixture
def client(monkeypatch, tmp_path):
    from api.services.signature import ledger
    monkeypatch.setattr(ledger, "_DB_PATH", str(tmp_path / "ledger.db"))
    monkeypatch.setattr(ledger, "_INITED", False)
    for slot in (sig._DPL_STALE, sig._FCB_STALE, sig._GXW_STALE):
        slot._slots.clear()
    app = FastAPI()
    app.include_router(sig.router)
    return app


def _paid_user():
    return {"id": "u1", "role": "user", "plan": "premium"}


def _free_user():
    return {"id": "u2", "role": "user", "plan": "free"}


# ── the brief's three ───────────────────────────────────────────────────────

def test_anon_gets_402(client):
    c = TestClient(client, raise_server_exceptions=False)
    r = c.get("/api/signature/darkpool-levels?sym=NVDA")
    assert r.status_code in (401, 402)


def test_paid_gets_dpl_payload(client, monkeypatch):
    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    monkeypatch.setattr(sig, "_dpl_build",
                        lambda sym: {"sym": sym, "levels": [], "version": "dpl-v1", "asOf": 1.0})
    c = TestClient(client)
    r = c.get("/api/signature/darkpool-levels?sym=nvda")
    assert r.status_code == 200
    assert r.json()["sym"] == "NVDA" and r.json()["version"] == "dpl-v1"


def test_bad_symbol_rejected(client):
    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    c = TestClient(client)
    assert c.get("/api/signature/gex-walls?sym=..%2Fetc").status_code == 422


# ── the paywall (mutation check: delete the gate and this fails) ────────────

def test_a_free_user_is_refused_on_every_route(client, monkeypatch):
    """402 with the Signature copy, on ALL THREE routes. A gate applied to two
    of three routes passes any single-route test."""
    client.dependency_overrides[get_current_user_with_plan] = _free_user
    monkeypatch.setattr(sig, "_dpl_build", lambda sym: {"levels": []})
    monkeypatch.setattr(sig, "_fcb_build", lambda sym, cookie: {"signals": []})
    monkeypatch.setattr(sig, "_gxw_build", lambda sym: {"levels": []})
    c = TestClient(client)
    for path in ("darkpool-levels", "flow-breakout", "gex-walls"):
        r = c.get(f"/api/signature/{path}?sym=NVDA")
        assert r.status_code == 402, path
        assert r.json()["detail"] == "UCT Signature indicators require a paid plan"


def test_the_prefix_is_never_under_api_flow(client):
    """/api/flow* is swallowed by flow_proxy, and /api/indicator* is reserved
    for Phase B. Both would mount fine and 404 (or proxy away) in production."""
    paths = [r.path for r in sig.router.routes]
    assert paths and all(p.startswith("/api/signature/") for p in paths), paths


# ── symbol normalization is THIS module's job (carry item 9) ───────────────

def test_a_padded_symbol_is_stripped_before_validation_then_uppercased(client, monkeypatch):
    """The regex has no \\s, so ' nvda ' fails validation unless the strip
    happens FIRST. Callers do pass padded strings; the gex adapter's own
    sym.upper() stamp cannot fix a symbol we already rejected with a 422."""
    seen = []
    monkeypatch.setattr(sig, "_dpl_build",
                        lambda sym: seen.append(sym) or {"sym": sym, "levels": []})
    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    c = TestClient(client)
    r = c.get("/api/signature/darkpool-levels", params={"sym": "  nvda  "})
    assert r.status_code == 200, r.text
    assert seen == ["NVDA"]


def test_an_empty_or_oversized_symbol_is_422(client):
    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    c = TestClient(client)
    for bad in ("", "   ", "TOOLONGSYMBOL", "NV DA", "NV;DA"):
        assert c.get("/api/signature/darkpool-levels",
                     params={"sym": bad}).status_code == 422, bad


# ── FCB: the bars key, the ledger tf, and the raw barTime ──────────────────

def _bars(n=22, breakout_at=20):
    """n daily bars; `breakout_at` closes above the 20-bar high on 2x volume.

    `t` is a YYYYMMDD int — exactly what bars_sqlite stores for tf="D"."""
    start = date(2026, 6, 1)
    out = []
    for i in range(n):
        d = start + timedelta(days=i)
        bar = {"t": int(d.strftime("%Y%m%d")), "o": 95.0, "h": 100.0,
               "l": 90.0, "c": 95.0, "v": 1000}
        if i == breakout_at:
            bar.update({"h": 106.0, "c": 105.0, "v": 4000})
        out.append(bar)
    return out


def _bull_flow(day="6/21/2026"):
    return [{"CreatedDate": day, "CallPut": "C", "Premium": "$1.2M"},
            {"CreatedDate": day, "CallPut": "P", "Premium": "50000"}]


def test_bars_are_read_with_the_daily_store_key(client, monkeypatch):
    """bars_sqlite's daily rows are stored under tf="D". "1D" (the product
    label) matches nothing and returns 0 rows — a silent, permanent no-signal."""
    from api.services import bars_sqlite
    calls = []

    def fake_get_bars(ticker, tf, max_bars):
        calls.append((ticker, tf, max_bars))
        return [(int((date(2026, 6, 1) + timedelta(days=i)).strftime("%Y%m%d")),
                 95.0, 100.0, 90.0, 95.0, 1000) for i in range(5)]

    monkeypatch.setattr(bars_sqlite, "get_bars", fake_get_bars)
    rows = sig._fetch_bars("nvda", 60)

    assert calls == [("NVDA", "D", 60)]
    assert rows[0]["t"] == 20260601 and rows[0]["c"] == 95.0


def test_a_signal_is_recorded_with_the_product_facing_timeframe(client, monkeypatch):
    """tf on the ledger row is "1D" — the surface's label — never the store
    key "D". They are different rows under the UNIQUE key, so a receipt keyed
    one way can never find a row written the other."""
    from api.services.signature import ledger
    monkeypatch.setattr(sig, "_fetch_bars", lambda sym, count=60: _bars())
    monkeypatch.setattr(sig, "_fetch_flow_rows", lambda sym, cookie: _bull_flow())
    client.dependency_overrides[get_current_user_with_plan] = _paid_user

    c = TestClient(client)
    r = c.get("/api/signature/flow-breakout?sym=nvda")
    assert r.status_code == 200, r.text
    body = r.json()
    assert [s["direction"] for s in body["signals"]] == ["bull"]
    assert body["version"] == "fcb-v1" and body["sym"] == "NVDA"

    rows = ledger.get_signals("NVDA")
    assert len(rows) == 1
    assert rows[0]["tf"] == "1D"
    # barTime went in RAW (20260621); the ledger normalizes all three encodings
    # itself, so the router must not pre-format it into something else.
    assert rows[0]["bar_time"] == 20260621
    assert rows[0]["indicator"] == "fcb" and rows[0]["version"] == "fcb-v1"


def test_the_forming_session_never_yields_a_signal_on_this_path(client, monkeypatch):
    """include_last=False: the last bar has no successor, so it is not closed.
    A breakout ON that bar must not reach the user (or the ledger)."""
    from api.services.signature import ledger
    bars = _bars(n=21, breakout_at=20)          # the breakout IS the last bar
    monkeypatch.setattr(sig, "_fetch_bars", lambda sym, count=60: bars)
    monkeypatch.setattr(sig, "_fetch_flow_rows", lambda sym, cookie: _bull_flow())
    client.dependency_overrides[get_current_user_with_plan] = _paid_user

    r = TestClient(client).get("/api/signature/flow-breakout?sym=NVDA")
    assert r.json()["signals"] == []
    assert ledger.get_signals("NVDA") == []


# ── carry item 4: record_signal RAISES; that must not reach the user ───────

def test_a_ledger_refusal_does_not_500_and_does_not_drop_the_signals(client, monkeypatch, caplog):
    """`record_signal` raises ValueError on any field it cannot key, and may
    raise sqlite3.IntegrityError on a non-UNIQUE constraint failure. The
    signals are already computed and correct — refusing to WRITE them must
    never refuse to SHOW them."""
    from api.services.signature import ledger

    def boom(*a, **kw):
        raise ValueError("meta is not JSON-serializable")

    monkeypatch.setattr(ledger, "record_signal", boom)
    monkeypatch.setattr(sig, "_fetch_bars", lambda sym, count=60: _bars())
    monkeypatch.setattr(sig, "_fetch_flow_rows", lambda sym, cookie: _bull_flow())
    client.dependency_overrides[get_current_user_with_plan] = _paid_user

    with caplog.at_level(logging.ERROR, logger="api.routers.signature"):
        r = TestClient(client, raise_server_exceptions=False).get(
            "/api/signature/flow-breakout?sym=NVDA")

    assert r.status_code == 200, r.text
    assert len(r.json()["signals"]) == 1
    assert any("ledger" in rec.message.lower() for rec in caplog.records), caplog.text


@pytest.mark.parametrize("route,attr", [
    ("darkpool-levels", "fetch_dp_levels"),
    ("flow-breakout", "_fetch_bars"),
    ("gex-walls", "fetch_gex_walls"),
])
def test_a_build_that_raises_becomes_an_error_envelope_not_a_500(
        client, monkeypatch, caplog, route, attr):
    """serve_stale's cold build() path has NO try/except (serve_stale.py:143):
    anything a build raises is a 500 on the user's chart."""
    def boom(*a, **kw):
        raise RuntimeError("provider exploded")

    async def aboom(*a, **kw):
        raise RuntimeError("provider exploded")

    monkeypatch.setattr(sig, attr, aboom if attr == "fetch_gex_walls" else boom)
    client.dependency_overrides[get_current_user_with_plan] = _paid_user

    with caplog.at_level(logging.ERROR, logger="api.routers.signature"):
        r = TestClient(client, raise_server_exceptions=False).get(
            f"/api/signature/{route}?sym=NVDA")

    assert r.status_code == 200, r.text
    assert r.json().get("error"), r.json()
    assert any(rec.exc_info for rec in caplog.records), "the failure must be logged loudly"


def test_an_error_envelope_is_never_remembered_as_the_last_good_payload(client, monkeypatch):
    """`good()` is the whole defence against a failed build becoming the value
    every user sees for the next 30 minutes."""
    monkeypatch.setattr(sig, "fetch_dp_levels",
                        lambda sym: (_ for _ in ()).throw(RuntimeError("down")))
    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    c = TestClient(client)
    assert c.get("/api/signature/darkpool-levels?sym=NVDA").json().get("error")
    assert sig._DPL_STALE.peek("NVDA") == (None, None)

    monkeypatch.setattr(sig, "fetch_dp_levels",
                        lambda sym: {"sym": sym, "levels": [{"rank": 1}], "version": "dpl-v1"})
    body = c.get("/api/signature/darkpool-levels?sym=NVDA").json()
    assert body["levels"] == [{"rank": 1}]
    assert sig._DPL_STALE.peek("NVDA")[0]["levels"] == [{"rank": 1}]


# ── carry item 5: the GEX route must stay sync ─────────────────────────────

def test_every_route_is_a_sync_def(client):
    """`asyncio.run()` inside an `async def` raises RuntimeError: this loop is
    already running. The GEX route calls asyncio.run, so it — and its
    neighbours, for one shape — must be plain `def`."""
    for r in sig.router.routes:
        assert not inspect.iscoroutinefunction(r.endpoint), r.path


def test_the_gex_route_actually_runs_the_async_adapter(client, monkeypatch):
    """The structural check above passes on a route that never calls
    asyncio.run at all. This one drives the real call through TestClient."""
    async def fake(sym):
        return {"sym": sym.upper(), "levels": [{"kind": "callWall", "price": 510.0}],
                "spot": 500.0, "regime": "choppy", "version": "gxw-v1", "asOf": 1.0}

    monkeypatch.setattr(sig, "fetch_gex_walls", fake)
    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    r = TestClient(client).get("/api/signature/gex-walls?sym=spy")
    assert r.status_code == 200, r.text
    assert r.json()["levels"] == [{"kind": "callWall", "price": 510.0}]


# ── carry item 6: the GEX negative cache, both directions ──────────────────

def _auth_down():
    calls = []

    async def fake(sym):
        calls.append(sym)
        return {"sym": sym.upper(), "levels": [], "error": "Schwab not authenticated",
                "version": "gxw-v1", "asOf": time.time()}
    return calls, fake


def test_an_auth_down_envelope_is_served_from_the_negative_cache(client, monkeypatch):
    """`good()` is `not error`, so ServeStale never remembers this payload —
    without a negative cache EVERY request pays the ~20s Schwab timeout on an
    anyio worker while Schwab's token is dead (a routine, hours-long state)."""
    calls, fake = _auth_down()
    monkeypatch.setattr(sig, "fetch_gex_walls", fake)
    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    c = TestClient(client)

    first = c.get("/api/signature/gex-walls?sym=SPY").json()
    second = c.get("/api/signature/gex-walls?sym=SPY").json()

    assert first["error"] == second["error"] == "Schwab not authenticated"
    assert calls == ["SPY"], "the second request must not have rebuilt"


def test_a_negative_cache_entry_older_than_the_ttl_is_rebuilt(client, monkeypatch):
    """The other direction: a 60s memory of an outage, not a permanent one.
    Schwab auth comes back and the very next request must see it."""
    calls, fake = _auth_down()
    monkeypatch.setattr(sig, "fetch_gex_walls", fake)
    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    c = TestClient(client)

    assert c.get("/api/signature/gex-walls?sym=SPY").json()["error"]
    assert calls == ["SPY"]

    payload, _at = sig._GXW_NEG_CACHE["SPY"]
    sig._GXW_NEG_CACHE["SPY"] = (payload, time.time() - sig._GXW_NEG_TTL_S - 1)

    healthy = {"sym": "SPY", "levels": [{"kind": "putWall", "price": 480.0}],
               "spot": 500.0, "version": "gxw-v1", "asOf": time.time()}

    async def recovered(sym):
        calls.append(sym)
        return healthy

    monkeypatch.setattr(sig, "fetch_gex_walls", recovered)
    body = c.get("/api/signature/gex-walls?sym=SPY").json()
    assert calls == ["SPY", "SPY"]
    assert body["levels"] == [{"kind": "putWall", "price": 480.0}]
    assert "SPY" not in sig._GXW_NEG_CACHE, "recovery must clear the negative entry"


def test_a_healthy_zero_level_payload_is_not_an_error(client, monkeypatch):
    """"Healthy chain, no wall within the band" is a NORMAL state. Treating it
    as an error would negative-cache a good answer and stop remembering it."""
    calls = []

    async def fake(sym):
        calls.append(sym)
        return {"sym": sym.upper(), "levels": [], "spot": 500.0, "regime": "choppy",
                "version": "gxw-v1", "asOf": time.time()}

    monkeypatch.setattr(sig, "fetch_gex_walls", fake)
    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    r = TestClient(client).get("/api/signature/gex-walls?sym=SPY")

    assert r.status_code == 200 and r.json()["levels"] == []
    assert "error" not in r.json()
    assert "SPY" not in sig._GXW_NEG_CACHE
    assert sig._GXW_STALE.peek("SPY")[0] is not None, "a good payload must be remembered"


# ── carry item 8: the flow join diagnostic ─────────────────────────────────

def test_the_join_diagnostic_counts_a_mixed_fixture(client):
    """Premium truncation and an unrecognized CallPut both fail SILENTLY toward
    'no signal' — the compute just sums less. These counters are the only
    visibility into that."""
    rows = [
        {"CallPut": "C", "Premium": "$1.2M"},        # matched, non-zero
        {"CallPut": "call", "Premium": "250K"},      # matched (case/word form)
        {"CallPut": "P", "Premium": "1,500,000"},    # matched, non-zero
        {"CallPut": "PUT", "Premium": ""},           # matched, parses to 0.0
        {"CallPut": "CALL", "Premium": "n/a"},       # matched, parses to 0.0
        {"CallPut": "CS", "Premium": "900000"},      # UNKNOWN side
        {"CallPut": "", "Premium": "800000"},        # blank side
        {"CallPut": None, "Premium": None},          # blank side, 0.0
    ]
    stats = sig._flow_join_stats(rows)
    assert stats["rows_in"] == 8
    assert stats["side_matched"] == 5
    assert stats["parsed_to_zero"] == 3
    assert stats["unknown_sides"] == {"CS": 1}


def test_an_unrecognized_call_put_value_logs_at_warning(client, monkeypatch, caplog):
    """The repo elsewhere matches sides with a loose startswith("C"); this
    indicator's compute is STRICT. A new upstream encoding therefore drops
    premium on the floor silently — it must at least be shouted about."""
    monkeypatch.setattr(sig, "_fetch_bars", lambda sym, count=60: _bars())
    monkeypatch.setattr(sig, "_fetch_flow_rows", lambda sym, cookie: [
        {"CreatedDate": "6/21/2026", "CallPut": "CS", "Premium": "$1.2M"}])
    client.dependency_overrides[get_current_user_with_plan] = _paid_user

    with caplog.at_level(logging.INFO, logger="api.routers.signature"):
        TestClient(client).get("/api/signature/flow-breakout?sym=NVDA")

    warned = [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert any("CS" in r.getMessage() for r in warned), caplog.text
    assert any("rows_in=1" in r.getMessage() for r in caplog.records), caplog.text


def test_flow_is_read_from_the_proxied_surface_with_the_caller_cookie(client, monkeypatch):
    """web's own flow.db is a FROZEN pre-cutover copy — a local read would
    serve stale-forever flow. The proxied surface is auth'd, so the caller's
    cookie has to ride along."""
    import httpx as _httpx
    seen = {}

    class _Resp:
        status_code = 200
        text = ("CreatedDate,CallPut,Premium\r\n"
                "6/21/2026,C,$1.2M\r\n"
                "6/21/2026,P,50000\r\n")

    def fake_get(url, headers=None, timeout=None):
        seen.update(url=url, headers=headers or {}, timeout=timeout)
        return _Resp()

    monkeypatch.setattr(_httpx, "get", fake_get)
    rows = sig._fetch_flow_rows("NVDA", "uct_session=abc123")

    assert seen["url"] == f"{sig._FLOW_BASE}/api/flow/ticker/NVDA"
    assert seen["headers"].get("cookie") == "uct_session=abc123"
    assert seen["timeout"] == 15.0
    assert [r["Premium"] for r in rows] == ["$1.2M", "50000"]


def test_a_failed_flow_read_is_not_served_as_no_signal(client, monkeypatch):
    """An empty flow day and an unreachable flow service look identical in the
    output (`signals: []`) — but one is an answer and the other is a failure.
    Remembering the failure would pin 'no signal' for the next 30 minutes."""
    monkeypatch.setattr(sig, "_fetch_bars", lambda sym, count=60: _bars())
    monkeypatch.setattr(sig, "_fetch_flow_rows", lambda sym, cookie: None)
    client.dependency_overrides[get_current_user_with_plan] = _paid_user

    r = TestClient(client).get("/api/signature/flow-breakout?sym=NVDA")
    assert r.status_code == 200
    assert r.json().get("error")
    assert "signals" not in r.json()
    assert sig._FCB_STALE.peek("NVDA") == (None, None)


def test_a_flow_read_that_errors_returns_none_not_an_empty_list(client, monkeypatch):
    import httpx as _httpx

    def blow(url, headers=None, timeout=None):
        raise _httpx.ConnectError("connection refused")

    monkeypatch.setattr(_httpx, "get", blow)
    assert sig._fetch_flow_rows("NVDA", None) is None

    class _Resp:
        status_code = 502
        text = "bad gateway"

    monkeypatch.setattr(_httpx, "get", lambda *a, **kw: _Resp())
    assert sig._fetch_flow_rows("NVDA", None) is None
