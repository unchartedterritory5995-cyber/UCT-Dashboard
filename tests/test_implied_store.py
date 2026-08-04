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
    # now = 2026-08-03T16:40 -> today = 2026-08-03; window default = 1 day, so
    # 2026-08-04 (tomorrow) is in-window.
    reporters = [{"sym": "GOOD", "report_date": "2026-08-04", "hour": "amc"},
                 {"sym": "BAD", "report_date": "2026-08-04", "hour": "amc"}]
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
    reporters = [{"sym": "OK1", "report_date": "2026-08-04", "hour": "amc"},
                 {"sym": "BOOM", "report_date": "2026-08-04", "hour": "amc"},
                 {"sym": "OK2", "report_date": "2026-08-04", "hour": "amc"}]
    def fake_move(sym, report_date=None):
        if sym == "BOOM":
            raise RuntimeError("chain exploded")
        return _payload()
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store.implied_move, "get_expected_move", side_effect=fake_move):
        summary = store.run_nightly_capture(now=dt.datetime(2026, 8, 3, 16, 40))
    assert summary == {"captured": 2, "skipped": 0, "failed": 1}
    assert store.get_implied_history("OK2"), "reporters after the raiser must still capture"


def test_run_nightly_capture_window_and_bmo_today_skip(store):
    """C1: the capture window narrows to [today, today+WINDOW]; a report_date
    before today is silently filtered (never counted), a report_date == today
    with hour == 'bmo' is skipped (counted — already reported this morning),
    and an amc-today or tomorrow reporter still captures (the T-1/T-0-pre-
    report write)."""
    now = dt.datetime(2026, 8, 3, 21, 0)  # today = 2026-08-03
    reporters = [
        {"sym": "PAST", "report_date": "2026-08-02", "hour": "amc"},
        {"sym": "BMOTODAY", "report_date": "2026-08-03", "hour": "bmo"},
        {"sym": "AMCTODAY", "report_date": "2026-08-03", "hour": "amc"},
        {"sym": "TOMORROW", "report_date": "2026-08-04", "hour": "bmo"},
    ]
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store.implied_move, "get_expected_move", side_effect=lambda sym, report_date=None: _payload()):
        summary = store.run_nightly_capture(now=now)
    assert summary["captured"] == 2, "amc-today and tomorrow reporters must capture"
    assert summary["skipped"] == 1, "only the bmo-today reporter counts as skipped"
    assert summary["failed"] == 0
    assert store.get_implied_history("AMCTODAY")
    assert store.get_implied_history("TOMORROW")
    assert not store.get_implied_history("BMOTODAY"), \
        "bmo-today must never be captured — it would store an IV-crushed value"
    assert not store.get_implied_history("PAST"), \
        "a report_date before today must be filtered out, not captured"


def test_run_nightly_capture_defaults_now_to_et_with_tz_aware_captured_at(store, monkeypatch):
    """I6: the production default path (no `now` arg) must use ET, and the
    stored captured_at must be tz-aware — not silently untested because every
    other test injects a naive `now`."""
    report_date = dt.datetime.now(store._ET).date().isoformat()  # today, amc -> in-window, not the bmo-today skip
    reporters = [{"sym": "DEFNOW", "report_date": report_date, "hour": "amc"}]
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store.implied_move, "get_expected_move", return_value=_payload()):
        summary = store.run_nightly_capture()
    assert summary["captured"] == 1
    rows = store.get_implied_history("DEFNOW")
    assert rows, "the in-window reporter must have captured"
    parsed = dt.datetime.fromisoformat(rows[0]["captured_at"])
    assert parsed.tzinfo is not None, "captured_at must be tz-aware when now is defaulted"


def test_get_earliest_report_date(store):
    store.record_implied("TST", "2026-05-06", _payload(4.0), "2026-05-05T21:00:00")
    store.record_implied("TST", "2026-08-06", _payload(6.8), "2026-08-03T21:00:00")
    assert store.get_earliest_report_date("TST") == "2026-05-06"
    assert store.get_earliest_report_date("NOPE") is None


def test_record_implied_and_history_canonicalize_class_share_symbol(store):
    """C2: the canonical store form is upper+hyphen (BRK-B), matching the
    repo-wide groups.py/theme_index.py convention — a dot-form write must be
    readable via the hyphen form."""
    store.record_implied("BRK.B", "2026-08-06", _payload(), "2026-08-03T21:00:00")
    rows = store.get_implied_history("BRK-B")
    assert len(rows) == 1 and rows[0]["sym"] == "BRK-B"
