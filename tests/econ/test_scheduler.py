"""scheduler.py: polling profiles, due-work from DB state, batching, leases, quota, backoff, reconcile."""
from __future__ import annotations

import pytest

from api.services.econ import calendar as cal
from api.services.econ import currentness as cur
from api.services.econ import scheduler as sch
from api.services.econ.adapters.fake import FakeAdapter
from api.services.econ.model import SourceUnavailable
from tests.econ.test_ingest import (CPI_OCT, HIST, KEY, NOW0, SEP, T, _no_archive, ents, keyed,  # noqa: F401
                                    months, seeded)


def cpi_event(label="2026-09", d="2026-10-14", t="08:30", prec="time_configured"):
    return cal.Event("bls:cpi", label, d, t, prec, "configured")


# ─────────────────────────────── profile math ────────────────────────────────

def test_burst_profile_schedule():
    p = sch.PROFILES["burst"]
    ev = cpi_event()
    S = ev.scheduled_at
    nxt = cpi_event("2026-10", "2026-11-10")
    assert sch.next_poll_at(p, ev, False, nxt, None) == S
    assert sch.next_poll_at(p, ev, False, nxt, S - 120) == S                  # after the probe: first poll at T
    assert sch.next_poll_at(p, ev, False, nxt, S + 40) == S + 60              # every 20 s for 10 min
    assert sch.next_poll_at(p, ev, False, nxt, S + 700) == S + 820            # every 2 min to T+60
    assert sch.next_poll_at(p, ev, False, nxt, S + 4000) == S + 4000 + 3600   # hourly to end of day
    late = T("2026-10-14", "23:30")
    assert sch.next_poll_at(p, ev, False, nxt, late) == late + 3600
    assert sch.next_poll_at(p, ev, False, nxt, T("2026-10-15", "01:00")) == T("2026-10-15", "07:00")  # 6 h after
    prev = cpi_event("2026-08", "2026-09-11")
    assert sch.next_poll_at(p, prev, True, ev, T("2026-10-01")) == S - 120    # satisfied: only the T-2 min probe
    assert sch.next_poll_at(p, prev, True, ev, S - 100) == S                  # probe done: next poll AT T
    assert sch.next_poll_at(p, prev, True, None, S - 100) is None             # nothing scheduled: no poll
    assert sch.next_poll_at(p, None, True, None, None) is None


def test_keyless_bls_and_hole_profiles():
    p = sch.PROFILES["bls_keyless"]
    ev = cpi_event()
    S = ev.scheduled_at
    assert sch.next_poll_at(p, None, True, ev, None) == S                     # keyless: no probe, first poll at T
    assert sch.next_poll_at(p, ev, False, None, S) == S + 60
    assert sch.next_poll_at(p, ev, False, None, S + 61) == S + 180
    assert sch.next_poll_at(p, ev, False, None, S + 3600) == S + 3600 + 7200
    hole = cal.Event("fiscal:mts", "2026-09", "2026-10-01", None, "unknown", "authoritative_feed")
    assert sch.next_poll_at(sch.PROFILES["burst"], hole, False, None, hole.scheduled_at + 10) == \
        hole.scheduled_at + 10 + 3 * 3600
    # an upcoming hole is never probed
    assert sch.next_poll_at(sch.PROFILES["burst"], None, True, hole, None) is None


def test_profile_for(keyed, monkeypatch):
    E = {e["symbol"]: e for e in ents("USCPI", "UST10Y", "USGDP")}
    assert sch.profile_for(E["USCPI"]).name == "burst"
    assert sch.profile_for(E["UST10Y"]).name == "daily"
    monkeypatch.delenv("BLS_API_KEY")
    assert sch.profile_for(E["USCPI"]).name == "bls_keyless"
    assert sch.daily_limit("bls") == 25
    monkeypatch.setenv("BLS_API_KEY", KEY)
    assert sch.daily_limit("bls") == 500 and sch.daily_limit("bea") is None


# ─────────────────────────────── due work ────────────────────────────────────

def test_due_batches_all_bls_series_into_one_job(tmp_path, keyed):
    E = ents("USCPI", "USCORECPI", "USCPIMOM", "USPPIFD")
    hist = HIST + [("USCORECPI",) + h[1:] for h in HIST] + [("USPPIFD",) + h[1:] for h in HIST]
    s = seeded(tmp_path, E, hist=hist)
    sc = sch.Scheduler(s, entries=E, adapter_for=lambda n: None, publish=False)
    assert sc.due(NOW0 + 60) == []
    jobs = sc.due(CPI_OCT)
    assert len(jobs) == 1 and jobs[0].adapter == "bls" and jobs[0].symbols == ["USCORECPI", "USCPI"]
    assert "USCPIMOM" not in jobs[0].symbols                                      # derived: never fetched
    jobs = sc.due(T("2026-10-15", "08:30"))                                       # PPI day: CPI is also still due
    assert len(jobs) == 1 and jobs[0].symbols == ["USCORECPI", "USCPI", "USPPIFD"]


def test_disabled_series_never_scheduled(tmp_path, keyed):
    E = ents("USCPI", **{"USCPI": {"status": "disabled"}})
    s = seeded(tmp_path, E)
    assert sch.Scheduler(s, entries=E, adapter_for=lambda n: None).due(CPI_OCT) == []


def test_no_data_series_gets_a_backfill_job(tmp_path, keyed):
    from tests.econ.test_ingest import open_store
    E = ents("USCPI")
    s = open_store(tmp_path)
    cal.refresh(s, NOW0, feeds=False)
    sc = sch.Scheduler(s, entries=E, adapter_for=lambda n: None)
    j = sc.due(NOW0)
    assert j and (j[0].mode, j[0].purpose) == ("history", "backfill")
    cur.note_attempt(s, "USCPI", NOW0)
    assert sc.due(NOW0 + 60) == [] and sc.due(NOW0 + sch.BACKFILL_RETRY_S)


# ─────────────────────────────── leases ──────────────────────────────────────

def test_lease_blocks_a_second_instance_and_recheck_makes_it_a_noop(tmp_path, keyed):
    E = ents("USCPI")
    s = seeded(tmp_path, E)
    fa = FakeAdapter([{"observations": [SEP]}], name="bls")
    a = sch.Scheduler(s, entries=E, adapter_for=lambda n: fa, owner="hostA:1:a", publish=False)
    b = sch.Scheduler(s, entries=E, adapter_for=lambda n: fa, owner="hostB:1:b", publish=False)
    job = a.due(CPI_OCT)[0]
    assert s.acquire_lease(job.lease_name, "hostB:1:b", 600, now=CPI_OCT)
    assert a.run_job(job, CPI_OCT).status == "leased_elsewhere"
    s.release_lease(job.lease_name, "hostB:1:b")
    assert a.run_job(job, CPI_OCT).status == "ran"
    assert b.run_job(job, CPI_OCT).status == "not_due"                           # B computed the same job: no-op
    assert len(fa.calls) == 1 and s.lease_holder(job.lease_name, now=CPI_OCT) is None


# ─────────────────────────────── quota ───────────────────────────────────────

def test_bls_quota_exhaustion_blocks_until_next_et_day(tmp_path, monkeypatch):
    monkeypatch.delenv("BLS_API_KEY", raising=False)
    monkeypatch.setenv("ECON_BLS_DAILY_LIMIT", "2")
    E = ents("USCPI")
    s = seeded(tmp_path, E)
    fa = FakeAdapter([{"observations": HIST[-2:]}], name="bls", on_exhausted="repeat")
    sc = sch.Scheduler(s, entries=E, adapter_for=lambda n: fa, publish=False)
    assert [r.status for r in sc.tick(CPI_OCT)] == ["ran"]
    assert [r.status for r in sc.tick(CPI_OCT + 60)] == ["ran"]
    assert sch.quota_used(s, "bls", CPI_OCT) == 2
    assert [r.status for r in sc.tick(CPI_OCT + 180)] == ["quota_exhausted"]
    st = s.get_state("USCPI")
    assert st["state"] == "SOURCE_UNAVAILABLE" and "quota" in st["reason"]
    assert sc.due(CPI_OCT + 4000) == []                                          # blocked, not retried
    tomorrow = T("2026-10-15", "00:00")
    assert cur.series_ops(s, "USCPI")["blocked_until"] == tomorrow
    assert [r.status for r in sc.tick(tomorrow + 5)] == ["ran"] and len(fa.calls) == 3
    assert sch.quota_used(s, "bls", tomorrow + 5) == 1


# ─────────────────────────────── backoff ─────────────────────────────────────

def test_exponential_backoff_on_source_errors_then_reset(tmp_path, keyed):
    E = ents("USCPI")
    s = seeded(tmp_path, E)
    fa = FakeAdapter([SourceUnavailable("503 x5"), SourceUnavailable("503 x5"), {"observations": [SEP]}], name="bls")
    sc = sch.Scheduler(s, entries=E, adapter_for=lambda n: fa, publish=False)
    t = CPI_OCT
    assert sc.tick(t)[0].status == "ran"
    assert cur.provider_ops(s, "bls")["backoff_until"] == t + 30
    assert sc.due(t + 25) == []                                                  # backing off
    assert sc.tick(t + 30)[0].status == "ran"
    assert cur.provider_ops(s, "bls")["backoff_until"] == t + 30 + 60           # doubled
    assert sc.tick(t + 90)[0].outcome.ok
    assert cur.provider_ops(s, "bls")["backoff_until"] is None
    assert cur.provider_ops(s, "bls")["consecutive_failures"] == 0
    assert s.get_state("USCPI")["state"] == "CURRENT"


def test_backoff_is_capped():
    n = 20
    assert min(sch.BACKOFF_CAP_S, sch.BACKOFF_BASE_S * 2 ** (n - 1)) == sch.BACKOFF_CAP_S


# ─────────────────────────────── reconcile ───────────────────────────────────

def test_weekly_reconcile_bounded_history_pull(tmp_path, keyed):
    E = ents("USCPI")
    s = seeded(tmp_path, E)
    sc = sch.Scheduler(s, entries=E, adapter_for=lambda n: None, publish=False)
    assert sc.due(NOW0 + 86400) == []
    j = sc.due(NOW0 + sch.RECONCILE_EVERY_S)
    assert j and (j[0].mode, j[0].purpose) == ("history", "reconcile")
    assert j[0].start.year == 2026 - sch.RECONCILE_YEARS
    # never while a live window is open for the same adapter
    assert all(x.purpose == "live" for x in sc.due(CPI_OCT + 5))


def test_reconcile_detects_silent_revision(tmp_path, keyed):
    E = ents("USCPI")
    s = seeded(tmp_path, E)
    revised = [h if h[1] != "2026-06-01" else h[:3] + (h[3] + 0.2,) for h in HIST]
    fa = FakeAdapter([{"observations": revised}], name="bls")
    sc = sch.Scheduler(s, entries=E, adapter_for=lambda n: fa, publish=False)
    t = NOW0 + sch.RECONCILE_EVERY_S
    r = sc.tick(t)
    assert r[0].job.purpose == "reconcile" and r[0].outcome.series["USCPI"].revised == 1
    v = s.versions("USCPI", "2026-06-01")
    assert len(v) == 2 and (v[1].available_at, v[1].available_method, v[1].pit_class) == (t, "detected", "V")
    assert cur.series_ops(s, "USCPI")["last_reconcile_at"] == t
    assert sc.due(t + 60) == []


def test_next_wake_tracks_the_probe(tmp_path, keyed):
    E = ents("USCPI")
    s = seeded(tmp_path, E)
    sc = sch.Scheduler(s, entries=E, adapter_for=lambda n: None)
    assert sc.next_wake(CPI_OCT - 150, max_sleep=60) == CPI_OCT - 120
    assert sc.next_wake(NOW0 + 60, max_sleep=60) == NOW0 + 120


def test_provider_quota_refusal_blocks_for_a_probe_interval_not_forever(tmp_path, monkeypatch):
    """Real 2026-09-29 00:11 ET: BLS v1 answered 'daily threshold reached' AFTER the ET day
    rolled over. A provider-side quota refusal must block the provider (no retry storm at the
    15-min source backoff), but only for QUOTA_PROBE_S -- the reset time is unknown."""
    from api.services.econ import ingest
    from api.services.econ.adapters.bls import BlsQuotaExhausted
    monkeypatch.delenv("BLS_API_KEY", raising=False)
    E = ents("USCPI")
    s = seeded(tmp_path, E)
    now = CPI_OCT
    nb = T("2026-10-15", "00:05")
    fa = FakeAdapter([BlsQuotaExhausted("quota: BLS v1 daily query threshold reached", not_before=nb),
                      {"observations": HIST[-2:] + [SEP]}], name="bls")
    sc = sch.Scheduler(s, entries=E, adapter_for=lambda n: fa, publish=False)
    assert [r.status for r in sc.tick(now)] == ["ran"]
    until = now + ingest.QUOTA_PROBE_S
    ops = cur.series_ops(s, "USCPI")
    assert ops["last_failure_kind"] == "quota" and ops["blocked_until"] == until
    assert cur.provider_ops(s, "bls")["backoff_until"] == until              # not shortened by the 15-min backoff
    assert s.get_state("USCPI")["state"] == "SOURCE_UNAVAILABLE"
    assert sc.due(now + 3600) == [] and len(fa.calls) == 1                     # no retry storm
    assert [r.status for r in sc.tick(until + 5)] == ["ran"] and len(fa.calls) == 2
    assert s.get_state("USCPI")["state"] == "CURRENT"
    assert ingest.quota_block_until(BlsQuotaExhausted("q", not_before=now + 60), now) == now + 60


def test_quota_provider_first_fetch_is_one_recent_window(tmp_path, monkeypatch):
    """An uninitialized BLS series (keyless, 25 queries/day) is first fetched with ONE 10-year
    window, never a 12-query 1913.. history that a quota refusal would throw away."""
    monkeypatch.delenv("BLS_API_KEY", raising=False)
    from datetime import date
    from tests.econ.test_ingest import open_store
    E = ents("USCPI")
    s = open_store(tmp_path)
    cal.refresh(s, NOW0, feeds=False)
    sc = sch.Scheduler(s, entries=E, adapter_for=lambda n: None, publish=False)
    [job] = sc.due(NOW0)
    assert job.purpose == "backfill" and job.mode == "history" and job.start == date(2017, 1, 1)
    from api.services.econ.adapters.bls import estimate_queries
    assert estimate_queries(E, start=job.start) == 1


def test_bls_503_storm_costs_two_attempts_per_poll_and_every_attempt_is_charged(tmp_path, monkeypatch):
    """2026-09-29 JOLTS: one poll burned 12 BLS attempts (10x 503) of a 25/day keyless quota.
    With the production HttpClient defaults a poll now makes at most 2 attempts, both charged to
    provider_quota; the next poll comes from the schedule + provider backoff, not a retry loop."""
    from api.services.econ.http import HttpClient

    monkeypatch.delenv("BLS_API_KEY", raising=False)
    E = ents("USCPI")
    s = seeded(tmp_path, E)
    sent = []

    class R503:
        status_code, headers, content = 503, {}, b""

    def transport(req):
        sent.append(req.url)
        return R503()
    http = HttpClient(transport=transport, sleep=lambda x: None, host_intervals={}, default_interval=0)

    def step(specs, mode, start, end, http):
        http.post_json("https://api.bls.gov/publicAPI/v1/timeseries/data/", {"seriesid": ["x"]})
    fa = FakeAdapter([step, step], name="bls")
    sc = sch.Scheduler(s, entries=E, http=http, adapter_for=lambda n: fa, publish=False)
    r = sc.tick(CPI_OCT)
    assert [x.status for x in r] == ["ran"] and not r[0].outcome.ok
    assert len(sent) == 2 and sch.quota_used(s, "bls", CPI_OCT) == 2
    assert cur.provider_ops(s, "bls")["backoff_until"] == CPI_OCT + 30         # next poll: schedule + backoff
    assert sc.due(CPI_OCT + 20) == []
