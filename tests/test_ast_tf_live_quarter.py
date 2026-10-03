"""C47 - the forming QUARTER (`tf_live(<child>, "3M")`), the Python mirror.

`interpret.js::TF_LIVE_RESAMPLABLE` carries the ruling. This file holds the
Python lane to the SAME two TradingView captures the JS rail
(`vendorHarness.c47Quarter.test.js`) grades against, so the two lanes agree
because both agree with the vendor - not because one restates the other:

  values      high-low-open-mid-ranges-rddt-1d-2026-09-28 - eight table cells,
              this quarter's and last quarter's open / high / low / mid
  boundaries  vw-time-tf-spy-1d-2026-09-28 - `T09_newQuarter` on every bar

And what the quarter must NOT reach: the closed read (`tf`), a base that is not
daily, the ladder, the screener's gate.
"""
import datetime
import json
import math
import os

import pytest

from api.services import ast_interpret as ai
from api.services import ast_lint as al

HARNESS = os.path.join(os.path.dirname(__file__), "fixtures", "vendor", "harness")


def _capture(name):
    with open(os.path.join(HARNESS, name), encoding="utf-8") as fh:
        return json.load(fh)


def _daily_bars(cap):
    """The capture's bars as this lane's daily bars (ISO `t`).

    The captures are US-equity daily bars stamped at the 09:30 New York open, so
    the UTC date of the stamp IS the session date (13:30 / 14:30 UTC).
    """
    fields = cap["bars"]["fields"]
    assert cap["bars"]["timeUnit"] == "unix-s"
    ix = {f: fields.index(f) for f in ("time", "open", "high", "low", "close", "volume")}
    out = []
    for row in cap["bars"]["rows"]:
        iso = datetime.datetime.fromtimestamp(row[ix["time"]], datetime.timezone.utc).strftime("%Y-%m-%d")
        out.append({"t": iso, "o": row[ix["open"]], "h": row[ix["high"]], "l": row[ix["low"]],
                    "c": row[ix["close"]], "v": row[ix["volume"]] or 0})
    return out


def _not_computable(v):
    return v is None or (isinstance(v, float) and math.isnan(v))


def S(name):
    return {"type": "series", "name": name}


def prev(node):
    return {"type": "offset", "value": 1, "args": [node]}


HL2 = {"type": "op", "name": "/", "args": [
    {"type": "op", "name": "+", "args": [S("high"), S("low")]}, {"type": "num", "value": 2}]}


def live(code, child):
    return {"type": "tf_live", "value": code, "args": [child]}


OHLM = "high-low-open-mid-ranges-rddt-1d-2026-09-28.json"
SPY = "vw-time-tf-spy-1d-2026-09-28.json"


def test_the_eight_quarter_cells_are_tradingviews_numbers():
    cap = _capture(OHLM)
    bars = _daily_bars(cap)
    cells = {(c["col"], c["row"]): float(c["t"]) for c in cap["objects"]["records"]["tableCells"]
             if c["row"] in (7, 8) and c["col"] >= 1}
    assert len(cells) == 8                                   # non-vacuity: both rows, four columns
    children = [S("open"), S("high"), S("low"), HL2]
    for row, wrap in ((7, lambda n: n), (8, prev)):
        for i, child in enumerate(children):
            col = ai.interpret(live("3M", wrap(child)), bars, opts={"tf": "D"})
            assert abs(col[-1] - cells[(i + 1, row)]) < 1e-9, (row, i + 1, col[-1], cells[(i + 1, row)])
    # and by value, so a regression is legible: Q then LQ, open / high / low / mid
    assert [cells[(c, 7)] for c in (1, 2, 3, 4)] == [175.01, 208.05, 135.2223, 171.63615]
    assert [cells[(c, 8)] for c in (1, 2, 3, 4)] == [136.375, 187.34, 128.63, 157.985]


def test_the_first_quarter_of_a_series_has_no_quarter_before_it():
    bars = _daily_bars(_capture(OHLM))
    col = ai.interpret(live("3M", prev(S("open"))), bars, opts={"tf": "D"})
    assert _not_computable(col[0])
    assert not _not_computable(col[-1])


def test_the_quarter_bucket_changes_exactly_where_tradingview_says_a_new_quarter_begins():
    cap = _capture(SPY)
    bars = _daily_bars(cap)
    assert len(bars) == 900
    plot = next(p for p in cap["study"]["plots"] if p["title"] == "T09_newQuarter")
    col = cap["plotValues"]["fields"].index(plot["id"])
    vendor = [1 if r[col] else 0 for r in cap["plotValues"]["rows"]]
    keys = [ai._tf_bucket(b["t"], "3M") for b in bars]
    ours = [1 if i > 0 and keys[i] != keys[i - 1] else 0 for i in range(len(keys))]
    assert ours[1:] == vendor[1:]
    assert sum(ours) > 10                                    # non-vacuity: many quarters
    opens = sorted({int(bars[i]["t"][5:7]) for i in range(len(bars)) if ours[i]})
    assert opens == [1, 4, 7, 10]


def test_the_lists_only_the_forming_read_gains_the_quarter():
    assert ai.TF_RESAMPLABLE == ("W", "M")
    assert ai.TF_LIVE_RESAMPLABLE == ("W", "M", "3M")
    assert ai.TF_BASE_BARS == {"W": 5, "M": 21}
    assert ai.TF_LIVE_BASE_BARS == {"W": 5, "M": 21, "3M": 63}
    assert ai.TF_LADDER == ("1", "5", "15", "30", "60", "D", "W", "M")
    # the linter's copies are the evaluator's
    assert al._TF_LIVE_BASE_BARS == ai.TF_LIVE_BASE_BARS
    assert al._TF_BASE_BARS == ai.TF_BASE_BARS


def test_the_closed_quarter_refuses_in_the_evaluator_and_in_the_lookback_sum():
    bars = _daily_bars(_capture(OHLM))
    closed = {"type": "tf", "value": "3M", "args": [S("close")]}
    with pytest.raises(ai.TableRefusal, match="resamples W, M"):
        ai.interpret(closed, bars, opts={"tf": "D"})
    with pytest.raises(ai.TableRefusal, match="resamples W, M"):
        ai.max_lookback(closed)


@pytest.mark.parametrize("opts", [{"tf": "60"}, {"tf": "W"}, {"tf": "M"}, {}, None])
def test_a_base_that_is_not_daily_or_not_stated_refuses_the_quarter(opts):
    bars = _daily_bars(_capture(OHLM))
    with pytest.raises(ai.TableRefusal, match="DAILY bars only"):
        ai.interpret(live("3M", S("open")), bars, opts=opts)


def test_week_and_month_are_untouched_by_the_daily_rule():
    bars = _daily_bars(_capture(OHLM))
    for code in ("W", "M"):
        col = ai.interpret(live(code, S("open")), bars)      # no base stated: as before
        assert not _not_computable(col[-1])


@pytest.mark.parametrize("code", ["6M", "12M", "2M", "D"])
def test_a_code_nothing_resamples_still_refuses_for_a_forming_read(code):
    bars = _daily_bars(_capture(OHLM))
    with pytest.raises(ai.TableRefusal, match="forming higher-timeframe read resamples W, M, 3M"):
        ai.interpret(live(code, S("open")), bars, opts={"tf": "D"})


def test_the_lookback_of_a_forming_quarter():
    assert ai.max_lookback(live("3M", S("open"))) == 1
    assert ai.max_lookback(live("3M", prev(S("open")))) == 63
    assert ai.max_lookback(live("M", prev(S("open")))) == 21


def test_the_linter_reads_it_as_a_forming_period_and_the_closed_quarter_as_unknown():
    reach = al.ast_reach(live("3M", S("open")))
    assert (reach["back"], reach["forward"], reach["reasons"]) == (0, 62, [])
    closed = al.ast_reach({"type": "tf", "value": "3M", "args": [S("close")]})
    assert closed["forward"] == "unknown" and closed["reasons"]


def test_the_quarterly_resample_groups_as_the_bucket_does():
    bars = _daily_bars(_capture(OHLM))
    quarters = ai._resample_quarterly_iso(bars)
    keys = []
    for b in bars:
        k = ai._tf_bucket(b["t"], "3M")
        if k not in keys:
            keys.append(k)
    assert len(quarters) == len(keys)
    # 2026 Q3, the forming quarter of the capture: the cells' own numbers
    q = quarters[-1]
    assert (q["o"], q["h"], q["l"]) == (175.01, 208.05, 135.2223)
    assert q["t"] == "2026-07-01"
