"""Session 26 Step A3 (owner ruling, 2026-09-18) — the budget arithmetic behind "will tonight
fit", as CODE, not prose. Two properties:

  1. `night_reservation_ceiling_usd` == `min(the night's own remaining line, the programme's
     remaining headroom)` — the invariant `select_within_budget`'s per-request loop already
     enforces, made an explicit, independently testable quantity.
  2. `projected_night_cost_usd` replays gate-run-3's real measured per-request rate
     (~$0.0587/request — the same figure `tests/test_wisdom_reservation_estimator.py` replays
     for the golden-gate tool's own ledger) against the programme's ARMED numbers, and the
     result must be within 1.5x of `$0.0587 x segments x 3`.

⛔ No corpus text anywhere here — only the aggregate dollar figure already published in
`docs/wisdom/PATH-PRICING-2026-09-18.md` and replayed (as a bare number) by the existing
reservation-estimator tests.
"""
from __future__ import annotations

import pytest

from api.services.wisdom.core import store
from api.services.wisdom.extract import budget

GATE_RUN_3_USD_PER_REQUEST = 0.0587


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()
    return tmp_path / "wisdom.db"


def _batch(conn, *, batch_id: str, submitted_at: str, actual: float, kind: str = "extract"):
    conn.execute(
        "INSERT INTO wisdom_batches (batch_id, kind, extractor_version, model, submitted_at, status, "
        "request_count, cost_usd_estimate, cost_usd_actual, budget_cap_usd, checkpoint_json) "
        "VALUES (?, ?, 'wx-v0-test', 'claude-opus-5', ?, 'reaped', 1, ?, ?, 999.0, '{}')",
        (batch_id, kind, submitted_at, actual, actual))


NIGHT = "2026-09-18T18:47:00-04:00"
D = NIGHT[:10]


# ── night_reservation_ceiling_usd: the min() made explicit ───────────────────

def test_the_night_line_binds_when_it_is_the_tighter_ceiling(wisdom_db):
    with store.write() as conn:
        pass  # nothing spent yet: night line 30, programme headroom 1800 - 0 = 1800
    with store.read() as conn:
        ceiling = budget.night_reservation_ceiling_usd(conn, night_cap=30.0, night_date=D,
                                                        programme_cap=1800.0)
    assert ceiling == pytest.approx(30.0)


def test_programme_headroom_binds_when_it_is_the_tighter_ceiling(wisdom_db):
    with store.write() as conn:
        # programme total already at 1770 of 1800 -> only 30 of headroom left, tighter than
        # the night's own 400 line.
        _batch(conn, batch_id="b1", submitted_at="2026-09-10T18:47:00-04:00", actual=1770.0)
    with store.read() as conn:
        ceiling = budget.night_reservation_ceiling_usd(conn, night_cap=400.0, night_date=D,
                                                        programme_cap=1800.0)
    assert ceiling == pytest.approx(30.0)


def test_the_ceiling_is_never_the_sum_of_the_two_headrooms(wisdom_db):
    """A realistic shape with BOTH prior programme spend and same-night spend present at once —
    ⚠️ night still binds here (mutation-checked: a `night_headroom`-only implementation also
    passes this one), so it is `test_programme_headroom_binds_when_it_is_the_tighter_ceiling`
    above, not this test, that rules out that alternative. Together the two prove `min`, never a
    `sum` (440 here, nowhere close to the correct 10)."""
    with store.write() as conn:
        _batch(conn, batch_id="prior-night", submitted_at="2026-09-15T18:47:00-04:00", actual=50.0)
        _batch(conn, batch_id="same-night", submitted_at=NIGHT, actual=390.0)
    with store.read() as conn:
        ceiling = budget.night_reservation_ceiling_usd(conn, night_cap=400.0, night_date=D,
                                                        programme_cap=1800.0)
    # night headroom: 400 - 390 = 10. programme headroom: 1800 - 50 - 390 = 1360. min = 10.
    assert ceiling == pytest.approx(10.0)


def test_the_ceiling_never_goes_negative(wisdom_db):
    """A night or programme already OVER its line has zero room, not a negative one — a
    negative ceiling would make `estimate <= ceiling` vacuously true for a negative estimate,
    which cannot occur, but the function's own contract should not depend on that."""
    with store.write() as conn:
        _batch(conn, batch_id="over", submitted_at=NIGHT, actual=500.0)
    with store.read() as conn:
        ceiling = budget.night_reservation_ceiling_usd(conn, night_cap=400.0, night_date=D,
                                                        programme_cap=1800.0)
    assert ceiling == 0.0


@pytest.mark.parametrize("night_actual,programme_prior,night_cap,programme_cap", [
    (0.0, 0.0, 75.0, 1800.0),
    (60.0, 200.0, 75.0, 1800.0),
    (0.0, 1750.0, 400.0, 1800.0),
    (399.0, 1799.0, 400.0, 1800.0),
])
def test_select_within_budget_never_allows_more_than_the_explicit_ceiling(
        wisdom_db, night_actual, programme_prior, night_cap, programme_cap):
    """⛔⛔ THE CROSS-CHECK. `select_within_budget`'s per-request loop enforces this invariant as
    an EMERGENT property, never computing `night_reservation_ceiling_usd` directly. This proves
    the two never drift apart: across a grid of binding shapes, the SUM of what the real
    per-request loop allows must never exceed what the explicit ceiling function says is there."""
    with store.write() as conn:
        if programme_prior:
            _batch(conn, batch_id="prog-prior", submitted_at="2026-09-01T18:47:00-04:00",
                  actual=programme_prior)
        if night_actual:
            _batch(conn, batch_id="night-actual", submitted_at=NIGHT, actual=night_actual)
    with store.read() as conn:
        ceiling = budget.night_reservation_ceiling_usd(conn, night_cap=night_cap, night_date=D,
                                                        programme_cap=programme_cap)
        # 50 requests at $1 each — comfortably more than any ceiling above, so the loop's own
        # stop is what is actually being exercised, not "ran out of estimates to offer".
        decision = budget.select_within_budget(conn, "wx-v0-test", [1.0] * 50, cap=programme_cap,
                                               night_cap=night_cap, night_date=D)
    assert decision.selected_estimate_usd <= ceiling + 1e-9, (
        f"the loop allowed ${decision.selected_estimate_usd} against an explicit ceiling of "
        f"${ceiling} — the two arithmetic paths have drifted apart")


def test_non_vacuity_at_least_one_shape_above_genuinely_rations(wisdom_db):
    """The cross-check above holds trivially if rationing never actually bites (an unrationed
    loop always satisfies `selected <= ceiling` too, since neither is exceeded). This pins ONE
    of its four shapes — night_actual=60, programme_prior=200, night_cap=75 — as a case where the
    ceiling (15) is strictly below the full 50-request ask, so the cross-check's pass is
    evidence of agreement, not the absence of a constraint to disagree about."""
    with store.write() as conn:
        _batch(conn, batch_id="prog-prior", submitted_at="2026-09-01T18:47:00-04:00", actual=200.0)
        _batch(conn, batch_id="night-actual", submitted_at=NIGHT, actual=60.0)
    with store.read() as conn:
        ceiling = budget.night_reservation_ceiling_usd(conn, night_cap=75.0, night_date=D,
                                                        programme_cap=1800.0)
        decision = budget.select_within_budget(conn, "wx-v0-test", [1.0] * 50, cap=1800.0,
                                               night_cap=75.0, night_date=D)
    assert ceiling == pytest.approx(15.0)
    assert decision.selected_estimate_usd == pytest.approx(15.0)
    assert decision.allowed_count < 50, "rationing did not actually fire — this case is vacuous"


# ── projected_night_cost_usd: replaying gate-run-3's real rate ───────────────

def test_projected_cost_is_plain_multiplication():
    assert budget.projected_night_cost_usd(GATE_RUN_3_USD_PER_REQUEST, 133, 3) == pytest.approx(
        GATE_RUN_3_USD_PER_REQUEST * 133 * 3)


def test_gate_run_3s_own_shape_133_segments_lands_under_its_ruled_night_line():
    """Replay: gate-run-3's own measured rate, at the SHAPE `budget.py`'s own docstring already
    cites (133 segments x 3 passes = 399 requests), must land within 1.5x of $0.0587 x 133 x 3 —
    and must fit under the $25 ruled default night line with margin, which is the whole point of
    that default having been set from this arithmetic in the first place."""
    projected = budget.projected_night_cost_usd(GATE_RUN_3_USD_PER_REQUEST, 133, 3)
    reference = GATE_RUN_3_USD_PER_REQUEST * 133 * 3
    assert projected == pytest.approx(reference)
    assert projected <= 1.5 * reference
    assert projected < budget.DEFAULT_DAILY_BUDGET_USD, (
        "gate-run-3's own shape must fit inside the ruled default night line — "
        f"projected ${projected:.2f} vs default ${budget.DEFAULT_DAILY_BUDGET_USD}")


def test_session_26s_armed_shape_2000_segments_lands_under_its_400_night_line():
    """⛔⛔ THE PRE-ARMING SANITY CHECK Step B relies on. Session 26 arms
    WISDOM_DAILY_SEGMENT_LIMIT=6000 at N=3 -> 2,000 segments/night -> 6,000 requests/night.
    At gate-run-3's real rate that projects to ~$352 — comfortably inside the $400 night line,
    and within 1.5x of the reference figure by construction (they are the same formula, so this
    pins the LITERAL segment/night arithmetic Step C's own plan states in prose)."""
    segments_per_night = 6000 // 3
    assert segments_per_night == 2000
    projected = budget.projected_night_cost_usd(GATE_RUN_3_USD_PER_REQUEST, segments_per_night, 3)
    reference = GATE_RUN_3_USD_PER_REQUEST * 2000 * 3
    assert projected == pytest.approx(reference)
    assert projected <= 1.5 * reference
    assert projected == pytest.approx(352.2, abs=0.5)
    night_line = 400.0
    assert projected < night_line, (
        f"projected ${projected:.2f} does not fit under the armed ${night_line} night line")


def test_a_1_5x_cost_regression_would_still_be_caught_against_the_ruled_night_line():
    """⭐ Non-vacuity in the OTHER direction: a per-request rate a real regression could plausibly
    produce (1.5x gate-run-3's own) must be distinguishable from the measured one — this is not a
    threshold so loose that any number would pass it."""
    regressed_rate = GATE_RUN_3_USD_PER_REQUEST * 1.5
    projected = budget.projected_night_cost_usd(regressed_rate, 2000, 3)
    assert projected > 400.0, "a 1.5x regression must actually blow the armed night line"
