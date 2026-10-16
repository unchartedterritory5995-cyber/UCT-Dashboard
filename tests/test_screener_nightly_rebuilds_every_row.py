"""The screener nightly rebuilds EVERY row, records what it did, and says so when it falls short.

Measured on production 2026-10-15: 11,230 rows across three build dates (3,999 on the median).
`run_build` defaulted to a 4,000-row cap from when the universe was ~3,700 names, so each
nightly rebuilt the stalest third and RS rank / volume vs avg / ratings were up to three nights
old. These tests pin the three halves of the fix: the default covers every target, each run
leaves a receipt an HTTP reader can see, and a short run raises an alert instead of a log line.
"""
import importlib

import pytest


def _builder(tmp_path, monkeypatch, universe):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    monkeypatch.delenv("SCREENER_SNAPSHOT_MAX_PER_RUN", raising=False)
    import api.services.screener.snapshot_db as db
    importlib.reload(db)
    import api.services.screener.snapshot_builder as b
    importlib.reload(b)
    bars = [{"t": 20260100 + i, "o": 10.0, "h": 10.5, "l": 9.5, "c": 10.0, "v": 1000}
            for i in range(60)]
    monkeypatch.setattr(b, "_load_universe", lambda: list(universe))
    monkeypatch.setattr(b, "_read_daily_bars", lambda t: bars)
    monkeypatch.setattr(b, "_read_ratings", lambda t, failures=None: {})
    monkeypatch.setattr(b, "_read_fundamentals", lambda t, price=None, failures=None: {"company": "X"})
    monkeypatch.setattr(b, "_read_rs_map", lambda: {})
    monkeypatch.setattr(b, "_read_bulk_fundamentals", lambda targets, failures=None: {})
    from api.services.screener import context_joins as cj
    for name in ("read_breadth_flags", "read_uct20", "read_index_flags", "read_etf_flags"):
        monkeypatch.setattr(cj, name, lambda targets, failures=None: {})
    return b, db


def test_the_default_cap_is_every_target_and_the_env_is_an_emergency_limit(monkeypatch):
    from api.services.screener import snapshot_builder as b
    monkeypatch.delenv("SCREENER_SNAPSHOT_MAX_PER_RUN", raising=False)
    assert b._per_run_cap() is None
    monkeypatch.setenv("SCREENER_SNAPSHOT_MAX_PER_RUN", "4000")
    assert b._per_run_cap() == 4000
    assert b._per_run_cap(800) == 800          # a caller's own cap (admin refresh) still wins


def test_a_nightly_rebuilds_every_row_and_records_a_complete_receipt(tmp_path, monkeypatch):
    b, db = _builder(tmp_path, monkeypatch, ["AAA", "BBB", "CCC"])
    stats = b.run_build()
    assert stats["targets"] == 3 and stats["built"] == 3
    last = db.last_build_run()
    assert last["targets"] == 3 and last["built"] == 3 and last["complete"] is True
    assert last["finished_at"] >= last["started_at"]
    assert db.status()["last_build"]["built"] == 3


def test_control_the_env_cap_still_limits_a_run(tmp_path, monkeypatch):
    b, db = _builder(tmp_path, monkeypatch, ["AAA", "BBB", "CCC"])
    monkeypatch.setenv("SCREENER_SNAPSHOT_MAX_PER_RUN", "2")
    stats = b.run_build()
    assert stats["targets"] == 2 and stats["built"] == 2


def test_a_receipt_short_of_its_targets_reads_incomplete(tmp_path, monkeypatch):
    _, db = _builder(tmp_path, monkeypatch, ["AAA"])
    db.record_build_run({"started_at": 1.0, "finished_at": 2.0, "targets": 10, "built": 4,
                         "skipped": 1, "errors": 0, "empty_columns": []})
    assert db.last_build_run()["complete"] is False
    assert db.last_build_run()["targets"] == 10


def test_receipts_are_trimmed_to_the_newest_few(tmp_path, monkeypatch):
    _, db = _builder(tmp_path, monkeypatch, ["AAA"])
    for i in range(db.BUILD_RUNS_KEEP + 5):
        db.record_build_run({"targets": 1, "built": 1, "skipped": 0, "errors": 0, "started_at": i})
    with db.connect() as conn:
        n = conn.execute("SELECT COUNT(*) n FROM screener_build_runs").fetchone()["n"]
    assert n == db.BUILD_RUNS_KEEP


@pytest.mark.parametrize("stats,why", [
    ({"targets": 100, "built": 95, "skipped": 5, "errors": 0}, None),
    ({"targets": 100, "built": 40, "skipped": 0, "errors": 0}, "stopped after 40 of 100"),
    ({"targets": 100, "built": 90, "skipped": 0, "errors": 10}, "10 of 100 rows errored"),
    ({"skipped_reason": "a build is already in flight"}, "refused"),
    ({"crashed": "RuntimeError: boom"}, "crashed"),
    # 2026-10-16: a COMPLETE build on OLD prices -- 1,534 of 11,091 current.
    ({"targets": 100, "built": 100, "skipped": 0, "errors": 0,
      "settled_bars": {"session": "2026-10-15", "current_rows": 14}},
     "only 14 of 100 rows end on the last session"),
    ({"targets": 100, "built": 100, "skipped": 0, "errors": 0,
      "settled_bars": {"session": "2026-10-15", "current_rows": 96}}, None),
    ({"targets": 100, "built": 100, "skipped": 0, "errors": 0,
      "settled_bars": {"session": "2026-10-15", "error": "429"}}, "could not be fetched"),
    # No count (an older receipt): silent, never a guess.
    ({"targets": 100, "built": 100, "skipped": 0, "errors": 0,
      "settled_bars": {"session": "2026-10-15"}}, None),
])
def test_the_shortfall_is_named(stats, why):
    import api.main as main
    out = main._nightly_shortfall(stats)
    if why is None:
        assert out is None
    else:
        assert why in out


def _nightly_job(monkeypatch):
    import api.main as main
    monkeypatch.setenv("SCREENER_SNAPSHOT_ENABLED", "1")
    monkeypatch.setattr(main, "start_screener_snapshot_warm", lambda: None)
    jobs = {}

    class _FakeScheduler:
        def add_job(self, func, **kw):
            jobs[kw.get("id")] = func

    assert main.register_screener_jobs(_FakeScheduler()) is True
    return jobs["screener_snapshot_nightly"]


def _run_nightly(monkeypatch, stats):
    """Run the REAL registered nightly job (api.main._alert_if_nightly_short is what it calls
    after the build) against a stubbed build result, and return the alerts it raised."""
    import api.main as main
    from api.services import chart_health_alerts
    from api.services.screener import distribution, snapshot_builder
    assert callable(main._alert_if_nightly_short)
    seen = []
    monkeypatch.setattr(chart_health_alerts, "emit", lambda key, sev, msg, meta=None: seen.append((key, sev, msg)) or True)
    monkeypatch.setattr(snapshot_builder, "run_build", lambda *a, **k: stats)
    monkeypatch.setattr(distribution, "distributions", lambda: None)
    _nightly_job(monkeypatch)()
    return seen


def test_the_nightly_job_alerts_on_a_run_that_stops_short(monkeypatch):
    seen = _run_nightly(monkeypatch, {"targets": 50, "built": 10, "skipped": 0, "errors": 0, "populated": {}})
    assert len(seen) == 1
    key, sev, msg = seen[0]
    assert key.startswith("screener_nightly_short:") and sev == "warning"
    assert "10 of 50" in msg


def test_the_nightly_job_alerts_on_a_complete_build_on_old_prices(monkeypatch):
    seen = _run_nightly(monkeypatch, {
        "targets": 50, "built": 50, "skipped": 0, "errors": 0, "populated": {},
        "settled_bars": {"session": "2026-10-15", "current_rows": 7}})
    assert len(seen) == 1 and "only 7 of 50" in seen[0][2]


def test_CONTROL_a_nightly_that_reaches_every_row_alerts_nobody(monkeypatch):
    assert _run_nightly(monkeypatch, {"targets": 50, "built": 48, "skipped": 2, "errors": 0, "populated": {}}) == []


def test_a_crashing_nightly_still_alerts(monkeypatch):
    from api.services import chart_health_alerts
    from api.services.screener import snapshot_builder
    seen = []
    monkeypatch.setattr(chart_health_alerts, "emit", lambda key, sev, msg, meta=None: seen.append(msg) or True)

    def boom(*a, **k):
        raise RuntimeError("disk full")
    monkeypatch.setattr(snapshot_builder, "run_build", boom)
    _nightly_job(monkeypatch)()
    assert seen and "crashed" in seen[0] and "disk full" in seen[0]
