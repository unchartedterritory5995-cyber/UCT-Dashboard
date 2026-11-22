"""UCT RS Exit Warnings (`rsExit`): the server row, its provider and its legend.

The maths is `tests/test_rs_exit_math.py`; the generic row <-> provider contract
(every declared column sent, every contract path present, the lane serving it end
to end, the blank states) is `tests/test_rs_split_rows.py`, where `rsExit` now sits
beside its three siblings. This file holds what is specific to this row: the
length inputs, the daily and weekly rule, the plain-words legend and the cache key.
"""
from __future__ import annotations

import pytest

from api.routers import signature as sig
from api.services import relative_strength as rsm
from api.services.signature import registry_defs as rd
from api.services.signature import rs_provider as rsp
from tests.test_rs_columns_provider import _fetcher, _long_daily
from tests.test_rs_split_rows import _fresh_core, split_rows  # noqa: F401 - fixtures are used by name


def _bars(closes, start_t=1_000):
    return [{"t": start_t + i, "o": c, "h": c, "l": c, "c": float(c), "v": 1} for i, c in enumerate(closes)]


#: The hand-derived path from `test_rs_exit_math.py`: RS 1 1 1 .8 .92 .6 .72 .4 over a flat
#: benchmark, fast 2 / slow 3 -> Quick Breaks at bars 3, 5, 7, Grateful Dead Breaks at 3 and 5.
CLOSES = [100.0, 100.0, 100.0, 80.0, 92.0, 60.0, 72.0, 40.0]


def _engineered(monkeypatch, closes=CLOSES):
    store = {"XYZ": _bars(closes), "SPY": _bars([100.0] * len(closes))}
    fetch = _fetcher(store)
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", fetch)
    rsp.rs_core_reset()          # the shared core memo is keyed on the symbol: a new scenario starts clean
    return store, fetch


def _serve(split_rows_row, sym="XYZ", tf="D", **inputs):
    return sig._rs_exit_provider(sym, tf, rd.resolve_inputs("rsExit", inputs))


# ── the row ───────────────────────────────────────────────────────────────────

def test_the_row_declares_the_benchmark_pair_and_two_length_inputs_where_zero_is_auto():
    row = next(d for d in rd.RS_SPLIT_DEFS if d["id"] == "rsExit")
    by_key = {i["key"]: i for i in row["inputs"]}
    lo, hi = rsm.EXIT_LENGTH_RANGE
    assert by_key["fastLength"] == {"key": "fastLength", "type": "int", "default": 0, "min": 0, "max": hi}
    assert by_key["slowLength"] == {"key": "slowLength", "type": "int", "default": 0, "min": 0, "max": hi}
    assert (lo, hi) == (2, 400)
    assert row["meta"]["name"] == "UCT RS Exit Warnings"
    assert row["columns"] == list(rd.RS_EXIT_WIRE_COLUMNS) == ["rsLine", "fast", "slow", "dotQuick",
                                                               "dotQuicksand", "dotDead"]


def test_the_row_copy_names_the_three_warnings_in_plain_english_and_never_says_sell():
    row = next(d for d in rd.RS_SPLIT_DEFS if d["id"] == "rsExit")
    text = row["meta"]["description"]
    for word in ("Quick Break", "Quicksand", "Grateful Dead Break"):
        assert word in text
    assert " sell" not in (row["meta"]["name"] + " " + text).lower()


def test_the_resolver_keeps_zero_clamps_the_top_and_drops_what_the_row_does_not_declare(split_rows):
    out = rd.resolve_inputs("rsExit", {"fastLength": 999, "slowLength": 0, "lineColor": "#fff", "view": "rating"})
    assert out == {"benchmark": "SPY", "customBenchmark": "", "sectorBenchmark": "XLK", "themeBenchmark": "",
                   "fastLength": 400, "slowLength": 0}
    assert rd.resolve_inputs("rsExit", {}) == {"benchmark": "SPY", "customBenchmark": "", "sectorBenchmark": "XLK",
                                               "themeBenchmark": "", "fastLength": 0, "slowLength": 0}


# ── the lengths: zero is auto, per timeframe ─────────────────────────────────

@pytest.mark.parametrize("tf,want", [("D", (21, 50)), ("W", (8, 21))])
def test_zero_lengths_resolve_to_websters_pair_for_the_timeframe(tf, want, split_rows, monkeypatch):
    _engineered(monkeypatch, [100.0 + (i % 7) for i in range(120)])
    env = _serve(split_rows, tf=tf)
    p = env["payload"]["inputs"]
    assert (p["fastLength"], p["slowLength"]) == want and p["maType"] == "SMA"
    assert (env["payload"]["legend"]["fastLength"], env["payload"]["legend"]["slowLength"]) == want


def test_given_lengths_are_used_and_the_slow_one_is_kept_longer(split_rows, monkeypatch):
    _engineered(monkeypatch, [100.0 + (i % 7) for i in range(120)])
    p = _serve(split_rows, fastLength=10, slowLength=30)["payload"]["inputs"]
    assert (p["fastLength"], p["slowLength"]) == (10, 30)
    p = _serve(split_rows, fastLength=30, slowLength=10)["payload"]["inputs"]
    assert (p["fastLength"], p["slowLength"]) == (30, 31)


# ── the envelope on the hand-derived path ────────────────────────────────────

def test_the_envelope_carries_the_pure_columns_the_dots_and_the_plain_words_legend(split_rows, monkeypatch):
    store, _ = _engineered(monkeypatch)
    env = _serve(split_rows, fastLength=2, slowLength=3)
    pure = rsm.compute_rs_exit_columns(store["XYZ"], store["SPY"], 2, 3)
    cols = env["columns"]
    assert set(cols) == set(rd.RS_EXIT_WIRE_COLUMNS)
    assert cols["rsLine"] == pytest.approx(pure["rsLine"])
    assert [v is None for v in cols["fast"]] == [v is None for v in pure["fast"]]
    # dots: the RS value on a warning bar, nothing elsewhere, exactly on the line
    assert [i for i, v in enumerate(cols["dotQuick"]) if v is not None] == [3, 5, 7]
    assert [i for i, v in enumerate(cols["dotDead"]) if v is not None] == [3, 5]
    assert all(v is None for v in cols["dotQuicksand"])
    for i in (3, 5, 7):
        assert cols["dotQuick"][i] == pytest.approx(cols["rsLine"][i])
    leg = env["payload"]["legend"]
    # the newest warning is the Quick Break on the newest bar; the line sits below both averages
    assert leg["summary"] == "Last warning: Quick Break, on the latest bar"
    assert leg["chipText"] == "Quick Break · latest bar"
    assert leg["blankReason"] is None, "a live answer carries no blank reason, so the label never prints the warning twice"
    assert (leg["lastKind"], leg["lastLabel"], leg["barsAgo"]) == ("quickBreak", "Quick Break", 0)
    assert leg["status"] == "belowBoth" and leg["statusLabel"] == "RS is below both averages"
    assert leg["rs"] == pytest.approx(0.4) and leg["fast"] == pytest.approx(0.56)
    assert leg["slow"] == pytest.approx(0.5733333, abs=1e-6)
    assert leg["asOf"] and leg["stale"] is False


def test_the_legend_names_the_worse_warning_and_counts_bars_back_from_the_newest(split_rows, monkeypatch):
    # RS 1 1 1 .8 .92: the Quick Break + Grateful Dead Break both fire at bar 3, then the line
    # recovers. Newest warning is bar 3, two bars before the last (bar 4 -> index 3 is 1 back).
    _engineered(monkeypatch, [100.0, 100.0, 100.0, 80.0, 92.0])
    leg = _serve(split_rows, fastLength=2, slowLength=3)["payload"]["legend"]
    assert leg["lastKind"] == "deadBreak", "the worse of two warnings on one bar is named"
    assert leg["summary"] == "Last warning: Grateful Dead Break, 1 bar ago"
    assert leg["chipText"] == "Grateful Dead Break · 1 bar ago"
    assert leg["status"] == "aboveBoth" and leg["statusLabel"] == "RS is above both averages"


def test_a_quicksand_is_named_and_a_quiet_line_says_so(split_rows, monkeypatch):
    # RS .9 flat, then a Quick Break at .5 (fast 2 = (.9+.5)/2 = .7), then .4 < .5: Quicksand.
    _engineered(monkeypatch, [90.0, 90.0, 90.0, 50.0, 40.0])
    leg = _serve(split_rows, fastLength=2, slowLength=3)["payload"]["legend"]
    assert leg["lastKind"] == "quicksand" and leg["summary"] == "Last warning: Quicksand, on the latest bar"
    # a flat line never breaks anything
    _engineered(monkeypatch, [100.0] * 8)
    leg = _serve(split_rows, fastLength=2, slowLength=3)["payload"]["legend"]
    assert leg["summary"] == "No warning in the bars shown" and leg["lastKind"] is None
    assert leg["chipText"] == "no warning"
    assert leg["status"] == "aboveBoth"


def test_a_short_series_says_there_are_not_enough_bars_and_does_not_guess(split_rows, monkeypatch):
    _engineered(monkeypatch, [100.0, 99.0])
    env = _serve(split_rows)                                  # auto 21 / 50 needs 21 bars
    cols = env["columns"]
    assert [v for v in cols["rsLine"] if v is not None], "the RS line itself exists"
    for key in ("fast", "slow", "dotQuick", "dotQuicksand", "dotDead"):
        assert all(v is None for v in cols[key]), key
    assert env["payload"]["legend"]["summary"] == env["payload"]["legend"]["blankReason"] == "not enough bars yet"


# ── daily and weekly only ────────────────────────────────────────────────────

@pytest.mark.parametrize("tf", ["1", "5", "15", "30", "60", "M"])
def test_every_other_timeframe_is_blank_says_why_and_reads_no_benchmark(tf, split_rows, monkeypatch):
    store, fetch = _engineered(monkeypatch)
    env = _serve(split_rows, tf=tf, fastLength=2, slowLength=3)
    assert all(v is None for col in env["columns"].values() for v in col) and len(env["times"]) == 8
    assert env["payload"]["state"] == "daily-weekly-only"
    assert env["payload"]["legend"]["summary"] == env["payload"]["legend"]["blankReason"] == "daily and weekly charts only"
    assert [c[0] for c in fetch.calls] == ["XYZ"], "the benchmark is not read where the answer is blank"


def test_the_weekly_chart_is_served(split_rows, monkeypatch):
    _engineered(monkeypatch)
    env = _serve(split_rows, tf="W", fastLength=2, slowLength=3)
    assert env["payload"]["state"] != "daily-weekly-only"
    assert any(v is not None for v in env["columns"]["rsLine"])


# ── blank states, the RS line's own words ────────────────────────────────────

def test_a_symbol_against_itself_says_so(split_rows, monkeypatch):
    _engineered(monkeypatch)
    env = _serve(split_rows, sym="SPY", fastLength=2, slowLength=3)
    assert env["payload"]["state"] == "same-symbol"
    assert env["payload"]["legend"]["summary"] == "benchmark is the symbol"


# ── the cache key ────────────────────────────────────────────────────────────

def test_the_cache_key_leads_with_the_rev_and_shape_and_carries_the_resolved_lengths(split_rows, monkeypatch):
    _engineered(monkeypatch)
    keys = []
    monkeypatch.setattr(sig.cache, "set", lambda k, v, ttl: keys.append(k))
    _serve(split_rows, fastLength=2, slowLength=3)
    _serve(split_rows, fastLength=3, slowLength=4)
    assert len(keys) == 2 and keys[0] != keys[1]
    assert all(f"rsExit{1}p{rsp._RS_EXIT_PAYLOAD_SHAPE}" in k for k in keys)
    assert '"fastLength": 2' in keys[0] and '"slowLength": 3' in keys[0]


def test_it_reads_no_rating_regime_or_evidence(split_rows, monkeypatch):
    _engineered(monkeypatch)
    monkeypatch.setattr(rsp, "_rs_rating", lambda *a, **k: pytest.fail("the rating is not read"))
    env = _serve(split_rows, fastLength=2, slowLength=3)
    assert not {"rating", "regime", "sensitivity", "evidence", "checks"} & set(env["payload"])


def test_a_realistic_store_serves_a_full_daily_answer(split_rows, monkeypatch):
    store = _long_daily(n=900)
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(store))
    env = _serve(split_rows, sym="NVDA")
    assert len(env["times"]) == 900 and env["payload"]["state"] == "ok"
    pure = rsm.compute_rs_exit_columns(store["NVDA"], store["SPY"], 21, 50)
    n_events = sum(1 for v in pure["quickBreak"] if v == 1.0)
    assert n_events == sum(1 for v in env["columns"]["dotQuick"] if v is not None) > 0
