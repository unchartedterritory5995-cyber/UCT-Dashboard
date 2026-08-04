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


# ── P2 T8b — fiscal_year/fiscal_quarter pairing key ─────────────────────────

def test_record_implied_and_history_carry_fiscal_key(store):
    """The provider's own fiscal identity round-trips through the store —
    this is what a client pairs a past history row against, since that row's
    true announcement date is usually unknown."""
    store.record_implied("TST", "2026-07-30", _payload(6.8), "2026-07-29T21:00:00",
                          fiscal_year=2026, fiscal_quarter=2)
    rows = store.get_implied_history("TST")
    assert rows[0]["fiscal_year"] == 2026
    assert rows[0]["fiscal_quarter"] == 2


def test_fiscal_key_is_optional_and_additive(store):
    """A caller that omits fiscal_year/fiscal_quarter (every existing call
    site before this task) must keep writing exactly as before — absent, not
    a phantom 0."""
    store.record_implied("TST", "2026-05-06", _payload(4.0), "2026-05-05T21:00:00")
    rows = store.get_implied_history("TST")
    assert rows[0]["fiscal_year"] is None
    assert rows[0]["fiscal_quarter"] is None


def test_fiscal_key_zero_survives_instead_of_flattening_to_none(store):
    """Neither field is ever genuinely 0 in practice, but the storage layer
    must not special-case 0 into NULL — the same phantom-zero trap in reverse."""
    store.record_implied("TST", "2026-07-30", _payload(), "2026-07-29T21:00:00",
                          fiscal_year=0, fiscal_quarter=0)
    rows = store.get_implied_history("TST")
    assert rows[0]["fiscal_year"] == 0
    assert rows[0]["fiscal_quarter"] == 0


def test_record_implied_first_write_wins_covers_the_fiscal_key_too(store):
    """First-write-wins (I5) must hold for the WHOLE row, including the new
    columns — a re-run must not quietly patch the fiscal key onto an already-
    captured snapshot."""
    store.record_implied("TST", "2026-08-06", _payload(6.8), "2026-08-03T21:00:00",
                          fiscal_year=2026, fiscal_quarter=2)
    store.record_implied("TST", "2026-08-06", _payload(9.9), "2026-08-05T21:00:00",
                          fiscal_year=2026, fiscal_quarter=3)
    rows = store.get_implied_history("TST")
    assert len(rows) == 1
    assert rows[0]["pct"] == pytest.approx(6.8)
    assert rows[0]["fiscal_quarter"] == 2, "the FIRST write's fiscal key must win, not the second"


def test_upcoming_reporters_carries_fiscal_year_and_quarter(store, monkeypatch):
    """upcoming_reporters is the source of the fiscal key that flows into
    record_implied via run_nightly_capture — Finnhub's own quarter/year on
    /calendar/earnings, distinguished from a missing value."""
    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"earningsCalendar": [
                {"symbol": "TST", "date": "2026-07-30", "hour": "amc", "quarter": 2, "year": 2026},
                {"symbol": "NOQ", "date": "2026-07-31", "hour": "bmo"},  # no quarter/year at all
            ]}

    monkeypatch.setenv("FINNHUB_API_KEY", "test-key")
    with patch.object(store.httpx, "get", return_value=_Resp()):
        reporters = store.upcoming_reporters(days=14, now=dt.datetime(2026, 7, 20))
    by_sym = {r["sym"]: r for r in reporters}
    assert by_sym["TST"]["fiscal_year"] == 2026
    assert by_sym["TST"]["fiscal_quarter"] == 2
    assert by_sym["NOQ"]["fiscal_year"] is None
    assert by_sym["NOQ"]["fiscal_quarter"] is None


def test_run_nightly_capture_carries_fiscal_key_through_to_the_stored_row(store):
    """The end-to-end path: a reporter row from upcoming_reporters carrying a
    fiscal key must land on the STORED snapshot, not just be read and dropped."""
    reporters = [{"sym": "TST", "report_date": "2026-08-04", "hour": "amc",
                  "fiscal_year": 2026, "fiscal_quarter": 3}]
    with patch.object(store, "upcoming_reporters", return_value=reporters), \
         patch.object(store.implied_move, "get_expected_move", return_value=_payload()):
        summary = store.run_nightly_capture(now=dt.datetime(2026, 8, 3, 16, 40))
    assert summary["captured"] == 1
    rows = store.get_implied_history("TST")
    assert rows[0]["fiscal_year"] == 2026
    assert rows[0]["fiscal_quarter"] == 3


def test_schema_migration_adds_fiscal_columns_to_a_pre_existing_db(tmp_path, monkeypatch):
    """I6/Requirement 6: an existing DB file created BEFORE this task (no
    fiscal_year/fiscal_quarter columns) must not break — _ensure_init's ALTER
    guard has to add them the next time the module initializes against it."""
    import sqlite3
    import importlib

    db_path = tmp_path / "pre_existing_implied.db"
    # Build the OLD schema by hand — no fiscal_year/fiscal_quarter columns —
    # to simulate a DB file that predates this task, with one row already in it.
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        "CREATE TABLE implied_snapshots ("
        "sym TEXT NOT NULL, report_date TEXT NOT NULL, captured_at TEXT NOT NULL, "
        "pct REAL NOT NULL, dollar REAL NOT NULL, expiry TEXT, strike REAL, spot REAL, "
        "iv_atm REAL, source TEXT, PRIMARY KEY (sym, report_date))"
    )
    conn.execute(
        "INSERT INTO implied_snapshots (sym, report_date, captured_at, pct, dollar) "
        "VALUES ('OLD', '2026-05-06', '2026-05-05T21:00:00', 4.0, 4.4)"
    )
    conn.commit()
    conn.close()

    monkeypatch.setenv("IMPLIED_STORE_DB", str(db_path))
    from api.services import implied_store
    importlib.reload(implied_store)

    # A pre-existing row reads back with the new columns as NULL, not an error.
    rows = implied_store.get_implied_history("OLD")
    assert rows[0]["pct"] == pytest.approx(4.0)
    assert rows[0]["fiscal_year"] is None
    assert rows[0]["fiscal_quarter"] is None

    # And the migrated table accepts a NEW row carrying the fiscal key.
    implied_store.record_implied("NEW", "2026-08-06", _payload(6.8), "2026-08-03T21:00:00",
                                  fiscal_year=2026, fiscal_quarter=2)
    new_rows = implied_store.get_implied_history("NEW")
    assert new_rows[0]["fiscal_year"] == 2026
