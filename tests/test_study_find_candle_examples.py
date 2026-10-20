"""Study -- the candle example finder (scripts/study/find_candle_examples.py).

WHAT THIS FILE EXISTS TO MAKE IMPOSSIBLE
----------------------------------------
1. A SECOND CANDLE GRAMMAR. `names_at` must return exactly what the
   screener's own `single_candle` publishes for that bar: the finder re-states
   nothing, it only walks the tape.
2. ONE STOCK SUPPLYING THE WHOLE SET. `scan` caps examples per symbol and key
   and spaces them, so the owner sees different charts.
3. A SILENT EMPTY RESULT. A scan over bars where nothing can be named returns
   [], and the control (the synthetic decline ending in a hammer-shaped bar)
   returns a hammer, so an empty pod run is distinguishable from a broken one.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.services.screener import candle_catalog as cat  # noqa: E402
from api.services.screener.candles import single_candle  # noqa: E402
from scripts.study import find_candle_examples as job  # noqa: E402


def test_names_at_is_exactly_what_the_screener_publishes():
    bars = job._synthetic()
    i = len(bars) - 1
    keys, trend = job.names_at(bars, i)
    res = single_candle(bars[i + 1 - job.WINDOW:i + 1])
    assert keys == [k for k in cat.decode_matches(res["candle_matches"]) if k in cat.BY_KEY]
    assert trend == res["candle_trend"]
    assert "hammer" in keys and trend == "down"           # the control: a hammer after a decline


def test_a_bar_without_a_full_window_is_never_named():
    bars = job._synthetic()
    assert job.names_at(bars, job.WINDOW - 2) == ([], None)


def test_scan_finds_the_control_and_spaces_examples_per_symbol():
    bars = job._synthetic()
    found = job.scan({"SYN": bars}, per_key=2, keys={"hammer"})
    assert [e["key"] for e in found] == ["hammer"]
    e = found[0]
    assert e["sym"] == "SYN" and e["asof"] == "2024-02-20" and e["bars"] == 1 and e["trend"] == "down"
    # per_sym = 1: a second hammer on the same symbol is not taken
    assert len(job.scan({"SYN": bars, "SYN2": bars}, per_key=2, keys={"hammer"})) == 2


def test_scan_over_nothing_nameable_is_empty_and_the_control_is_not():
    flat = [{"t": 20240101 + i, "o": 100.0, "h": 100.0, "l": 100.0, "c": 100.0, "v": 0} for i in range(120)]
    assert job.scan({"FLAT": flat}, per_key=1) == []
    assert job.scan({"SYN": job._synthetic()}, per_key=1, keys={"hammer"})
