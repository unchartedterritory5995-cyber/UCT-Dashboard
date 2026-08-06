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


@pytest.fixture
def client(monkeypatch, tmp_path):
    from api.services.signature import ledger
    monkeypatch.setattr(ledger, "_DB_PATH", str(tmp_path / "ledger.db"))
    monkeypatch.setattr(ledger, "_INITED", False)
    for slot in (sig._DPL_STALE, sig._FCB_STALE, sig._GXW_STALE):
        slot._slots.clear()
    # The negative caches are module-level too, and they now ride `fresh()` on
    # BOTH gex-walls and flow-breakout. A test that legitimately remembers an
    # outage for NVDA would otherwise answer the NEXT test's cold request from
    # that entry — the slots were already cleared here for exactly this reason.
    sig._GXW_NEG_CACHE.clear()
    sig._FCB_NEG_CACHE.clear()
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

def test_a_free_user_is_refused_on_every_route(client, monkeypatch):
    """402 with the Signature copy, on ALL THREE routes. A gate applied to two
    of three routes passes any single-route test."""
    client.dependency_overrides[get_current_user_with_plan] = _free_user
    monkeypatch.setattr(sig, "_dpl_build", lambda sym: {"levels": []})
    monkeypatch.setattr(sig, "_fcb_build", lambda sym: {"signals": []})
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
    assert seen["params"] == {"source": "stocks"}
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
