"""The controls spec §5.9 adds to the screen backtest, each with a CONTROL.

⭐ THE RULES ARE IMPORTED FROM `candle_backtest`, NEVER RESTATED. That module
measured them on 18.8M bars (`docs/superpowers/research/candles/11-MEASURED-EDGE
-2026-08-25.md`): clip at ±50% (a huge mean beside a tiny t is an outlier
report), and match the base rate on the bar's OWN same-day move in lagged-ATR
units (without it the whole finding was short-term mean reversion). A second
spelling of either rule here would drift from the first the day it moved.

⛔ NO CLOCK AND NO RNG IN ANY FIXTURE — the engine's determinism test in
``tests/test_screener_backtest.py`` is only meaningful if inputs are literal.
"""
from __future__ import annotations

import inspect
import re

import pytest

from api.services.screener import backtest as bt
from api.services.screener import candle_backtest as cb


# ─── builders (copied from tests/test_screener_backtest.py, no clock, no RNG) ──

def NUM(v):
    return {"type": "num", "value": v}


def SER(n):
    return {"type": "series", "name": n}


def OP(n, *a):
    return {"type": "op", "name": n, "args": list(a)}


def CALL(n, *a):
    return {"type": "call", "name": n, "args": list(a)}


BAR_TREE = OP(">", SER("close"), CALL("sma", SER("close"), NUM(3)))
ALWAYS = OP(">", SER("close"), NUM(0))


def day(i: int) -> str:
    m, d = divmod(i, 28)
    return f"2024-{m + 1:02d}-{d + 1:02d}"


def bars(closes, opens=None, start=0):
    out = []
    for i, c in enumerate(closes):
        o = c if opens is None else opens[i]
        out.append({"t": day(start + i), "o": float(o), "h": float(max(o, c)) + 1,
                    "l": float(min(o, c)) - 1, "c": float(c), "v": 1000.0})
    return out


def reader(mapping):
    return lambda sym: mapping.get(sym)


def rising(n=80, base=10.0, step=1.0, start=0):
    return bars([base + step * i for i in range(n)], start=start)


# ─── 1 · winsorised means ────────────────────────────────────────────────────

def test_the_winsorised_mean_clips_an_outlier_the_raw_mean_keeps():
    s = bt._stats([1.0, 2.0, 300.0], withheld=False)
    assert s.avg_pct == pytest.approx(101.0)
    assert s.avg_pct_winsorised == pytest.approx((1.0 + 2.0 + cb.WINSOR_PCT) / 3)
    # CONTROL: no outlier -> the two means are one number, so the difference
    # above is the clip and not a second averaging rule.
    c = bt._stats([1.0, 2.0, 3.0], withheld=False)
    assert c.avg_pct_winsorised == pytest.approx(c.avg_pct)


def test_a_withheld_arm_withholds_the_winsorised_mean_too():
    """Rule 5 reaches the new field: below the floor the rate is `None`, never 0."""
    assert bt._stats([1.0, 2.0], withheld=True).avg_pct_winsorised is None


def test_the_clip_is_the_candle_modules_own_rule_not_a_second_one():
    assert bt.winsorise is cb._clip
    assert bt.WINSOR_PCT is cb.WINSOR_PCT


def test_the_receipt_carries_the_winsorised_mean_on_BOTH_arms_and_names_the_rule():
    """⭐ BOTH ARMS. `candle_backtest`: 'the universe base rate is clipped by the
    SAME rule in the SAME pass, so the excess is a difference between two
    like-treated populations'. A clipped strategy beside a raw baseline is not."""
    b = {"AAA": rising(), "BBB": bars([50 - i * 0.4 for i in range(80)])}
    r = bt.run_backtest(BAR_TREE, ["AAA", "BBB"], day(0), day(79),
                        bars_for=reader(b), min_signals=1, horizons=(5,))
    d = r.to_dict()
    assert d["method"]["winsorised"] is True
    assert d["method"]["winsor_pct"] == cb.WINSOR_PCT
    hz = d["horizons"][0]
    for arm in ("strategy", "baseline"):
        assert hz[arm]["avg_pct_winsorised"] is not None
        # this fixture has no move past ±50%, so clipped == raw on both arms
        assert hz[arm]["avg_pct_winsorised"] == pytest.approx(hz[arm]["avg_pct"])


def test_the_baseline_stays_REQUIRED_after_stats_grew_a_defaulted_field():
    """⭐ THE RAIL THE CONTRACT ASKS FOR (mutation: drop the baseline arg).
    `Stats` gained a field WITH a default; `HorizonResult.baseline` must not
    have caught one on the way."""
    p = inspect.signature(bt.HorizonResult).parameters["baseline"]
    assert p.default is inspect.Parameter.empty
    with pytest.raises(TypeError):
        bt.HorizonResult(horizon=5, strategy=bt.Stats(n=10),
                         below_floor=False, coverage={})
