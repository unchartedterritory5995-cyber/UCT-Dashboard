"""THE ACCEPTANCE CASES OF "A DAILY MEASURE ON A CHART BELOW A DAY", AND THE ENGINE UNIT THAT ANSWERS THEM (U-DAILY).

Ten requests the value cases already hold on a daily chart, asked on a 5 MINUTE chart. Each gives a length in days and
could not be built whole on daily bars: four compare each bar of the chart with the daily measure, six read another
symbol. Until U-DAILY the right answer was a question (the day-length guard, #2471); their rules were written then,
before the engine existed and before any answer did, so they could not learn from either.

U-DAILY (e96, part A) is the read they waited for: ``tf(<the measure>, D)``, computed on daily bars and shown on every
bar of a chart below a day as THE LAST FINISHED DAY. So each is a FORMULA case now, held BY VALUE on every 5 minute bar
to ``udaily_rules``. What is held here, with no paid call:
  * THE DONE-LINE: a build of each request in the door's own tree language, the ten and the two of the same rounds
    (``intraday-01``, ``intraday-02``), is RIGHT by value on the 5 minute chart, and the door passes it;
  * every rule can still tell a right answer from THE STAND-IN (the daily-chart answer, N bars of the chart), which is
    wrong under every one of the ten and which the door still sends back, now with the daily read as its repair;
  * the wording: a daily read is named in the reply for the day it shows (``udaily-12``'s ``says``).
The live answers are the studio's re-run's to record.
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
BY_ID = {c["id"]: c for c in DATA["cases"]}
PENDING = [c for c in DATA["pending"] if c["id"] in U.IDS]
#: the request of the same rounds that is kept, words unchanged, and is NOT an acceptance case
HELD = [c for c in DATA["pending"] if c["id"].startswith("udaily-") and "held" in c]
#: the case that holds the wording of a daily read
WORDING = {c["id"]: c for c in DATA["pending"] if c["id"] in U.WORDING_IDS}
#: the daily-chart case each one is the 5 minute twin of
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


def words_of(cid):
    return (next((c for c in PENDING if c["id"] == cid), None) or BY_ID[cid])["words"]


# ── the cases ──

def test_ten_acceptance_cases_are_formula_cases_now_with_their_words_and_their_rules():
    assert tuple(c["id"] for c in PENDING) == U.IDS == tuple(TWIN) and len(PENDING) == 10
    for case in PENDING:
        twin = BY_ID[TWIN[case["id"]]]
        said = twin["words"]
        assert case["words"] == "On a 5 minute chart, " + said[0].lower() + said[1:], case["id"]            # the same request, on a 5 minute chart
        assert case["lane"] == "formula" and case["chart"] == "intraday" and "answer" not in case and "recorded" not in case
        assert twin["lane"] == "formula" and twin.get("recorded_verdict") != "wrong"                         # built RIGHT on a daily chart
        # the door sees what the case is about: a chart below a day and a length in days
        assert dc.below_a_day(case["words"], {"tf": "D"}) and dc.day_lengths(case["words"]), case["id"]
        # what it was until U-DAILY: a wall that named the daily measure, kept as its history
        assert case["was"]["lane"] == "wall" and case["was"]["wall"]["names"] == ["daily measure", f"{dc.day_lengths(case['words'])[0]} day"]
        assert "U-DAILY" in case["was"]["until"]


def test_each_rule_was_fingerprinted_before_any_answer_and_still_is():
    for case in PENDING:
        digest = G.rule_digest(case["id"])
        assert digest and case["rule"]["digest"] == digest == case["rule"]["history"][-1]["digest"], case["id"]
        assert case["rule"]["history"][0]["reason"] == "written from the request's words before the answer was read"


# ── THE DONE-LINE: each request built with a daily read is right by value, and the door passes it ──

@pytest.mark.parametrize("cid", list(REFERENCE))
def test_THE_DONE_LINE_each_request_built_with_a_daily_read_is_right_by_value(cid):
    got = G.grade(cid, REFERENCE[cid], "intraday")
    assert got["verdict"] == "right", (cid, got["lines"])
    # and every named thing a daily read answers was matched by the FINISHED reading (it never moves inside the day)
    named = [line for line in got["lines"] if " = " in line]
    assert named and all(("finished before today" in line) or ("on each bar of this chart" in line) for line in named), named


@pytest.mark.parametrize("cid", list(REFERENCE))
def test_the_door_passes_each_build(cid):
    answer = REFERENCE[cid]
    for check in (dc.check_day_lengths, dc.check_daily_reads):
        try:
            check(answer, words_of(cid), FIVE)
        except dc._Refused as exc:                                         # noqa: SLF001
            raise AssertionError((cid, check.__name__, exc.for_model())) from exc
    for k, o in enumerate(answer["ops"][0]["outputs"]):
        try:
            dc._check_tree(f"o{k}", o["tree"])                             # noqa: SLF001 -- the door's own tree gates
        except dc._Refused as exc:                                         # noqa: SLF001
            raise AssertionError((cid, k, exc.gate, exc.for_model())) from exc


@pytest.mark.parametrize("cid", U.IDS)
def test_THE_STAND_IN_is_still_wrong_for_every_one_and_the_door_sends_it_back_with_the_daily_read(cid):
    """The same request's own DAILY-chart answer takes its days as bars. On the 5 minute chart that is N bars of the
    chart: WRONG under the acceptance rule (else the rule could not tell a daily measure from a 5 minute one), and the
    day-length guard's own finding, whose repair is now the daily read."""
    stand_in = BY_ID[TWIN[cid]]["answer"]
    got = G.grade(cid, stand_in, "intraday")
    assert got["verdict"] == "wrong", (cid, got["lines"])
    try:
        dc.check_day_lengths({**stand_in, "disposition": "change"}, words_of(cid), FIVE)
        told = None
    except dc._Refused as exc:                                             # noqa: SLF001
        told = exc.for_model()
    assert told is not None and "tf(<the measure>, D)" in told, cid


def test_CONTROL_the_finished_reading_is_not_the_one_as_it_stands():
    """A daily read is the finished reading. The other honest reading (today's bars so far as the newest day) is a
    DIFFERENT column, on most bars: a rule that could not tell them apart could not hold the wording either."""
    spread = dict(U.udaily_rules("udaily-01")["the 20 day percent change minus SPY's"])
    stands = spread[f"{U.STANDS}, in percent"]
    got, _err = G.evaluate(REFERENCE["udaily-01"]["ops"][0]["outputs"][0]["tree"], {}, "intraday")
    assert sum(1 for g, s in zip(got, stands) if ok(g) and ok(s) and abs(g - s) > 1e-6) > N // 2


# ── the wording ──

def test_THE_WORDING_a_daily_read_is_named_for_the_day_it_shows():
    case = WORDING["udaily-12"]
    assert case["lane"] == "formula" and case["chart"] == "intraday" and case["says"]
    assert case["rule"]["digest"] == G.rule_digest("udaily-12") == case["rule"]["history"][0]["digest"]
    line = daily(call("highest", HIGH, num(20)))
    right = built(line, reply="A line at the highest high of the last 20 days, as of the last finished day.")
    assert G.grade_case(case, right)["verdict"] == "right", G.grade_case(case, right)["lines"]
    # the same build, told as if it were today's value: wrong on what it SAYS
    mute = built(line, reply="A line at the 20 day high.")
    got = G.grade_case(case, mute)
    assert got["verdict"] == "wrong" and any("the reply says none of" in x for x in got["lines"]), got["lines"]
    # and a line that counts today is wrong by value, whatever it says
    today = built(call("max", daily(call("highest", HIGH, num(19))), call("sessionHigh")),
                  reply="The 20 day high, as of the last finished day.")
    assert G.grade_case(case, today)["verdict"] == "wrong"


# ── the rules themselves ──

@pytest.mark.parametrize("cid", U.IDS)
def test_each_acceptance_rule_covers_the_chart_and_can_tell_things_apart(cid):
    want = U.udaily_rules(cid)
    assert want and U.udaily_rules("udaily-11") is None
    for what, readings in want.items():
        assert readings and all(len(col) == N for _name, col in readings), (cid, what)
        for name, col in readings:
            values = [v for v in col if ok(v)]
            assert len(values) > N - 120, (cid, what, name)                           # a value on nearly every bar
            if set(values) <= {0.0, 1.0}:                                              # a condition: true on some bars, false on others
                assert 5 <= sum(values) <= len(values) - 5, (cid, what, name, sum(values))
            else:
                assert len({round(v, 9) for v in values}) > 2, (cid, what, name)       # a value that moves (a count of days moves little)
        # the honest readings of a daily measure are DIFFERENT columns (a rule with one reading listed twice holds nothing)
        distinct = {tuple(None if not ok(v) else round(v, 9) for v in col) for _name, col in readings}
        assert len(distinct) >= min(2, len(readings)), (cid, what)


def test_the_rules_read_the_words_on_this_charts_bars_and_the_days_from_the_daily_bars():
    # "the close" is this bar's close: the ratio against SPY is this chart's two closes, bar by bar
    ratio = U.udaily_rules("udaily-06")["the close over SPY's close"][0][1]
    assert all(abs(ratio[i] - IR.C[i] / U.SC[i]) < 1e-12 for i in range(N))
    # FINISHED holds all day; AS IT STANDS moves inside the day
    spread = dict(U.udaily_rules("udaily-01")["the 20 day percent change minus SPY's"])
    finished, stands = spread[f"{U.FINISHED}, in percent"], spread[f"{U.STANDS}, in percent"]
    day = slice(78 * 7, 78 * 8)
    assert len(set(finished[day])) == 1 and len(set(stands[day])) > 20
    # by hand, one bar: the 20 finished days end YESTERDAY
    i, d = 78 * 7 + 30, IR.DAY[78 * 7 + 30]
    by_hand = (IR.DC[d - 1] / IR.DC[d - 21] - 1) * 100 - (U.SDC[d - 1] / U.SDC[d - 21] - 1) * 100
    assert abs(finished[i] - by_hand) < 1e-9
    by_hand = (IR.C[i] / IR.DC[d - 20] - 1) * 100 - (U.SC[i] / U.SDC[d - 20] - 1) * 100
    assert abs(stands[i] - by_hand) < 1e-9
    # and the wording case's one reading, by hand: the highest high of the 20 days before today
    hi = U.udaily_rules("udaily-12")["the highest high of the 20 days before today"][0][1]
    assert hi[i] == max(IR.DH[d - 20:d])


def test_the_request_left_out_could_not_tell_anything_apart():
    """An eleventh request of the same rounds is NOT an acceptance case, and this is why: on a 5 minute chart its
    condition is true on no bar, so any formula that is never true would equal it."""
    atr = dict(IR.day_atr_readings(14))
    for name, a in atr.items():
        assert sum(1 for i in range(N) if ok(a[i]) and (IR.C[i] - IR.L[i]) > 0.6 * a[i]) == 0, name
    assert all("60 percent" not in c["words"] for c in PENDING)
    # its words are KEPT, unchanged, marked for the day the fixture can hold it by value
    assert [c["id"] for c in HELD] == ["udaily-11"] and "becomes" not in HELD[0] and "answer" not in HELD[0]
    said = BY_ID["g11"]["words"]
    assert HELD[0]["words"] == "On a 5 minute chart, " + said[0].lower() + said[1:]
    assert "true on NO bar" in HELD[0]["held"] and "Re-admit if the fixture gains a session where it can be true" in HELD[0]["held"]
    assert U.udaily_rules("udaily-11") is None and len(HELD[0]["wall"]["offers"]) == 2
