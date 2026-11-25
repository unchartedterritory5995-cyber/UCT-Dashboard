"""ROUND 17: NINE REQUESTS WHOSE HONEST SCRIPT NEEDS A CAPABILITY NO VALUE CASE HOLDS, WORDS AND RULE FIRST.

The script assistant is told it may use 29 capabilities (`pine_authoring.CAPABILITY_WORDS`). The recorded script cases
use 13 of them; sixteen have a wording and nothing anywhere showing that a script written with them comes out right
(the fixture's `capabilities_without_a_case`, a list that may only shrink). These nine requests are things a trader
would ask in plain words whose honest answer needs an array, a loop over one, a `while`, a `switch`, a drawing
deleted or read back, or `barstate`.

RULES FIRST. Each case is PENDING: its words and its rule are written, by hand from the words, before any answer
exists, so no rule can learn from the door. The next live pass records the answers; a capability leaves the list
only when a RECORDED answer, held by value, really uses it (asked of the one detector), never because a request here
was meant to need it.

Held here, with no paid call:
  * each rule equals an independent second calculation of the same words (written a different way), on every bar;
  * each rule can tell answers apart: the right answer passes and named wrong ones fail, through the grader itself;
  * a bar where the words say "nothing" must hold nothing (the EXACT column mode), with its control;
  * what each case says its rule distinguishes on the script lane's own bars is true, and its fingerprint is the
    rule's (those two need node: where it is missing they SKIP, and the lane that runs this file treats a skip as a
    failure);
  * the cases are pending: no answer, no record, and none of them counts toward any threshold.

THE LIVE PASS (2026-11-23) answered all nine. Eight were RECORDED and one waited; all nine are recorded now:
  * four came back as scripts, right by value, and are script cases (cap-04, cap-05, cap-06, cap-08). cap-04 and
    cap-05 each name an EDGE: on the plain bars a window one bar longer draws the very same lines;
  * four the door answered WITHOUT a script (cap-02, cap-03, cap-07, cap-09). They are formula cases now, held by
    the SAME rule (`rules.SAME_RULE_AS_THE_SCRIPT_LANE`: the script lane's own function on the formula lane's bars).
    Three are right. cap-03 is recorded WRONG with its findings named, and the formula that says its words is here;
  * the formula lane now holds NOTHING where the words ask for nothing ("only while ..., and nothing on the other
    bars"): until this pass it compared only the bars both sides had a value on;
  * cap-01 waited: the formula lane built a different thing and said so, which is not a build. After #2597 (the
    look-back fact where the first attempt reads it) the member account asked it six times on 2026-11-24: six
    scripts, each RIGHT on every bar. It is a script case now, and its record says what made it right.
"""
from __future__ import annotations

import copy
import json
import re
from pathlib import Path

import pytest

from tools.value_cases import grade as G
from tools.value_cases import rules as formula_rules
from tools.value_cases import script_rules as R
from tools.value_cases.market import STOCK

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "tests" / "fixtures" / "authoring" / "value_cases.json").read_text(encoding="utf-8"))
PENDING = {c["id"]: c for c in DATA.get("pending") or [] if c["id"].startswith("cap-")}
#: the cases of this round that hold a live answer (2026-11-23, cap-01 2026-11-24)
RECORDED = {c["id"]: c for c in DATA["cases"] if c["id"].startswith("cap-")}
EVERY = {**PENDING, **RECORDED}
IDS = [f"cap-0{n}" for n in range(1, 10)]
CHART = {"bars": STOCK}
COLUMN_RULES = ("cap-01", "cap-02", "cap-03", "cap-07", "cap-09")
DRAWN_RULES = ("cap-04", "cap-05", "cap-06", "cap-08")
ON_THE_FORMULA_LANE = ("cap-02", "cap-03", "cap-07", "cap-09")     # the door answers these without a script (live 2026-11-23)
MOVED = "moved to the formula lane 2026-11-23"
#: ⭐ 2026-11-25: cap-03 is answered with a SCRIPT again (#2713, then #2726) and recorded RIGHT there, on its plain bars
#: and on a high tie (6 of 6). The formula lane still holds the same rule (`rules.SAME_RULE_AS_THE_SCRIPT_LANE`), and
#: its formula answers are kept as specimens in `found`, each with what fixed it.
BACK_ON_THE_SCRIPT_LANE = ("cap-03",)
MOVED_BACK = "moved back to the script lane 2026-11-25"
KEY_WORDS = {
    "cap-01": "the most recent close above today's close was, looking back at most 250 bars, and plot nothing when there is none",
    "cap-02": "SMA, EMA or WMA, with SMA as the default and a length of 20",
    "cap-03": "the average of the last 5 swing highs as a line, where a swing high is a bar whose high is above the highs of the 3 bars before it and the 3 bars after it",
    "cap-04": "each of the last 3 swing lows",
    "cap-05": "from the lowest low of the last 60 bars to the latest close",
    "cap-06": "one label on the latest bar only",
    "cap-07": "only while the close is above the 50 day simple moving average, and nothing on the other bars",
    "cap-08": "until a later bar's low drops below the top of the box, then end the box at that bar. Keep the 10 newest boxes",
    "cap-09": "the last 10 up days, where an up day closes above the prior close, skipping the down days in between",
}


def bound():
    R.bind(CHART)
    return R


def close(a, b):
    return a is not None and b is not None and abs(a - b) <= 1e-9 * max(1.0, abs(b))


def same(col, other):
    return len(col) == len(other) and all((x is None and y is None) or close(x, y) for x, y in zip(col, other))


def graded(cid, *, columns=None, labels=(), lines=(), boxes=(), source="plot(x)"):
    run = {"ok": True, "errors": None, "columns": columns or {}, "drawn": {"tables": [], "labels": list(labels), "lines": list(lines), "boxes": list(boxes), "via": "test"}}
    got = R.grade_script(cid, source, run, CHART)
    return got["verdict"], got["lines"]


# ── the cases ──

def lane_of(cid):
    return "formula" if cid in ON_THE_FORMULA_LANE and cid not in BACK_ON_THE_SCRIPT_LANE else "script"


def formula_answer_of(cid):
    """The formula answer a case holds: its record on the formula lane, or (cap-03) its newest formula specimen."""
    return EVERY[cid]["answer"] if lane_of(cid) == "formula" else EVERY[cid]["found"][-1]["answer"]


def test_nine_cases_each_with_its_words_its_rule_and_where_it_stands():
    assert sorted(EVERY) == IDS and not set(PENDING) & set(RECORDED)
    assert sorted(PENDING) == []                         # cap-01 was the last: adopted on the member record, 2026-11-24
    assert tuple(formula_rules.SAME_RULE_AS_THE_SCRIPT_LANE) == ON_THE_FORMULA_LANE
    for cid, case in EVERY.items():
        formula = lane_of(cid) == "formula"
        assert case["lane"] == ("formula" if formula else "script") and case.get("chart", "daily") == "daily", cid
        history = case["rule"]["history"]
        assert history[0]["reason"] == "written from the request's words before the answer was read", cid
        assert history[-1]["digest"] == case["rule"]["digest"], cid
        if cid in PENDING:
            assert "answer" not in case and "recorded" not in case and "recorded_verdict" not in case
            assert len(case["found_live"]) > 60                       # what the live pass found is written beside it
        else:
            assert case["recorded"]["front"] and "found_live" not in case, cid      # the record says it now
            assert (case["answer"].get("ops") if formula else case["answer"]["script"]["pine"]), cid
        if formula:
            # ONE rule whichever lane answers: the case says why it moved, in the member's own words
            assert len(history) == 2 and history[1]["reason"].startswith(MOVED) and history[1]["quote"] in case["words"], cid
            assert history[0]["digest"] != history[1]["digest"], cid   # the same rule on other bars says other numbers
        elif cid in BACK_ON_THE_SCRIPT_LANE:
            # there and back: the last entry returns to the fingerprint it was written with, in the member's words
            assert len(history) == 3 and history[1]["reason"].startswith(MOVED) and history[2]["reason"].startswith(MOVED_BACK), cid
            assert history[2]["digest"] == history[0]["digest"] != history[1]["digest"] and history[2]["quote"] in case["words"], cid
        else:
            assert len(history) == 1, cid
        assert case["needs"] and case["distinguishes"] and R.has_rule(cid)
    assert {cid for cid, case in RECORDED.items() if case.get("recorded_verdict") == "wrong"} == set()
    # cap-03's record is RIGHT on the script lane (2026-11-25, after #2726), and BOTH of its formula answers are kept as
    # specimens, each with what fixed it: the first pass (#2573), then the one recorded 2026-11-23, whose findings stand
    first_pass, formula_record = RECORDED["cap-03"]["found"]
    assert formula_record["fixed_by"] == {"pr": "#2726", "merge": "6aa2a5a6611c5350ccebc2e0c25dc22ad4490fe5"}
    for finding in ("on the swing bar itself", "EQUALS a high in the 3 bars before it", "read-back", "739 of 1,643 bars differ",
                    "all three live samples"):
        assert finding in formula_record["defect"], finding
    assert RECORDED["cap-03"]["answer"]["turn"] == "script" and "pivothigh" not in RECORDED["cap-03"]["answer"]["script"]["pine"]
    assert first_pass["fixed_by"] == {"pr": "#2573", "merge": "e161dd870304e6e30e01169c7f50affc6fa49dd6"}
    for finding in ("occurrence 0 is the newest", "1,261 of 1,639 bars differed"):
        assert finding in first_pass["defect"], finding
    assert first_pass["answer"] != formula_record["answer"] and first_pass["recorded"]["front"] != formula_record["recorded"]["front"]
    # cap-01 is recorded RIGHT, and says what made it right (the ASSISTANT side: #2597, not an engine fix) and what
    # it rests on (the member account, six of six); what the passes before it found is kept beside it
    cap01 = RECORDED["cap-01"]
    assert cap01["lane"] == "script" and "recorded_verdict" not in cap01 and "defect" not in cap01 and "found" not in cap01
    assert cap01["recorded"]["front"] == "6d50f4662b" and cap01["recorded"]["on"] == "2026-11-24"
    for said in ("MEMBER record", "role member", "6 of 6 RIGHT", "0 of 2,000 bars", "#2597",
                 "0e7aeb43f46f8ccd790fc4626cccf62bbd73a601", "ASSISTANT side", "DISCLOSED STAND-IN", "NOT disclosed"):
        assert said in cap01["provenance"], said
    assert "engine_fixed" not in json.dumps(cap01)
    assert RECORDED["cap-04"]["edge"] == {"back": 3, "low": True} and RECORDED["cap-05"]["edge"] == {"back": 60, "low": True}
    assert set(COLUMN_RULES) | set(DRAWN_RULES) == set(IDS)
    assert [R.RULES[cid] for cid in COLUMN_RULES] == [R.rule_cap01, R.rule_cap02, R.rule_cap03, R.rule_cap07, R.rule_cap09]
    assert all(R.drawn_rules_known(cid) for cid in DRAWN_RULES) and not any(cid in R.RULES for cid in DRAWN_RULES)
    # the member's words, each by the part its rule rests on
    for cid, part in KEY_WORDS.items():
        assert part in EVERY[cid]["words"], cid


def test_a_pending_case_is_in_no_lane_count_and_no_threshold():
    counted = {c["id"] for c in DATA["cases"]}
    assert counted & set(IDS) == set(RECORDED) and not counted & set(PENDING)
    # the capability list is untouched by words alone: it shrinks only when a RECORDED answer uses the capability
    without = DATA["capabilities_without_a_case"]
    assert "while" in without and "switch" in without                 # asked for, and no recorded script uses them yet
    for cap in ("collections:array", "typed-array", "obj:collection", "obj:delete"):
        assert cap not in without, cap                                # held since cap-08 was recorded
    from api.services import pine_capabilities
    held = set(pine_capabilities.capabilities_of(RECORDED["cap-08"]["answer"]["script"]["pine"]))
    assert {"collections:array", "typed-array", "obj:collection", "obj:delete"} <= held


# ── each rule, against a second calculation of the same words ──

def test_cap01_is_the_distance_to_the_nearest_higher_close_within_250_bars():
    r = bound()
    col = r.rule_cap01()[0][1]
    again = []
    for i in range(r.N):
        found = None
        j = i - 1
        while j >= 0 and i - j <= 250:
            if r.C[j] > r.C[i]:
                found = float(i - j)
                break
            j -= 1
        again.append(found)
    assert same(col, again)
    assert r.rule_cap01()[0][3] == "exact"                                # "plot nothing when there is none" is held
    assert col[0] is None and sum(1 for v in col if v is None) > 5 and len({v for v in col if v is not None}) > 30


def test_cap02_is_the_plain_20_bar_average_of_the_close():
    r = bound()
    col = r.rule_cap02()[0][1]
    again = [None if i < 19 else sum(r.C[i - 19:i + 1]) / 20 for i in range(r.N)]
    assert same(col, again) and col[18] is None and col[19] is not None


def _swing_bars(x, high):
    out = []
    for i in range(3, len(x) - 3):
        window = x[i - 3:i + 4]
        edge = max(window) if high else min(window)
        if x[i] == edge and window.count(edge) == 1:
            out.append(i)
    return out


def test_cap03_is_the_average_of_the_last_five_swing_highs_known_three_bars_later():
    r = bound()
    col = r.rule_cap03()[0][1]
    swings = _swing_bars(r.H, True)
    assert swings == r._swings(r.H, 3, True) and len(swings) > 50
    again = []
    for i in range(r.N):
        known = [r.H[p] for p in swings if p + 3 <= i]
        again.append(sum(known[-5:]) / 5 if len(known) >= 5 else None)
    assert same(col, again)
    fifth = swings[4] + 3
    assert col[fifth - 1] is None and col[fifth] is not None             # known exactly 3 bars after the fifth swing


def test_cap07_shows_the_fast_average_only_while_the_close_is_above_the_slow_one():
    r = bound()
    col = r.rule_cap07()[0][1]
    again = []
    for i in range(r.N):
        if i < 49:
            again.append(None)
            continue
        slow = sum(r.C[i - 49:i + 1]) / 50
        again.append(sum(r.C[i - 9:i + 1]) / 10 if r.C[i] > slow else None)
    assert same(col, again) and r.rule_cap07()[0][3] == "exact"
    assert sum(1 for v in col if v is not None) > 200 and sum(1 for v in col[49:] if v is None) > 200


def test_cap09_is_the_average_volume_of_the_last_ten_up_days():
    r = bound()
    col = r.rule_cap09()[0][1]
    again = []
    for i in range(r.N):
        ups = [r.V[k] for k in range(1, i + 1) if r.C[k] > r.C[k - 1]]
        again.append(sum(ups[-10:]) / 10 if len(ups) >= 10 else None)
    assert same(col, again)
    plain = [None if i < 9 else sum(r.V[i - 9:i + 1]) / 10 for i in range(r.N)]
    assert sum(1 for a, b in zip(col, plain) if a is not None and b is not None and not close(a, b)) > 1000


def test_cap04_is_the_last_three_swing_lows_known_by_the_newest_bar():
    r = bound()
    what, levels = r.drawn_rules("cap-04")["level_lines_exact"]
    swings = [p for p in _swing_bars(r.L, False) if p + 3 <= r.LAST]
    assert levels == [(r.T[p], r.L[p]) for p in swings[-3:]] and len(levels) == 3 and "no other line" in what


def test_cap05_runs_from_the_lowest_low_of_60_bars_to_the_close_and_says_its_rise():
    r = bound()
    rules = r.drawn_rules("cap-05")
    k = r.LAST - 59
    for i in range(r.LAST - 59, r.LAST + 1):
        if r.L[i] <= r.L[k]:                                              # the newest of a tie
            k = i
    assert rules["segments"] == [("from the lowest low of the last 60 bars to the newest close", r.T[k], r.L[k], r.T[r.LAST], r.C[r.LAST])]
    assert rules["labels_at"][0][1] == r.T[r.LAST] and close(rules["labels_at"][0][2], r.C[r.LAST] - r.L[k])


def test_cap06_is_one_label_on_the_newest_bar_with_the_percent_from_the_50_bar_average():
    r = bound()
    rules = r.drawn_rules("cap-06")
    average = sum(r.C[-50:]) / 50
    assert rules["only_labels"] == 1 and rules["labels_at"][0][1] == r.T[r.LAST]
    assert close(rules["labels_at"][0][2], (r.C[-1] - average) / average * 100)


def test_cap08_is_a_box_on_each_gap_up_until_a_later_low_drops_into_it():
    r = bound()
    rules = r.drawn_rules("cap-08")
    boxes = []
    for g in range(1, r.N):
        if r.L[g] <= r.H[g - 1]:
            continue
        end = r.LAST
        for j in range(g + 1, r.N):
            if r.L[j] < r.L[g]:
                end = j
                break
        boxes.append((r.T[g], r.T[end], r.L[g], r.H[g - 1]))
    assert len(boxes) > 10 and rules["only_boxes"] == 10
    assert [(left, right, top, bottom) for _what, left, right, top, bottom in rules["boxes_exact"]] == boxes[-10:]
    assert all(top > bottom for _l, _r, top, bottom in boxes)


# ── each rule can tell answers apart, through the grader ──

@pytest.mark.parametrize("cid", COLUMN_RULES)
def test_the_right_line_passes_and_a_line_one_bar_late_fails(cid):
    r = bound()
    col = r.RULES[cid]()[0][1]
    assert graded(cid, columns={"value": col})[0] == "right"
    late = [None] + list(col[:-1])
    assert graded(cid, columns={"value": late})[0] == "wrong"
    assert graded(cid, columns={"value": [None] * r.N})[0] == "wrong"   # a script that draws nothing


def test_NOTHING_MEANS_NOTHING_a_zero_where_the_words_say_nothing_is_wrong():
    r = bound()
    for cid in ("cap-01", "cap-07"):
        col = r.RULES[cid]()[0][1]
        zeros = [0.0 if v is None else v for v in col]
        verdict, lines = graded(cid, columns={"value": zeros})
        assert verdict == "wrong" and "bars differ" in " ".join(lines), cid
    # CONTROL: where the words ask for nothing in particular before a value exists, a value there is NOT held against
    # the answer (the average of fewer than five swing highs, of fewer than ten up days)
    for cid in ("cap-03", "cap-09"):
        col = r.RULES[cid]()[0][1]
        filled = [1.0 if v is None else v for v in col]
        assert graded(cid, columns={"value": filled})[0] == "right", cid


def test_cap01_a_look_back_with_no_limit_is_wrong_and_cap09_the_plain_average_is_wrong():
    r = bound()
    unlimited = []
    for i in range(r.N):
        k = next((k for k in range(1, i + 1) if r.C[i - k] > r.C[i]), None)
        unlimited.append(None if k is None else float(k))
    limited = r.rule_cap01()[0][1]
    if unlimited != limited:                                              # this market holds a bar the limit decides
        assert graded("cap-01", columns={"value": unlimited})[0] == "wrong"
    plain = [None if i < 9 else sum(r.V[i - 9:i + 1]) / 10 for i in range(r.N)]
    assert graded("cap-09", columns={"value": plain})[0] == "wrong"
    ema_like = [None if v is None else v * 1.0005 for v in r.rule_cap02()[0][1]]
    assert graded("cap-02", columns={"value": ema_like})[0] == "wrong"


def _level_lines(levels, last, **change):
    return [{"x1": d, "y1": v, "x2": last, "y2": v, "extend": None, **change} for d, v in levels]


def test_cap04_three_lines_at_the_three_levels_and_nothing_else():
    r = bound()
    levels = r.drawn_rules("cap-04")["level_lines_exact"][1]
    ok = _level_lines(levels, r.T[r.LAST])
    assert graded("cap-04", lines=ok, source="line.new(x)")[0] == "right"
    assert graded("cap-04", lines=[{**l, "x2": l["x1"], "extend": "right"} for l in ok], source="line.new(x)")[0] == "right"   # extended to the right instead
    older = [p for p in r._swings(r.L, 3, False) if p + 3 <= r.LAST][-4]
    four = ok + _level_lines([(r.T[older], r.L[older])], r.T[r.LAST])
    assert graded("cap-04", lines=four, source="line.new(x)")[0] == "wrong"                    # the oldest was not removed
    assert graded("cap-04", lines=ok[1:], source="line.new(x)")[0] == "wrong"                  # one missing
    assert graded("cap-04", lines=[{**ok[0], "y1": ok[0]["y1"] + 0.5, "y2": ok[0]["y2"] + 0.5}] + ok[1:], source="line.new(x)")[0] == "wrong"
    assert graded("cap-04", lines=[{**ok[0], "x1": r.T[r.LAST - 1]}] + ok[1:], source="line.new(x)")[0] == "wrong"     # not from its swing bar
    assert graded("cap-04", lines=[{**l, "x2": r.T[r.LAST - 5]} for l in ok], source="line.new(x)")[0] == "wrong"     # stops short of the right edge
    assert graded("cap-04", lines=[], source="line.new(x)")[0] == "wrong"


def test_cap05_the_line_and_its_rise():
    r = bound()
    rules = r.drawn_rules("cap-05")
    _what, x1, y1, x2, y2 = rules["segments"][0]
    line = {"x1": x1, "y1": y1, "x2": x2, "y2": y2, "extend": None}
    rise = rules["labels_at"][0][2]
    label = {"x": x2, "text": f"+${rise:.2f}"}
    assert graded("cap-05", lines=[line], labels=[label], source="line.new(x)")[0] == "right"
    assert graded("cap-05", lines=[line], labels=[{"x": x2, "text": f"{y2:.2f}"}], source="line.new(x)")[0] == "wrong"      # the close, not the rise
    assert graded("cap-05", lines=[line], labels=[], source="line.new(x)")[0] == "wrong"
    assert graded("cap-05", lines=[{**line, "y1": y1 + 1}], labels=[label], source="line.new(x)")[0] == "wrong"
    assert graded("cap-05", lines=[line], labels=[{"x": x1, "text": f"{rise:.2f}"}], source="line.new(x)")[0] == "wrong"   # at the wrong end


def test_cap06_one_label_and_only_one():
    r = bound()
    _what, when, pct = r.drawn_rules("cap-06")["labels_at"][0]
    one = {"x": when, "text": f"{pct:+.2f}%"}
    assert graded("cap-06", labels=[one], source="label.new(x)")[0] == "right"
    every_bar = [{"x": t, "text": f"{pct:+.2f}%"} for t in r.T[-20:]]
    assert graded("cap-06", labels=every_bar, source="label.new(x)")[0] == "wrong"              # a label on every bar
    assert graded("cap-06", labels=[{"x": when, "text": f"{-pct:+.2f}%"}], source="label.new(x)")[0] == "wrong"      # the sign
    assert graded("cap-06", labels=[{"x": r.T[r.LAST - 1], "text": f"{pct:+.2f}%"}], source="label.new(x)")[0] == "wrong"
    assert graded("cap-06", labels=[], source="label.new(x)")[0] == "wrong"


def test_cap08_the_ten_newest_boxes_each_ended_where_it_was_filled():
    r = bound()
    want = r.drawn_rules("cap-08")["boxes_exact"]
    boxes = [{"left": left, "right": right, "top": top, "bottom": bottom} for _what, left, right, top, bottom in want]
    assert graded("cap-08", boxes=boxes, source="box.new(x)")[0] == "right"
    assert graded("cap-08", boxes=[{**b, "right": r.T[r.LAST]} for b in boxes], source="box.new(x)")[0] == "wrong"        # never ended
    assert graded("cap-08", boxes=boxes[1:], source="box.new(x)")[0] == "wrong"                                           # nine
    older = r._gap_boxes(11)[0]
    eleven = [{"left": older[0], "right": older[1], "top": older[2], "bottom": older[3]}] + boxes
    assert graded("cap-08", boxes=eleven, source="box.new(x)")[0] == "wrong"                                             # the eleventh kept
    assert graded("cap-08", boxes=[{**boxes[0], "top": boxes[0]["bottom"], "bottom": boxes[0]["top"] - 1}] + boxes[1:], source="box.new(x)")[0] == "wrong"
    assert graded("cap-08", boxes=[], source="box.new(x)")[0] == "wrong"


# ── on the script lane's own bars (node): the fingerprints, and what each case says its rule distinguishes ──

@pytest.fixture(scope="module")
def lane_chart():
    from tools.converse_eval import LaneUnavailable
    from tools.value_cases import script_lane
    try:
        run = script_lane.run([{"id": "bars", "source": '//@version=5\nindicator("bars")\nplot(close)\n', "chart": "daily"}])
    except LaneUnavailable as exc:
        pytest.skip(f"the script lane is not available here: {str(exc)[:200]}")
    return run["charts"]["daily"]


def test_each_fingerprint_is_its_rules_on_its_own_lanes_bars(lane_chart):
    from tools.value_cases import script_grade
    script_ids = [cid for cid in IDS if lane_of(cid) == "script"]
    digests = {**script_grade.rule_digests([EVERY[cid] for cid in script_ids]),
               **{cid: G.rule_digest(cid) for cid in ON_THE_FORMULA_LANE if lane_of(cid) == "formula"}}
    assert {cid: EVERY[cid]["rule"]["digest"] for cid in IDS} == digests
    assert len(set(digests.values())) == 9
    # a case that moved back keeps the formula lane's fingerprint in its history: the same rule on those bars
    assert {cid: EVERY[cid]["rule"]["history"][1]["digest"] for cid in BACK_ON_THE_SCRIPT_LANE} == {cid: G.rule_digest(cid) for cid in BACK_ON_THE_SCRIPT_LANE}
    # a case that moved keeps, as its first entry, the fingerprint it was written with: the same rule on the script lane's bars
    was = script_grade.rule_digests([{"id": cid, "chart": "daily"} for cid in ON_THE_FORMULA_LANE])
    assert {cid: EVERY[cid]["rule"]["history"][0]["digest"] for cid in ON_THE_FORMULA_LANE} == was


def test_what_each_script_lane_case_says_its_rule_distinguishes_is_true(lane_chart):
    R.bind(lane_chart)
    n = R.N
    said = {cid: EVERY[cid]["distinguishes"] for cid in IDS}
    c1 = R.rule_cap01()[0][1]
    has = lambda col: sum(1 for v in col if v is not None)  # noqa: E731
    beyond = sum(1 for i in range(n) if c1[i] is None and any(R.C[j] > R.C[i] for j in range(0, max(0, i - 250))))
    assert f"a value on {has(c1):,} of {n:,} bars" in said["cap-01"] and f"of which {beyond} have a higher close further back than 250 bars" in said["cap-01"]
    assert beyond >= 5                                                    # the 250 bar limit decides bars on this chart
    c3 = R.rule_cap03()[0][1]
    assert f"{len(R._swings(R.H, 3, True))} swing highs strictly above" in said["cap-03"] and f"a value on {has(c3):,} of {n:,} bars" in said["cap-03"]
    assert f"{len(R._swings(R.L, 3, False))} swing lows" in said["cap-04"]
    assert f"the rise is {R.drawn_rules('cap-05')['labels_at'][0][2]:.2f}" in said["cap-05"]
    assert f"reading {R.drawn_rules('cap-06')['labels_at'][0][2]:.2f} percent" in said["cap-06"]
    gaps = R._gap_boxes(10 ** 6)
    assert f"{len(gaps)} gap bars" in said["cap-08"] and len(gaps) >= 12


def test_what_each_formula_lane_case_says_its_rule_distinguishes_is_true():
    bound()                                                               # the formula lane's own bars
    n = R.N
    said = {cid: EVERY[cid]["distinguishes"] for cid in ON_THE_FORMULA_LANE if lane_of(cid) == "formula"}
    c2, c3, c7, c9 = R.rule_cap02()[0][1], R.rule_cap03()[0][1], R.rule_cap07()[0][1], R.rule_cap09()[0][1]
    has = lambda col: sum(1 for v in col if v is not None)  # noqa: E731
    assert f"the default line has a value on {has(c2):,} of {n:,} bars" in said["cap-02"] and "only the DEFAULT choice is held" in said["cap-02"]
    assert has(c3) > 1000                                                 # (cap-03 says its numbers on the script lane now)
    assert f"shown on {has(c7):,} bars and must be empty on {n - has(c7):,}" in said["cap-07"] and has(c7) > 300 and n - has(c7) > 300
    plain = R._sma(R.V, 10)
    differs = sum(1 for i in range(n) if c9[i] is not None and plain[i] is not None and abs(c9[i] - plain[i]) > 1e-9)
    assert f"differs from the plain 10 bar average volume on {differs:,} of {n:,} bars" in said["cap-09"] and differs > 1000


# ── four the door answers without a script: the formula lane, by the same rule ──

def _formula_answer(cid, tree):
    """The recorded formula answer of `cid` with its one output's formula replaced."""
    answer = copy.deepcopy(formula_answer_of(cid))
    outputs = answer["ops"][0]["outputs"]
    assert len(outputs) == 1
    outputs[0]["tree"] = tree
    return answer


def _tree_of(cid):
    return copy.deepcopy(formula_answer_of(cid)["ops"][0]["outputs"][0]["tree"])


def test_the_four_formula_answers_are_held_by_value_three_right_and_one_wrong():
    for cid in ("cap-02", "cap-07", "cap-09"):
        got = G.grade(cid, RECORDED[cid]["answer"])
        assert got["verdict"] == "right", (cid, got["lines"])
    got = G.grade("cap-03", formula_answer_of("cap-03"))
    assert got["verdict"] == "wrong" and "739 of 1643 bars differ" in got["lines"][0], got["lines"]
    # the first pass's answer, kept as a specimen: wrong by the same rule, on more bars
    was = G.grade("cap-03", RECORDED["cap-03"]["found"][0]["answer"])
    assert was["verdict"] == "wrong" and "1261 of 1639 bars differ" in was["lines"][0], was["lines"]


def test_ONE_RULE_WHICHEVER_LANE_ANSWERS(monkeypatch):
    for cid in ON_THE_FORMULA_LANE:
        (what, readings), = formula_rules.rules(cid).items()
        mine = bound().RULES[cid]()                                       # the script lane's function, on the formula lane's bars
        assert what == mine[0][0] and len(readings) == len(mine) == 1, cid
        assert readings[0][0] == mine[0][0] and same([None if v != v else v for v in readings[0][1]], mine[0][1]), cid
    # DERIVED, never restated: move the source and the formula lane's rule moves with it
    monkeypatch.setitem(R.RULES, "cap-09", lambda: [("the plain 10 bar average volume", R._sma(R.V, 10))])
    assert list(formula_rules.rules("cap-09")) == ["the plain 10 bar average volume"]
    assert G.grade("cap-09", RECORDED["cap-09"]["answer"])["verdict"] == "wrong"
    assert G.rule_digest("cap-09") != RECORDED["cap-09"]["rule"]["digest"]


def test_NOTHING_IS_HELD_ON_THE_FORMULA_LANE_TOO(monkeypatch):
    """⚰️ Until 2026-11-23 a formula was right when it equalled the rule on every bar BOTH had a value. "Only while
    the close is above the 50 day average, and nothing on the other bars": the plain 10 bar average, drawn on every
    bar, passed."""
    assert formula_rules.exact("cap-07") and not any(formula_rules.exact(cid) for cid in ("cap-02", "cap-03", "cap-09", "d01"))
    tree = _tree_of("cap-07")
    assert tree["name"] == "?:"                                          # the 10 bar average WHILE the close is above the 50 bar one
    right = G.grade("cap-07", RECORDED["cap-07"]["answer"])
    assert right["verdict"] == "right" and "nothing where the rule holds nothing" in right["lines"][0]
    everywhere = _formula_answer("cap-07", tree["args"][1])               # the same average, on EVERY bar
    got = G.grade("cap-07", everywhere)
    assert got["verdict"] == "wrong" and "nothing is part of what was asked" in got["lines"][0], got["lines"]
    zero = _tree_of("cap-07")
    zero["args"][2] = {"type": "num", "value": 0}                        # a line at 0 where the words say nothing
    assert G.grade("cap-07", _formula_answer("cap-07", zero))["verdict"] == "wrong"
    late = _tree_of("cap-07")
    late["args"][0]["args"][1]["args"][1]["value"] = 51                   # the right shape, read against a 51 bar average
    assert G.grade("cap-07", _formula_answer("cap-07", late))["verdict"] == "wrong"
    # CONTROL: with the rule's NOTHING not held, the average drawn on every bar passes, exactly as it did before
    before = G.rule_digest("cap-07")
    assert before == RECORDED["cap-07"]["rule"]["digest"]
    monkeypatch.setattr(formula_rules, "exact", lambda cid: set())
    assert G.grade("cap-07", everywhere)["verdict"] == "right"
    assert G.rule_digest("cap-07") != before                              # a rule that stops holding NOTHING has changed
    assert G.rule_digest("cap-09") == RECORDED["cap-09"]["rule"]["digest"]


def _said_exactly(first, last, strict=True):
    """The member's words as a formula: a high above the highs of the 3 bars before it and the 3 after it, known 3 bars
    later, the average of five of them. `first..last`: which occurrences are read (0 is the newest)."""
    S = lambda name: {"type": "series", "name": name}  # noqa: E731, N806
    num = lambda v: {"type": "num", "value": v}  # noqa: E731
    call = lambda name, *args: {"type": "call", "name": name, "args": list(args)}  # noqa: E731
    op = lambda name, *args: {"type": "op", "name": name, "args": list(args)}  # noqa: E731
    back = lambda k, tree: {"type": "offset", "value": k, "args": [tree]}  # noqa: E731
    if strict:
        swing = op("&&", op(">", back(3, S("high")), back(4, call("highest", S("high"), num(3)))),
                   op(">", back(3, S("high")), call("highest", S("high"), num(3))))
        value = back(3, S("high"))
    else:                                                                 # the engine's own swing: an equal high before is allowed
        value = call("pivothigh", S("high"), num(3), num(3))
        swing = op("!", call("na", value))
    total = None
    for k in range(first, last + 1):
        part = call("valuewhenOccurrence", swing, value, num(k))
        total = part if total is None else op("+", total, part)
    return op("/", total, num(5))


def test_cap03_the_words_can_be_met_on_the_formula_lane_and_each_finding_alone_is_wrong():
    """cap-03's formula answer was WRONG (kept as a specimen). This is what RIGHT is on the formula lane: no script is needed."""
    right = G.grade("cap-03", _formula_answer("cap-03", _said_exactly(0, 4)))
    assert right["verdict"] == "right" and right["lines"][0].endswith(" on 1643 bars"), right["lines"]
    # finding 1 alone: the right swings, read one swing late (occurrences 1 to 5; 0 is the newest)
    assert G.grade("cap-03", _formula_answer("cap-03", _said_exactly(1, 5)))["verdict"] == "wrong"
    # finding 2 alone: the newest five, of `pivothigh` (an equal high in the 3 bars before still counts as a swing)
    assert G.grade("cap-03", _formula_answer("cap-03", _said_exactly(0, 4, strict=False)))["verdict"] == "wrong"
    # the FIRST pass was both at once (one swing late, and the engine's swing): the tree this helper writes for them
    assert _said_exactly(1, 5, strict=False) == RECORDED["cap-03"]["found"][0]["answer"]["ops"][0]["outputs"][0]["tree"]
    # the record now reads the newest five (fixed by the table's sentence) and is still the engine's swing, on its own bar
    assert _said_exactly(0, 4, strict=False) == _tree_of("cap-03")


def test_cap04_a_swing_window_one_bar_longer_is_caught_only_on_the_edge_chart():
    """Why cap-04 names an edge. Its recorded script with ONLY the swing window raised (3 bars each side to 4) draws
    the same three lines on the plain bars. On the edge chart the bar 3 bars before the newest is a strict low: a 3 bar
    swing known on the newest bar, and no 4 bar swing yet."""
    from tools.converse_eval import LaneUnavailable
    from tools.value_cases import script_grade
    case = RECORDED["cap-04"]
    longer, hits = re.subn(r'input\.int\(3, "Bars (before|after)"', lambda m: f'input.int(4, "Bars {m.group(1)}"', case["answer"]["script"]["pine"])
    assert hits == 2                                                      # the recorded script's two window settings, nothing else
    answer = {"cap-04": {"turn": "script", "script": {"pine": longer}}}
    plain = {k: v for k, v in case.items() if k != "edge"}
    try:
        got = (script_grade.grade_all([case])["cap-04"]["verdict"],
               script_grade.grade_all([plain], answer)["cap-04"]["verdict"],
               script_grade.grade_all([case], answer)["cap-04"]["verdict"])
    except LaneUnavailable as exc:
        pytest.skip(f"the script lane is not available here: {str(exc)[:200]}")
    assert got == ("right", "right", "wrong")
