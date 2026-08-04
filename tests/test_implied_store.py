import datetime as dt
from unittest.mock import patch

import pytest


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("IMPLIED_STORE_DB", str(tmp_path / "implied.db"))
    import importlib
    from api.services import implied_store
    importlib.reload(implied_store)
    return implied_store


def _payload(pct=6.8):
    return {"pct": pct, "dollar": 12.5, "expiry": "2026-08-07", "strike": 185.0,
            "spot": 184.0, "call_mid": 6.3, "put_mid": 6.2, "iv_atm": 0.6,
            "horizon": "through 2026-08-07", "asof": "2026-08-03T21:00:00+00:00",
            "source": "massive-chain"}


def test_record_implied_first_write_wins(store):
    store.record_implied("TST", "2026-08-06", _payload(6.8), "2026-08-03T21:00:00")
    store.record_implied("TST", "2026-08-06", _payload(9.9), "2026-08-05T21:00:00")
    rows = store.get_implied_history("TST")
    assert len(rows) == 1 and abs(rows[0]["pct"] - 6.8) < 1e-9, \
        "the earliest (furthest-from-print) snapshot is the honest 'implied at the time'"


def test_get_implied_history_newest_report_first(store):
    store.record_implied("TST", "2026-05-06", _payload(4.0), "2026-05-05T21:00:00")
    store.record_implied("TST", "2026-08-06", _payload(6.8), "2026-08-03T21:00:00")
    rows = store.get_implied_history("TST", limit=8)
    assert [r["report_date"] for r in rows] == ["2026-08-06", "2026-05-06"]


def test_grade_snapshots_roundtrip(store):
    store.record_grade("TST", "2026-08-03", "setup", "A-",
                       {"streak": "7/8", "revisions": "21/3", "rs": 94, "iv": "rich"})
    rows = store.get_grade_history("TST", "setup")
    assert rows[0]["grade"] == "A-" and rows[0]["inputs"]["rs"] == 94


def test_run_nightly_capture_stores_only_successes(store):
    reporters = [{"sym": "GOOD", "report_date": "2026-08-06"},
                 {"sym": "BAD", "report_date": "2026-08-06"}]
    def fake_move(sym, report_date=None):
        return _payload() if sym == "GOOD" else None
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store.implied_move, "get_expected_move", side_effect=fake_move):
        summary = store.run_nightly_capture(now=dt.datetime(2026, 8, 3, 16, 40))
    assert summary["captured"] == 1 and summary["failed"] == 1
    assert store.get_implied_history("GOOD") and not store.get_implied_history("BAD"), \
        "a failed fetch must never be stored as a value"


def test_run_nightly_capture_noop_when_no_reporters(store):
    with patch.object(store, "upcoming_reporters", return_value=[]):
        summary = store.run_nightly_capture(now=dt.datetime(2026, 8, 3, 16, 40))
    assert summary == {"captured": 0, "skipped": 0, "failed": 0}


def test_run_nightly_capture_isolates_a_raising_reporter(store):
    reporters = [{"sym": "OK1", "report_date": "2026-08-06"},
                 {"sym": "BOOM", "report_date": "2026-08-06"},
                 {"sym": "OK2", "report_date": "2026-08-06"}]
    def fake_move(sym, report_date=None):
        if sym == "BOOM":
            raise RuntimeError("chain exploded")
        return _payload()
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store.implied_move, "get_expected_move", side_effect=fake_move):
        summary = store.run_nightly_capture(now=dt.datetime(2026, 8, 3, 16, 40))
    assert summary == {"captured": 2, "skipped": 0, "failed": 1}
    assert store.get_implied_history("OK2"), "reporters after the raiser must still capture"
