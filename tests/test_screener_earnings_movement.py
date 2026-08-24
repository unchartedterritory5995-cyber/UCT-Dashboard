"""Earnings-date MOVEMENT reader.

Every test below builds its own temp SQLite store carrying the writer's exact
schema (`api/services/calendar_date_integrity.py::_ensure_init`) — the box's
real `calendar_dates.db` is never opened here.

Each test protects one behaviour that can be mutated red; the mutation verdicts
are recorded in
`.superpowers/sdd/readers-2026-08-23/earnings_moved-report.md`.
"""
import datetime
import sqlite3

import pytest

from api.services.screener import earnings_movement as em

TODAY = datetime.date(2026, 8, 23)

_SCHEMA = """
CREATE TABLE calendar_date_history (
    sym         TEXT PRIMARY KEY,
    report_date TEXT NOT NULL,
    prev_date   TEXT,
    first_seen  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
)
"""


def _store(tmp_path, rows, *, create_table=True, name="cal.db"):
    """Write a temp store and return its path. `rows` are
    `(sym, report_date, prev_date, updated_at)` tuples inserted verbatim, so a
    test can plant a malformed value the writer would never produce."""
    path = tmp_path / name
    conn = sqlite3.connect(str(path))
    try:
        if create_table:
            conn.execute(_SCHEMA)
            for sym, report_date, prev_date, updated_at in rows:
                conn.execute(
                    "INSERT INTO calendar_date_history "
                    "(sym, report_date, prev_date, first_seen, updated_at) "
                    "VALUES (?,?,?,?,?)",
                    (sym, report_date, prev_date, updated_at, updated_at))
        else:
            conn.execute("CREATE TABLE unrelated (x)")
        conn.commit()
    finally:
        conn.close()
    return str(path)


@pytest.fixture
def point_at(monkeypatch):
    """Point the reader's ONE path authority at a temp store."""
    from api.services import calendar_date_integrity

    def _point(path):
        monkeypatch.setattr(calendar_date_integrity, "_DB_PATH", path)
    return _point


def _stamp(d: datetime.date) -> str:
    """A UTC write timestamp that lands squarely on ET calendar day `d`
    (16:00 UTC == noon ET), so a test's age arithmetic is legible. The
    UTC-evening case that rolls back an ET day has its own test below."""
    return datetime.datetime(d.year, d.month, d.day, 16, 0, 0,
                             tzinfo=datetime.timezone.utc).isoformat()


def _fmp_owned_keys(tmp_path):
    """The column names the FMP earnings-date artifact already owns, DERIVED by
    running its reader against a throwaway artifact — never a typed list."""
    import json
    import os
    from api.services.screener import earnings_dates as ed

    artifact = tmp_path / "edates.json"
    artifact.write_text(json.dumps(
        {"as_of": TODAY.isoformat(),
         "rows": {"NVDA": {"date": "2026-09-10", "session": "amc"}}}))
    prev = os.environ.get("SCREENER_EDATES_ARTIFACT")
    os.environ["SCREENER_EDATES_ARTIFACT"] = str(artifact)
    try:
        got = ed.read_earnings_dates(["NVDA"])
    finally:
        if prev is None:
            os.environ.pop("SCREENER_EDATES_ARTIFACT", None)
        else:
            os.environ["SCREENER_EDATES_ARTIFACT"] = prev
    return set(got.get("NVDA") or ())


# ── happy path ────────────────────────────────────────────────────────────────

def test_a_pushed_back_date_reports_size_direction_and_recency(tmp_path, point_at):
    point_at(_store(tmp_path, [
        ("NVDA", "2026-09-10", "2026-09-03", _stamp(datetime.date(2026, 8, 18))),
    ]))
    fails = {}
    out = em.read_earnings_movement(["NVDA"], failures=fails, today=TODAY)
    assert out["NVDA"] == {
        "earnings_date_moved": 1,
        "earnings_date_moved_days": 7,          # + = pushed back
        "earnings_date_moved_age_days": 5,
    }
    assert fails == {}


def test_a_pulled_forward_date_is_negative(tmp_path, point_at):
    point_at(_store(tmp_path, [
        ("AMD", "2026-09-01", "2026-09-09", _stamp(datetime.date(2026, 8, 20))),
    ]))
    out = em.read_earnings_movement(["AMD"], today=TODAY)
    assert out["AMD"]["earnings_date_moved"] == 1
    assert out["AMD"]["earnings_date_moved_days"] == -8   # - = pulled forward
    assert out["AMD"]["earnings_date_moved_age_days"] == 3


# ── absent is not zero ────────────────────────────────────────────────────────

def test_a_symbol_the_store_never_saw_gets_no_key_at_all(tmp_path, point_at):
    """The killer shape: a 0 here would sort to the bottom of a range and
    filter as if it had been measured."""
    point_at(_store(tmp_path, [
        ("NVDA", "2026-09-10", "2026-09-03", _stamp(datetime.date(2026, 8, 18))),
    ]))
    out = em.read_earnings_movement(["NVDA", "GHOST"], today=TODAY)
    assert "GHOST" not in out
    assert out["NVDA"]["earnings_date_moved"] == 1


def test_a_tracked_symbol_with_no_move_is_zero_and_carries_no_size(tmp_path, point_at):
    """0 = the store looked and there is no reschedule. The SIZE and AGE keys
    stay absent — a 0 there would read as "moved by nothing, today"."""
    point_at(_store(tmp_path, [
        ("MSFT", "2026-10-28", None, _stamp(datetime.date(2026, 8, 20))),
    ]))
    out = em.read_earnings_movement(["MSFT"], today=TODAY)
    assert out["MSFT"] == {"earnings_date_moved": 0}


# ── the two classifiers ───────────────────────────────────────────────────────

def test_a_quarter_rollover_is_not_a_reschedule(tmp_path, point_at):
    """+91 days is the provider's calendar advancing after the company
    reported, not a three-month delay."""
    point_at(_store(tmp_path, [
        ("ROLL", "2026-11-05", "2026-08-06", _stamp(datetime.date(2026, 8, 7))),
    ]))
    out = em.read_earnings_movement(["ROLL"], today=TODAY)
    assert out["ROLL"] == {"earnings_date_moved": 0}


def test_a_one_day_shift_is_floored_as_noise(tmp_path, point_at):
    """An after-close Tuesday report listed as Wednesday by another feed is the
    same event redescribed — 64% of the sub-quarter population."""
    point_at(_store(tmp_path, [
        ("ONED", "2026-09-04", "2026-09-03", _stamp(datetime.date(2026, 8, 20))),
        ("BACK", "2026-09-02", "2026-09-03", _stamp(datetime.date(2026, 8, 20))),
    ]))
    out = em.read_earnings_movement(["ONED", "BACK"], today=TODAY)
    assert out["ONED"] == {"earnings_date_moved": 0}
    assert out["BACK"] == {"earnings_date_moved": 0}


def test_the_smallest_reported_move_is_two_days(tmp_path, point_at):
    """The floor is a floor, not a blanket mute — 2 days is a real signal."""
    point_at(_store(tmp_path, [
        ("TWO", "2026-09-05", "2026-09-03", _stamp(datetime.date(2026, 8, 22))),
    ]))
    out = em.read_earnings_movement(["TWO"], today=TODAY)
    assert out["TWO"]["earnings_date_moved"] == 1
    assert out["TWO"]["earnings_date_moved_days"] == 2


# ── the expiry gate ───────────────────────────────────────────────────────────

def test_a_move_whose_new_date_already_passed_says_nothing(tmp_path, point_at):
    """The company already reported. Emitting 0 would DENY a move that
    happened; emitting 1 would sell an expired fact as live. Say nothing."""
    point_at(_store(tmp_path, [
        ("PAST", "2026-08-12", "2026-08-05", _stamp(datetime.date(2026, 8, 1))),
        ("STALE0", "2026-08-12", None, _stamp(datetime.date(2026, 8, 1))),
    ]))
    out = em.read_earnings_movement(["PAST", "STALE0"], today=TODAY)
    assert out == {}


def test_a_move_to_today_is_still_live(tmp_path, point_at):
    """They moved it to TODAY — the most actionable version of this signal."""
    point_at(_store(tmp_path, [
        ("NOW", TODAY.isoformat(), "2026-08-28", _stamp(datetime.date(2026, 8, 21))),
    ]))
    out = em.read_earnings_movement(["NOW"], today=TODAY)
    assert out["NOW"]["earnings_date_moved"] == 1
    assert out["NOW"]["earnings_date_moved_days"] == -5


# ── malformed rows cost one row, and are counted ──────────────────────────────

def test_a_malformed_prev_date_is_omitted_and_counted(tmp_path, point_at):
    point_at(_store(tmp_path, [
        ("BAD", "2026-09-10", "not-a-date", _stamp(datetime.date(2026, 8, 20))),
        ("GOOD", "2026-09-10", "2026-09-03", _stamp(datetime.date(2026, 8, 18))),
    ]))
    fails = {}
    out = em.read_earnings_movement(["BAD", "GOOD"], failures=fails, today=TODAY)
    assert "BAD" not in out
    assert out["GOOD"]["earnings_date_moved"] == 1
    assert fails["earnings_moved"]["malformed"] == 1


def test_a_malformed_report_date_is_omitted_and_counted(tmp_path, point_at):
    point_at(_store(tmp_path, [
        ("BAD", "", "2026-09-03", _stamp(datetime.date(2026, 8, 20))),
        ("ALSOBAD", "2026-13-45", None, _stamp(datetime.date(2026, 8, 20))),
    ]))
    fails = {}
    out = em.read_earnings_movement(["BAD", "ALSOBAD"], failures=fails, today=TODAY)
    assert out == {}
    assert fails["earnings_moved"]["malformed"] == 2


def test_an_unreadable_timestamp_keeps_the_move_and_drops_the_recency(tmp_path, point_at):
    """The move is still a fact; how recent it is, is not. The recency key is
    ABSENT — never 0, which would read as "recorded today"."""
    point_at(_store(tmp_path, [
        ("NOTS", "2026-09-10", "2026-09-03", "whenever"),
    ]))
    fails = {}
    out = em.read_earnings_movement(["NOTS"], failures=fails, today=TODAY)
    assert out["NOTS"] == {"earnings_date_moved": 1, "earnings_date_moved_days": 7}
    assert fails["earnings_moved"]["no_timestamp_on_move"] == 1
    assert fails["earnings_moved"]["no_timestamps"] == 1  # whole-store freshness unknown


def test_recency_is_measured_in_ET_days_not_UTC_days(tmp_path, point_at):
    """The writer's real stamps cluster around 02:09 UTC — which is the PRIOR
    evening in ET. A UTC-day subtraction would report every one of them a day
    fresher than it is, on the single column whose whole job is recency."""
    utc_evening = datetime.datetime(2026, 8, 18, 2, 9, 11,
                                    tzinfo=datetime.timezone.utc).isoformat()
    point_at(_store(tmp_path, [
        ("EVE", "2026-09-10", "2026-09-03", utc_evening),
    ]))
    out = em.read_earnings_movement(["EVE"], today=TODAY)
    # 02:09 UTC on the 18th == 22:09 ET on the 17th -> 6 ET days back, not 5.
    assert out["EVE"]["earnings_date_moved_age_days"] == 6


# ── dead / empty / stale source ───────────────────────────────────────────────

def test_a_missing_store_returns_empty_and_is_counted(tmp_path, point_at):
    point_at(str(tmp_path / "does_not_exist.db"))
    fails = {}
    assert em.read_earnings_movement(["NVDA"], failures=fails, today=TODAY) == {}
    assert "OperationalError" in fails["earnings_moved"]


def test_a_missing_table_returns_empty_and_is_counted(tmp_path, point_at):
    point_at(_store(tmp_path, [], create_table=False))
    fails = {}
    assert em.read_earnings_movement(["NVDA"], failures=fails, today=TODAY) == {}
    assert "OperationalError" in fails["earnings_moved"]


def test_an_empty_table_returns_empty_and_is_counted(tmp_path, point_at):
    point_at(_store(tmp_path, []))
    fails = {}
    assert em.read_earnings_movement(["NVDA"], failures=fails, today=TODAY) == {}
    assert fails["earnings_moved"]["empty"] == 1


def test_a_stale_store_is_served_but_named(tmp_path, point_at):
    """Serving a slightly old answer beats serving none — but an operator has
    to be able to SEE that it is old (the guard `darkpool_agg` lacks)."""
    old = datetime.date(2026, 7, 20)
    point_at(_store(tmp_path, [
        ("OLD", "2026-09-10", "2026-09-03", _stamp(old)),
    ]))
    fails = {}
    out = em.read_earnings_movement(["OLD"], failures=fails, today=TODAY)
    assert out["OLD"]["earnings_date_moved"] == 1        # still served
    assert fails["earnings_moved"]["stale:34d"] == 1     # and named


def test_a_fresh_store_raises_no_staleness_flag(tmp_path, point_at):
    """Control for the test above — the guard must not fire on the store's
    natural cadence, or it gets muted within a week."""
    point_at(_store(tmp_path, [
        ("FRESH", "2026-09-10", "2026-09-03", _stamp(datetime.date(2026, 8, 22))),
    ]))
    fails = {}
    em.read_earnings_movement(["FRESH"], failures=fails, today=TODAY)
    assert fails == {}


# ── the read is BULK ──────────────────────────────────────────────────────────

def test_the_read_is_one_query_regardless_of_target_count(tmp_path, point_at, monkeypatch):
    """An N+1 across ~3,700 symbols is the shape this package exists to avoid.
    Counted off SQLite's own trace callback — what the engine actually ran, not
    what a wrapper believed it ran."""
    rows = [(f"T{i:04d}", "2026-09-10", "2026-09-03", _stamp(datetime.date(2026, 8, 20)))
            for i in range(300)]
    point_at(_store(tmp_path, rows))

    statements: list[str] = []
    real = em._connect_ro

    def spy(path):
        conn = real(path)
        conn.set_trace_callback(statements.append)
        return conn
    monkeypatch.setattr(em, "_connect_ro", spy)

    one = em.read_earnings_movement(["T0000"], today=TODAY)
    n_after_one = len(statements)
    many = em.read_earnings_movement([r[0] for r in rows], today=TODAY)
    n_after_many = len(statements) - n_after_one

    assert n_after_one == 1, statements
    assert n_after_many == 1, statements[n_after_one:]
    assert len(one) == 1
    assert len(many) == 300


# ── the connection cannot write ───────────────────────────────────────────────

def test_the_connection_is_genuinely_read_only(tmp_path, point_at):
    """`mode=ro` is a guard, not a decoration — a write must actually fail."""
    path = _store(tmp_path, [("X", "2026-09-10", None, _stamp(TODAY))])
    conn = em._connect_ro(path)
    try:
        with pytest.raises(sqlite3.OperationalError, match="readonly"):
            conn.execute("DELETE FROM calendar_date_history")
    finally:
        conn.close()


# ── the disjointness contract ─────────────────────────────────────────────────

def test_nothing_this_reader_emits_can_answer_when_the_company_reports(tmp_path, point_at):
    """`next_earnings_date` has ONE writer and it is not this module. No
    emitted key name may claim the date, and no emitted VALUE may carry the
    report date or the previous date — including as an ISO string, a year, or
    a day-count from today."""
    report_date = datetime.date(2026, 9, 10)
    prev_date = datetime.date(2026, 9, 3)
    point_at(_store(tmp_path, [
        ("NVDA", report_date.isoformat(), prev_date.isoformat(),
         _stamp(datetime.date(2026, 8, 18))),
        ("MSFT", "2026-10-28", None, _stamp(datetime.date(2026, 8, 20))),
    ]))
    out = em.read_earnings_movement(["NVDA", "MSFT"], today=TODAY)

    emitted_keys = {k for row in out.values() for k in row}
    assert emitted_keys <= {"earnings_date_moved", "earnings_date_moved_days",
                            "earnings_date_moved_age_days"}
    # The keys the FMP artifact owns are DERIVED by running its reader, never
    # typed here — a list typed beside the reader it describes is the drift
    # this repo keeps paying for.
    owned = _fmp_owned_keys(tmp_path)
    assert owned, "control: the FMP reader must actually answer, or this proves nothing"
    assert emitted_keys & owned == set()

    forbidden_values = {
        report_date.isoformat(), prev_date.isoformat(),
        (report_date - TODAY).days,     # days_to_earnings, restated
        (prev_date - TODAY).days,
    }
    for sym, row in out.items():
        for k, v in row.items():
            assert v not in forbidden_values, (sym, k, v)
