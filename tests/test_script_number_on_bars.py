"""A NUMBER WRITTEN ON BARS: rule 12 of the script document, and a value case that can hold one.

Found by a value check of a live round, 2026-11-22. Asked to "count runs of closes that are each above the close 4
bars earlier, and write the count above each bar of the run as a number from 1 to 9", the assistant counted right
and wrote `plotchar(cnt > 0 ? cnt : na, "Count", "", location.abovebar)`. `plotchar` draws ONE fixed character
wherever its series has a value: every bar of the run got the same mark and no bar got its number.

Two things here:
  * THE DOCUMENT says how a number that changes bar to bar is written (a label per bar), and that `plotchar` and
    `plotshape` draw one fixed character or text per call.
  * THE VALUE CASES can hold it. The lane now says what each mark plot WRITES (`marks`: the pane's own fixed text
    per plot; a column says where a mark is, never what it reads), and the rule accepts either honest picture: a
    label on each bar of a run showing that bar's count, or one mark per number whose fixed text IS the number, on
    exactly the bars of that number. The recorded answer is a case recorded WRONG (`count-on-bars-01`).

By value on every bar of the built daily market, through the shipped engine. No paid calls.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from api.services import pine_authoring as pa
from tools.value_cases import script_rules

ROOT = Path(__file__).resolve().parents[1]
CASES = json.loads((ROOT / "tests" / "fixtures" / "authoring" / "value_cases.json").read_text(encoding="utf-8"))["cases"]
CASE = next(c for c in CASES if c["id"] == "count-on-bars-01")
RECORDED = CASE["answer"]["script"]["pine"]

HEAD = '//@version=5\nindicator("Run count", overlay=true, max_labels_count=500)\n'
HEAD_50 = '//@version=5\nindicator("Run count", overlay=true)\n'
COUNT = "up = close > close[4]\nvar int cnt = 0\nif up\n    cnt := cnt >= 9 ? 1 : cnt + 1\nelse\n    cnt := 0\n"
LABEL = "if cnt > 0\n    label.new(bar_index, high, str.tostring(cnt), style=label.style_none, textcolor=color.green, size=size.small)\n"


def nine(call):
    return "".join(call.replace("{k}", str(k)) for k in range(1, 10))


RIGHT = {
    "labels, 500 kept": HEAD + COUNT + LABEL,
    "labels, the default number kept": HEAD_50 + COUNT + LABEL,
    "nine plotchars": HEAD + COUNT + nine('plotchar(cnt == {k}, "Count {k}", "{k}", location.abovebar, color=color.green)\n'),
    "nine plotshapes": HEAD + COUNT + nine('plotshape(cnt == {k}, "Count {k}", shape.circle, location.abovebar, text="{k}", textcolor=color.green)\n'),
}
WRONG = {
    "the recorded answer": (RECORDED, "no mark is the number 1 on exactly its bars"),
    "labels one off": (HEAD + COUNT + LABEL.replace("str.tostring(cnt)", "str.tostring(cnt + 1)"), "show another number"),
    "digits swapped": (HEAD + COUNT + "".join(f'plotchar(cnt == {k}, "Count {k}", "{10 - k}", location.abovebar)\n' for k in range(1, 10)),
                       "no mark is the number 1 on exactly its bars"),
    "never restarts after 9": (HEAD + COUNT.replace("cnt >= 9 ? 1 : cnt + 1", "cnt + 1") + LABEL, "show another number"),
    "a label on every bar": (HEAD + COUNT + "label.new(bar_index, high, str.tostring(cnt), style=label.style_none)\n", "NOT on the bars of the run"),
    "one mark for the whole run": (HEAD + COUNT + 'plotchar(cnt > 0, "Count", "1", location.abovebar)\n', "no mark is the number 1 on exactly its bars"),
    "compares 3 bars back": (HEAD + COUNT.replace("close[4]", "close[3]") + LABEL, "NOT on the bars of the run"),
    "nothing written at all": (HEAD + COUNT + "plot(cnt)\n", "nothing is written on the bars"),
    # every label shows its own bar's count, and half the bars of each run have none
    "labels on only some bars of a run": (HEAD + COUNT + LABEL.replace("if cnt > 0", "if cnt % 2 == 1"), "NOT on the bars of the run"),
}
FORMS = {**RIGHT, **{name: source for name, (source, _why) in WRONG.items()}}


# ── the document ──

def test_the_document_carries_the_rule_once_after_rule_12():
    doc = pa.document()
    assert "\n12. A NUMBER WRITTEN ON BARS that changes from bar to bar" in doc
    rule = doc.split("\n12. ")[1].split("\n")[0]
    assert rule == pa.NUMBER_ON_BARS_RULE and doc.count(pa.NUMBER_ON_BARS_RULE) == 1 and "{number_on_bars}" not in doc
    for piece in ("is written with a label, one per bar", "`label.new(bar_index, high, str.tostring(n), style = label.style_none",
                  "`max_labels_count = 500` in `indicator(...)`",
                  "`plotchar` and `plotshape` draw ONE FIXED character or text per call, the same on every bar",
                  '`plotchar(n, char = "")` writes no number at all'):
        assert piece in rule, piece
    assert doc.index("\n11. ") < doc.index("\n12. ")


# ── by value ──

def _lane_run(jobs):
    from tools.converse_eval import LaneUnavailable
    from tools.value_cases import script_lane
    try:
        return script_lane.run(jobs)
    except LaneUnavailable as exc:
        pytest.skip(f"the script lane is not available here: {str(exc)[:200]}")


@pytest.fixture(scope="module")
def ran():
    ids = {name: f"f{k}" for k, name in enumerate(FORMS)}
    run = _lane_run([{"id": ids[name], "source": source, "chart": "daily"} for name, source in FORMS.items()])
    return run["charts"]["daily"], {name: run["scripts"][ids[name]] for name in FORMS}


def _graded(ran, name):
    chart, runs = ran
    return script_rules.grade_script("count-on-bars-01", FORMS[name], runs[name], chart)


def test_the_count_by_hand_is_a_count_worth_holding(ran):
    chart, _runs = ran
    script_rules.bind(chart)
    counts = script_rules._run_counts()
    assert len(counts) == len(chart["bars"]) and set(counts) == set(range(0, 10))        # every number from 1 to 9 is written somewhere
    assert counts[:4] == [0, 0, 0, 0]                                                    # no close 4 bars earlier
    assert any(counts[i] == 9 and counts[i + 1] == 1 for i in range(len(counts) - 1))    # a run longer than 9 starts again at 1
    assert sum(1 for c in counts if c) > 500 and sum(1 for c in counts if not c) > 500   # runs and breaks, both many


def test_the_lane_says_what_each_mark_writes(ran):
    _chart, runs = ran
    chars = runs["nine plotchars"]["marks"]
    assert sorted(m["text"] for m in chars.values()) == [str(k) for k in range(1, 10)] and len(chars) == 9
    assert sorted(m["text"] for m in runs["nine plotshapes"]["marks"].values()) == [str(k) for k in range(1, 10)]
    assert all(m["position"] == "aboveBar" for m in chars.values())
    assert runs["labels, 500 kept"]["marks"] == {}                                       # a label is not a mark plot
    # THE FINDING: the recorded script has ONE mark, and what it writes is not a number
    recorded = runs["the recorded answer"]["marks"]
    assert len(recorded) == 1 and not str(list(recorded.values())[0]["text"] or "").strip().isdigit()


@pytest.mark.parametrize("name", sorted(RIGHT))
def test_every_honest_way_of_writing_the_count_is_RIGHT(ran, name):
    got = _graded(ran, name)
    assert got["verdict"] == "right", (name, got["lines"])
    assert any(line.lstrip().startswith("RIGHT") for line in got["lines"])


@pytest.mark.parametrize("name", sorted(WRONG))
def test_every_way_that_does_not_write_each_bars_count_is_WRONG_and_says_why(ran, name):
    got = _graded(ran, name)
    assert got["verdict"] == "wrong", (name, got["lines"])
    assert WRONG[name][1] in " ".join(got["lines"]), (name, got["lines"])


def test_labels_are_held_on_every_bar_they_are_kept_on(ran):
    """The chart keeps only the newest labels. What is kept must be the NEWEST bars of the runs, each with its count."""
    chart, runs = ran
    script_rules.bind(chart)
    counts = script_rules._run_counts()
    days = [script_rules.T[i] for i in range(len(counts)) if counts[i] > 0]
    for name, least in (("labels, 500 kept", 400), ("labels, the default number kept", 40)):
        labels = runs[name]["drawn"]["labels"]
        assert len(labels) >= least, (name, len(labels))
        assert sorted(str(l["x"])[:10] for l in labels) == days[-len(labels):], name
    assert len(runs["labels, 500 kept"]["drawn"]["labels"]) > 5 * len(runs["labels, the default number kept"]["drawn"]["labels"])


def test_the_recorded_answer_is_a_case_recorded_WRONG():
    assert CASE["lane"] == "script" and CASE["recorded_verdict"] == "wrong" and "writes NO number" in CASE["defect"]
    assert 'plotchar(cnt > 0 ? cnt : na, "Count", ""' in RECORDED
    assert script_rules.has_rule("count-on-bars-01") and "count-on-bars-01" not in script_rules.RULES      # held by what is DRAWN
