"""G-33: the Wisdom missed-run watchdog measured POD UPTIME, not job staleness.

`registry.watchdog` took its age from `max(last_ok, boot)` with `_BOOT_WALL` set at
module import, so for the one case the guard exists for — a job that is FAILING,
whose last success is older than this pod — the number it compared against
`2 x expected_every_s` was the pod's own age. Tripping it needed ~70 days of
uninterrupted uptime for the monthly packet, 14 for the weekly chain and 2 for the
dailies, on a pod whose median life is minutes.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a failing long-period job invisible to the guard inside a plausible pod life.
2. the opposite over-correction — a freshly-booted pod paging about a job that has
   simply not had a chance to run yet. That grace is legitimate and is KEPT.
3. the grace growing back: a job with no success on record excused for longer than
   ONE of its own periods, which is the bound that makes it expire instead of
   scaling with uptime.
4. the page SENTENCE quoting the pod's age where it claims to quote staleness.

⛔ Every clock here is explicit. `watchdog(now)` takes `now` and reads module state
`_BOOT_WALL`, so nothing in this file reads the wall clock: the trading-day credit
counts weekends between two REAL dates, and a rail that took them from "today"
would be a function of the day the suite happened to run
(`lesson_a_test_that_reads_the_wall_clock_is_a_function_of_the_hour`).

⚠️ `WISDOM_INGEST_ENABLED` is the master switch `watchdog` returns early on, so these
tests set it in their own environment — the watchdog does nothing at all without it.
Its value on Railway is NOT read, asserted or changed here, and was not read while
writing this file.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from api.services.wisdom import registry
from api.services.wisdom.core import flags, heartbeat, store, timeutil

ET = timeutil.ET
#: A Monday noon inside the holiday table's window (`timeutil.holiday_table_covers`).
NOW = datetime(2026, 9, 14, 12, 0, tzinfo=ET)
#: A plausible pod life on this deploy cadence — CLAUDE.md's median is 26 minutes.
POD_LIFE = timedelta(minutes=26)
#: env name per kill-switch reader, so a real JobSpec's gate is derived, never typed.
GATE_ENV_FOR_READER = {reader: env for env, reader, _visible in flags.GATES}


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    monkeypatch.setenv("WISDOM_INGEST_ENABLED", "1")
    store.init_db()
    return tmp_path


@pytest.fixture
def pages(monkeypatch):
    sent: list = []
    from api.services import chart_health_alerts

    def _emit(key, severity, message, metadata=None):
        sent.append((key, severity, message))
        return True

    monkeypatch.setattr(chart_health_alerts, "emit", _emit)
    return sent


def _only(monkeypatch, *specs):
    monkeypatch.setattr(registry, "job_specs", lambda: list(specs))


def _spec(**overrides):
    fields = dict(job_id="wisdom_test_job", fn=lambda ctx: {},
                  trigger={"kind": "interval", "seconds": 300},
                  enabled=lambda: True, expected_every_s=300)
    fields.update(overrides)
    return registry.JobSpec(**fields)


def _booted(monkeypatch, ago: timedelta, *, now: datetime = NOW):
    """Pin the import-time boot clock `ago` before `now`."""
    monkeypatch.setattr(registry, "_BOOT_WALL", (now - ago).timestamp())


def _beat(job_id: str, status: str, when: datetime) -> None:
    with store.write() as conn:
        heartbeat.beat(conn, job_id, status, now_iso=timeutil.iso_et(when))


# ── 1. the case that was impossible ─────────────────────────────────────────

def test_a_failing_long_period_job_is_detected_on_a_pod_that_only_just_booted(
        wisdom_db, monkeypatch, pages):
    """⛔ THE DEFECT. Every real job whose period is a day or more, failing since a
    success five periods ago, on a pod 26 minutes old. Measured from
    `max(last_ok, boot)` not one of these is overdue, because the age is the pod's.

    The periods are READ OFF the real specs rather than typed, so the claim is about
    the product's own 1-day / 7-day / 35-day jobs.
    """
    long_jobs = [s for s in registry.job_specs()
                 if s.expected_every_s >= 86400 and s.job_id != "wisdom_core_watchdog"]
    # non-vacuity: the three publish jobs whose required uptime was 2, 14 and 70 days
    assert {"wisdom_daily_chain", "wisdom_weekly_chain", "wisdom_monthly_packet"} <= {
        s.job_id for s in long_jobs}
    _booted(monkeypatch, POD_LIFE)

    overdue = {}
    for spec in long_jobs:
        env = GATE_ENV_FOR_READER.get(spec.enabled)
        assert env, f"{spec.job_id}: its kill switch is not a declared gate"
        monkeypatch.setenv(env, "1")
        _only(monkeypatch, spec)
        _beat(spec.job_id, "ok", NOW - timedelta(seconds=5 * spec.expected_every_s))
        _beat(spec.job_id, "failed", NOW - POD_LIFE)
        overdue[spec.job_id] = registry.watchdog(NOW)["overdue"]

    assert overdue == {s.job_id: [s.job_id] for s in long_jobs}
    assert {k for k, _s, _m in pages} == {f"wisdom_job_missed:{s.job_id}" for s in long_jobs}


def test_a_job_that_never_ran_is_overdue_once_its_period_has_passed_since_boot(
        wisdom_db, monkeypatch, pages):
    """The grace is bounded by ONE period: after one period the job's slot HAS come
    round at least once, so silence is a miss rather than a pod that is young."""
    period = 3600
    _only(monkeypatch, _spec(job_id="wisdom_test_hourly", expected_every_s=period))

    _booted(monkeypatch, timedelta(seconds=period - 60))
    assert registry.watchdog(NOW)["overdue"] == []

    _booted(monkeypatch, timedelta(seconds=period + 60))
    assert registry.watchdog(NOW)["overdue"] == ["wisdom_test_hourly"]
    assert [k for k, _s, _m in pages] == ["wisdom_job_missed:wisdom_test_hourly"]


def test_the_page_quotes_job_staleness_and_never_the_pods_age(wisdom_db, monkeypatch, pages):
    """⛔ RAIL THE SENTENCE. The message is what a human acts on, and it said "has not
    succeeded for N min" while N was how long the pod had been up."""
    _only(monkeypatch, _spec(job_id="wisdom_test_weekly", expected_every_s=7 * 86400))
    _booted(monkeypatch, POD_LIFE)
    _beat("wisdom_test_weekly", "ok", NOW - timedelta(days=70))
    _beat("wisdom_test_weekly", "failed", NOW - POD_LIFE)

    assert registry.watchdog(NOW)["paged"] == ["wisdom_test_weekly"]
    (key, severity, message), = pages
    assert (key, severity) == ("wisdom_job_missed:wisdom_test_weekly", "critical")
    assert "100800 min" in message, message      # 70 days of staleness
    assert "20160 min" in message, message       # allowed: 2 x 7 days
    assert " 26 min" not in message, message     # the pod's age, which it used to report


# ── 2. the control: a young pod is not an alarm ─────────────────────────────

def test_a_freshly_booted_pod_never_pages_a_job_that_has_not_had_its_slot_yet(
        wisdom_db, monkeypatch, pages):
    """⛔ THE CONTROL, and the failure the boot term was added to avoid. A 35-day job
    with NO heartbeat at all, 26 minutes after boot, is not overdue — nor is one that
    succeeded well inside its window. Inverting the bug fails here."""
    _booted(monkeypatch, POD_LIFE)
    _only(monkeypatch, _spec(job_id="wisdom_test_monthly", expected_every_s=35 * 86400))

    never_ran = registry.watchdog(NOW)
    # non-vacuity: the loop reached the job — an empty roster would also report []
    assert never_ran["checked"] == 1
    assert (never_ran["overdue"], never_ran["paged"], pages) == ([], [], [])

    _beat("wisdom_test_monthly", "ok", NOW - timedelta(days=3))
    _beat("wisdom_test_monthly", "failed", NOW - timedelta(minutes=5))
    healthy = registry.watchdog(NOW)
    assert healthy["checked"] == 1
    assert (healthy["overdue"], healthy["paged"], pages) == ([], [], [])


def test_a_trading_day_job_is_not_paged_for_a_weekend_it_could_not_run_in(
        wisdom_db, monkeypatch, pages):
    """The non-trading-day credit still lands on the reference this guard measures
    from: a Friday-evening success read on Monday noon is not two missed sessions."""
    _booted(monkeypatch, POD_LIFE)
    _only(monkeypatch, _spec(job_id="wisdom_test_daily", expected_every_s=86400,
                             trading_days_only=True))
    friday = datetime(2026, 9, 11, 18, 47, tzinfo=ET)
    _beat("wisdom_test_daily", "ok", friday)

    assert registry.watchdog(NOW)["overdue"] == []
    assert pages == []
    # ... and the same job a week stale IS overdue, weekend credit included. `beat`
    # writes last_ok_at unconditionally on an 'ok', so an earlier stamp replaces it.
    _beat("wisdom_test_daily", "ok", datetime(2026, 9, 7, 18, 47, tzinfo=ET))
    assert registry.watchdog(NOW)["overdue"] == ["wisdom_test_daily"]
