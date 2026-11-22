"""A nightly a restart killed is finished before the open, built only through the last
completed session, and the watchdog reads the rows instead of trusting a receipt.

Measured on production 2026-11-11: web was redeployed 11 times between 02:52 and 08:50 ET,
the 03:00 nightly died about 2,000 rows in, and nothing re-ran it. 9,230 of 11,230 rows had
bars ending Nov 6 or Nov 9, and MINV3.1 existed on only the 2,000 fresh rows, so the
Anticipation screen silently ignored 82% of the market. The last complete build was Nov 6.
"""
import importlib
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

ET = ZoneInfo("America/New_York")


def _et(h, mi=0, d=11):
    return datetime(2026, 11, d, h, mi, tzinfo=ET)


# -- the plan: when, and how much -------------------------------------------------

@pytest.mark.parametrize("now,behind,in_flight,expect", [
    (_et(3, 9), 9000, False, (None, "outside the resume window")),     # the nightly's own slot
    (_et(9, 20), 9000, False, (None, "outside the resume window")),    # ten minutes before the open
    (_et(10, 0), 9000, False, (None, "outside the resume window")),    # the session: the live tier owns the lock
    (_et(5, 0), 9000, True, (None, "a build is already running")),
    (_et(5, 0), None, False, (None, "the rows behind could not be counted")),
    (_et(5, 0), 49, False, (None, "every row is current")),
    (_et(9, 19).replace(second=40), 9000, False, (None, "too close to the open to finish a run")),  # 40 rows of room
])
def test_the_plan_refuses_outside_its_window_and_says_why(now, behind, in_flight, expect):
    import api.main as main
    assert main._snapshot_resume_plan(now, behind, in_flight, 120) == expect


def test_a_run_is_sized_to_finish_before_the_window_closes():
    import api.main as main
    # 09:00 ET leaves 20 minutes: 20 x 120 = 2,400 rows, not the 9,230 behind.
    assert main._snapshot_resume_plan(_et(9, 0), 9230, False, 120) == (2400, None)
    # Early in the window the whole remainder fits.
    assert main._snapshot_resume_plan(_et(3, 10), 9230, False, 120) == (9230, None)


def test_the_rate_is_read_per_call_and_a_bad_value_falls_back(monkeypatch):
    import api.main as main
    monkeypatch.delenv("SCREENER_SNAPSHOT_RESUME_ROWS_PER_MIN", raising=False)
    assert main._snapshot_resume_rate() == 120
    monkeypatch.setenv("SCREENER_SNAPSHOT_RESUME_ROWS_PER_MIN", "200")
    assert main._snapshot_resume_rate() == 200
    monkeypatch.setenv("SCREENER_SNAPSHOT_RESUME_ROWS_PER_MIN", "fast")
    assert main._snapshot_resume_rate() == 120


# -- the job ------------------------------------------------------------------------

def _freeze(monkeypatch, when):
    import api.main as main

    class _Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return when.astimezone(tz) if tz else when

    monkeypatch.setattr(main, "datetime", _Clock)


def _job(monkeypatch, when, behind_seq, settled=date(2026, 11, 10)):
    import api.main as main
    from api.services.screener import snapshot_builder, snapshot_db
    calls = []
    behind = list(behind_seq)
    _freeze(monkeypatch, when)
    monkeypatch.delenv("SCREENER_SNAPSHOT_RESUME_ENABLED", raising=False)
    monkeypatch.setattr(snapshot_db, "count_rows_built_before",
                        lambda cutoff: behind.pop(0) if len(behind) > 1 else behind[0])
    monkeypatch.setattr(snapshot_builder, "build_in_flight", lambda: False)
    monkeypatch.setattr(snapshot_builder, "settled_session", lambda now=None: settled)
    monkeypatch.setattr(snapshot_builder, "run_build",
                        lambda max_tickers=None, through_ymd=None:
                        calls.append((max_tickers, through_ymd)) or
                        {"built": max_tickers, "skipped": 0, "errors": 0})
    from api.services.screener import distribution, volume_curve
    post = []
    monkeypatch.setattr(distribution, "distributions", lambda: post.append("dist"))
    monkeypatch.setattr(volume_curve, "nightly_job", lambda: post.append("curve") or {})
    main._run_snapshot_resume()
    return calls, post


def test_the_job_finishes_a_killed_nightly_through_the_last_completed_session(monkeypatch):
    calls, post = _job(monkeypatch, _et(5, 0), [9230, 0])
    assert calls == [(9230, 20261110)]
    assert post == ["dist", "curve"]          # caught up: the nightly's after-steps run once


def test_a_partial_run_does_not_run_the_after_steps(monkeypatch):
    calls, post = _job(monkeypatch, _et(9, 0), [9230, 6830])
    assert calls == [(2400, 20261110)]
    assert post == []


def test_CONTROL_the_job_never_builds_in_the_session(monkeypatch):
    calls, _ = _job(monkeypatch, _et(10, 30), [9230])
    assert calls == []


def test_the_job_refuses_without_a_settled_session(monkeypatch):
    # No limit means a pre-market build could store today's forming bar as settled.
    calls, _ = _job(monkeypatch, _et(5, 0), [9230], settled=None)
    assert calls == []


def test_the_job_is_off_with_its_switch(monkeypatch):
    import api.main as main
    from api.services.screener import snapshot_builder
    _freeze(monkeypatch, _et(5, 0))
    monkeypatch.setenv("SCREENER_SNAPSHOT_RESUME_ENABLED", "0")
    seen = []
    monkeypatch.setattr(snapshot_builder, "run_build", lambda **kw: seen.append(kw))
    main._run_snapshot_resume()
    assert seen == []


def test_the_job_is_registered_every_five_minutes_one_at_a_time(monkeypatch):
    import api.main as main
    monkeypatch.setenv("SCREENER_SNAPSHOT_ENABLED", "1")
    monkeypatch.setattr(main, "start_screener_snapshot_warm", lambda: None)
    jobs = {}

    class _FakeScheduler:
        def add_job(self, func, **kw):
            jobs[kw.get("id")] = (func, kw)

    assert main.register_screener_jobs(_FakeScheduler()) is True
    func, kw = jobs["screener_snapshot_resume"]
    assert func is main._run_snapshot_resume
    assert kw["max_instances"] == 1 and kw["coalesce"] is True
    assert kw["trigger"].interval.total_seconds() == 300


# -- the build: through a session, never past it ---------------------------------------

def test_bars_through_drops_only_later_bars():
    from api.services.screener.snapshot_builder import bars_through
    bars = [{"t": 20261106}, {"t": 20261109}, {"t": 20261110}, {"t": 20261111}]
    assert [b["t"] for b in bars_through(bars, 20261110)] == [20261106, 20261109, 20261110]
    assert bars_through(bars, None) is bars


def _builder(tmp_path, monkeypatch, universe, bars):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    monkeypatch.delenv("SCREENER_SNAPSHOT_MAX_PER_RUN", raising=False)
    import api.services.screener.snapshot_db as db
    importlib.reload(db)
    import api.services.screener.snapshot_builder as b
    importlib.reload(b)
    monkeypatch.setattr(b, "_load_universe", lambda: list(universe))
    monkeypatch.setattr(b, "_read_daily_bars", lambda t: list(bars))
    monkeypatch.setattr(b, "_read_ratings", lambda t, failures=None: {})
    monkeypatch.setattr(b, "_read_fundamentals", lambda t, price=None, failures=None: {"company": "X"})
    monkeypatch.setattr(b, "_read_rs_map", lambda: {})
    monkeypatch.setattr(b, "_read_bulk_fundamentals", lambda targets, failures=None: {})
    monkeypatch.setattr(b, "_read_settled_bars", lambda d: {"error": "offline in tests"})
    from api.services.screener import context_joins as cj
    for name in ("read_breadth_flags", "read_uct20", "read_index_flags", "read_etf_flags"):
        monkeypatch.setattr(cj, name, lambda targets, failures=None: {})
    return b, db


def _row(db, ticker):
    with db.connect() as conn:
        return dict(conn.execute("SELECT * FROM screener_rows WHERE ticker=?", (ticker,)).fetchone())


def test_a_build_through_a_session_ignores_todays_forming_bar(tmp_path, monkeypatch):
    # 60 sessions, the last one a FORMING bar at a price no completed session printed.
    bars = [{"t": 20260100 + i, "o": 10.0 + i, "h": 10.5 + i, "l": 9.5 + i, "c": 10.0 + i,
             "v": 1000 + i} for i in range(59)]
    bars.append({"t": 20260159, "o": 70.0, "h": 99.0, "l": 69.0, "c": 99.0, "v": 5})
    b, db = _builder(tmp_path, monkeypatch, ["AAA"], bars)
    b.run_build(through_ymd=20260158)
    row = _row(db, "AAA")
    assert int(row["bars_asof"]) == 20260158
    assert row["price"] == pytest.approx(68.0)                       # bar 58's close, not 99
    assert row["live_base_close_1w"] == pytest.approx(64.0)          # closes[-5] of the settled series
    assert row["live_base_min_volume_3d"] == pytest.approx(1056)     # sessions 56-58, not the 5-share bar


def test_CONTROL_without_the_limit_the_forming_bar_is_built(tmp_path, monkeypatch):
    bars = [{"t": 20260100 + i, "o": 10.0 + i, "h": 10.5 + i, "l": 9.5 + i, "c": 10.0 + i,
             "v": 1000 + i} for i in range(59)]
    bars.append({"t": 20260159, "o": 70.0, "h": 99.0, "l": 69.0, "c": 99.0, "v": 5})
    b, db = _builder(tmp_path, monkeypatch, ["AAA"], bars)
    b.run_build()
    assert int(_row(db, "AAA")["bars_asof"]) == 20260159


def test_rows_behind_are_counted_from_the_rows(tmp_path, monkeypatch):
    bars = [{"t": 20260100 + i, "o": 10.0, "h": 10.5, "l": 9.5, "c": 10.0, "v": 1000}
            for i in range(60)]
    b, db = _builder(tmp_path, monkeypatch, ["AAA", "BBB", "CCC"], bars)
    b.run_build()
    with db.connect() as conn:
        conn.execute("UPDATE screener_rows SET built_at = 100 WHERE ticker IN ('AAA','BBB')")
        conn.commit()
    assert db.count_rows_built_before(1000) == 2
    assert db.count_rows_built_before(50) == 0


# -- the watchdog reads the rows -------------------------------------------------------

def _watchdog(monkeypatch, behind):
    import api.main as main
    from api.services import chart_health_alerts
    from api.services.screener import snapshot_builder, snapshot_db
    seen = []
    monkeypatch.setattr(chart_health_alerts, "emit",
                        lambda key, sev, msg, meta=None: seen.append((key, sev, msg)) or True)
    today_3 = datetime.now(ET).replace(hour=3, minute=0, second=0, microsecond=0)
    monkeypatch.setattr(snapshot_db, "last_build_run",
                        lambda: {"id": 9, "started_at": today_3.timestamp()})
    monkeypatch.setattr(snapshot_db, "count_rows_built_before", lambda cutoff: behind)
    monkeypatch.setattr(snapshot_builder, "build_in_flight", lambda: False)
    main._check_nightly_finished()
    return seen


def test_the_watchdog_alerts_when_a_receipt_is_todays_but_the_rows_are_not(monkeypatch):
    seen = _watchdog(monkeypatch, 9230)
    assert len(seen) == 1 and "9230 rows were last rebuilt before 03:00 ET" in seen[0][2]


def test_CONTROL_the_watchdog_is_quiet_when_only_a_handful_are_behind(monkeypatch):
    assert _watchdog(monkeypatch, 1) == []
