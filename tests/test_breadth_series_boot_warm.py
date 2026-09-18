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
