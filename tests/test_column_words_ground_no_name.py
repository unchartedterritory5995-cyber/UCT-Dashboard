"""A SCREENER COLUMN'S WORDS NEVER GROUND A MADE-UP INDICATOR NAME AT THE CHART DOOR (2026-11-25, master red since #2696).

⚰️ FOUND by a bisection of two red door rails (`test_named_indicators_held.py`, every door lane since #2696, merge
2575075701): #2696 added the Screener's post-earnings drift column, whose filter label is "Drift 5 Days After Last
Report". The chart door's whole-phrase rule (`_foreign_words`) counted every word of every lexicon phrase as the
product's vocabulary, so "drift" became a known word; "zero" already was, from another column's description. The
made-up name "Zero-Drift Ema" then had no unaccounted word and went on to be BUILT AS A PLAIN EMA with nothing said:
an undisclosed stand-in on a member's request, the thing #2597 fixed for the look-back.

Coordinator's ruling: the words that account for an INDICATOR name come from the indicator vocabulary only. A column
is a number the Screener holds, not a word of a name. Held here AT THE CHART DOOR (its own lexicon, `CHART_LEXICON`,
which carries the named-indicator library: the base planner's lexicon does not, and measuring there is wrong), with
no model call:
  * the finding: "Add the Zero-Drift Ema" is refused as the unknown name "Drift Ema" again, before any call;
  * the CONTROL the ruling asked for: a NEW screener column whose name holds an indicator-ish word does not change
    the verdict on a made-up name that uses that word;
  * a column the request names whole ("the Market Cap") is still understood: its words account for themselves;
  * a checked library indicator whose words only columns also carry (the Positive Volume Index) is still the
    library's, and a description the rule was measured on still passes;
  * #2696's columns are intact.
"""
from __future__ import annotations

import copy

from api.services import ast_table
from api.services import definition_concierge as dc
from api.services import definition_conversation as conv

CHART = {"sym": "NVDA", "tf": "D"}


def _thawed(node):
    """A plain, editable copy of the table (it is served read-only)."""
    if hasattr(node, "items"):
        return {k: _thawed(v) for k, v in node.items()}
    if isinstance(node, (list, tuple)):
        return type(node)(_thawed(v) for v in node)
    return copy.deepcopy(node)


def refusal(message):
    return conv.understand_turn(message, CHART).get("refusal") or {}


def unknown_at_the_chart_door(message, table=None):
    lexicon = conv.CHART_LEXICON if table is None else conv._chart_lexicon(dc.build_lexicon(table))
    p = dc.plan(message, dc.INDICATOR_KIND, lexicon=lexicon, strict_names=True)
    return [n["phrase"] for n in p["not_understood"]]


def test_THE_FINDING_a_made_up_name_with_a_column_word_is_refused_by_name_again():
    r = refusal("Add the Zero-Drift Ema")
    assert r.get("gate") == "concept:ungrounded" and '"Drift Ema" is not an indicator UCT knows by name' in r["reason"]
    # "drift" is carried by a screener column and nothing else, so it is no vocabulary and the name stays unknown;
    # "zero" is one of the door's own description words, which is fine: one unaccounted word refuses the name
    lex = conv.CHART_LEXICON
    (drift,) = dc._stem_key(dc._form_tokens("drift"))[0]
    carriers = [e for key, entries in lex["index"].items() if drift in key for e in entries]
    assert carriers and all(dc._is_column_entry(e) for e in carriers)
    assert drift not in dc._lexicon_vocabulary(lex)
    assert dc._stem_key(dc._form_tokens("zero"))[0][0] in lex["description_words"]


def test_CONTROL_a_new_column_does_not_change_the_verdict_on_a_made_up_name():
    """The ruling's control: a column added tomorrow whose name holds a made-up name's word changes nothing."""
    base = _thawed(ast_table.TABLE)
    with_column = _thawed(ast_table.TABLE)
    with_column[ast_table.SCALARS_SECTION]["quasar_flux_rank"] = "ROW COLUMNS, a test column: a made-up rank."
    message = "Add the Quasar Flux Ema"
    assert unknown_at_the_chart_door(message, base) == unknown_at_the_chart_door(message, with_column) == ["Quasar Flux Ema"]
    # and the new column IS in that lexicon (the control can see what it is testing)
    stems = {s for key in dc.build_lexicon(with_column)["index"] for s in key}
    assert dc._stem_key(dc._form_tokens("quasar"))[0][0] in stems


def test_a_column_the_request_names_whole_is_still_understood():
    for message in ("Show the Market Cap", "Plot the Market Cap", "Add the Market Cap"):
        assert unknown_at_the_chart_door(message) == [], message
        assert refusal(message).get("gate") != "concept:ungrounded", message


def test_a_checked_library_indicator_and_a_measured_description_still_go_on():
    # the Positive Volume Index is a library entry with a checked formula: "positive" and "index" are words only
    # columns carry, and the library names it whole, so it is still the library's
    terms = dc.plan("Add the Positive Volume Index", dc.INDICATOR_KIND, lexicon=conv.CHART_LEXICON, strict_names=True)["terms"]
    assert [t["name"] for t in terms] == ["positive_volume_index"]
    assert refusal("Add the Positive Volume Index") == {}
    assert unknown_at_the_chart_door("Add the Previous Week High And Low") == []


def test_a_description_word_keeps_a_description_understood():
    """"Linear Regression Slope" is a description the whole-phrase rule was measured to let pass; "slope" was known
    only through a column's description. It is one of the door's own DESCRIPTION_WORDS now."""
    assert unknown_at_the_chart_door("Add the Linear Regression Slope") == []
    assert refusal("Add the Linear Regression Slope").get("gate") != "concept:ungrounded"
    (slope,) = dc._stem_key(dc._form_tokens("slope"))[0]
    assert slope in conv.CHART_LEXICON["description_words"] and slope in dc._lexicon_vocabulary(conv.CHART_LEXICON)


def test_the_description_words_are_a_literal_and_a_column_never_adds_one():
    words = conv.DESCRIPTION_WORDS
    assert len(words) == len(set(words)) == 93 and all(w.isalpha() and w == w.lower() for w in words)
    # read off the literal only: a lexicon built from a table with a new column carries the very same words
    with_column = _thawed(ast_table.TABLE)
    with_column[ast_table.SCALARS_SECTION]["quasar_slope_drift"] = "ROW COLUMNS, a test column holding words."
    again = conv._chart_lexicon(dc.build_lexicon(with_column))
    assert again["description_words"] == conv.CHART_LEXICON["description_words"]
    (drift,) = dc._stem_key(dc._form_tokens("drift"))[0]
    assert drift not in again["description_words"] and drift not in dc._lexicon_vocabulary(again)


def test_the_screener_columns_of_2696_are_intact():
    keys = {e["key"] for entries in dc.build_lexicon()["index"].values() for e in entries}
    for column in ("post_earn_drift_5d", "days_to_lockup", "factor_mom", "up_capture_1y"):
        assert column in keys, column
