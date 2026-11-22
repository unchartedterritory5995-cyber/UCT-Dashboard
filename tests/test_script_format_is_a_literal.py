"""`str.tostring`'s format: what the engine draws, and what rule 13 of the script document still says.

Found by a live re-check, 2026-11-22. Asked for "a table with yesterday's high and yesterday's low", the assistant
added a "Decimal places" setting and BUILT the number format from text
(`fmt = "#." + str.replace_all(str.substring("00000000", 0, digits), "0", "#")`, then `str.tostring(pdh, fmt)`).
The engine then withheld every text whose format was not a string literal: the table drew its two labels and NO
VALUES, with no error and no word to the member. Rule 13 told the assistant to write the format as a literal, as an
INTERIM sentence, with this file as its tripwire.

⭐ Train e95's computed-number-formats unit folds a format made of literals and inputs (an alias, a join,
`str.substring` / `str.replace_all` / `str.repeat`, a ternary or `switch` on an input) and NAMES what it still
withholds. The tripwire fired in that commit, as written: the literal-format sentence came out
(`pine_authoring.FORMAT_LITERAL_RULE` is gone), every form below that builds a format from literals and inputs moved
to SERVED, and rule 13 shrank to the one thing still withheld, `format.percent` (coordinator's ruling: shrink it, do
not drop it). ⛔ THAT SENTENCE IS INTERIM TOO, AND THIS FILE SAYS WHEN IT GOES: the day `format.percent` draws (its
capture is `tools/visual_conformance/probes/vw-format-percent.pine`), `test_THE_PERCENT_SENTENCE_STAYS_...` goes red
and names the constant to remove.

By value on the built daily bars, through the shipped engine. No paid calls.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from api.services import pine_authoring as pa
from tools.value_cases import grade as G
from tools.value_cases import script_rules

ROOT = Path(__file__).resolve().parents[1]
CASES = json.loads((ROOT / "tests" / "fixtures" / "authoring" / "value_cases.json").read_text(encoding="utf-8"))["cases"]
CASE = next(c for c in CASES if c["id"] == "table-format-01")
#: the script the finding rests on: the case's record while it is recorded WRONG, its `found` specimen after
FOUND = G.specimen(CASE)
RECORDED = FOUND["answer"]["script"]["pine"]

HEAD = '//@version=5\nindicator("t", overlay=true)\n'
TABLE = "var table t = table.new(position.top_right, 2, 2)\n"


def table_of(high_text, low_text, before=""):
    return (HEAD + before + TABLE + 'table.cell(t, 0, 0, "Yesterday high")\ntable.cell(t, 1, 0, ' + high_text + ')\n'
            'table.cell(t, 0, 1, "Yesterday low")\ntable.cell(t, 1, 1, ' + low_text + ")\n")


LADDER = ('digits = input.int(2, "Decimal places", minval=0, maxval=2)\n'
          'hi = digits == 0 ? str.tostring(high[1], "#") : digits == 1 ? str.tostring(high[1], "#.#") : str.tostring(high[1], "#.##")\n'
          'lo = digits == 0 ? str.tostring(low[1], "#") : digits == 1 ? str.tostring(low[1], "#.#") : str.tostring(low[1], "#.##")\n')
#: every form here draws its numbers
SERVED = {
    "a literal format": table_of('str.tostring(high[1], "#.##")', 'str.tostring(low[1], "#.##")'),
    "the literal ladder on a decimals setting": table_of("hi", "lo", LADDER),
    "format.mintick": table_of("str.tostring(high[1], format.mintick)", "str.tostring(low[1], format.mintick)"),
    "the value in a variable, the format a literal": table_of('str.tostring(pdh, "#.##")', 'str.tostring(pdl, "#.##")', "pdh = high[1]\npdl = low[1]\n"),
    # ⭐ e95: each of these left the value cells blank before the fold
    "the recorded answer": RECORDED,
    "a format held in a variable": table_of("str.tostring(high[1], fmt)", "str.tostring(low[1], fmt)", 'fmt = "#.##"\n'),
    "a format joined from text": table_of("str.tostring(high[1], fmt)", "str.tostring(low[1], fmt)", 'fmt = "#." + "##"\n'),
    "a format built with str.replace_all": table_of("str.tostring(high[1], fmt)", "str.tostring(low[1], fmt)", 'fmt = "#." + str.replace_all("00", "0", "#")\n'),
}
#: every form here leaves the value cells blank today, and the engine says why
WITHHELD = {
    "format.percent": table_of("str.tostring(high[1], format.percent)", "str.tostring(low[1], format.percent)"),
}
PERCENT_WHY = "A value in this table is not shown: it is written with format.percent, which UCT does not print yet."
FORMS = {**SERVED, **WITHHELD}


# ── the document ──

def test_rule_13_is_the_percent_sentence_alone():
    doc = pa.document()
    rule = doc.split("\n13. ")[1].split("\n")[0]
    assert rule == pa.PERCENT_FORMAT_RULE == '`format.percent` is not served yet: write the number and add "%" yourself.'
    assert doc.count(pa.PERCENT_FORMAT_RULE) == 1 and "{percent_format}" not in doc
    # ⛔ the interim literal-format sentence is gone, as its tripwire demanded
    assert not hasattr(pa, "FORMAT_LITERAL_RULE") and "{format_literal}" not in doc
    assert "never build a format from text or hold one in a variable" not in doc
    assert "Write `str.tostring`'s format as a string literal" not in doc
    assert doc.index("\n12. ") < doc.index("\n13. ") < doc.index("\n14. ") < doc.index("## ")


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
    return script_rules.grade_script("table-format-01", FORMS[name], runs[name], chart)


def _cells(ran, name):
    _chart, runs = ran
    return [c for t in (runs[name].get("drawn") or {}).get("tables") or [] for row in t["grid"] for c in row]


@pytest.mark.parametrize("name", sorted(SERVED))
def test_a_format_fixed_before_bar_0_draws_yesterdays_high_and_low(ran, name):
    assert sum(1 for c in _cells(ran, name) if c) == 4                               # two labels and two values
    got = _graded(ran, name)
    assert got["verdict"] == "right", (name, got["lines"])
    assert sum(1 for line in got["lines"] if line.lstrip().startswith("RIGHT")) == 2
    _chart, runs = ran
    assert "why" not in runs[name]["drawn"], runs[name]["drawn"].get("why")         # nothing withheld, nothing said


@pytest.mark.parametrize("name", sorted(WITHHELD))
def test_format_percent_leaves_the_values_blank_and_SAYS_WHY(ran, name):
    chart, runs = ran
    assert runs[name]["ok"] and not runs[name]["errors"], runs[name]
    cells = _cells(ran, name)
    assert sum(1 for c in cells if c) == 2, cells                                    # the two labels, and no value beside them
    assert PERCENT_WHY in runs[name]["drawn"]["why"].values()                       # ⭐ e95: named, never silent
    got = _graded(ran, name)
    assert got["verdict"] == "wrong" and "NOT FOUND" in " ".join(got["lines"]), (name, got["lines"])


def test_the_values_by_hand_are_the_bar_before_the_newest(ran):
    chart, _runs = ran
    bars = chart["bars"]
    script_rules.bind(chart)
    numbers = dict(script_rules.drawn_rules("table-format-01")["numbers"])
    assert numbers == {"yesterday's high": [bars[-2]["h"]], "yesterday's low": [bars[-2]["l"]]}
    assert bars[-2]["h"] != bars[-1]["h"] and bars[-2]["l"] != bars[-1]["l"]         # today's are other numbers
    # CONTROL: a table of TODAY'S high and low is wrong
    today = table_of('str.tostring(high, "#.##")', 'str.tostring(low, "#.##")')
    from tools.value_cases import script_lane
    run = script_lane.run([{"id": "today", "source": today, "chart": "daily"}])
    assert script_rules.grade_script("table-format-01", today, run["scripts"]["today"], run["charts"]["daily"])["verdict"] == "wrong"


def test_the_lanes_output_only_GAINS_a_key(ran):
    """`drawn.why` is additive: a case with nothing withheld has exactly the keys it always had."""
    _chart, runs = ran
    assert set(runs["a literal format"]["drawn"]) == {"via", "tables", "labels", "lines", "boxes"}
    assert set(runs["format.percent"]["drawn"]) == {"via", "tables", "labels", "lines", "boxes", "why"}


def test_THE_PERCENT_SENTENCE_STAYS_EXACTLY_AS_LONG_AS_THE_ENGINE_WITHHOLDS_FORMAT_PERCENT(ran):
    """⛔ THE REMOVAL RULE. Rule 13 exists only because the engine draws nothing for `format.percent`. The day its
    capture is served and `str.tostring(x, format.percent)` draws its number, this fails: REMOVE
    `pine_authoring.PERCENT_FORMAT_RULE` (and rule 13 from the contract) in that same commit."""
    cells = _cells(ran, "format.percent")
    withheld_today = sum(1 for c in cells if c) == 2                                 # the two labels and nothing else
    assert withheld_today, ("the engine now DRAWS format.percent: rule 13 (pine_authoring.PERCENT_FORMAT_RULE) is "
                            "no longer needed; remove it in this commit", cells)
    assert "\n13. " + pa.PERCENT_FORMAT_RULE in pa.document()


def test_the_recorded_answer_is_no_longer_a_case_recorded_WRONG():
    """On 2026-11-22 that answer drew NO VALUES (its table showed two labels and no numbers: the engine withheld a text
    whose format was not a string literal), and the case was recorded WRONG. Its wrong answer stays as the case's
    specimen (`found`, the live run's record: a fixed defect stays as a specimen), and since e95 unit 1 the engine folds
    a format that is fixed, so that specimen's own script draws its values (the forms above); the case is not on the
    WRONG list (`tests/test_value_cases.py`)."""
    assert CASE["lane"] == "script" and "recorded_verdict" not in CASE and "defect" not in CASE
    assert "NO VALUES" in FOUND["defect"]
    assert "str.tostring(pdh, fmt)" in RECORDED and "request.security" not in RECORDED
    assert script_rules.has_rule("table-format-01")
