"""Deterministic release simulations: fake clock + FakeAdapter (+ a fake HTTP
transport behind the real HttpClient where the transport matters). No network,
no real sleeping. Every scenario ends with the LEAK INVARIANT: no stored row is
available before its release's scheduled time.

Scenario: CPI for 2026-09, bls:cpi event 2026-10-14 08:30 ET (PFEI date,
configured time). USCPI history 2023-01..2026-08 is backfilled on 2026-09-28;
USCPIMOM (mom_pct of USCPI) is derived downstream.
"""
from __future__ import annotations

import json

import pytest

from api.services.econ import currentness as cur
from api.services.econ import ingest
from api.services.econ import store as st
from api.services.econ.adapters.fake import FakeAdapter
from api.services.econ.http import HttpClient
from api.services.econ.model import Currentness as C, FetchResult, MalformedPayload, RawObs
from api.services.econ.scheduler import Scheduler
from api.services.econ.service import EconService
from tests.econ.test_ingest import (CPI_OCT, HIST, KEY, NOW0, SEP, Clock, T, _no_archive, ents, keyed,  # noqa: F401
                                    n_releases, n_rows, seeded)

S = CPI_OCT
OLD = [HIST[-2], HIST[-1]]                   # what the provider serves before the release: Jul, Aug
NEW = OLD + [SEP]


def assert_no_leak(s):
    bad = s.conn.execute(
        "SELECT o.series_id, o.period_start, o.available_at, r.scheduled_at, r.release_key FROM observation o"
        " JOIN release r ON r.release_id=o.release_id WHERE r.scheduled_at IS NOT NULL"
        " AND o.available_at < r.scheduled_at").fetchall()
    assert bad == [], bad
    # and no row of a calendar-scheduled period is visible before that period's event
    for ps, av in s.conn.execute("SELECT period_start, MIN(available_at) FROM observation WHERE series_id='USCPI'"
                                 " AND period_start='2026-09-01'"):
        assert ps is None or av >= S


class Sim:
    def __init__(self, tmp_path, script, *, http=None, owner="simhost:1:a", entries=None, store=None,
                 on_exhausted="raise"):
        self.E = entries or ents("USCPI", "USCPIMOM")
        self.s = store or seeded(tmp_path, self.E)
        self.fa = script if isinstance(script, FakeAdapter) else FakeAdapter(script, name="bls",
                                                                             on_exhausted=on_exhausted)
        self.sc = Scheduler(self.s, entries=self.E, http=http, adapter_for=lambda n: self.fa, owner=owner,
                            publish=False)
        self.t = None
        self.ticks = []

    def run(self, t0, t1):
        t = t0
        while t <= t1:
            self.t = t
            res = self.sc.tick(t)
            if res:
                self.ticks.append((t, [r.status for r in res]))
            t = self.sc.next_wake(t, max_sleep=60)
        return self

    def state(self, t, sym="USCPI"):
        spec = [e for e in self.E if e["symbol"] == sym][0]
        return cur.refresh_state(self.s, spec, t).state

    @property
    def poll_times(self):
        return [t for t, _ in self.ticks]


def appears_at(sim_ref, t_pub, before=OLD, after=NEW):
    """Adapter step: the provider starts serving `after` from t_pub (sim clock)."""
    def step(specs, mode, start, end, http):
        obs = after if sim_ref[0].t >= t_pub else before
        return [FetchResult("bls", "bls:v2:CUSR0000SA0:latest", [RawObs(*o) for o in obs], http_status=200)]
    return step


# ─────────────────────────────── on time / late ──────────────────────────────

def test_release_on_time(tmp_path, keyed):
    ref = [None]
    sim = Sim(tmp_path, [appears_at(ref, S)], on_exhausted="repeat")
    ref[0] = sim
    sim.run(S - 300, S + 600)
    assert sim.poll_times[:2] == [S - 120, S]                              # probe T-2m, then T
    assert len(sim.poll_times) == 2                                        # satisfied: polling stops
    r = sim.s.versions("USCPI", "2026-09-01")
    assert len(r) == 1 and (r[0].available_at, r[0].available_method, r[0].pit_class) == (S, "scheduled", "V")
    assert sim.s.get_release(r[0].release_id)["release_key"] == "bls:cpi:2026-09"
    assert sim.state(S + 600) == C.CURRENT and sim.state(S + 600, "USCPIMOM") == C.CURRENT
    assert sim.s.versions("USCPIMOM", "2026-09-01")[0].available_at == S
    assert_no_leak(sim.s)


def test_release_ten_minutes_late(tmp_path, keyed):
    ref = [None]
    sim = Sim(tmp_path, [appears_at(ref, S + 600)], on_exhausted="repeat")
    ref[0] = sim
    rows0, rel0 = n_rows(sim.s), n_releases(sim.s)
    sim.run(S - 300, S + 300)
    assert sim.state(S + 300) == C.CHECKING
    assert n_rows(sim.s) == rows0 and n_releases(sim.s) == rel0           # 200s with no new period: nothing written
    polls = [t for t in sim.poll_times if S <= t <= S + 300]
    assert polls == list(range(S, S + 301, 20))                            # burst: every 20 s
    sim.run(S + 301, S + 900)
    r = sim.s.versions("USCPI", "2026-09-01")[0]
    assert (r.available_at, r.available_method) == (S + 600, "detected")  # actual detection, not the schedule
    assert sim.state(S + 900) == C.CURRENT
    assert n_releases(sim.s) == rel0 + 2                                   # bls:cpi:2026-09 + the derived release
    assert_no_leak(sim.s)


# ─────────────────────────────── transport failures ──────────────────────────

class Transport:
    """Fake HttpClient transport: a script of (status, headers, body) or exceptions; repeats the last."""

    def __init__(self, script):
        self.script = list(script)
        self.requests = []

    def __call__(self, req):
        self.requests.append(req)
        item = self.script.pop(0) if len(self.script) > 1 else self.script[0]
        if isinstance(item, BaseException):
            raise item

        class R:
            pass
        r = R()
        r.status_code, r.headers, r.content = item[0], item[1], item[2]
        return r


def http_step(url=f"https://api.bls.gov/publicAPI/v2/timeseries/data/?registrationkey={KEY}"):
    def step(specs, mode, start, end, http):
        resp = http.get(url)
        resp.raise_for_status()
        obs = [RawObs(*o) for o in resp.json()]
        return [FetchResult("bls", "bls:v2:CUSR0000SA0:latest", obs, http_status=resp.status,
                            payload_sha256="x", raw_payload=resp.content)]
    return step


def client(transport, clock):
    return HttpClient(transport=transport, clock=clock, sleep=clock.sleep, max_retries=2, backoff_base=1.0,
                      backoff_cap=60, rng=lambda: 1.0, host_intervals={}, default_interval=0)


OK_NEW = (200, {}, json.dumps(NEW).encode())


def test_provider_500s_then_recovery(tmp_path, keyed):
    clock = Clock(S)
    tr = Transport([(500, {}, b"err")] * 9 + [OK_NEW])                    # 3 polls x 3 attempts fail
    sim = Sim(tmp_path, [http_step()], http=client(tr, clock), on_exhausted="repeat")
    sim.run(S, S + 29)
    assert sim.state(S + 29) == C.CHECKING                                 # one failure: still checking
    sim.run(S + 30, S + 119)
    assert sim.state(S + 119) == C.SOURCE_UNAVAILABLE                      # 3 consecutive failures
    assert cur.provider_ops(sim.s, "bls")["backoff_until"] == S + 90 + 120  # 30 -> 60 -> 120 s
    sim.run(S + 120, S + 400)
    assert sim.state(S + 400) == C.CURRENT
    r = sim.s.versions("USCPI", "2026-09-01")[0]
    assert r.available_at == S + 210 and r.available_method == "detected"
    errs = [a["error"] for a in sim.s.list_acquisitions("bls", limit=50) if a["error"]]
    assert errs and all("HTTP" in e or "status 500" in e for e in errs) and not any(KEY in e for e in errs)
    assert cur.provider_ops(sim.s, "bls")["consecutive_failures"] == 0
    assert_no_leak(sim.s)


def test_429_with_retry_after(tmp_path, keyed):
    clock = Clock(S)
    tr = Transport([(429, {"Retry-After": "7"}, b""), OK_NEW])
    sim = Sim(tmp_path, [http_step()], http=client(tr, clock), on_exhausted="repeat")
    sim.run(S, S)
    assert 7.0 in clock.slept and len(tr.requests) == 2                   # honoured Retry-After, then succeeded
    assert sim.state(S) == C.CURRENT
    assert sim.s.versions("USCPI", "2026-09-01")[0].available_at == S
    assert cur.series_ops(sim.s, "USCPI")["consecutive_failures"] == 0
    assert "Retry-After" not in json.dumps(sim.s.validation_events())


def test_network_timeout(tmp_path, keyed):
    clock = Clock(S)
    tr = Transport([TimeoutError("read timed out")])
    sim = Sim(tmp_path, [http_step()], http=client(tr, clock), on_exhausted="repeat")
    sim.run(S, S)
    assert len(tr.requests) == 3                                           # bounded retries
    o = cur.series_ops(sim.s, "USCPI")
    assert o["last_failure_kind"] == "source" and "TimeoutError" in o["last_error"]
    call = sim.s.list_acquisitions("bls", limit=5)[0]
    assert call["outcome"] == "error" and KEY not in call["error"] and "[REDACTED]" in call["error"]
    assert sim.state(S + 1) == C.CHECKING and sim.s.latest_point("USCPI").period_start == "2026-08-01"


# ─────────────────────────────── bad data ────────────────────────────────────

def test_malformed_payload_keeps_last_good_and_writes_nothing(tmp_path, keyed):
    bad_grid = [("USCPI", "2026-09-15", "2026-09-30", 322.0)]
    sim = Sim(tmp_path, [MalformedPayload("bls: body was HTML"), {"observations": OLD + bad_grid},
                         {"observations": NEW}])
    rows0, rel0 = n_rows(sim.s), n_releases(sim.s)
    sim.run(S, S)
    assert sim.state(S) == C.VALIDATION_FAILED
    assert cur.provider_ops(sim.s, "bls")["backoff_until"] == S + 30      # the provider failed to answer sanely
    sim.run(S + 30, S + 30)                                                # a 200 whose rows fail the period grid
    assert sim.state(S + 30) == C.VALIDATION_FAILED
    assert n_rows(sim.s) == rows0 and n_releases(sim.s) == rel0           # nothing written, no release rows
    assert sim.s.latest_point("USCPI").period_start == "2026-08-01"       # last good retained
    ev = sim.s.validation_events("USCPI")
    assert len(ev) == 2 and all(e["severity"] == "reject" for e in ev)
    assert ev[0]["reasons"][0].startswith("schema:")
    sim.run(S + 50, S + 50)
    assert sim.state(S + 50) == C.CURRENT
    assert_no_leak(sim.s)


def scenario_same_value(tmp_path):
    """The provider answers 200 with the SAME data (no Sep) on every poll."""
    sim = Sim(tmp_path, [{"observations": OLD}], on_exhausted="repeat")
    rows0, rel0 = n_rows(sim.s), n_releases(sim.s)
    sim.run(S - 300, S + 300)
    return sim, rows0, rel0


def test_same_value_repeatedly_writes_nothing_and_never_advances(tmp_path, keyed):
    sim, rows0, rel0 = scenario_same_value(tmp_path)
    assert len(sim.fa.calls) >= 15
    assert n_rows(sim.s) == rows0 and n_releases(sim.s) == rel0
    assert sim.state(S + 300) == C.CHECKING
    sim.run(S + 301, S + 3700)
    assert sim.state(S + 3700) == C.DELAYED                                # never CURRENT
    assert n_rows(sim.s) == rows0 and n_releases(sim.s) == rel0


# ─────────────────────────────── revisions ───────────────────────────────────

def test_revision_after_initial_release(tmp_path, keyed):
    S_NOV = T("2026-11-10", "08:30")
    OCT = ("USCPI", "2026-10-01", "2026-10-31", 322.6)
    sep_rev = SEP[:3] + (322.2,)
    sim = Sim(tmp_path, [{"observations": NEW}, {"observations": OLD + [sep_rev, OCT]}])
    sim.run(S, S)
    mom_sep_v1 = sim.s.versions("USCPIMOM", "2026-09-01")
    sim.run(S_NOV, S_NOV)
    v = sim.s.versions("USCPI", "2026-09-01")
    assert [x.value for x in v] == [322.0, 322.2]                          # new vintage, original kept
    assert v[1].available_at == S_NOV and sim.s.get_release(v[1].release_id)["release_key"] == "bls:cpi:2026-10"
    assert sim.s.latest_point("USCPI", asof=S_NOV - 1).value == 322.0     # as-of before the revision
    mom = sim.s.versions("USCPIMOM", "2026-09-01")
    assert len(mom) == len(mom_sep_v1) + 1 and mom[0].value == mom_sep_v1[0].value
    assert mom[-1].available_at == S_NOV
    assert sim.s.versions("USCPIMOM", "2026-10-01")[0].available_at == S_NOV
    assert sim.state(S_NOV + 60) == C.CURRENT
    assert_no_leak(sim.s)


# ─────────────────────────────── restarts ────────────────────────────────────

def _service(s, E, fa, clock, owner, publisher=None, publish=False):
    return EconService(s, entries=E, adapter_for=lambda n: fa, clock=clock, sleep=clock.sleep, owner=owner,
                       feeds=False, publisher=publisher, publish=publish)


def test_restart_one_minute_before_release_after_crash_holding_a_lease(tmp_path, keyed):
    E = ents("USCPI", "USCPIMOM")
    s = seeded(tmp_path, E)
    s.acquire_lease("ingest:bls", "simhost:1:crashed", 600, now=S - 61)   # died mid-job, lease not released
    clock = Clock(S - 60)
    ref = [None]
    fa = FakeAdapter([appears_at(ref, S)], name="bls", on_exhausted="repeat")
    svc = _service(s, E, fa, clock, "simhost:1:restarted")                # same host, pid 1 reused
    ref[0] = type("R", (), {"t": None})()
    svc.boot()
    assert s.lease_holder("ingest:bls", now=S - 60) is None               # stale lease reclaimed at boot
    for t in (S - 60, S):
        ref[0].t = t
        svc.tick(t)
    r = s.versions("USCPI", "2026-09-01")
    assert r and r[0].available_at == S and s.get_state("USCPI")["state"] == "CURRENT"
    assert_no_leak(s)


def test_restart_during_polling_resumes_from_db(tmp_path, keyed):
    E = ents("USCPI", "USCPIMOM")
    ref = [None]
    fa = FakeAdapter([appears_at(ref, S + 200)], name="bls", on_exhausted="repeat")
    a = Sim(tmp_path, fa, entries=E, owner="host1:11:a")
    ref[0] = a
    a.run(S, S + 45)                                                        # polls T, T+20, T+40, then "crash"
    assert a.poll_times == [S, S + 20, S + 40]
    b = Sim(tmp_path, fa, entries=E, owner="host2:22:b", store=st.connect(a.s.path))
    ref[0] = b
    b.run(S + 300, S + 400)                                                 # back after a 4-minute outage
    assert b.poll_times[0] == S + 300                                      # due immediately (last poll + 20 s < now)
    r = b.s.versions("USCPI", "2026-09-01")[0]
    assert (r.available_at, r.available_method) == (S + 300, "detected")  # conservative: first sighting
    assert b.state(S + 400) == C.CURRENT and len(fa.calls) == 4
    assert_no_leak(b.s)


def test_restart_after_acquisition_before_publication(tmp_path, keyed):
    E = ents("USCPI", "USCPIMOM")
    s = seeded(tmp_path, E)
    clock = Clock(S)

    def crash(store, sym, now=None):
        raise RuntimeError("process killed during publish")

    fa = FakeAdapter([{"observations": NEW}], name="bls")
    a = _service(s, E, fa, clock, "h:1:a", publisher=crash, publish=True)
    a.boot()
    a.tick(S)
    assert s.versions("USCPI", "2026-09-01")
    calls = []
    rec = lambda store, sym, now=None: calls.append(sym)                   # noqa: E731
    b = _service(st.connect(s.path), E, FakeAdapter([], name="bls"), Clock(S + 60), "h:2:b", publisher=rec,
                 publish=True)
    b.boot()
    assert sorted(calls) == ["USCPI", "USCPIMOM"]                          # re-published exactly once
    calls.clear()
    c = _service(st.connect(s.path), E, FakeAdapter([], name="bls"), Clock(S + 120), "h:3:c", publisher=rec,
                 publish=True)
    c.boot()
    assert calls == []                                                     # idempotent: nothing pending
    assert n_releases(s) == n_releases(st.connect(s.path))


def test_duplicate_worker_exactly_one_ingestion(tmp_path, keyed):
    E = ents("USCPI", "USCPIMOM")
    s = seeded(tmp_path, E)
    s2 = st.connect(s.path)                                                # a second process: own connection
    inner = {}
    b_calls = []

    def a_step(specs, mode, start, end, http):
        inner["b"] = b.run_job(b_jobs[0], S).status                       # B runs its job WHILE A holds the lease
        return [FetchResult("bls", "bls:v2:x", [RawObs(*o) for o in NEW], http_status=200)]

    fa_a = FakeAdapter([a_step], name="bls")
    fa_b = FakeAdapter([lambda *a, **k: b_calls.append(1) or []], name="bls", on_exhausted="repeat")
    a = Scheduler(s, entries=E, adapter_for=lambda n: fa_a, owner="hostA:1:a", publish=False)
    b = Scheduler(s2, entries=E, adapter_for=lambda n: fa_b, owner="hostB:2:b", publish=False)
    b_jobs = b.due(S)                                                      # both instances computed the same job
    assert [(j.adapter, j.symbols) for j in b_jobs] == [(j.adapter, j.symbols) for j in a.due(S)]
    assert [r.status for r in a.tick(S)] == ["ran"]
    assert inner["b"] == "leased_elsewhere"
    assert b.run_job(b_jobs[0], S).status == "not_due"                     # re-checked under the lease: done
    assert b.tick(S + 1) == [] and b.tick(S + 25) == []                    # nothing due: A satisfied the event
    assert b_calls == [] and len(fa_a.calls) == 1
    assert s.conn.execute("SELECT COUNT(*) FROM release WHERE release_key='bls:cpi:2026-09'").fetchone()[0] == 1
    assert n_rows(s, "USCPI") == len(HIST) + 1
    assert_no_leak(s)


# ─────────────────────────────── quota ───────────────────────────────────────

def test_bls_keyless_profile_fits_the_daily_quota(tmp_path, monkeypatch):
    monkeypatch.delenv("BLS_API_KEY", raising=False)
    sim = Sim(tmp_path, [{"observations": OLD}], on_exhausted="repeat")   # release never appears
    sim.run(S - 300, T("2026-10-14", "23:59"))
    from api.services.econ.scheduler import quota_used
    assert quota_used(sim.s, "bls", S) == len(sim.fa.calls) <= 25          # 25/day keyless budget respected
    assert all(st_ == ["ran"] for _, st_ in sim.ticks)
    assert sim.state(T("2026-10-14", "23:59")) == C.DELAYED


def test_bls_quota_exhausted(tmp_path, monkeypatch):
    monkeypatch.delenv("BLS_API_KEY", raising=False)
    monkeypatch.setenv("ECON_BLS_DAILY_LIMIT", "5")
    sim = Sim(tmp_path, [{"observations": OLD}], on_exhausted="repeat")
    sim.run(S, S + 3 * 3600)
    assert len(sim.fa.calls) == 5 and ["quota_exhausted"] in [x for _, x in sim.ticks]
    st_ = sim.s.get_state("USCPI")
    assert st_["state"] == "SOURCE_UNAVAILABLE" and "quota" in st_["reason"]
    assert cur.series_ops(sim.s, "USCPI")["blocked_until"] == T("2026-10-15")
    n = len(sim.fa.calls)
    sim.run(S + 3 * 3600 + 1, T("2026-10-14", "23:59"))
    assert len(sim.fa.calls) == n                                          # no request sent while exhausted
    sim.fa.push({"observations": NEW})
    sim.fa.on_exhausted = "repeat"
    sim.run(T("2026-10-15"), T("2026-10-15", "01:00"))
    assert sim.state(T("2026-10-15", "01:00")) == C.CURRENT               # retried the next ET day


# ─────────────────────────────── negative controls ───────────────────────────

def test_negative_control_200_without_new_period_mutation_is_caught(tmp_path, keyed, monkeypatch):
    """Mutation: currentness treats ANY successful fetch after the schedule as satisfying
    the event. The same-value scenario must then report CURRENT -- i.e. the guard in
    test_same_value_repeatedly_writes_nothing_and_never_advances would FAIL."""
    orig = cur.event_satisfied

    def mutant(exp, ev, facts):
        if (facts.last_success_at or 0) >= ev.scheduled_at:
            return True, ""
        return orig(exp, ev, facts)

    monkeypatch.setattr(cur, "event_satisfied", mutant)
    sim, _, _ = scenario_same_value(tmp_path)
    assert sim.state(S + 300) == C.CURRENT                                  # the mutant lies ...
    monkeypatch.setattr(cur, "event_satisfied", orig)
    assert sim.state(S + 300) == C.CHECKING                                 # ... the real rule does not


def test_negative_control_future_release_leakage(tmp_path, keyed, monkeypatch):
    """The provider publishes EARLY (the T-2 min probe already sees Sep)."""
    sim = Sim(tmp_path, [{"observations": NEW}], on_exhausted="repeat")
    sim.run(S - 130, S - 100)
    r = sim.s.versions("USCPI", "2026-09-01")[0]
    assert r.available_at == S                                             # clamped to the schedule
    assert sim.s.latest_point("USCPI", asof=S - 1).period_start == "2026-08-01"
    assert sim.s.versions("USCPIMOM", "2026-09-01")[0].available_at == S
    assert_no_leak(sim.s)
    # mutation: drop the clamp -> the invariant must catch the leak
    monkeypatch.setattr(ingest, "live_available_at", lambda s_, first_seen, pub: (first_seen, "detected"))
    sim2 = Sim(tmp_path / "m", [{"observations": NEW}], on_exhausted="repeat")
    sim2.run(S - 130, S - 100)
    with pytest.raises(AssertionError):
        assert_no_leak(sim2.s)


def test_negative_control_no_duplicate_release_rows_on_retry(tmp_path, keyed):
    sim = Sim(tmp_path, [{"raise": "source_unavailable"}, {"observations": NEW}], on_exhausted="repeat")
    sim.run(S, S + 120)
    rel = n_releases(sim.s)
    rows = n_rows(sim.s)
    for i in range(5):                                                      # forced retries of the same data
        out = ingest.run_fetch(sim.s, sim.E, "latest", S + 200 + i, None, sim.fa, entries=sim.E, publish=False)
        assert out.ok and out.written == 0
    assert n_releases(sim.s) == rel and n_rows(sim.s) == rows
    keys = [r[0] for r in sim.s.conn.execute("SELECT release_key FROM release WHERE release_key LIKE 'bls:cpi:%'")]
    assert keys == ["bls:cpi:2026-09"]
    assert_no_leak(sim.s)
