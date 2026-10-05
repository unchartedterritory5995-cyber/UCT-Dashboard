"""P0 truth corpus, slice "inv" -- the PYTHON lane's half of the 0N / 0O pins.

Characterization only: these pin CURRENT behaviour (which the browser lane
reproduces bar-for-bar, see app/src/components/chart/engine/__truth__/
p0.inv.truth.test.js) and document the TradingView difference. No evaluator was
changed. The alert lane evaluates user definitions through this interpreter, so
whatever these pin is also what an alert sees.

0N  `tf(close, 'W')` (what Pine `request.security(..., 'W', close)` with
    lookahead off translates to) reads the previous CLOSED week on every bar;
    TradingView shows the week's value on the bar that completes it.
    Classification: DISCLOSED DIFFERENCE (disclosure hook pending, slice "imp").
0O  bound functions (`rsi`, `atr`, ...) start after the LAST hole in any input
    (`_finite_tail_start`); `ema` holds across a hole (vendor-pinned).
    Classification: UNKNOWN (erased bars) + SILENT DIFFERENCE after a hole,
    owner ruling required.
"""
from __future__ import annotations

import datetime as _dt
import json
import math
import pathlib

import pytest

from api.services import ast_interpret

ROOT = pathlib.Path(__file__).resolve().parents[1]
BARS = json.loads((ROOT / "tests/fixtures/vendor/spy-1d-bars-3000-2026-09-13.json")
                  .read_text(encoding="utf-8"))["bars"][-600:]
N = len(BARS)
HOLE = 300


def _fin(x) -> bool:
    return x is not None and isinstance(x, (int, float)) and math.isfinite(x)


def _series(name):
    return {"type": "series", "name": name}


def _num(v):
    return {"type": "num", "value": v}


def _call(name, *args):
    return {"type": "call", "name": name, "args": list(args)}


def _run(tree, bars):
    return list(ast_interpret.interpret(tree, bars))


def _planted(at):
    return [dict(b, c=float("nan")) if i == at else b for i, b in enumerate(BARS)]


# ── 0O ──────────────────────────────────────────────────────────────────────


def test_0O_rsi_one_mid_hole_erases_everything_before_it_and_restarts():
    """ASKED rsi(close,14) with one hole at bar 300 | CLAIMED RSI | DID: NaN on
    bars 0..314 (UNKNOWN), restarted Wilder seed after the hole (differs from the
    TV hold rule for ~80 bars -- SILENT DIFFERENCE, owner ruling)."""
    col = _run(_call("rsi", _series("close"), _num(14)), _planted(HOLE))
    first = next(i for i, x in enumerate(col) if _fin(x))
    assert first == HOLE + 15
    assert sum(1 for x in col if _fin(x)) == 285


def test_0O_hole_on_newest_bar_empties_the_bound_functions():
    """UNKNOWN: a missing NEWEST value (e.g. a secondary symbol's bar not yet in)
    leaves `rsi` / `atr` with zero values in this lane too."""
    bars = _planted(N - 1)
    assert not any(_fin(x) for x in _run(_call("rsi", _series("close"), _num(14)), bars))
    atr = _call("atr", _series("high"), _series("low"), _series("close"), _num(14))
    assert not any(_fin(x) for x in _run(atr, bars))


def test_0O_ema_holds_across_the_hole():
    """`ema` is the vendor-pinned HOLD: only the hole bar itself is NaN after warm-up."""
    col = _run(_call("ema", _series("close"), _num(10)), _planted(HOLE))
    assert not _fin(col[HOLE])
    assert _fin(col[HOLE + 1])
    assert sum(1 for x in col if _fin(x)) == 590


# ── 0N ──────────────────────────────────────────────────────────────────────


def _iso_week(t: str) -> str:
    d = _dt.date.fromisoformat(t[:10])
    return (d - _dt.timedelta(days=d.weekday())).isoformat()


def test_0N_weekly_tf_is_one_bar_late_on_each_completed_week_vs_tv_rule():
    pytest.importorskip("fastapi")   # `tf` resamples through bars_fetch, which imports it
    col = _run({"type": "tf", "value": "W", "args": [_series("close")]}, BARS)
    keys = [_iso_week(b["t"]) for b in BARS]
    is_last = [i == N - 1 or keys[i + 1] != keys[i] for i in range(N)]
    tv, prev_final = [], float("nan")
    for i, b in enumerate(BARS):
        if i > 0 and keys[i] != keys[i - 1]:
            prev_final = BARS[i - 1]["c"]
        tv.append(b["c"] if is_last[i] else prev_final)
    diffs = [i for i in range(N) if _fin(col[i]) and _fin(tv[i]) and col[i] != tv[i]]
    assert len(diffs) == 124
    assert all(is_last[i] for i in diffs)
    assert max(abs(col[i] - tv[i]) for i in diffs) == pytest.approx(50.38, abs=0.005)
