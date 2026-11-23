"""THE ACCEPTANCE CASES OF "A DAILY MEASURE ON A CHART BELOW A DAY".

Ten requests the value cases already hold on a daily chart, asked on a 5 MINUTE chart. Each gives a length in days
and cannot be built whole on daily bars: four compare each bar of the chart with the daily measure, six read another
symbol. They wait in the fixture's `pending` with their words and their rules and NO answer:

  * TODAY each is a wall: the right answer builds nothing, says plainly why, and offers what can be drawn (the daily
    measure as a line on daily bars where the words have one; the same idea on this chart's bars, named for what they
    span). The live re-check of the day-length guard records the answers.
  * `becomes` says what each must be the day a daily read below a day can be built: a FORMULA case, held BY VALUE on
    every 5 minute bar to `udaily_rules`. That set is the engine unit's done-line.

Written before that engine exists and before any answer does, so the rules cannot learn from either. What is held
here: every rule can tell a right answer from a wrong one, and from THE stand-in: the same request's own daily-chart
answer (N bars of the chart) is wrong on the 5 minute chart for every one of the ten.
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
PENDING = [c for c in DATA["pending"] if c["id"].startswith("udaily-") and "becomes" in c]
#: the request of the same rounds that is kept, words unchanged, and is NOT an acceptance case yet
HELD = [c for c in DATA["pending"] if c["id"].startswith("udaily-") and "held" in c]
#: the daily-chart case each one is the 5 minute twin of
TWIN = {"udaily-01": "d26", "udaily-02": "f01", "udaily-03": "f19", "udaily-04": "g04", "udaily-05": "g14",
        "udaily-06": "k03", "udaily-07": "k05", "udaily-08": "k06", "udaily-09": "s03", "udaily-10": "s04"}
N = len(IR.B)


def ok(v):
    return v is not None and not (isinstance(v, float) and math.isnan(v))


# ── the cases ──

def test_ten_acceptance_cases_wait_with_words_and_rules_and_no_answer():
    assert tuple(c["id"] for c in PENDING) == U.IDS == tuple(TWIN) and len(PENDING) == 10
    for case in PENDING:
        twin = BY_ID[TWIN[case["id"]]]
        said = twin["words"]
        assert case["words"] == "On a 5 minute chart, " + said[0].lower() + said[1:], case["id"]            # the same request, on a 5 minute chart
        assert case["lane"] == "wall" and case["chart"] == "intraday" and "answer" not in case and "recorded" not in case
        assert twin["lane"] == "formula" and twin.get("recorded_verdict") != "wrong"                         # built RIGHT on a daily chart today
        # the door sees what the case is about: a chart below a day and a length in days
        assert dc.below_a_day(case["words"], {"tf": "D"}) and dc.day_lengths(case["words"]), case["id"]
        assert case["wall"]["names"] == ["daily measure", f"{dc.day_lengths(case['words'])[0]} day"]


def test_what_each_becomes_is_a_formula_case_with_its_rule_fingerprinted_now():
    for case in PENDING:
        becomes = case["becomes"]
        assert becomes["lane"] == "formula" and "U-DAILY" in becomes["when"]
        digest = G.rule_digest(case["id"])
        assert digest and becomes["rule"]["digest"] == digest == becomes["rule"]["history"][-1]["digest"], case["id"]
        assert becomes["rule"]["history"][0]["reason"] == "written from the request's words before the answer was read"


# ── today's rule: a refusal by name, with what can be drawn ──

@pytest.mark.parametrize("case", PENDING, ids=[c["id"] for c in PENDING])
def test_the_wall_rule_of_each_can_pass_and_can_fail_before_any_answer_exists(case):
    days = dc.day_lengths(case["words"])[0]
    span = dc.span_on_this_chart(days, 5)
    offers = case["wall"]["offers"]
    has_a_line = any("daily bars" in o["words"] for o in offers)
    assert len(offers) == (2 if has_a_line else 1) and any("five-minute bars" in o["words"] for o in offers)
    reads_spy = "SPY" in case["words"]
    assert has_a_line != reads_spy, case["id"]                    # another symbol takes no calculation timeframe: no line to offer
    choices = ([f"The {days} day measure as a line, on daily bars"] if has_a_line else []) + \
        [f"The same idea with {span.split(',')[0]} ({span.split(', ')[1]})"] + ([] if has_a_line else ["Nothing for now: on a daily chart this builds exactly as asked"])
    asked = {"disposition": "clarify", "reply": "", "questions": [{"text": f"I can't yet build a daily measure like the {days} day one on a 5 minute chart. Which would you like?", "choices": choices}]}
    assert G.grade_wall(case, asked)["verdict"] == "right", G.grade_wall(case, asked)["lines"]
    # the door's own guard passes the same question (its bars choice carries the door's span and never calls it N day)
    envelope = {"disposition": "clarify", "ops": [], "questions": asked["questions"]}
    try:
        dc.check_day_lengths(envelope, case["words"], {"sym": "NVDA", "tf": "5"})
    except dc._Refused as exc:                                    # noqa: SLF001
        raise AssertionError(exc.detail)
    # it fails without the bars offer, with a vague sentence, and when something is built
    assert G.grade_wall(case, {**asked, "questions": [{**asked["questions"][0], "choices": ["Never mind", "Later"]}]})["verdict"] == "wrong"
    assert G.grade_wall(case, {**asked, "questions": [{**asked["questions"][0], "text": "Which would you like?"}]})["verdict"] == "wrong"
    built = BY_ID[TWIN[case["id"]]]["answer"]
    assert G.grade_wall(case, {"disposition": "change", "reply": "a daily measure", "ops": built["ops"]})["verdict"] == "wrong"


# ── tomorrow's rule: by value, on every 5 minute bar ──

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


@pytest.mark.parametrize("cid", U.IDS)
def test_THE_STAND_IN_is_wrong_for_every_one(cid):
    """The same request's own DAILY-chart answer (right there) takes its days as bars. On the 5 minute chart that is
    N bars of the chart, which is exactly what the day-length guard refuses today. Under the acceptance rule it must
    be WRONG: if it were right, the rule could not tell a daily measure from a 5 minute one."""
    stand_in = BY_ID[TWIN[cid]]["answer"]
    got = G.grade(cid, stand_in, "intraday")
    assert got["verdict"] == "wrong", (cid, got["lines"])
    # and it is the day-length guard's own finding
    words = next(c["words"] for c in PENDING if c["id"] == cid)
    try:
        dc.check_day_lengths({**stand_in, "disposition": "change"}, words, {"sym": "NVDA", "tf": "5"})
        refused = False
    except dc._Refused:                                           # noqa: SLF001
        refused = True
    assert refused, cid


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


def test_the_request_left_out_could_not_tell_anything_apart():
    """An eleventh request of the same rounds is NOT an acceptance case, and this is why: on a 5 minute chart its
    condition is true on no bar, so any formula that is never true would equal it."""
    atr = dict(IR.day_atr_readings(14))
    for name, a in atr.items():
        assert sum(1 for i in range(N) if ok(a[i]) and (IR.C[i] - IR.L[i]) > 0.6 * a[i]) == 0, name
    assert all("60 percent" not in c["words"] for c in PENDING)
    # its words are KEPT, unchanged, as a wall with offers today, marked for the day the fixture can hold it by value
    assert [c["id"] for c in HELD] == ["udaily-11"] and "becomes" not in HELD[0] and "answer" not in HELD[0]
    said = BY_ID["g11"]["words"]
    assert HELD[0]["words"] == "On a 5 minute chart, " + said[0].lower() + said[1:]
    assert "true on NO bar" in HELD[0]["held"] and "Re-admit if the fixture gains a session where it can be true" in HELD[0]["held"]
    assert U.udaily_rules("udaily-11") is None and len(HELD[0]["wall"]["offers"]) == 2
