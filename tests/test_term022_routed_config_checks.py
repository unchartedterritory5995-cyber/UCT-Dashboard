"""TERM-022: call sites that only asked "is this vendor configured?" now ask the
vendor's ADAPTER, so no module outside it names the credential
(`tools/vendor_callsite_census.py`, railed by tests/test_vendor_callsite_census.py).

Each call-site test moves the ADAPTER's answer while holding the environment the
OTHER way, so a call site that still read the environment itself would fail.
No network.
"""
from __future__ import annotations

import pytest

from api.services import finnhub_client, fmp_client, massive_adapter


@pytest.mark.parametrize("adapter, env", [
    (finnhub_client, "FINNHUB_API_KEY"),
    (fmp_client, "FMP_API_KEY"),
    (massive_adapter, "MASSIVE_API_KEY"),
])
def test_is_configured_is_the_presence_of_the_adapters_own_key(monkeypatch, adapter, env):
    monkeypatch.delenv(env, raising=False)
    assert adapter.is_configured() is False
    monkeypatch.setenv(env, "")
    assert adapter.is_configured() is False
    monkeypatch.setenv(env, "k-not-real")
    assert adapter.is_configured() is True


def test_the_stream_ingest_connect_gate_asks_the_massive_adapter(monkeypatch):
    from api.services import ingest_runtime as ir
    from api.services import vendor_socket_guard
    monkeypatch.setenv("STREAM_INGEST_CONNECT", "1")
    monkeypatch.setattr(vendor_socket_guard, "may_open", lambda vendor: (True, ""))
    monkeypatch.setenv("MASSIVE_API_KEY", "k-not-real")
    monkeypatch.setattr(massive_adapter, "is_configured", lambda: False)
    assert ir.connect_decision() == (False, "MASSIVE_API_KEY is not set")
    monkeypatch.delenv("MASSIVE_API_KEY")
    monkeypatch.setattr(massive_adapter, "is_configured", lambda: True)
    assert ir.connect_decision() == (True, "")


def test_the_earnings_followup_asks_the_finnhub_and_fmp_adapters(monkeypatch):
    from api.services.journal_two import earnings_followup as ef
    from api.services.journal_two import earnings_prep as ep
    monkeypatch.setattr(ep, "sandbox_calendar_active", lambda: False)
    monkeypatch.setenv("FINNHUB_API_KEY", "k-not-real")
    monkeypatch.setenv("FMP_API_KEY", "k-not-real")
    monkeypatch.setattr(finnhub_client, "is_configured", lambda: False)
    monkeypatch.setattr(fmp_client, "is_configured", lambda: False)
    assert ef._reporters_configured() is False
    monkeypatch.delenv("FINNHUB_API_KEY")
    monkeypatch.delenv("FMP_API_KEY")
    for configured in (finnhub_client, fmp_client):
        monkeypatch.setattr(finnhub_client, "is_configured", lambda: False)
        monkeypatch.setattr(fmp_client, "is_configured", lambda: False)
        monkeypatch.setattr(configured, "is_configured", lambda: True)
        assert ef._reporters_configured() is True, configured.__name__


def test_ticker_ipo_asks_the_fmp_adapter_before_it_reads_fmp(monkeypatch):
    from api.services import ticker_ipo

    class _Answer:
        value = [{"date": "1993-01-29"}]

    asked = []
    monkeypatch.setattr(fmp_client, "get_historical_price_eod_light",
                        lambda *a, **k: asked.append(a) or _Answer())
    monkeypatch.setenv("FMP_API_KEY", "k-not-real")
    monkeypatch.setattr(fmp_client, "is_configured", lambda: False)
    assert ticker_ipo._fmp_earliest("SPY", "1993-01-22") is None
    assert asked == []
    monkeypatch.delenv("FMP_API_KEY")
    monkeypatch.setattr(fmp_client, "is_configured", lambda: True)
    assert ticker_ipo._fmp_earliest("SPY", "1993-01-22") == "1993-01-29"
    assert len(asked) == 1
