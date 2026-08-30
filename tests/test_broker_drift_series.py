"""Drift kept as a SERIES, because a threshold cannot see a bias.

`j2_broker_mirror_checks` holds one verdict per account and pages when drift
exceeds a tolerance. That finds breakage. It is structurally blind to the shape
that actually cost us this month: the 2026-08-29 hero sat **$19.96** from the
broker's own reported total, every single day, comfortably under every
tolerance — and was found only because the owner put two screens side by side
and asked why they disagreed.

A run of samples answers what a threshold cannot. Noise averages toward zero;
a mean that stays put is a systematic offset, and its sign says which side is
high. That is the difference between "is it broken" and "is it lying a little,
consistently, in one direction."

⛔ Append-only. The verdict row is deliberately upserted (latest state drives
alerting); this table exists for the shape, so a row here is never replaced.
"""

from __future__ import annotations

import pytest

from api.services import auth_db
from api.services.journal_two import accounts as accounts_service
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.broker import mirror_check as mc


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    acct = accounts_service.create_account(
        "u1", {"name": "Broker", "color": "blue", "startingBalance": 1.0})
    return {"j2": acct["id"], "ba": "bk1"}


def _point(env, *, dollar, pct=0.0, ok=1, at="2026-08-29T07:40:00+00:00"):
    conn = auth_db.get_connection()
    try:
        conn.execute(
            "INSERT INTO j2_broker_drift_series "
            "(user_id, broker_account_id, checked_at, drift_dollar, drift_pct, ok) "
            "VALUES (?,?,?,?,?,?)", ("u1", env["ba"], at, dollar, pct, ok))
        conn.commit()
    finally:
        conn.close()


class TestBiasIsVisible:
    def test_a_persistent_offset_shows_as_a_mean_that_does_not_move(self, env):
        # The 2026-08-29 shape: the same gap, every day, under every tolerance.
        for day in range(20, 30):
            _point(env, dollar=-19.96, at=f"2026-08-{day}T07:40:00+00:00")
        s = mc.drift_series(env["ba"], days=3650)
        assert s["n"] == 10
        assert s["mean"] == -19.96, "a bias reads straight off the mean"
        assert s["spread"] == 0.0, "and a spread of zero says it is systematic, not noisy"

    def test_noise_averages_toward_zero_and_is_not_mistaken_for_bias(self, env):
        for i, d in enumerate([3.1, -2.9, 4.0, -3.8, 2.7, -3.1]):
            _point(env, dollar=d, at=f"2026-08-2{i}T07:40:00+00:00")
        s = mc.drift_series(env["ba"], days=3650)
        assert abs(s["mean"]) < 0.5, "symmetric noise must not read as an offset"
        assert s["spread"] > 5, "…while its spread is plainly larger than the bias case"

    def test_the_sign_says_which_side_is_high(self, env):
        for day in range(20, 25):
            _point(env, dollar=+42.0, at=f"2026-08-{day}T07:40:00+00:00")
        assert mc.drift_series(env["ba"], days=3650)["mean"] == 42.0


class TestSeriesMechanics:
    def test_it_appends_rather_than_replacing(self, env):
        _point(env, dollar=-1.0, at="2026-08-28T07:40:00+00:00")
        _point(env, dollar=-2.0, at="2026-08-29T07:40:00+00:00")
        s = mc.drift_series(env["ba"], days=3650)
        assert s["n"] == 2, "the verdict row is upserted; the SERIES must not be"
        assert [p["dollar"] for p in s["points"]] == [-1.0, -2.0], "oldest first"

    def test_an_empty_history_is_honest_rather_than_zero(self, env):
        s = mc.drift_series(env["ba"], days=30)
        assert s["n"] == 0
        assert s["mean"] is None, "no data is not the same as no drift"
        assert s["points"] == []

    def test_null_drift_points_do_not_poison_the_mean(self, env):
        # A check that could not compute equity parity records the point with a
        # null; counting it as 0.0 would drag a real bias toward the middle.
        _point(env, dollar=None, at="2026-08-28T07:40:00+00:00")
        _point(env, dollar=-20.0, at="2026-08-29T07:40:00+00:00")
        s = mc.drift_series(env["ba"], days=3650)
        assert s["n"] == 1 and s["mean"] == -20.0
        assert len(s["points"]) == 2, "…but the null point is still SHOWN"

    def test_accounts_do_not_bleed_into_each_other(self, env):
        _point(env, dollar=-19.96)
        conn = auth_db.get_connection()
        conn.execute(
            "INSERT INTO j2_broker_drift_series (user_id, broker_account_id, "
            "checked_at, drift_dollar, drift_pct, ok) VALUES (?,?,?,?,?,?)",
            ("u2", "bk2", "2026-08-29T07:40:00+00:00", 5000.0, 1.0, 0))
        conn.commit()
        conn.close()
        assert mc.drift_series(env["ba"], days=3650)["mean"] == -19.96
