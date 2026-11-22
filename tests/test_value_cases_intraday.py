"""THE VALUE CASES ON A 5 MINUTE CHART.

A request that says "on a 5 minute chart, today's low so far plus the 14 day ATR" could not be held by value: the
only built market was daily, where "today's low so far" is just the bar's low. So three answers of a live round were
judged by eye. This is the chart they are held on, and the three verdicts:

  * the built 5 minute chart (`market.INTRADAY`): regular sessions, 78 bars a day, with the DAILY bars of the same
    symbol beside it (longer than the 5 minute window, and over the window each daily bar IS its session);
  * a case names its chart (`chart: "intraday"`); its formulas are computed there by the server's own interpreter;
  * an answer that sets a CALCULATION TIMEFRAME ("the whole indicator runs on daily bars") is computed on that
    timeframe's bars and placed on the 5 minute bars by the PRODUCT'S OWN projection
    (`mtfProjection.projectFrameColumns`, called in node). Which daily value a 5 minute bar shows is the product's
    rule; nothing here restates it;
  * the rules (`intraday_rules.py`) are plain loops from the words, with both honest readings of a daily measure on
    an intraday chart (of the days finished before today; as it stands with today so far).

The three: `intraday-03` (yesterday's close plus and minus the 20 day average range, built on daily bars) is RIGHT on
every bar; `intraday-01` (a number stood in for the ATR) and `intraday-02` (the ATR of fourteen 5 MINUTE bars where
the words ask for 14 DAYS, disclosed) are recorded WRONG.
"""
from __future__ import annotations

import copy
import datetime as dt
import json
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from tools.value_cases import grade as G
from tools.value_cases import intraday_rules as IR
from tools.value_cases import market

ROOT = Path(__file__).resolve().parents[1]
CASES = json.loads((ROOT / "tests" / "fixtures" / "authoring" / "value_cases.json").read_text(encoding="utf-8"))["cases"]
BY_ID = {c["id"]: c for c in CASES}
INTRADAY = [c for c in CASES if c.get("chart") == "intraday" and c["lane"] == "formula"]
NY = ZoneInfo("America/New_York")
BARS, DAILY = market.INTRADAY["bars"], market.INTRADAY["daily"]
PER_DAY = market.INTRADAY_BARS_A_DAY
FIRST = len(DAILY) - market.INTRADAY_SESSIONS

CLOSE = {"type": "series", "name": "close"}
HIGH = {"type": "series", "name": "high"}
LOW = {"type": "series", "name": "low"}


def num(v):
    return {"type": "num", "value": v}


def call(name, *args):
    return {"type": "call", "name": name, "args": list(args)}


def op(name, *args):
    return {"type": "op", "name": name, "args": list(args)}


def built(*trees, calc=None):
    ops = [{"op": "create", "name": "x", "placement": "price", "outputs": [{"key": f"o{k}", "tree": t} for k, t in enumerate(trees)]}]
    if calc:
        ops.append({"op": "set_calculation_timeframe", "timeframe": calc})
    return {"ops": ops}


def _grade(case_id, answer):
    from tools.converse_eval import LaneUnavailable
    try:
        return G.grade(case_id, answer, "intraday")
    except LaneUnavailable as exc:
        pytest.skip(f"the projection is not available here: {str(exc)[:200]}")


def _same(a, b):
    return a is not None and b is not None and abs(a - b) <= 1e-9 * max(1.0, abs(b))


# ── the chart ──

def test_the_5_minute_chart_is_regular_sessions_of_78_bars_ending_on_the_markets_last_day():
    assert len(BARS) == market.INTRADAY_SESSIONS * PER_DAY and len(market.INTRADAY["days"]) == market.INTRADAY_SESSIONS
    assert market.INTRADAY["days"][-1] == market.LAST_DAY.isoformat() == DAILY[-1]["t"]
    for d, day in enumerate(market.INTRADAY["days"]):
        stamps = [dt.datetime.fromtimestamp(b["t"], NY) for b in BARS[d * PER_DAY:(d + 1) * PER_DAY]]
        assert all(s.date().isoformat() == day for s in stamps) and stamps[0].weekday() < 5, day
        assert (stamps[0].hour, stamps[0].minute) == (9, 30) and (stamps[-1].hour, stamps[-1].minute) == (15, 55), day
        assert all((b - a).total_seconds() == 300 for a, b in zip(stamps, stamps[1:])), day
    assert all(b["l"] <= min(b["o"], b["c"]) and b["h"] >= max(b["o"], b["c"]) and b["v"] > 0 for b in BARS)
    # the window crosses a clock change (the stamps are New York's, not a fixed offset)
    assert len({b["t"] % 86400 for b in BARS[::PER_DAY]}) == 2


def test_a_daily_bar_of_the_window_IS_its_session_and_the_days_before_it_are_there():
    assert FIRST >= 250                                                    # a 20 day average on the first 5 minute bar has its days
    for d in range(market.INTRADAY_SESSIONS):
        session, day = BARS[d * PER_DAY:(d + 1) * PER_DAY], DAILY[FIRST + d]
        assert day == {"t": market.INTRADAY["days"][d], "o": session[0]["o"], "h": max(b["h"] for b in session), "l": min(b["l"] for b in session),
                       "c": session[-1]["c"], "v": float(sum(b["v"] for b in session))}
    assert [d["t"] for d in DAILY] == sorted({d["t"] for d in DAILY}) and all(dt.date.fromisoformat(d["t"]).weekday() < 5 for d in DAILY)
    for sym, chart in market.INTRADAY_OTHER.items():                       # every other symbol is on the same stamps and days
        assert [b["t"] for b in chart["bars"]] == [b["t"] for b in BARS] and [d["t"] for d in chart["daily"]] == [d["t"] for d in DAILY], sym


def test_the_chart_TIES_so_at_or_above_is_told_from_above():
    assert sum(1 for a, b in zip(BARS, BARS[1:]) if b["c"] == a["c"]) > 100
    assert sum(1 for b in BARS if b["c"] == b["o"]) > 100
    lows = IR.LOW_SO_FAR
    assert sum(1 for i in range(1, len(BARS)) if i % PER_DAY and BARS[i]["l"] == lows[i - 1]) > 20       # a bar that only TOUCHES the day's low


def test_the_built_daily_market_is_untouched():
    assert len(market.STOCK) == market.BAR_COUNT == 1700 and market.STOCK[-1]["t"] == "2026-11-20" and market.STOCK[0]["o"] == 41.91


# ── the product's own readings on it ──

def test_the_session_low_the_interpreter_reads_is_todays_low_so_far_by_hand():
    got, err = G.evaluate(call("sessionLow"), {}, "intraday")
    assert err is None and len(got) == len(BARS)
    assert all(_same(g, w) for g, w in zip(got, IR.LOW_SO_FAR))
    high, err = G.evaluate(call("sessionHigh"), {}, "intraday")
    assert err is None and all(_same(g, w) for g, w in zip(high, IR.HIGH_SO_FAR))
    # the day's first bar starts it again
    assert all(IR.LOW_SO_FAR[i] == BARS[i]["l"] for i in range(0, len(BARS), PER_DAY))


def test_a_daily_calculation_is_placed_by_the_PRODUCTS_projection_and_shows_the_day_before():
    from tools.converse_eval import LaneUnavailable
    try:
        got, err = G.evaluate(CLOSE, {}, "intraday", "D")
    except LaneUnavailable as exc:
        pytest.skip(f"the projection is not available here: {str(exc)[:200]}")
    assert err is None and len(got) == len(BARS)
    # every 5 minute bar of a day shows the close of the day BEFORE (never its own day's final close)
    assert all(_same(got[i], DAILY[FIRST + i // PER_DAY - 1]["c"]) for i in range(len(BARS)))
    assert got == IR.YESTERDAYS_CLOSE
    todays = [DAILY[FIRST + i // PER_DAY]["c"] for i in range(len(BARS))]
    assert sum(1 for g, t in zip(got, todays) if not _same(g, t)) > len(BARS) * 0.9                    # CONTROL: the two differ nearly everywhere
    # on the chart's own timeframe a "calculation timeframe" changes nothing; one that is not served is refused, never guessed
    assert G.evaluate(CLOSE, {}, "intraday", "5") == G.evaluate(CLOSE, {}, "intraday")
    assert G.evaluate(CLOSE, {}, "daily", "D") == G.evaluate(CLOSE, {}, "daily")
    col, err = G.evaluate(CLOSE, {}, "intraday", "W")
    assert col is None and "is not graded here" in err


def test_the_daily_ATR_by_hand_is_the_products_daily_ATR():
    """The rule's own ATR (three ways of starting it) against the interpreter's, both on the daily bars: one of them IS it."""
    got, err = G.evaluate(call("atr", HIGH, LOW, CLOSE, num(14)), {}, "intraday", "D")
    if err and "LaneUnavailable" in err:
        pytest.skip(err)
    assert err is None
    finished = [(name, col) for name, col in IR.day_atr_readings(14) if name.startswith("the 14 days finished before today")]
    assert len(finished) == 3
    differ = {name.split("ATR by ")[1]: sum(1 for g, w in zip(got, col) if not _same(g, w)) for name, col in finished}
    # Wilder's smoothing is the product's, whichever way it is started (250 days on, the two starts are one number);
    # a plain average of the 14 true ranges is a different ATR on every bar, so the comparison can tell them apart
    assert differ["rma"] == 0 and differ["wilder"] == 0 and differ["sma"] == len(BARS), differ


# ── the three cases ──

def test_the_fixture_holds_the_three_cases_of_the_5_minute_chart():
    # (`intraday-02`, the disclosed stand-in, is a WALL case since the day-length guard: the right answer asks, by name)
    assert [c["id"] for c in INTRADAY] == ["intraday-01", "intraday-03"] and BY_ID["intraday-02"]["lane"] == "wall"
    assert all("5 minute chart" in c["words"] for c in INTRADAY)
    assert [c.get("recorded_verdict", "right") for c in INTRADAY] == ["wrong", "right"]
    assert "STAND-IN WAS BUILT" in BY_ID["intraday-02"]["defect"] and "5 MINUTE bars" in BY_ID["intraday-02"]["defect"]
    # its by-value rule stays (it is what the request must equal the day a daily read below a day can be built)
    assert G.grade("intraday-02", {"ops": BY_ID["intraday-02"]["answer"]["ops"]}, "intraday")["verdict"] == "wrong"
    # the rule of intraday-01 moved from the daily stand-in to the chart the words name, and says so
    moved = BY_ID["intraday-01"]["rule"]["history"][-1]
    assert moved["quote"] == "On a 5 minute chart" and moved["digest"] == BY_ID["intraday-01"]["rule"]["digest"] == G.rule_digest("intraday-01")
    for case in INTRADAY:
        assert G.rule_digest(case["id"]) == case["rule"]["digest"], case["id"]


@pytest.mark.parametrize("case", INTRADAY, ids=[c["id"] for c in INTRADAY])
def test_each_recorded_answer_is_what_its_case_says_BY_VALUE_on_every_bar(case):
    got = _grade(case["id"], case["answer"])
    assert got["verdict"] == case.get("recorded_verdict", "right"), (case["id"], got["lines"])
    if got["verdict"] == "right":
        assert all(f"on {len(BARS)} bars" in line for line in got["lines"]), got["lines"]          # EVERY 5 minute bar, not a handful


def test_what_the_right_answer_rests_on_the_calculation_timeframe():
    right = BY_ID["intraday-03"]["answer"]
    assert G.calc_timeframe_of(right) == "D" and _grade("intraday-03", right)["verdict"] == "right"
    # the SAME formulas on the 5 minute bars themselves (no calculation timeframe) are this bar's close and a 5 minute range
    on_the_chart = {"ops": [o for o in copy.deepcopy(right["ops"]) if o.get("op") != "set_calculation_timeframe"]}
    assert G.calc_timeframe_of(on_the_chart) is None and _grade("intraday-03", on_the_chart)["verdict"] == "wrong"
    # one day further back (the close of the day before yesterday) is wrong on every bar
    rng = call("sma", op("-", HIGH, LOW), num(20))
    back = {"type": "offset", "value": 1, "args": [CLOSE]}
    got = _grade("intraday-03", built(op("+", back, rng), op("-", back, rng), calc="D"))
    assert got["verdict"] == "wrong"
    # a 19 day average is wrong; a 20 day one written out again is right (the rule can pass an answer it has not seen)
    short = call("sma", op("-", HIGH, LOW), num(19))
    assert _grade("intraday-03", built(op("+", CLOSE, short), op("-", CLOSE, short), calc="D"))["verdict"] == "wrong"
    assert _grade("intraday-03", built(op("-", CLOSE, rng), op("+", CLOSE, rng), calc="D"))["verdict"] == "right"


def test_both_honest_readings_of_a_daily_measure_are_listed_and_differ():
    for name, readings in (("ATR", IR.day_atr_readings(14)), ("range", IR.day_range_readings(20))):
        finished = [col for reading, col in readings if "finished before today" in reading]
        stands = [col for reading, col in readings if "as it stands" in reading]
        assert finished and stands, name
        # "finished before today" holds all day; "as it stands" moves inside the day
        assert all(len({col[i] for i in range(d * PER_DAY, (d + 1) * PER_DAY)}) == 1 for col in finished for d in range(0, market.INTRADAY_SESSIONS, 7)), name
        assert all(any(len({col[i] for i in range(d * PER_DAY, (d + 1) * PER_DAY)}) > 1 for d in range(market.INTRADAY_SESSIONS)) for col in stands), name


def test_CONTROL_the_three_requests_cannot_take_each_others_answers():
    for case in INTRADAY:
        for other in INTRADAY:
            if other["id"] != case["id"]:
                assert _grade(case["id"], other["answer"])["verdict"] == "wrong", (case["id"], other["id"])


def test_an_answer_with_a_calculation_timeframe_nobody_grades_is_never_right():
    got = _grade("intraday-03", built(CLOSE, CLOSE, calc="W"))
    assert got["verdict"] == "wrong" and any("is not graded here" in line for line in got["lines"])


def test_with_no_engine_to_place_a_daily_calculation_NOTHING_is_graded(monkeypatch):
    """No node here is "not graded", never a verdict: a wrong answer must not read right, nor a right one wrong."""
    from tools.converse_eval import LaneUnavailable
    from tools.value_cases import frame_projection

    def gone(_jobs):
        raise LaneUnavailable("node is not here")
    monkeypatch.setattr(frame_projection, "project", gone)
    with pytest.raises(LaneUnavailable):
        G.evaluate(CLOSE, {}, "intraday", "D")
    with pytest.raises(LaneUnavailable):
        G.grade("intraday-03", BY_ID["intraday-03"]["answer"], "intraday")
    # a formula on the chart's own bars needs no projection and is graded as ever
    assert G.grade("intraday-01", BY_ID["intraday-01"]["answer"], "intraday")["verdict"] == "wrong"


# ── the script case of the 5 minute chart ──

TABLE = BY_ID["intraday-04"]


def _script_grades(variants):
    from tools.converse_eval import LaneUnavailable
    from tools.value_cases import script_grade
    cases = [{**TABLE, "id": TABLE["id"]} for _ in variants]
    out = {}
    try:
        for name, source in variants.items():
            out[name] = script_grade.grade_all([TABLE], {TABLE["id"]: {"turn": "script", "script": {"pine": source}}})[TABLE["id"]]
    except LaneUnavailable as exc:
        pytest.skip(f"the script lane is not available here: {str(exc)[:200]}")
    assert len(cases) == len(variants)
    return out


def test_the_table_of_todays_low_and_the_dollars_at_risk_is_held_on_the_script_lanes_5_minute_chart():
    assert TABLE["lane"] == "script" and TABLE["chart"] == "intraday" and "5 minute chart" in TABLE["words"]
    recorded = TABLE["answer"]["script"]["pine"]
    assert "if newDay\n    dayLow := low" in recorded and "input.int(100" in recorded
    got = _script_grades({
        "recorded": recorded,
        # the low never starts again with a new day: the lowest low of the whole chart
        "never a new day": recorded.replace("if newDay\n    dayLow := low", "if false\n    dayLow := low"),
        "200 shares": recorded.replace("input.int(100", "input.int(200"),
        # the distance from the latest price to today's HIGH
        "to the high": recorded.replace("dayLow := low", "dayLow := high").replace("math.min(dayLow, low)", "math.max(dayLow, high)"),
    })
    assert got["recorded"]["verdict"] == "right", got["recorded"]["lines"]
    assert sum(1 for line in got["recorded"]["lines"] if line.lstrip().startswith("RIGHT")) == 2
    for name in ("never a new day", "200 shares", "to the high"):
        assert got[name]["verdict"] == "wrong", (name, got[name]["lines"])


# -- found by this file's own deliberate breaks: two things nothing held --

def test_an_answers_LAST_word_on_its_calculation_timeframe_is_the_one_graded():
    right = BY_ID["intraday-03"]["answer"]
    trees = [o["tree"] for o in right["ops"][0]["outputs"]]
    weekly_then_daily = built(*trees, calc="W")
    weekly_then_daily["ops"].append({"op": "set_calculation_timeframe", "timeframe": "D"})
    assert G.calc_timeframe_of(weekly_then_daily) == "D" and _grade("intraday-03", weekly_then_daily)["verdict"] == "right"
    # and the other way round: it ends on a timeframe nobody grades here, so it is not right
    daily_then_weekly = built(*trees, calc="D")
    daily_then_weekly["ops"].append({"op": "set_calculation_timeframe", "timeframe": "W"})
    assert G.calc_timeframe_of(daily_then_weekly) == "W" and _grade("intraday-03", daily_then_weekly)["verdict"] == "wrong"


def test_a_case_is_graded_on_the_chart_IT_names():
    """Through `grade_case`, the way the record and a live run are graded: the chart comes from the case."""
    from tools.converse_eval import LaneUnavailable
    case = BY_ID["intraday-03"]
    try:
        assert G.grade_case(case)["verdict"] == "right"
        # the SAME case and answer held on the daily chart is not right: its rule is the 5 minute chart's
        assert G.grade_case({k: v for k, v in case.items() if k != "chart"})["verdict"] == "wrong"
    except LaneUnavailable as exc:
        pytest.skip(f"the projection is not available here: {str(exc)[:200]}")
    assert case["chart"] == "intraday" and G.grade_case(BY_ID["intraday-01"])["verdict"] == "wrong"


# -- found by the first full live run, as a member: where a refusal's words are --

def test_a_refusal_by_a_gate_is_read_where_the_member_reads_it():
    """When the SCRIPT door declines, the response has no `reply`: the member's sentence is the gate's `reason`
    (`ok` false). The runner read only `reply` and called three named refusals "names nothing". Every wall run
    before it was as an admin, on the formula door, which always carries a reply."""
    from tools import value_eval
    declined = {"ok": False, "gate": "script:unsupported", "disposition": "unsupported",
                "reason": "A chart script can't send text messages: that is done by your platform's alert delivery."}
    answer = value_eval.answer_of(declined)
    assert answer == {"disposition": "unsupported", "reply": declined["reason"]}
    wall = {"id": "w", "lane": "wall", "wall": {"names": ["text message"]}}
    assert G.grade_wall(wall, answer)["verdict"] == "right"
    # a reply, where there is one, is what is read; and the `reason` of a turn that did NOT refuse is never a reply
    assert value_eval.answer_of({**declined, "reply": "No options data here."})["reply"] == "No options data here."
    assert value_eval.answer_of({"ok": True, "disposition": "change", "reason": "an internal note", "envelope": {"ops": []}})["reply"] == ""
    assert G.grade_wall(wall, value_eval.answer_of({"ok": False, "disposition": "unsupported", "reason": "I can't build that here."}))["verdict"] == "wrong"
