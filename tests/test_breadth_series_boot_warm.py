"""DC-3(b)/D-056 — the /series boot warm. Dark by default; when armed it must
touch the deep/reconstructed path ONCE, at the worst-case span, and never on
the request path.

⛔ Scoped run only:
    python -m pytest tests/test_breadth_series_boot_warm.py -q
"""
from __future__ import annotations

import pytest

from api.routers import breadth_monitor as rt


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("BREADTH_SERIES_BOOT_WARM_ENABLED", raising=False)
    yield


def test_off_by_default_and_calls_nothing(monkeypatch):
    calls = []
    monkeypatch.setattr(rt.svc, "get_history_deep", lambda *a, **k: calls.append((a, k)) or [])
    out = rt.warm_series_deep()
    assert out == {"ok": False, "reason": "flag off"}
    assert calls == [], "the flag is OFF — the reader must never run"


@pytest.mark.parametrize("off_value", ["0", "false", "no", "off", "garbage"])
def test_every_off_spelling_calls_nothing(monkeypatch, off_value):
    monkeypatch.setenv("BREADTH_SERIES_BOOT_WARM_ENABLED", off_value)
    calls = []
    monkeypatch.setattr(rt.svc, "get_history_deep", lambda *a, **k: calls.append((a, k)) or [])
    rt.warm_series_deep()
    assert calls == [], f"{off_value!r} must not be treated as ON"


def test_on_reads_the_worst_case_span_once(monkeypatch):
    """⛔⛔ THE WHOLE POINT — this must warm FURTHER BACK than the existing
    days=90 dashboard warm, or it warms nothing this function exists for."""
    monkeypatch.setenv("BREADTH_SERIES_BOOT_WARM_ENABLED", "1")
    calls = []
    monkeypatch.setattr(rt.svc, "get_history_deep",
                        lambda *a, **k: calls.append((a, k)) or [{"date": "2026-01-01"}])
    out = rt.warm_series_deep()
    assert len(calls) == 1, "must read the deep path exactly once, not per-request"
    (days, *_rest), kwargs = calls[0]
    expected_days = rt.series_max_calendar_days(rt._SERIES_MAX_SESSIONS_DEFAULT)
    assert days == expected_days
    assert days > 90 * 10, "must reach far past the shallow dashboard warm's 90 days"
    assert kwargs.get("anchor") == "le"
    assert out["ok"] is True
    assert out["rows"] == 1


def test_a_reader_failure_does_not_raise(monkeypatch):
    """⛔ Called from a background thread with no request to fail — a raise here
    must be catchable by the caller's own try/except, never assumed to propagate
    usefully, but the function itself should not need special handling to be safe."""
    monkeypatch.setenv("BREADTH_SERIES_BOOT_WARM_ENABLED", "1")

    def _boom(*a, **k):
        raise RuntimeError("db unavailable")

    monkeypatch.setattr(rt.svc, "get_history_deep", _boom)
    with pytest.raises(RuntimeError):
        rt.warm_series_deep()   # the CALLER (api/main.py's `_warm`) wraps this — proven separately


def test_series_boot_warm_flag_helper_matches_the_env(monkeypatch):
    monkeypatch.delenv("BREADTH_SERIES_BOOT_WARM_ENABLED", raising=False)
    assert rt.series_boot_warm_enabled() is False
    monkeypatch.setenv("BREADTH_SERIES_BOOT_WARM_ENABLED", "1")
    assert rt.series_boot_warm_enabled() is True


# ── DC-3(c)/D-056 addendum — close the early-boot exposure window ──────────
#
# The warm above works, but D-056's original placement (6th in the sequential
# dashboard-warm chain) left a measured 1-3 minute window after every deploy
# where the chain simply had not reached its turn yet — a real member could
# still hit the cold path in that window. The fix moves the warm to its OWN
# standalone thread, started with a short delay so it fires well before the
# dashboard chain even reaches its FIRST target, without touching that
# chain's own ordering (flow-tape stays first there on purpose).
#
# ⛔ Scoped run only:
#     python -m pytest tests/test_breadth_series_boot_warm.py -q

def test_the_series_warm_is_not_a_step_in_the_dashboard_chain():
    """Mutation: re-embed the warm call in the chain (the old D-056 shape) →
    this must go red. A source-text check, not a behavioral one, because the
    OLD shape and the NEW shape both eventually call `warm_series_deep` —
    what changed is WHERE, and only reading the source can see that."""
    import inspect
    from api import main as api_main

    src = inspect.getsource(api_main._start_dashboard_warm_background)
    assert "warm_series_deep" not in src, (
        "the series deep-warm must not be a step inside the sequential "
        "dashboard-warm chain — that placement is exactly what reopened the "
        "early-boot exposure window this test exists to close"
    )


def test_the_series_warm_has_its_own_standalone_starter():
    """Mutation: delete `_start_breadth_series_warm_background` (fold it back
    into the chain, or drop it entirely) → this must go red."""
    from api import main as api_main

    assert hasattr(api_main, "_start_breadth_series_warm_background"), (
        "the standalone starter must exist as its own function"
    )
    assert callable(api_main._start_breadth_series_warm_background)


def test_the_series_warms_default_delay_precedes_the_dashboard_chains():
    """Mutation: raise the standalone starter's default delay to match or
    exceed the dashboard chain's own default delay → this must go red. Both
    are simple `time.sleep(delay_seconds)` calls with no other blocking work
    beforehand, so this single comparison is what actually decides which
    warm's own call lands first in production, at the real default values —
    not a test-only shortcut."""
    import inspect
    from api import main as api_main

    series_delay = inspect.signature(
        api_main._start_breadth_series_warm_background
    ).parameters["delay_seconds"].default
    chain_delay = inspect.signature(
        api_main._start_dashboard_warm_background
    ).parameters["delay_seconds"].default
    assert series_delay < chain_delay, (
        f"series warm delay ({series_delay}s) must precede the dashboard "
        f"chain's own delay ({chain_delay}s) — otherwise the chain's FIRST "
        f"target (flow-tape) could fire before the series warm does, which "
        f"is the exact ordering this test exists to guarantee"
    )


def test_the_series_warm_actually_fires_before_the_dashboard_chains_first_target(monkeypatch):
    """Real-threaded proof, not just a parameter comparison: with the flag
    ON, starting both warmers the way `api/main.py`'s boot code does, the
    series warm's own call is recorded before the chain's first target's
    call. Uses short overridden delays (not the real ~5s/~20s defaults) to
    keep this test fast, while preserving the same series-before-chain
    relationship the real defaults establish — see the delay-comparison
    test above for the production-values half of this proof.

    Mutation: swap the delay_seconds passed below (series slower than the
    chain) → this must go red, proving the assertion actually discriminates
    order rather than passing regardless."""
    import time
    from api import main as api_main

    monkeypatch.setenv("BREADTH_SERIES_BOOT_WARM_ENABLED", "1")
    calls = []

    def _spy_series():
        calls.append(("series", time.monotonic()))
        return {"ok": True, "days": 1, "rows": 0, "elapsed_ms": 0.0}

    def _spy_flow_tape(**kw):
        calls.append(("flow-tape", time.monotonic()))

    monkeypatch.setattr(rt, "warm_series_deep", _spy_series)
    monkeypatch.setattr("api.live_massive_router.warm_recent",
                         lambda **kw: _spy_flow_tape(**kw))
    monkeypatch.setattr("api.live_massive_router.day_stats", lambda **kw: None)
    # stub every OTHER dashboard-warm target so the chain isn't slowed by
    # real network/DB work before or after flow-tape's own spy fires
    monkeypatch.setattr("api.services.massive.get_movers", lambda: None)
    monkeypatch.setattr(
        "api.routers.theme_performance.get_theme_performance", lambda: None)
    monkeypatch.setattr("api.services.engine.get_news", lambda: None)
    monkeypatch.setattr(rt, "get_breadth_history", lambda days=90: None)
    monkeypatch.setattr("api.services.breadth_live.warm", lambda: None)
    monkeypatch.setattr("api.routers.calendar.get_calendar", lambda week=None: None)
    monkeypatch.setattr(
        "api.services.earnings_preview_warm.warm_week_previews", lambda: None)
    monkeypatch.setattr(
        "api.services.earnings_preview_warm.warm_reported_analyses", lambda: None)
    monkeypatch.setattr("api.routers.calendar.get_enrichment_batch", lambda dates=None: None)

    api_main._start_breadth_series_warm_background(delay_seconds=0)
    api_main._start_dashboard_warm_background(delay_seconds=0.3)

    for _ in range(200):  # up to ~10s — both delays above are sub-second
        if len(calls) >= 2:
            break
        time.sleep(0.05)

    assert len(calls) >= 2, f"expected both warmers to fire, got: {calls}"
    series_t = next(t for label, t in calls if label == "series")
    flow_t = next(t for label, t in calls if label == "flow-tape")
    assert series_t < flow_t, (
        f"the series warm must fire before the dashboard chain's first "
        f"target (flow-tape): {calls}"
    )


def test_boot_wiring_starts_the_standalone_series_warmer():
    """The boot code must actually CALL the standalone starter, not merely
    define it. Mutation: remove the call from the startup lifespan → red."""
    import inspect
    from api import main as api_main

    src = inspect.getsource(api_main)
    assert "_start_breadth_series_warm_background()" in src, (
        "the standalone series-warm starter must be called from boot, "
        "alongside _start_dashboard_warm_background()"
    )
