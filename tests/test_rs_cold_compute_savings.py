"""A cold RS compute does the same arithmetic with less work (2026-11-13).

Profiled, one symbol's five RS definitions on a daily chart (852 bars): the readout's
Agreement card computed three least-squares slopes for EVERY bar and read the last
(2,480 slopes, 3 used; 110 of 326 ms), the number check ran about 70,000 times and
was the largest self-time, and each benchmark was joined to the stock twice. Three
savings, none of which may change one bit of any answer:

  * `relative_strength.benchmark_agree_last` is `benchmark_agree(...)[-1]`;
  * `relative_strength._is_num` decides a plain float first;
  * `_rs_sensitivity` joins each benchmark once.

These tests compare each against the code it replaces. The provider's own suites
(`test_rs_columns_provider.py`, the goldens) are unchanged and still pass.
"""
import math
import random
from decimal import Decimal
from fractions import Fraction

import pytest

from api.services import relative_strength as rsmod
from api.services import rs_benchmarks
from api.services.signature import rs_provider


# ── benchmark_agree_last ─────────────────────────────────────────────────────

def _series(rng, n, kind):
    """A random RS-shaped series: mostly finite, sometimes gapped, flat or short of slope."""
    if kind == "flat":
        return [3.25] * n
    v = rng.uniform(0.5, 4.0)
    out = []
    for _ in range(n):
        v *= 1.0 + rng.uniform(-0.03, 0.03) + (0.02 if kind == "up" else -0.02 if kind == "down" else 0.0)
        out.append(v)
    if kind == "gapped":
        for _ in range(max(1, n // 6)):
            out[rng.randrange(n)] = None
    return out


def test_the_last_cell_is_the_columns_last_cell_bit_for_bit():
    rng = random.Random(20261113)
    kinds = ("up", "up", "up", "down", "down", "down", "walk", "flat", "gapped")
    seen = {1.0: 0, 0.0: 0, None: 0}
    for _ in range(4000):
        n = rng.choice((rng.randrange(1, 25), rng.randrange(25, 90), rng.randrange(25, 90)))
        window = rng.choice((2, 3, 5, 10, 20, 20, 20, 25))
        a = _series(rng, n, rng.choice(kinds))
        # the other two legs are usually as long as the first, sometimes shorter or longer
        b = _series(rng, max(1, n + rng.choice((0, 0, 0, 0, 0, 0, -1, -3, 2))), rng.choice(kinds))
        c = _series(rng, max(1, n + rng.choice((0, 0, 0, 0, 0, 0, -1, -7, 1))), rng.choice(kinds))
        want = rsmod.benchmark_agree(a, b, c, window)[-1]
        got = rsmod.benchmark_agree_last(a, b, c, window)
        assert got == want and type(got) is type(want), (n, window, got, want)
        seen[got] += 1
    # the comparison was not vacuous: agree, disagree and "cannot say" all occurred, often
    assert min(seen.values()) > 150, seen


def test_the_default_window_is_the_columns_default_window():
    rng = random.Random(7)
    for _ in range(200):
        a, b, c = (_series(rng, 60, k) for k in ("up", "walk", "down"))
        assert rsmod.benchmark_agree_last(a, b, c) == rsmod.benchmark_agree(a, b, c)[-1]


def test_cannot_say_cases_are_none_never_a_guess():
    up = [1.0 + i * 0.01 for i in range(30)]
    assert rsmod.benchmark_agree_last(up, up, up, 20) == 1.0                    # control: it can say yes
    assert rsmod.benchmark_agree_last(up, up, up[::-1], 20) == 0.0              # ...and no
    assert rsmod.benchmark_agree_last(up, up, up, 1) is None                    # a window too small to have a slope
    assert rsmod.benchmark_agree_last(up[:19], up, up, 20) is None              # fewer bars than the window
    assert rsmod.benchmark_agree_last(up, up[:29], up, 20) is None              # a leg that stops before the last bar
    gap = list(up); gap[-5] = None
    assert rsmod.benchmark_agree_last(up, gap, up, 20) is None                  # a gap inside the last window
    old_gap = list(up); old_gap[3] = None
    assert rsmod.benchmark_agree_last(up, old_gap, up, 20) == 1.0               # a gap before it does not matter
    assert rsmod.benchmark_agree_last(up, [2.0] * 30, up, 20) == 0.0            # a flat leg agrees with nothing
    assert rsmod.benchmark_agree_last([], [], [], 20) is None                   # no bars: no last bar


def test_it_reads_only_the_last_window():
    """The point of it: three slopes, not three per bar."""
    calls = []
    real = rsmod._slope
    up = [1.0 + i * 0.01 for i in range(500)]
    try:
        rsmod._slope = lambda values: (calls.append(len(values)), real(values))[1]
        assert rsmod.benchmark_agree_last(up, up, up, 20) == 1.0
        assert calls == [20, 20, 20]
        calls.clear()
        rsmod.benchmark_agree(up, up, up, 20)
        assert len(calls) == 3 * (500 - 19)                                      # control: the column is the expensive one
    finally:
        rsmod._slope = real


# ── _is_num ──────────────────────────────────────────────────────────────────

def _is_num_reference(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


class _FloatChild(float):
    pass


class _IntChild(int):
    pass


def test_the_number_check_answers_as_it_always_did():
    zoo = [0.0, -0.0, 1.5, -2.25, 1e308, -1e308, 5e-324, float("nan"), float("inf"), float("-inf"),
           0, 1, -7, 2 ** 62, True, False, None, "1.5", "", b"1", [1.0], (1.0,), {"c": 1.0}, 1 + 2j,
           Decimal("1.5"), Fraction(3, 2), _FloatChild(1.5), _FloatChild("nan"), _FloatChild("inf"), _IntChild(3), object()]
    try:
        import numpy as np
        zoo += [np.float64(1.5), np.float64("nan"), np.float64("inf"), np.float32(1.5), np.int64(3), np.bool_(True)]
    except ImportError:                                # pragma: no cover - numpy is installed wherever this runs
        pass
    answers = set()
    for v in zoo:
        got = rsmod._is_num(v)
        assert got is _is_num_reference(v), repr(v)
        answers.add(got)
    assert answers == {True, False}                    # both answers occurred
    # an int too large for a float raises in both, the same way
    with pytest.raises(OverflowError):
        _is_num_reference(10 ** 400)
    with pytest.raises(OverflowError):
        rsmod._is_num(10 ** 400)


def test_a_plain_float_is_decided_without_the_general_path(monkeypatch):
    """The saving itself: for a float, `isinstance` is never asked."""
    asked = []
    real = isinstance
    monkeypatch.setattr(rsmod, "isinstance", lambda v, t: (asked.append(v), real(v, t))[1], raising=False)
    assert rsmod._is_num(1.5) is True
    assert rsmod._is_num(float("nan")) is False
    assert asked == []
    assert rsmod._is_num(3) is True                    # control: any other type takes the general path
    assert asked == [3, 3]


# ── _rs_sensitivity: one join per leg, three slopes for the agreement ────────

def _bars(closes, start_t=20200101):
    return [{"t": start_t + i, "o": c, "h": c, "l": c, "c": float(c), "v": 1} for i, c in enumerate(closes)]


def _legs(n=300, seed=3):
    rng = random.Random(seed)
    walk = lambda drift: [100.0 * math.exp(sum(rng.uniform(-0.02, 0.02) + drift for _ in range(i + 1)) / 3.0) for i in range(n)]  # noqa: E731
    sector = next(iter(rs_benchmarks.SECTOR_ETF))
    etf = rs_benchmarks.SECTOR_ETF[sector]
    data = {"NVDA": _bars(walk(0.004)), "SPY": _bars(walk(0.001)), "RSP": _bars(walk(0.0)), etf: _bars(walk(-0.001))}
    return data, sector, etf


def _sensitivity(data, sector):
    bench = {"resolved": "SPY", "bars": data["SPY"]}
    return rs_provider._rs_sensitivity("NVDA", data["NVDA"], bench, "D", 300, {"sector": sector, "industry": "Semiconductors"},
                                       lambda ticker, tf, count: data.get(ticker, []))


def test_the_agreement_is_the_columns_last_cell_and_the_legs_are_unchanged():
    for seed in range(12):
        data, sector, etf = _legs(seed=seed)
        out = _sensitivity(data, sector)
        rs = {k: rsmod.rs_line(data["NVDA"], data[t]) for k, t in (("spy", "SPY"), ("rsp", "RSP"), ("sector", etf))}
        full = rsmod.benchmark_agree(rs["spy"], rs["rsp"], rs["sector"], out["window"])[-1]
        assert out["agree"] is ((full == 1.0) if full is not None else None)
        for key, ticker in (("spy", "SPY"), ("rsp", "RSP"), ("sector", etf)):
            leg, why, _note = rs_provider._rs_slope_leg(data["NVDA"], data[ticker], out["window"], ticker)
            assert why is None
            assert out[key] == {**leg, "ticker": ticker}
            assert out[key]["slope"] == rsmod._slope(rs[key][-out["window"]:])


def test_each_benchmark_is_joined_once_and_the_whole_column_is_never_built(monkeypatch):
    data, sector, etf = _legs()
    joins = []
    real_line = rsmod.rs_line
    monkeypatch.setattr(rsmod, "rs_line", lambda bars, bench_bars: (joins.append(bench_bars[0]["c"]), real_line(bars, bench_bars))[1])
    monkeypatch.setattr(rsmod, "benchmark_agree", lambda *a, **k: (_ for _ in ()).throw(AssertionError("the per-bar column was built")))
    out = _sensitivity(data, sector)
    assert out["agree"] in (True, False)
    assert len(joins) == 3, joins                      # SPY, RSP and the sector ETF: once each
    assert sorted(joins) == sorted(data[t][0]["c"] for t in ("SPY", "RSP", etf))


def test_a_leg_given_its_join_is_the_leg_that_joins_for_itself():
    data, _sector, _etf = _legs()
    rs = rsmod.rs_line(data["NVDA"], data["RSP"])
    assert rs_provider._rs_slope_leg(data["NVDA"], data["RSP"], 20, "RSP", rs=rs) == rs_provider._rs_slope_leg(data["NVDA"], data["RSP"], 20, "RSP")
    # the reasons too: too few bars, and a gap in the last window
    short = rs_provider._rs_slope_leg(data["NVDA"][:5], data["RSP"][:5], 20, "RSP", rs=rsmod.rs_line(data["NVDA"][:5], data["RSP"][:5]))
    assert short == rs_provider._rs_slope_leg(data["NVDA"][:5], data["RSP"][:5], 20, "RSP")
    assert short[0] is None and "needs 20 bars" in short[1]
    holed = [b for i, b in enumerate(data["RSP"]) if i != len(data["RSP"]) - 4]
    gap = rs_provider._rs_slope_leg(data["NVDA"], holed, 20, "RSP", rs=rsmod.rs_line(data["NVDA"], holed))
    assert gap == rs_provider._rs_slope_leg(data["NVDA"], holed, 20, "RSP")
    assert gap[0] is None and "gap" in gap[1]
