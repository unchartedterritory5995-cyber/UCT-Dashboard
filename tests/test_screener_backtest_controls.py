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

import ast
import inspect
import re
from pathlib import Path

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


# ─── 2 · the purity rail reaches the module the rules come from ─────────────
#
# `tests/test_screener_backtest.py::test_the_engine_imports_no_clock_and_no_rng`
# scans `backtest.py`'s OWN text. Since W5a.1 the engine's determinism also
# rests on `candle_backtest.py` (the clip; W5a.2 adds the bucket rule), which
# that rail never reads. At HEAD the module imports only `math` -- a fact, not
# a rail -- so this section makes it one. The banned tokens are DERIVED from the
# owner rail's source (never re-typed), so the two rails cannot drift apart.

OWNER_RAIL_FILE = "test_screener_backtest.py"
OWNER_RAIL = "test_the_engine_imports_no_clock_and_no_rng"
#: What a pure rules module may import: annotations and arithmetic, nothing else.
ALLOWED_IMPORTS = frozenset({"__future__", "math"})


def _owner_banned_tokens() -> tuple:
    """The literal tuple the owner rail iterates (`for banned in (...)`), read
    off its AST -- so this file never re-types the list and cannot lag it."""
    src = Path(__file__).with_name(OWNER_RAIL_FILE).read_text(encoding="utf-8")
    fn = next(n for n in ast.walk(ast.parse(src))
              if isinstance(n, ast.FunctionDef) and n.name == OWNER_RAIL)
    for node in ast.walk(fn):
        if isinstance(node, ast.For) and isinstance(node.iter, ast.Tuple):
            toks = tuple(e.value for e in node.iter.elts
                         if isinstance(e, ast.Constant) and isinstance(e.value, str))
            if toks:
                return toks
    raise AssertionError(f"{OWNER_RAIL} no longer iterates a literal tuple of tokens")


def _imports_of(src: str) -> set:
    """Top-level module names a source text imports (`a.b` -> `a`); a relative
    import is reported as `.` so it is refused by name too."""
    found = set()
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.Import):
            found.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom):
            found.add("." if node.level else (node.module or "").split(".")[0])
    return found


def _tokens_found(src: str, banned) -> list:
    return [b for b in banned if b in src]


def test_candle_backtest_imports_only_math():
    """⭐ THE RAIL. `backtest.winsorise` IS `candle_backtest._clip`; a clock or an
    RNG imported THERE reaches the engine through a door the owner rail never
    scans. Refused BY NAME: the message lists the offending modules."""
    extra = _imports_of(inspect.getsource(cb)) - ALLOWED_IMPORTS
    assert not extra, f"candle_backtest must stay pure (imports only math): {sorted(extra)}"


def test_candle_backtest_carries_none_of_the_owner_rails_banned_tokens():
    banned = _owner_banned_tokens()
    assert banned, "derived an EMPTY banned list -- this rail would measure nothing"
    found = _tokens_found(inspect.getsource(cb), banned)
    assert not found, f"candle_backtest must be deterministic: found {found}"


def test_the_purity_rail_goes_red_when_a_forbidden_import_is_planted():
    """CONTROL (contract: a rail that reads 0 both ways has measured nothing).
    The same checkers over a COPY of the source with `time` and `datetime`
    planted name them, and over a copy with the derived tokens planted find
    every one; over the real source both name nothing."""
    src = inspect.getsource(cb)
    banned = _owner_banned_tokens()
    assert _imports_of(src) - ALLOWED_IMPORTS == set()
    assert _tokens_found(src, banned) == []
    planted_imports = src + "\nimport time\nfrom datetime import datetime\n"
    assert _imports_of(planted_imports) - ALLOWED_IMPORTS == {"time", "datetime"}
    planted_tokens = src + "\n" + "\n".join(banned) + "\n"
    assert sorted(_tokens_found(planted_tokens, banned)) == sorted(banned)
