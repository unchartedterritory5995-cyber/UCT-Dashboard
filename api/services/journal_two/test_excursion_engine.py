"""Excursion engine — tier picker + bar-fetch + compute orchestrator
(Journal A+ Phase 2, Task 3).

The CORE (`compute_for_trade` / `compute_for_option_strategy`) is exercised with
an INJECTED `bar_fetch` returning synthetic sorted bars, so these tests never
touch the network. Only the ONE `_fetch_bars` ms→seconds test monkeypatches the
real `massive`/`bars_sqlite` readers to prove the normalization boundary.

DB fixture mirrors test_excursions_store.py: `:memory:` + `ensure_schema`.
"""
import sqlite3

import pytest

from api.services import bars_sqlite, massive
from api.services.journal_two import db as j2db
from api.services.journal_two.excursions_store import get_excursion
from api.services.journal_two.excursion_engine import (
    _pick_tier,
    _parse_ts,
    _fetch_bars,
    compute_for_trade,
    compute_for_option_strategy,
)

# 365-day 5-minute window ceiling in seconds (mirrors the engine constant).
YEAR_S = 365 * 86400


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    j2db.ensure_schema(conn)
    return conn


def _trade_row(**overrides):
    row = {
        "id": "t1",
        "user_id": "u1",
        "symbol": "NVDA",
        "side": "Long",
        "entry_price": 100.0,
        "original_stop": 95.0,
        "exit_price": 110.0,
        "entry_date": "2026-01-05T09:30:00+00:00",
        "exit_date": "2026-01-05T15:00:00+00:00",
        "external_id": None,
        "source": "manual",
    }
    row.update(overrides)
    return row


def _canonical_bar_fetch(captured=None):
    """Injected fetch: 3 in-window bars matching the excursion_calc canonical
    Long example (high 115 at the midpoint bar). Records the tf_code it was
    called with into `captured` if provided."""
    def fetch(symbol, entry_ts, exit_ts, tf_code):
        if captured is not None:
            captured.append((symbol, tf_code))
        mid = (entry_ts + exit_ts) // 2
        return [
            {"t": entry_ts, "h": 105.0, "l": 98.0},
            {"t": mid, "h": 115.0, "l": 104.0},   # favorable extreme
            {"t": exit_ts, "h": 112.0, "l": 96.0},  # adverse extreme
        ]
    return fetch


# ── _pick_tier boundaries ────────────────────────────────────────────────
def test_pick_tier_boundaries():
    assert _pick_tier(0) == ("1", "intraday_1m")
    assert _pick_tier(14399) == ("1", "intraday_1m")       # < 4h → 1m
    assert _pick_tier(14400) == ("5", "intraday_5m")       # 4h boundary → 5m
    assert _pick_tier(51840) == ("5", "intraday_5m")       # same-day → 5m
    assert _pick_tier(10 * 86400) == ("5", "intraday_5m")  # multi-day within a year → 5m
    assert _pick_tier(YEAR_S) == ("5", "intraday_5m")      # exactly the ceiling → still 5m
    assert _pick_tier(YEAR_S + 1) == ("D", "daily")        # older than the 5m window → daily


# ── _parse_ts forms ──────────────────────────────────────────────────────
def test_parse_ts_forms():
    # bare date → that day 00:00:00 UTC
    assert _parse_ts("2026-01-05") == 1767571200  # 2026-01-05T00:00:00Z
    # full ISO with tz
    assert _parse_ts("2026-01-05T00:00:00+00:00") == 1767571200
    # naive ISO assumed UTC
    assert _parse_ts("2026-01-05T00:00:00") == 1767571200
    # Z suffix
    assert _parse_ts("2026-01-05T00:00:00Z") == 1767571200
    # unparseable / empty
    assert _parse_ts("not-a-date") is None
    assert _parse_ts("") is None
    assert _parse_ts(None) is None


# ── same-day Long → 5m tier + correct mfe + row upserted ─────────────────
def test_same_day_long_five_min_tier_and_upsert():
    conn = _conn()
    captured = []
    result = compute_for_trade(
        _trade_row(), bar_fetch=_canonical_bar_fetch(captured), conn=conn,
    )
    # tier chosen by hold (5.5h → 5m)
    assert captured == [("NVDA", "5")]
    assert result["bar_resolution"] == "5"
    assert result["data_quality"] == "intraday_5m"
    assert result["symbol"] == "NVDA"
    assert result["mfe_price"] == 115.0
    assert result["mfe_r"] == pytest.approx(3.0)
    # persisted (camelCase view via get_excursion)
    out = get_excursion("u1", "id:t1", conn)
    assert out is not None
    assert out["mfePrice"] == 115.0
    assert out["mfeR"] == pytest.approx(3.0)
    assert out["barResolution"] == "5"
    assert out["dataQuality"] == "intraday_5m"


# ── multi-day within a year → still 5m ───────────────────────────────────
def test_multiday_within_year_is_five_min():
    conn = _conn()
    captured = []
    row = _trade_row(
        entry_date="2026-01-05T09:30:00+00:00",
        exit_date="2026-01-15T15:00:00+00:00",  # ~10 days
    )
    result = compute_for_trade(row, bar_fetch=_canonical_bar_fetch(captured), conn=conn)
    assert captured[0][1] == "5"
    assert result["data_quality"] == "intraday_5m"


# ── hold older than the 5m window → daily tier ───────────────────────────
def test_hold_over_a_year_is_daily():
    conn = _conn()
    captured = []
    row = _trade_row(
        entry_date="2024-01-05",
        exit_date="2025-06-05",  # > 365 days apart
    )
    result = compute_for_trade(row, bar_fetch=_canonical_bar_fetch(captured), conn=conn)
    assert captured[0][1] == "D"
    assert result["data_quality"] == "daily"


# ── daily tier includes the EXIT-day bar (noon-anchored > date-only exit_ts) ─
def test_daily_tier_includes_exit_day_bar():
    conn = _conn()

    def daily_fetch(symbol, entry_ts, exit_ts, tf_code):
        assert tf_code == "D"
        # Daily bars anchored at each day's UTC NOON (mirrors _day_midday_seconds
        # in the engine). A date-only exit_date parses to 00:00 UTC, so the
        # exit-day bar (noon = exit_ts + 43200) sits AFTER exit_ts.
        return [
            {"t": entry_ts + 43200, "h": 105.0, "l": 98.0},          # entry-day noon
            {"t": exit_ts - 86400 + 43200, "h": 120.0, "l": 100.0},  # day before exit
            {"t": exit_ts + 43200, "h": 150.0, "l": 96.0},           # EXIT-day noon (peak high)
        ]

    # > 365-day hold → daily tier; date-only entry/exit → exit_ts at 00:00 UTC.
    row = _trade_row(entry_date="2024-01-05", exit_date="2025-06-05")
    result = compute_for_trade(row, bar_fetch=daily_fetch, conn=conn)
    assert result["data_quality"] == "daily"
    # the exit-DAY bar's high (150) IS captured — not dropped by the window filter
    assert result["mfe_price"] == 150.0
    out = get_excursion("u1", "id:t1", conn)
    assert out["mfePrice"] == 150.0


# ── empty bar_fetch → insufficient record stored ─────────────────────────
def test_empty_bars_stores_insufficient():
    conn = _conn()
    result = compute_for_trade(
        _trade_row(), bar_fetch=lambda *a: [], conn=conn,
    )
    assert result["data_quality"] == "insufficient"
    assert result["symbol"] == "NVDA"
    assert result["mfe_price"] is None
    assert result["exit_efficiency"] is None
    out = get_excursion("u1", "id:t1", conn)
    assert out is not None
    assert out["dataQuality"] == "insufficient"
    assert out["mfePrice"] is None


# ── zero-window (same date-only entry == exit) → insufficient, no fetch ──
def test_zero_window_date_only_insufficient_no_fetch():
    conn = _conn()
    calls = []

    def spy_fetch(*a):
        calls.append(a)
        return [{"t": 1, "h": 1.0, "l": 1.0}]

    row = _trade_row(entry_date="2026-01-05", exit_date="2026-01-05")
    result = compute_for_trade(row, bar_fetch=spy_fetch, conn=conn)
    assert result["data_quality"] == "insufficient"
    assert calls == []  # short-circuits BEFORE any bar fetch
    out = get_excursion("u1", "id:t1", conn)
    assert out["dataQuality"] == "insufficient"


# ── unparseable timestamp → insufficient, no fetch ───────────────────────
def test_unparseable_ts_insufficient_no_fetch():
    conn = _conn()
    calls = []
    row = _trade_row(exit_date="garbage")
    result = compute_for_trade(
        row, bar_fetch=lambda *a: calls.append(a) or [], conn=conn,
    )
    assert result["data_quality"] == "insufficient"
    assert calls == []


# ── broker trade_ref keying (ext:<external_id>) ──────────────────────────
def test_broker_row_uses_ext_ref():
    conn = _conn()
    row = _trade_row(id="uuid-abc", source="broker", external_id="bk:fingerprint")
    compute_for_trade(row, bar_fetch=_canonical_bar_fetch(), conn=conn)
    assert get_excursion("u1", "ext:bk:fingerprint", conn) is not None
    assert get_excursion("u1", "id:uuid-abc", conn) is None


# ── sqlite3.Row input is read tolerantly (not just dict) ─────────────────
def test_accepts_sqlite_row_input():
    conn = _conn()
    tmp = sqlite3.connect(":memory:")
    tmp.row_factory = sqlite3.Row
    tmp.execute(
        "CREATE TABLE t (id TEXT, user_id TEXT, symbol TEXT, side TEXT, "
        "entry_price REAL, original_stop REAL, exit_price REAL, "
        "entry_date TEXT, exit_date TEXT, external_id TEXT, source TEXT)"
    )
    tmp.execute(
        "INSERT INTO t VALUES ('t9','u1','NVDA','Long',100,95,110,"
        "'2026-01-05T09:30:00+00:00','2026-01-05T15:00:00+00:00',NULL,'manual')"
    )
    srow = tmp.execute("SELECT * FROM t").fetchone()
    result = compute_for_trade(srow, bar_fetch=_canonical_bar_fetch(), conn=conn)
    assert result["mfe_price"] == 115.0
    assert get_excursion("u1", "id:t9", conn) is not None


# ── option strategy → underlying-tier record ─────────────────────────────
def test_option_strategy_underlying_tier():
    conn = _conn()
    captured = []

    def fetch(symbol, entry_ts, exit_ts, tf_code):
        captured.append((symbol, tf_code))
        mid = (entry_ts + exit_ts) // 2
        return [
            {"t": entry_ts, "h": 205.0, "l": 198.0},
            {"t": mid, "h": 260.0, "l": 250.0},   # highest high
            {"t": exit_ts, "h": 240.0, "l": 190.0},  # lowest low
        ]

    strategy_row = {
        "id": "s1",
        "user_id": "u1",
        "underlying": "CRWV",
        "entry_date": "2026-01-05T09:30:00+00:00",
        "closed_at": "2026-01-05T15:00:00+00:00",
    }
    result = compute_for_option_strategy(strategy_row, [], bar_fetch=fetch, conn=conn)
    assert result["data_quality"] == "underlying"
    assert result["symbol"] == "CRWV"
    assert result["mfe_price"] == 260.0   # max high over window
    assert result["mae_price"] == 190.0   # min low over window
    assert result["mfe_r"] is None
    assert result["mae_r"] is None
    assert result["exit_efficiency"] is None
    assert result["missed_r"] is None
    # stored under id:<strategy id> (options are never in j2_trades)
    out = get_excursion("u1", "id:s1", conn)
    assert out is not None
    assert out["dataQuality"] == "underlying"
    assert out["mfePrice"] == 260.0


def test_option_strategy_zero_window_insufficient():
    conn = _conn()
    strategy_row = {
        "id": "s2", "user_id": "u1", "underlying": "AAPL",
        "entry_date": "2026-01-05", "closed_at": "2026-01-05",
    }
    result = compute_for_option_strategy(
        strategy_row, [], bar_fetch=lambda *a: [{"t": 1, "h": 1.0, "l": 1.0}], conn=conn,
    )
    assert result["data_quality"] == "insufficient"
    assert result["symbol"] == "AAPL"


# ── _fetch_bars: massive MILLISECONDS → SECONDS normalization ─────────────
def test_fetch_bars_ms_to_seconds(monkeypatch):
    # local cache empty → falls through to the deep massive minute reader
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda *a, **k: [])
    monkeypatch.setattr(
        massive, "get_agg_bars_minute",
        lambda *a, **k: [{"t": 1700000000000, "o": 1, "h": 2, "l": 0.5, "c": 1, "v": 1}],
    )
    bars = _fetch_bars("AAPL", 1699999000, 1700001000, "5")
    assert len(bars) == 1
    assert bars[0]["t"] == 1700000000  # 1700000000000 ms / 1000
    assert bars[0]["h"] == 2
    assert bars[0]["l"] == 0.5


def test_fetch_bars_prefers_covering_local_cache(monkeypatch):
    # local cache fully spans [entry, exit] → used verbatim, massive NOT called
    monkeypatch.setattr(
        bars_sqlite, "get_bars",
        lambda *a, **k: [
            (1000, 1.0, 5.0, 0.5, 4.0, 100),   # (ts,o,h,l,c,v) seconds
            (2000, 4.0, 6.0, 3.0, 5.0, 100),
        ],
    )

    def boom(*a, **k):
        raise AssertionError("massive should not be called when cache covers window")

    monkeypatch.setattr(massive, "get_agg_bars_minute", boom)
    bars = _fetch_bars("AAPL", 1000, 2000, "5")
    assert bars == [
        {"t": 1000, "h": 5.0, "l": 0.5},
        {"t": 2000, "h": 6.0, "l": 3.0},
    ]


def test_fetch_bars_returns_empty_on_error(monkeypatch):
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda *a, **k: [])

    def boom(*a, **k):
        raise RuntimeError("network down")

    monkeypatch.setattr(massive, "get_agg_bars_minute", boom)
    assert _fetch_bars("AAPL", 1699999000, 1700001000, "5") == []


# ── option strategy → single-leg CONTRACT tier (O: daily aggs) ────────────
def _contract_fetch(contract_bars, underlying_bars=None):
    """Dispatching fetch: OCC symbols get contract bars, else underlying."""
    calls = []

    def fetch(symbol, entry_ts, exit_ts, tf_code):
        calls.append((symbol, tf_code))
        if symbol.startswith("O:"):
            return contract_bars(entry_ts, exit_ts)
        return (underlying_bars or (lambda a, b: []))(entry_ts, exit_ts)

    fetch.calls = calls
    return fetch


_STRAT = {
    "id": "sc1", "user_id": "u1", "underlying": "CRWV",
    "entry_date": "2026-01-05T09:30:00+00:00",
    "closed_at": "2026-01-08T15:00:00+00:00",
}
_LEG_LONG_CALL = {
    "side": "buy", "contract_type": "call", "strike": 90.0,
    "expiration": "2026-02-20", "qty": 2, "entry_price": 2.00,
    "exit_price": 3.50,
}


def test_single_leg_contract_tier_long_call():
    conn = _conn()
    fetch = _contract_fetch(lambda e, x: [
        {"t": e, "h": 2.20, "l": 1.50},
        {"t": (e + x) // 2, "h": 4.00, "l": 2.80},   # premium peak
        {"t": x, "h": 3.60, "l": 3.10},
    ])
    result = compute_for_option_strategy(_STRAT, [_LEG_LONG_CALL],
                                         bar_fetch=fetch, conn=conn)
    assert result["data_quality"] == "option_daily"
    assert result["bar_resolution"] == "D"
    assert result["symbol"] == "CRWV"
    # the fetch was asked for the CONTRACT, daily tier
    assert fetch.calls[0] == ("O:CRWV260220C00090000", "D")
    assert result["mfe_price"] == 4.00
    assert result["mae_price"] == 1.50
    # no stop => stop-based Rs stay None; premium-based ratios compute
    assert result["mfe_r"] is None and result["mae_r"] is None
    assert abs(result["exit_efficiency"] - 0.75) < 1e-9   # (3.5-2)/(4-2)
    assert abs(result["true_r"] - 3.0) < 1e-9             # (3.5-2)/(2-1.5)


def test_single_leg_contract_tier_sold_leg_is_short():
    conn = _conn()
    leg = dict(_LEG_LONG_CALL, side="sell", contract_type="put",
               entry_price=1.00, exit_price=0.30)
    fetch = _contract_fetch(lambda e, x: [
        {"t": e, "h": 1.40, "l": 0.90},    # adverse extreme (max high)
        {"t": x, "h": 0.50, "l": 0.10},    # favorable extreme (min low)
    ])
    result = compute_for_option_strategy(_STRAT, [leg], bar_fetch=fetch, conn=conn)
    assert result["data_quality"] == "option_daily"
    assert result["mfe_price"] == 0.10   # favorable = premium DOWN for a sold leg
    assert result["mae_price"] == 1.40
    assert abs(result["true_r"] - (1.00 - 0.30) / (1.40 - 1.00)) < 1e-9


def test_single_leg_exit_derived_from_net_exit():
    conn = _conn()
    leg = dict(_LEG_LONG_CALL, exit_price=None)
    strat = dict(_STRAT, net_exit=700.0)   # 1 * qty(2) * 3.50 * 100
    fetch = _contract_fetch(lambda e, x: [
        {"t": e, "h": 2.20, "l": 1.50},
        {"t": x, "h": 4.00, "l": 2.80},
    ])
    result = compute_for_option_strategy(strat, [leg], bar_fetch=fetch, conn=conn)
    assert result["data_quality"] == "option_daily"
    assert abs(result["exit_efficiency"] - 0.75) < 1e-9   # exit_ps resolved to 3.50


def test_contract_bars_missing_falls_back_to_underlying():
    conn = _conn()
    fetch = _contract_fetch(
        lambda e, x: [],                                     # no O: aggs
        lambda e, x: [{"t": e, "h": 205.0, "l": 198.0},
                      {"t": x, "h": 240.0, "l": 190.0}],
    )
    result = compute_for_option_strategy(_STRAT, [_LEG_LONG_CALL],
                                         bar_fetch=fetch, conn=conn)
    assert result["data_quality"] == "underlying"
    assert result["mfe_price"] == 240.0
    # the contract WAS attempted first
    assert fetch.calls[0][0].startswith("O:")


def test_multi_leg_keeps_underlying_tier():
    conn = _conn()
    legs = [_LEG_LONG_CALL, dict(_LEG_LONG_CALL, side="sell", strike=100.0)]
    fetch = _contract_fetch(
        lambda e, x: [{"t": e, "h": 9.0, "l": 1.0}],
        lambda e, x: [{"t": e, "h": 205.0, "l": 198.0},
                      {"t": x, "h": 240.0, "l": 190.0}],
    )
    result = compute_for_option_strategy(_STRAT, legs, bar_fetch=fetch, conn=conn)
    assert result["data_quality"] == "underlying"
    # multi-leg never even asks for a contract
    assert all(not s.startswith("O:") for s, _tf in fetch.calls)
