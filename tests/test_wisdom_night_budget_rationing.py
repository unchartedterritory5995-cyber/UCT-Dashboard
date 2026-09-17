"""R65 — the per-night budget rations a NIGHT, and never clamps the programme.

⛔⛔ THE DEFECT THIS FILE EXISTS FOR, measured 2026-09-17 by executing the real module.
`select_within_budget` compared CUMULATIVE PROGRAMME spend — `SUM(cost_usd_actual)` over
`wisdom_batches` with **no date filter** — against `min(programme_cap, night_cap)`. So a
per-night value did not ration a night: it clamped the whole programme to that number.

    combined cap 75.0, $75 of night-1 actuals  ->  allowed 0 of 10
    control, same DB, cap=None -> 120.0        ->  allowed 9 of 10

Night 2 got NOTHING while $45 of programme headroom sat unused, and spend asymptoted toward the
night line instead of the programme total. A $75 night budget bought ONE night and then reported
a clean `budget stop` every night after — the most expensive kind of silence, because every
dashboard reads it as working.

⭐ WHAT THE OLD RAILS COULD NOT SEE. `test_wisdom_npass_chain` pinned only that a per-night value
never RAISES the programme total, and `test_wisdom_daily_budget` only that the two ceilings are
distinct env reads. Neither ever put spend from a PREVIOUS night in the database and asked
whether tonight could run. That is the one question that matters, and it is the first test here.
"""
from __future__ import annotations

import pytest

from api.services.wisdom.core import store
from api.services.wisdom.extract import budget


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()
    return tmp_path / "wisdom.db"


def _batch(conn, *, batch_id: str, submitted_at: str, actual: float, kind: str = "extract"):
    """A reaped batch that actually cost money, on a given ET date."""
    conn.execute(
        "INSERT INTO wisdom_batches (batch_id, kind, extractor_version, model, submitted_at, status, "
        "request_count, cost_usd_estimate, cost_usd_actual, budget_cap_usd, checkpoint_json) "
        "VALUES (?, ?, 'wx-v0-test', 'claude-opus-5', ?, 'reaped', 1, ?, ?, 999.0, '{}')",
        (batch_id, kind, submitted_at, actual, actual))


NIGHT_1 = "2026-09-18T18:47:00-04:00"
NIGHT_2 = "2026-09-19T18:47:00-04:00"
D1, D2 = NIGHT_1[:10], NIGHT_2[:10]


# ── the rail the ruling names ────────────────────────────────────────────────

def test_TWO_CONSECUTIVE_NIGHTS_UNDER_BUDGET_BOTH_RUN(wisdom_db):
    """⛔⛔ THE LOAD-BEARING ONE. Night 1 spends $74 of a $75 line inside a $1,800 programme.
    Night 2 must get its own $75, not the $1 the old code left it."""
    with store.write() as conn:
        _batch(conn, batch_id="b1", submitted_at=NIGHT_1, actual=74.0)

    with store.read() as conn:
        night2 = budget.select_within_budget(
            conn, "wx-v0-test", [10.0] * 7, cap=1800.0, night_cap=75.0, night_date=D2)

    assert night2.allowed_count == 7, night2.reason
    assert night2.reason is None


def test_the_same_night_IS_rationed(wisdom_db):
    """⭐ The control for the test above: the date filter must not simply disable the ceiling."""
    with store.write() as conn:
        _batch(conn, batch_id="b1", submitted_at=NIGHT_1, actual=74.0)

    with store.read() as conn:
        same = budget.select_within_budget(
            conn, "wx-v0-test", [10.0] * 7, cap=1800.0, night_cap=75.0, night_date=D1)

    assert same.allowed_count == 0
    assert "night budget stop" in same.reason and D1 in same.reason


def test_a_night_that_would_cross_its_line_stops_at_the_crossing_request(wisdom_db):
    with store.write() as conn:
        _batch(conn, batch_id="b1", submitted_at=NIGHT_2, actual=50.0)

    with store.read() as conn:
        d = budget.select_within_budget(
            conn, "wx-v0-test", [10.0] * 5, cap=1800.0, night_cap=75.0, night_date=D2)

    # 50 spent + 10 + 10 = 70 fits; the third would make 80 > 75.
    assert d.allowed_count == 2, d.reason
    assert "night budget stop" in d.reason


# ── the programme ceiling is still its own, and still binds ──────────────────

def test_the_programme_ceiling_still_refuses_and_SAYS_programme(wisdom_db):
    """⭐ Night-scoping must not become a way to spend the programme twice. $1,799 of programme
    spend across many past nights leaves no room, even on a night that has spent nothing."""
    with store.write() as conn:
        for i in range(25):
            _batch(conn, batch_id=f"old{i}", submitted_at=f"2026-08-{i + 1:02d}T18:47:00-04:00",
                   actual=71.96)

    with store.read() as conn:
        d = budget.select_within_budget(
            conn, "wx-v0-test", [10.0], cap=1800.0, night_cap=75.0, night_date=D2)

    assert d.allowed_count == 0
    assert "programme budget stop" in d.reason, d.reason
    assert "night budget stop" not in d.reason


def test_both_ceilings_absent_is_the_old_single_ceiling_behaviour(wisdom_db):
    """⭐ NON-VACUITY. Without a night_date the night ceiling does nothing at all, so every
    assertion above is about the date filter rather than about a generally stricter function."""
    with store.write() as conn:
        _batch(conn, batch_id="b1", submitted_at=NIGHT_1, actual=74.0)

    with store.read() as conn:
        d = budget.select_within_budget(conn, "wx-v0-test", [10.0] * 7, cap=1800.0)

    assert d.allowed_count == 7, d.reason


# ── the scope of a night ─────────────────────────────────────────────────────

def test_a_night_is_an_ET_DATE_and_needs_no_timezone_maths(wisdom_db):
    """⭐ submitted_at is written by timeutil.iso_et, so it is an ET-local ISO string and its
    first ten characters ARE the ET date. A batch at 23:59 ET belongs to that date, and one at
    00:01 ET the next morning does not — which is what makes 18:47 runs attributable at all."""
    with store.write() as conn:
        _batch(conn, batch_id="late", submitted_at="2026-09-18T23:59:00-04:00", actual=70.0)
        _batch(conn, batch_id="early", submitted_at="2026-09-19T00:01:00-04:00", actual=70.0)

    with store.read() as conn:
        a, _ = budget.night_spent_and_pending(conn, "2026-09-18")
        b, _ = budget.night_spent_and_pending(conn, "2026-09-19")

    assert a == pytest.approx(70.0)
    assert b == pytest.approx(70.0)


def test_pending_rows_from_tonight_count_against_tonight(wisdom_db):
    """⛔ This is what makes the N passes share ONE night: pass 1's submitted requests are pass
    2's pending. Without it each pass would see an empty night and three passes would each spend
    a full night's budget."""
    now = "2026-09-19T18:47:12-04:00"
    with store.write() as conn:
        conn.execute(
            "INSERT INTO wisdom_extract_requests (custom_id, source_id, source_version, segment_ids_json, "
            "extractor_version, attempt, status, segment_id, purpose, created_at, updated_at, est_cost_usd) "
            "VALUES ('wx_p1', 'src1', 1, '[]', 'wx-v0-test', 1, 'submitted', 's1', 'extract', ?, ?, 40.0)",
            (now, now))

    with store.read() as conn:
        actual, pending = budget.night_spent_and_pending(conn, "2026-09-19")
        d = budget.select_within_budget(
            conn, "wx-v0-test", [10.0] * 5, cap=1800.0, night_cap=75.0, night_date="2026-09-19")

    assert actual == 0.0 and pending == pytest.approx(40.0)
    assert d.allowed_count == 3, d.reason        # 40 + 30 = 70 fits; the fourth crosses 75
