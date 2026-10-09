"""_enrich_with_rating_changes must tolerate a non-dict grades payload.

Production logs (2026-10-08) showed every catalyst refresh failing this step with
"'str' object has no attribute 'get'". The step is display-only, so a bad payload
must skip the row, never raise.
"""
import datetime as dt

from api.services.catalyst import engine


def _run(monkeypatch, payload):
    monkeypatch.setenv("CATALYST_RATINGS_SIGNAL_ENABLED", "1")
    import api.services.analyst_grades as ag
    monkeypatch.setattr(ag, "get_analyst_grades", lambda sym: payload)
    rows = [{"ticker": "AMD"}]
    engine._enrich_with_rating_changes(rows)
    return rows


def test_a_string_payload_is_skipped(monkeypatch):
    assert _run(monkeypatch, "rate limited") == [{"ticker": "AMD"}]


def test_string_entries_in_recent_actions_are_skipped(monkeypatch):
    today = dt.date.today().isoformat()
    rows = _run(monkeypatch, {"recent_actions": ["oops", {"action": "upgrade", "date": today,
                                                          "company": "X", "to_grade": "Buy"}]})
    assert rows[0]["rating_change"]["action"] == "upgrade"


def test_a_non_list_recent_actions_is_skipped(monkeypatch):
    assert _run(monkeypatch, {"recent_actions": "none"}) == [{"ticker": "AMD"}]
