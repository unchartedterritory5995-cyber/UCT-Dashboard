"""Option A — the `/flow` card derived from the Options Flow page's own product (2026-09-25).

Rails for `api/services/flow_card_from_page.py` (the mapper, the ladder, the fallback contract),
`flow_db.stream_csv_symbol(dates=)` and the router's `window_days` plumbing. No network: the
product is a fixture shaped exactly like the real `/api/flow/ticker-product` rows (field names
and the year-less `Dt`/`E` spellings copied from a production payload for DELL on 2026-09-24).
"""
from __future__ import annotations

import datetime as dt
import sqlite3

import pytest

from api.services import flow_card_from_page as page

WIN = ["9/22/2026", "9/23/2026", "9/24/2026"]


def _row(Dt, CP, K, E, P, D, V=100, price=1.5, OI=500, DTE=15, Spot=530.0, pct=1.0, expiry=None):
    return {"Dt": Dt, "CP": CP, "K": K, "E": E, "P": P, "D": D, "V": V, "price": price, "OI": OI,
            "DTE": DTE, "Spot": Spot, "pctFromSpot": pct, "expiry": expiry, "Ty": "SWP", "Co": "WHITE"}


PRODUCT = {"all_directional": [
    _row("9/24", "C", 535, "10/9", 1_968_000, "BULL", expiry="2026-10-09T00:00:00.000Z"),
    _row("9/24", "C", 535, "10/9", 100_000, "BEAR", expiry="2026-10-09T00:00:00.000Z"),   # mixed contract
    _row("9/24", "P", 520, "6/16/28", 1_147_500, "BEAR", expiry="2028-06-16T00:00:00.000Z"),
    _row("9/23", "P", 520, "6/16/28", 50_000, "BEAR", expiry="2028-06-16T00:00:00.000Z"),  # second day
    _row("9/10", "C", 700, "1/15/27", 5_000_000, "BULL", expiry="2027-01-15T00:00:00.000Z"),  # outside window
    _row("9/24", "C", 999, "", 1, "BULL", expiry=None),                                        # no expiry → dropped
], "TICKER_DB": []}


# ── the mapper ──────────────────────────────────────────────────────────────────────────────

def test_the_payload_is_the_pages_own_sums_scoped_to_the_window():
    p = page.build_payload(PRODUCT, WIN, "DELL", "stocks", "5")
    keys = [(c["cp"], c["strike"], c["exp"]) for c in p["contracts"]]
    assert keys == [("C", 535.0, "10/9/2026"), ("P", 520.0, "6/16/2028")], keys
    c535, p520 = p["contracts"]
    assert c535["premium"] == 2_068_000 and c535["direction"] == "Mixed"
    assert c535["bull_premium"] == 1_968_000 and c535["bear_premium"] == 100_000
    assert p520["premium"] == 1_197_500 and p520["direction"] == "Bear"
    assert p520["days_active"] == 2 and p520["first_seen"] == "9/23/2026"
    assert p["net"] == {"bull": 1_968_000, "bear": 1_297_500, "unclassified": 0, "dir": "BULL"}
    assert p["window"] == {"start": "9/23/2026", "end": "9/24/2026", "active_days": 2, "days_requested": "5"}
    assert p["derivation"] == "page" and p["contract_count"] == 2 and p["spot"] == 530.0


def test_a_row_outside_the_window_is_not_counted_and_all_history_keeps_it():
    scoped = page.build_payload(PRODUCT, WIN, "DELL", "stocks", "5")
    assert all(c["strike"] != 700.0 for c in scoped["contracts"])
    everything = page.build_payload(PRODUCT, ["9/24/2026"], "DELL", "stocks", "all", all_history=True)
    assert any(c["strike"] == 700.0 for c in everything["contracts"]), "the all-history rung dropped a row"
    assert everything["window"]["start"] == "9/10/2026"


def test_expiries_normalise_to_the_cards_m_d_yyyy_from_iso_first_then_display():
    assert page.expiry_mdy({"expiry": "2026-10-09T00:00:00.000Z", "E": "10/9"}) == "10/9/2026"
    assert page.expiry_mdy({"expiry": None, "E": "1/15/27"}) == "1/15/2027"
    assert page.expiry_mdy({"expiry": "", "E": ""}) is None


def test_a_year_less_trade_date_resolves_against_the_window_never_the_wall_clock():
    assert page._resolve_row_date({"Dt": "9/23"}, WIN) == "9/23/2026"
    assert page._resolve_row_date({"Dt": "9/10"}, WIN) == "9/10/2026"      # ≤ window end, same year
    assert page._resolve_row_date({"Dt": "12/30"}, WIN) == "12/30/2025"    # would be future → prior year
    assert page._resolve_row_date({"Dt": "9/23/2026"}, WIN) == "9/23/2026"
    assert page._resolve_row_date({"Dt": ""}, WIN) is None


def test_moneyness_is_signed_the_cards_way_not_the_pages_unsigned_distance():
    """The page's pctFromSpot is |strike−spot|/spot (a distance). The card reads positive as ITM,
    so a 535 call at spot 525 must read −1.9 (OTM), a 535 put at 525 must read +1.9 (ITM), and
    the page's own field must never reach the payload."""
    assert page.signed_moneyness("C", 535, 525) == -1.9
    assert page.signed_moneyness("P", 535, 525) == 1.9
    assert page.signed_moneyness("C", 535, 0) is None
    prod = {"all_directional": [_row("9/24", "C", 535, "10/9", 1000, "BULL", Spot=525.0, pct=1.9,
                                     expiry="2026-10-09T00:00:00.000Z")]}
    p = page.build_payload(prod, WIN, "DELL", "stocks", "1")
    assert p["contracts"][0]["moneynessPct"] == -1.9


def test_the_card_subtitle_says_today_for_a_one_day_window():
    from api.flow_ticker_card import _window_label
    assert _window_label({"days_requested": "1", "start": "9/24/2026", "end": "9/24/2026", "active_days": 1}).startswith("today")
    assert _window_label({"days_requested": "5", "active_days": 2}).startswith("last 5 trading days")


def test_top_n_keeps_the_biggest_by_premium_but_nets_over_everything():
    p = page.build_payload(PRODUCT, WIN, "DELL", "stocks", "5", top_n=1)
    assert len(p["contracts"]) == 1 and p["contracts"][0]["strike"] == 535.0
    assert p["contract_count"] == 2 and p["net"]["bear"] == 1_297_500


# ── the ladder and the fallback contract ────────────────────────────────────────────────────

def test_the_ladder_widens_to_the_first_rung_with_a_contract_and_says_so(monkeypatch):
    monkeypatch.setenv("WORKER_INTERNAL_URL", "http://flow-worker.test")
    calls = []

    def fake_get(ticker, params, headers):
        calls.append(dict(params))
        wd = params.get("window_days")
        if wd == 1:
            return {"ok": True, "window_dates": ["9/24/2026"], "product": {"all_directional": []}}
        return {"ok": True, "window_dates": WIN, "product": PRODUCT}
    p = page.page_derived_payload("DELL", "1", "stocks", get=fake_get)
    assert [c.get("window_days") for c in calls] == [1, 5]
    assert p["window"]["days_requested"] == "5" and p["window"]["widened_from"] == "1"
    assert p["derivation"] == "page"


def test_a_declined_derivation_on_every_rung_is_none_so_the_rollup_answers(monkeypatch):
    monkeypatch.setenv("WORKER_INTERNAL_URL", "http://flow-worker.test")
    assert page.page_derived_payload("NVDA", "1", "stocks", get=lambda *a: {"ok": False}) is None
    assert page.page_derived_payload("NVDA", "1", "stocks", get=lambda *a: (_ for _ in ()).throw(RuntimeError("x"))) is None


def test_the_etf_partition_is_asked_for_with_the_pages_word(monkeypatch):
    monkeypatch.setenv("WORKER_INTERNAL_URL", "http://flow-worker.test")
    seen = {}

    def fake_get(ticker, params, headers):
        seen.update(params); return {"ok": True, "window_dates": WIN, "product": PRODUCT}
    page.page_derived_payload("IWM", "1", "etfs", get=fake_get)
    assert seen["source"] == "indexes"


def test_without_the_worker_url_the_path_declines_without_touching_the_network(monkeypatch):
    monkeypatch.delenv("WORKER_INTERNAL_URL", raising=False)
    assert page.fetch_product("DELL", "stocks", 1, 5.0) is None


def test_the_flag_defaults_to_the_rollup(monkeypatch):
    monkeypatch.delenv(page.FLAG, raising=False)
    assert page.enabled() is False
    monkeypatch.setenv(page.FLAG, "1")
    assert page.enabled() is True
    monkeypatch.setenv(page.FLAG, "0")
    assert page.enabled() is False


# ── the Discord job: flag on → page; page unavailable → rollup, LABELLED ────────────────────

def test_the_job_uses_the_page_when_flagged_and_labels_a_rollup_fallback(monkeypatch):
    from api.routers import discord_interactions as router
    sent = []
    edit = lambda app_id, token, **kw: sent.append(kw)
    monkeypatch.setenv(page.FLAG, "1")
    payload = page.build_payload(PRODUCT, WIN, "DELL", "stocks", "1")
    monkeypatch.setattr(page, "page_derived_payload", lambda *a, **k: payload)
    rendered = {}
    router.run_flow_card_job("A", "T", "DELL", "1", render_fn=lambda d: rendered.setdefault("d", d) and b"png",
                             edit_fn=edit, source="stocks")
    assert rendered["d"]["derivation"] == "page"
    # the page cannot be derived → the rollup fetch (here the V2 seam) answers, LABELLED
    monkeypatch.setattr(page, "page_derived_payload", lambda *a, **k: None)
    rollup = {"ok": True, "contracts": [{"cp": "C", "strike": 1, "exp": "1/1/2030", "premium": 1}],
              "net": {"dir": "BULL"}, "window": {"days_requested": "1"}}
    rendered.clear()
    router.run_flow_card_job("A", "T", "DELL", "1", fetch_fn=lambda t, d: dict(rollup),
                             render_fn=lambda d: rendered.setdefault("d", d) and b"png",
                             edit_fn=edit, source="stocks", timeout_s=1.0)
    assert rendered["d"]["derivation"] == "rollup"
    # ...and with the flag OFF the page is never consulted, even when it would answer
    monkeypatch.setenv(page.FLAG, "0")
    monkeypatch.setattr(page, "page_derived_payload", lambda *a, **k: (_ for _ in ()).throw(AssertionError("consulted")))
    rendered.clear()
    router.run_flow_card_job("A", "T", "DELL", "1", fetch_fn=lambda t, d: dict(rollup),
                             render_fn=lambda d: rendered.setdefault("d", d) and b"png",
                             edit_fn=edit, source="stocks", timeout_s=1.0)
    assert rendered["d"]["derivation"] == "rollup"


# ── the store: a date-windowed stream ───────────────────────────────────────────────────────

def test_stream_csv_symbol_restricts_to_the_given_dates(tmp_path):
    from api.flow_db import FlowDB
    db = FlowDB(str(tmp_path / "flow.db"))
    conn = sqlite3.connect(str(tmp_path / "flow.db"))
    for i, day in enumerate(["9/22/2026", "9/23/2026", "9/24/2026"]):
        conn.execute("INSERT INTO flow (source, CreatedDate, Symbol, Premium, dedup_key) VALUES ('stocks', ?, 'DELL', '1', ?)", (day, f"k{i}"))
    conn.commit(); conn.close()
    everything = "".join(db.stream_csv_symbol("DELL", "stocks")).strip().splitlines()
    windowed = "".join(db.stream_csv_symbol("DELL", "stocks", dates=["9/23/2026", "9/24/2026"])).strip().splitlines()
    assert len(everything) == 4 and len(windowed) == 3        # header + rows
    assert all("9/22/2026" not in line for line in windowed[1:])


# ── the router: window_days builds over the symbol's last N sessions ────────────────────────

def test_the_router_builds_a_windowed_product_over_the_last_n_sessions(tmp_path, monkeypatch):
    from api import flow_router as fr
    from api.flow_db import FlowDB
    dbp = tmp_path / "flow.db"
    FlowDB(str(dbp))
    conn = sqlite3.connect(str(dbp))
    for i, day in enumerate(["9/18/2026", "9/22/2026", "9/23/2026", "9/24/2026"]):
        conn.execute("INSERT INTO flow (source, CreatedDate, Symbol, Premium, dedup_key) VALUES ('stocks', ?, 'DELL', '1', ?)", (day, f"k{i}"))
    conn.commit(); conn.close()
    monkeypatch.setattr(fr, "db", FlowDB(str(dbp)))
    monkeypatch.setattr(fr, "_search_freshness", lambda sym, src: "v1")
    monkeypatch.setattr(fr.flow_aggregate, "available", lambda: True)
    fr._SEARCH_PRODUCT_CACHE.clear()
    captured = {}

    def fake_build(sym, src, key, version, st, dates=None, extra=None):
        captured.update({"dates": dates, "extra": extra, "key": key})
        return b"gz", None
    monkeypatch.setattr(fr, "_build_search_product", fake_build)
    monkeypatch.setattr(fr, "_search_response", lambda gz, version, how: {"how": how})
    out = fr.get_flow_ticker_product("DELL", source="stocks", window_days=2, _auth={"via": "test"})
    assert out == {"how": "windowed"}
    assert captured["dates"] == ["9/23/2026", "9/24/2026"], captured
    assert captured["extra"]["window_dates"] == ["9/23/2026", "9/24/2026"]
    assert captured["key"] == ("DELL", "stocks", "v1", "w2"), "the windowed product must not share the full product's cache key"


# ── THROUGH THE ROUTER, not the handler (2026-09-25: the decorator landed on the wrong def) ───

def _client(monkeypatch, tmp_path, dates):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api import flow_router as fr
    from api.flow_admin_auth import require_flow_user
    from api.flow_db import FlowDB
    dbp = tmp_path / "flow.db"
    FlowDB(str(dbp))
    conn = sqlite3.connect(str(dbp))
    for i, day in enumerate(dates):
        conn.execute("INSERT INTO flow (source, CreatedDate, Symbol, Premium, dedup_key) "
                     "VALUES ('stocks', ?, 'DELL', '1', ?)", (day, f"r{i}"))
    conn.commit(); conn.close()
    monkeypatch.setattr(fr, "db", FlowDB(str(dbp)))
    monkeypatch.setattr(fr, "_search_freshness", lambda sym, src: "v1")
    monkeypatch.setattr(fr.flow_aggregate, "available", lambda: True)
    fr._SEARCH_PRODUCT_CACHE.clear()
    app = FastAPI()
    app.include_router(fr.flow_router)
    app.dependency_overrides[require_flow_user] = lambda: {"via": "test"}
    return fr, TestClient(app, raise_server_exceptions=False)


def test_the_ticker_product_route_is_bound_to_its_handler():
    """Resolve the route the way FastAPI does. A helper defined between the decorator and the
    handler takes the route silently; this is the assertion that names it."""
    from api import flow_router as fr
    bound = {r.path: r.endpoint.__name__ for r in fr.flow_router.routes if hasattr(r, "endpoint")}
    assert bound["/api/flow/ticker-product/{symbol}"] == "get_flow_ticker_product", bound


def test_the_members_search_request_still_routes_and_declines_cold_as_before(monkeypatch, tmp_path):
    """The Options Flow page's own call (`warm_only=1`) on a cold key: an immediate 503 'not warm'
    and a background warm, exactly as before option A. With the decorator on the wrong def this
    was a 422 for every member search."""
    fr, c = _client(monkeypatch, tmp_path, ["9/24/2026"])
    warmed = []
    monkeypatch.setattr(fr, "_spawn_search_warm", lambda *a: warmed.append(a))
    r = c.get("/api/flow/ticker-product/DELL?source=stocks&warm_only=1")
    assert r.status_code == 503 and r.json().get("error") == "not warm", (r.status_code, r.text[:200])
    assert warmed, "the cold member request did not start a background warm"


def test_the_window_is_the_markets_last_sessions_not_the_tickers(monkeypatch, tmp_path):
    """The page's "Last N" is the last N MARKET sessions. DELL printed on 9/22 and 9/23; another
    name printed on 9/24. A one-session window is 9/24 — DELL's product for it is empty and the
    card's ladder widens — never "DELL's own last date"."""
    fr, c = _client(monkeypatch, tmp_path, ["9/22/2026", "9/23/2026"])
    conn = sqlite3.connect(fr.db.db_path)
    conn.execute("INSERT INTO flow (source, CreatedDate, Symbol, Premium, dedup_key) "
                 "VALUES ('stocks', '9/24/2026', 'NVDA', '1', 'other')")
    conn.commit(); conn.close()
    seen = {}

    def fake_build(sym, src, key, version, st, dates=None, extra=None):
        import gzip, json as _j
        seen["dates"] = dates
        body = {"ok": True, "product": {"all_directional": []}}
        body.update(extra or {})
        return gzip.compress(_j.dumps(body).encode()), None
    monkeypatch.setattr(fr, "_build_search_product", fake_build)
    r = c.get("/api/flow/ticker-product/DELL?source=stocks&window_days=1")
    assert r.status_code == 200 and seen["dates"] == ["9/24/2026"], (r.status_code, seen)


def test_the_windowed_path_never_scans_the_tickers_history(monkeypatch, tmp_path):
    """⚰️ A per-symbol `SELECT DISTINCT CreatedDate ... Symbol = ?` cost 70-218 s on a cold pod.
    The windowed path takes its dates from the cached market calendar; no SQL it runs may
    select dates by symbol."""
    import sqlite3 as _sq
    from api import flow_router as fr
    fr2, c = _client(monkeypatch, tmp_path, ["9/23/2026", "9/24/2026"])
    seen_sql = []
    real = _sq.connect

    class _C:
        def __init__(self, conn): self._c = conn
        def execute(self, sql, *a):
            seen_sql.append(" ".join(str(sql).split())); return self._c.execute(sql, *a)
        def __getattr__(self, n): return getattr(self._c, n)
        def __enter__(self): return self
        def __exit__(self, *a): return self._c.__exit__(*a)
    monkeypatch.setattr(_sq, "connect", lambda *a, **k: _C(real(*a, **k)))
    monkeypatch.setattr(fr2, "_build_search_product", lambda *a, **k: (b"", None))
    monkeypatch.setattr(fr2, "_search_response", lambda gz, v, how: {"how": how})
    c.get("/api/flow/ticker-product/DELL?source=stocks&window_days=2")
    bad = [q for q in seen_sql if "DISTINCT CreatedDate" in q]
    assert not bad, f"the windowed path ran a full DISTINCT-dates scan (ticker history or partition): {bad}"
    assert any("RECURSIVE" in q for q in seen_sql), "the windowed calendar is not the loose index scan"


def test_the_windowed_request_routes_end_to_end(monkeypatch, tmp_path):
    fr, c = _client(monkeypatch, tmp_path, ["9/18/2026", "9/22/2026", "9/23/2026", "9/24/2026"])
    seen = {}

    def fake_build(sym, src, key, version, st, dates=None, extra=None):
        import gzip, json as _j
        seen.update(dates=dates, key=key)
        body = {"ok": True, "sym": sym, "source": src, "version": version, "product": {"all_directional": []}}
        body.update(extra or {})
        return gzip.compress(_j.dumps(body).encode()), None
    monkeypatch.setattr(fr, "_build_search_product", fake_build)
    r = c.get("/api/flow/ticker-product/DELL?source=stocks&window_days=2")
    assert r.status_code == 200, (r.status_code, r.text[:200])
    assert r.json()["window_dates"] == ["9/23/2026", "9/24/2026"]
    assert r.headers.get("X-Flow-Cache") == "windowed"
    assert seen["key"] == ("DELL", "stocks", "v1", "w2")


# ── the loose-scan calendar and the per-date stream (measured in the pod 2026-09-25) ──────────

def _multi_date_db(tmp_path):
    from api.flow_db import FlowDB
    dbp = tmp_path / "flow.db"
    db = FlowDB(str(dbp))
    conn = sqlite3.connect(str(dbp))
    rows = [("stocks", "9/2/2026", "DELL"), ("stocks", "9/10/2026", "DELL"), ("stocks", "10/1/2026", "AMD"),
            ("indexes", "9/10/2026", "SPY"), ("indexes", "12/31/2025", "SPY"), ("stocks", "9/10/2026", "AMD")]
    for i, (src, day, sym) in enumerate(rows):
        conn.execute("INSERT INTO flow (source, CreatedDate, Symbol, Premium, dedup_key) VALUES (?,?,?,'1',?)",
                     (src, day, sym, f"m{i}"))
    conn.commit(); conn.close()
    return db


def test_the_windowed_calendar_is_exactly_the_pages_get_available_dates(tmp_path, monkeypatch):
    from api import flow_router as fr
    db = _multi_date_db(tmp_path)
    monkeypatch.setattr(fr, "db", db)
    for src in ("stocks", "indexes"):
        assert fr._market_dates(src) == db.get_available_dates(src), src
    assert fr._market_dates("indexes") == ["12/31/2025", "9/10/2026"]


def test_the_windowed_stream_is_per_date_equality_and_returns_the_same_rows(tmp_path):
    db = _multi_date_db(tmp_path)
    want = [l for l in "".join(db.stream_csv_symbol("DELL", "stocks")).strip().splitlines()[1:]
            if "9/10/2026" in l or "9/2/2026" in l]
    got = "".join(db.stream_csv_symbol("DELL", "stocks", dates=["9/2/2026", "9/10/2026"])).strip().splitlines()[1:]
    assert sorted(got) == sorted(want) and len(got) == 2
    import inspect
    src = inspect.getsource(type(db).stream_csv_symbol)
    body = src[src.index("if dates:"):src.index("else:", src.index("if dates:"))]
    code = "\n".join(l.split("#")[0] for l in body.splitlines())          # comments are not code
    assert "CreatedDate = ?" in code and " IN (" not in code, (
        "the windowed stream went back to an IN list; the planner walks the symbol's history for it")
