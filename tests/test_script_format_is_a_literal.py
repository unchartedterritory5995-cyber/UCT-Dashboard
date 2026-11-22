"""INTERIM: `str.tostring`'s format is written as a string literal (rule 14 of the script document).

Found by a live re-check, 2026-11-22. Asked for "a table with yesterday's high and yesterday's low", the assistant
added a "Decimal places" setting and BUILT the number format from text
(`fmt = "#." + str.replace_all(str.substring("00000000", 0, digits), "0", "#")`, then `str.tostring(pdh, fmt)`).
The engine withholds a text whose format is not a string literal: the table drew its two labels and NO VALUES, with
no error and no word to the member. A blank where a value belongs.

Until the engine serves a computed format (and names what it withholds), the assistant must not write the shape:
  * rule 14 says to write the format as a string literal and to choose among literal formats for a decimals setting;
  * the recorded answer is a SCRIPT case recorded WRONG (`table-format-01`);
  * ⛔ THE SENTENCE IS INTERIM, AND THIS FILE SAYS WHEN IT GOES: `test_THE_SENTENCE_STAYS_EXACTLY_AS_LONG_AS_...` runs
    the shape through the shipped engine on every run. The day a format held in a variable DRAWS, that test goes red
    and names the constant to remove.

By value on the built daily bars, through the shipped engine. No paid calls.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from api.services import pine_authoring as pa
from tools.value_cases import script_rules

ROOT = Path(__file__).resolve().parents[1]
CASES = json.loads((ROOT / "tests" / "fixtures" / "authoring" / "value_cases.json").read_text(encoding="utf-8"))["cases"]
CASE = next(c for c in CASES if c["id"] == "table-format-01")
RECORDED = CASE["answer"]["script"]["pine"]

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
    "the literal ladder on a decimals setting (what rule 14 teaches)": table_of("hi", "lo", LADDER),
    "format.mintick": table_of("str.tostring(high[1], format.mintick)", "str.tostring(low[1], format.mintick)"),
    "the value in a variable, the format a literal": table_of('str.tostring(pdh, "#.##")', 'str.tostring(pdl, "#.##")', "pdh = high[1]\npdl = low[1]\n"),
}
#: every form here leaves the value cells blank today
WITHHELD = {
    "the recorded answer": RECORDED,
    "a format held in a variable": table_of("str.tostring(high[1], fmt)", "str.tostring(low[1], fmt)", 'fmt = "#.##"\n'),
    "a format joined from text": table_of("str.tostring(high[1], fmt)", "str.tostring(low[1], fmt)", 'fmt = "#." + "##"\n'),
    "a format built with str.replace_all": table_of("str.tostring(high[1], fmt)", "str.tostring(low[1], fmt)", 'fmt = "#." + str.replace_all("00", "0", "#")\n'),
    "format.percent": table_of("str.tostring(high[1], format.percent)", "str.tostring(low[1], format.percent)"),
}
FORMS = {**SERVED, **WITHHELD}


# ── the document ──

def test_the_document_carries_the_rule_once_after_rule_13():
    doc = pa.document()
    rule = doc.split("\n14. ")[1].split("\n")[0]
    assert rule == pa.FORMAT_LITERAL_RULE and doc.count(pa.FORMAT_LITERAL_RULE) == 1 and "{format_literal}" not in doc
    for piece in ('Write `str.tostring`\'s format as a string literal ("#.##")',
                  'For a decimals setting, choose among literal formats',
                  '`digits == 0 ? str.tostring(x, "#") : digits == 1 ? str.tostring(x, "#.#") : str.tostring(x, "#.##")`',
                  "never build a format from text or hold one in a variable",
                  "`format.mintick` and `format.volume` are served", 'for a percent write the number and add "%" yourself'):
        assert piece in rule, piece
    assert doc.index("\n13. ") < doc.index("\n14. ") < doc.index("## ")


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
def test_a_format_written_out_draws_yesterdays_high_and_low(ran, name):
    assert sum(1 for c in _cells(ran, name) if c) == 4                               # two labels and two values
    got = _graded(ran, name)
    assert got["verdict"] == "right", (name, got["lines"])
    assert sum(1 for line in got["lines"] if line.lstrip().startswith("RIGHT")) == 2


@pytest.mark.parametrize("name", sorted(WITHHELD))
def test_a_format_that_is_not_a_literal_leaves_the_values_BLANK_with_no_error(ran, name):
    chart, runs = ran
    assert runs[name]["ok"] and not runs[name]["errors"], runs[name]                 # the engine says nothing is wrong
    cells = _cells(ran, name)
    assert sum(1 for c in cells if c) == 2, cells                                    # the two labels, and no value beside them
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


def test_THE_SENTENCE_STAYS_EXACTLY_AS_LONG_AS_THE_ENGINE_WITHHOLDS_A_FORMAT_HELD_IN_A_VARIABLE(ran):
    """⛔ THE REMOVAL RULE. Rule 14 exists only because the engine draws nothing for a computed format. The day
    `fmt = "#.##"; str.tostring(x, fmt)` draws its number, this fails: REMOVE `pine_authoring.FORMAT_LITERAL_RULE`
    (and rule 14 from the contract) in that same commit, and turn this file's WITHHELD forms into SERVED ones."""
    cells = _cells(ran, "a format held in a variable")
    withheld_today = sum(1 for c in cells if c) == 2                                 # the two labels and nothing else
    assert withheld_today, ("the engine now DRAWS a format held in a variable: rule 14 (pine_authoring.FORMAT_LITERAL_RULE) is "
                            "no longer needed; remove it in this commit", cells)
    assert "\n14. " + pa.FORMAT_LITERAL_RULE in pa.document()


def test_the_recorded_answer_is_a_case_recorded_WRONG():
    assert CASE["lane"] == "script" and CASE["recorded_verdict"] == "wrong" and "NO VALUES" in CASE["defect"]
    assert "str.tostring(pdh, fmt)" in RECORDED and "request.security" not in RECORDED
    assert script_rules.has_rule("table-format-01")
