"""Ask-AI grounding eval rails (W1 §6.4, grounding-v1; stream S-E).

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a missing or truncated question set reported as a score (it is INCONCLUSIVE).
2. a citation to a segment that does not exist counted as valid.
3. a claim with an invented number, or no citation, counted as faithful.
4. 0/0 stored as a value, or the with/without arm lost from the metric row.
5. answer generation spending past its cap, or spending on a dry run.
"""
from __future__ import annotations

import json
from datetime import datetime

import pytest

from api.services.wisdom import registry
from api.services.wisdom.core import store
from api.services.wisdom.core.timeutil import ET
from api.services.wisdom.evals import grounding

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


def test_the_with_arm_uses_retrieval_when_present_and_says_so_when_absent(db, tmp_path):
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
