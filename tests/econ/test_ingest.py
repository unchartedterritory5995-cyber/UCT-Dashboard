"""ingest.py: fetch -> archive -> validate -> diff -> write -> derive -> publish -> state.

Also hosts the small shared helpers the release-system tests import
(test_scheduler / test_service / test_release_simulation): a fake clock, registry
entry copies, synthetic monthly history. FakeAdapter only; no network; no sleeping.
"""
from __future__ import annotations

import copy
import os
import time

import pytest

from api.services.econ import calendar as cal
from api.services.econ import currentness as cur
from api.services.econ import ingest, registry, secrets, timeutil
from api.services.econ import store as st
from api.services.econ.adapters.fake import FakeAdapter
from api.services.econ.model import FetchResult, RawObs

KEY = "TESTKEY-bls-0123456789abcdef"


# ─────────────────────────────── shared helpers ──────────────────────────────

def T(d: str, t: str = "00:00") -> int:
    return timeutil.et_to_utc(d, t)


class Clock:
    """Injectable clock whose sleep() advances time (never really sleeps)."""

    def __init__(self, t):
        self.t = float(t)
        self.slept = []

    def __call__(self) -> float:
        return self.t

    def sleep(self, s) -> None:
        self.slept.append(s)
        self.t += s

    def set(self, t) -> None:
        self.t = float(t)


def ents(*syms: str, **overrides) -> list[dict]:
    out = []
    for s in syms:
        e = copy.deepcopy(registry.get(s))
        for path, v in overrides.get(s, {}).items():
            cur_ = e
            parts = path.split(".")
            for p in parts[:-1]:
                cur_ = cur_[p]
            cur_[parts[-1]] = v
        out.append(e)
    return out


def months(n: int, *, sym: str = "USCPI", start=(2023, 1), base: float = 300.0, step: float = 0.5,
           bump: dict | None = None) -> list[tuple]:
    """n monthly observations tuples (series, ps, pe, value) from `start`."""
    out = []
    y, m = start
    for i in range(n):
        ps, pe = timeutil.month_bounds(y, m)
        v = base + step * i + (bump or {}).get(ps.isoformat(), 0.0)
        out.append((sym, ps.isoformat(), pe.isoformat(), round(v, 6)))
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


HIST = months(44)                       # 2023-01 .. 2026-08
SEP = ("USCPI", "2026-09-01", "2026-09-30", 322.0)
NOW0 = T("2026-09-28", "12:00")
CPI_OCT = T("2026-10-14", "08:30")      # bls:cpi event for 2026-09 (PFEI date, configured 08:30)


def open_store(tmp_path, name="econ.db"):
    return st.connect(str(tmp_path / name))


def seeded(tmp_path, entries, hist=HIST, now=NOW0, adapter_name="bls"):
    """A store with calendars refreshed (no feeds) and `hist` backfilled at `now`."""
    s = open_store(tmp_path)
    cal.refresh(s, now, feeds=False)
    fa = FakeAdapter([{"observations": hist}], name=adapter_name)
    outs = ingest.backfill(s, entries, http=None, now=now, adapter_for=lambda n: fa, entries=entries,
                           publish=False)
    assert all(o.ok for o in outs), [o.error for o in outs]
    return s


def n_rows(s, sym=None) -> int:
    if sym:
        return s.conn.execute("SELECT COUNT(*) FROM observation WHERE series_id=?", (sym,)).fetchone()[0]
    return s.conn.execute("SELECT COUNT(*) FROM observation").fetchone()[0]


def n_releases(s) -> int:
    return s.conn.execute("SELECT COUNT(*) FROM release").fetchone()[0]


@pytest.fixture
def keyed(monkeypatch):
    monkeypatch.setenv("BLS_API_KEY", KEY)
    yield KEY


@pytest.fixture(autouse=True)
def _no_archive(monkeypatch):
    monkeypatch.delenv("ECON_ARCHIVE", raising=False)
    monkeypatch.delenv("ECON_BLS_DAILY_LIMIT", raising=False)


# ─────────────────────────────── pure helpers ────────────────────────────────

def test_rule_available_at_kinds():
    cpi = registry.get("USCPI")
    assert ingest.rule_available_at(cpi, "2026-08-01", "2026-08-31") == T("2026-09-25", "08:30")
    h15 = registry.get("UST10Y")                      # business_days_after 1, 16:15
    assert ingest.rule_available_at(h15, "2026-10-09", "2026-10-09") == T("2026-10-13", "16:15")  # Columbus Day
    esms = registry.get("USEMPIRE")                   # period_start_plus_days 17
    assert ingest.rule_available_at(esms, "2026-09-01", "2026-09-30") == T("2026-09-18", "08:30")
    yoy = registry.get("USCPIYOY")                    # derived: no rule
    assert ingest.rule_available_at(yoy, "2026-08-01", "2026-08-31") is None


def test_live_available_at_rules():
    S = CPI_OCT
    assert ingest.live_available_at(S, S + 5, None) == (S, "scheduled")
    assert ingest.live_available_at(S, S - 90, None) == (S, "scheduled")            # early: clamp, never before S
    assert ingest.live_available_at(S, S + 600, None) == (S + 600, "detected")       # late
    assert ingest.live_available_at(S, S + 600, S + 120) == (S + 120, "source_timestamp")
    assert ingest.live_available_at(S, S + 600, S - 3600) == (S + 600, "detected")   # provider time before S ignored
    assert ingest.live_available_at(S, S + 600, S + 900) == (S + 600, "detected")    # provider time after sighting ignored
    assert ingest.live_available_at(None, 1000, 900) == (900, "source_timestamp")
    assert ingest.live_available_at(None, 1000, None) == (1000, "detected")


# ─────────────────────────────── backfill ────────────────────────────────────

def test_backfill_rule_times_pit_and_idempotence(tmp_path):
    E = ents("USCPI", "USCPINSA")
    s = open_store(tmp_path)
    cal.refresh(s, NOW0, feeds=False)
    hist = HIST + [(("USCPINSA",) + h[1:]) for h in HIST]
    fa = FakeAdapter([{"observations": hist}, {"observations": hist}], name="bls")
    o1 = ingest.backfill(s, E, http=None, now=NOW0, adapter_for=lambda n: fa, entries=E, publish=False, run_id="r1")
    assert o1[0].written == 88
    rows = s.versions("USCPI", "2026-07-01")
    assert rows[0].available_method == "rule" and rows[0].pit_class == "L"          # SA series: revises
    assert s.versions("USCPINSA", "2026-07-01")[0].pit_class == "U"                 # NSA: revision none
    # Jul CPI: rule (Aug 31 +25d = Aug 25 08:30) raised to the configured event (Aug 12)? rule is LATER -> rule wins
    assert rows[0].available_at == T("2026-08-25", "08:30")
    rel = s.get_release(rows[0].release_id)
    assert rel["release_key"] == "backfill:USCPI:r1" and rel["kind"] == "backfill"
    n_rel = n_releases(s)
    o2 = ingest.backfill(s, E, http=None, now=NOW0 + 60, adapter_for=lambda n: fa, entries=E, publish=False,
                         run_id="r2")
    assert o2[0].written == 0 and n_releases(s) == n_rel                             # no empty release rows
    assert all(r.status == "unchanged" for r in o2[0].series.values())


def test_backfill_never_places_before_a_known_schedule(tmp_path):
    E = ents("USCPI", **{"USCPI": {"release.lag_rule.days": 1}})                     # an over-eager rule
    s = seeded(tmp_path, E)
    aug = s.versions("USCPI", "2026-08-01")[0]
    assert aug.available_at == T("2026-09-11", "08:30")                              # raised to the PFEI event


def test_backfill_rule_capped_at_first_sighting(tmp_path):
    E = ents("UST10Y")
    s = open_store(tmp_path)
    now = T("2026-09-28", "10:00")
    cal.refresh(s, now, feeds=False)
    obs = [("UST10Y", "2026-09-24", "2026-09-24", 4.1), ("UST10Y", "2026-09-25", "2026-09-25", 4.2)]
    fa = FakeAdapter([{"observations": obs}], name="fed_ddp")
    ingest.backfill(s, E, http=None, now=now, adapter_for=lambda n: fa, entries=E, publish=False)
    r = s.versions("UST10Y", "2026-09-25")[0]
    # rule (next business day 16:15) is later than the first sighting (10:00) -> capped at the sighting,
    # but the KNOWN schedule (Mon 16:15) is later still and wins: never earlier than scheduled.
    assert r.available_at == T("2026-09-28", "16:15")
    assert s.versions("UST10Y", "2026-09-24")[0].available_at == T("2026-09-25", "16:15")


# ─────────────────────────────── live capture ────────────────────────────────

def test_live_on_time_uses_schedule_and_calendar_release_key(tmp_path, keyed):
    E = ents("USCPI")
    s = seeded(tmp_path, E)
    fa = FakeAdapter([{"observations": HIST[-3:] + [SEP]}], name="bls")
    out = ingest.run_fetch(s, E, "latest", CPI_OCT + 5, None, fa, entries=E, publish=False)
    assert out.series["USCPI"].status == "written" and out.series["USCPI"].release_keys == ["bls:cpi:2026-09"]
    r = s.versions("USCPI", "2026-09-01")[0]
    assert (r.available_at, r.available_method, r.pit_class) == (CPI_OCT, "scheduled", "V")
    rel = s.get_release(r.release_id)
    assert rel["scheduled_at"] == CPI_OCT and rel["calendar_key"] == "bls:cpi"
    assert s.get_state("USCPI")["state"] == "CURRENT"


def test_live_early_sighting_is_clamped_and_invisible_before_schedule(tmp_path, keyed):
    E = ents("USCPI")
    s = seeded(tmp_path, E)
    fa = FakeAdapter([{"observations": HIST[-3:] + [SEP]}], name="bls")
    ingest.run_fetch(s, E, "latest", CPI_OCT - 100, None, fa, entries=E, publish=False)
    r = s.versions("USCPI", "2026-09-01")[0]
    assert r.available_at == CPI_OCT
    assert s.latest_point("USCPI", asof=CPI_OCT - 1).period_start == "2026-08-01"
    assert s.latest_point("USCPI", asof=CPI_OCT).period_start == "2026-09-01"


def test_live_no_event_uses_adapter_key_and_detection(tmp_path, keyed):
    E = ents("USCPI")
    s = seeded(tmp_path, E)
    s.delete_event(s.events("bls:cpi", start="2026-10-14", end="2026-10-14")[0]["event_id"], at=NOW0)
    now = CPI_OCT + 5
    fa = FakeAdapter([{"observations": HIST[-3:] + [SEP]}], name="bls")
    out = ingest.run_fetch(s, E, "latest", now, None, fa, entries=E, publish=False)
    assert out.series["USCPI"].release_keys == ["bls:USCPI:" + time.strftime("%Y-%m-%d", time.gmtime(now))]
    r = s.versions("USCPI", "2026-09-01")[0]
    assert (r.available_at, r.available_method) == (now, "detected")


def test_source_published_at_wins_when_bounded(tmp_path, keyed):
    E = ents("USCPI")
    s = seeded(tmp_path, E)
    fa = FakeAdapter([{"observations": HIST[-3:] + [SEP], "source_published_at": CPI_OCT + 240}], name="bls")
    ingest.run_fetch(s, E, "latest", CPI_OCT + 900, None, fa, entries=E, publish=False)
    r = s.versions("USCPI", "2026-09-01")[0]
    assert (r.available_at, r.available_method) == (CPI_OCT + 240, "source_timestamp")
    assert cur.series_ops(s, "USCPI")["last_published_at"] == CPI_OCT + 240


def test_intra_release_correction_gets_its_own_release(tmp_path, keyed):
    E = ents("USCPI")
    s = seeded(tmp_path, E)
    fa = FakeAdapter([{"observations": [SEP]}, {"observations": [SEP[:3] + (322.1,)]}], name="bls")
    ingest.run_fetch(s, E, "latest", CPI_OCT + 5, None, fa, entries=E, publish=False)
    out = ingest.run_fetch(s, E, "latest", CPI_OCT + 400, None, fa, entries=E, publish=False)
    assert out.series["USCPI"].release_keys == ["bls:cpi:2026-09#c1"]
    v = s.versions("USCPI", "2026-09-01")
    assert [x.value for x in v] == [322.0, 322.1]                                    # original kept
    assert v[1].available_at == CPI_OCT + 400 and v[1].available_method == "detected"


def test_first_ever_latest_fetch_is_history_not_a_live_cluster(tmp_path, keyed):
    E = ents("USCPI")
    s = open_store(tmp_path)
    cal.refresh(s, NOW0, feeds=False)
    fa = FakeAdapter([{"observations": HIST}], name="bls")
    ingest.run_fetch(s, E, "latest", NOW0, None, fa, entries=E, publish=False)
    avs = {r.period_start: r for r in s.vintages("USCPI")}
    assert avs["2023-01-01"].available_method == "rule" and avs["2023-01-01"].available_at < T("2023-03-01")
    assert all(r.available_at <= NOW0 or r.available_method == "rule" for r in avs.values())


# ─────────────────────────────── validation / failure ────────────────────────

class RecHttp:
    """Stands in for HttpClient: records what the pipeline commits."""

    def __init__(self):
        self.committed = []

    def get(self, url, params=None, headers=None, conditional_key=None, defer_validators=False):
        assert defer_validators is True
        from api.services.econ.http import Response
        return Response(200, {"etag": '"v1"'}, b"{}", url, validators=('"v1"', None))

    def commit_validators(self, key, resp):
        self.committed.append(key)


def _adapter_with_validators(obs):
    def step(specs, mode, start, end, http):
        resp = http.get("https://example.invalid/x", conditional_key="fake:cond")
        http.commit_validators("fake:cond", resp)             # the adapter commits eagerly -- deferred anyway
        return [FetchResult("bls", "fake:cond", [RawObs(*o) for o in obs], http_status=200)]
    return step


def test_validation_failure_writes_nothing_keeps_last_good_and_holds_validators(tmp_path, keyed):
    E = ents("USCPI")
    s = seeded(tmp_path, E)
    before = n_rows(s)
    bad = [("USCPI", "2026-09-02", "2026-09-30", 322.0)]                             # not a calendar month
    http = RecHttp()
    fa = FakeAdapter([_adapter_with_validators(HIST[-2:] + bad)], name="bls")
    out = ingest.run_fetch(s, E, "latest", CPI_OCT + 5, http, fa, entries=E, publish=False)
    assert out.series["USCPI"].status == "rejected"
    assert n_rows(s) == before and http.committed == []
    ev = s.validation_events("USCPI")
    assert ev and ev[0]["severity"] == "reject" and ev[0]["reasons"][0].startswith("schema:")
    assert s.get_state("USCPI")["state"] == "VALIDATION_FAILED"
    assert s.latest_point("USCPI").period_start == "2026-08-01"                     # last good retained
    fa.push(_adapter_with_validators(HIST[-2:] + [SEP]))
    ingest.run_fetch(s, E, "latest", CPI_OCT + 60, http, fa, entries=E, publish=False)
    assert http.committed == ["fake:cond"]                                           # committed only after validation
    assert s.get_state("USCPI")["state"] == "CURRENT"


def test_malformed_payload_is_a_validation_failure(tmp_path, keyed):
    E = ents("USCPI")
    s = seeded(tmp_path, E)
    fa = FakeAdapter([{"raise": "malformed", "message": "bls: body was HTML"}], name="bls")
    out = ingest.run_fetch(s, E, "latest", CPI_OCT + 5, None, fa, entries=E, publish=False)
    assert not out.ok and out.error_kind == "validation"
    assert s.get_state("USCPI")["state"] == "VALIDATION_FAILED"


def test_unrequested_series_in_payload_rejected(tmp_path, keyed):
    E = ents("USCPI")
    s = seeded(tmp_path, E)
    fa = FakeAdapter([{"observations": [SEP, ("USNFP", "2026-09-01", "2026-09-30", 1.0)]}], name="bls")
    out = ingest.run_fetch(s, E, "latest", CPI_OCT + 5, None, fa, entries=E, publish=False)
    assert out.series["USCPI"].status == "rejected"
    assert any(r.startswith("identity:") for r in out.series["USCPI"].reasons)


def test_empty_result_is_a_failure_not_a_success(tmp_path, keyed):
    E = ents("USCPI")
    s = seeded(tmp_path, E)
    fa = FakeAdapter([[]], name="bls")
    out = ingest.run_fetch(s, E, "latest", CPI_OCT + 5, None, fa, entries=E, publish=False)
    assert out.series["USCPI"].status == "empty"
    assert cur.series_ops(s, "USCPI")["last_failure_kind"] == "empty"


def test_source_error_is_redacted_everywhere(tmp_path, keyed):
    E = ents("USCPI")
    s = seeded(tmp_path, E)
    from api.services.econ.model import SourceUnavailable
    fa = FakeAdapter([SourceUnavailable(f"POST https://api.bls.gov/x?registrationkey={KEY} -> 503")], name="bls")
    out = ingest.run_fetch(s, E, "latest", CPI_OCT + 5, None, fa, entries=E, publish=False)
    assert KEY not in out.error
    dump = "\n".join(str(r) for r in s.conn.execute("SELECT * FROM acquisition")) + \
        "\n".join(str(r) for r in s.conn.execute("SELECT * FROM series_ops")) + \
        "\n".join(str(r) for r in s.conn.execute("SELECT * FROM provider_ops"))
    assert KEY not in dump and "[REDACTED]" in dump


# ─────────────────────────────── derive + publish ────────────────────────────

def test_revision_new_vintage_and_derived_recompute(tmp_path, keyed):
    E = ents("USCPI", "USCPIMOM")
    s = seeded(tmp_path, E)
    assert n_rows(s, "USCPIMOM") == 43
    mom_aug = s.versions("USCPIMOM", "2026-08-01")
    fa = FakeAdapter([{"observations": [HIST[-1][:3] + (321.9,), SEP]}], name="bls")
    out = ingest.run_fetch(s, E, "latest", CPI_OCT + 5, None, fa, entries=E, publish=False)
    assert out.series["USCPI"].inserted == 1 and out.series["USCPI"].revised == 1
    aug = s.versions("USCPI", "2026-08-01")
    assert [v.value for v in aug] == [321.5, 321.9]                                  # original kept
    assert aug[1].release_id == s.versions("USCPI", "2026-09-01")[0].release_id      # published with Sep
    assert out.derived["USCPIMOM"] >= 2
    mom = s.versions("USCPIMOM", "2026-08-01")
    assert len(mom) == len(mom_aug) + 1 and mom[-1].available_at == CPI_OCT
    assert s.versions("USCPIMOM", "2026-09-01")[0].available_at == CPI_OCT


def test_publish_hook_and_pending_recovery(tmp_path, keyed):
    E = ents("USCPI", "USCPIMOM")
    s = seeded(tmp_path, E)
    calls = []

    def boom(store, sym, now=None):
        raise RuntimeError("R2 down")

    fa = FakeAdapter([{"observations": [SEP]}], name="bls")
    ingest.run_fetch(s, E, "latest", CPI_OCT + 5, None, fa, entries=E, publisher=boom)
    pend = {r[0] for r in s.conn.execute("SELECT series_id FROM series_ops WHERE publish_pending_at IS NOT NULL")}
    assert {"USCPI", "USCPIMOM"} <= pend
    done = ingest.republish_pending(s, CPI_OCT + 60, lambda st_, sym, now=None: calls.append(sym))
    assert set(done) >= {"USCPI", "USCPIMOM"} and set(calls) == set(done)
    calls.clear()
    assert ingest.republish_pending(s, CPI_OCT + 120, lambda st_, sym, now=None: calls.append(sym)) == []


def test_default_publisher_is_guarded():
    pub = ingest.default_publisher()
    try:
        import api.services.econ.publish  # noqa: F401
        assert callable(pub)
    except ImportError:
        assert pub is None


# ─────────────────────────────── archive / http proxy ────────────────────────

def test_local_archive_sha_named_and_secret_refused(tmp_path, keyed, monkeypatch):
    monkeypatch.setenv("ECON_ARCHIVE", "local")
    monkeypatch.setenv("ECON_ARCHIVE_DIR", str(tmp_path / "arch"))
    ref = ingest.archive_payload("bls", b'{"ok": 1}', "ab" * 32)
    assert ref == f"local:bls/{'ab' * 32}.bin" and (tmp_path / "arch" / "bls" / f"{'ab' * 32}.bin").exists()
    assert ingest.archive_payload("bls", f'{{"registrationkey": "{KEY}"}}'.encode(), "cd" * 32) is None
    assert not (tmp_path / "arch" / "bls" / f"{'cd' * 32}.bin").exists()
    monkeypatch.setenv("ECON_ARCHIVE", "off")
    assert ingest.archive_payload("bls", b"x", "ef" * 32) is None


def test_archive_ref_recorded_on_acquisition(tmp_path, keyed, monkeypatch):
    E = ents("USCPI")
    s = seeded(tmp_path, E)
    monkeypatch.setenv("ECON_ARCHIVE", "local")
    monkeypatch.setenv("ECON_ARCHIVE_DIR", str(tmp_path / "arch"))
    fa = FakeAdapter([{"observations": [SEP], "payload": b"raw-bytes"}], name="bls")
    ingest.run_fetch(s, E, "latest", CPI_OCT + 5, None, fa, entries=E, publish=False)
    refs = [r[0] for r in s.conn.execute("SELECT archive_ref FROM acquisition WHERE archive_ref IS NOT NULL")]
    assert len(refs) == 1 and refs[0].startswith("local:bls/")


def test_deferring_http_holds_and_commits():
    h = RecHttp()
    d = ingest.DeferringHttp(h)
    r = d.get("https://example.invalid", conditional_key="k1")
    d.commit_validators("k1", r)
    assert h.committed == [] and len(d.pending) == 1
    d.commit()
    assert h.committed == ["k1"]
    d.get("https://example.invalid", conditional_key="k2")
    d.drop()
    d.commit()
    assert h.committed == ["k1"]


def test_store_validators_roundtrip(tmp_path):
    s = open_store(tmp_path)
    v = ingest.StoreValidators(s)
    assert v.get("k") is None
    v.put("k", '"e"', "Tue, 29 Sep 2026 12:00:00 GMT")
    assert v.get("k") == ('"e"', "Tue, 29 Sep 2026 12:00:00 GMT")


# ─────────────────────── fed_ddp: validation failure never leaves a 304 trap ──

def test_fed_validation_failed_payload_stores_no_validator_and_next_poll_is_full(tmp_path, monkeypatch):
    """fed_ddp commits its own validators after its identity checks. The payload
    below PASSES those checks but FAILS the pipeline's validation (a held period's
    value changed on a revision.type=none series). The release system's
    DeferringHttp must drop the adapter's commit, so the next poll is a full GET
    (no If-None-Match) -- a stored ETag would make every later poll a 304 and
    the series could never recover."""
    from api.services.econ.adapters import fed_ddp
    from api.services.econ.http import HttpClient
    from tests.econ.test_adapter_fed_ddp import Router, zresp
    monkeypatch.delenv("ECON_ARCHIVE", raising=False)
    E = ents("UST10Y")
    s = open_store(tmp_path)
    now = T("2026-09-28", "16:30")
    # seed: the fixture's latest periods, one of them with a DIFFERENT held value
    hist = fed_ddp.FedDdpAdapter().fetch(
        [ingest.SeriesSpec(E[0])], mode="history", start=None, end=None,
        http=HttpClient(transport=Router({"/releases/h15/": zresp("h15")}), sleep=lambda x: None,
                        host_intervals={}, default_interval=0, max_retries=0))[0].observations
    rel = s.upsert_release("backfill:UST10Y:seed", "fed:h15", "backfill", None)
    rows = [(o.period_start, o.period_end, (9.99 if o.period_start == "2026-09-23" else o.value), "",
             now - 86400, "rule", "U", None, None) for o in hist]
    s.write_observations("UST10Y", rel, rows)

    seen = []

    def serve(req):
        seen.append(req.headers.get("If-None-Match"))
        if req.headers.get("If-None-Match") == '"h151"':
            return __import__("tests.econ.test_adapter_fed_ddp", fromlist=["Resp"]).Resp(304, b"")
        return zresp("h15")
    http = HttpClient(transport=Router({"/releases/h15/": serve}), sleep=lambda x: None, host_intervals={},
                      default_interval=0, max_retries=0, validator_store=ingest.StoreValidators(s))
    fa = fed_ddp.FedDdpAdapter()
    out = ingest.run_fetch(s, E, "latest", now, http, fa, entries=E, publish=False)
    assert out.series["UST10Y"].status == "rejected", out.series["UST10Y"].reasons
    assert out.validators_committed == 0
    assert s.conn.execute("SELECT COUNT(*) FROM http_validator").fetchone()[0] == 0
    assert s.get_state("UST10Y")["state"] == "VALIDATION_FAILED"
    # the next poll is a FULL request, not a conditional one -> never 304-stuck
    out2 = ingest.run_fetch(s, E, "latest", now + 300, http, fa, entries=E, publish=False)
    assert seen == [None, None]
    assert out2.series["UST10Y"].status == "rejected"          # still refused (the store disagrees), not "not_modified"
    assert s.latest_point("UST10Y").value is not None                  # last good data kept


def test_empty_series_in_a_conditional_payload_holds_validators(tmp_path, keyed):
    """A 200 that validated but did not carry a requested series is not a success
    for that series, so its ETag must not turn the next poll into a 304."""
    E = ents("USCPI", "USCPINSA")
    s = seeded(tmp_path, E, hist=HIST + [(("USCPINSA",) + h[1:]) for h in HIST])
    http = RecHttp()
    fa = FakeAdapter([_adapter_with_validators(HIST[-2:] + [SEP])], name="bls")   # USCPINSA missing
    out = ingest.run_fetch(s, E, "latest", CPI_OCT + 5, http, fa, entries=E, publish=False)
    assert out.series["USCPINSA"].status == "empty"
    assert http.committed == [] and out.validators_committed == 0


def test_negative_control_without_deferral_fed_would_store_validator(tmp_path):
    """Proves the fed regression test above can fail: the adapter DOES commit its
    own validators when handed a plain HttpClient."""
    from api.services.econ.adapters import fed_ddp
    from api.services.econ.http import HttpClient
    from tests.econ.test_adapter_fed_ddp import Router, zresp
    s = open_store(tmp_path)
    h = HttpClient(transport=Router({"/releases/h15/": zresp("h15")}), sleep=lambda x: None, host_intervals={},
                   default_interval=0, max_retries=0, validator_store=ingest.StoreValidators(s))
    fed_ddp.FedDdpAdapter().fetch([ingest.SeriesSpec(ents("UST10Y")[0])], mode="latest", start=None, end=None,
                                  http=h)
    assert s.conn.execute("SELECT COUNT(*) FROM http_validator").fetchone()[0] == 1


def test_backfill_refuses_non_production_entries(tmp_path, keyed):
    """USRETAIL is `unverified`: even named explicitly it must never be written."""
    s = open_store(tmp_path)
    E = ents("USRETAIL")
    assert E[0]["status"] == "unverified"
    assert ingest.backfill_refusal(E[0]).startswith("status unverified")
    called = []
    fa = FakeAdapter([{"observations": [("USRETAIL", "2026-07-01", "2026-07-31", 1.0)]}], name="census")
    outs = ingest.backfill(s, E, http=None, now=NOW0, adapter_for=lambda n: called.append(n) or fa, entries=E,
                           publish=False)
    assert outs == [] and called == [] and n_rows(s) == 0
    disabled = ents("USCPI", **{"USCPI": {"status": "disabled"}})
    assert ingest.backfill_refusal(disabled[0])
    red = ents("USCPI", **{"USCPI": {"licensing.class": "RED"}})
    assert "RED" in ingest.backfill_refusal(red[0])
    assert ingest.backfill_refusal(ents("USCPI")[0]) is None


def test_backfill_charges_bls_quota_and_reports_cost(tmp_path, keyed):
    from api.services.econ import scheduler as sch

    class CountingHttp:
        def __init__(self):
            self.n = 0

        def stats(self):
            return {"by_host": {"api.bls.gov": {"200": self.n}}, "total": self.n}

    h = CountingHttp()

    def step(specs, mode, start, end, http):
        h.n += 3
        return [FetchResult("bls", "fake", [RawObs(*o) for o in HIST], http_status=200)]
    s = open_store(tmp_path)
    E = ents("USCPI")
    outs = ingest.backfill(s, E, http=h, now=NOW0, adapter_for=lambda n: FakeAdapter([step], name="bls"),
                           entries=E, publish=False)
    assert outs[0].requests == 3 and outs[0].elapsed_s is not None
    assert sch.quota_used(s, "bls", NOW0) == 3


def test_backfill_takes_the_ingest_lease_and_respects_provider_backoff(tmp_path, keyed):
    s = open_store(tmp_path)
    E = ents("USCPI")
    fa = FakeAdapter([{"observations": HIST}], name="bls")
    clock = Clock(NOW0)
    # the running service holds ingest:bls -> the backfill waits, then gives up without sending
    assert s.acquire_lease("ingest:bls", "svc", 600, now=int(clock()))
    outs = ingest.backfill(s, E, http=None, now=NOW0, adapter_for=lambda n: fa, entries=E, publish=False,
                           lease_wait_s=10, sleep=clock.sleep, clock=clock)
    assert outs[0].ok is False and outs[0].error_kind == "lease" and fa.calls == [] and n_rows(s) == 0
    s.release_lease("ingest:bls", "svc")
    # a provider backing off (quota refusal) is not asked
    cur.update_provider_ops(s, "bls", NOW0, backoff_until=int(clock()) + 3600)
    outs = ingest.backfill(s, E, http=None, now=NOW0, adapter_for=lambda n: fa, entries=E, publish=False,
                           clock=clock)
    assert outs[0].error_kind == "backoff" and fa.calls == []
    cur.update_provider_ops(s, "bls", NOW0, backoff_until=None)
    outs = ingest.backfill(s, E, http=None, now=NOW0, adapter_for=lambda n: fa, entries=E, publish=False,
                           clock=clock)
    assert outs[0].ok and n_rows(s) == len(HIST)
    assert s.lease_holder("ingest:bls", now=int(clock())) is None              # released
