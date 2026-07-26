"""Retention must drop WHOLE trading days — never hollow one out.

This is a DELETE path on the production options tape, so every test here is
written around a way it could destroy data rather than around the happy path.

The bug being fixed (measured on production 2026-07-26, rows returned for a
single trade day against a full session of ~96,178):

    Fri 7/24   96,179   100%
    Fri 7/10   54,043    56%
    Wed 6/24   13,022    14%
    Fri 5/22    3,909     4%
    Thu 1/15      986   1.0%

Every one of those was pickable in the calendar and rendered as a complete day.
"""
import os
import tempfile
from datetime import datetime, timedelta

import pytest

from api.flow_db import FlowDB


def _mdy(d: datetime) -> str:
    return f"{d.month}/{d.day}/{d.year}"


@pytest.fixture
def db():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    os.unlink(path)
    d = FlowDB(path)
    yield d
    for p in (path, path + "-wal", path + "-shm"):
        try:
            os.unlink(p)
        except OSError:
            pass


def _seed(db, trade_date: datetime, n: int, expiry: datetime):
    """n rows on one trade date, all on a contract expiring `expiry`."""
    with db._conn() as conn:
        conn.executemany(
            "INSERT INTO flow (CreatedDate, Symbol, ExpirationDate, source) VALUES (?,?,?,?)",
            [(_mdy(trade_date), f"SYM{i}", _mdy(expiry), "stocks") for i in range(n)],
        )


def _rows_on(db, trade_date: datetime) -> int:
    with db._conn() as conn:
        return conn.execute(
            "SELECT COUNT(*) FROM flow WHERE CreatedDate = ?", (_mdy(trade_date),)
        ).fetchone()[0]


NOW = datetime.now()


# ── the actual bug ──────────────────────────────────────────────────────────

def test_a_days_short_dated_flow_is_no_longer_deleted_out_from_under_it(db):
    """THE REGRESSION TEST.

    A recent day whose contracts have already expired must keep every row. The
    old prune deleted exactly these — leaving the day advertised but hollow.
    """
    recent = NOW - timedelta(days=3)
    long_gone = NOW - timedelta(days=2)          # contract expired yesterday
    _seed(db, recent, 500, expiry=long_gone)

    db.prune_old_trade_days(retain_days=90, dry_run=False)

    assert _rows_on(db, recent) == 500, (
        "expired contracts were pruned out of a recent trading day — that day "
        "now renders as a complete session built from a fraction of its flow"
    )


def test_a_day_is_removed_whole_or_not_at_all(db):
    """Never a fraction. Mixed expiries on one old day must go together."""
    old = NOW - timedelta(days=200)
    _seed(db, old, 40, expiry=NOW - timedelta(days=190))   # long expired
    _seed(db, old, 10, expiry=NOW + timedelta(days=400))   # still open (a LEAP)
    assert _rows_on(db, old) == 50
    # A current session must exist, or `old` is itself the newest day and the
    # never-delete-the-newest guard (correctly) protects it.
    _seed(db, NOW, 1, expiry=NOW)

    db.prune_old_trade_days(retain_days=90, dry_run=False)

    # The LEAP rows are exactly what used to survive and keep the day "available".
    assert _rows_on(db, old) == 0, "an out-of-window day left a residue behind"


def test_days_inside_the_window_are_untouched(db):
    inside = NOW - timedelta(days=30)
    _seed(db, inside, 100, expiry=NOW - timedelta(days=25))
    res = db.prune_old_trade_days(retain_days=90, dry_run=False)
    assert res["pruned"] == 0
    assert _rows_on(db, inside) == 100


# ── ways this could destroy the tape ────────────────────────────────────────

def test_retain_days_zero_disables_pruning_and_does_not_wipe_everything(db):
    """A misconfigured 0 must read as "keep", never as "delete everything".

    `FLOW_RETAIN_TRADE_DAYS=0` is exactly the kind of value someone sets meaning
    "unlimited". On a delete path that ambiguity has to fail safe.
    """
    old = NOW - timedelta(days=900)
    _seed(db, old, 10, expiry=NOW)
    for bad in (0, -1, -9999):
        res = db.prune_old_trade_days(retain_days=bad, dry_run=False)
        assert res["pruned"] == 0, f"retain_days={bad} deleted rows"
        assert res["cutoff"] == "disabled"
    assert _rows_on(db, old) == 10


def test_the_newest_session_is_never_deletable(db):
    """Even an absurd retention must not take the latest day.

    Otherwise a bad config during market hours deletes the session users are
    actively watching.
    """
    only_day = NOW - timedelta(days=500)
    _seed(db, only_day, 25, expiry=NOW)
    res = db.prune_old_trade_days(retain_days=1, dry_run=False)
    assert _rows_on(db, only_day) == 25, "the newest trading day was pruned"
    assert res["pruned"] == 0


def test_newest_survives_even_when_older_days_go(db):
    newest = NOW - timedelta(days=400)
    older = NOW - timedelta(days=500)
    _seed(db, newest, 5, expiry=NOW)
    _seed(db, older, 7, expiry=NOW)
    db.prune_old_trade_days(retain_days=30, dry_run=False)
    assert _rows_on(db, newest) == 5
    assert _rows_on(db, older) == 0


def test_unparseable_trade_dates_are_never_deleted(db):
    """Skipping a row must mean KEEPING it. Deleting on a parse failure would
    silently destroy rows whose date format drifted."""
    with db._conn() as conn:
        conn.executemany(
            "INSERT INTO flow (CreatedDate, Symbol, ExpirationDate, source) VALUES (?,?,?,?)",
            [(bad, "X", _mdy(NOW), "stocks")
             for bad in ("", "not-a-date", "2026-01-15", "13/45/2026", None)],
        )
    _seed(db, NOW - timedelta(days=1), 3, expiry=NOW)
    before = db.data_signature()[1]
    db.prune_old_trade_days(retain_days=30, dry_run=False)
    assert db.data_signature()[1] == before, "a row with an unparseable date was deleted"


def test_dry_run_reports_without_deleting(db):
    old = NOW - timedelta(days=300)
    _seed(db, old, 60, expiry=NOW)
    _seed(db, NOW, 5, expiry=NOW)
    res = db.prune_old_trade_days(retain_days=90, dry_run=True)
    assert res["dry_run"] is True
    assert res["pruned"] == 60
    assert _rows_on(db, old) == 60, "dry_run deleted rows"


def test_reports_which_days_it_removed(db):
    a, b = NOW - timedelta(days=300), NOW - timedelta(days=250)
    _seed(db, a, 2, expiry=NOW)
    _seed(db, b, 3, expiry=NOW)
    _seed(db, NOW, 1, expiry=NOW)
    res = db.prune_old_trade_days(retain_days=90, dry_run=False)
    assert set(res["days_removed"]) == {_mdy(a), _mdy(b)}
    assert res["pruned"] == 5


# ── the deprecated wrapper the six live callers still use ───────────────────

def test_prune_expired_ignores_buffer_days(db):
    """THE CATASTROPHIC FOOTGUN.

    The nightly cron calls prune_expired(buffer_days=1). buffer_days described a
    CONTRACT-EXPIRY buffer; reinterpreting it as trade-date retention would turn
    that call into "keep one day of tape, delete everything else" — a total wipe
    on the next cron tick.
    """
    for age in (2, 10, 40, 80):
        _seed(db, NOW - timedelta(days=age), 10, expiry=NOW - timedelta(days=1))

    pruned = db.prune_expired(buffer_days=1)

    assert pruned == 0, (
        f"prune_expired(buffer_days=1) deleted {pruned} rows — buffer_days was "
        "reinterpreted as retention and wiped the tape"
    )
    for age in (2, 10, 40, 80):
        assert _rows_on(db, NOW - timedelta(days=age)) == 10


def test_prune_expired_still_returns_an_int(db):
    """Six callers log this value; the shape must not change under them."""
    _seed(db, NOW - timedelta(days=300), 4, expiry=NOW)
    _seed(db, NOW, 1, expiry=NOW)
    out = db.prune_expired()
    assert isinstance(out, int) and out == 4


def test_prune_expired_no_longer_deletes_by_expiry(db):
    """The whole point: an expired contract on an in-window day must survive."""
    day = NOW - timedelta(days=5)
    _seed(db, day, 77, expiry=NOW - timedelta(days=4))
    db.prune_expired(buffer_days=1)
    assert _rows_on(db, day) == 77


# ── unarmed-by-default + blast radius ───────────────────────────────────────

def test_retention_is_unarmed_by_default(db):
    """Deploying the fix must STOP the hollowing without ALSO deleting history.

    The scoping fix is the bug fix. Actually removing days is a separate,
    irreversible decision — and there is no restore path: R2 backups run 02:30 ET
    AFTER the 20:00 ET prune, so every snapshot is already post-prune, and
    flow_backup.py has no restore function at all. The first armed run would
    otherwise be the largest delete this table has ever seen, triggered by a
    deploy rather than by a decision.
    """
    old = NOW - timedelta(days=300)
    _seed(db, old, 40, expiry=NOW)
    _seed(db, NOW, 5, expiry=NOW)

    res = db.prune_old_trade_days(retain_days=90)   # no dry_run passed

    assert res["armed"] is False
    assert res["dry_run"] is True, "retention armed itself on a default call"
    assert _rows_on(db, old) == 40, "an unarmed run deleted rows"
    assert res["pruned"] == 40, "an unarmed run must still REPORT what it would remove"


def test_per_run_cap_bounds_the_blast_radius(db):
    """A wrong retain_days may only take max_days per run, oldest first."""
    for age in range(300, 310):
        _seed(db, NOW - timedelta(days=age), 2, expiry=NOW)
    _seed(db, NOW, 1, expiry=NOW)

    res = db.prune_old_trade_days(retain_days=90, dry_run=False, max_days=3)

    assert len(res["days_removed"]) == 3
    assert res["backlog_days"] == 10, "the undrained backlog must stay visible"
    assert res["pruned"] == 6


def test_the_cap_takes_the_OLDEST_days_not_a_lexical_slice(db):
    """M/D/YYYY sorts lexically — "11/3" lands before "5/1".

    The cap slices the ordered list, so a lexical order would delete the wrong
    days: newer ones first, while the genuinely stale ones linger.
    """
    # All must be safely in the PAST, or they never enter the doomed set and the
    # test proves nothing. (First version of this test used 11/3/2026 — a future
    # date on the day it was written — so a lexical-ordering mutant passed it.)
    nov = datetime(2025, 11, 3)
    may = datetime(2025, 5, 1)
    jan = datetime(2025, 1, 15)
    assert max(nov, may, jan) < NOW - timedelta(days=30), "fixture dates must be past"
    # Lexically: '1/15/2025' < '11/3/2025' < '5/1/2025'
    # Chronologically: 1/15 < 5/1 < 11/3        <- the two differ, which is the point
    for d in (nov, may, jan):
        _seed(db, d, 1, expiry=NOW)
    _seed(db, NOW, 1, expiry=NOW)                       # newest, never deletable

    res = db.prune_old_trade_days(retain_days=1, dry_run=False, max_days=2)

    assert res["days_removed"] == ["1/15/2025", "5/1/2025"], (
        f"cap took {res['days_removed']} — expected the two OLDEST days. "
        "A lexical sort would have taken 11/3/2025 as the second."
    )
