"""D-4 transcript chapters + the recap review label. Recorded-shape fixtures, no network.

Rails:
  * the chapter tree obeys the containment invariant on every fixture;
  * Q&A chapters exist ONLY when the transcript states the boundary;
  * a question chapter opens on an OUTSIDE speaker and carries the operator hand-off;
  * dark: no `chapters`, no `review_status` while the flag is unset.
"""
from __future__ import annotations

import pytest

from api.services import transcript_chapters as tc
from api.services.call_recap_grounded import prepared_remarks_end


def _seg(who, text="..."):
    return {"speaker": who, "title": "", "content": text}


# The FMP segment shape (speaker/title/content), the order a real call runs in.
CALL = [
    _seg("Operator", "Good afternoon and welcome to the call."),
    _seg("Jane Ir", "Thank you. With me today are our CEO and CFO."),
    _seg("Tim Ceo", "We had a record quarter."),
    _seg("Tim Ceo", "Services grew."),
    _seg("Kevin Cfo", "Gross margin was 46%."),
    _seg("Operator", "We will now begin the question-and-answer session."),
    _seg("Operator", "Our first question comes from Amy Analyst with Big Bank."),   # 6
    _seg("Amy Analyst", "Can you talk about China?"),
    _seg("Tim Ceo", "China was strong."),
    _seg("Amy Analyst", "And a follow-up on margins?"),
    _seg("Kevin Cfo", "Margins held."),
    _seg("Operator", "Next question, Bob Analyst with Small Bank."),                # 11
    _seg("Bob Analyst", "What about AI?"),
    _seg("Tim Ceo", "We are investing."),
    _seg("Operator", "This concludes the call."),
]
NO_QA = [_seg("Operator", "Welcome."), _seg("Satya Ceo", "Strong quarter."), _seg("Amy Hood", "Revenue up."),
         _seg("Amy Hood", "Margins up."), _seg("Some Analyst", "Question?"), _seg("Satya Ceo", "Answer.")]


class TestTree:
    def test_containment_holds_on_a_call_that_states_its_qa(self):
        qa = prepared_remarks_end(CALL)
        assert qa == 6
        tree = tc.chapters(CALL, qa)
        assert tc.check_containment(tree, len(CALL)) == []
        assert tree["qa_boundary"] == "stated"
        assert [c["title"] for c in tree["chapters"]] == ["Prepared remarks", "Q&A"]

    def test_each_question_opens_on_an_outsider_with_its_operator_handoff(self):
        tree = tc.chapters(CALL, prepared_remarks_end(CALL))
        qs = tree["chapters"][1]["children"]
        assert [(c["title"], c["start"], c["end"]) for c in qs] == [
            ("Question from Amy Analyst", 6, 10),
            ("Question from Bob Analyst", 11, 14),
        ]

    def test_prepared_remarks_runs_by_speaker_with_the_lead_operator_folded_in(self):
        tree = tc.chapters(CALL, prepared_remarks_end(CALL))
        runs = tree["chapters"][0]["children"]
        assert [(c["title"], c["start"], c["end"]) for c in runs] == [
            ("Jane Ir", 0, 1), ("Tim Ceo", 2, 3), ("Kevin Cfo", 4, 5),
        ]

    def test_an_unstated_boundary_gets_no_qa_chapter_at_all(self):
        assert prepared_remarks_end(NO_QA) is None
        tree = tc.chapters(NO_QA, None)
        assert tree["qa_boundary"] == "not_stated"
        kinds = {c["kind"] for c in tree["chapters"]} | {ch["kind"] for c in tree["chapters"] for ch in c["children"]}
        assert "qa" not in kinds and "question" not in kinds
        assert tc.check_containment(tree, len(NO_QA)) == []

    def test_the_invariant_checker_can_fail(self):
        tree = tc.chapters(CALL, 6)
        tree["chapters"][1]["children"][0]["start"] = 7     # a gap inside Q&A
        assert tc.check_containment(tree, len(CALL))

    def test_empty_and_out_of_range_boundaries(self):
        assert tc.chapters([], 3) == {"qa_boundary": "not_stated", "chapters": []}
        assert tc.chapters(CALL, len(CALL))["qa_boundary"] == "not_stated"
        assert tc.chapters(CALL, 0)["qa_boundary"] == "not_stated"


@pytest.fixture
def router(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers import earnings_intel as r
    monkeypatch.setattr(r, "resolve_entity", lambda s: ({"symbol": s}, None))
    monkeypatch.setattr(r, "get_fmp_transcript",
                        lambda s, quarter=None: {"symbol": s, "quarter": "2026Q3", "segments": [dict(x) for x in CALL]})
    monkeypatch.setattr(r, "get_call_recap_with_status",
                        lambda s, quarter=None: ({"headline": "h", "webcast_url": None, "rating_changes": []}, "ready"))
    app = FastAPI()
    app.include_router(r.router)
    app.dependency_overrides[r.require_paid] = lambda: {"id": "u1"}
    return TestClient(app)


class TestDarkPayloads:
    def test_dark_the_transcript_and_recap_carry_nothing_new(self, router, monkeypatch):
        monkeypatch.delenv(tc.ENABLED_ENV, raising=False)
        t = router.get("/api/earnings/transcript/AAPL").json()
        assert "chapters" not in t and t["prepared_remarks_end"] == 6
        assert "review_status" not in router.get("/api/earnings/call-recap/AAPL").json()

    def test_armed_the_transcript_carries_chapters_and_the_recap_its_status(self, router, monkeypatch):
        monkeypatch.setenv(tc.ENABLED_ENV, "1")
        t = router.get("/api/earnings/transcript/AAPL").json()
        assert t["chapters"]["qa_boundary"] == "stated"
        assert t["chapters"]["chapters"][1]["start"] == t["prepared_remarks_end"]
        assert router.get("/api/earnings/call-recap/AAPL").json()["review_status"] == "ai_unreviewed"

    def test_armed_no_recap_no_status(self, router, monkeypatch):
        from api.routers import earnings_intel as r
        monkeypatch.setenv(tc.ENABLED_ENV, "1")
        monkeypatch.setattr(r, "get_call_recap_with_status", lambda s, quarter=None: (None, "generating"))
        assert "review_status" not in router.get("/api/earnings/call-recap/AAPL").json()
