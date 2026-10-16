"""The trader archive in the Ask AI exam: two mechanical checks and the fast-lane translation.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. an archive-grounded answer that cites no record id passing an armed question;
2. an answer citing a record id the archive tools never returned (a fabricated source) passing;
3. either flag failing a question that did not arm it;
4. the fast lane's archive grounding not reaching the checks as the archive tools, with the
   attached citations as their evidence.
Synthetic record ids only: the repo is public.
"""
from __future__ import annotations

from api.services.ai_search_eval import golden_set, runner
from api.services.compass_eval import checks

ARMED = {"question": "x", "must_call_tools": [], "forbidden": ["archive_uncited", "archive_fabricated_record"]}
FIRED = [{"name": "trader_archive_search", "args": {}, "result": {"results": [{"record_id": "t9101"}]}}]


def _fails(answer, fired=FIRED, q=ARMED):
    return checks.run_mechanical_checks({"answer": answer, "fired_tools": fired, "question": q})["auto_fails"]


def test_an_archive_answer_with_no_record_id_fails_an_armed_question():
    assert _fails("The team liked this name last spring.") == ["archive_uncited"]


def test_a_record_id_the_tools_never_returned_is_a_fabricated_source():
    assert _fails("TSDR called it (TSDR, 2025-01-02, t9999).") == ["archive_fabricated_record"]
    assert _fails("TSDR called it (t9101) and again (t9999).") == ["archive_fabricated_record"]


def test_a_returned_record_id_passes_and_no_archive_tool_means_no_check():
    assert _fails("TSDR called it (TSDR, 2025-01-02, t9101).") == []                 # control
    assert _fails("No archive here.", fired=[{"name": "get_quote", "result": "X 1.00"}]) == []


def test_the_flags_are_notes_until_a_question_arms_them():
    out = checks.run_mechanical_checks({"answer": "nothing cited", "fired_tools": FIRED,
                                        "question": {"question": "x", "forbidden": []}})
    assert out["auto_fails"] == [] and "unarmed flag: archive_uncited" in out["notes"]


def test_the_fast_lane_hands_the_archive_citations_to_the_checks():
    meta = {"grounding_sources": ["trader_archive_playbook", "quote"], "ctx_block": "DESK",
            "archive_citations": [{"record_id": "t9101", "kind": "trader_archive_playbook"}]}
    cap = {c["name"]: c for c in runner._fast_lane_capture(meta, {})}
    assert cap["trader_archive_setup"]["result"] == meta["archive_citations"]
    assert cap["get_quote"]["result"] == "DESK"                                        # control: packs unchanged
    meta2 = {"grounding_sources": ["trader_archive"], "archive_citations": [{"record_id": "t9102"}]}
    cap2 = runner._fast_lane_capture(meta2, {})
    assert [c["name"] for c in cap2] == ["trader_archive_search", "trader_archive_ticker"]   # one pack, both readers
    assert _fails("cited t9102", fired=cap2) == []


def test_the_golden_set_arms_both_checks_on_its_archive_questions():
    qs = {q["id"]: q for q in golden_set.load_golden_set()}
    for qid in ("S1-09-archive-ticker", "S2-07-archive-playbook"):
        assert {"archive_uncited", "archive_fabricated_record"} <= set(qs[qid]["forbidden"]), qid
        assert any(set(g) & checks.ARCHIVE_TOOLS for g in qs[qid]["must_call_tools"]), qid
