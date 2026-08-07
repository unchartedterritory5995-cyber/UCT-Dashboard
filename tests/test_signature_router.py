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
  worker — and that cache must never outrank a payload we can still serve.
* `fresh()` is what makes the stale slot a fallback instead of a treadmill:
  ServeStale kicks a rebuild behind EVERY caller it serves stale, so without a
  TTL cache in front, N requests = N provider builds.
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
from api.services.signature import flow_breakout


@pytest.fixture
def client(monkeypatch, tmp_path):
    from api.services.signature import ledger
    monkeypatch.setattr(ledger, "_DB_PATH", str(tmp_path / "ledger.db"))
    monkeypatch.setattr(ledger, "_INITED", False)
    for slot in (sig._DPL_STALE, sig._FCB_STALE, sig._GXW_STALE, sig._DPC_STALE):
        slot._slots.clear()
    # The negative caches are module-level too, and they now ride `fresh()` on
    # BOTH gex-walls and flow-breakout. A test that legitimately remembers an
    # outage for NVDA would otherwise answer the NEXT test's cold request from
    # that entry — the slots were already cleared here for exactly this reason.
    sig._GXW_NEG_CACHE.clear()
    sig._FCB_NEG_CACHE.clear()
    # ⚠️ AND THE CONFLUENCE LANE'S, WHICH IS NOT A CACHE BUT IS STILL STATE.
    # `_FCB_INDEX_FILED` decides which flow source is asked FIRST, and the dpc
    # lane carries a warm queue, a pace reservation and a semaphore — all
    # module-level, all shared across tests. A leaked pace reservation makes an
    # unrelated test sleep; a leaked warm queue makes a background thread build
    # a symbol the next test is asserting is cold. This fixture is the only
    # thing standing between those and a flake nobody can reproduce.
    sig._FCB_INDEX_FILED.clear()
    with sig._DPC_WARM_LOCK:
        sig._DPC_WARM_QUEUE.clear()
    sig._DPC_PACE_NEXT_AT = 0.0
    # The TTL cache is process-wide and `sig:` is this module's whole namespace.
    # It survived untended only because nothing here used to write a dpc entry.
    sig.cache.delete_prefix("sig:")
    app = FastAPI()
    app.include_router(sig.router)
    return app


def _paid_user():
    return {"id": "u1", "role": "user", "plan": "premium"}


def _free_user():
    return {"id": "u2", "role": "user", "plan": "free"}


def _settle(seconds=0.4):
    """Give a ServeStale background kick time to land (or prove it never fired)."""
    time.sleep(seconds)


def _wait_for(pred, timeout=3.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if pred():
            return True
        time.sleep(0.01)
    return False


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

def test_a_free_user_is_refused_on_EVERY_route_DERIVED_FROM_THE_ROUTER(client, monkeypatch):
    """402 with the Signature copy, on every route the ROUTER declares.

    ⭐ THE LIST IS DERIVED, AND THAT IS THE REPAIR. It used to be three
    hardcoded paths, and the docstring already said why that is dangerous —
    *"a gate applied to two of three routes passes any single-route test"* —
    while the router had grown to FIVE. `/confluence` and `/confluence-scan`
    rode uncovered, and Task 13 adds `/definitions` and `/columns`. Reading the
    route table means a new route without its own `Depends(require_paid)` is
    caught on the run that adds it, not on the day somebody notices.

    ⛔ AND THE COUNT IS ASSERTED, so a router that stopped mounting its routes
    would make the loop iterate zero times and pass for free.
    """
    client.dependency_overrides[get_current_user_with_plan] = _free_user
    monkeypatch.setattr(sig, "_dpl_build", lambda sym: {"levels": []})
    monkeypatch.setattr(sig, "_fcb_build", lambda sym: {"signals": []})
    monkeypatch.setattr(sig, "_gxw_build", lambda sym: {"levels": []})
    c = TestClient(client)

    # Every route, with whatever query params it declares as required — a 422
    # would be a MISS, because validation runs after the dependency and a
    # missing gate would show up as a 200 or a 500 instead.
    params = {"sym": "NVDA", "syms": "NVDA", "defId": "rsLine"}
    seen = 0
    for route in sig.router.routes:
        qs = "&".join(f"{k}={v}" for k, v in params.items())
        r = c.get(f"{route.path}?{qs}")
        assert r.status_code == 402, f"{route.path} -> {r.status_code}"
        assert r.json()["detail"] == "UCT Signature indicators require a paid plan"
        seen += 1
    assert seen == 7, f"the router mounts {seen} routes — re-read this rail"


def test_every_route_declares_its_OWN_require_paid_dependency(client):
    """The structural half, because the behavioural one above cannot see a
    route that was gated by a ROUTER-level dependency instead.

    There is no router-level dependency here on purpose: `include_router` is
    called without one in `main.py`, so a route omitting its own is reachable
    by anybody. Reading each endpoint's signature says so directly.
    """
    for route in sig.router.routes:
        deps = [
            p.default.dependency
            for p in inspect.signature(route.endpoint).parameters.values()
            if hasattr(p.default, "dependency")
        ]
        assert sig.require_paid in deps, f"{route.path} declares no require_paid"
    assert sig.router.dependencies == [], (
        "a router-level dependency would make the per-handler rail above pass "
        "for a route that has none of its own")


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


def test_an_empty_or_oversized_symbol_is_422(client, monkeypatch):
    """"." / ".." / "-" all satisfy a bare `[A-Za-z.\\-]+` class, and httpx
    COLLAPSES dot segments — a ".." symbol would retarget the flow request one
    path level up. A symbol must START with a letter."""
    monkeypatch.setattr(sig, "_dpl_build", lambda sym: {"sym": sym, "levels": []})
    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    c = TestClient(client)
    for bad in ("", "   ", "TOOLONGSYMBOL", "NV DA", "NV;DA", ".", "..", "-", "-NV", ".NV"):
        assert c.get("/api/signature/darkpool-levels",
                     params={"sym": bad}).status_code == 422, bad
    for good in ("NVDA", "BRK.B", "BRK-B", "nvda"):
        assert c.get("/api/signature/darkpool-levels",
                     params={"sym": good}).status_code != 422, good


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


def _bull_by_date(day="6/21/2026"):
    """What the flow read now hands back: already keyed by ISO session date.

    The M/D/YYYY→ISO normalization moved into the shared streamed parser
    (`flow_breakout.flow_by_date`), so the router no longer re-derives it and
    stubs here hand over the joined shape directly.
    """
    m, d, y = day.split("/")
    return {f"{int(y):04d}-{int(m):02d}-{int(d):02d}": _bull_flow(day)}


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
    monkeypatch.setattr(sig, "_fetch_flow_by_date", lambda sym, cutoff_iso="": _bull_by_date())
    client.dependency_overrides[get_current_user_with_plan] = _paid_user

    c = TestClient(client)
    r = c.get("/api/signature/flow-breakout?sym=nvda")
    assert r.status_code == 200, r.text
    body = r.json()
    assert [s["direction"] for s in body["signals"]] == ["bull"]
    assert body["version"] == "fcb-v2" and body["sym"] == "NVDA"

    rows = ledger.get_signals("NVDA")
    assert len(rows) == 1
    assert rows[0]["tf"] == "1D"
    # barTime went in RAW (20260621); the ledger normalizes all three encodings
    # itself, so the router must not pre-format it into something else.
    assert rows[0]["bar_time"] == 20260621
    assert rows[0]["indicator"] == "fcb" and rows[0]["version"] == "fcb-v2"


def test_the_forming_session_never_yields_a_signal_on_this_path(client, monkeypatch):
    """include_last=False: the last bar has no successor, so it is not closed.
    A breakout ON that bar must not reach the user (or the ledger)."""
    from api.services.signature import ledger
    bars = _bars(n=21, breakout_at=20)          # the breakout IS the last bar
    monkeypatch.setattr(sig, "_fetch_bars", lambda sym, count=60: bars)
    monkeypatch.setattr(sig, "_fetch_flow_by_date", lambda sym, cutoff_iso="": _bull_by_date())
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
    monkeypatch.setattr(sig, "_fetch_flow_by_date", lambda sym, cutoff_iso="": _bull_by_date())
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
    monkeypatch.setattr(sig, "_fetch_flow_by_date", lambda sym, cutoff_iso="": {
        "2026-06-21": [{"CreatedDate": "6/21/2026", "CallPut": "CS", "Premium": "$1.2M"}]})
    client.dependency_overrides[get_current_user_with_plan] = _paid_user

    with caplog.at_level(logging.INFO, logger="api.routers.signature"):
        TestClient(client).get("/api/signature/flow-breakout?sym=NVDA")

    warned = [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert any("CS" in r.getMessage() for r in warned), caplog.text
    assert any("rows_in=1" in r.getMessage() for r in caplog.records), caplog.text


def _flow_probe(monkeypatch, body="CreatedDate,CallPut,Premium\r\n6/21/2026,C,$1.2M\r\n",
                status=200):
    """Capture what the flow read actually puts on the wire.

    Patches `httpx.stream`, not `httpx.get`: the read is STREAMED — the surface
    serves an uncapped per-symbol history and materializing it as one string on
    an anyio worker is what this path stopped doing. `iter_lines()` yields lines
    WITHOUT their terminators, which is what the shared parser is fed.
    """
    import httpx as _httpx
    seen = {}

    class _Resp:
        status_code = status

        def iter_lines(self):
            yield from body.splitlines()

    class _Ctx:
        def __enter__(self):
            return _Resp()

        def __exit__(self, *exc):
            return False

    def fake_stream(method, url, params=None, headers=None, timeout=None, **kw):
        seen.update(method=method, url=url, params=params, headers=headers,
                    timeout=timeout, kwargs=kw)
        return _Ctx()

    monkeypatch.setattr(_httpx, "stream", fake_stream)
    return seen


def test_the_flow_base_falls_back_to_the_app_port_not_a_hardcoded_8080(monkeypatch):
    """8080 is a guess: local dev runs uvicorn on 8000 (so FCB would be 100%
    dead), and on Railway the pod's port comes from $PORT. Mirrors
    ai_search._flow_base_url, the only other consumer of this surface."""
    from api import flow_proxy
    monkeypatch.delenv("SIGNATURE_FLOW_BASE", raising=False)
    monkeypatch.setattr(flow_proxy, "PROXY_ENABLED", False)
    monkeypatch.setenv("PORT", "9931")
    assert sig._flow_base_url() == "http://127.0.0.1:9931"

    monkeypatch.delenv("PORT", raising=False)
    assert sig._flow_base_url() == "http://127.0.0.1:8000"   # uvicorn's default


def test_the_flow_base_skips_the_self_request_when_the_proxy_is_on(monkeypatch):
    """With the read proxy enabled a self-request is only forwarded to the
    worker anyway — at the cost of a second hop and another held anyio worker."""
    from api import flow_proxy
    monkeypatch.delenv("SIGNATURE_FLOW_BASE", raising=False)
    monkeypatch.setattr(flow_proxy, "PROXY_ENABLED", True)
    monkeypatch.setattr(flow_proxy, "WORKER_INTERNAL_URL", "http://flow-worker.internal:9000")
    assert sig._flow_base_url() == "http://flow-worker.internal:9000"

    monkeypatch.setenv("SIGNATURE_FLOW_BASE", "http://override.test:1234/")
    assert sig._flow_base_url() == "http://override.test:1234", "the override wins"


def test_flow_is_read_from_the_proxied_surface_and_forwards_no_credential(monkeypatch):
    """web's own flow.db is a FROZEN pre-cutover copy — a local read would serve
    stale-forever flow. /api/flow/ticker declares no auth dependency on either
    service, so forwarding the caller's session cookie to an env-configurable
    base URL would buy nothing and leak a live credential."""
    from api import flow_proxy
    monkeypatch.setattr(flow_proxy, "PROXY_ENABLED", False)
    monkeypatch.setenv("SIGNATURE_FLOW_BASE", "http://flow.test:8080")
    seen = _flow_probe(monkeypatch)

    by_date = sig._fetch_flow_by_date("NVDA")

    assert seen["method"] == "GET"
    assert seen["url"] == "http://flow.test:8080/api/flow/ticker/NVDA"
    # `cols` is the projection the join actually parses, and it is pinned to
    # FLOW_COLS rather than spelled out: the question asked upstream and the
    # fields `flow_by_date` resolves BY NAME out of the reply must be the same
    # list, or the reply is missing a column the parser will raise on.
    assert seen["params"] == {"source": "stocks",
                              "cols": ",".join(flow_breakout.FLOW_COLS)}
    assert seen["timeout"] == 15.0
    assert not (seen["headers"] or {}), f"no credential may ride along: {seen['headers']}"
    assert "cookie" not in str(seen).lower()
    assert [r["Premium"] for r in by_date["2026-06-21"]] == ["$1.2M"]


def _real_header_body(rows):
    from api.flow_db import COLUMNS

    def row(**kv):
        return ",".join(str(kv.get(c, "")) for c in COLUMNS)

    return ",".join(COLUMNS) + "\r\n" + "\r\n".join(row(**r) for r in rows) + "\r\n"


def test_the_csv_fixture_is_built_from_the_real_flow_header(monkeypatch):
    """A hand-typed 3-column fixture proves only that the parser can read the
    fixture. The surface emits flow_db.COLUMNS — 22 columns, in that order — so
    the join is exercised against the REAL header here (house lesson:
    lesson_injected_dependency_hides_the_fetch)."""
    from api.flow_db import COLUMNS

    assert {"CreatedDate", "CallPut", "Premium"} <= set(COLUMNS)

    _flow_probe(monkeypatch, body=_real_header_body([
        dict(CreatedDate="6/21/2026", Symbol="NVDA", CallPut="C", Premium="$1.2M"),
        dict(CreatedDate="6/21/2026", Symbol="NVDA", CallPut="PUT", Premium=""),
        dict(CreatedDate="6/21/2026", Symbol="NVDA", CallPut="CS", Premium="900000"),
    ]))

    rows = sig._fetch_flow_by_date("NVDA")["2026-06-21"]
    assert len(rows) == 3
    assert rows[0]["Premium"] == "$1.2M" and rows[0]["CallPut"] == "C"
    assert sig._flow_join_stats(rows) == {
        "rows_in": 3, "side_matched": 2, "parsed_to_zero": 1, "unknown_sides": {"CS": 1},
    }


def test_the_router_read_keeps_three_keys_out_of_the_twenty_two(monkeypatch):
    """The surface's per-symbol CSV is UNCAPPED: a liquid name is months of tape
    across 22 columns. Holding a full row dict per line — on an anyio worker, on
    the request path — for the three fields the join reads is the transient this
    read exists not to make. Pinned against the real header so an upstream
    column addition cannot quietly widen it again."""
    _flow_probe(monkeypatch, body=_real_header_body([
        dict(CreatedDate="6/21/2026", Symbol="NVDA", CallPut="C", Premium="$1.2M",
             Strike="180", Expiry="2026-07-17")]))

    row = sig._fetch_flow_by_date("NVDA")["2026-06-21"][0]

    assert set(row) == {"CreatedDate", "CallPut", "Premium"}, row
    assert "Symbol" not in row and "Strike" not in row


def test_the_router_read_drops_rows_outside_the_bar_window(monkeypatch):
    """The cutoff is applied DURING the stream, so out-of-window rows are never
    held at all — and the join never sees a session the bars cannot match."""
    _flow_probe(monkeypatch, body=_real_header_body([
        dict(CreatedDate="6/21/2026", Symbol="NVDA", CallPut="C", Premium="$1.2M"),
        dict(CreatedDate="1/2/2026", Symbol="NVDA", CallPut="P", Premium="900000"),
    ]))

    assert list(sig._fetch_flow_by_date("NVDA", "2026-06-01")) == ["2026-06-21"]
    assert sorted(sig._fetch_flow_by_date("NVDA")) == ["2026-01-02", "2026-06-21"]


def test_the_window_handed_to_the_flow_read_is_the_oldest_bar(client, monkeypatch):
    """Bars are fetched FIRST because the flow window comes from them. A missing
    (or wrong) cutoff silently pulls a symbol's whole filed history to join
    against 60 daily bars — no error, just the waste this path removed."""
    got = []
    monkeypatch.setattr(sig, "_fetch_bars", lambda sym, count=60: _bars())
    monkeypatch.setattr(sig, "_fetch_flow_by_date",
                        lambda sym, cutoff_iso="": got.append(cutoff_iso) or {})
    client.dependency_overrides[get_current_user_with_plan] = _paid_user

    TestClient(client).get("/api/signature/flow-breakout?sym=NVDA")

    assert got == ["2026-06-01"]


def test_a_failed_flow_read_is_not_served_as_no_signal(client, monkeypatch):
    """An empty flow day and an unreachable flow service look identical in the
    output (`signals: []`) — but one is an answer and the other is a failure.
    Remembering the failure would pin 'no signal' for the next 30 minutes."""
    monkeypatch.setattr(sig, "_fetch_bars", lambda sym, count=60: _bars())
    monkeypatch.setattr(sig, "_fetch_flow_by_date", lambda sym, cutoff_iso="": None)
    client.dependency_overrides[get_current_user_with_plan] = _paid_user

    r = TestClient(client).get("/api/signature/flow-breakout?sym=NVDA")
    assert r.status_code == 200
    assert r.json().get("error")
    assert "signals" not in r.json()
    assert sig._FCB_STALE.peek("NVDA") == (None, None)


def test_a_flow_read_that_errors_returns_none_not_an_empty_mapping(client, monkeypatch):
    import httpx as _httpx

    def blow(*a, **kw):
        raise _httpx.ConnectError("connection refused")

    monkeypatch.setattr(_httpx, "stream", blow)
    assert sig._fetch_flow_by_date("NVDA") is None

    _flow_probe(monkeypatch, body="bad gateway", status=502)
    assert sig._fetch_flow_by_date("NVDA") is None


# ── the TTL cache in front of the stale slot (fix F2) ──────────────────────

def _counting_builder(monkeypatch, route):
    """Install a counting stub at each route's provider seam."""
    calls = []
    if route == "darkpool-levels":
        def fake(sym):
            calls.append(sym)
            return {"sym": sym, "version": "dpl-v1", "levels": [], "asOf": 1.0}
        monkeypatch.setattr(sig, "fetch_dp_levels", fake)
    elif route == "flow-breakout":
        monkeypatch.setattr(sig, "_fetch_bars", lambda sym, count=60: _bars())

        def fake(sym, cutoff_iso=""):
            calls.append(sym)
            return _bull_by_date()
        monkeypatch.setattr(sig, "_fetch_flow_by_date", fake)
    else:
        async def fake(sym):
            calls.append(sym)
            return {"sym": sym.upper(), "levels": [], "spot": 500.0,
                    "version": "gxw-v1", "asOf": 1.0}
        monkeypatch.setattr(sig, "fetch_gex_walls", fake)
    return calls


@pytest.mark.parametrize("route", ["darkpool-levels", "flow-breakout", "gex-walls"])
def test_two_requests_inside_the_ttl_drive_exactly_one_build(client, monkeypatch, route):
    """Measured before the fix: 10 requests = 10 provider builds. ServeStale
    serves the stale payload and then KICKS a rebuild behind every caller, so
    without a TTL cache on `fresh()` the slot is a treadmill, not a fallback —
    for GEX that is a ~20s Schwab /chains call per request, forever."""
    calls = _counting_builder(monkeypatch, route)
    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    c = TestClient(client)

    assert c.get(f"/api/signature/{route}?sym=NVDA").status_code == 200
    assert c.get(f"/api/signature/{route}?sym=NVDA").status_code == 200

    assert len(calls) == 1, f"{route}: second request rebuilt ({calls})"
    _settle()                       # a background kick would land inside this
    assert len(calls) == 1, f"{route}: a refresh was kicked inside the TTL ({calls})"


@pytest.mark.parametrize("route,ttl_attr", [
    ("darkpool-levels", "_DPL_TTL_S"),
    ("flow-breakout", "_FCB_TTL_S"),
])
def test_the_ttl_is_the_only_thing_holding_the_fresh_window(client, monkeypatch, route, ttl_attr):
    """Mutation rail for the test above: with the TTL collapsed to 0 the second
    request MUST rebuild. Without this, a stubbed builder that is simply never
    called twice would pass the one-build test for the wrong reason."""
    monkeypatch.setattr(sig, ttl_attr, 0)
    calls = _counting_builder(monkeypatch, route)
    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    c = TestClient(client)

    c.get(f"/api/signature/{route}?sym=NVDA")
    sig._DPL_STALE._slots.clear()
    sig._FCB_STALE._slots.clear()   # force the cold path, not the stale one
    c.get(f"/api/signature/{route}?sym=NVDA")
    assert len(calls) == 2


def test_the_gex_fresh_window_reads_the_rules_constant(client, monkeypatch):
    """GXW_TTL_S was dead code before this wiring. Pin that the router reads it
    rather than re-hardcoding 600 (owner tuning must be a one-file diff)."""
    from api.services.cache import cache
    from api.services.signature import rules as sig_rules

    seen = {}
    monkeypatch.setattr(cache, "set", lambda k, v, ttl: seen.update({k: ttl}))

    async def fake(sym):
        return {"sym": "SPY", "levels": [], "version": "gxw-v1", "asOf": 1.0}

    monkeypatch.setattr(sig, "fetch_gex_walls", fake)
    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    TestClient(client).get("/api/signature/gex-walls?sym=SPY")

    assert seen == {"sig:gxw:SPY": sig_rules.GXW_TTL_S}


# ── the negative cache must never outrank a payload we can serve (fix F1) ──

def test_the_negative_cache_never_outranks_a_servable_payload(client, monkeypatch):
    """ServeStale checks fresh() BEFORE the stale slot. A negative entry that
    returned unconditionally would therefore hand an ERROR to a user whose
    walls payload is seconds old — and self-perpetuate, because every request
    it answered skipped the stale path, so only the ~1-in-60s that fell through
    on expiry ever saw walls again."""
    from api.services.cache import cache
    state = {"mode": "healthy"}
    calls = []
    healthy = {"sym": "SPY", "levels": [{"kind": "callWall", "price": 510.0}],
               "spot": 500.0, "version": "gxw-v1", "asOf": 1.0}

    async def adapter(sym):
        calls.append(state["mode"])
        if state["mode"] == "healthy":
            return dict(healthy)
        return {"sym": "SPY", "levels": [], "error": "Schwab not authenticated",
                "version": "gxw-v1", "asOf": 2.0}

    monkeypatch.setattr(sig, "fetch_gex_walls", adapter)
    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    c = TestClient(client)

    # 1. cold + healthy → TTL cache AND the stale slot now hold real walls.
    assert c.get("/api/signature/gex-walls?sym=SPY").json()["levels"] == healthy["levels"]

    # Schwab's token dies, and the 10-min fresh window lapses.
    state["mode"] = "down"
    cache.invalidate(sig._ck("gxw", "SPY"))

    # 2. serves the stale walls, kicks a refresh that fails → negative-cached.
    assert c.get("/api/signature/gex-walls?sym=SPY").json()["levels"] == healthy["levels"]
    assert _wait_for(lambda: "SPY" in sig._GXW_NEG_CACHE), "the outage must be remembered"
    cache.invalidate(sig._ck("gxw", "SPY"))

    # 3. THE regression: a seconds-old good payload still outranks the outage.
    body = c.get("/api/signature/gex-walls?sym=SPY").json()
    assert body.get("levels") == healthy["levels"], body
    assert not body.get("error"), body


def test_the_negative_cache_still_answers_a_caller_with_nothing(client, monkeypatch):
    """The other half of the ordering rule: once the stale payload ages out (or
    never existed), the cold caller DOES get the remembered envelope instead of
    paying the ~20s timeout again."""
    calls, fake = _auth_down()
    monkeypatch.setattr(sig, "fetch_gex_walls", fake)
    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    c = TestClient(client)

    assert c.get("/api/signature/gex-walls?sym=SPY").json()["error"]
    sig._GXW_STALE._slots.clear()                    # nothing servable remains
    assert c.get("/api/signature/gex-walls?sym=SPY").json()["error"]
    assert calls == ["SPY"]


def test_a_dpl_cache_write_that_raises_does_not_discard_a_good_payload(
        client, monkeypatch, caplog):
    """The levels were computed and are correct. A raise from the CACHE WRITE is
    a bookkeeping failure — it must not be caught by the provider's handler and
    reported back as "dark pool levels unavailable", which would replace a good
    answer with an error envelope and, because good() then refuses it, leave the
    stale slot empty too."""
    from api.services.cache import cache

    levels = [{"rank": 1, "price": 180.0}]
    monkeypatch.setattr(sig, "fetch_dp_levels",
                        lambda sym: {"sym": sym, "levels": levels, "version": "dpl-v1"})

    real_set = cache.set

    def boom(key, value, ttl=None):
        if key.startswith("sig:dpl:"):
            raise RuntimeError("cache backend down")
        return real_set(key, value, ttl)

    monkeypatch.setattr(cache, "set", boom)
    client.dependency_overrides[get_current_user_with_plan] = _paid_user

    with caplog.at_level(logging.ERROR, logger="api.routers.signature"):
        r = TestClient(client, raise_server_exceptions=False).get(
            "/api/signature/darkpool-levels?sym=NVDA")

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["levels"] == levels, body
    assert not body.get("error"), body
    assert sig._DPL_STALE.peek("NVDA")[0]["levels"] == levels
    assert any("cache write" in rec.getMessage() for rec in caplog.records), caplog.text


def test_a_raise_while_book_keeping_is_not_a_500(client, monkeypatch, caplog):
    """The neg-cache write runs on the COLD path, the one with no try/except
    above it (serve_stale.py:143) — so a raise there is a 500 exactly like a
    raise from the provider (rule 1)."""
    async def down(sym):
        return {"sym": "SPY", "levels": [], "error": "Schwab not authenticated",
                "version": "gxw-v1", "asOf": 1.0}

    def boom(sym, payload):
        raise RuntimeError("dictionary changed size during iteration")

    monkeypatch.setattr(sig, "fetch_gex_walls", down)
    monkeypatch.setattr(sig, "_gxw_remember_error", boom)
    client.dependency_overrides[get_current_user_with_plan] = _paid_user

    with caplog.at_level(logging.ERROR, logger="api.routers.signature"):
        r = TestClient(client, raise_server_exceptions=False).get(
            "/api/signature/gex-walls?sym=SPY")

    assert r.status_code == 200, r.text
    assert r.json()["error"] == "Schwab not authenticated"
    assert any("bookkeeping" in rec.getMessage() for rec in caplog.records), caplog.text


# ── the router has to be MOUNTED, and the bars read has to be REAL ─────────

def test_the_router_is_mounted_on_the_real_app():
    """A router that imports clean but is never included 404s in production —
    this repo has already shipped that once (broker_sync, a dropped
    include_router that surfaced as 405 on POST). Every test above builds its
    own FastAPI app, so none of them would notice."""
    from api.main import app

    paths = {r.path for r in app.routes}
    assert {"/api/signature/darkpool-levels",
            "/api/signature/flow-breakout",
            "/api/signature/gex-walls"} <= paths


def test_fetch_bars_reads_the_real_store_under_the_D_key(tmp_path, monkeypatch):
    """One test must make the REAL fetch (lesson_injected_dependency_hides_the_
    fetch: 996 green tests shipped in 0 of 24 charts). Everything else here
    stubs get_bars, so only this one can catch a store that disagrees with the
    key we pass."""
    from api.services import bars_sqlite

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    bars_sqlite.bump_db_epoch()
    try:
        bars_sqlite.init_db()
        seeded = [{"t": (date(2026, 6, 1) + timedelta(days=i)).isoformat(),
                   "o": 95.0, "h": 100.0, "l": 90.0, "c": 95.5, "v": 1000}
                  for i in range(5)]
        assert bars_sqlite.put_bars("SIGX", "D", seeded, date_tf=True) == 5

        out = sig._fetch_bars("sigx", 60)
        assert [b["t"] for b in out] == [20260601, 20260602, 20260603, 20260604, 20260605]
        assert out[0]["c"] == 95.5 and out[0]["v"] == 1000
        # The key is the whole point: the product label finds nothing HERE, in
        # the real store, not just in a stub's assertion.
        assert bars_sqlite.get_bars("SIGX", "1D", 60) == []
    finally:
        bars_sqlite.bump_db_epoch()


# ── the FCB negative cache: the 2026-08-06 RTH outage (measured on the pod) ──
#
# `GET /api/signature/flow-breakout` returned {"error": "flow unavailable"}
# after 15-17s for SPY/QQQ/NVDA during RTH, and PASS 2 COST THE SAME. The error
# envelope is refused by good(), so it reached neither the TTL cache nor the
# stale slot — leaving ServeStale nothing to serve and every sequential request
# rebuilding, 15s of an anyio worker each, on the one shared uvicorn loop.


def _flow_outage(monkeypatch, *, delay=0.0):
    """A flow read that fails the way the pod's did: slowly, then None.

    `_fcb_ledger_signals` is stubbed empty so these tests measure the NEGATIVE
    CACHE alone — with a populated ledger the failed build succeeds from the
    fallback instead, which is a different rail (tested below).
    """
    calls = []
    monkeypatch.setattr(sig, "_fetch_bars", lambda sym, count=60: _bars())
    monkeypatch.setattr(sig, "_fcb_ledger_signals", lambda sym, bars: [])

    def fake(sym, cutoff_iso=""):
        calls.append(sym)
        if delay:
            time.sleep(delay)
        return None                       # the timeout's return value

    monkeypatch.setattr(sig, "_fetch_flow_by_date", fake)
    return calls


def test_a_flow_outage_is_remembered_so_the_second_request_does_not_rebuild(
        client, monkeypatch):
    """THE gate: a second call inside the window must not pay the read again.

    Asserted on the ARTIFACT (the flow read fired once) *and* on the wall clock
    (the second response beat the stubbed read's own duration), because the
    count alone would pass for a builder that is simply never reachable."""
    calls = _flow_outage(monkeypatch, delay=0.5)
    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    c = TestClient(client)

    t0 = time.time()
    first = c.get("/api/signature/flow-breakout?sym=SPY").json()
    cold = time.time() - t0

    t1 = time.time()
    second = c.get("/api/signature/flow-breakout?sym=SPY").json()
    warm = time.time() - t1

    assert first["error"] == second["error"] == "flow unavailable"
    assert calls == ["SPY"], f"the second request rebuilt: {calls}"
    assert cold >= 0.5, f"the cold path did not actually pay the read ({cold:.3f}s)"
    assert warm < 0.25, f"the second request paid the read again ({warm:.3f}s)"


def test_the_fcb_negative_entry_expires_so_the_outage_self_heals(client, monkeypatch):
    """The other direction: 60s of memory, not a permanent refusal. The tape
    quiets down, the read succeeds, and the very next request must see it."""
    calls = _flow_outage(monkeypatch)
    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    c = TestClient(client)

    assert c.get("/api/signature/flow-breakout?sym=SPY").json()["error"]
    assert calls == ["SPY"]

    payload, _at = sig._FCB_NEG_CACHE["SPY"]
    sig._FCB_NEG_CACHE["SPY"] = (payload, time.time() - sig._FCB_NEG_TTL_S - 1)

    def recovered(sym, cutoff_iso=""):
        calls.append(sym)
        return _bull_by_date()

    monkeypatch.setattr(sig, "_fetch_flow_by_date", recovered)
    body = c.get("/api/signature/flow-breakout?sym=SPY").json()

    assert calls == ["SPY", "SPY"]
    assert [s["direction"] for s in body["signals"]] == ["bull"]
    assert "SPY" not in sig._FCB_NEG_CACHE, "recovery must clear the negative entry"


def test_the_fcb_negative_cache_never_outranks_a_servable_payload(client, monkeypatch):
    """The GEX courtesy, owed here too. ServeStale checks fresh() BEFORE the
    stale slot, so a negative entry returned unconditionally would hand an
    ERROR to a user whose signals payload is seconds old — and self-perpetuate,
    because every request it answered skipped the stale path. A trader with a
    fine FCB overlay would watch the arrows vanish the moment the flow-worker
    got busy, and only the ~1-in-60s that fell through on expiry would see them
    again."""
    from api.services.cache import cache

    state = {"mode": "healthy"}
    monkeypatch.setattr(sig, "_fetch_bars", lambda sym, count=60: _bars())
    monkeypatch.setattr(sig, "_fcb_ledger_signals", lambda sym, bars: [])

    def adapter(sym, cutoff_iso=""):
        return _bull_by_date() if state["mode"] == "healthy" else None

    monkeypatch.setattr(sig, "_fetch_flow_by_date", adapter)
    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    c = TestClient(client)

    # 1. cold + healthy -> the TTL cache AND the stale slot hold real signals.
    good = c.get("/api/signature/flow-breakout?sym=SPY").json()["signals"]
    assert [s["direction"] for s in good] == ["bull"]

    # The flow-worker saturates, and the 5-min fresh window lapses.
    state["mode"] = "down"
    cache.invalidate(sig._ck("fcb", "SPY"))

    # 2. serves the stale signals, kicks a refresh that fails -> negative-cached.
    assert c.get("/api/signature/flow-breakout?sym=SPY").json()["signals"] == good
    assert _wait_for(lambda: "SPY" in sig._FCB_NEG_CACHE), "the outage must be remembered"
    cache.invalidate(sig._ck("fcb", "SPY"))

    # 3. THE regression: a seconds-old good payload still outranks the outage.
    body = c.get("/api/signature/flow-breakout?sym=SPY").json()
    assert body.get("signals") == good, body
    assert not body.get("error"), body


def test_the_fcb_negative_cache_still_answers_a_caller_with_nothing(client, monkeypatch):
    """The other half of the ordering rule: once the stale payload ages out (or
    never existed), the COLD caller does get the remembered envelope rather than
    paying the 15s read again. Without this the stand-down would be a blanket
    disable and the cache would never shield anyone."""
    calls = _flow_outage(monkeypatch)
    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    c = TestClient(client)

    assert c.get("/api/signature/flow-breakout?sym=SPY").json()["error"]
    sig._FCB_STALE._slots.clear()                    # nothing servable remains
    assert c.get("/api/signature/flow-breakout?sym=SPY").json()["error"]
    assert calls == ["SPY"]


def test_a_fcb_bookkeeping_raise_is_not_a_500(client, monkeypatch, caplog):
    """The neg-cache write runs on the COLD path, the one with no try/except
    above it (serve_stale.py:143) — so a raise there is a 500 exactly like a
    raise from the provider (rule 1). The prune ITERATES the dict, which is
    precisely the raise this guards."""
    _flow_outage(monkeypatch)

    def boom(sym, payload):
        raise RuntimeError("dictionary changed size during iteration")

    monkeypatch.setattr(sig, "_fcb_remember_error", boom)
    client.dependency_overrides[get_current_user_with_plan] = _paid_user

    with caplog.at_level(logging.ERROR, logger="api.routers.signature"):
        r = TestClient(client, raise_server_exceptions=False).get(
            "/api/signature/flow-breakout?sym=SPY")

    assert r.status_code == 200, r.text
    assert r.json()["error"] == "flow unavailable"
    assert any("bookkeeping" in rec.getMessage() for rec in caplog.records), caplog.text


# ── the nightly ledger as the fallback when the live read cannot answer ─────

def _seed_ledger(sym, bar_time, direction="bull", price=105.0, *,
                 indicator="fcb", version=None, tf="1D", meta=None):
    from api.services.signature import ledger as _led
    from api.services.signature import rules as _rules
    return _led.record_signal(indicator, version or _rules.VERSIONS["fcb"], sym, tf,
                              direction, bar_time, price,
                              meta=meta if meta is not None
                              else {"callPrem": 1200000.0, "putPrem": 50000.0})


def _flow_down(monkeypatch):
    calls = []
    monkeypatch.setattr(sig, "_fetch_bars", lambda sym, count=60: _bars())
    monkeypatch.setattr(sig, "_fetch_flow_by_date",
                        lambda sym, cutoff_iso="": calls.append(sym) or None)
    return calls


def test_a_flow_outage_falls_back_to_the_nightly_ledger(client, monkeypatch):
    """FCB is a DAILY closed-bar signal and the request path passes
    include_last=False, so the newest bar it can fire on is the last CLOSED
    session — the same one the 20:05 ET sweep already evaluated last night.
    During RTH the two cover the identical window, so the ledger is not a
    downgrade: it is the same answer without the 15s read."""
    _flow_down(monkeypatch)
    assert _seed_ledger("SPY", 20260621) is True

    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    body = TestClient(client).get("/api/signature/flow-breakout?sym=SPY").json()

    assert body.get("source") == "ledger", body
    assert not body.get("error"), body
    assert [(s["barTime"], s["direction"]) for s in body["signals"]] == [(20260621, "bull")]
    assert body["signals"][0]["callPrem"] == 1200000.0
    assert body["signals"][0]["close"] == 105.0


def test_an_unswept_symbol_is_never_downgraded_to_no_signal(client, monkeypatch):
    """The ledger's coverage is the sweep's fixed symbol list; the endpoint's is
    every symbol `_SYM_RE` allows. For a symbol the sweep never walked, an empty
    ledger and a genuinely quiet tape are INDISTINGUISHABLE — so the fallback
    must stay a failure there. `good()` is `"signals" in p`, so emitting an
    empty list would pin 'no signal' on the chart for the next 30 minutes
    (lesson_market_cap_cache_poison)."""
    _flow_down(monkeypatch)
    client.dependency_overrides[get_current_user_with_plan] = _paid_user

    body = TestClient(client).get("/api/signature/flow-breakout?sym=CRWV").json()

    assert body.get("error") == "flow unavailable", body
    assert "signals" not in body, body
    assert sig._FCB_STALE.peek("CRWV") == (None, None), "an outage is never remembered as good"
    assert "CRWV" in sig._FCB_NEG_CACHE, "but it IS remembered as an outage"


def test_the_ledger_fallback_is_bounded_to_the_window_the_bars_cover(client, monkeypatch):
    """The ledger is append-only and holds every signal ever recorded. Returning
    all of them would plant arrows on a chart window that does not contain
    them — lightweight-charts SNAPS an off-series marker to the nearest bar
    rather than dropping it, so an out-of-window signal becomes a confident
    arrow on the wrong candle."""
    _flow_down(monkeypatch)
    assert _seed_ledger("SPY", 20250102) is True     # a year before the window
    assert _seed_ledger("SPY", 20260621) is True     # inside it
    client.dependency_overrides[get_current_user_with_plan] = _paid_user

    body = TestClient(client).get("/api/signature/flow-breakout?sym=SPY").json()

    assert [s["barTime"] for s in body["signals"]] == [20260621], body


def test_the_ledger_fallback_is_ascending_and_only_this_indicator(client, monkeypatch):
    """`get_signals` returns NEWEST-first and every indicator/version/tf in the
    store. Markers must be ascending, and a dpl row — or a superseded fcb-v1 —
    must never be rendered as a flow-confirmed breakout."""
    _flow_down(monkeypatch)
    for bt in (20260621, 20260605, 20260612):        # deliberately out of order
        assert _seed_ledger("SPY", bt) is True
    assert _seed_ledger("SPY", 20260618, indicator="dpl") is True
    assert _seed_ledger("SPY", 20260619, version="fcb-v1") is True
    assert _seed_ledger("SPY", 20260620, tf="1W") is True
    client.dependency_overrides[get_current_user_with_plan] = _paid_user

    body = TestClient(client).get("/api/signature/flow-breakout?sym=SPY").json()

    assert [s["barTime"] for s in body["signals"]] == [20260605, 20260612, 20260621], body


def test_the_ledger_fallback_never_raises_into_the_cold_path(client, monkeypatch):
    """It runs inside `build()`, which ServeStale calls with no try/except. A
    fallback that can raise is not a fallback — it converts a degraded answer
    into a 500 on a user's chart."""
    from api.services.signature import ledger as _led

    _flow_down(monkeypatch)

    def boom(sym, limit=200):
        raise RuntimeError("database is locked")

    monkeypatch.setattr(_led, "get_signals", boom)
    client.dependency_overrides[get_current_user_with_plan] = _paid_user

    r = TestClient(client, raise_server_exceptions=False).get(
        "/api/signature/flow-breakout?sym=SPY")

    assert r.status_code == 200, r.text
    assert r.json()["error"] == "flow unavailable"


def test_the_ledger_is_read_only_on_the_fallback_path(client, monkeypatch):
    """The store is append-only and its honesty is the product's positioning —
    Phase C Task 9 owns the write door. Serving a signal must never write one,
    and a forming-bar fire must never enter it through this path."""
    from api.services.signature import ledger as _led

    _flow_down(monkeypatch)
    assert _seed_ledger("SPY", 20260621) is True

    writes = []
    monkeypatch.setattr(_led, "record_signal",
                        lambda *a, **kw: writes.append(a) or True)
    client.dependency_overrides[get_current_user_with_plan] = _paid_user

    body = TestClient(client).get("/api/signature/flow-breakout?sym=SPY").json()

    assert body["source"] == "ledger"
    assert writes == [], f"the fallback wrote to the append-only ledger: {writes}"


def test_a_recovered_flow_read_pops_an_unexpired_negative_entry(client, monkeypatch):
    """Recovery is IMMEDIATE, not TTL-bound — and that needs its OWN rail.

    `test_the_fcb_negative_entry_expires_so_the_outage_self_heals` ages the
    entry out first, so `_fcb_negative_hit` pops it on the expiry branch before
    the build ever runs: its closing "not in _FCB_NEG_CACHE" assertion passes
    even with the recovery pop DELETED. Measured — that mutation SURVIVED the
    whole suite until this test existed.

    So: stamp the entry NOW (asserted unexpired) and drive `_fcb_build`
    directly, which is the path ServeStale's background kick takes while the
    stale slot is still servable — the only way a fresh entry can be cleared
    before its 60s is up.
    """
    monkeypatch.setattr(sig, "_fetch_bars", lambda sym, count=60: _bars())
    monkeypatch.setattr(sig, "_fetch_flow_by_date",
                        lambda sym, cutoff_iso="": _bull_by_date())

    sig._FCB_NEG_CACHE["SPY"] = ({"sym": "SPY", "error": "flow unavailable"}, time.time())
    age = time.time() - sig._FCB_NEG_CACHE["SPY"][1]
    assert age < sig._FCB_NEG_TTL_S, f"the entry must be UNEXPIRED for this to mean anything ({age})"

    payload = sig._fcb_build("SPY")

    assert [s["direction"] for s in payload["signals"]] == ["bull"], payload
    assert "SPY" not in sig._FCB_NEG_CACHE, "a good payload must pop the outage immediately"


# ═══════════════════════════════════════════════════════════════════════════
# Phase C Task 13 — THE GENERIC SERVER LANE
# ═══════════════════════════════════════════════════════════════════════════

def test_the_sweep_still_imports_the_two_router_symbols_it_needs():
    """⛔ `sweep.py` IMPORTS `_flow_base_url` AND `_fetch_bars` FROM THIS ROUTER,
    and the nightly sweep is the ONLY ledger writer that runs unattended.

    Moving or renaming either breaks it SILENTLY — the import raises inside a
    scheduler thread, the job logs and dies, and nothing on any surface says the
    ledger stopped growing. Task 13 adds `_fetch_bars_for_tf` beside `_fetch_bars`
    precisely so the old one never has to move; this asserts the import the way
    the sweep performs it, not by reading the source.
    """
    from api.routers.signature import _fetch_bars, _flow_base_url
    assert callable(_fetch_bars) and callable(_flow_base_url)
    # …and the sweep's own call sites still resolve, executed for real.
    import api.services.signature.sweep as sweep_mod
    src = inspect.getsource(sweep_mod)
    assert "from api.routers.signature import _flow_base_url" in src
    assert "from api.routers.signature import _fetch_bars" in src
    # The signature the sweep passes through as `fetch_bars=` — a bare (sym) call.
    assert list(inspect.signature(_fetch_bars).parameters) == ["sym", "count"]


def test_the_lane_names_no_tenant(client):
    """⭐ A LANE IS GENERIC WHEN A FOURTH TENANT NEEDS NO CODE IN IT.

    `registry_defs.serve` resolves the definition, validates the inputs, calls
    the provider and enforces the wire contract. Read its own AST: no string
    literal in it is a definition id, so there is no `if def_id ==` for a
    reviewer to miss. Spec §10's "genericize in C" is this assertion.

    ⚠️ Re-parsed by NAME, never sliced by line number — a co-worker inserting
    lines above it returned the WRONG SLICE for Task 7 mid-run.
    """
    import ast
    from api.services.signature import registry_defs as rd
    tree = ast.parse(inspect.getsource(rd))
    fn = next(n for n in tree.body
              if isinstance(n, ast.FunctionDef) and n.name == "serve")
    literals = {n.value for n in ast.walk(fn)
                if isinstance(n, ast.Constant) and isinstance(n.value, str)}
    ids = {d["id"] for d in rd.SERVER_DEFS}
    assert literals & ids == set(), f"the lane hardcodes a tenant: {literals & ids}"
    # ⛔ AND THE PROBE CAN SEE A NAME THAT IS REALLY THERE, or the emptiness above
    # is a broken walk rather than a clean function.
    provider_fn = next(n for n in tree.body
                       if isinstance(n, ast.FunctionDef) and n.name == "provider_for")
    assert any(isinstance(n, ast.Constant) and isinstance(n.value, str)
               for n in ast.walk(provider_fn))
    # …and the four tenants really exist, so "names no tenant" is not vacuous.
    assert len(ids) == 4


def test_the_columns_route_serves_the_rs_line_as_a_bare_positional_ARRAY(client, monkeypatch):
    """⚠️ THE WIRE CONTRACT: arrays with `null`, never point objects.

    `[{time, value}]` is what the BINDER produces at its own boundary. A server
    emitting it would put that conversion in two places with nothing keeping them
    equal, and the first divergence is a line drawn on the wrong bars.
    """
    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    bars_by_sym = {
        "NVDA": [{"t": 1, "o": 1, "h": 1, "l": 1, "c": 100.0, "v": 1},
                 {"t": 2, "o": 1, "h": 1, "l": 1, "c": 110.0, "v": 1}],
        "SPY": [{"t": 1, "o": 1, "h": 1, "l": 1, "c": 400.0, "v": 1}],
    }
    monkeypatch.setattr(sig, "_fetch_bars_for_tf",
                        lambda sym, tf, count=400: bars_by_sym.get(sym.upper(), []))
    c = TestClient(client)
    r = c.get("/api/signature/columns?defId=rsLine&sym=NVDA&tf=D")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["defId"] == "rsLine" and body["sym"] == "NVDA"
    assert body["times"] == [1, 2]
    col = body["columns"]["rsLine"]
    assert isinstance(col, list) and len(col) == 2
    assert col == [0.25, None], col          # 100/400, then a bar the benchmark lacks
    assert all(v is None or isinstance(v, (int, float)) for v in col)
    assert not any(isinstance(v, dict) for v in col), "compute emitted point objects"


def test_the_lane_REFUSES_point_objects_from_a_tenant(client):
    """The refusal itself, driven directly — the route above cannot exercise it
    without a provider that is already wrong."""
    from api.services.signature import registry_defs as rd
    with pytest.raises(rd.ColumnContractViolation, match="point objects"):
        rd.wire_columns("rsLine", {"rsLine": [{"time": 1, "value": 2.0}]})
    # …and a well-formed column of the same length passes, so the refusal is
    # about the SHAPE and not about the data.
    assert rd.wire_columns("rsLine", {"rsLine": [2.0]}) == {"rsLine": [2.0]}


def test_the_lane_refuses_columns_a_definition_does_not_declare(client):
    from api.services.signature import registry_defs as rd
    with pytest.raises(rd.ColumnContractViolation, match="declares"):
        rd.wire_columns("rsLine", {"somethingElse": [1.0]})
    # Ragged columns are a DIFFERENT refusal with a DIFFERENT phrase — two gates
    # sharing one phrase is how a `pytest.raises(match=…)` stays green with the
    # safety deleted (Task 9's M1).
    with pytest.raises(rd.ColumnContractViolation, match="ragged"):
        rd.wire_columns("uct-flow-breakout", {"bull": [1.0, 0.0], "bear": [0.0]})


def test_NaN_and_inf_cross_the_wire_as_null(client):
    """FastAPI serializes with `allow_nan=False` and a browser's `r.json()`
    throws on a bare NaN — one poisoned cell would take the WHOLE overlay down
    rather than one bar."""
    from api.services.signature import registry_defs as rd
    out = rd.wire_columns("rsLine", {"rsLine": [float("nan"), float("inf"), 1.5]})
    assert out == {"rsLine": [None, None, 1.5]}


def test_the_flow_breakout_becomes_EVENT_COLUMNS_joined_by_DATE(client, monkeypatch):
    """⭐ THE SIGNATURE DEFINITION THAT IS A REAL COLUMN TENANT.

    A breakout is an EVENT — a {0, 1} column per direction, index-aligned to
    bars — which is the shape Phase C's alert grammar addresses. The markers the
    chart draws are one rendering of it, not the thing itself.

    ⚠️ JOINED BY DATE, NEVER BY INDEX: one missing bar under an index join
    shifts every subsequent signal, and the result is plausible and wrong for the
    whole history rather than absent for one bar.
    """
    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    bars = [{"t": 20260803, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1},
            {"t": 20260804, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1},
            {"t": 20260805, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}]
    monkeypatch.setattr(sig, "_fetch_bars", lambda sym, count=60: bars)
    monkeypatch.setattr(sig, "_serve_fcb", lambda s: {
        "sym": s, "version": "fcb-v2", "asOf": 1.0,
        "signals": [{"barTime": 20260804, "direction": "bull", "close": 1.0,
                     "version": "fcb-v2", "callPrem": 1.0, "putPrem": 0.0}]})
    c = TestClient(client)
    body = c.get("/api/signature/columns?defId=uct-flow-breakout&sym=NVDA&tf=D").json()
    assert body["columns"]["bull"] == [0.0, 1.0, 0.0]
    assert body["columns"]["bear"] == [0.0, 0.0, 0.0]
    # …and the signals list rides the SAME envelope, so the shipped marker
    # overlay costs no second request.
    assert [s["direction"] for s in body["signals"]] == ["bull"]
    assert body["times"] == [20260803, 20260804, 20260805]


def test_a_LEVELS_definition_declares_no_columns_and_says_so(client, monkeypatch):
    """Dark-pool levels and GEX walls draw horizontal LEVELS, which v1's plot
    vocabulary cannot express as a column (`hlines` takes a STATIC array,
    `zones` is schema-RESERVED). `columns: {}` + `times: []` is the honest
    declaration; inventing a column would be a definition that lies."""
    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    monkeypatch.setattr(sig, "_serve_dpl",
                        lambda s: {"sym": s, "levels": [{"price": 1.0}], "version": "dpl-v1"})
    c = TestClient(client)
    body = c.get("/api/signature/columns?defId=uct-darkpool-levels&sym=NVDA&tf=D").json()
    assert body["columns"] == {} and body["times"] == []
    assert body["levels"] == [{"price": 1.0}]


def test_an_unknown_definition_is_a_404_and_a_bad_enum_is_a_422(client):
    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    c = TestClient(client)
    assert c.get("/api/signature/columns?defId=nope&sym=NVDA").status_code == 404
    r = c.get('/api/signature/columns?defId=rsLine&sym=NVDA&inputs={"benchmark":"TSLA"}')
    assert r.status_code == 422, r.text
    assert "enum" in r.json()["detail"]
    assert c.get("/api/signature/columns?defId=rsLine&sym=NVDA&inputs=notjson").status_code == 422


def test_the_definitions_route_publishes_the_lane(client):
    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    body = TestClient(client).get("/api/signature/definitions").json()
    ids = [d["id"] for d in body["definitions"]]
    assert ids == ["uct-darkpool-levels", "uct-gex-walls", "uct-flow-breakout", "rsLine"]
    for d in body["definitions"]:
        assert d["compute"]["kind"] == "server"


def test_the_three_signature_definition_ids_are_the_ones_the_hook_addresses():
    """Cross-lane: the JS hook and the Python registry name the SAME three.

    A rename on either side leaves the overlay silently absent — the lane 404s
    and an absent overlay reads exactly like a quiet tape.
    """
    import pathlib
    import re
    from api.services.signature import registry_defs as rd
    src = pathlib.Path("app/src/hooks/useSignatureIndicators.js").read_text(encoding="utf-8")
    block = src.split("export const SIGNATURE_DEF_ID = {", 1)[1].split("}", 1)[0]
    js_ids = re.findall(r"'([^']+)'", block)
    assert js_ids == list(rd.SIGNATURE_DEF_IDS), (js_ids, rd.SIGNATURE_DEF_IDS)
    # ⛔ …and the hook no longer names one of the three legacy PATHS *in code*,
    # which is the genericization itself. The three routes stay MOUNTED (asserted
    # above); what changed is that the client addresses a definition instead.
    #
    # ⚠️ COMMENTS ARE STRIPPED FIRST, and the STRIPPER is what makes the zeroes
    # mean anything: the hook names all three paths in PROSE deliberately (the
    # retirement is worth reading about at the call site), and a probe that could
    # not tell a sentence from a fetch would force the prose out.
    code = re.sub(r"(?m)^\s*//.*$", "", src)
    code = re.sub(r"/\*[\s\S]*?\*/", "", code)
    for path in ("darkpool-levels", "gex-walls", "flow-breakout"):
        assert f"/api/signature/{path}" not in code, f"the hook still hardcodes /{path}"
        assert f"/api/signature/{path}" in src, (
            f"the stripper ate everything — /{path} is not even in the prose")


def test_the_rs_line_benchmarks_are_ONE_list_across_BOTH_LANES():
    """The `enum` vocabulary is shared, so a benchmark added on one side alone is
    a red test rather than an option that resolves to nothing."""
    import pathlib
    import re
    from api.services.signature import registry_defs as rd
    src = pathlib.Path("app/src/components/chart/engine/nativeRegistry.js").read_text(encoding="utf-8")
    block = src.split("key: 'benchmark'", 1)[1].split("options:", 1)[1].split("]],", 1)[0]
    js = re.findall(r"\['([A-Z]+)',", block)
    assert js == list(rd.RS_LINE_BENCHMARKS), (js, rd.RS_LINE_BENCHMARKS)
    assert len(js) >= 2, "a one-option enum makes this comparison vacuous"


def test_a_provider_row_is_ALL_a_fourth_tenant_costs(client):
    """⭐ THE GENERICITY CLAIM, EXERCISED RATHER THAN ARGUED.

    A definition row plus one `register_provider` call, and the lane serves it —
    no branch, no route, no client change. If this ever needs an edit inside
    `registry_defs.serve`, the lane stopped being one.
    """
    from api.services.signature import registry_defs as rd
    fourth = {
        "schemaVersion": rd.SCHEMA_VERSION, "id": "probe-tenant", "version": 1,
        "compute": {"kind": "server", "fn": "probe", "rev": 1},
        "meta": {"name": "Probe", "tier": "premium", "repaint": "non-repainting"},
        "placement": {"target": "pane"},
        "inputs": [{"key": "mode", "type": "enum", "default": "a", "options": ["a", "b"]}],
        "columns": ["probe"], "payload_keys": [], "rules_key": None,
    }
    rd._BY_ID["probe-tenant"] = fourth
    try:
        rd.register_provider("probe-tenant", lambda sym, tf, inputs: {
            "columns": {"probe": [1.0, None]}, "times": [1, 2], "mode": inputs["mode"]})
        out = rd.serve("probe-tenant", "NVDA", "D", {"mode": "b"})
        assert out["columns"] == {"probe": [1.0, None]}
        assert out["times"] == [1, 2] and out["inputs"] == {"mode": "b"}
        # …and its refusals are the lane's, not its own.
        with pytest.raises(rd.InputRejected):
            rd.serve("probe-tenant", "NVDA", "D", {"mode": "z"})
    finally:
        rd._BY_ID.pop("probe-tenant", None)
        rd._PROVIDERS.pop("probe-tenant", None)


def test_a_declared_definition_with_no_provider_refuses_DISTINCTLY(client):
    """A row with nothing plugged in is a different failure from an unknown id,
    and they carry DISJOINT phrases: two gates sharing one made a
    `pytest.raises(match=…)` still match with the safety deleted (Task 9's M1)."""
    from api.services.signature import registry_defs as rd
    saved = rd._PROVIDERS.pop("rsLine", None)
    try:
        with pytest.raises(rd.DefinitionHasNoProvider, match="nothing plugged in"):
            rd.provider_for("rsLine")
        with pytest.raises(rd.DefinitionNotOffered, match="no server-lane definition"):
            rd.provider_for("nope")
    finally:
        if saved is not None:
            rd._PROVIDERS["rsLine"] = saved


def test_the_columns_lane_never_500s_on_OUR_defect(client, monkeypatch, caplog):
    """Rule 1: a build must not 500 a user's chart. A provider that violates the
    wire contract is OUR defect, so it is logged with a traceback and answered
    with an envelope the client draws nothing from — never a 500, and never a
    payload anything could remember as good."""
    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    from api.services.signature import registry_defs as rd
    saved = rd._PROVIDERS["rsLine"]
    rd.register_provider("rsLine", lambda sym, tf, inputs: {
        "columns": {"rsLine": [{"time": 1, "value": 2.0}]}, "times": [1]})
    try:
        with caplog.at_level(logging.ERROR):
            r = TestClient(client, raise_server_exceptions=False).get(
                "/api/signature/columns?defId=rsLine&sym=NVDA")
        assert r.status_code == 200, r.text
        assert r.json()["columns"] == {} and r.json()["error"]
        assert any("server lane failed" in rec.message for rec in caplog.records)
    finally:
        rd.register_provider("rsLine", saved)


# -- the cold read's cost: where the seconds went, and what stops paying them --
#
# Measured against production 2026-08-06. `/api/signature/flow-breakout` cold:
# SPY 15.4 s, TSLA 13.0 s, QQQ 12.9 s, NVDA 9.0 s, AAPL/IWM/AMD 3.6-3.9 s - all
# HTTP 200 with real data, so neither the negative cache nor the ledger fallback
# (both failure-only) can fire. The seconds are in the UPSTREAM BUILD: measured
# TTFB on `/api/flow/ticker`, SPY?source=indexes 7.59 s for 8.2 MB gzipped
# (41 MB / 349,203 rows over 22 columns), NVDA 3.63 s, AAPL 1.68 s - plus a
# whole extra 1.06 s round trip for SPY's `stocks` probe, which can only ever
# return a 145-byte bare header.


def _flow_probe_seq(monkeypatch, bodies, status=200, delays=None):
    """Record EVERY flow call, and answer per `?source=`.

    `_flow_probe` keeps only the last call, which cannot see a two-leg read at
    all - the leg count, the leg ORDER and the timeout each leg was handed are
    the whole behaviour here.

    `delays[source]` sleeps before answering, which is how the budget is spent
    without a fake clock: the deadline is real wall time, and a test that moved
    a patched clock instead would pass against an implementation that had no
    deadline in it.
    """
    import httpx as _httpx
    calls = []

    class _Resp:
        def __init__(self, body):
            self.status_code = status
            self._body = body

        def iter_lines(self):
            yield from self._body.splitlines()

    class _Ctx:
        def __init__(self, body):
            self._body = body

        def __enter__(self):
            return _Resp(self._body)

        def __exit__(self, *exc):
            return False

    def fake_stream(method, url, params=None, headers=None, timeout=None, **kw):
        source = (params or {}).get("source")
        calls.append({"source": source, "timeout": timeout, "url": url,
                      "cols": (params or {}).get("cols")})
        if delays and source in delays:
            time.sleep(delays[source])
        return _Ctx(bodies.get(source, _EMPTY_FLOW))

    monkeypatch.setattr(_httpx, "stream", fake_stream)
    return calls


_EMPTY_FLOW = "CreatedDate,CallPut,Premium\r\n"
_NARROW_ROWS = _EMPTY_FLOW + "6/21/2026,C,$1.2M\r\n"


@pytest.fixture(autouse=True)
def _forget_which_source_answered():
    """The index-filed memo is per-PROCESS by design and so leaks between tests.

    Autouse rather than per-test: it is invisible state, and a test that forgot
    to clear it would not fail here - it would fail somewhere else, later, as a
    leg order nobody wrote.
    """
    sig._FCB_INDEX_FILED.clear()
    yield
    sig._FCB_INDEX_FILED.clear()


def test_the_flow_read_asks_for_only_the_columns_the_join_parses(monkeypatch):
    """The read streams so THIS side never holds the body; `cols` is so the
    OTHER side never builds it. Upstream SELECTed 22 columns, CSV-wrote them and
    gzipped the lot into memory before shipping a byte, for the three fields
    `flow_by_date` resolves by name.

    Pinned to `FLOW_COLS` itself, not to a spelled-out list: the question asked
    and the fields parsed are the same tuple, and a hand-copied list here would
    let them drift the moment one side gained a field.
    """
    calls = _flow_probe_seq(monkeypatch, {"stocks": _NARROW_ROWS})

    by_date = sig._fetch_flow_by_date("NVDA")

    assert [c["cols"] for c in calls] == [",".join(flow_breakout.FLOW_COLS)]
    assert set(flow_breakout.FLOW_COLS) == {"CreatedDate", "CallPut", "Premium"}
    # And the narrowed reply still joins - asking for less must not mean parsing
    # less. A `cols` the far side ignores yields the full header and this passes
    # too, which is exactly the back-compatibility being claimed.
    assert [r["Premium"] for r in by_date["2026-06-21"]] == ["$1.2M"]


def test_the_two_source_read_spends_ONE_budget_across_BOTH_legs(monkeypatch):
    """Each leg used to carry its own `timeout=15.0`, so an index symbol whose
    first leg was merely SLOW could hold an anyio worker for THIRTY seconds -
    while the negative cache's whole justification, and every comment in the
    module, calls the request path's budget fifteen.

    The second leg gets the REMAINDER. Asserted as a strict inequality against
    the budget, because a fresh full timeout is precisely the bug.
    """
    calls = _flow_probe_seq(monkeypatch,
                            {"stocks": _EMPTY_FLOW, "indexes": _NARROW_ROWS},
                            delays={"stocks": 0.25})

    by_date = sig._fetch_flow_by_date("SPY")

    assert [c["source"] for c in calls] == ["stocks", "indexes"]
    assert calls[0]["timeout"] == sig._FLOW_READ_BUDGET_S
    assert calls[1]["timeout"] < sig._FLOW_READ_BUDGET_S, calls
    assert calls[1]["timeout"] >= sig._FLOW_READ_BUDGET_S - 5.0, "not a nonsense remainder"
    assert list(by_date) == ["2026-06-21"]


def test_a_spent_budget_is_a_FAILED_read_never_a_quiet_tape(monkeypatch):
    """When the first leg eats the budget the second is not started at all -
    and the answer is None, not `{}`.

    That distinction is the correctness half. `{}` would flow to `fcb_signals`,
    produce `signals: []`, satisfy `_fcb_good`, and be written to the TTL cache
    AND remembered by the stale slot: "we ran out of time" served as "the tape
    was quiet" for the next thirty minutes (`lesson_market_cap_cache_poison`).
    """
    monkeypatch.setattr(sig, "_FLOW_READ_BUDGET_S", 1.4)
    calls = _flow_probe_seq(monkeypatch,
                            {"stocks": _EMPTY_FLOW, "indexes": _NARROW_ROWS},
                            delays={"stocks": 1.3})

    result = sig._fetch_flow_by_date("SPY")

    assert result is None, "a spent budget must be a failure, not an empty join"
    assert [c["source"] for c in calls] == ["stocks"], "the second leg must not start"


def test_an_index_filed_symbol_stops_paying_the_bare_header_probe(monkeypatch):
    """SPY's flow is filed under `indexes`, so the default `stocks` leg can only
    ever return a bare header - a whole extra round trip (measured 1.06 s TTFB
    on prod for a 145-byte body) before the real read begins.

    Learned, never hardcoded: membership stays upstream's to change. The FIRST
    read still pays both legs - that is what teaches it.
    """
    calls = _flow_probe_seq(monkeypatch,
                            {"stocks": _EMPTY_FLOW, "indexes": _NARROW_ROWS})

    assert list(sig._fetch_flow_by_date("SPY")) == ["2026-06-21"]
    assert [c["source"] for c in calls] == ["stocks", "indexes"]

    calls.clear()
    assert list(sig._fetch_flow_by_date("SPY")) == ["2026-06-21"]
    assert [c["source"] for c in calls] == ["indexes"], "the probe must not be paid twice"

    # A real stock is untouched: `stocks` stays the default order, and it must
    # still cost exactly ONE request.
    stock_calls = _flow_probe_seq(monkeypatch, {"stocks": _NARROW_ROWS})
    assert list(sig._fetch_flow_by_date("NVDA")) == ["2026-06-21"]
    assert [c["source"] for c in stock_calls] == ["stocks"]


def test_the_index_memo_is_UNLEARNED_when_indexes_stops_answering(monkeypatch):
    """A memo that cannot be wrong is a hardcoded list with extra steps.

    If upstream re-files a symbol, `indexes` goes empty and `stocks` answers.
    Without the unlearn, that symbol pays the wasted probe on EVERY later read -
    the mirror image of the cost this memo exists to remove - so the drop is
    asserted by observing the leg order of the read AFTER the one that healed.
    """
    _flow_probe_seq(monkeypatch, {"stocks": _EMPTY_FLOW, "indexes": _NARROW_ROWS})
    sig._fetch_flow_by_date("SPY")
    assert "SPY" in sig._FCB_INDEX_FILED

    # Upstream re-files it: `indexes` is now empty and `stocks` carries the rows.
    calls = _flow_probe_seq(monkeypatch,
                            {"stocks": _NARROW_ROWS, "indexes": _EMPTY_FLOW})
    assert list(sig._fetch_flow_by_date("SPY")) == ["2026-06-21"]
    assert [c["source"] for c in calls] == ["indexes", "stocks"]

    calls.clear()
    assert list(sig._fetch_flow_by_date("SPY")) == ["2026-06-21"]
    assert [c["source"] for c in calls] == ["stocks"], "the stale memo must be gone"


def test_a_failed_read_never_teaches_the_memo_anything(monkeypatch):
    """A 500 is not a filing. Remembering a source because a read of it FAILED
    would route every later read of that symbol at the source least likely to
    answer, and `lesson_market_cap_cache_poison` is the same rule one level up:
    never record a failed fetch as a fact.
    """
    _flow_probe_seq(monkeypatch, {"indexes": _NARROW_ROWS}, status=503)

    assert sig._fetch_flow_by_date("SPY") is None
    assert sig._FCB_INDEX_FILED == {}, sig._FCB_INDEX_FILED


def test_an_empty_read_never_teaches_the_memo_anything(monkeypatch):
    """Both sources quiet is an ANSWER, but it is not evidence of a filing.
    Recording it would pin a symbol to a source that returned nothing."""
    _flow_probe_seq(monkeypatch, {})

    assert sig._fetch_flow_by_date("ZZZZ") == {}
    assert sig._FCB_INDEX_FILED == {}, sig._FCB_INDEX_FILED
