"""Plain trader English through the chart conversation door, BEFORE any model call.

The model can only author what reaches it. A phrase the deterministic half refuses
costs the member a turn and never reaches the model -- measured 2026-11-01: "show the
Relative Strength Index", "plot the Average True Range" and "plot the Weighted Moving
Average 20" were all refused as unknown named concepts (the planner's Title-Case rule),
although every one names a function closedTable.json declares; the lower-case spelling
of the same request reached the model. The fixture drives the SAME function
``_converse_turn`` runs (``understand_turn``), so nothing here is a replica.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from api.services import definition_conversation as conv

FIXTURE = Path(__file__).resolve().parent / "fixtures/authoring/plain_english_chart_door.json"
DATA = json.loads(FIXTURE.read_text(encoding="utf-8"))
CASES = DATA["cases"]


def _ids(case):
    return case["message"][:60]


@pytest.mark.parametrize("case", CASES, ids=_ids)
def test_a_trader_phrasing_reaches_the_model_or_is_refused_as_pinned(case):
    got = conv.understand_turn(case["message"], DATA["chart"])
    if "refused" in case:
        assert got["refusal"] is not None, "expected a refusal with no model call"
        phrases = [n.get("phrase") for n in got["refusal"].get("not_understood") or []]
        assert case["refused"] in phrases
        return
    assert got["refusal"] is None, got["refusal"]
    assert got["not_understood"] == [], got["not_understood"]
    assert got["request_text"] == case["message"].strip()  # nothing excised
    names = [t["name"] for t in got["terms"]]
    for want in case.get("terms", []):
        assert want in names, names
    for not_want in case.get("not_terms", []):
        assert not_want not in names, names


def test_the_corpus_is_not_vacuous():
    # both verdicts are pinned, and the owner's three examples are first
    assert any("refused" in c for c in CASES) and any(c.get("model") for c in CASES)
    assert sum(1 for c in CASES if c.get("terms")) >= 10
    assert CASES[0]["message"].startswith("Create an indicator that highlights")


def test_understand_turn_is_what_converse_turn_runs():
    """The rail is only worth having if the turn really goes through it."""
    import inspect
    src = inspect.getsource(conv._converse_turn)
    assert "understand_turn(message, chart)" in src
    assert "conversation_preflight.check(" not in src  # no second, drifting copy


def test_every_full_name_word_is_its_own_bucket():
    """A tie in the planner's index matches nothing, so each word names one entry."""
    from api.services import definition_concierge as dc
    for phrase, key in conv.EXPANSION_PHRASES:
        stems, _ = dc._stem_key(dc._form_tokens(phrase))
        assert [r["key"] for r in conv.CHART_LEXICON["index"][stems]] == [key], phrase


def test_the_shared_planner_is_untouched_by_the_chart_words():
    """The full names are a CHART-door vocabulary; /propose and screens keep their own
    lexicon. ⚠️ So /propose still refuses this phrasing -- a RECORDED follow-up
    (docs/indicators/PLAIN-ENGLISH-AUTHORING-2026-11-01.md), not a property to keep."""
    from api.services import definition_concierge as dc
    got = dc.plan("show the Relative Strength Index 14", dc.INDICATOR_KIND)
    assert [n["phrase"] for n in got["not_understood"]] == ["Relative Strength Index"]
