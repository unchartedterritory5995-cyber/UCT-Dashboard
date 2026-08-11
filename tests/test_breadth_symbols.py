"""UCT breadth pseudo-ticker registry + candle builder."""
import json
import os
from unittest.mock import patch

import pytest

from api.services import breadth_symbols as bs


@pytest.fixture(autouse=True)
def _isolate_ohlc_store(monkeypatch):
    """These tests assert the close-to-close / live-candle behavior, so keep the shared
    session OHLC (wick) store from bleeding real wick rows into their fixed-value asserts.
    The store's own use is covered in test_breadth_daily_ohlc.py."""
    monkeypatch.setattr("api.services.breadth_daily_ohlc.history", lambda *a, **k: {})


def test_registry_symbols_unique_and_grouped():
    syms = [r["symbol"] for r in bs.list_breadth_symbols()]
    assert len(syms) == len(set(syms)), "duplicate breadth symbol"
    # every symbol lands in exactly one of the four groups
    grouped = bs.symbols_by_group()
    flat = [s for g in bs.GROUP_ORDER for s in grouped[g]]
    assert sorted(flat) == sorted(syms)
    assert set(grouped.keys()) == set(bs.GROUP_ORDER)


def test_membership_is_exact_not_prefix():
    assert bs.is_breadth_symbol("UCTA50")
    assert bs.is_breadth_symbol("ucta50")     # case-insensitive
    assert not bs.is_breadth_symbol("UCTT")   # a REAL ticker starting with UCT
    assert not bs.is_breadth_symbol("UCT")
    assert not bs.is_breadth_symbol("")


def test_no_symbol_collides_with_a_real_universe_ticker():
    path = os.path.join(os.path.dirname(__file__), "..", "api", "data", "cap_universe.json")
    with open(path, encoding="utf-8") as fh:
        raw = json.load(fh)
    universe = {str(t).upper() for t in (raw if isinstance(raw, list) else raw.get("tickers", []))}
    clash = set(bs.SYMBOLS) & universe
    assert not clash, f"breadth symbols collide with real tickers: {clash}"


def test_search_ranks_symbol_hits_first():
    r = bs.search("UCTA50", 10)
    assert r and r[0]["ticker"] == "UCTA50" and r[0]["symbol_hit"] is True
    # numeric-core fuzzy match on the name/symbol
    assert "UCTA50" in [x["ticker"] for x in bs.search("50", 20)]
    # label-word match
    assert any(x["ticker"] == "UCTNH" for x in bs.search("HIGHS", 20))


def _fake_history(pairs):
    """pairs = [(date, value)] oldest-first -> get_history newest-first rows."""
    rows = [{"date": d, "pct_above_50sma": v} for (d, v) in pairs]
    return list(reversed(rows))


def test_close_to_close_candles():
    from api.services import breadth_monitor, breadth_live
    pairs = [("2026-08-03", 40), ("2026-08-04", 45), ("2026-08-05", 42)]
    with patch.object(breadth_monitor, "get_history", return_value=_fake_history(pairs)), \
         patch.object(breadth_live, "enabled", return_value=False):
        out = bs.build_breadth_bars("UCTA50", "D", 400)["bars"]
    assert len(out) == 3
    assert out[0] == {"t": "2026-08-03", "o": 40, "h": 40, "l": 40, "c": 40, "v": 0}  # first day flat
    # day 2: body 40 -> 45 (up)
    assert out[1]["o"] == 40 and out[1]["c"] == 45 and out[1]["h"] == 45 and out[1]["l"] == 40
    # day 3: body 45 -> 42 (down)
    assert out[2]["o"] == 45 and out[2]["c"] == 42 and out[2]["h"] == 45 and out[2]["l"] == 42


def test_weekly_resample_keys_to_friday_and_rolls_ohlc():
    from api.services import breadth_monitor
    # Mon 8/3 .. Fri 8/7 then Mon 8/10
    pairs = [("2026-08-03", 40), ("2026-08-04", 50), ("2026-08-05", 48),
             ("2026-08-06", 52), ("2026-08-07", 47), ("2026-08-10", 55)]
    from api.services import breadth_live
    with patch.object(breadth_monitor, "get_history", return_value=_fake_history(pairs)), \
         patch.object(breadth_live, "enabled", return_value=False):
        wk = bs.build_breadth_bars("UCTA50", "W", 20)["bars"]
    assert wk[0]["t"] == "2026-08-07"     # week 1 keyed to its Friday
    assert wk[0]["o"] == 40 and wk[0]["c"] == 47
    assert wk[0]["h"] == 52 and wk[0]["l"] == 40
    assert wk[1]["t"] == "2026-08-14"     # Mon 8/10's week -> Friday 8/14


def test_developing_today_candle_appended_from_live():
    from api.services import breadth_monitor, breadth_live
    hist = _fake_history([("2020-03-09", 40), ("2020-03-10", 45)])  # last EOD in the past
    with patch.object(breadth_monitor, "get_history", return_value=hist), \
         patch.object(breadth_live, "enabled", return_value=True), \
         patch.object(breadth_live, "_session_started", return_value=True), \
         patch.object(breadth_live, "compute_live", return_value={"metrics": {"pct_above_50sma": 48.0}}):
        out = bs.build_breadth_bars("UCTA50", "D", 400)["bars"]
    assert len(out) == 3                                  # 2 stored + today's developing candle
    last = out[-1]
    assert last["t"] > "2020-03-10"                       # a NEW (today) session
    assert last["o"] == 45 and last["c"] == 48            # body = last close -> live value
    assert last["h"] == 48 and last["l"] == 45


def test_no_developing_candle_before_session_start():
    """Pre-open (session not started) must NOT paint a today candle from a live read —
    pre-market breadth is unreliable. Regression for the bogus pre-9:30 candle."""
    from api.services import breadth_monitor, breadth_live
    hist = _fake_history([("2020-03-09", 40), ("2020-03-10", 45)])
    with patch.object(breadth_monitor, "get_history", return_value=hist), \
         patch.object(breadth_live, "enabled", return_value=True), \
         patch.object(breadth_live, "_session_started", return_value=False), \
         patch.object(breadth_live, "compute_live", return_value={"metrics": {"pct_above_50sma": 78.8}}):
        out = bs.build_breadth_bars("UCTA50", "D", 400)["bars"]
    assert len(out) == 2                                  # only the 2 stored days — no today candle
    assert out[-1]["t"] == "2020-03-10"


def test_unknown_symbol_returns_empty():
    assert bs.build_breadth_bars("NOPE", "D", 10) == {"ticker": "NOPE", "tf": "D", "bars": []}


def test_latest_quote_non_live_mirrors_last_eod_candle():
    from api.services import breadth_monitor, breadth_live
    # dates safely in the past so ET-today never coincides
    hist = [{"date": "2020-03-10", "pct_above_100sma": 60},
            {"date": "2020-03-09", "pct_above_100sma": 58}]
    with patch.object(breadth_monitor, "get_history", return_value=hist), \
         patch.object(breadth_live, "enabled", return_value=False):
        q = bs.latest_quotes(["UCTA100"])["UCTA100"]
    assert q["price"] == 60.0 and q["change"] == 2.0 and q["breadth"] is True
    assert q["change_pct"] == round(2 / 58 * 100, 2)


def test_latest_quote_uses_live_value_when_tracked():
    from api.services import breadth_monitor, breadth_live
    hist = [{"date": "2020-03-10", "pct_above_50sma": 50},
            {"date": "2020-03-09", "pct_above_50sma": 48}]
    with patch.object(breadth_monitor, "get_history", return_value=hist), \
         patch.object(breadth_live, "enabled", return_value=True), \
         patch.object(breadth_live, "_session_started", return_value=True), \
         patch.object(breadth_live, "compute_live", return_value={"metrics": {"pct_above_50sma": 55.0}}):
        q = bs.latest_quotes(["UCTA50"])["UCTA50"]
    assert q["price"] == 55.0                      # today's live value
    # newest stored day (2020-03-10 = 50) isn't today, so it's the compare baseline
    assert q["change"] == round(55.0 - 50.0, 2)     # 5.0


def test_latest_quotes_ignores_non_breadth():
    assert bs.latest_quotes(["AAPL", "UCTT"]) == {}


def test_intraday_tf_collapses_to_daily():
    from api.services import breadth_monitor
    with patch.object(breadth_monitor, "get_history", return_value=_fake_history([("2026-08-03", 40)])):
        out = bs.build_breadth_bars("UCTA50", "5", 10)
    assert out["tf"] == "D"
