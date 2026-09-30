"""service.py + api/econ_main.py + railway.econ.json."""
from __future__ import annotations

import io
import json
import logging
import urllib.request
from pathlib import Path

import pytest

from api.services.econ import scheduler as sch
from api.services.econ import service as svcmod
from api.services.econ.adapters.fake import FakeAdapter
from api.services.econ.service import EconService, RefuseToStart
from tests.econ.test_ingest import (CPI_OCT, HIST, KEY, NOW0, SEP, Clock, T, _no_archive, ents, keyed,  # noqa: F401
                                    open_store, seeded)

ROOT = Path(__file__).resolve().parents[2]


def make(tmp_path, entries, fa, clock, **kw):
    s = kw.pop("store", None) or seeded(tmp_path, entries)
    svc = EconService(s, entries=entries, adapter_for=lambda n: fa, clock=clock, sleep=clock.sleep,
                      feeds=False, publish=kw.pop("publish", False), **kw)
    return s, svc


# ─────────────────────────────── boot ────────────────────────────────────────

def test_boot_refuses_an_invalid_registry(tmp_path):
    s = open_store(tmp_path)
    svc = EconService(s, entries=ents("USCPI"), feeds=False, publish=False,
                      registry_validator=lambda: ["USCPI: enabled but source.verified is false"])
    with pytest.raises(RefuseToStart, match="1 error"):
        svc.boot()
    bad = ents("USCPIMOM")                                          # derived without its input in the registry
    with pytest.raises(RefuseToStart):
        EconService(s, entries=bad, feeds=False, publish=False).boot()


def test_boot_on_the_committed_registry_touches_no_network(tmp_path):
    s = open_store(tmp_path)

    def no_net(req):
        raise AssertionError("network used during boot")

    from api.services.econ.http import HttpClient
    svc = EconService(s, http=HttpClient(transport=no_net), feeds=False, publish=False,
                      clock=Clock(NOW0), sleep=lambda x: None)
    svc.boot()
    st = svc.status()
    assert st["registry"]["total"] == 237 and st["registry"]["enabled"] == st["enabled_series"] >= 41
    assert st["states"].get("UNINITIALIZED", 0) >= 30               # nothing ingested yet
    assert svc.health()[0] == 200


# ─────────────────────────────── status / health ─────────────────────────────

def test_status_snapshot_contents_and_no_secrets(tmp_path, keyed, monkeypatch):
    monkeypatch.setenv("EIA_API_KEY", "EIAKEY-abcdefghijkl")
    E = ents("USCPI", "USCPIMOM")
    clock = Clock(CPI_OCT - 30)
    from api.services.econ.model import SourceUnavailable
    fa = FakeAdapter([SourceUnavailable(f"GET https://api.bls.gov/x?registrationkey={KEY} failed"),
                      {"observations": [SEP]}], name="bls")
    s, svc = make(tmp_path, E, fa, clock)
    svc.boot()
    svc.tick(CPI_OCT)                                               # fails (key in the error text)
    st = svc.status()
    blob = json.dumps(st)
    assert KEY not in blob and "EIAKEY-abcdefghijkl" not in blob
    assert st["keys_configured"] == {"bls": True, "bea": False, "census": False, "eia": True}
    assert st["providers"]["bls"]["consecutive_failures"] == 1 and "[REDACTED]" in st["providers"]["bls"]["last_error"]
    assert st["retry"][0]["symbol"] == "USCPI" and st["quota"]["bls"]["limit"] == 500
    for k in ("service", "registry", "enabled_series", "states", "next_releases", "last_success_by_provider",
              "delayed", "validation_failures", "providers", "retry", "quota", "keys_configured", "calendars"):
        assert k in st
    assert st["service"]["version"] == svcmod.SERVICE_VERSION
    nr = st["next_releases"][0]
    assert nr["calendar_key"] == "bls:cpi" and nr["symbols"] == ["USCPI", "USCPIMOM"]
    svc.tick(CPI_OCT + 40)                                           # backoff 30 s elapsed -> recovers
    st = svc.status()
    assert st["states"] == {"CURRENT": 2} and "bls" in st["last_success_by_provider"]
    assert [c for c in st["calendars"] if c["calendar_key"] == "bls:cpi"][0]["coverage_end"] == "2026-12-31"


def test_health_fresh_stale_and_before_boot(tmp_path, keyed):
    E = ents("USCPI")
    clock = Clock(NOW0)
    s, svc = make(tmp_path, E, FakeAdapter([], name="bls"), clock)
    assert svc.health()[0] == 503                                   # not booted
    svc.boot()
    assert svc.health()[0] == 200
    clock.set(NOW0 + svcmod.HEALTH_MAX_AGE_S + 1)
    code, doc = svc.health()
    assert code == 503 and doc["heartbeat_age_s"] > svcmod.HEALTH_MAX_AGE_S
    svc.tick()
    assert svc.health()[0] == 200
    svc.stop()
    assert svc.health()[0] == 503


def test_http_endpoints_serve_the_snapshot(tmp_path, keyed):
    E = ents("USCPI")
    clock = Clock(NOW0)
    s, svc = make(tmp_path, E, FakeAdapter([], name="bls"), clock)
    svc.boot()
    import time as _t
    clock.set(_t.time())                                           # the handler reads the real port, not the DB
    svc.heartbeat_at = int(_t.time())
    srv = svc.serve_http(0, host="127.0.0.1")
    port = srv.server_address[1]
    try:
        for path in ("/health", "/api/health"):
            with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=5) as r:
                assert r.status == 200 and json.loads(r.read())["ok"] is True
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/status", timeout=5) as r:
            doc = json.loads(r.read())
            assert doc["registry"]["total"] == 1 and r.headers["Cache-Control"] == "no-store"
        with pytest.raises(urllib.error.HTTPError):
            urllib.request.urlopen(f"http://127.0.0.1:{port}/nope", timeout=5)
    finally:
        svc.shutdown()


# ─────────────────────────────── loop + SIGTERM ──────────────────────────────

def test_run_forever_sleeps_until_the_next_due_poll(tmp_path, keyed):
    E = ents("USCPI")
    clock = Clock(CPI_OCT - 200)
    fa = FakeAdapter([{"observations": HIST[-1:]}, {"observations": [SEP]}], name="bls")
    s, svc = make(tmp_path, E, fa, clock, max_sleep=60)
    svc.run_forever(max_ticks=8)                                    # T-200, T-140, T-120 probe, T-60, T, ...
    assert [c[0] for c in fa.calls] == [("USCPI",), ("USCPI",)]     # probe at T-2m, then T
    assert s.get_state("USCPI")["state"] == "CURRENT"
    assert s.versions("USCPI", "2026-09-01")[0].available_at == CPI_OCT
    assert max(clock.slept) <= 5.0                                   # responsive to stop()


def test_stop_finishes_the_current_job_and_releases_leases(tmp_path, keyed):
    E = ents("USCPI")
    clock = Clock(CPI_OCT)
    holder = {}

    def step(specs, mode, start, end, http):
        holder["svc"].stop()                                        # SIGTERM arrives mid-job
        holder["lease"] = holder["s"].lease_holder("ingest:bls", now=CPI_OCT)
        return FakeAdapter([{"observations": [SEP]}], name="bls").fetch(specs, mode=mode)

    fa = FakeAdapter([step], name="bls")
    s, svc = make(tmp_path, E, fa, clock)
    holder.update(svc=svc, s=s)
    svc.run_forever()
    assert holder["lease"] == svc.owner                             # the job ran under the lease ...
    assert s.versions("USCPI", "2026-09-01")                         # ... and finished its write
    assert s.lease_holder("ingest:bls", now=CPI_OCT) is None         # ... and the lease was released
    assert svc.stopping


def test_shutdown_releases_every_lease_of_this_owner(tmp_path, keyed):
    E = ents("USCPI")
    s, svc = make(tmp_path, E, FakeAdapter([], name="bls"), Clock(NOW0))
    s.acquire_lease("ingest:x", svc.owner, 600, now=NOW0)
    s.acquire_lease("ingest:y", "otherhost:9:z", 600, now=NOW0)
    svc.shutdown()
    assert s.lease_holder("ingest:x", now=NOW0) is None and s.lease_holder("ingest:y", now=NOW0) == "otherhost:9:z"


def test_reclaim_stale_leases_same_host_only(tmp_path):
    s = open_store(tmp_path)
    s.acquire_lease("ingest:bls", "hostA:1:old", 600, now=100)
    s.acquire_lease("ingest:bea", "hostB:1:old", 600, now=100)
    assert sch.reclaim_stale_leases(s, "hostA:1:new") == ["ingest:bls"]
    assert s.lease_holder("ingest:bea", now=100) == "hostB:1:old"


# ─────────────────────────────── logging / entrypoint / railway ──────────────

def test_json_log_formatter_redacts(keyed):
    buf = io.StringIO()
    h = svcmod.configure_logging(stream=buf)
    try:
        logging.getLogger("api.services.econ.test").warning("url https://x/?registrationkey=%s", KEY)
        line = json.loads(buf.getvalue().strip().splitlines()[-1])
        assert KEY not in buf.getvalue() and line["level"] == "WARNING" and "[REDACTED]" in line["msg"]
    finally:
        for name in ("api.services.econ", "api.econ_main"):
            logging.getLogger(name).removeHandler(h)
            logging.getLogger(name).propagate = True


def test_econ_main_status_prints_json(tmp_path, capsys):
    from api import econ_main
    db = str(tmp_path / "e.db")
    open_store(tmp_path, "e.db").close()
    try:
        assert econ_main.main(["--status", "--db", db]) == 0
    finally:
        for name in ("api.services.econ", "api.econ_main"):
            lg = logging.getLogger(name)
            for h in list(lg.handlers):
                lg.removeHandler(h)
            lg.propagate = True
    doc = json.loads(capsys.readouterr().out)
    assert doc["registry"]["total"] == 237 and "keys_configured" in doc


def test_econ_service_has_its_own_railway_config_and_the_shared_one_is_untouched():
    """The econ service boots from railway.econ.json, never from a branch of the
    shared railway.json: flow-worker's watch list names railway.json, so editing
    it restarts flow-worker (docs/economic-data/DEPLOYMENT.md)."""
    shared = json.loads((ROOT / "railway.json").read_text())
    assert "econ" not in shared["deploy"]["startCommand"].lower()
    econ = json.loads((ROOT / "railway.econ.json").read_text())
    assert econ["deploy"]["startCommand"] == "python -m api.econ_main"
    assert econ["deploy"]["healthcheckPath"] == "/api/health"
    assert econ["deploy"]["restartPolicyType"] == "ALWAYS"
    assert econ["build"] == shared["build"]
    for cfg in ROOT.glob("railway*.json"):
        if cfg.name != "railway.econ.json":
            assert "econ_main" not in cfg.read_text(), cfg.name


def test_jobs_and_currentness_transitions_are_logged_without_values(tmp_path, keyed, caplog):
    E = ents("USCPI")
    clock = Clock(CPI_OCT - 600)
    fa = FakeAdapter([{"observations": HIST[-2:] + [SEP]}], name="bls")
    s, svc = make(tmp_path, E, fa, clock)
    svc.boot()
    caplog.set_level(logging.INFO, logger="api.services.econ")
    clock.set(CPI_OCT + 5)
    svc.tick()
    msgs = [r.getMessage() for r in caplog.records]
    assert any(m.startswith("econ.service: job bls live USCPI -> ran written=1") for m in msgs), msgs
    assert any(m.startswith("econ.currentness: USCPI ") and m.split(" (")[0].endswith("-> CURRENT")
               for m in msgs), msgs
    assert not any("322" in m for m in msgs)                      # never a value in the log
