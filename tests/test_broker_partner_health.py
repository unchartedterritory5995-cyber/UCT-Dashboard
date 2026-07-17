"""Partner-info health probe: normalized capability/broker flags, cached,
degraded-broker surfacing for members' connected brokerages."""
from __future__ import annotations

import pytest

from api.services.journal_two.broker import partner_health, snaptrade_client as snap


class _Resp:
    def __init__(self, body):
        self.body = body


class _Group:
    def __init__(self, **m):
        for k, v in m.items():
            setattr(self, k, v)


class _NoThrottle:
    async def acquire(self, n=1):
        return None


RAW = {
    "can_access_holdings": True,
    "can_access_trades": True,
    "can_access_orders": True,
    "allowed_brokerages": [
        {"slug": "WEBULL", "display_name": "Webull", "enabled": True,
         "maintenance_mode": False, "is_degraded": True},
        {"slug": "SCHWAB", "display_name": "Charles Schwab", "enabled": True,
         "maintenance_mode": False, "is_degraded": False},
        {"slug": "ROBINHOOD", "display_name": "Robinhood", "enabled": True,
         "maintenance_mode": True, "is_degraded": False},
    ],
}


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("SNAPTRADE_CLIENT_ID", "cid")
    monkeypatch.setenv("SNAPTRADE_CONSUMER_KEY", "ck")
    snap.set_limiter(_NoThrottle())
    partner_health._reset_cache_for_tests()
    yield
    snap.reset()
    partner_health._reset_cache_for_tests()


@pytest.mark.asyncio
async def test_probe_normalizes_and_caches(env):
    calls = []

    def fn(**kw):
        calls.append(1)
        return _Resp(RAW)
    snap.configure(_Group(reference_data=_Group(get_partner_info=fn)))
    h1 = await partner_health.get_partner_health()
    h2 = await partner_health.get_partner_health()
    assert len(calls) == 1  # second call served from cache
    assert h1["capabilities"]["can_access_holdings"] is True
    assert h1["brokers"]["WEBULL"]["isDegraded"] is True
    assert h2 is h1


@pytest.mark.asyncio
async def test_degraded_connected_brokers_only_flags_members_brokers(env):
    snap.configure(_Group(reference_data=_Group(
        get_partner_info=lambda **kw: _Resp(RAW))))
    accounts = [
        {"brokerageName": "Webull"},          # degraded → flagged
        {"brokerageName": "Charles Schwab"},  # healthy → not flagged
    ]
    out = await partner_health.degraded_connected_brokers(accounts)
    assert [d["brokerage"] for d in out] == ["Webull"]
    assert out[0]["isDegraded"] is True


@pytest.mark.asyncio
async def test_probe_failure_serves_stale_then_none(env):
    def boom(**kw):
        raise RuntimeError("down")
    snap.configure(_Group(reference_data=_Group(get_partner_info=boom)))
    assert await partner_health.get_partner_health() is None  # nothing cached
    out = await partner_health.degraded_connected_brokers(
        [{"brokerageName": "Webull"}])
    assert out == []  # unknown health must never invent flags


def test_broker_flags_matching():
    health = {"brokers": {"WEBULL": {"name": "Webull", "enabled": True,
                                     "maintenanceMode": False, "isDegraded": True}}}
    assert partner_health.broker_flags_for(health, "Webull")["isDegraded"] is True
    assert partner_health.broker_flags_for(health, "WEBULL") is not None
    assert partner_health.broker_flags_for(health, "Fidelity") is None
    assert partner_health.broker_flags_for(None, "Webull") is None
