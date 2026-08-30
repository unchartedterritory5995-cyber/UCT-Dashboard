"""The equity curve must plot SESSIONS, not sync days.

`write_balances` stamped each daily net-liq snapshot with `_et_date()` — the ET
date of the SYNC. The balance sync runs ~03:40 ET, before the open, so the
equity it carries is the PREVIOUS session's close. Measured on the owner's
Robinhood account 2026-08-29:

    snapshot_date  total_equity  synced_at (ET)        the value is really
    2026-08-27     9,677.59      Thu 23:04  (post-close)   Thursday's close  ✓
    2026-08-28     9,677.59      Fri 03:40  (pre-open)     Thursday's close  ✗
    2026-08-29     9,726.12      Sat 19:56  (weekend)      Friday's close    ✗

So Friday's real close was filed under Saturday, Thursday's close appeared
twice, and the weekend got points at all. Three defects from one expression:
the curve's x-axis is not a session axis, a session can hold two different
values (2026-08-21 kept a pre-settlement 10,517.48 while the Saturday sync
filed the settled 10,607.50 under 08-22), and differencing adjacent rows for a
day-change is meaningless.

The fix: stamp the session the reading BELONGS to. Once a session has opened
the equity is that day's; before the open — or on a weekend — it is the most
recent closed session's. Latest-write-wins then becomes a FEATURE: each
session's row converges on the broker's settled close when the next pre-dawn
sync lands.
"""

from __future__ import annotations

import pytest

from api.services import auth_db
from api.services.journal_two import timeutil
from api.services.journal_two import accounts as accounts_service
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.broker import balances


# 2026-08-27 is a Thursday; 08-28 Friday; 08-29 Saturday; 08-31 Monday.
# August is EDT (UTC-4). January is EST (UTC-5).
class TestSessionDayEt:
    @pytest.mark.parametrize("utc_iso,expected,why", [
        ("2026-08-28T03:04:27+00:00", "2026-08-27", "Thu 23:04 ET, post-close → Thursday"),
        ("2026-08-28T07:40:25+00:00", "2026-08-27", "Fri 03:40 ET, PRE-OPEN → Thursday"),
        ("2026-08-28T22:48:00+00:00", "2026-08-28", "Fri 18:48 ET, post-close → Friday"),
        ("2026-08-29T23:56:09+00:00", "2026-08-28", "Sat 19:56 ET → Friday"),
        ("2026-08-30T07:02:00+00:00", "2026-08-28", "Sun 03:02 ET → Friday"),
        ("2026-08-31T07:40:00+00:00", "2026-08-28", "Mon 03:40 ET, pre-open → Friday"),
        ("2026-08-31T13:29:00+00:00", "2026-08-28", "Mon 09:29 ET, one minute early → Friday"),
        ("2026-08-31T13:30:00+00:00", "2026-08-31", "Mon 09:30 ET, the open → Monday"),
        ("2026-08-31T17:00:00+00:00", "2026-08-31", "Mon 13:00 ET, mid-session → Monday"),
    ])
    def test_maps_a_reading_to_the_session_it_belongs_to(self, utc_iso, expected, why):
        assert timeutil.session_day_et(utc_iso) == expected, why

    def test_the_open_threshold_is_et_across_dst(self):
        # January = EST (UTC-5). 09:30 ET is 14:30Z, not 13:30Z — a naive
        # fixed-offset implementation passes August and fails here.
        assert timeutil.session_day_et("2026-01-15T14:30:00+00:00") == "2026-01-15"
        assert timeutil.session_day_et("2026-01-15T14:29:00+00:00") == "2026-01-14"

    def test_a_mid_session_reading_never_overwrites_the_prior_session(self):
        # The whole point of using the OPEN (not the close) as the threshold:
        # a 13:00 ET sync carries TODAY's intraday equity. Filing it under the
        # previous session would clobber a settled close with a live number.
        assert timeutil.session_day_et("2026-08-28T17:00:00+00:00") == "2026-08-28"

    def test_is_idempotent_under_its_own_output(self):
        # Re-running the migration must not walk dates backwards forever.
        first = timeutil.session_day_et("2026-08-29T23:56:09+00:00")
        assert timeutil.session_day_et(f"{first}T20:30:00+00:00") == first

    def test_unparseable_input_returns_none_rather_than_guessing(self):
        assert timeutil.session_day_et("not-a-date") is None
        assert timeutil.session_day_et(None) is None
        assert timeutil.session_day_et("backfill:2026-08-21") is None


@pytest.fixture
def env(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    acct = accounts_service.create_account(
        "u1", {"name": "Broker", "color": "blue", "startingBalance": 1.0})
    return {"ba": {"id": "ba1", "j2AccountId": acct["id"]}, "acct_id": acct["id"]}


def _pos(sym, units, price, avg_cost=100.0):
    return {"symbol": {"symbol": sym}, "units": units, "price": price,
            "average_purchase_price": avg_cost}


class TestWriterStampsTheSession:
    def test_a_pre_open_sync_files_under_the_previous_session(self, env, monkeypatch):
        # Friday 03:40 ET: the payload is Thursday's close. It must land on
        # Thursday's row, not create a phantom Friday one.
        monkeypatch.setattr(balances, "_snapshot_session_day", lambda: "2026-08-27")
        balances.write_balances(
            "u1", env["ba"],
            [{"currency": "USD", "cash": 1000, "buying_power": 2000}],
            [_pos("AAPL", 10, 100)],
            broker_total=2000.0,
        )
        conn = auth_db.get_connection()
        try:
            rows = conn.execute(
                "SELECT snapshot_date FROM j2_broker_equity_snapshots WHERE user_id='u1'"
            ).fetchall()
        finally:
            conn.close()
        assert [r["snapshot_date"] for r in rows] == ["2026-08-27"]

    def test_the_next_sync_of_the_same_session_overwrites_rather_than_duplicates(
            self, env, monkeypatch):
        # Friday evening writes Friday; Saturday's sync carries the SETTLED
        # Friday close and must land on the same row with the better number.
        monkeypatch.setattr(balances, "_snapshot_session_day", lambda: "2026-08-28")
        balances.write_balances(
            "u1", env["ba"],
            [{"currency": "USD", "cash": 1000, "buying_power": 2000}],
            [_pos("AAPL", 10, 100)], broker_total=2000.0)
        # The settled reading marks AAPL 5 higher — components and the broker's
        # own total agree at 2050, so 2050 is what lands (a divergent total
        # would lose to live components by design; see write_balances).
        balances.write_balances(
            "u1", env["ba"],
            [{"currency": "USD", "cash": 1000, "buying_power": 2000}],
            [_pos("AAPL", 10, 105)], broker_total=2050.0)
        conn = auth_db.get_connection()
        try:
            rows = conn.execute(
                "SELECT snapshot_date, total_equity FROM j2_broker_equity_snapshots "
                "WHERE user_id='u1'").fetchall()
        finally:
            conn.close()
        assert len(rows) == 1, "a second reading of one session must not add a point"
        assert rows[0]["snapshot_date"] == "2026-08-28"
        assert rows[0]["total_equity"] == 2050.0

    def test_no_weekend_points(self, env, monkeypatch):
        # The seam is what the writer asks; prove the real helper never answers
        # with a Saturday or Sunday for a weekend sync.
        for utc_iso in ("2026-08-29T23:56:09+00:00", "2026-08-30T07:02:00+00:00"):
            day = timeutil.session_day_et(utc_iso)
            from datetime import date
            assert date.fromisoformat(day).weekday() < 5, f"{utc_iso} → {day} is a weekend"


# ── the migration for rows already on disk ──────────────────────────────────
from api.services.journal_two.broker import snapshot_redate


def _snap(conn, day, equity, synced_at, user="u1", acct="ba1"):
    conn.execute(
        "INSERT INTO j2_broker_equity_snapshots (user_id, broker_account_id, "
        "snapshot_date, total_equity, cash, market_value, synced_at) "
        "VALUES (?,?,?,?,?,?,?)", (user, acct, day, equity, None, None, synced_at))


def _rows(user="u1"):
    conn = auth_db.get_connection()
    try:
        return [(r["snapshot_date"], r["total_equity"]) for r in conn.execute(
            "SELECT snapshot_date, total_equity FROM j2_broker_equity_snapshots "
            "WHERE user_id=? ORDER BY snapshot_date", (user,))]
    finally:
        conn.close()


class TestRedateMigration:
    def _seed_prod_shape(self):
        """The owner's Robinhood rows exactly as measured 2026-08-29."""
        conn = auth_db.get_connection()
        try:
            _snap(conn, "2026-08-27", 9677.59, "2026-08-28T03:04:27+00:00")  # Thu ✓
            _snap(conn, "2026-08-28", 9677.59, "2026-08-28T07:40:25+00:00")  # dup of Thu
            _snap(conn, "2026-08-29", 9726.12, "2026-08-29T23:56:09+00:00")  # Fri, filed Sat
            conn.commit()
        finally:
            conn.close()

    def test_collapses_the_prod_shape_onto_two_real_sessions(self, env, tmp_path,
                                                             monkeypatch):
        monkeypatch.setenv("DATA_DIR", str(tmp_path))
        self._seed_prod_shape()
        out = snapshot_redate.run(dry_run=False)
        assert _rows() == [("2026-08-27", 9677.59), ("2026-08-28", 9726.12)]
        assert out["merged_duplicates"] == 1
        assert out["weekend_points_removed"] == 1
        assert out["sessions"] == 2

    def test_friday_close_lands_on_friday_not_saturday(self, env, tmp_path, monkeypatch):
        monkeypatch.setenv("DATA_DIR", str(tmp_path))
        self._seed_prod_shape()
        snapshot_redate.run(dry_run=False)
        days = dict(_rows())
        assert "2026-08-29" not in days, "Saturday is not a session"
        assert days["2026-08-28"] == 9726.12, "Friday must hold Friday's close"

    def test_dry_run_is_the_default_and_writes_nothing(self, env, tmp_path, monkeypatch):
        monkeypatch.setenv("DATA_DIR", str(tmp_path))
        self._seed_prod_shape()
        before = _rows()
        out = snapshot_redate.run()
        assert out["dry_run"] is True and out["backup"] is None
        assert _rows() == before
        # BOTH surviving readings move: the Friday-03:40 row carries Thursday's
        # settled close (and beats the Thursday-23:04 row on recency), and the
        # Saturday row carries Friday's. One duplicate is dropped.
        assert out["moved"] == 2 and out["merged_duplicates"] == 1
        # A dry run must predict the real run exactly.
        applied = snapshot_redate.run(dry_run=False)
        assert (applied["moved"], applied["merged_duplicates"], applied["sessions"]) == \
               (out["moved"], out["merged_duplicates"], out["sessions"])

    def test_is_idempotent(self, env, tmp_path, monkeypatch):
        monkeypatch.setenv("DATA_DIR", str(tmp_path))
        self._seed_prod_shape()
        snapshot_redate.run(dry_run=False)
        after_first = _rows()
        second = snapshot_redate.run(dry_run=False)
        assert _rows() == after_first
        assert second["moved"] == 0 and second["merged_duplicates"] == 0

    def test_backfill_rows_are_left_alone(self, env, tmp_path, monkeypatch):
        monkeypatch.setenv("DATA_DIR", str(tmp_path))
        conn = auth_db.get_connection()
        try:
            _snap(conn, "2026-08-19", 11013.17, "backfill:2026-08-21")
            _snap(conn, "2026-08-18", 11955.70, "backfill:2026-08-21")
            conn.commit()
        finally:
            conn.close()
        out = snapshot_redate.run(dry_run=False)
        assert out["skipped_no_timestamp"] == 2
        assert _rows() == [("2026-08-18", 11955.70), ("2026-08-19", 11013.17)]

    def test_a_real_reading_displaces_a_backfilled_estimate_on_the_same_session(
            self, env, tmp_path, monkeypatch):
        monkeypatch.setenv("DATA_DIR", str(tmp_path))
        conn = auth_db.get_connection()
        try:
            _snap(conn, "2026-08-27", 1.0, "backfill:2026-08-21")          # estimate
            _snap(conn, "2026-08-28", 9677.59, "2026-08-28T07:40:25+00:00")  # real, → Thu
            conn.commit()
        finally:
            conn.close()
        out = snapshot_redate.run(dry_run=False)
        assert out["displaced_backfill"] == 1
        assert _rows() == [("2026-08-27", 9677.59)], "the real reading wins"

    def test_writes_a_recoverable_backup_before_mutating(self, env, tmp_path,
                                                         monkeypatch):
        monkeypatch.setenv("DATA_DIR", str(tmp_path))
        self._seed_prod_shape()
        out = snapshot_redate.run(dry_run=False)
        import json as _json
        saved = _json.loads(open(out["backup"], encoding="utf-8").read())
        # Every row the migration removed must be reconstructable from the file.
        assert saved["table"] == "j2_broker_equity_snapshots"
        assert {r["snapshot_date"] for r in saved["rows"]} == {
            "2026-08-27", "2026-08-28", "2026-08-29"}

    def test_accounts_do_not_bleed_into_each_other(self, env, tmp_path, monkeypatch):
        monkeypatch.setenv("DATA_DIR", str(tmp_path))
        conn = auth_db.get_connection()
        try:
            _snap(conn, "2026-08-29", 100.0, "2026-08-29T23:56:09+00:00", acct="ba1")
            _snap(conn, "2026-08-29", 200.0, "2026-08-29T23:56:09+00:00", acct="ba2")
            conn.commit()
        finally:
            conn.close()
        snapshot_redate.run(dry_run=False)
        conn = auth_db.get_connection()
        try:
            got = {(r["broker_account_id"], r["snapshot_date"], r["total_equity"])
                   for r in conn.execute(
                       "SELECT broker_account_id, snapshot_date, total_equity "
                       "FROM j2_broker_equity_snapshots")}
        finally:
            conn.close()
        assert got == {("ba1", "2026-08-28", 100.0), ("ba2", "2026-08-28", 200.0)}
