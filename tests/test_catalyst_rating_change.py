"""Tests for the display-only catalyst rating-change signal (FMP Ultimate, gated)."""
import importlib


def _store(monkeypatch, tmp_path):
    monkeypatch.setenv("CATALYST_DB_PATH", str(tmp_path / "cat.db"))
    import api.services.catalyst.store as store
    importlib.reload(store)
    store._init_db()
    return store


def test_store_roundtrips_rating_change_as_object(monkeypatch, tmp_path):
    store = _store(monkeypatch, tmp_path)
    import json
    store.upsert_catalyst({
        "market_date": "2026-06-29", "ticker": "AAPL", "rank": 1, "score": 50.0,
        "tag": "Catalyst", "price": 300, "gap_pct": 1.0, "vol_x": 2.0,
        "market_cap": 3e12, "sector": "Tech", "thesis_text": "x", "thesis_model": "m",
        "thesis_at": 1, "thesis_sources": "[]", "signals_hash": "h", "catalyst_at": 1,
        "raw_signals": "{}",
        "rating_change": json.dumps({"action": "upgrade", "company": "Morgan Stanley",
                                     "from_grade": "Hold", "to_grade": "Buy", "date": "2026-06-27"}),
    })
    rows = store.get_for_date("2026-06-29")
    assert len(rows) == 1
    rc = rows[0]["rating_change"]
    assert isinstance(rc, dict)                       # parsed back to an object
    assert rc["action"] == "upgrade" and rc["to_grade"] == "Buy"


def test_store_null_rating_change_is_none(monkeypatch, tmp_path):
    store = _store(monkeypatch, tmp_path)
    store.upsert_catalyst({
        "market_date": "2026-06-29", "ticker": "ZZ", "rank": 1, "score": 1.0,
        "tag": "News", "price": 10, "gap_pct": 0.0, "vol_x": 1.0, "market_cap": 1e9,
        "sector": "Tech", "thesis_text": "x", "thesis_model": "m", "thesis_at": 1,
        "thesis_sources": "[]", "signals_hash": "h", "catalyst_at": 1, "raw_signals": "{}",
    })
    assert store.get_for_date("2026-06-29")[0]["rating_change"] is None


def test_enrich_gated_off_by_default(monkeypatch):
    import api.services.catalyst.engine as eng
    called = {"n": 0}
    monkeypatch.setattr("api.services.analyst_grades.get_analyst_grades",
                        lambda t: called.__setitem__("n", called["n"] + 1) or None)
    top = [{"ticker": "AAPL"}]
    eng._enrich_with_rating_changes(top)             # flag unset
    assert "rating_change" not in top[0]
    assert called["n"] == 0                          # no analyst call when gated off


def test_enrich_attaches_recent_upgrade_when_enabled(monkeypatch):
    import datetime as dt
    import api.services.catalyst.engine as eng
    monkeypatch.setenv("CATALYST_RATINGS_SIGNAL_ENABLED", "1")
    recent = (dt.date.today() - dt.timedelta(days=3)).isoformat()
    old = (dt.date.today() - dt.timedelta(days=60)).isoformat()

    def fake_grades(ticker):
        return {"recent_actions": [
            {"action": "maintain", "company": "Evercore", "date": recent,
             "from_grade": "Buy", "to_grade": "Buy"},                     # skipped (maintain)
            {"action": "downgrade", "company": "KGI", "date": old,
             "from_grade": "Buy", "to_grade": "Hold"},                    # skipped (>14d)
            {"action": "upgrade", "company": "Morgan Stanley", "date": recent,
             "from_grade": "Hold", "to_grade": "Buy"},                    # ← chosen
        ]}

    monkeypatch.setattr("api.services.analyst_grades.get_analyst_grades", fake_grades)
    top = [{"ticker": "AAPL"}]
    eng._enrich_with_rating_changes(top)
    rc = top[0].get("rating_change")
    assert rc and rc["action"] == "upgrade" and rc["company"] == "Morgan Stanley"
    assert rc["date"] == recent


def test_enrich_no_qualifying_action_attaches_nothing(monkeypatch):
    import datetime as dt
    import api.services.catalyst.engine as eng
    monkeypatch.setenv("CATALYST_RATINGS_SIGNAL_ENABLED", "1")
    old = (dt.date.today() - dt.timedelta(days=90)).isoformat()
    monkeypatch.setattr("api.services.analyst_grades.get_analyst_grades",
                        lambda t: {"recent_actions": [
                            {"action": "downgrade", "company": "X", "date": old,
                             "from_grade": "Buy", "to_grade": "Sell"}]})
    top = [{"ticker": "AAPL"}]
    eng._enrich_with_rating_changes(top)
    assert "rating_change" not in top[0]              # only stale → nothing attached
