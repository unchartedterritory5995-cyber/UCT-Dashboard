"""Tests for Task 6: tiered grounding coverage + content-free personal counter +
query-text skip in api/services/ai_search_log.py."""
from api.services import ai_search_log as L


def test_tier_excludes_ambient_regime():
    assert L._grounding_tier({"regime"}) == "web-only"          # regime is ambient
    assert L._grounding_tier({"regime", "recency"}) == "web-only"
    assert L._grounding_tier({"regime", "quote"}) == "desk-grounded"   # real proprietary source
    assert L._grounding_tier(set()) == "web-only"


def test_personal_counter_is_content_free(tmp_path, monkeypatch):
    monkeypatch.setenv("AI_SEARCH_LOG_DB_PATH", str(tmp_path / "l.db"))
    L._reset_for_test()
    L.record_personal_invocation(degraded=False)
    L.record_personal_invocation(degraded=True)
    ins = L.insights(days=7)
    assert ins["personal"]["invocations"] == 2
    assert ins["personal"]["degraded"] == 1
    # no query/answer columns exist on the counter table
    assert "query" not in ins["personal"]


def test_log_skips_query_text_when_flagged(tmp_path, monkeypatch):
    monkeypatch.setenv("AI_SEARCH_LOG_DB_PATH", str(tmp_path / "l.db"))
    L._reset_for_test()
    L.log(query="should i sell my 500 NVDA at 200", answer="a", skip_query_text=True)
    rows = L._all_rows_for_test()
    assert rows and rows[0]["query"] in ("", None)             # raw text not persisted
