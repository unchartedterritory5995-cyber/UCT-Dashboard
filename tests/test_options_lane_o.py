"""Lane O (lane/o-options-remainders): FT-012 edge, FT-018 RR/BF + 3D mesh, FT-049 delta-pressure and
charm heatmaps, FT-056 sector tide, FT-057 tide minute, FT-072 Spread Book, FT-073 remaining screens,
FT-075 Sizzle (5-day), and the switch of every surface (FT-001 / FT-014 / FT-015 included).

NO NETWORK. Inputs are recorded/synthetic fixtures: tests/fixtures/options_analytics/
chain_tst_schwab_shape.json and tape_*.csv (read their provenance), a COV-02-schema screen file
built in tmp (the strategy-screen tests' schema), the COV-03 seeded log (test_options_screener.py's
Seed), and stubbed vendor readers. Every expected number is hand-computed in the comments.
"""
from __future__ import annotations

import csv
import datetime as dt
import json
import math
import pathlib
import sqlite3
from statistics import NormalDist

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import options_analytics as oa
from api.services.options_analytics import chain_models as cm
from api.services.options_analytics import market_tide as mt
from api.services.options_analytics import more_screens as ms
from api.services.options_analytics import positioning as pos
from api.services.options_analytics import pressure as pr
from api.services.options_analytics import spread_book as sb
from api.services.options_analytics import strategy_screens as ss
from api.services.options_analytics import tide_extras as tx
from api.services.options_analytics import vol_skew as vk

FIX = pathlib.Path(__file__).parent / "fixtures" / "options_analytics"
CHAIN = json.loads((FIX / "chain_tst_schwab_shape.json").read_text(encoding="utf-8"))
PAID = {"id": "u1", "role": "member", "plan": "pro"}
PAID2 = {"id": "u9", "role": "member", "plan": "pro"}
FREE = {"id": "u2", "role": "member", "plan": "free"}
N = NormalDist()


def _client(user, monkeypatch):
    from api.middleware.auth_middleware import get_current_user_with_plan
    monkeypatch.setattr(oa, "is_paid_user", lambda u: u.get("plan") == "pro")
    app = FastAPI()
    app.include_router(oa.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: user
    return TestClient(app)


# ── every surface is dark, then paid ──────────────────────────────────────────────────────────

ROUTES = [
    ("OPTIONS_PAYOFF_TODAY_ENABLED", "get", "/api/research/options/TST/payoff-model"),
    ("OPTIONS_STRATEGY_FINDER_ENABLED", "get", "/api/research/options/TST/strategy-finder"),
    ("OPTIONS_CHAIN_FULL_GREEKS_ENABLED", "get", "/api/research/options/TST/chain-greeks"),
    ("OPTIONS_EDGE_RANKING_ENABLED", "get", "/api/research/options/TST/edge"),
    ("OPTIONS_VOL_RR_BF_ENABLED", "get", "/api/options/vol/TST/rr-bf"),
    ("OPTIONS_VOL_SURFACE_3D_ENABLED", "get", "/api/options/vol/TST/surface-3d"),
    ("OPTIONS_DELTA_PRESSURE_ENABLED", "get", "/api/options/positioning/TST/delta-heatmap"),
    ("OPTIONS_CHARM_HEATMAP_ENABLED", "get", "/api/options/positioning/TST/charm-heatmap"),
    ("OPTIONS_SECTOR_TIDE_ENABLED", "get", "/api/options/market-tide/sectors"),
    ("OPTIONS_TIDE_CLICKTHROUGH_ENABLED", "get", "/api/options/market-tide/minute"),
    ("OPTIONS_SPREAD_BOOK_ENABLED", "get", "/api/options/spread-book"),
    ("OPTIONS_SPREAD_BOOK_ENABLED", "post", "/api/options/spread-book"),
    ("OPTIONS_SPREAD_BOOK_ENABLED", "delete", "/api/options/spread-book/abc"),
    ("OPTIONS_MORE_STRATEGY_SCREENS_ENABLED", "get", "/api/options-screener/more-strategies"),
    ("OPTIONS_MORE_STRATEGY_SCREENS_ENABLED", "get", "/api/options-screener/more/call_butterflies"),
    ("OPTIONS_SIZZLE_ENABLED", "get", "/api/options-screener/sizzle"),
]


def _call(c, method, url):
    if method == "post":
        return c.post(url, json={})
    return getattr(c, method)(url)


@pytest.mark.parametrize("flag,method,url", ROUTES)
def test_each_surface_answers_404_until_its_own_switch_and_402_to_free(monkeypatch, flag, method, url):
    for f, _, _ in ROUTES:
        monkeypatch.delenv(f, raising=False)
    assert _call(_client(PAID, monkeypatch), method, url).status_code == 404
    assert _call(_client(FREE, monkeypatch), method, url).status_code == 404   # before identity
    monkeypatch.setenv(flag, "1")
    assert _call(_client(FREE, monkeypatch), method, url).status_code == 402


def test_arming_one_switch_never_arms_another(monkeypatch):
    for f, _, _ in ROUTES:
        monkeypatch.delenv(f, raising=False)
    monkeypatch.setenv("OPTIONS_PAYOFF_TODAY_ENABLED", "1")
    c = _client(PAID, monkeypatch)
    assert c.get("/api/research/options/TST/payoff-model").status_code == 200
    assert c.get("/api/research/options/TST/strategy-finder").status_code == 404
    assert c.get("/api/research/options/TST/chain-greeks").status_code == 404


def test_the_browser_side_models_state_their_assumptions(monkeypatch):
    for f in ("OPTIONS_PAYOFF_TODAY_ENABLED", "OPTIONS_STRATEGY_FINDER_ENABLED", "OPTIONS_CHAIN_FULL_GREEKS_ENABLED"):
        monkeypatch.setenv(f, "1")
    c = _client(PAID, monkeypatch)
    pay = c.get("/api/research/options/TST/payoff-model").json()
    assert pay["label"] == "computed" and pay["risk_free_rate"] == 0.0 and "lognormal" in pay["pop_method"]
    fin = c.get("/api/research/options/TST/strategy-finder").json()
    assert set(fin["views"]) == {"bullish", "bearish", "neutral", "volatile"} and "not advice" in fin["method"]
    gr = c.get("/api/research/options/TST/chain-greeks").json()
    assert "Not streamed" in gr["streaming"]
    assert c.get("/api/research/options/not a sym/payoff-model").status_code in (404, 422)


# ── FT-012 theoretical-value edge ──────────────────────────────────────────────────────────────

TODAY = dt.date(2026, 10, 2)


def _bs_call_atm(s, sigma, days):
    st = sigma * math.sqrt(days / 365)
    return s * (2 * N.cdf(st / 2) - 1)            # r = 0, K = S


@pytest.fixture
def edge_inputs(monkeypatch):
    chain = {"spot": 100.0, "expiration": "2026-11-01",
             "calls": [{"contract": "C100", "strike": 100, "bid": 1.95, "ask": 2.05, "iv": 0.25},
                       {"contract": "C110", "strike": 110, "bid": 0.0, "ask": 0.10, "iv": 0.3}],
             "puts": [{"contract": "P100", "strike": 100, "bid": 2.55, "ask": 2.65, "iv": 0.31}]}
    monkeypatch.setattr(cm, "_chain", lambda s, e: chain)
    monkeypatch.setattr(cm, "_realized", lambda s: {"available": True, "hv": {"hv20": 0.20},
                                                     "through": "2026-10-01", "method": "HV"})
    monkeypatch.setattr(cm, "_history", lambda s: {"n": 3, "logging_began": "2026-09-30"})
    return chain


def test_edge_is_bs_at_realized_vol_minus_the_mid(edge_inputs):
    out = cm.edge("TST", "", today=TODAY)
    tv = _bs_call_atm(100.0, 0.20, 30)             # 30 calendar days: ~2.2871
    c = out["buyer_edge"][0]
    assert c["contract"] == "C100" and c["theoretical"] == pytest.approx(tv, abs=1e-3)
    assert c["edge"] == pytest.approx(tv - 2.00, abs=1e-3) and c["edge_pct"] > 0
    p = out["seller_edge"][0]                      # put parity at r=0: same value, mid 2.60
    assert p["contract"] == "P100" and p["edge"] == pytest.approx(tv - 2.60, abs=1e-3)
    assert out["skipped"] == 1 and "no two-sided quote" in out["note"]
    assert out["label"] == "computed" and "realized volatility" in out["method"]


def test_edge_states_the_thin_history_and_never_ranks_by_win_rate(edge_inputs):
    out = cm.edge("TST", "", today=TODAY)
    h = out["history"]
    assert h["win_rate"] is None and h["sessions_logged"] == 3
    assert "3 sessions since 2026-09-30" in h["win_rate_note"]


def test_edge_without_realized_vol_says_so_and_ranks_nothing(edge_inputs, monkeypatch):
    monkeypatch.setattr(cm, "_realized", lambda s: {"available": False, "note": "No daily bars could be read."})
    out = cm.edge("TST", "", today=TODAY)
    assert out["buyer_edge"] == [] and out["seller_edge"] == [] and "No daily bars" in out["note"]


def test_edge_route_503_in_words_when_the_chain_fails(monkeypatch):
    monkeypatch.setenv("OPTIONS_EDGE_RANKING_ENABLED", "1")
    monkeypatch.setattr(cm, "_chain", lambda s, e: {"error": "Massive API error: 500"})
    r = _client(PAID, monkeypatch).get("/api/research/options/TST/edge")
    assert r.status_code == 503 and "Massive API error" in r.json()["detail"]


# ── FT-018 RR / BF and the 3D mesh ─────────────────────────────────────────────────────────────

def _pts(pairs):
    return [{"delta": d, "iv": v} for d, v in pairs]


EXP = {"expiration": "2026-11-20", "dte": 49, "atm_iv": 0.305, "reason": None,
       "calls": {"points": _pts([(0.5, 0.30), (0.30, 0.28), (0.20, 0.27), (0.05, 0.26)])},
       "puts": {"points": _pts([(-0.5, 0.31), (-0.30, 0.33), (-0.20, 0.35), (-0.08, 0.40)])}}


def test_rr_and_bf_interpolate_in_vendor_delta():
    row = vk.tenor_row(EXP)
    # 25d call: between .20 (.27) and .30 (.28) -> .275 ; 25d put: between .20 (.35) and .30 (.33) -> .34
    assert row["call_iv_25d"] == 0.275 and row["put_iv_25d"] == 0.34
    assert row["rr_25d"] == pytest.approx(-0.065, abs=1e-4)
    assert row["bf_25d"] == pytest.approx(0.0025, abs=1e-4)          # (.275 + .34) / 2 - .305
    # 10d call: .26 + .01 x (.05 / .15) = .2633 ; 10d put: .40 - .05 x (.02 / .12) = .3917
    assert row["rr_10d"] == pytest.approx(0.263333 - 0.391667, abs=1e-4)


def test_a_delta_the_quotes_do_not_reach_is_None_with_its_reason_never_extrapolated():
    e = {**EXP, "calls": {"points": _pts([(0.5, 0.30), (0.30, 0.28), (0.20, 0.27)])}}
    row = vk.tenor_row(e)
    assert row["call_iv_10d"] is None and row["rr_10d"] is None and row["bf_10d"] is None
    assert "0.20 to 0.50; 0.10 is not reached" in row["reason_10d"]
    assert row["rr_25d"] is not None


def test_rr_bf_reads_the_surface_fetch(monkeypatch):
    from api.services import vol_surface as vs
    vk.clear_cache()

    def leg(k, d, iv):
        return {"strike": k, "bid": 1.0, "ask": 1.1, "iv": iv, "delta": d, "quote_time": "2026-10-02T15:59:00+00:00"}
    chain = {"spot": 100.0, "expiration": "2026-11-20",
             "calls": [leg(100, 0.5, 0.30), leg(105, 0.30, 0.28), leg(110, 0.20, 0.27), leg(120, 0.05, 0.26), leg(95, 0.7, 0.31)],
             "puts": [leg(100, -0.5, 0.31), leg(95, -0.30, 0.33), leg(90, -0.20, 0.35), leg(80, -0.08, 0.40), leg(105, -0.7, 0.30)]}
    monkeypatch.setattr(vs, "fetch_chains", lambda s, sel="": {"chains": [chain], "missing": [], "listed": ["2026-11-20"]})
    monkeypatch.setenv("OPTIONS_VOL_RR_BF_ENABLED", "1")
    body = _client(PAID, monkeypatch).get("/api/options/vol/TST/rr-bf").json()
    t = body["tenors"][0]
    assert t["atm_iv"] == pytest.approx(0.305) and t["rr_25d"] == pytest.approx(-0.065, abs=1e-4)
    assert body["iv_source"] == "vendor" and body["label"] == "computed"
    vk.clear_cache()


def test_the_3d_mesh_is_the_surface_grid_blank_cells_left_open(monkeypatch):
    from api.services import vol_surface as vs
    surf = {"spot": 100.0, "basis": "today", "iv_source_text": "vendor",
            "term": {"points": [{"expiration": "2026-10-16", "dte": 14}, {"expiration": "2026-11-20", "dte": 49}]},
            "grid": {"expirations": ["2026-10-16", "2026-11-20"], "side_rule": "otm",
                     "rows": [{"strike": 95, "cells": [{"iv": 0.33, "t": "x"}, None]},
                              {"strike": 100, "cells": [{"iv": 0.30, "t": "x"}, {"iv": 0.29, "t": "x"}]}]}}
    monkeypatch.setattr(vs, "get_surface", lambda s, selected="": surf)
    m = vk.surface_mesh("TST")
    assert m["strikes"] == [95, 100] and m["z"] == [[0.33, None], [0.30, 0.29]]
    assert m["expirations"] == [{"expiration": "2026-10-16", "dte": 14}, {"expiration": "2026-11-20", "dte": 49}]
    assert m["cells_filled"] == 3 and m["cells_total"] == 4


# ── FT-049 delta pressure and charm ────────────────────────────────────────────────────────────

def _ch():
    return {"spot": 100.0, "rows": pos.contracts(CHAIN), "source": "massive", "truncated": False,
            "window": {"from": "2026-10-02", "to": "2026-11-01"}}


def test_delta_pressure_is_delta_x_oi_x_100_x_spot_per_cell():
    out = pr.delta_heatmap_from("TST", "month", _ch())
    e = out["expirations"].index("2026-10-09")
    cell = dict(zip(out["strikes"], out["cells"][e]))
    assert cell[100.0] == 1_500_000          # call .5 x 500 x 100 x 100 + put -.5 x 200 x 100 x 100
    assert cell[95.0] == -200_000            # call .8 x 100 x 1e4 + put -.25 x 400 x 1e4
    assert out["contracts_missing_inputs"] == 1          # the 110 call carries no delta/OI
    assert out["label"] == "computed" and "forward projection" in out["not_built"]


def _bs_delta_gamma(cp, s, k, sigma, days):
    t = days / 365
    d1 = (math.log(s / k) + 0.5 * sigma * sigma * t) / (sigma * math.sqrt(t))
    delta = N.cdf(d1) if cp == "C" else N.cdf(d1) - 1
    return delta, N.pdf(d1) / (s * sigma * math.sqrt(t))


@pytest.mark.parametrize("cp,k", [("C", 105.0), ("P", 95.0), ("C", 98.0)])
def test_charm_matches_the_one_day_change_in_black_scholes_delta(cp, k):
    d0, g0 = _bs_delta_gamma(cp, 100.0, k, 0.30, 20)
    d1, _ = _bs_delta_gamma(cp, 100.0, k, 0.30, 19)
    got = pr.charm_per_day(cp, d0, g0, 100.0, 20)
    assert got == pytest.approx(d1 - d0, rel=0.06)


def test_charm_has_no_answer_on_expiry_day_or_at_a_pinned_delta():
    assert pr.charm_per_day("C", 0.5, 0.05, 100.0, 0) is None
    assert pr.charm_per_day("C", 1.0, 0.05, 100.0, 10) is None
    assert pr.charm_per_day("P", -0.4, 0.0, 100.0, 10) is None


def test_charm_heatmap_counts_what_it_cannot_value():
    out = pr.charm_heatmap_from("TST", "month", _ch(), today=dt.date(2026, 10, 2))
    assert out["contracts_missing_inputs"] == 1 and out["contracts_without_defined_charm"] == 0
    assert out["unit"] == "$ of delta per calendar day" and "delta and gamma" in out["method"]
    out2 = pr.charm_heatmap_from("TST", "month", _ch(), today=dt.date(2026, 10, 9))
    assert out2["contracts_without_defined_charm"] == 6     # every 2026-10-09 contract expires that day


# ── FT-056 sector tide, FT-057 minute, FT-073 blocks: ONE tape read ─────────────────────────────

def _reader():
    calls = []

    def read(path, add):
        name = "stocks" if path.endswith("/data") else "etfs"
        calls.append(name)
        with open(FIX / f"tape_{name}.csv", encoding="utf-8", newline="") as fh:
            for row in csv.DictReader(fh):
                add(row)
        return True
    read.calls = calls
    return read


@pytest.fixture
def tape(monkeypatch):
    mt.clear_cache()
    r = _reader()
    monkeypatch.setattr(mt, "_read", r)
    yield r
    mt.clear_cache()


def test_sector_tide_splits_the_signed_premium_by_the_tapes_sector(tape):
    ex = mt.extras("all")
    assert ex["session"] == "2026-10-02"
    by = {s["sector"]: s for s in ex["sectors"]}
    # Technology: NVDA call @A +50K, AMD put @BB -12K net put, MSFT @M unsigned -> net +62K
    assert by["Technology"]["totals"] == {"net_call_premium": 50000, "net_put_premium": -12000, "net_premium": 62000}
    assert by["Technology"]["prints_unsigned"] == 1
    assert by["Index"]["totals"]["net_premium"] == -30000          # QQQ +20K call, SPY +50K put
    assert [s["sector"] for s in ex["sectors"]] == ["Technology", "Communication", "Consumer", "Index"]


def test_the_extras_cost_no_second_read_of_the_tape(tape):
    mt.get("all")
    mt.extras("all")
    assert tape.calls == ["stocks", "etfs"]


def test_a_minute_holds_the_prints_the_tide_counted_largest_first(tape, monkeypatch):
    monkeypatch.setenv("OPTIONS_TIDE_CLICKTHROUGH_ENABLED", "1")
    c = _client(PAID, monkeypatch)
    probe = c.get("/api/options/market-tide/minute").json()
    assert probe["minutes"] == ["09:30", "09:31", "12:05"]
    m = c.get("/api/options/market-tide/minute?t=09:30").json()
    assert m["count"] == 4 and m["shown"] == 4
    assert {p["symbol"] for p in m["prints"][:2]} == {"NVDA", "SPY"} and m["prints"][2]["symbol"] == "TSLA"
    assert m["prints"][2]["premium"] == 30000 and m["prints"][2]["side"] == "B"
    assert c.get("/api/options/market-tide/minute?t=9:30").status_code == 422


def test_a_minute_over_the_cap_says_how_many_it_left_out():
    ext = tx.TideExtras()
    for i in range(tx.MINUTE_CAP + 3):
        ext.add({"CreatedDate": "10/2/2026", "CreatedTime": "10:00:01 AM", "Symbol": f"S{i}",
                 "CallPut": "CALL", "Premium": str(10000 + i), "Side": "A", "Type": "SWEEP"})
    m = ext.result("2026-10-02")["minutes"]["10:00"]
    assert m["count"] == tx.MINUTE_CAP + 3 and len(m["prints"]) == tx.MINUTE_CAP
    assert m["prints"][0]["premium"] == 10000 + tx.MINUTE_CAP + 2


def test_block_trades_are_the_prints_the_tape_types_BLOCK(tape, monkeypatch):
    out = ms.run("block_trades")
    assert [r["symbol"] for r in out["rows"]] == ["TSLA", "QQQ"] and out["candidates_read"] == 2
    assert "50+ contracts" in out["filters"]
    assert "multi-leg" in ms.catalog()["not_built"]["multi_leg_trades"]


def test_sector_route_serves_the_same_read(tape, monkeypatch):
    monkeypatch.setenv("OPTIONS_SECTOR_TIDE_ENABLED", "1")
    body = _client(PAID, monkeypatch).get("/api/options/market-tide/sectors").json()
    assert body["sectors"][0]["sector"] == "Technology" and body["label"] == "computed"
    assert "50+ contracts" in body["filters"]


# ── FT-073 butterflies and by-expiration over the screen file ───────────────────────────────────

SCHEMA = """
CREATE TABLE contracts (
  contract TEXT NOT NULL, underlying TEXT NOT NULL, exp INTEGER NOT NULL,
  dte INTEGER NOT NULL, cp TEXT NOT NULL, strike_m INTEGER NOT NULL,
  otm_d INTEGER, iv_bp INTEGER, delta_m INTEGER, bid_c INTEGER, ask_c INTEGER,
  spread_d INTEGER, oi INTEGER, vol INTEGER
);
CREATE TABLE underlyings (underlying TEXT PRIMARY KEY, price REAL);
CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);
"""
#            cp  strike otm%  iv    bid   ask   oi   vol
SCREEN = [("C", 95, -5.0, 0.32, 6.00, 6.20, 200, 10),
          ("C", 100, 0.0, 0.30, 3.00, 3.10, 800, 100),
          ("C", 105, 5.0, 0.29, 1.20, 1.30, 500, 50),
          ("P", 95, 5.0, 0.34, 1.00, 1.10, 300, 40)]


@pytest.fixture
def screen(tmp_path, monkeypatch):
    p = str(tmp_path / "screen.sqlite")
    con = sqlite3.connect(p)
    con.executescript(SCHEMA)
    for cp, k, otm, iv, b, a, oi, vol in SCREEN:
        con.execute("INSERT INTO contracts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (f"O:TST261101{cp}{k * 1000:08d}", "TST", 20261101, 30, cp, k * 1000, round(otm * 10),
                     round(iv * 10000), 500, round(b * 100), round(a * 100), 30, oi, vol))
    con.execute("INSERT INTO underlyings VALUES ('TST', 100.0)")
    con.execute("INSERT INTO meta VALUES ('session', '2026-10-02')")
    con.commit()
    con.close()
    monkeypatch.setattr(ss, "_screen_db", lambda: ("2026-10-02", p))
    return p


def test_a_call_butterfly_buys_the_wings_at_the_ask_and_sells_two_at_the_bid(screen):
    out = ms.run("call_butterflies")
    assert out["matches"] == 1 and out["candidates_read"] == 1     # only C100 is within 3% of spot
    r = out["rows"][0]
    # debit = 6.20 + 1.30 - 2 x 3.00 = 1.50 ; width 5 ; max profit 3.50 ; 2.33 : 1
    assert r["debit"] == 1.5 and r["width"] == 5.0 and r["max_profit"] == 3.5
    assert r["reward_to_risk"] == 2.33 and r["breakevens"] == [96.5, 103.5]
    assert out["session"] == "2026-10-02" and out["data_basis"] == "end-of-day snapshot"


def test_options_by_expiration_sums_the_file(screen):
    r = ms.run("by_expiration")["rows"][0]
    assert r["volume"] == 200 and r["open_interest"] == 1800
    assert r["call_share_pct"] == 80.0 and r["atm_iv"] == 0.30 and r["expiration"] == "2026-11-01"


def test_an_unknown_more_screen_is_refused(screen, monkeypatch):
    monkeypatch.setenv("OPTIONS_MORE_STRATEGY_SCREENS_ENABLED", "1")
    assert _client(PAID, monkeypatch).get("/api/options-screener/more/nope").status_code == 422


# ── FT-072 Spread Book ─────────────────────────────────────────────────────────────────────────

SPREAD = {"underlying": "tst", "strategy": "bull_put_spreads", "label": "TST Nov 95/92",
          "legs": [{"type": "put", "side": -1, "strike": 95, "expiration": "2026-11-01", "price": 1.0},
                   {"type": "put", "side": 1, "strike": 92, "expiration": "2026-11-01", "price": 0.4}],
          "entry": {"net": -0.6, "session": "2026-10-02", "source": "strategy screen"}}


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    yield c
    c.close()


def test_a_saved_spread_is_listed_for_its_owner_only(conn):
    s = sb.save("u1", SPREAD, conn=conn)
    assert s["underlying"] == "TST" and s["entry"]["kind"] == "credit"
    assert [x["id"] for x in sb.list_for("u1", conn=conn)["spreads"]] == [s["id"]]
    assert sb.list_for("u9", conn=conn)["spreads"] == []
    assert sb.delete("u9", s["id"], conn=conn) is False          # not yours reads as not there
    assert sb.delete("u1", s["id"], conn=conn) is True
    assert sb.list_for("u1", conn=conn)["count"] == 0


@pytest.mark.parametrize("patch,msg", [
    ({"underlying": ""}, "underlying"),
    ({"legs": []}, "1 to 4 legs"),
    ({"legs": [{"type": "fwd", "side": 1, "strike": 1, "expiration": "2026-11-01"}]}, "call or a put"),
    ({"legs": [{"type": "put", "side": 3, "strike": 1, "expiration": "2026-11-01"}]}, "bought"),
    ({"legs": [{"type": "put", "side": 1, "strike": 1, "expiration": "Nov"}]}, "expiration"),
    ({"entry": {"net": "x"}}, "number"),
])
def test_a_bad_spread_is_refused_in_a_sentence(conn, patch, msg):
    with pytest.raises(sb.BadSpread, match=msg):
        sb.save("u1", {**SPREAD, **patch}, conn=conn)


def test_the_book_has_a_ceiling(conn, monkeypatch):
    monkeypatch.setattr(sb, "MAX_PER_MEMBER", 2)
    sb.save("u1", SPREAD, conn=conn)
    sb.save("u1", SPREAD, conn=conn)
    with pytest.raises(sb.Full, match="at most 2"):
        sb.save("u1", SPREAD, conn=conn)


def test_the_book_leaves_with_the_account(conn):
    from api.services.journal_two import account_purge
    sb.save("u1", SPREAD, conn=conn)
    sb.save("u1", SPREAD, conn=conn)
    sb.save("u9", SPREAD, conn=conn)
    report = account_purge.purge_user_data("u1", conn)
    assert report["rows_deleted"]["options_spread_book"] == 2
    assert sb.list_for("u9", conn=conn)["count"] == 1


def test_spread_book_routes(monkeypatch, tmp_path):
    import api.services.auth_db as adb
    db = str(tmp_path / "auth.db")
    monkeypatch.setattr(adb, "get_connection", lambda: sqlite3.connect(db))
    monkeypatch.setenv("OPTIONS_SPREAD_BOOK_ENABLED", "1")
    c = _client(PAID, monkeypatch)
    r = c.post("/api/options/spread-book", json=SPREAD)
    assert r.status_code == 201
    sid = r.json()["id"]
    assert c.get("/api/options/spread-book").json()["count"] == 1
    assert _client(PAID2, monkeypatch).delete(f"/api/options/spread-book/{sid}").status_code == 404
    assert c.post("/api/options/spread-book", json={**SPREAD, "legs": []}).status_code == 422
    assert c.delete(f"/api/options/spread-book/{sid}").status_code == 200


# ── FT-075 Sizzle, 5 sessions ──────────────────────────────────────────────────────────────────

from tests.test_options_screener import NOW, _vol_day, seed, trading_days  # noqa: E402,F401


def test_sizzle_needs_five_prior_sessions_and_says_how_many_it_has(seed):
    from api.services.options_analytics import sizzle
    for d in trading_days("2026-09-24", 5):            # 4 prior + today
        _vol_day(seed, d, 100)
    out = sizzle.compute(now=NOW)
    assert out["ranked"] == [] and out["window"] == 5 and out["min_sessions"] == 5
    row = next(r for r in out["not_ranked"] if r["underlying"] == "AAA")
    assert row["note"] == "4 sessions, needs 5" and "ratio" not in row


def test_sizzle_ranks_today_against_the_prior_five_only(seed):
    from api.services.options_analytics import sizzle
    days = trading_days("2026-09-14", 12)
    for d in days[:6]:
        _vol_day(seed, d, 900)                          # older than the 5-day window: not counted
    for d in days[6:-1]:
        _vol_day(seed, d, 100)
    _vol_day(seed, days[-1], 500)
    out = sizzle.compute(now=NOW)
    top = out["ranked"][0]
    assert top["underlying"] == "AAA" and top["ratio"] == 5.0 and top["n_sessions"] == 5
    assert "prior 5 logged sessions" in out["method"] and out["label"] == "computed"


def test_by_expiration_keeps_unknown_volume_unknown(screen):
    """O8: a screen file logged without volume reads 'volume unknown', never 'nothing traded'."""
    con = sqlite3.connect(screen)
    con.execute("UPDATE contracts SET vol = NULL")
    con.commit()
    con.close()
    r = ms.run("by_expiration")["rows"][0]
    assert r["volume"] is None and r["call_share_pct"] is None
    assert r["volume_contracts_counted"] == 0 and r["open_interest"] == 1800


def test_a_better_low_oi_butterfly_survives_the_cap(screen, monkeypatch):
    """O7: wings are found in SQL and the cap is taken on reward to risk."""
    con = sqlite3.connect(screen)
    # a second center at 102 with wings 100/104: debit 3.10 + 0.20 - 2 x 1.50 = 0.30 on width 2
    for k, otm, b, a, oi in ((102, 2.0, 1.50, 1.60, 120), (104, 4.0, 0.15, 0.20, 110)):
        con.execute("INSERT INTO contracts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (f"O:TST261101C{k * 1000:08d}", "TST", 20261101, 30, "C", k * 1000, round(otm * 10),
                     3000, 500, round(b * 100), round(a * 100), 30, oi, 5))
    con.commit()
    con.close()
    monkeypatch.setattr(ss, "CANDIDATE_CAP", 1)
    (r,) = ms.run("call_butterflies")["rows"]
    assert r["center"]["strike"] == 102.0 and r["debit"] == 0.3 and r["reward_to_risk"] == 5.67
