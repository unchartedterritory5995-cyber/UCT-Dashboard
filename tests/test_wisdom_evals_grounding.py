"""Ask-AI grounding eval rails (W1 §6.4, grounding-v1; stream S-E).

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a missing or truncated question set reported as a score (it is INCONCLUSIVE).
2. a citation to a segment that does not exist counted as valid.
3. a claim with an invented number, or no citation, counted as faithful.
4. 0/0 stored as a value, or the with/without arm lost from the metric row.
5. answer generation spending past its cap, or spending on a dry run.
"""
from __future__ import annotations

import importlib.util
import json
import types
from datetime import datetime

import pytest

from api.services.wisdom import registry
from api.services.wisdom.core import store
from api.services.wisdom.core.timeutil import ET
from api.services.wisdom.evals import grounding

_RETRIEVAL_MODULE = "api.services.wisdom.publish.retrieval"

SEG_A = "a" * 24
SEG_B = "b" * 24


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()
    with store.write() as conn:
        for sid, text in ((SEG_A, "The stop goes under the low of the day at 157 when the flag breaks out."),
                          (SEG_B, "Breadth thrust days follow a washout and the 20 EMA reclaim matters.")):
            conn.execute("INSERT INTO wisdom_segments (segment_id, source_id, source_version, ordinal, kind, text, "
                         "text_sha256, normalizer_version) VALUES (?, 'src', 1, ?, 'section', ?, 'x', 'v0')",
                         (sid, 1 if sid == SEG_A else 2, text))
    return tmp_path / "wisdom.db"


def _set(tmp_path, n=30, **over):
    questions = [{"qid": f"Q{i:02d}", "shape": "principle", "question": f"question {i}",
                  "coverage": {"all_of": ["stop" if i % 2 else "unfindable-term"]}} for i in range(n)]
    data = {"version": grounding.SET_VERSION, "questions": questions}
    data.update(over)
    path = tmp_path / "set.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def _ctx(dry_run=False):
    return registry.JobContext(job_id="t", now_et=datetime(2026, 9, 20, 20, tzinfo=ET), due_key=None, force=True,
                               dry_run=dry_run, run_id="run")


def test_an_absent_question_set_is_inconclusive_never_a_zero(db, tmp_path):
    out = grounding.run_grounding(_ctx(), with_wisdom=False, set_path=tmp_path / "nope.json")
    assert out["status"] == "INCONCLUSIVE" and out["reason"] == "question_set_absent:nope.json"
    with store.read() as conn:
        assert conn.execute("SELECT COUNT(*) FROM wisdom_metrics").fetchone()[0] == 0


def test_a_set_that_is_not_the_fixed_thirty_is_refused(db, tmp_path):
    assert grounding.load_question_set(_set(tmp_path, n=29))[1] == "question_set_invalid:expected_30_questions"
    assert grounding.load_question_set(_set(tmp_path))[1] is None


def test_citations_resolve_or_they_are_invalid_and_claims_are_checked_mechanically(db):
    answer = (f"Put the stop under the low of the day at 157 when the flag breaks out [S:{SEG_A}]. "
              f"Put the stop under the low of the day at 162 when the flag breaks out [S:{SEG_A}]. "
              f"Breadth thrust days follow a washout and a reclaim [S:{'c' * 24}]. "
              "The twenty day line always holds after a washout day.")
    with store.read() as conn:
        out = grounding.check_answer(conn, answer)
    assert (out["cites"], out["valid_cites"]) == (3, 2)
    assert out["claims"] == 4 and out["traceable"] == 1
    assert [d["traceable"] for d in out["claim_detail"]] == [True, False, False, False]
    assert out["claim_detail"][1]["numbers_ok"] is False            # 162 is not in the cited text
    assert out["claim_detail"][2]["why"] == "no_valid_citation"


def test_coverage_is_answerable_from_the_corpus_at_all(db):
    with store.read() as conn:
        assert grounding.coverage_for(conn, {"coverage": {"all_of": ["stop", "flag"]}})["covered"] is True
        assert grounding.coverage_for(conn, {"coverage": {"all_of": ["stop", "washout"]}})["covered"] is False
        assert grounding.coverage_for(conn, {"coverage": {"all_of": ["washout"], "any_of": ["ema", "sma"]}})["covered"]


def test_a_run_without_answers_stores_coverage_and_0_over_0_with_its_arm(db, tmp_path):
    out = grounding.run_grounding(_ctx(), with_wisdom=False, set_path=_set(tmp_path))
    assert (out["coverage"], out["faithfulness"], out["citation_validity"]) == ("15/30", "0/0", "0/0")
    with store.read() as conn:
        rows = {r["metric"]: dict(r) for r in conn.execute("SELECT * FROM wisdom_metrics")}
        runs = conn.execute("SELECT kind, n FROM wisdom_eval_runs").fetchall()
    assert rows["grounding_coverage"]["value"] == 0.5
    assert rows["grounding_faithfulness"]["value"] is None and rows["grounding_citation_validity"]["value"] is None
    assert all(json.loads(r["notes"])["arm"] == "without_wisdom" for r in rows.values())
    assert [tuple(r) for r in runs] == [("grounding:without_wisdom", 30)]


class _Answerer:
    def __init__(self, cap_after=None):
        self.calls, self.cap_after = 0, cap_after

    def answer(self, question, segments):
        if self.cap_after is not None and self.calls >= self.cap_after:
            raise grounding.BudgetExceeded("cap")
        self.calls += 1
        cite = segments[0]["segment_id"] if segments else SEG_A
        return {"text": f"The stop goes under the low of the day at 157 when the flag breaks [S:{cite}]."}

    def usage(self):
        return {"calls": self.calls, "cost_usd": 0.0}


def test_answers_are_generated_only_when_asked_never_on_a_dry_run_and_stop_at_the_cap(db, tmp_path):
    fake = _Answerer()
    dry = grounding.run_grounding(_ctx(dry_run=True), with_wisdom=False, set_path=_set(tmp_path), answerer=fake,
                                  generate_answers=True)
    assert fake.calls == 0 and dry["written"] is False
    capped = _Answerer(cap_after=4)
    out = grounding.run_grounding(_ctx(), with_wisdom=False, set_path=_set(tmp_path), answerer=capped,
                                  generate_answers=True)
    assert out["answers_generated"] == 4 and out["budget_stop"] == "cap"
    assert out["faithfulness"] == "4/4" and out["citation_validity"] == "4/4"


def _hide_retrieval(mp):
    """Make the retrieval module unresolvable to the seam ONLY, leaving every other import alone.

    ⛔ Always through a SCOPED MonkeyPatch context, never the `monkeypatch` fixture + `undo()`:
    the `db` fixture requests that same fixture instance to pin WISDOM_DB_PATH, so an undo here
    would silently unpin the test database along with the hiding.
    """
    real = importlib.util.find_spec
    mp.setattr(
        grounding.importlib.util, "find_spec",
        lambda name, *a, **kw: None if name == _RETRIEVAL_MODULE else real(name, *a, **kw))


def test_the_with_arm_uses_retrieval_when_present_and_says_so_when_absent(db, tmp_path):
    """⚰️ THIS ASSERTED THE REPO'S FILE INVENTORY AS A FACT, and the fact expired on merge.

    It read `assert absent["retrieval"] == "retrieval_module_absent"` against a real, un-faked
    seam — true only while S-F had not yet built `publish/retrieval.py`. The moment S-F2 merged,
    the module resolved and the rail went red for the RIGHT reason in the WRONG place: nothing
    had regressed, the world had simply caught up with the seam's own docstring ("S-F builds the
    module; until then None").

    ⭐ A rail whose subject is "which files exist today" silently changes meaning under a merge.
    This one now DRIVES both branches — absent is forced, present is the real module — so it
    says the same thing before and after S-F, and keeps failing for the only reason that matters:
    the seam answering wrongly about retrieval it was handed.
    """
    with pytest.MonkeyPatch.context() as mp:
        _hide_retrieval(mp)
        absent = grounding.run_grounding(_ctx(dry_run=True), with_wisdom=True, set_path=_set(tmp_path))
    assert absent["retrieval"] == "retrieval_module_absent"
    seen = []

    def search(query, k):
        seen.append(query)
        return [{"segment_id": SEG_B, "text": "x"}]

    out = grounding.run_grounding(_ctx(), with_wisdom=True, set_path=_set(tmp_path), answerer=_Answerer(),
                                  retrieval=search, generate_answers=True)
    assert out["retrieval"] == "injected" and len(seen) == 30
    assert out["citation_validity"] == "30/30"
    assert out["faithfulness"] == "0/30"          # the cited segment does not say what the answer claims


def test_the_seam_can_actually_CALL_the_retrieval_it_reports_ok_for(db):
    """⛔ 6. A SEAM THAT SAYS "ok" FOR A SEARCH IT CANNOT CALL — the one the merge caught.

    S-F's `search` is keyword-only past `query` (`search(query, *, tickers=(), limit=3, ...)`)
    and this seam called `fn(query, k)` positionally. Every question raised TypeError,
    `run_grounding` swallowed it into `retrieval_error`, and the arm carried on with no
    segments — so with_wisdom retrieved NOTHING while the row said `retrieval: ok`, making the
    two arms identical by construction and publishing that as the D-class grounding number.

    ⭐ Status alone cannot say this, which is why the old rail could not have caught it: it
    asserted the string the seam returns, and the seam returned the right string. The load-
    bearing assertion is the CALL — arity is not a shape, and no validator catches it
    (CLAUDE.md, "Contracts — verify against the RUNTIME CALL SITE, not a harness").
    """
    fn, status = grounding.retrieval_seam()
    assert status == "ok", f"the real retrieval module should resolve on this tree: {status}"
    hits = fn("what does the stop rule say about the low of the day", 5)
    assert isinstance(hits, list)                 # must not raise — that was the whole defect
    for hit in hits:
        assert set(hit) == {"segment_id", "text"}, hit


def test_a_retrieval_this_seam_cannot_call_is_REFUSED_BY_NAME_never_reported_ok(db):
    """THE FAILING-DIRECTION CONTROL. The check above passes if the seam is simply correct today;
    it cannot show that a WRONG signature would be caught, and a guard nobody has seen fire is
    not a guard. So hand the seam a search it must refuse.

    ⛔ Refused, not called-and-caught: `retrieval_signature_mismatch` in the status is a fact a
    reader of the metric row can act on, whereas a per-question exception is invisible inside a
    number. An over-REFUSAL is visible; this over-PERMISSION shipped a measurement of nothing.
    """
    hostile = types.ModuleType("fake_retrieval")
    hostile.search = lambda query, k: [{"segment_id": SEG_A, "text": "x"}]   # positional k: not the contract

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(grounding.importlib.util, "find_spec", lambda name, *a, **kw: object())
        mp.setattr(grounding.importlib, "import_module", lambda name: hostile)
        fn, status = grounding.retrieval_seam()
        assert fn is None and status == "retrieval_signature_mismatch", (fn, status)

        # ...and the arm reports that instead of a score it cannot stand behind.
        hostile.search = lambda query, *, limit=3: [{"segment_id": SEG_A, "text": "x"}]
        ok_fn, ok_status = grounding.retrieval_seam()
        assert ok_status == "ok" and ok_fn("q", 2) == [{"segment_id": SEG_A, "text": "x"}]
