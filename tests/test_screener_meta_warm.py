"""L9 (terminal live audit, 2026-10-05): `/api/screener/meta` measured 8.3 s on first
open. Its cost is `distribution.distributions()`, cached per snapshot vintage, so it
is computed by the boot warm and again right after the nightly build -- never by the
first member to open the screener. A refused build changes no vintage and must not
pay for a recompute."""
import time

import pytest


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


@pytest.mark.parametrize("stats,expect_warm", [
    ({"built": 12, "skipped": 3, "errors": 0}, True),
    ({"skipped_reason": "a build is already in flight", "built": 0, "skipped": 0, "errors": 0}, False),
])
def test_the_nightly_computes_the_bands_only_after_a_real_build(monkeypatch, stats, expect_warm):
    from api.services.screener import distribution, snapshot_builder

    calls = []
    monkeypatch.setattr(snapshot_builder, "run_build", lambda *a, **k: stats)
    monkeypatch.setattr(distribution, "distributions", lambda: calls.append(1) or {})
    _nightly_job(monkeypatch)()
    assert bool(calls) is expect_warm


def test_the_boot_warm_computes_the_screener_bands(monkeypatch):
    from api.services.screener import distribution

    calls = []
    monkeypatch.setattr(distribution, "distributions", lambda: calls.append(1) or {})
    for target in ("api.services.massive.get_movers", "api.services.engine.get_news",
                   "api.routers.theme_performance.get_theme_performance",
                   "api.services.earnings_preview_warm.warm_week_previews",
                   "api.services.earnings_preview_warm.warm_reported_analyses"):
        monkeypatch.setattr(target, lambda *a, **k: None)
    monkeypatch.setattr("api.routers.breadth_monitor.get_breadth_history", lambda days=90: None)
    monkeypatch.setattr("api.services.breadth_live.warm", lambda: None)
    monkeypatch.setattr("api.routers.calendar.get_calendar", lambda week=None: None)
    monkeypatch.setattr("api.routers.calendar.get_enrichment_batch", lambda dates=None: {})
    monkeypatch.setattr("api.live_massive_router.warm_recent", lambda **kw: None)
    monkeypatch.setattr("api.live_massive_router.day_stats", lambda **kw: None)

    from api.main import _start_dashboard_warm_background
    _start_dashboard_warm_background(delay_seconds=0)
    for _ in range(200):
        if calls:
            break
        time.sleep(0.05)
    assert calls, "the boot warm never computed the screener bands"
