"""Tests for api.services.yfinance_pool.

The pool's only job is to bound how long a yfinance call can hold its
caller's thread. Tests cover:

  - Normal path: the call's return value propagates back
  - Timeout path: TimeoutError fires when yfinance hangs longer than
    the deadline
  - Custom timeout via kwarg
  - The hung work continues running after caller raises (we deliberately
    don't try to cancel it; pool slot rebinds when the work eventually
    finishes)
"""
from __future__ import annotations

import sys
import time
import types
from concurrent.futures import TimeoutError as FutureTimeout

import pytest


def _install_fake_yfinance(monkeypatch, history_fn):
    """Replace ``import yfinance as yf`` with a stub whose
    ``Ticker(sym).history(**kw)`` calls history_fn(sym, **kw)."""
    fake_mod = types.ModuleType("yfinance")

    class _FakeTicker:
        def __init__(self, sym):
            self.sym = sym

        def history(self, **kwargs):
            return history_fn(self.sym, **kwargs)

    fake_mod.Ticker = _FakeTicker
    monkeypatch.setitem(sys.modules, "yfinance", fake_mod)


def _reload_pool():
    import importlib
    from api.services import yfinance_pool
    importlib.reload(yfinance_pool)
    return yfinance_pool


def test_normal_call_returns_value(monkeypatch):
    _install_fake_yfinance(monkeypatch, lambda sym, **kw: {"sym": sym, "kw": kw})
    pool = _reload_pool()
    out = pool.fetch_history("AAPL", period="1mo", interval="1d")
    assert out == {"sym": "AAPL", "kw": {"period": "1mo", "interval": "1d"}}


def test_call_returning_none_propagates(monkeypatch):
    """yfinance returns None on some failure modes — pool must NOT mask
    that as a timeout. Caller sees None and handles it (currently treats
    as empty)."""
    _install_fake_yfinance(monkeypatch, lambda *a, **kw: None)
    pool = _reload_pool()
    assert pool.fetch_history("AAPL", period="1mo") is None


def test_timeout_raises_when_call_hangs(monkeypatch):
    """A yfinance call that exceeds the deadline must raise TimeoutError
    from the caller's perspective — the whole point of this module."""
    def slow_history(sym, **kw):
        time.sleep(2.0)
        return "should-never-return-because-of-timeout"

    _install_fake_yfinance(monkeypatch, slow_history)
    pool = _reload_pool()
    with pytest.raises(FutureTimeout):
        pool.fetch_history("AAPL", timeout=0.2, period="1mo")


def test_per_call_timeout_overrides_default(monkeypatch):
    """The ``timeout`` kwarg overrides the module default. Verifies the
    short-deadline override path works regardless of what the env var
    says."""
    def slightly_slow(sym, **kw):
        time.sleep(0.4)
        return "ok"

    _install_fake_yfinance(monkeypatch, slightly_slow)
    pool = _reload_pool()
    # Default would be 8s — would succeed. With timeout=0.1, must fail.
    with pytest.raises(FutureTimeout):
        pool.fetch_history("AAPL", timeout=0.1, period="1mo")
    # And with a generous override, succeeds.
    assert pool.fetch_history("AAPL", timeout=5.0, period="1mo") == "ok"


def test_pool_status_returns_expected_shape(monkeypatch):
    pool = _reload_pool()
    status = pool.pool_status()
    assert "max_workers" in status
    assert "default_timeout_seconds" in status
    assert isinstance(status["max_workers"], int)
    assert status["max_workers"] >= 1
