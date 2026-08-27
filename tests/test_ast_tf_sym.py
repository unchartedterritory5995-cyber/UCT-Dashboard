"""W2b — the `tf` and `sym` nodes, pinned BEFORE they exist.

⛔⛔ WHAT THIS FILE IS FOR. `tf(expr, '<TF>')` is the node that lets a daily scan
ask a weekly question, and it is the single most dangerous thing in the wave: if
a base bar can see its own week's FORMING close, every backtest that uses `tf`
reads the future and still draws a confident line. So the semantics are written
down here, as failing tests, before a line of the implementation exists.

⭐ THE RULE, FROZEN: each base bar reads the **last CLOSED** higher-timeframe bar.
That is TradingView's `lookahead=off` plus `[1]`, and it is what makes the node
`non-repainting`. A `tf_live` reading the forming HTF bar is a SEPARATE node with
a `preview-repaints` verdict and is not in this task.

⚠️ AND THE TRAP THE PLAN NAMES: `bars_fetch._resample_weekly_iso` parses
`bar["t"]` with `strptime(..., "%Y-%m-%d")`, but engine bars carry `t` as
`YYYYMMDD` ints on daily and unix seconds on intraday (measured 2026-08-27:
`{"t": 20260827, ...}`). A silent mis-parse dates every HTF bar to 1970 and the
column still draws. `test_the_grouping_is_the_SAME_whichever_t_unit_the_bars_carry`
is the rail on that, and it asserts the GROUPING rather than "numbers came back".
"""
from __future__ import annotations

import datetime

import pytest

from api.services import ast_interpret


# ─── fixtures: three real weeks of daily bars, in both `t` spellings ─────────

def _weekdays(start: datetime.date, n: int):
    """`n` consecutive WEEKDAYS from `start` — the shape a daily series has."""
    out, d = [], start
    while len(out) < n:
        if d.isoweekday() <= 5:
            out.append(d)
        d += datetime.timedelta(days=1)
    return out


#: Mon 2026-08-03 .. Fri 2026-08-21 — three whole ISO weeks, 15 sessions.
_DAYS = _weekdays(datetime.date(2026, 8, 3), 15)


def _bars(t_unit: str = "ymd"):
    """Daily bars whose close RISES BY ONE EACH DAY, so every weekly close is a
    distinct, hand-checkable number and a wrong week is visible by value.

    ⛔ NOT a random or flat series: a flat close would make "last closed week"
    and "this week" agree, and the whole point of these tests is that they must
    NOT agree.
    """
    out = []
    for i, d in enumerate(_DAYS):
        close = 100.0 + i
        if t_unit == "ymd":
            t = int(d.strftime("%Y%m%d"))
        elif t_unit == "epoch":
            t = int(datetime.datetime(d.year, d.month, d.day,
                                      tzinfo=datetime.timezone.utc).timestamp())
        else:
            raise AssertionError("unknown t unit %r" % t_unit)
        out.append({"t": t, "o": close - 0.5, "h": close + 0.5,
                    "l": close - 1.0, "c": close, "v": 1_000 + i})
    return out


def _tf(code, child):
    return {"type": "tf", "value": code, "args": [child]}


CLOSE = {"type": "series", "name": "close"}

#: index 0-4 = week 1 (Aug 3-7), 5-9 = week 2 (Aug 10-14), 10-14 = week 3.
_W1_CLOSE = 104.0        # Fri Aug 7   -> 100 + 4
_W2_CLOSE = 109.0        # Fri Aug 14  -> 100 + 9


# ─── the node exists at all ──────────────────────────────────────────────────

def test_tf_is_a_DECLARED_node_type_in_this_lane():
    assert "tf" in ast_interpret.NODE_TYPES


def test_sym_is_a_DECLARED_node_type_in_this_lane():
    assert "sym" in ast_interpret.NODE_TYPES


# ─── the rule that matters ───────────────────────────────────────────────────

def test_tf_reads_the_LAST_CLOSED_week_never_the_one_the_bar_is_in():
    """⛔⛔ THE REPAINT RULE. A Monday in week 3 sees week 2's close.

    ⭐ AND THE CONTROL IS THE SECOND ASSERTION, not decoration: `tf` returning
    the base bar's own close would satisfy "it returned a number" and every
    downstream test of it. The two values are deliberately different by
    construction (the series rises one point a day)."""
    bars = _bars()
    col = ast_interpret.interpret(_tf("W", CLOSE), bars)

    monday_w3 = 10          # first bar of the third week
    assert col[monday_w3] == pytest.approx(_W2_CLOSE), (
        "a bar in week 3 must read week 2's CLOSED weekly close")
    assert col[monday_w3] != pytest.approx(bars[monday_w3]["c"]), (
        "tf answered the bar's own close — the resample did not happen")
    assert col[monday_w3] != pytest.approx(_W1_CLOSE), (
        "tf is one week too stale — it is reading the week before last")


def test_every_bar_INSIDE_a_week_reads_the_same_closed_value():
    """A weekly value must be FLAT across the week it is read on. A value that
    changed mid-week would mean the forming bar is leaking in."""
    col = ast_interpret.interpret(_tf("W", CLOSE), _bars())
    week3 = col[10:15]
    assert len({round(v, 9) for v in week3}) == 1, (
        f"the weekly value moved inside week 3: {week3} — the forming week leaked")
    assert week3[0] == pytest.approx(_W2_CLOSE)


def test_the_FIRST_week_is_NOT_COMPUTABLE_because_no_week_has_closed_yet():
    """⛔ NaN, never 0.0 and never the first bar's own close. The same left-edge
    rule `offset` states: a bar with nothing to read is not computable, and a
    clamped value makes a confident answer out of missing history."""
    import math
    col = ast_interpret.interpret(_tf("W", CLOSE), _bars())
    assert all(isinstance(v, float) and math.isnan(v) for v in col[0:5]), (
        f"week 1 must be NaN — no week has closed before it; got {col[0:5]}")


def test_the_grouping_is_the_SAME_whichever_t_unit_the_bars_carry():
    """⛔⛔ THE UNIT TRAP, RAILED. `_resample_weekly_iso` wants `"%Y-%m-%d"`;
    engine bars carry `YYYYMMDD` ints (daily) or unix seconds (intraday). A
    silent mis-parse dates every HTF bar to 1970 — and the column still draws.

    ⭐ ASSERTS THE GROUPING, not that numbers came back: both spellings must
    produce the SAME column, value for value."""
    ymd = ast_interpret.interpret(_tf("W", CLOSE), _bars("ymd"))
    epoch = ast_interpret.interpret(_tf("W", CLOSE), _bars("epoch"))
    import math
    assert len(ymd) == len(epoch)
    for i, (a, b) in enumerate(zip(ymd, epoch)):
        both_nan = (isinstance(a, float) and math.isnan(a)
                    and isinstance(b, float) and math.isnan(b))
        assert both_nan or a == pytest.approx(b), (
            f"bar {i}: YYYYMMDD gave {a!r}, unix seconds gave {b!r} — "
            "the two `t` spellings grouped into different weeks")


def test_the_CHILD_is_evaluated_on_HTF_bars_not_resampled_afterwards():
    """⭐ `tf(sma(close, 2), 'W')` is the 2-WEEK average, not the 2-day average
    sampled weekly. The distinction is the whole value of the node, and the two
    answers are different numbers here by construction."""
    tree = _tf("W", {"type": "call", "name": "sma",
                     "args": [CLOSE, {"type": "num", "value": 2}]})
    col = ast_interpret.interpret(tree, _bars())
    # weeks 1 and 2 closed at 104 and 109 -> their 2-week average is 106.5
    assert col[10] == pytest.approx((_W1_CLOSE + _W2_CLOSE) / 2.0), (
        "the child was not evaluated on weekly bars")
    # …and NOT the 2-DAY sma of the daily series, which on the last day of
    # week 2 is (108 + 109) / 2 = 108.5
    assert col[10] != pytest.approx(108.5), (
        "the child was evaluated on DAILY bars and then sampled weekly")


# ─── the refusals ────────────────────────────────────────────────────────────

def test_a_timeframe_BELOW_the_base_is_refused_BY_NAME_and_names_both():
    """Asking a daily series for a 5-minute value cannot be answered from the
    bars in hand, and inventing one is the silent mistranslation this engine
    exists against."""
    with pytest.raises(ast_interpret.TableRefusal) as exc:
        ast_interpret.interpret(_tf("5", CLOSE), _bars(), opts={"tf": "D"})
    msg = str(exc.value)
    assert "5" in msg and "D" in msg, (
        f"the refusal must name BOTH timeframes so the member can act; got {msg!r}")


def test_an_UNDECLARED_timeframe_code_is_refused_and_the_legal_set_is_LISTED():
    with pytest.raises(ast_interpret.TableRefusal) as exc:
        ast_interpret.interpret(_tf("fortnightly", CLOSE), _bars())
    assert "fortnightly" in str(exc.value)
