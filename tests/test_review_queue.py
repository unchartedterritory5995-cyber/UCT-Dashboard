"""Wave O §15/§16/§36 — the queue, and why a row is in it.

⛔ A DUE DATE ALONE IS A GENERIC REMINDER. What makes this finance-native is
that the row can say what happened to the RESEARCH since the member last looked
— and that it says it in words rather than as a badge nobody can interrogate.

⛔ TIME IS EXPLICIT (§36). `needsReview` is `review_date <= today`, evaluated in
UTC by `notebook_home._today_iso`. These tests pin the boundary from both sides
rather than trusting whatever today happens to be when the suite runs.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from api.services import auth_db
from api.services.auth_db import get_connection
from api.services.journal_two import notebook_home
from api.services.journal_two import notes as notes_svc
from api.services.journal_two import thesis_evidence as te
from api.services.journal_two import thesis_reviews as tr
from api.services.journal_two import web_capture as wc
from api.services.journal_two import web_capture_store as wcs

# ⛔ A FRESH TENANT PER TEST. Research Home caps `needsReview` at
# `_HOME_SECTION_LIMIT` (5) — correct product behaviour, and fatal to a shared
# fixture user: earlier tests fill the section and a later one's own thesis
# falls off the end, which reads exactly like the queue failing to include it.
# The section limit is the thing under test in no test here, so it must never
# be the thing that decides one.
#: Filled per test by the `tenant` fixture. Module-level names are used by the
#: helpers below, so they must be REBOUND rather than shadowed — and never
#: captured in a default argument, which is how the first attempt silently kept
#: using the original value.
A = "u-queue-a"
B = "u-queue-b"


def _day(offset: int) -> str:
    return (datetime.now(timezone.utc).date() + timedelta(days=offset)).isoformat()


def _thesis(user: str, title: str, review_date: str | None = None,
            status: str | None = None):
    props = {}
    if review_date:
        props["builtin:review_date"] = review_date
    if status:
        props["builtin:thesis_status"] = status
    n = notes_svc.create_note(user, {
        "title": title, "ticker": "NVDA", "tags": ["thesis"],
        "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]},
    })
    if props:
        notes_svc.update_note(user, n["id"], {"properties": props})
    return n


def _attach(user: str, note_id: str, stance: str) -> str:
    tok = "zq" + uuid.uuid4().hex[:8]
    res = wcs.capture_web_source(user, note_id, {
        "tier": wc.TIER_PASSAGE, "url": f"https://www.reuters.com/{tok}",
        "title": "Reuters: NVDA margins",
        "passage": f"Gross margin {tok} normalizes toward the mid-70s.",
        "annotation": "mine"})
    return te.add_evidence(user, note_id, target_type="document_excerpt",
                           target_id=res["excerpt"]["id"], stance=stance)["id"]


def _home(user=None):
    return notebook_home.get_notebook_home(user if user is not None else A)


@pytest.fixture(autouse=True)
def _db():
    auth_db.init_db()
    global A, B
    tenant = uuid.uuid4().hex[:8]
    A, B = f"u-queue-a-{tenant}", f"u-queue-b-{tenant}"


class TestDueSemantics:
    def test_a_date_in_the_past_is_DUE(self):
        _thesis(A, "past due", review_date=_day(-3))
        assert any(n["title"] == "past due" for n in _home()["needsReview"])

    def test_TODAY_is_due_the_boundary_is_inclusive(self):
        # ⛔ §36: `review_date <= today`. Stated as a test so the boundary is a
        # decision rather than whatever the comparison happened to do.
        _thesis(A, "due today", review_date=_day(0))
        assert any(n["title"] == "due today" for n in _home()["needsReview"])

    def test_TOMORROW_is_not_due_yet(self):
        _thesis(A, "upcoming", review_date=_day(1))
        assert not any(n["title"] == "upcoming" for n in _home()["needsReview"])

    def test_a_thesis_with_no_review_date_is_never_in_the_queue(self):
        # ⛔ §17: no magic "older than 30 days is stale". Member intent, or
        # nothing at all.
        _thesis(A, "unscheduled")
        assert not any(n["title"] == "unscheduled" for n in _home()["needsReview"])

    def test_a_CLOSED_thesis_drops_out_even_when_overdue(self):
        _thesis(A, "closed one", review_date=_day(-5), status="closed")
        assert not any(n["title"] == "closed one" for n in _home()["needsReview"])

    def test_another_members_due_thesis_never_appears(self):
        _thesis(B, "B's overdue thesis", review_date=_day(-2))
        assert not any(n["title"] == "B's overdue thesis" for n in _home()["needsReview"])


class TestTheRowExplainsItself:
    def test_a_never_reviewed_due_thesis_says_exactly_that(self):
        _thesis(A, "never reviewed", review_date=_day(-1))
        row = [n for n in _home()["needsReview"] if n["title"] == "never reviewed"][0]
        codes = [r["code"] for r in row["reviewReasons"]]
        assert codes == ["review_due", "never_reviewed"]
        texts = [r["text"] for r in row["reviewReasons"]]
        assert f"review was due {_day(-1)}" in texts
        assert "no completed review yet" in texts

    def test_EVERY_row_states_why_it_is_here_even_with_nothing_changed(self):
        # ⛔ §16. After a clean review with no subsequent changes there is
        # nothing to report about the research — but the row is still in the
        # queue, and a row with an empty explanation is an implied judgement.
        # The member's own scheduled date is the most explainable reason there
        # is, so it always leads.
        n = _thesis(A, "quiet but due", review_date=_day(0))
        r = tr.open_review(A, n["id"])
        tr.complete(A, r["id"], outcome=tr.OUTCOME_NO_CHANGE)
        row = [x for x in _home()["needsReview"] if x["title"] == "quiet but due"][0]
        assert row["reviewReasons"], "a queue row explains nothing at all"
        assert row["reviewReasons"][0]["text"] == "review due today"

    def test_new_opposing_evidence_is_stated_as_a_fact(self):
        n = _thesis(A, "with new opposing", review_date=_day(-1))
        r = tr.open_review(A, n["id"])
        tr.complete(A, r["id"], outcome=tr.OUTCOME_NO_CHANGE)
        _attach(A, n["id"], "opposes")
        row = [x for x in _home()["needsReview"] if x["title"] == "with new opposing"][0]
        texts = [x["text"] for x in row["reviewReasons"]]
        assert "1 opposing evidence item added since your last review" in texts

    def test_the_queue_never_emits_a_priority_or_a_verdict(self):
        # ⛔ §16: no opaque HIGH. If it cannot be explained it is not shown.
        n = _thesis(A, "loud one", review_date=_day(-1))
        r = tr.open_review(A, n["id"])
        tr.complete(A, r["id"], outcome=tr.OUTCOME_NO_CHANGE)
        _attach(A, n["id"], "opposes")
        row = [x for x in _home()["needsReview"] if x["title"] == "loud one"][0]
        blob = str(row["reviewReasons"]).lower()
        for banned in ("priority", "urgent", "weaken", "strengthen", "high", "score"):
            assert banned not in blob

    def test_every_reason_carries_a_sentence_a_member_can_read(self):
        n = _thesis(A, "explained", review_date=_day(-1))
        r = tr.open_review(A, n["id"])
        tr.complete(A, r["id"], outcome=tr.OUTCOME_NO_CHANGE)
        _attach(A, n["id"], "supports")
        row = [x for x in _home()["needsReview"] if x["title"] == "explained"][0]
        assert row["reviewReasons"]
        for reason in row["reviewReasons"]:
            assert reason["text"].strip()

    def test_one_rows_explanation_failing_does_not_cost_the_others(self, monkeypatch):
        # ⛔ THE ENRICHMENT IS BEST-EFFORT PER ROW. Attaching a reason involves
        # extra reads per thesis, and a queue that vanishes because one of them
        # threw would be a worse regression than a row with no explanation.
        #
        # ⚠️ An earlier version of this test corrupted `properties_json` to
        # force the failure. That state is UNREACHABLE — the product only ever
        # writes valid JSON — and the resulting empty section was correct
        # degradation of an impossible input, not a defect. Testing a fiction
        # tells you nothing; this forces the failure at the seam that can
        # actually fail.
        _thesis(A, "healthy", review_date=_day(-1))
        boom = _thesis(A, "explosive", review_date=_day(-1))
        real = notebook_home.review_attention

        def flaky(user_id, note_id, **kw):
            if note_id == boom["id"]:
                raise RuntimeError("attention blew up for this one")
            return real(user_id, note_id, **kw)

        monkeypatch.setattr(notebook_home, "review_attention", flaky,
                            raising=False)
        rows = _home()["needsReview"]
        titles = [n["title"] for n in rows]
        assert "healthy" in titles and "explosive" in titles, (
            "one row's explanation failing removed rows from the queue")
        healthy = [n for n in rows if n["title"] == "healthy"][0]
        exploded = [n for n in rows if n["title"] == "explosive"][0]
        assert healthy["reviewReasons"], "the healthy row lost its explanation too"
        # ⭐ AND THE FAILED ROW DEGRADES RATHER THAN GOING SILENT: it keeps the
        # scheduling reason (which needs no extra read) and loses only the
        # research-change reasons it could not compute. A row that explains
        # nothing at all would be an implied judgement.
        codes = [r["code"] for r in exploded["reviewReasons"]]
        assert codes == ["review_due"]


class TestSchedulingIsOneAuthority:
    def test_the_review_records_the_choice_but_does_not_schedule_it(self):
        # ⛔ The service is pure: `complete` writing a note property is one
        # refactor away from it writing a thesis status (§4/§9). The client
        # sets the schedule explicitly through the canonical note path.
        n = _thesis(A, "unscheduled after review")
        r = tr.open_review(A, n["id"])
        tr.complete(A, r["id"], outcome=tr.OUTCOME_NO_CHANGE,
                    next_review_at=_day(-1))
        assert tr.last_completed(A, n["id"])["nextReviewAt"] == _day(-1)
        props = notes_svc.get_note(A, n["id"])["propertiesJson"] or {}
        assert "builtin:review_date" not in props
        assert not any(x["title"] == "unscheduled after review"
                       for x in _home()["needsReview"])

    def test_and_the_canonical_property_write_is_what_puts_it_in_the_queue(self):
        n = _thesis(A, "scheduled properly")
        r = tr.open_review(A, n["id"])
        tr.complete(A, r["id"], outcome=tr.OUTCOME_NO_CHANGE,
                    next_review_at=_day(-1))
        notes_svc.update_note(A, n["id"],
                              {"properties": {"builtin:review_date": _day(-1)}})
        assert any(x["title"] == "scheduled properly"
                   for x in _home()["needsReview"])
