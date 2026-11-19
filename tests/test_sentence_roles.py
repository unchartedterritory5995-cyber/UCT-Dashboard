"""THE READ-BACK NAMES A BAR-FIELD ARGUMENT BY ITS ROLE (engine 81, 2026-11-18).

`stoch`, `atr`, `adx`, `cci`, `mfi` and the Donchian lines take the bar's fields by POSITION: high,
low, close. `stoch(close, high, low, 14)`, another vendor's order written from habit, computed a
different number on every bar and read "the 14-bar stochastic %K of close, high and low": a natural
sentence, shown to the member as what they had asked for.

The cases are shared with the browser's writer (`tests/fixtures/ast/sentence_roles.json`, read by
`engine/ast/sentenceRoles.test.js`), so the two sentence writers cannot part.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from api.services import ast_interpret
from api.services import definition_concierge as dc

SERIES = dc.SENTENCE_RULES["series"]
DOC = json.loads((Path(__file__).parent / "fixtures" / "ast" / "sentence_roles.json").read_text(encoding="utf-8"))
S = lambda n: {"type": "series", "name": n}  # noqa: E731
num = lambda v: {"type": "num", "value": v}  # noqa: E731
call = lambda name, *a: {"type": "call", "name": name, "args": list(a)}  # noqa: E731


@pytest.mark.parametrize("case", DOC["cases"], ids=[c["formula"] for c in DOC["cases"]])
def test_both_writers_give_this_sentence(case):
    assert dc.sentence_for(case["tree"]) == case["sentence"]
    if case["kind"] == "unchanged":
        assert " from " not in case["sentence"]
    else:
        assert any(f"{word} from " in case["sentence"] for word in ("highs", "lows", "closes"))


def test_the_order_that_computes_another_number_no_longer_reads_like_the_request():
    right = dc.sentence_for(call("stoch", S("high"), S("low"), S("close"), num(14)))
    wrong = dc.sentence_for(call("stoch", S("close"), S("high"), S("low"), num(14)))
    assert right == "the 14-bar stochastic %K of high, low and close"                  # byte for byte what it was
    assert wrong == "the 14-bar stochastic %K of highs from close, lows from high and closes from low"
    assert wrong != DOC["before"]["stoch(close, high, low, 14)"]


def test_the_unchanged_cases_are_what_the_template_alone_gives():
    """CONTROL on "unchanged": with the bar's fields in order the sentence is the manifest's template
    filled in, nothing added. (A rule that renamed every argument would fail here.)"""
    for case in DOC["cases"]:
        if case["kind"] != "unchanged":
            continue
        name = case["tree"]["name"]
        template = ast_interpret.TABLE["functions"][name]["sentence"]
        args = case["tree"]["args"]
        said = template
        for i, a in enumerate(args):
            said = said.replace("{%d}" % i, a["name"] if a["type"] == "series" else str(a["value"]))
        assert case["sentence"] == said, case["formula"]


def test_the_roles_are_the_tables_own_and_one_series_functions_are_never_touched():
    for name, spec in ast_interpret.TABLE["functions"].items():
        lead = dc._bar_field_lead({"arg_roles": spec.get("argRoles") or []}, SERIES)
        roles = list(spec.get("argRoles") or [])
        if lead:
            assert roles[:len(lead)] == lead and len(lead) >= 2, name
    assert dc._bar_field_lead({"arg_roles": ["source", "period"]}, SERIES) is None
    assert dc._bar_field_lead({"arg_roles": ["high", "period"]}, SERIES) is None       # one field: no order to get wrong
    assert dc._bar_field_lead({"arg_roles": ["high", "low", "close", "period"]}, SERIES) == ["high", "low", "close"]
    assert " from " not in dc.sentence_for(call("ema", S("high"), num(20)))
