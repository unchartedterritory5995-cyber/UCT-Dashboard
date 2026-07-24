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


# ── stale-serving must SAY it is stale (2026-07-23 class) ───────────────────
#
# On a failed refresh the probe serves last-known-good. Doing that silently
# means a broker stuck in maintenance keeps reporting whatever flags we cached
# hours ago, and no caller can distinguish "fresh: all clear" from "we haven't
# been able to ask since this morning" — the same shape as a health check that
# reads green through an outage.

@pytest.mark.asyncio
async def test_failed_refresh_serves_stale_but_flags_it(monkeypatch):
    partner_health._reset_cache_for_tests()
    monkeypatch.setenv("SNAPTRADE_CLIENT_ID", "cid")
    monkeypatch.setenv("SNAPTRADE_CONSUMER_KEY", "ck")
    snap.set_limiter(_NoThrottle())

    snap.configure(_Group(reference_data=_Group(
        get_partner_info=lambda **kw: _Resp(RAW))))
    fresh = await partner_health.get_partner_health(force=True)
    assert fresh is not None
    assert partner_health.is_stale(fresh) is False
    assert "WEBULL" in fresh["brokers"]

    def boom(**kw):
        raise RuntimeError("partner API down")

    snap.configure(_Group(reference_data=_Group(get_partner_info=boom)))
    stale = await partner_health.get_partner_health(force=True)

    assert stale is not None, "must still serve last-known-good"
    assert partner_health.is_stale(stale) is True
    assert stale["ageSeconds"] >= 0
    # The payload is still USABLE — flags survive so degraded-broker logic works.
    assert stale["brokers"] == fresh["brokers"]


@pytest.mark.asyncio
async def test_marking_stale_does_not_poison_the_cache(monkeypatch):
    """The stale tag is on a COPY — a later successful refresh must come back
    clean, and the cached object must never carry the flag."""
    partner_health._reset_cache_for_tests()
    monkeypatch.setenv("SNAPTRADE_CLIENT_ID", "cid")
    monkeypatch.setenv("SNAPTRADE_CONSUMER_KEY", "ck")
    snap.set_limiter(_NoThrottle())

    snap.configure(_Group(reference_data=_Group(
        get_partner_info=lambda **kw: _Resp(RAW))))
    await partner_health.get_partner_health(force=True)

    def boom(**kw):
        raise RuntimeError("down")

    snap.configure(_Group(reference_data=_Group(get_partner_info=boom)))
    assert partner_health.is_stale(await partner_health.get_partner_health(force=True))
    assert "stale" not in partner_health._cache["data"], "cache was mutated"

    snap.configure(_Group(reference_data=_Group(
        get_partner_info=lambda **kw: _Resp(RAW))))
    recovered = await partner_health.get_partner_health(force=True)
    assert partner_health.is_stale(recovered) is False


def test_is_stale_handles_none_and_fresh():
    assert partner_health.is_stale(None) is False
    assert partner_health.is_stale({"brokers": {}}) is False
    assert partner_health.is_stale({"brokers": {}, "stale": True}) is True
