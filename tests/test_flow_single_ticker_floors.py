"""`/flow TICKER` — a single-ticker lookup must not cap-scale its floors (2026-09-24).

⚰️ THE INCIDENT. Three members ran `/flow BP`, `/flow ASTS`, `/flow DELL` during the
2026-09-24 session and every one read "no significant options flow today". DELL's tape that
day held 1,161 prints and $120M of premium, 27 of them MAGENTA/YELLOW, one contract at $3.69M.
The card printed nothing because `_compute_ticker_flow` reuses the MARKET-WIDE By-Contract
rollup, whose floors are cap-scaled to pick a handful of names out of the whole market: a mega
cap needs ONE contract to total $1M in ONE day (`_rollup_total_floor`) and every print to clear
$250K (`_rollup_floor`). DELL's only two $1M+ contracts were block-only (excluded by the owner's
2026-09-07 ruling) and its twenty-odd sweeps each fell under $1M, so a $9M day rendered as a
quiet one. Measured in the flow-worker pod on the real tape: baseline 0 contracts, with the
single-ticker floors 16 contracts and a $2.58M-vs-$114K bull net.

The docstring on `_compute_ticker_flow` already promised "Uncapped per ticker" — a claim nobody
had wired (`lesson_a_comment_claiming_agreement_is_not_agreement`). These tests wire it.

The print classifier (`_row_to_alert`) is stubbed: it has its own dozen drop rules, none of
which this change touches, and the pod measurement above already covered the real one.
"""
from __future__ import annotations

import datetime as dt
import sqlite3
import sys
import types

import pytest

from api import live_massive_router as lmr
from api.flow_db import FlowDB

MEGA_CAP = 271_369_000_000        # DELL on 2026-09-24 — above `large_max` (200B) → "mega" band
TICKER = "DELLX"                  # not a real name: keeps the module-level 60 s card cache out of it


def _fake_row_to_alert(row, require_direction=True, agg_ask_premium=0.0, agg_ask_volume=0.0):
    """The rollup's view of a print, minus the classifier's own drop rules."""
    return {
        "ticker": row["Symbol"], "cp": "C" if row["CallPut"] == "CALL" else "P",
        "strike": float(row["Strike"]), "exp": row["ExpirationDate"], "source": row["source"],
        "_mktCap": int(row["MktCap"]), "spot": float(row["Spot"]), "dte": int(row["Dte"]),
        "moneynessPct": 1.0, "moneynessLabel": "OTM",
        "alertPremium": float(row["Premium"]), "tradeSize": int(row["Volume"]),
        "_tierKey": "bullish", "_direction": "Bull", "_side": row["Side"], "_type": row["Type"],
        "grade": "C", "priorOI": int(row["OI"]), "timestamp": int(row["id"]) * 60,
        "averageFillPrice": float(row["Price"]),
        "aggAskPremium": agg_ask_premium, "aggAskVolume": agg_ask_volume,
    }


@pytest.fixture
def tape(tmp_path, monkeypatch):
    """A flow.db holding ONE sweep-backed mega-cap contract: three $150K prints, $450K total.
    Under the mega band that is below BOTH floors ($250K/print, $1M/contract); under the
    most-permissive band ($15K/print, $100K/contract) it clears both."""
    db = tmp_path / "flow.db"
    FlowDB(str(db))
    today = lmr._today_mdyyyy()
    exp = dt.datetime.now(lmr.ET).date() + dt.timedelta(days=30)
    exp_s = f"{exp.month}/{exp.day}/{exp.year}"
    conn = sqlite3.connect(str(db))
    for i in range(3):
        conn.execute(
            "INSERT INTO flow (source, CreatedDate, CreatedTime, Symbol, Type, Volume, Price, Side, "
            "CallPut, Strike, Spot, Premium, ExpirationDate, Color, Dte, MktCap, OI, dedup_key) "
            "VALUES ('stocks', ?, ?, ?, 'SWEEP', '100', '15.0', 'A', 'CALL', '535', '530', "
            "'150000', ?, 'YELLOW', '30', ?, '100', ?)",
            (today, f"10:0{i}:00", TICKER, exp_s, str(MEGA_CAP), f"k{i}"))
    conn.commit()
    conn.close()
    monkeypatch.setattr(lmr, "DB_PATH", str(db))
    monkeypatch.setattr(lmr, "_THRESHOLDS_PATH", str(tmp_path / "no-such-thresholds.json"))
    monkeypatch.setattr(lmr, "_thresholds_cache", None)          # defaults, not the box's file
    monkeypatch.setattr(lmr, "_has_dormant_data", lambda: False)
    monkeypatch.setattr(lmr, "_row_to_alert", _fake_row_to_alert)
    monkeypatch.delenv("FLOW_EXCLUDE_BLOCK_ONLY", raising=False)
    # The card's live enrichment (Massive per-contract snapshots, the OI history store) is
    # decoration and reaches the network / a data dir; stub both modules out of the process.
    moi = types.SimpleNamespace(fetch_price_oi_for_contracts=lambda sym, top: {},
                                _canon_mdy=lambda s: str(s or "").strip())
    ois = types.SimpleNamespace(make_key=lambda *a: a, get_history=lambda k, n: [])
    monkeypatch.setitem(sys.modules, "api.massive_oi_snapshots", moi)
    monkeypatch.setitem(sys.modules, "api.oi_snapshots", ois)
    lmr._ticker_flow_cache.clear()
    return today


def test_single_ticker_lookup_keeps_a_mega_cap_contract_under_the_market_wide_floor(tape):
    p = lmr._build_by_contract(tape, "stocks", 1, True, 1, only_ticker=TICKER)
    got = [(c["cp"], c["strike"], c["total_premium"]) for c in p["contracts"]]
    assert got == [("C", 535.0, 450_000)], (
        f"a $450K sweep-backed contract on a mega cap vanished from its own ticker's card: {got}")


def test_market_wide_rollup_still_cap_scales_its_floors(tape):
    """THE CONTROL. The change is scoped to `only_ticker`; the market-wide feed still asks a
    mega cap to total $1M. Without this half a fix that relaxed EVERY floor would pass the
    test above and flood the By-Contract feed with $100K mega-cap churn."""
    p = lmr._build_by_contract(tape, "stocks", 1, True, 1)
    assert p["contracts"] == [], f"the market-wide floor no longer applies: {p['contracts']}"


def test_the_flow_card_itself_shows_the_contract(tape):
    """End to end through `_compute_ticker_flow` — the function the Discord job calls — so the
    block-only and expiry filters that sit AFTER the rollup are exercised too."""
    d = lmr._compute_ticker_flow(TICKER, "1", "stocks", 15)
    assert d["ok"] and d["contract_count"] == 1, d
    assert d["contracts"][0]["premium"] == 450_000
    assert d["net"]["dir"] == "BULL"
    assert d["window"]["active_days"] == 1


# ── the widening ladder (owner ruling 2026-09-24: never a blank card) ───────────────────────

def _insert_dated(db_path: str, day: str, sym: str, exp_s: str, key_prefix: str):
    conn = sqlite3.connect(db_path)
    for i in range(3):
        conn.execute(
            "INSERT INTO flow (source, CreatedDate, CreatedTime, Symbol, Type, Volume, Price, Side, "
            "CallPut, Strike, Spot, Premium, ExpirationDate, Color, Dte, MktCap, OI, dedup_key) "
            "VALUES ('stocks', ?, ?, ?, 'SWEEP', '100', '15.0', 'A', 'CALL', '535', '530', "
            "'150000', ?, 'YELLOW', '30', ?, '100', ?)",
            (day, f"10:0{i}:00", sym, exp_s, str(MEGA_CAP), f"{key_prefix}{i}"))
    conn.commit()
    conn.close()


@pytest.fixture
def quiet_today(tape, tmp_path):
    """Today's tape holds NOTHING for a second name; three sessions back it printed the same
    $450K contract. So `days=1` is honestly empty and `days=5` is not."""
    sym = "QUIETX"
    today = dt.datetime.now(lmr.ET).date()
    back = today - dt.timedelta(days=3)
    exp = today + dt.timedelta(days=30)
    _insert_dated(lmr.DB_PATH, f"{back.month}/{back.day}/{back.year}", sym,
                  f"{exp.month}/{exp.day}/{exp.year}", "q")
    lmr._ticker_flow_cache.clear()
    return sym


def test_ladder_rungs_are_strictly_wider_than_the_request():
    assert lmr._widen_ladder("1") == [5, 20, "all"]
    assert lmr._widen_ladder("5") == [20, "all"]
    assert lmr._widen_ladder("7") == [20, "all"]
    assert lmr._widen_ladder("30") == ["all"]
    assert lmr._widen_ladder("all") == []


def test_without_widen_an_empty_window_stays_empty(quiet_today):
    """THE CONTROL for the research tab: `widen` is opt-in, so a fixed 5-day panel with nothing
    in it keeps saying so instead of quietly showing a 20-day window."""
    d = lmr._compute_ticker_flow(quiet_today, "1", "stocks", 15)
    assert d["ok"] and d["contract_count"] == 0
    assert "widened_from" not in d["window"]


def test_widen_climbs_to_the_first_window_with_a_contract(quiet_today):
    d = lmr._compute_ticker_flow(quiet_today, "1", "stocks", 15, widen=True)
    assert d["contract_count"] == 1, d
    assert d["window"]["days_requested"] == "5", d["window"]
    assert d["window"]["widened_from"] == "1", d["window"]


def test_widen_leaves_a_non_empty_window_alone(tape):
    d = lmr._compute_ticker_flow(TICKER, "1", "stocks", 15, widen=True)
    assert d["contract_count"] == 1
    assert d["window"]["days_requested"] == "1"
    assert "widened_from" not in d["window"]


def test_widen_returns_the_honest_empty_when_every_rung_is_empty(tape):
    d = lmr._compute_ticker_flow("NEVERX", "1", "stocks", 15, widen=True)
    assert d["ok"] and d["contract_count"] == 0
    assert d["window"]["days_requested"] == "1" and "widened_from" not in d["window"]
    # ...and it says which rungs it looked at, which is what licenses the reply's clause
    assert d["window"]["widened_checked"] == ["5", "20", "all"]


def test_the_empty_reply_vouches_for_a_wider_search_only_when_one_ran(monkeypatch):
    """A backend that ignores `widen` (deploy skew) returns a plain empty window; the reply
    must then say only "today", never "none in any wider window"."""
    from api.routers import discord_interactions as router
    sent = []
    edit = lambda app_id, token, **kw: sent.append(kw.get("content"))
    plain = {"ok": True, "contracts": [], "window": {"days_requested": "1"}}
    router.run_flow_card_job("A", "T", "ZZZ", "1", fetch_fn=lambda t, d: plain, edit_fn=edit, source="stocks")
    assert sent[-1] == "**ZZZ** — no significant options flow today."
    checked = {"ok": True, "contracts": [], "window": {"days_requested": "1", "widened_checked": ["5", "20", "all"]}}
    router.run_flow_card_job("A", "T", "ZZZ", "1", fetch_fn=lambda t, d: checked, edit_fn=edit, source="stocks")
    assert sent[-1] == ("**ZZZ** — no significant options flow today — and none on record in any "
                        "wider window (checked back through all history).")


def test_the_reply_and_the_card_both_name_a_widened_window():
    from api.routers.discord_interactions import _flow_window_phrase
    from api.flow_ticker_card import _window_label
    w = {"days_requested": "5", "widened_from": "1", "start": "9/18/2026", "end": "9/22/2026", "active_days": 3}
    assert _flow_window_phrase(w) == "last 5 trading days (nothing significant today)"
    assert _window_label(w).startswith("last 5 trading days (nothing today)")
    # unwidened windows read exactly as before
    assert _flow_window_phrase({"days_requested": "1"}) == "today"
    assert _flow_window_phrase({"days_requested": "all"}) == "all history"
    assert _window_label({"days_requested": "5", "active_days": 2}) == "last 5 trading days  ·  2 active days"


# ── the fixed cost of a single-ticker call (measured in the pod 2026-09-25) ────────────────

def test_the_distinct_dates_scan_runs_once_per_ttl_and_is_keyed_by_db_path(tape, tmp_path, monkeypatch):
    """`SELECT DISTINCT CreatedDate FROM flow` cost 2.0 s of BP's 2.5 s and ran on EVERY
    single-ticker call — four times for a name widening through the ladder. It is now cached
    for `_FLOW_DATES_ALL_TTL_S`, keyed by the database file so two files never share an answer."""
    real_connect = lmr.sqlite3.connect
    opened = []

    def counting_connect(path, *a, **k):
        opened.append(str(path))
        return real_connect(path, *a, **k)
    monkeypatch.setattr(lmr.sqlite3, "connect", counting_connect)
    first = lmr._flow_dates_all()
    second = lmr._flow_dates_all()
    assert first == second and first, first
    assert len(opened) == 1, f"the dates scan reopened the database on a warm read: {opened}"
    # a DIFFERENT database file is a different answer, never the cached one
    other = tmp_path / "other.db"
    FlowDB(str(other))
    monkeypatch.setattr(lmr, "DB_PATH", str(other))
    assert lmr._flow_dates_all() == [], "a second database served the first one's dates"


def test_the_sweep_map_is_right_and_steers_the_planner_off_the_symbol_index(tape, monkeypatch):
    """Two contracts on the fixture: one sweep-backed, one block-only. The map must say so — and
    the SQL must carry the `+Symbol` steer: without it SQLite takes the Symbol-led contract index
    and walks the symbol's whole history (SPY: 4,175 ms vs 163 ms, pod, 2026-09-25)."""
    today = tape
    exp = dt.datetime.now(lmr.ET).date() + dt.timedelta(days=30)
    exp_s = f"{exp.month}/{exp.day}/{exp.year}"
    conn = sqlite3.connect(lmr.DB_PATH)
    conn.execute(
        "INSERT INTO flow (source, CreatedDate, CreatedTime, Symbol, Type, Volume, Price, Side, CallPut, "
        "Strike, Spot, Premium, ExpirationDate, Color, Dte, MktCap, OI, dedup_key) VALUES "
        "('stocks', ?, '10:05:00', ?, 'BLOCK', '100', '15.0', 'A', 'CALL', '540', '530', '150000', ?, "
        "'YELLOW', '30', ?, '100', 'blk540')", (today, TICKER, exp_s, str(MEGA_CAP)))
    conn.commit(); conn.close()
    seen_sql = []
    real_connect = lmr.sqlite3.connect

    class _Conn:
        def __init__(self, c): self._c = c
        def execute(self, sql, *a):
            seen_sql.append(sql); return self._c.execute(sql, *a)
        def close(self): self._c.close()
    monkeypatch.setattr(lmr.sqlite3, "connect", lambda *a, **k: _Conn(real_connect(*a, **k)))
    m = lmr._contract_has_sweep_map(TICKER, [today])
    assert m[("C", 535.0, exp_s)] is True, m       # three SWEEP prints
    assert m[("C", 540.0, exp_s)] is False, m      # BLOCK only
    assert any("+Symbol=?" in s for s in seen_sql), "the planner steer is gone; SPY pays 4 s again"


# ── the index partition (ETFs) — found by the first ETF parity run, 2026-09-25 ─────────────

@pytest.fixture
def etf_tape(tape):
    """An ETF's $450K sweep-backed contract under source='indexes' — the partition every ETF and
    index print lives in. `_rollup_floor` returns the MEGA floors for that source before it looks
    at the cap, which is why the 9/24 floor fix never reached /flow IWM."""
    exp = dt.datetime.now(lmr.ET).date() + dt.timedelta(days=30)
    exp_s = f"{exp.month}/{exp.day}/{exp.year}"
    conn = sqlite3.connect(lmr.DB_PATH)
    for i in range(3):
        conn.execute(
            "INSERT INTO flow (source, CreatedDate, CreatedTime, Symbol, Type, Volume, Price, Side, "
            "CallPut, Strike, Spot, Premium, ExpirationDate, Color, Dte, MktCap, OI, dedup_key) "
            "VALUES ('indexes', ?, ?, 'IWMX', 'SWEEP', '100', '15.0', 'A', 'PUT', '260', '262', "
            "'150000', ?, 'YELLOW', '30', '0', '100', ?)",
            (tape, f"11:0{i}:00", exp_s, f"etf{i}"))
    conn.commit(); conn.close()
    lmr._ticker_flow_cache.clear()
    return exp_s


def test_a_single_etf_lookup_uses_the_permissive_floors_too(etf_tape):
    p = lmr._build_by_contract(lmr._today_mdyyyy(), "etfs", 1, True, 1, only_ticker="IWMX")
    got = [(c["cp"], c["strike"], c["total_premium"], c["source"]) for c in p["contracts"]]
    assert got == [("P", 260.0, 450_000, "indexes")], (
        f"an ETF's $450K contract vanished from its own card (index floors still applied): {got}")


def test_the_market_wide_etf_feed_keeps_its_index_floors(etf_tape, monkeypatch):
    """THE CONTROL: the ETF feed still asks an index contract to total $1M, or SPX 0DTE churn
    floods it. `etf_enabled` is off by default, so switch it on for the market-wide read."""
    th = dict(lmr._load_thresholds()); th["etf_enabled"] = True
    monkeypatch.setattr(lmr, "_thresholds_cache", th)
    p = lmr._build_by_contract(lmr._today_mdyyyy(), "etfs", 1, True, 1)
    assert p["contracts"] == [], f"the index floor no longer applies market-wide: {p['contracts']}"
