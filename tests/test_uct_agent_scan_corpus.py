"""The SC-1 discovery corpus stays VALID data (owner: agent-sc). Scoring lives in agent-qa's
tests/test_uct_agent_qa_scan_corpus.py; this file only proves the corpus itself can be scored:
every expected answer parses in the screener's own grammar and names real catalog fields, and every
refusal question really is refused by SC-1. No model, no provider."""
from __future__ import annotations

import json
import pathlib

import pytest

from api.services.screener import filters, grammar, logic
from api.services.uct_agent.scan import spec as scan_spec

CORPUS = pathlib.Path(__file__).resolve().parents[1] / "api/services/uct_agent/scan/eval/discovery.json"
DATA = json.loads(CORPUS.read_text(encoding="utf-8"))
QS = DATA["questions"]
CATALOG = {f["key"] for f in filters.field_catalog()}


def test_shape_and_size():
    assert DATA["version"] and 25 <= len(QS) <= 60
    ids = [q["id"] for q in QS]
    assert len(ids) == len(set(ids))
    for q in QS:
        assert {"id", "category", "nl", "question", "expect", "required_fields", "forbidden_fields",
                "expect_refusal", "tolerance"} <= set(q)
    assert any(q["nl"] for q in QS) and any(q["expect_refusal"] for q in QS)


@pytest.mark.parametrize("q", QS, ids=[q["id"] for q in QS])
def test_every_named_field_is_in_the_live_catalog(q):
    named = set(q["required_fields"]) | set(q["forbidden_fields"]) | set(q["tolerance"])
    assert named <= CATALOG, named - CATALOG


@pytest.mark.parametrize("q", [q for q in QS if not q["expect_refusal"]], ids=lambda q: q["id"])
def test_every_expected_answer_parses_in_the_screeners_grammar(q, monkeypatch):
    monkeypatch.setenv("SCREENER_LOGIC_ENABLED", "1")
    out = grammar.compile_text(q["expect"]["criteria_text"])
    logic.validate(out["logic"])
    scan_spec.validate({"filters": [], "logic": out["logic"]})
    keys = {leaf["key"] for leaf in logic.leaves(out["logic"])}
    assert set(q["required_fields"]) <= keys
    assert not set(q["forbidden_fields"]) & keys


def test_indicator_refusals_are_what_sc1_actually_refuses():
    with pytest.raises(scan_spec.SpecError, match="indicator-condition scans"):
        scan_spec.validate({"filters": [{"key": "scan", "op": "in", "value": ["h"]}]})
    reasons = {q["refusal_reason"] for q in QS if q["expect_refusal"]}
    assert reasons <= {"indicator-condition scans", "the Screener has no field"}
