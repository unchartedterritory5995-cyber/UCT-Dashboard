"""⭐⭐ U-DAILY (e96, part A) -- THE DONE-LINE: THE REQUESTS THE DAY-LENGTH GUARD COULD ONLY ASK ABOUT, BUILT RIGHT.

The value cases hold twelve requests asked on a 5 MINUTE chart that give a length in DAYS and cannot be built whole on
daily bars (four compare each bar with the daily measure, six read another symbol, and the two of the same rounds that
add today's own values to a daily ATR): `udaily-01`..`udaily-10` (pending, walls until U-DAILY, each with its rule
fingerprinted before any answer existed) and `intraday-01`, `intraday-02`. Their BY-VALUE rules are the owner's
(`tools/value_cases/udaily_rules.py`, `intraday_rules.py`); their lanes are the owner's too, and this file reads them,
never edits them (coordinator, 2026-11-22: the case-file change is DEEPVUE's).

What is held here, with no paid call, whatever lane each case sits in today:
  * a build of each request in the door's own tree language, with a DAILY READ (`tf(<the measure>, D)`: the last
    finished day on every bar), is graded RIGHT by its by-value rule on the built 5 minute chart, every named thing
    matched by the reading of the days finished before today (or by this chart's own bars);
  * the door passes each build (`check_day_lengths`, `check_daily_reads`, its own tree gates);
  * THE STAND-IN (the daily-chart answer: N bars of the chart) is still WRONG under each of the ten rules, and the
    door sends it back with the daily read as its repair.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from api.services import definition_conversation as dc
from tools.value_cases import grade as G
from tools.value_cases import intraday_rules as IR
from tools.value_cases import udaily_rules as U

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "tests" / "fixtures" / "authoring" / "value_cases.json").read_text(encoding="utf-8"))
BY_ID = {c["id"]: c for c in DATA["cases"] + DATA["pending"]}
#: the daily-chart case each acceptance case is the 5 minute twin of
TWIN = {"udaily-01": "d26", "udaily-02": "f01", "udaily-03": "f19", "udaily-04": "g04", "udaily-05": "g14",
        "udaily-06": "k03", "udaily-07": "k05", "udaily-08": "k06", "udaily-09": "s03", "udaily-10": "s04"}
N = len(IR.B)
FIVE = {"sym": "NVDA", "tf": "5"}


def ok(v):
    return v is not None and not (isinstance(v, float) and math.isnan(v))


# ── the door's tree language, by hand ──

def num(v):
    return {"type": "num", "value": v}


def ser(name):
    return {"type": "series", "name": name}


def call(name, *args):
    return {"type": "call", "name": name, "args": list(args)}


def op(name, *args):
    return {"type": "op", "name": name, "args": list(args)}


def back(k, x):
    return {"type": "offset", "value": k, "args": [x]}


def daily(x):
    """A DAILY READ: ``x`` on daily bars, shown on each bar of this chart as the last finished day."""
    return {"type": "tf", "value": "D", "args": [x]}


def spy(x):
    return {"type": "sym", "value": "SPY", "args": [x]}


CLOSE, HIGH, LOW = ser("close"), ser("high"), ser("low")


def pct(n, x=CLOSE):
    """the n bar percent change of x, in percent"""
    return op("*", num(100), op("-", op("/", x, back(n, x)), num(1)))


def chg(x=CLOSE):
    """the one bar change of x, as a fraction"""
    return op("-", op("/", x, back(1, x)), num(1))


def corr(a, b, n):
    """Pearson's correlation over n bars, the shape of ``callExpansions.correlation``"""
    cov = op("-", call("sma", op("*", a, b), num(n)), op("*", call("sma", a, num(n)), call("sma", b, num(n))))
    return op("/", cov, op("*", call("stdev", a, num(n)), call("stdev", b, num(n))))


def beta(a, b, n):
    cov = op("-", call("sma", op("*", a, b), num(n)), op("*", call("sma", a, num(n)), call("sma", b, num(n))))
    return op("/", cov, op("*", call("stdev", b, num(n)), call("stdev", b, num(n))))


def built(*trees, reply="Built on daily bars, as of the last finished day."):
    return {"contract": "uct.authoring.patch/1", "disposition": "change", "reply": reply,
            "ops": [{"op": "create", "name": "x", "placement": "price", "primary": "o0",
                     "outputs": [{"key": f"o{k}", "label": f"o{k}", "tree": t} for k, t in enumerate(trees)]}]}


def SMA(n):
    return daily(call("sma", CLOSE, num(n)))


def EMA(n):
    return daily(call("ema", CLOSE, num(n)))


ATR14 = daily(call("atr", HIGH, LOW, CLOSE, num(14)))
RANGE_PCT = op("*", op("/", daily(call("sma", op("-", HIGH, LOW), num(14))), CLOSE), num(100))
RATIO = op("/", CLOSE, spy(CLOSE))
LINE_02 = op("+", call("sessionLow"), op("*", num(0.6), ATR14))

#: THE DONE-LINE: each request, built with a daily read, in the door's own tree language
REFERENCE = {
    "udaily-01": built(daily(op("-", pct(20), spy(pct(20))))),
    "udaily-02": built(op("&&", op(">", CLOSE, SMA(50)), op("<=", back(1, CLOSE), back(1, SMA(50))))),
    "udaily-03": built(op("&&", op("&&", op(">", SMA(10), SMA(20)), op(">", SMA(20), SMA(50))),
                          op("&&", op(">", SMA(10), back(5, SMA(10))),
                             op("&&", op(">", SMA(20), back(5, SMA(20))), op(">", SMA(50), back(5, SMA(50))))))),
    "udaily-04": built(RANGE_PCT, op(">", RANGE_PCT, op("+", call("sma", RANGE_PCT, num(100)),
                                                         op("*", num(2), call("stdev", RANGE_PCT, num(100)))))),
    "udaily-05": built(op("&&", op(">", CLOSE, EMA(10)), op(">", EMA(10), EMA(21)))),
    "udaily-06": built(RATIO, daily(call("ema", op("/", CLOSE, spy(CLOSE)), num(21)))),
    "udaily-07": built(daily(call("sum", op(">", chg(), spy(chg())), num(20)))),
    "udaily-08": built(daily(op("-", pct(63), spy(pct(63))))),
    "udaily-09": built(daily(corr(chg(), spy(chg()), 50))),
    "udaily-10": built(daily(beta(chg(), spy(chg()), 60))),
    "intraday-01": built(op("+", call("sessionLow"), ATR14), op("-", call("sessionHigh"), ATR14)),
    "intraday-02": built(LINE_02, op(">", CLOSE, LINE_02)),
}


def test_the_done_line_is_the_twelve_requests_and_each_has_its_rule_and_its_words():
    assert set(REFERENCE) == set(U.IDS) | {"intraday-01", "intraday-02"} and len(REFERENCE) == 12
    for cid in REFERENCE:
        assert cid in BY_ID and BY_ID[cid]["chart"] == "intraday", cid
        assert G.rule_digest(cid), cid                                   # a by-value rule exists for each
        assert dc.below_a_day(BY_ID[cid]["words"], {"tf": "D"}) and dc.day_lengths(BY_ID[cid]["words"]), cid


@pytest.mark.parametrize("cid", list(REFERENCE))
def test_THE_DONE_LINE_each_request_built_with_a_daily_read_is_right_by_its_by_value_rule(cid):
    got = G.grade(cid, REFERENCE[cid], "intraday")
    assert got["verdict"] == "right", (cid, got["lines"])
    # every named thing a daily read answers was matched by the FINISHED reading (it never moves inside the day)
    named = [line for line in got["lines"] if " = " in line]
    assert named and all(("finished before today" in line) or ("on each bar of this chart" in line) for line in named), named


@pytest.mark.parametrize("cid", list(REFERENCE))
def test_the_door_passes_each_build(cid):
    answer = REFERENCE[cid]
    for check in (dc.check_day_lengths, dc.check_daily_reads):
        try:
            check(answer, BY_ID[cid]["words"], FIVE)
        except dc._Refused as exc:                                         # noqa: SLF001
            raise AssertionError((cid, check.__name__, exc.for_model())) from exc
    for k, o in enumerate(answer["ops"][0]["outputs"]):
        try:
            dc._check_tree(f"o{k}", o["tree"])                             # noqa: SLF001 -- the door's own tree gates
        except dc._Refused as exc:                                         # noqa: SLF001
            raise AssertionError((cid, k, exc.gate, exc.for_model())) from exc


@pytest.mark.parametrize("cid", U.IDS)
def test_THE_STAND_IN_is_still_wrong_and_the_door_sends_it_back_with_the_daily_read(cid):
    """The same request's own DAILY-chart answer takes its days as bars: WRONG on the 5 minute chart under the rule
    (else the rule could not tell a daily measure from a 5 minute one), and the day-length guard's own finding, whose
    repair is now the daily read."""
    stand_in = BY_ID[TWIN[cid]]["answer"]
    got = G.grade(cid, stand_in, "intraday")
    assert got["verdict"] == "wrong", (cid, got["lines"])
    try:
        dc.check_day_lengths({**stand_in, "disposition": "change"}, BY_ID[cid]["words"], FIVE)
        told = None
    except dc._Refused as exc:                                             # noqa: SLF001
        told = exc.for_model()
    assert told is not None and "tf(<the measure>, D)" in told, cid


def test_CONTROL_the_finished_reading_is_not_the_one_as_it_stands():
    """A daily read is the finished reading. The other honest reading (today's bars so far as the newest day) is a
    DIFFERENT column on most bars: the done-line could not pass on the wrong one by accident."""
    spread = dict(U.udaily_rules("udaily-01")["the 20 day percent change minus SPY's"])
    stands = spread[f"{U.STANDS}, in percent"]
    got, _err = G.evaluate(REFERENCE["udaily-01"]["ops"][0]["outputs"][0]["tree"], {}, "intraday")
    assert sum(1 for g, s in zip(got, stands) if ok(g) and ok(s) and abs(g - s) > 1e-6) > N // 2


def test_CONTROL_without_the_daily_bars_nothing_is_drawn_and_nothing_is_right():
    """The grader hands the daily bars a chart below a day is handed (`grade._daily_frames`); without them every daily
    read is withheld by name, so no build of these requests can be right by accident."""
    tree = REFERENCE["udaily-02"]["ops"][0]["outputs"][0]["tree"]
    c = G.CHARTS["intraday"]
    got = G._interpret(tree, c["bars"], {}, c["tf"], c["symbols"])           # noqa: SLF001 -- no daily bars
    assert not any(ok(v) for v in got)
