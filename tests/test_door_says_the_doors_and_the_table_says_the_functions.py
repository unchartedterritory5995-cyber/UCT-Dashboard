"""THE DOOR SAYS WHAT IS THE DOOR'S, AND THE FUNCTION TABLE SAYS WHAT A FUNCTION DOES.

⚰️ MEASURED 2026-11-23 on value case cap-03 ("the average of the last 5 swing highs, where a swing high is a bar
whose high is above the highs of the 3 bars before it and the 3 bars after it"): wrong on 1,261 of 1,639 bars, and
the reply's read-back ("the level steps to a new value 3 bars after the pivot bar") was false for the tree.

What the functions do is corrected at its one authority, the function table (`closedTable.json`). Two things are the
door's own and are held here:
  * READ_BACK_TIMING_RULE: when the reply says WHEN a value appears or changes, that must be what the formula does;
  * STRICT_WORDS_RULE: the member's strict word ("above") stays strict inside a function that admits an equal value.
And one thing is held so it stays that way: the door's instructions do not name those functions or repeat any
function's sentence. A fact written twice is a fact that can disagree with itself.

No model is called and nothing reaches the network.
"""
from __future__ import annotations

import json
from pathlib import Path

from api.services import definition_concierge as concierge
from api.services import definition_conversation as dc

ROOT = Path(__file__).resolve().parents[1]
TABLE = json.loads((ROOT / "app" / "src" / "components" / "chart" / "engine" / "ast" / "closedTable.json").read_text(encoding="utf-8"))["functions"]
PROMPT = dc.CONVERSE_SYSTEM_PROMPT
#: the functions cap-03's finding turned on: what they do is the table's to say
THE_TABLES = ("pivothigh", "pivotlow", "valuewhenOccurrence")


def test_the_read_back_rule_stands_once_where_the_reply_is_described():
    rule = dc.READ_BACK_TIMING_RULE
    assert PROMPT.count(rule) == 1
    assert "ids or field names.\n" + rule + "\n" in PROMPT             # the last word on `reply`, before the next section
    assert PROMPT.index("`reply` is shown to the member as your words") < PROMPT.index(rule) < PROMPT.index("SOURCE OF TRUTH AND DATA")
    for part in ("WHEN `reply` SAYS WHEN a value appears or changes", "that must be what your formula does, bar for bar",
                 "where it writes its value and which bars it reads",
                 "never describe a delay, a confirmation or a starting bar the formula does not have"):
        assert part in rule, part


def test_the_strict_words_rule_stands_once_beside_the_reading_it_extends():
    rule = dc.STRICT_WORDS_RULE
    assert PROMPT.count(rule) == 1
    assert "\"More than X\" and \"above X\" are STRICT (>); \"at least X\" and \"X or more\" are >=. " + rule in PROMPT
    for part in ("A STRICT WORD STAYS STRICT INSIDE A FUNCTION", "\"above\", \"below\", \"higher than\", \"lower than\"",
                 "admits an equal value on either side", "that function is not the member's test",
                 "Write the comparison out with > or <"):
        assert part in rule, part


def test_the_door_does_not_say_what_the_table_says():
    """Derive, never restate. The instructions name none of the three functions, and repeat no function's sentence."""
    for name in THE_TABLES:
        assert name in TABLE and name not in PROMPT, name
        assert name not in dc.READ_BACK_TIMING_RULE and name not in dc.STRICT_WORDS_RULE, name
    restated = [name for name, entry in TABLE.items() if len(entry.get("sentence") or "") > 30 and entry["sentence"] in PROMPT]
    assert restated == [], restated
    # the two rules point AT the table and carry none of its facts about an occurrence, a swing or a placement
    for rule in (dc.READ_BACK_TIMING_RULE, dc.STRICT_WORDS_RULE):
        assert "function table" in rule
        for fact in ("occurrence", "swing", "pivot", "most recent", "written on"):
            assert fact not in rule.lower(), (fact, rule[:60])


def test_CONTROL_the_table_is_where_the_assistant_reads_what_those_functions_do():
    told = concierge.vocabulary_text(dc.chart_table())
    for name in THE_TABLES:
        lines = [line.strip() for line in told.splitlines() if line.strip().startswith(name + "(")]
        assert len(lines) == 1 and lines[0].endswith(" -- " + TABLE[name]["sentence"]), name
    # and the check above can see a restatement: a sentence of the table put into the instructions is found
    planted = PROMPT + TABLE["pivothigh"]["sentence"]
    assert [name for name, entry in TABLE.items() if len(entry.get("sentence") or "") > 30 and entry["sentence"] in planted] == ["pivothigh"]
