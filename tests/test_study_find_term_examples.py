"""Study -- the chart-word example finder (scripts/study/find_term_examples.py).

WHAT THIS FILE EXISTS TO MAKE IMPOSSIBLE
----------------------------------------
1. A RULE THAT FIRES ON THE OPPOSITE CHART. Each rule has a bar series built
   to satisfy it and one built to break it; a rule that answers "yes" to
   both is not a rule.
2. ONE STOCK SUPPLYING THE WHOLE SET. `scan` caps examples per symbol and
   spaces them so the owner sees different charts, not six dates on NVDA.
3. A SILENT EMPTY RESULT. `scan` over bars where nothing fires returns [],
   and the control (bars where something fires) returns entries, so an
   empty pod run is distinguishable from a broken one.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.study import find_term_examples as job  # noqa: E402


def _bars(closes, *, vol=1000, spread=0.5):
    out = []
    for i, c in enumerate(closes):
        out.append({"t": 20240101 + i, "o": c - 0.1, "h": c + spread, "l": c - spread, "c": c, "v": vol})
    return out


def _ramp(n, start=100.0, step=0.3):
    return [start + i * step for i in range(n)]


def test_trending_and_downtrend_are_mirrors():
    up = _bars(_ramp(320))
    down = _bars(_ramp(320, 200.0, -0.3))
    assert job.trending(up, 319) and not job.in_a_downtrend(up, 319)
    assert job.in_a_downtrend(down, 319) and not job.trending(down, 319)


def test_coiled_is_a_ten_close_spread_under_2_5_pct():
    tight = _bars([100.0] * 200 + [100.0, 100.2, 99.9, 100.1, 100.0, 100.3, 99.8, 100.1, 100.0, 100.2])
    loose = _bars([100.0] * 200 + [100, 104, 97, 103, 96, 105, 98, 102, 95, 104])
    assert job.coiled(tight, len(tight) - 1)
    assert not job.coiled(loose, len(loose) - 1)


def test_higher_lows_needs_three_rising_swing_lows():
    seq = [100] * 200
    for low in (90, 93, 96):           # three pullbacks, each bottoming higher
        seq += [100, 97, low, 97, 100, 102, 104]
    rising = _bars([float(x) for x in seq])
    assert job.higher_lows(rising, len(rising) - 1)
    seq2 = [100] * 200
    for low in (96, 93, 90):           # each lower
        seq2 += [100, 97, low, 97, 100, 102, 104]
    falling = _bars([float(x) for x in seq2])
    assert not job.higher_lows(falling, len(falling) - 1)


def test_inside_day_and_gaps_read_the_last_two_bars():
    b = _bars([100.0, 101.0])
    b[1].update({"h": 100.3, "l": 99.8})          # inside the prior 99.5..100.5
    assert job.inside_day(b, 1)
    b[1].update({"h": 101.0})
    assert not job.inside_day(b, 1)
    g = _bars([100.0, 104.0]); g[1]["o"] = 103.5   # opens 3.5% above the prior close
    assert job.gapping_up(g, 1) and not job.gapping_down(g, 1)
    d = _bars([100.0, 96.0]); d[1]["o"] = 96.5
    assert job.gapping_down(d, 1) and not job.gapping_up(d, 1)


def test_heavy_volume_is_twice_the_prior_20_day_average():
    b = _bars([100.0] * 30)
    b[-1]["v"] = 2500
    assert job.heavy_volume(b, 29)
    b[-1]["v"] = 1500
    assert not job.heavy_volume(b, 29)


def test_near_highs_and_new_highs_split_at_the_252_bar_high():
    up = _bars(_ramp(300))
    assert job.at_new_highs(up, 299) and not job.near_its_highs(up, 299)   # today IS the high
    near = _bars(_ramp(300))
    near[-1].update({"h": near[-1]["c"] - 2.0, "c": near[-1]["c"] - 2.5})   # 1.3% off the high, not a new one
    assert job.near_its_highs(near, 299) and not job.at_new_highs(near, 299)
    far = _bars(_ramp(300) + [100.0] * 5)      # last closes far below the run's high
    assert not job.near_its_highs(far, len(far) - 1)


def test_at_the_20_ema_wants_the_band_a_rising_ema_and_the_50():
    closes = _ramp(300)
    b = _bars(closes)
    e = job._ema(closes, 20)
    b[-1]["c"] = e * 1.01                          # 1% above the 20 EMA
    assert job.at_the_20_ema(b, 299)
    b[-1]["c"] = e * 1.06                          # 6% above: not "at" it
    assert not job.at_the_20_ema(b, 299)


def test_pullback_depth_shallow_vs_deep():
    closes = _ramp(320)
    shallow = _bars(closes)
    hi = shallow[-1]["h"]
    shallow[-1]["c"] = hi * 0.97                   # 3% off the 60-bar high inside an uptrend
    assert job.shallow_pullback(shallow, 319) and not job.deep_pullback(shallow, 319)
    deep = _bars(closes)
    deep[-1]["c"] = hi * 0.75
    assert job.deep_pullback(deep, 319) and not job.shallow_pullback(deep, 319)


def test_scan_caps_per_symbol_spaces_dates_and_can_return_empty():
    up = _bars(_ramp(400))
    down = _bars(_ramp(400, 200.0, -0.3))
    rules = {"trending": job.trending}
    found = job.scan({"AAA": up, "BBB": up, "CCC": down}, per_concept=6, per_sym=2, min_gap_bars=40, rules=rules)
    assert [f["sym"] for f in found] == ["AAA", "AAA", "BBB", "BBB"]      # CCC never fires; 2 per symbol
    assert found[0]["ts"] - found[1]["ts"] >= 40                           # spaced, newest first
    assert found[0]["asof"] == job.key_to_iso(found[0]["ts"])
    assert job.scan({"CCC": down}, rules=rules) == []                      # nothing fires: empty, not an error
    assert job.scan({"AAA": up}, rules=rules)                              # control: the same code finds something
