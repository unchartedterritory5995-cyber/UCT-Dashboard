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
    fr._BASIS_RECENT.clear(); fr._BASIS_REFRESHING.clear(); fr._BASIS_PARTIAL_UNTIL.clear()
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


# ── the basis product (one derivation, local display ladder) ────────────────────────────────

BASIS_BODY = {"ok": True, "window_dates": ["9/10/2026", "9/22/2026", "9/23/2026", "9/24/2026"],
              "market_dates": WIN, "basis_complete": True, "product": PRODUCT}


def test_one_fetch_then_the_display_ladder_widens_over_the_same_product(monkeypatch):
    """PRODUCT has rows on 9/23 and 9/24 (and 9/10). Asked for one session on a market whose last
    session is 9/25, the 1-rung is empty and the 5-rung carries both — from ONE fetch."""
    monkeypatch.setenv("WORKER_INTERNAL_URL", "http://flow-worker.test")
    calls = []
    body = dict(BASIS_BODY, market_dates=WIN + ["9/25/2026"])

    def fake_get(ticker, params, headers):
        calls.append(dict(params)); return body
    p = page.page_derived_payload("DELL", "1", "stocks", get=fake_get)
    assert len(calls) == 1 and calls[0]["basis_rows"] == page.BASIS_ROWS and calls[0]["source"] == "stocks"
    assert p["window"]["days_requested"] == "5" and p["window"]["widened_from"] == "1"
    assert p["window"]["basis_complete"] is True and p["derivation"] == "page"
    assert {c["strike"] for c in p["contracts"]} == {535.0, 520.0}


def test_an_incomplete_basis_is_labelled_on_the_all_rung_and_on_the_card(monkeypatch):
    from api.flow_ticker_card import render_ticker_flow_card
    monkeypatch.setenv("WORKER_INTERNAL_URL", "http://flow-worker.test")
    body = dict(BASIS_BODY, basis_complete=False, market_dates=["9/28/2026"])   # nothing in 1/5/20
    p = page.page_derived_payload("SPY", "1", "etfs", get=lambda *a: body)
    assert p["window"]["days_requested"] == "4", p["window"]        # "all" of an incomplete basis names its size
    assert p["window"]["basis_complete"] is False and p["window"]["basis_sessions"] == 4
    assert render_ticker_flow_card(p).startswith(bytes([0x89, 0x50, 0x4E, 0x47]))


def test_empty_on_every_rung_is_an_honest_empty_that_records_what_it_checked(monkeypatch):
    monkeypatch.setenv("WORKER_INTERNAL_URL", "http://flow-worker.test")
    body = dict(BASIS_BODY, product={"all_directional": []})
    p = page.page_derived_payload("QUIET", "1", "stocks", get=lambda *a: body)
    assert p["contracts"] == [] and p["window"]["days_requested"] == "1"
    assert p["window"]["widened_checked"] == ["5", "20", "all"]


def test_a_declined_basis_is_none_so_the_labelled_rollup_answers(monkeypatch):
    monkeypatch.setenv("WORKER_INTERNAL_URL", "http://flow-worker.test")
    assert page.page_derived_payload("NVDA", "1", "stocks", get=lambda *a: {"ok": False}) is None
    boom = lambda *a: (_ for _ in ()).throw(RuntimeError("x"))
    assert page.page_derived_payload("NVDA", "1", "stocks", get=boom) is None


def test_the_payload_names_the_sessions_it_summed_so_an_audit_can_scope_the_page_the_same_way(monkeypatch):
    """`tools/flow_card_parity_audit.py --card page` scopes the page's FULL product to
    `window.scope_dates`; if those were not the rung's own dates the audit would compare two
    different windows and call it parity."""
    monkeypatch.setenv("WORKER_INTERNAL_URL", "http://flow-worker.test")
    body = dict(BASIS_BODY, market_dates=WIN + ["9/25/2026"])
    p = page.page_derived_payload("DELL", "1", "stocks", get=lambda *a: body)
    w = p["window"]
    assert w["days_requested"] == "5" and w["scope_dates"] == (WIN + ["9/25/2026"])[-5:]
    assert w["scope_all_history"] is False
    again = page.build_payload(PRODUCT, w["scope_dates"], "DELL", "stocks", "5")
    assert again["net"] == p["net"], "the named scope must reproduce the card's own sums"
    allp = page.page_derived_payload("SPY", "1", "etfs",
                                     get=lambda *a: dict(BASIS_BODY, market_dates=["9/28/2026"]))
    assert allp["window"]["scope_all_history"] is True
    assert allp["window"]["scope_dates"] == BASIS_BODY["window_dates"]


def test_the_audit_can_fetch_through_a_session_without_the_worker_url_and_skip_decoration(monkeypatch):
    monkeypatch.delenv("WORKER_INTERNAL_URL", raising=False)
    assert page.fetch_basis_product("DELL", "stocks", 10, 5.0) is None          # the job: no URL, no call
    monkeypatch.setattr(page, "enrich_live", lambda p: (_ for _ in ()).throw(AssertionError("decorated")))
    p = page.page_derived_payload("DELL", "5", "stocks", get=lambda *a: BASIS_BODY, enrich=False)
    assert p is not None and p["contracts"]


def test_the_etf_partition_is_asked_for_with_the_pages_word(monkeypatch):
    monkeypatch.setenv("WORKER_INTERNAL_URL", "http://flow-worker.test")
    seen = {}
    page.page_derived_payload("IWM", "1", "etfs", get=lambda t, params, h: seen.update(params) or BASIS_BODY)
    assert seen["source"] == "indexes"


def test_pick_basis_takes_the_newest_sessions_under_the_cap_and_always_one():
    from api import flow_router as fr
    counts = [("1/1/2026", 100), ("1/2/2026", 50), ("1/5/2026", 60), ("1/6/2026", 70)]
    assert fr._pick_basis(counts, 1000) == [d for d, _ in counts]           # everything fits: full history
    assert fr._pick_basis(counts, 150) == ["1/5/2026", "1/6/2026"]
    assert fr._pick_basis([("1/1/2026", 10), ("1/2/2026", 900)], 100) == ["1/2/2026"]   # never empty


def test_the_basis_endpoint_routes_and_reports_its_basis(monkeypatch, tmp_path):
    fr, c = _client(monkeypatch, tmp_path, ["9/22/2026", "9/23/2026", "9/24/2026"])
    seen = {}

    def fake_build(sym, src, key, version, st, dates=None, extra=None, pre_chunks=None):
        import gzip, json as _j
        seen.update(dates=dates, key=key, extra=extra, pre_chunks=pre_chunks)
        body = {"ok": True, "product": {"all_directional": []}}; body.update(extra or {})
        return gzip.compress(_j.dumps(body).encode()), None
    monkeypatch.setattr(fr, "_build_search_product", fake_build)
    r = c.get("/api/flow/ticker-product/DELL?source=stocks&basis_rows=2")
    assert r.status_code == 200 and r.headers.get("X-Flow-Cache") == "basis", (r.status_code, r.text[:200])
    j = r.json()
    assert j["window_dates"] == ["9/23/2026", "9/24/2026"] and j["basis_complete"] is False
    assert j["sessions_total"] == 3 and j["market_dates"] == ["9/22/2026", "9/23/2026", "9/24/2026"]
    assert seen["key"] == ("DELL", "stocks", "v1", "r2")
    r2 = c.get("/api/flow/ticker-product/DELL?source=stocks&basis_rows=100")
    assert r2.json()["basis_complete"] is True


def test_the_session_counts_read_is_covering_with_no_source_term():
    """A `source` term forces a table read per row (the 47 s cold-scan class). The count query
    must stay on (Symbol, CreatedDate)."""
    import inspect
    from api import flow_router as fr
    src = inspect.getsource(fr._symbol_session_counts)
    sql = src[src.index('"SELECT'):src.index("(sym,)")]
    assert "WHERE Symbol = ?" in sql and "source" not in sql, sql


# ── newest-first basis read under a time budget (cold-pod measurement, 2026-09-25) ────────────

def _five_session_db(tmp_path):
    from api.flow_db import FlowDB
    dbp = tmp_path / "flow.db"
    db = FlowDB(str(dbp))
    conn = sqlite3.connect(str(dbp))
    days = ["9/18/2026", "9/21/2026", "9/22/2026", "9/23/2026", "9/24/2026"]
    for i, day in enumerate(days):
        for j in range(2):
            conn.execute("INSERT INTO flow (source, CreatedDate, Symbol, Premium, Strike, dedup_key) "
                         "VALUES ('stocks', ?, 'DELL', ?, ?, ?)", (day, str(100 + i), str(500 + j), f"b{i}{j}"))
    conn.commit(); conn.close()
    return db, days


# ⛔ ROW ORDER IS PART OF PARITY (measured 2026-09-25). `processFlowData`'s ML/ volume match is
# order-dependent and date-blind; the page streams one symbol in CreatedDate-TEXT order, and a
# chronological reassembly moved AMD's day by $217K over identical rows. These dates sort
# differently as text and as dates, and rows are inserted INTERLEAVED across sessions so rowid
# order is not session order either: a fixture where every wrong order is visible.
ORDER_DAYS = ["12/31/2025", "1/2/2026", "9/30/2026", "10/1/2026"]        # chronological


def _order_db(tmp_path):
    from api.flow_db import FlowDB
    dbp = tmp_path / "flow.db"
    db = FlowDB(str(dbp))
    conn = sqlite3.connect(str(dbp))
    n = 0
    for j in range(3):
        for day in reversed(ORDER_DAYS):
            n += 1
            conn.execute("INSERT INTO flow (source, CreatedDate, Symbol, Premium, Strike, dedup_key) "
                         "VALUES ('stocks', ?, 'AMD', ?, ?, ?)", (day, str(n), str(100 + j), f"o{n}"))
    conn.commit(); conn.close()
    return db


def _col(stream_text, name):
    lines = stream_text.strip().splitlines()
    i = [h.strip() for h in lines[0].split(",")].index(name)
    return [l.split(",")[i] for l in lines[1:]]


def test_the_store_order_is_sqlites_text_order_not_the_calendar():
    from api.flow_db import store_date_order
    assert store_date_order(ORDER_DAYS) == ["1/2/2026", "10/1/2026", "12/31/2025", "9/30/2026"]
    assert store_date_order(ORDER_DAYS) != ORDER_DAYS, "the fixture must be able to tell the orders apart"


def test_the_per_date_stream_is_byte_identical_to_the_pages_unfiltered_stream(tmp_path):
    db = _order_db(tmp_path)
    page = "".join(db.stream_csv_symbol("AMD", "stocks"))
    assert "".join(db.stream_csv_symbol("AMD", "stocks", dates=ORDER_DAYS)) == page
    assert "".join(db.stream_csv_symbol("AMD", "stocks", dates=list(reversed(ORDER_DAYS)))) == page
    days, prem = _col(page, "CreatedDate"), [int(p) for p in _col(page, "Premium")]
    assert len(days) == 12
    for d in ORDER_DAYS:                     # within a session: rowid (insertion) order
        mine = [p for dd, p in zip(days, prem) if dd == d]
        assert mine == sorted(mine) and len(mine) == 3, (d, mine)


def test_a_full_basis_read_is_byte_identical_to_the_pages_own_stream(tmp_path, monkeypatch):
    """The card's input must be the PAGE's input: the unfiltered stream, not a re-ordering of it."""
    from api import flow_router as fr
    db = _order_db(tmp_path)
    monkeypatch.setattr(fr, "db", db)
    used, chunks = fr._read_basis_newest_first("AMD", "stocks", ORDER_DAYS, budget_s=999)
    assert used == ORDER_DAYS
    page = "".join(db.stream_csv_symbol("AMD", "stocks"))
    assert "".join(chunks) == page
    # control: the chronological reassembly this replaced is the same bytes in another order
    per = {d: "".join(db.stream_csv_symbol("AMD", "stocks", dates=[d])).partition(chr(10))[2] for d in ORDER_DAYS}
    chron = chunks[0] + "".join(per[d] for d in ORDER_DAYS)
    assert sorted(chron) == sorted(page) and chron != page


def test_both_symbol_streams_state_their_order_instead_of_leaving_it_to_the_planner():
    import inspect
    from api.flow_db import FlowDB
    src = inspect.getsource(FlowDB.stream_csv_symbol)
    code = "\n".join(l.split("#")[0] for l in src.splitlines())            # comments are not code
    body = code[code.index('"""', code.index('"""') + 3) + 3:]              # past the docstring
    assert body.count("ORDER BY") == 2, "both the per-date and the unfiltered query must say their order"
    assert "store_date_order(dates)" in body


def test_a_spent_budget_keeps_the_NEWEST_sessions_in_the_stores_order(tmp_path, monkeypatch):
    from api import flow_router as fr
    db = _order_db(tmp_path)
    monkeypatch.setattr(fr, "db", db)
    t = {"now": 0.0}

    def clock():
        t["now"] += 5.0                        # every look at the clock costs 5 s of "cold IO"
        return t["now"]
    used, chunks = fr._read_basis_newest_first("AMD", "stocks", ORDER_DAYS, budget_s=12, clock=clock)
    assert used == ["1/2/2026", "9/30/2026", "10/1/2026"], used              # newest three, oldest first
    body = "".join(chunks)
    assert _col(body, "CreatedDate")[::3] == ["1/2/2026", "10/1/2026", "9/30/2026"]
    assert "12/31/2025" not in body and body.count("CreatedDate") == 1      # one header
    assert body == "".join(db.stream_csv_symbol("AMD", "stocks", dates=used))


def test_even_an_instantly_spent_budget_reads_the_newest_session(tmp_path, monkeypatch):
    from api import flow_router as fr
    db, days = _five_session_db(tmp_path)
    monkeypatch.setattr(fr, "db", db)
    used, _ = fr._read_basis_newest_first("DELL", "stocks", days, budget_s=0, clock=iter(range(0, 10**6, 100)).__next__)
    assert used == ["9/24/2026"]


def test_the_basis_endpoint_reports_a_truncated_read_as_an_incomplete_basis(monkeypatch, tmp_path):
    fr, c = _client(monkeypatch, tmp_path, ["9/22/2026", "9/23/2026", "9/24/2026"])
    monkeypatch.setattr(fr, "_BASIS_READ_BUDGET_S", -1.0)                  # spent before the second session
    seen = {}

    def fake_build(sym, src, key, version, st, dates=None, extra=None, pre_chunks=None):
        import gzip, json as _j
        seen.update(dates=dates, chunks=pre_chunks)
        body = {"ok": True, "product": {"all_directional": []}}; body.update(extra or {})
        return gzip.compress(_j.dumps(body).encode()), None
    monkeypatch.setattr(fr, "_build_search_product", fake_build)
    j = c.get("/api/flow/ticker-product/DELL?source=stocks&basis_rows=100").json()
    assert j["window_dates"] == ["9/24/2026"] and j["basis_complete"] is False and j["sessions_total"] == 3
    assert seen["dates"] == ["9/24/2026"] and "9/24/2026" in "".join(seen["chunks"])
    assert j["basis_cut"] == "time"


def _caching_build(fr, calls):
    """The real builder's cache contract (it installs the product under `key`), without node."""
    def fake_build(sym, src, key, version, st, dates=None, extra=None, pre_chunks=None):
        import gzip, json as _j
        calls.append(list(dates or []))
        body = {"ok": True, "product": {"all_directional": []}}; body.update(extra or {})
        gz = gzip.compress(_j.dumps(body).encode())
        fr._search_product_cache_put(key, gz)
        return gz, None
    return fake_build


def test_a_time_truncated_basis_is_not_served_past_its_short_ttl(monkeypatch, tmp_path):
    """A cold-pod read (DELL 14 of 152 sessions) was cached under the version key and served all
    night while a warm read took 2 s and was exact. Truncated-by-time lives 60 s; then the next
    request reads again."""
    fr, c = _client(monkeypatch, tmp_path, ["9/22/2026", "9/23/2026", "9/24/2026"])
    fr._BASIS_PARTIAL_UNTIL.clear()
    calls = []
    monkeypatch.setattr(fr, "_build_search_product", _caching_build(fr, calls))
    monkeypatch.setattr(fr, "_BASIS_READ_BUDGET_S", -1.0)                  # cold: one session only
    url = "/api/flow/ticker-product/DELL?source=stocks&basis_rows=100"
    key = ("DELL", "stocks", "v1", "r100")
    assert c.get(url).json()["basis_cut"] == "time"
    assert key in fr._BASIS_PARTIAL_UNTIL, "a time-truncated build must be marked short-lived"
    r = c.get(url)                                                           # inside the TTL: served
    assert r.headers.get("X-Flow-Cache") == "hit" and len(calls) == 1
    monkeypatch.setattr(fr, "_BASIS_READ_BUDGET_S", 999.0)                 # the disk warmed up
    fr._BASIS_PARTIAL_UNTIL[key] -= fr._BASIS_PARTIAL_TTL_S + 1             # the TTL has passed
    j = c.get(url).json()
    assert len(calls) == 2 and j["basis_complete"] is True and j["basis_cut"] is None
    assert key not in fr._BASIS_PARTIAL_UNTIL
    assert c.get(url).headers.get("X-Flow-Cache") == "hit" and len(calls) == 2   # complete: cached


# ── market hours: the version moves with every print (2026-09-25) ────────────────────────────

def _moving_version(monkeypatch, fr):
    v = {"now": "v1"}
    monkeypatch.setattr(fr, "_search_freshness", lambda sym, src: v["now"])
    return v


def test_a_product_the_tape_moved_past_is_served_at_once_labelled_and_rebuilt_behind(monkeypatch, tmp_path):
    fr, c = _client(monkeypatch, tmp_path, ["9/22/2026", "9/23/2026", "9/24/2026"])
    v = _moving_version(monkeypatch, fr)
    calls, spawned = [], []
    monkeypatch.setattr(fr, "_build_search_product", _caching_build(fr, calls))
    monkeypatch.setattr(fr, "_spawn_basis_refresh", lambda *a: spawned.append(a) or True)
    url = "/api/flow/ticker-product/DELL?source=stocks&basis_rows=100"
    first = c.get(url)
    assert first.headers.get("X-Flow-Cache") == "basis" and "X-Flow-Basis-As-Of" not in first.headers
    built_at = first.json()["built_at"]
    v["now"] = "v2"                                                          # DELL printed
    r = c.get(url)
    assert r.headers.get("X-Flow-Cache") == "basis-recent", r.headers
    assert float(r.headers["X-Flow-Basis-As-Of"]) == pytest.approx(built_at, abs=1)
    assert r.headers.get("X-Flow-Version") == "v1" and len(calls) == 1      # no rebuild on the request
    assert spawned == [("DELL", "stocks", "v2", 100)], "the next request must find a fresher product"


def test_past_the_reuse_window_the_request_rebuilds_itself(monkeypatch, tmp_path):
    fr, c = _client(monkeypatch, tmp_path, ["9/22/2026", "9/23/2026", "9/24/2026"])
    v = _moving_version(monkeypatch, fr)
    calls = []
    monkeypatch.setattr(fr, "_build_search_product", _caching_build(fr, calls))
    monkeypatch.setattr(fr, "_BASIS_REUSE_S", -1.0)
    url = "/api/flow/ticker-product/DELL?source=stocks&basis_rows=100"
    c.get(url); v["now"] = "v2"
    r = c.get(url)
    assert r.headers.get("X-Flow-Cache") == "basis" and len(calls) == 2
    assert "X-Flow-Basis-As-Of" not in r.headers


def test_a_busy_lane_answers_with_the_last_good_product_labelled_or_declines(monkeypatch, tmp_path):
    fr, c = _client(monkeypatch, tmp_path, ["9/22/2026", "9/23/2026", "9/24/2026"])
    v = _moving_version(monkeypatch, fr)
    calls = []
    monkeypatch.setattr(fr, "_build_search_product", _caching_build(fr, calls))
    monkeypatch.setattr(fr, "_BASIS_REUSE_S", -1.0)
    url = "/api/flow/ticker-product/DELL?source=stocks&basis_rows=100"
    c.get(url); v["now"] = "v2"

    class _Busy:
        def acquire(self, blocking=False): return False
        def release(self): raise AssertionError("never acquired")
    monkeypatch.setattr(fr, "_SEARCH_BUILD_LOCK", _Busy())
    r = c.get(url)
    assert r.headers.get("X-Flow-Cache") == "basis-stale" and "X-Flow-Basis-As-Of" in r.headers
    monkeypatch.setattr(fr, "_BASIS_STALE_MAX_S", -1.0)
    r2 = c.get(url)
    assert r2.status_code == 503 and r2.json()["error"] == "busy"


def test_a_time_cut_read_is_never_kept_as_the_recent_answer(monkeypatch, tmp_path):
    fr, c = _client(monkeypatch, tmp_path, ["9/22/2026", "9/23/2026", "9/24/2026"])
    monkeypatch.setattr(fr, "_build_search_product", _caching_build(fr, []))
    monkeypatch.setattr(fr, "_BASIS_READ_BUDGET_S", -1.0)
    assert c.get("/api/flow/ticker-product/DELL?source=stocks&basis_rows=100").json()["basis_cut"] == "time"
    assert fr._basis_recent_get("DELL", "stocks", 100) is None


def test_the_background_refresh_builds_the_current_version_once(monkeypatch, tmp_path):
    fr, c = _client(monkeypatch, tmp_path, ["9/22/2026", "9/23/2026", "9/24/2026"])
    calls = []
    monkeypatch.setattr(fr, "_build_search_product", _caching_build(fr, calls))

    class _Inline:
        def __init__(self, target=None, name=None, daemon=None): self.t = target
        def start(self): self.t()
    monkeypatch.setattr(fr.threading, "Thread", _Inline)
    assert fr._spawn_basis_refresh("DELL", "stocks", "v9", 100) is True
    assert len(calls) == 1 and fr._search_product_cache_get(("DELL", "stocks", "v9", "r100")) is not None
    assert fr._basis_recent_get("DELL", "stocks", 100)["version"] == "v9"
    assert fr._spawn_basis_refresh("DELL", "stocks", "v9", 100) is True and len(calls) == 1   # already built
    fr._BASIS_REFRESHING.add(("DELL", "stocks", 100))
    assert fr._spawn_basis_refresh("DELL", "stocks", "v10", 100) is False                  # one at a time
    fr._BASIS_REFRESHING.clear()


def test_the_card_reads_the_as_of_header_and_says_so_on_the_card(monkeypatch):
    from api.flow_ticker_card import _as_of_et, render_ticker_flow_card
    import httpx
    monkeypatch.setenv("WORKER_INTERNAL_URL", "http://flow-worker.test")

    class _Resp:
        is_success, status_code = True, 200
        headers = {"X-Flow-Basis-As-Of": "1790000000"}
        def json(self): return dict(BASIS_BODY)
    monkeypatch.setattr(httpx, "get", lambda *a, **k: _Resp())
    p = page.page_derived_payload("DELL", "5", "stocks", enrich=False)
    assert p["window"]["as_of"] == 1790000000.0
    assert _as_of_et(p["window"]["as_of"]) == "10:13 ET"          # 2026-09-21 14:13:20 UTC, EDT
    assert _as_of_et(None) == "" and _as_of_et("junk") == ""
    assert render_ticker_flow_card(p).startswith(bytes([0x89, 0x50, 0x4E, 0x47]))
    fresh = page.page_derived_payload("DELL", "5", "stocks", get=lambda *a: dict(BASIS_BODY), enrich=False)
    assert fresh["window"]["as_of"] is None, "a current product carries no as-of label"


def test_the_job_gives_the_page_derived_card_its_own_longer_wait(monkeypatch):
    from api.routers import discord_interactions as router
    monkeypatch.setenv(page.FLAG, "1")
    seen = {}

    def fake_page(ticker, days, source, timeout_s=None, **k):
        seen["timeout_s"] = timeout_s
        return None
    monkeypatch.setattr(page, "page_derived_payload", fake_page)
    router.run_flow_card_job("A", "T", "DELL", "1", fetch_fn=lambda t, d: {"ok": True, "contracts": []},
                             render_fn=lambda d: b"png", edit_fn=lambda *a, **k: (True, "ok"),
                             source="stocks", timeout_s=30.0)
    assert seen["timeout_s"] == page.PAGE_FETCH_TIMEOUT_S >= 45


def test_a_complete_or_row_capped_basis_is_cached_like_any_product(monkeypatch, tmp_path):
    fr, c = _client(monkeypatch, tmp_path, ["9/22/2026", "9/23/2026", "9/24/2026"])
    fr._BASIS_PARTIAL_UNTIL.clear()
    calls = []
    monkeypatch.setattr(fr, "_build_search_product", _caching_build(fr, calls))
    j = c.get("/api/flow/ticker-product/DELL?source=stocks&basis_rows=2").json()
    assert j["basis_cut"] == "rows" and j["basis_complete"] is False
    assert c.get("/api/flow/ticker-product/DELL?source=stocks&basis_rows=2").headers.get("X-Flow-Cache") == "hit"
    assert len(calls) == 1 and not fr._BASIS_PARTIAL_UNTIL
