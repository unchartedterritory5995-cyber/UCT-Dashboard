"""HTF-NEWEST-NARROW (coordinator ruling 2026-11-19) in the Python lane's merge mask (``ast_interpret.py``).

The twin of ``app/src/components/chart/engine/ast/htfNewestNarrow.test.js``: a finished newest bar inside its week
withholds only a root that reads the ``tf_merge`` on that bar (engine 56's walk, ``_newest_reads_merge``). ``x[1]``
reads the bar before's merge, which is settled, and draws; ``nz(x)``, ``na(x) ? x[1] : x``, ``sma(x, 3)`` and
``cum(x)`` read x on the newest bar and stay withheld; a merge under another merge keeps the whole-tree rule. Controls:
a forming newest bar and a Friday (a week closed) draw every shape.
"""
from __future__ import annotations

import pytest

from api.services import ast_interpret

CLOSE = {"type": "series", "name": "close"}
DAYS = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10",
        "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-16", "2026-11-17"]


def num(v):
    return {"type": "num", "value": v}


def merge(code, arg=None):
    return {"type": "tf_merge", "value": code, "args": [dict(arg or CLOSE)]}


def off(k, a):
    return {"type": "offset", "value": k, "args": [a]}


def call(name, *args):
    return {"type": "call", "name": name, "args": list(args)}


def op(name, *args):
    return {"type": "op", "name": name, "args": list(args)}


def bars_on(days):
    return [{"t": t, "o": i + 1, "h": i + 1.5, "l": i + 0.5, "c": i + 1, "v": 100} for i, t in enumerate(days)]


def newest(tree, days, forming=False, sink=None):
    opts = {"tf": "D", "historyFromListing": True, "newest_bar_is_forming": forming}
    if sink is not None:
        opts["chartClockSink"] = sink
    col = ast_interpret.interpret(tree, bars_on(days), {}, opts=opts)
    v = col[len(days) - 1]
    return None if v is None or v != v else v


SHAPES = [
    ("x", lambda: merge("W"), None, 12),
    ("x[1]", lambda: off(1, merge("W")), 10, 10),
    ("x[2]", lambda: off(2, merge("W")), 10, 10),
    ("nz(x, 0)", lambda: call("nz", merge("W"), num(0)), None, 12),
    ("na(x) ? x[1] : x", lambda: op("?:", call("na", merge("W")), off(1, merge("W")), merge("W")), None, 12),
    ("sma(x, 3)", lambda: call("sma", merge("W"), num(3)), None, (10 + 10 + 12) / 3),
    ("close", lambda: dict(CLOSE), 12, 12),
    ("x[1] + close", lambda: op("+", off(1, merge("W")), dict(CLOSE)), 22, 22),
]


@pytest.mark.parametrize("name,tree,finished,_forming", SHAPES, ids=[s[0] for s in SHAPES])
def test_a_finished_newest_bar_withholds_only_a_root_that_reads_x_there(name, tree, finished, _forming):
    assert newest(tree(), DAYS) == finished


def test_cum_of_x_is_withheld_a_running_value_carries_x():
    assert newest(call("cum", merge("W")), DAYS) is None


def test_the_code_is_named_only_for_a_tree_that_withholds():
    named: dict = {}
    newest(merge("W"), DAYS, sink=named)
    assert ast_interpret.TF_MERGE_NEWEST_CODE in named
    quiet: dict = {}
    newest(off(1, merge("W")), DAYS, sink=quiet)
    assert ast_interpret.TF_MERGE_NEWEST_CODE not in quiet


def _weekdays(start, end):
    import datetime
    d, out = datetime.date.fromisoformat(start), []
    while d.isoformat() <= end:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += datetime.timedelta(days=1)
    return out


def test_a_merge_under_another_merge_keeps_the_whole_tree_rule():
    long_days = _weekdays("2026-06-01", "2026-11-17")       # a finished Tuesday, months of history
    nested = off(1, merge("W", merge("M")))
    col = ast_interpret.interpret(nested, bars_on(long_days), {}, opts={"tf": "D", "historyFromListing": True})
    assert col[-2] == col[-2] and col[-2] is not None       # CONTROL: the bar before is drawn (not vacuous)
    assert newest(nested, long_days) is None


@pytest.mark.parametrize("name,tree,_finished,forming", SHAPES, ids=[s[0] for s in SHAPES])
def test_control_a_forming_newest_bar_draws_every_shape(name, tree, _finished, forming):
    assert newest(tree(), DAYS, forming=True) == pytest.approx(forming, abs=1e-9)


def test_control_a_friday_that_closes_its_week_draws_x_and_nz_x():
    to_friday = DAYS[:10]
    assert newest(merge("W"), to_friday) == 10
    assert newest(call("nz", merge("W"), num(0)), to_friday) == 10
