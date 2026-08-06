"""Cold-start warm-on-boot wiring (2026-07-01 launch pass)."""
import time


def test_dashboard_warm_targets_importable():
    # The warmer references these exact import paths; a wrong path would only
    # surface at runtime in a background thread. Pin them here.
    from api.services.massive import get_movers
    from api.routers.theme_performance import get_theme_performance
    from api.services.engine import get_news
    from api.routers.breadth_monitor import get_breadth_history
    from api.routers.calendar import get_calendar, get_enrichment_batch, _week_dates
    assert all(callable(f) for f in (
        get_movers, get_theme_performance, get_news, get_breadth_history, get_calendar,
        get_enrichment_batch, _week_dates,
    ))


def test_start_dashboard_warm_spawns_without_error():
    from api.main import _start_dashboard_warm_background
    # Huge delay → the daemon thread spawns and sleeps; it never runs the real
    # warm work during the test, so this just proves the scheduler wiring is sound.
    _start_dashboard_warm_background(delay_seconds=9999)


# P2 Task 12 (calendar-redesign): `_calendar()` above warmed the base week
# payload, but not its enrichment OVERLAY (beat_history/hist_stats — what the
# earnings modal's Earnings History section needs). Since `_backfill_past_days`
# can put 100-200+ symbols on a single past day, a cold compute of the current
# week's enrichment measured 60-100+ SECONDS live (calendar.py::
# _build_enrichment_for_date) — long enough that the first calendar open after
# every deploy/restart paid that cost synchronously inside the modal's own
# fetch, with nothing to show for it in the meantime. This proves the warm
# sequence now fires that compute for exactly the current week's 5 dates,
# same as every other target it sits beside.
def test_dashboard_warm_fires_enrichment_batch_for_the_current_week(monkeypatch):
    calls = []

    def _spy(dates=None):
        calls.append(dates)
        return {}

    # Stub every OTHER warm target so this test proves the enrichment wiring
    # specifically, without also firing seven unrelated live network/compute
    # paths (each already covered by the importability pin above).
    monkeypatch.setattr("api.services.massive.get_movers", lambda: None)
    monkeypatch.setattr(
        "api.routers.theme_performance.get_theme_performance", lambda: None)
    monkeypatch.setattr("api.services.engine.get_news", lambda: None)
    monkeypatch.setattr(
        "api.routers.breadth_monitor.get_breadth_history", lambda days=90: None)
    monkeypatch.setattr("api.routers.calendar.get_calendar", lambda week=None: None)
    monkeypatch.setattr("api.routers.calendar.get_enrichment_batch", _spy)
    monkeypatch.setattr(
        "api.services.earnings_preview_warm.warm_week_previews", lambda: None)
    monkeypatch.setattr(
        "api.services.earnings_preview_warm.warm_reported_analyses", lambda: None)
    monkeypatch.setattr("api.live_massive_router.warm_recent", lambda **kw: None)
    monkeypatch.setattr("api.live_massive_router.day_stats", lambda **kw: None)

    from api.routers.calendar import _week_dates
    from api.main import _start_dashboard_warm_background

    _start_dashboard_warm_background(delay_seconds=0)

    for _ in range(200):   # up to ~10s — every stubbed step is instant
        if calls:
            break
        time.sleep(0.05)

    assert calls, "get_enrichment_batch was never called by the warm sequence"
    expected = ",".join(d.isoformat() for d in _week_dates())
    assert calls[0] == expected
