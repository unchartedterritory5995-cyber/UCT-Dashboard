"""Cold-start warm-on-boot wiring (2026-07-01 launch pass)."""


def test_dashboard_warm_targets_importable():
    # The warmer references these exact import paths; a wrong path would only
    # surface at runtime in a background thread. Pin them here.
    from api.services.massive import get_movers
    from api.routers.theme_performance import get_theme_performance
    from api.services.engine import get_news
    from api.routers.breadth_monitor import get_breadth_history
    from api.routers.calendar import get_calendar
    assert all(callable(f) for f in (
        get_movers, get_theme_performance, get_news, get_breadth_history, get_calendar,
    ))


def test_start_dashboard_warm_spawns_without_error():
    from api.main import _start_dashboard_warm_background
    # Huge delay → the daemon thread spawns and sleeps; it never runs the real
    # warm work during the test, so this just proves the scheduler wiring is sound.
    _start_dashboard_warm_background(delay_seconds=9999)
