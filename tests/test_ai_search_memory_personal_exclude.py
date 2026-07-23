"""Task 7: ai_search_memory ingest excludes the explicit `personal` flag —
an independent backstop behind invariant #2 ("the personal branch never logs
at all"). A row that somehow carries personal=1 (even with first_person=0)
must never be eligible for house-brain ingest."""
from api.services import ai_search_memory as M, ai_search_log as L


def test_personal_rows_never_ingested(tmp_path, monkeypatch):
    monkeypatch.setenv("AI_SEARCH_LOG_DB_PATH", str(tmp_path / "l.db"))
    L._reset_for_test()
    # "what is..." matches the evergreen classifier regex; no recency/live-source
    # grounding given, so classify_freshness() lands on 'evergreen'.
    L.log(query="what is nvda's business model", answer="evergreen-ish", personal=1,
          answer_kind="ok")
    assert all(r.get("personal") != 1 for r in M._eligible_rows(str(tmp_path / "l.db"), set()))
