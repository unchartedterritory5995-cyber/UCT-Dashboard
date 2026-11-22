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
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from tools.value_cases import script_rules as R
from tools.value_cases.market import STOCK

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "tests" / "fixtures" / "authoring" / "value_cases.json").read_text(encoding="utf-8"))
PENDING = {c["id"]: c for c in DATA.get("pending") or [] if c["id"].startswith("cap-")}
IDS = [f"cap-0{n}" for n in range(1, 10)]
CHART = {"bars": STOCK}
COLUMN_RULES = ("cap-01", "cap-02", "cap-03", "cap-07", "cap-09")
DRAWN_RULES = ("cap-04", "cap-05", "cap-06", "cap-08")
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

def test_nine_cases_wait_with_their_words_and_their_rule_and_no_answer():
    assert sorted(PENDING) == IDS
    recorded = {c["id"] for c in DATA["cases"]}
    for cid, case in PENDING.items():
        assert cid not in recorded and case["lane"] == "script" and case["chart"] == "daily"
        assert "answer" not in case and "recorded" not in case and "recorded_verdict" not in case
        assert len(case["rule"]["history"]) == 1 and case["rule"]["history"][0]["digest"] == case["rule"]["digest"]
        assert case["rule"]["history"][0]["reason"] == "written from the request's words before the answer was read"
        assert case["needs"] and case["distinguishes"] and R.has_rule(cid)
    assert set(COLUMN_RULES) | set(DRAWN_RULES) == set(IDS)
    assert [R.RULES[cid] for cid in COLUMN_RULES] == [R.rule_cap01, R.rule_cap02, R.rule_cap03, R.rule_cap07, R.rule_cap09]
    assert all(R.drawn_rules_known(cid) for cid in DRAWN_RULES) and not any(cid in R.RULES for cid in DRAWN_RULES)
    # the member's words, each by the part its rule rests on
    for cid, part in KEY_WORDS.items():
        assert part in PENDING[cid]["words"], cid


def test_a_pending_case_is_in_no_lane_count_and_no_threshold():
    counted = {c["id"] for c in DATA["cases"]}
    assert not counted & set(IDS)
    # the capability list is untouched by words alone: it shrinks only when a RECORDED answer uses the capability
    assert "while" in DATA["capabilities_without_a_case"] and "collections:array" in DATA["capabilities_without_a_case"]


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


def test_each_fingerprint_is_its_rules_on_the_lanes_bars(lane_chart):
    from tools.value_cases import script_grade
    digests = script_grade.rule_digests([PENDING[cid] for cid in IDS])
    assert {cid: PENDING[cid]["rule"]["digest"] for cid in IDS} == digests
    assert len(set(digests.values())) == 9


def test_what_each_case_says_its_rule_distinguishes_is_true(lane_chart):
    R.bind(lane_chart)
    n = R.N
    said = {cid: PENDING[cid]["distinguishes"] for cid in IDS}
    c1, c3, c7, c9 = R.rule_cap01()[0][1], R.rule_cap03()[0][1], R.rule_cap07()[0][1], R.rule_cap09()[0][1]
    has = lambda col: sum(1 for v in col if v is not None)  # noqa: E731
    beyond = sum(1 for i in range(n) if c1[i] is None and any(R.C[j] > R.C[i] for j in range(0, max(0, i - 250))))
    assert f"a value on {has(c1):,} of {n:,} bars" in said["cap-01"] and f"of which {beyond} have a higher close further back than 250 bars" in said["cap-01"]
    assert beyond >= 5                                                    # the 250 bar limit decides bars on this chart
    assert "only the DEFAULT choice is held" in said["cap-02"]
    assert f"{len(R._swings(R.H, 3, True))} swing highs" in said["cap-03"] and has(c3) > 1000
    assert f"{len(R._swings(R.L, 3, False))} swing lows" in said["cap-04"]
    assert f"the rise is {R.drawn_rules('cap-05')['labels_at'][0][2]:.2f}" in said["cap-05"]
    assert f"reading {R.drawn_rules('cap-06')['labels_at'][0][2]:.2f} percent" in said["cap-06"]
    assert f"shown on {has(c7):,} bars and must be empty on {n - has(c7):,}" in said["cap-07"] and has(c7) > 300 and n - has(c7) > 300
    gaps = R._gap_boxes(10 ** 6)
    assert f"{len(gaps)} gap bars" in said["cap-08"] and len(gaps) >= 12
    plain = R._sma(R.V, 10)
    differs = sum(1 for i in range(n) if c9[i] is not None and plain[i] is not None and abs(c9[i] - plain[i]) > 1e-9)
    assert f"differs from the plain 10 bar average volume on {differs:,} of {n:,} bars" in said["cap-09"] and differs > 1000
