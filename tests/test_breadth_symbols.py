"""UCT breadth pseudo-ticker registry + candle builder."""
import json
import os
from unittest.mock import patch

from api.services import breadth_symbols as bs


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
    from api.services import breadth_monitor
    pairs = [("2026-08-03", 40), ("2026-08-04", 45), ("2026-08-05", 42)]
    with patch.object(breadth_monitor, "get_history", return_value=_fake_history(pairs)):
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
    with patch.object(breadth_monitor, "get_history", return_value=_fake_history(pairs)):
        wk = bs.build_breadth_bars("UCTA50", "W", 20)["bars"]
    assert wk[0]["t"] == "2026-08-07"     # week 1 keyed to its Friday
    assert wk[0]["o"] == 40 and wk[0]["c"] == 47
    assert wk[0]["h"] == 52 and wk[0]["l"] == 40
    assert wk[1]["t"] == "2026-08-14"     # Mon 8/10's week -> Friday 8/14


def test_unknown_symbol_returns_empty():
    assert bs.build_breadth_bars("NOPE", "D", 10) == {"ticker": "NOPE", "tf": "D", "bars": []}


def test_intraday_tf_collapses_to_daily():
    from api.services import breadth_monitor
    with patch.object(breadth_monitor, "get_history", return_value=_fake_history([("2026-08-03", 40)])):
        out = bs.build_breadth_bars("UCTA50", "5", 10)
    assert out["tf"] == "D"
