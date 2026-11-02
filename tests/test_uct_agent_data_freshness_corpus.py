"""The MD-1 freshness corpus stays VALID data (owner: agent-md). Scoring lives with agent-qa; this file only
proves the corpus itself can be scored: every fixture envelope conforms to MD-1 and to its registered kind,
every expectation is derivable from that envelope, and the corpus covers every freshness class and failure
shape. No model, no provider.

The corpus asks PRESENT-TENSE questions ("right now", "today", "currently") on purpose: those are the
questions where an answer is most tempted to call periodic or historical data "live".
"""
from __future__ import annotations

import json
import pathlib
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw

CORPUS = pathlib.Path(__file__).resolve().parents[1] / "api/services/uct_agent/marketdata/eval/freshness.json"
DATA = json.loads(CORPUS.read_text(encoding="utf-8"))
QS = DATA["questions"]
ET = ZoneInfo("America/New_York")


def _ids(q):
    return q["id"]


def test_shape_and_size():
    assert DATA["version"] and DATA["contract"].startswith("MD-1") and 20 <= len(QS) <= 60
    ids = [q["id"] for q in QS]
    assert len(ids) == len(set(ids))
    for q in QS:
        assert {"id", "category", "kind", "purpose", "question", "envelope", "expect", "expect_refusal",
                "flags"} <= set(q)
        assert set(q["expect"]) == {"freshness_class", "as_of_renderings", "may_claim_live", "must_disclose_stale",
                                    "must_say_unavailable", "must_not_state_a_value", "must_disclose",
                                    "as_of_null_reason_required"}
    for key in ("live_words", "stale_words", "unavailable_words"):
        assert DATA[key] and all(isinstance(w, str) and w == w.lower() for w in DATA[key])


@pytest.mark.parametrize("q", QS, ids=_ids)
def test_every_fixture_is_a_valid_envelope_of_a_registered_kind(q):
    e = q["envelope"]
    assert env.validate_envelope(e) == []
    assert e["kind"] == q["kind"] and e["fetched_at"] == DATA["now"]
    k = gw.registry().get(q["kind"])
    assert k is not None, q["kind"]
    if e["status"] in ("ok", "partial"):
        # a read may be LESS fresh than its kind declares, never fresher (MD-1 §3) — same rule as the gateway
        assert env.FRESHNESS.index(e["freshness"]) >= env.FRESHNESS.index(k.freshness)


@pytest.mark.parametrize("q", QS, ids=_ids)
def test_expectations_are_derived_from_the_envelope(q):
    e, x = q["envelope"], q["expect"]
    assert x["freshness_class"] == e["freshness"]
    assert x["may_claim_live"] == (e["freshness"] == "live" and not e["stale"])
    assert x["must_disclose_stale"] == (bool(e["stale"]) and e["status"] in ("ok", "partial"))
    assert x["must_say_unavailable"] == x["must_not_state_a_value"] == (e["status"] in ("unavailable", "refused"))
    assert x["as_of_null_reason_required"] == (e["as_of"] is None and e["status"] in ("ok", "partial"))
    if e["as_of"]:
        d = datetime.fromisoformat(e["as_of"].replace("Z", "+00:00")).astimezone(ET)
        assert d.date().isoformat() in x["as_of_renderings"]           # the ISO date is always accepted
    else:
        assert x["as_of_renderings"] == []
    # every required disclosure is TRUE of this envelope: it appears in its notes or data
    blob = (" ".join(e["notes"]) + " " + json.dumps(e["data"], ensure_ascii=False)).lower()
    for phrase in x["must_disclose"]:
        assert phrase.lower() in blob, (q["id"], phrase)


@pytest.mark.parametrize("q", [q for q in QS if q["expect_refusal"]], ids=_ids)
def test_refusal_questions_are_what_the_gateway_actually_refuses(q, monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    # #621: only activated kinds are served at all; activate exactly the one under test, so the refusal comes from
    # the isolation rules (dormant default / purpose gate), never from the kind simply being off
    monkeypatch.setenv(gw.KINDS_ENV, q["kind"])
    monkeypatch.delenv(gw.ISOLATED_ENV, raising=False)
    for k, v in q["flags"].items():
        monkeypatch.setenv(k, v)
    gw._reset_for_test(None)
    out = gw.read(q["kind"], q["envelope"]["params_echo"], user_id=1, turn_id="corpus", purpose=q["purpose"])
    assert out["status"] == "refused" and out["notes"] == q["envelope"]["notes"]
    gw._reset_for_test(None)


def test_model_isolated_kinds_appear_only_as_answer_or_as_refusals():
    for q in QS:
        k = gw.registry().get(q["kind"])
        if k.model_isolated and not q["expect_refusal"]:
            # a served isolated answer only exists with the isolation flag on (ADR-005: dormant by default)
            assert q["purpose"] == "answer", q["id"]


def test_the_dormant_default_and_the_purpose_gate_are_both_covered():
    iso = [q for q in QS if q["expect_refusal"] and gw.registry().get(q["kind"]).model_isolated]
    assert any(not q["flags"] for q in iso)                                  # dormant: no isolation flag
    assert any(q["flags"].get(gw.ISOLATED_ENV) == "1" and q["purpose"] != "answer" for q in iso)


def test_coverage_of_classes_and_failure_shapes():
    cls = {q["envelope"]["freshness"] for q in QS}
    assert {"live", "periodic", "historical", "unavailable"} <= cls
    shapes = {q["category"] for q in QS}
    assert {"live", "live-stale", "closed", "extended", "partial", "unavailable", "historical",
            "historical-stale", "periodic", "periodic-stale", "as_of-null", "scheduled-event",
            "empty-not-stale", "isolation", "isolation-dormant"} <= shapes
    # every registered agent-md kind is exercised at least once
    mine = {d["kind"] for d in gw.describe() if d["owner"] == "agent-md"}
    assert mine <= {q["kind"] for q in QS}, mine - {q["kind"] for q in QS}
    # present tense, on purpose
    present = ("now", "today", "current", "latest", "this quarter", "this week", "premarket", "next")
    assert sum(any(w in q["question"].lower() for w in present) for q in QS) >= len(QS) - 2


def test_the_live_word_list_never_marks_a_non_live_read_as_allowed():
    for q in QS:
        if q["expect"]["may_claim_live"]:
            assert q["envelope"]["freshness"] == "live" and not q["envelope"]["stale"]


def test_the_corpus_file_is_exactly_what_the_builder_produces():
    """The JSON is generated, never hand-edited: it quotes the adapters' note constants, so a changed note must
    regenerate the corpus (`python -m api.services.uct_agent.marketdata.eval.build_freshness`)."""
    from api.services.uct_agent.marketdata.eval import build_freshness
    assert CORPUS.read_text(encoding="utf-8") == build_freshness.build()
