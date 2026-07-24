"""Tests for the SnapTrade client wrapper.

No network, no credentials: we inject a fake SDK client and assert that
the wrapper parses bodies, converts SDK types to plain Python, and maps
HTTP/SDK errors to our structured exception family. The fake methods are
plain sync callables (the wrapper runs them via asyncio.to_thread).
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from api.services.journal_two.broker import snaptrade_client as sc
from snaptrade_client.exceptions import ApiException


# ── Fakes ────────────────────────────────────────────────────────────────────

class _Resp:
    def __init__(self, body):
        self.body = body


def _api_exc(status, body=None, reason="", headers=None):
    e = ApiException(status=status, reason=reason)
    e.body = body
    e.headers = headers or {}
    return e


class _Group:
    """Holds named callables; getattr returns them."""
    def __init__(self, **methods):
        for k, v in methods.items():
            setattr(self, k, v)


class _FakeSDK:
    def __init__(self, authentication=None, account_information=None):
        self.authentication = authentication or _Group()
        self.account_information = account_information or _Group()


class _NoThrottle:
    async def acquire(self, n=1):
        return None


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    # No real throttle/retry waits; clean client state per test.
    sc.set_limiter(_NoThrottle())

    async def _noop_sleep(_):
        return None
    sc.set_retry_sleep(_noop_sleep)
    sc.reset()
    yield
    sc.reset()
    sc.set_retry_sleep(__import__("asyncio").sleep)


# ── _to_plain ────────────────────────────────────────────────────────────────

def test_to_plain_converts_decimal_and_nested():
    body = {
        "a": Decimal("10"),          # integral -> int
        "b": Decimal("1.5"),         # -> float
        "c": ("x", Decimal("2")),    # tuple -> list
        "d": {"e": b"hi"},           # bytes -> str
    }
    out = sc._to_plain(body)
    assert out == {"a": 10, "b": 1.5, "c": ["x", 2], "d": {"e": "hi"}}
    assert isinstance(out["a"], int) and isinstance(out["b"], float)


# ── register / login / parsing ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_register_user_parses_body():
    sdk = _FakeSDK(authentication=_Group(
        register_snap_trade_user=lambda **kw: _Resp({"userId": kw["user_id"], "userSecret": "sek"})
    ))
    sc.configure(sdk)
    out = await sc.register_user("uct-123")
    assert out == {"snaptrade_user_id": "uct-123", "user_secret": "sek"}


@pytest.mark.asyncio
async def test_register_user_bad_body_raises():
    sdk = _FakeSDK(authentication=_Group(
        register_snap_trade_user=lambda **kw: _Resp({"userId": "x"})  # no secret
    ))
    sc.configure(sdk)
    with pytest.raises(sc.SnapError):
        await sc.register_user("uct-123")


@pytest.mark.asyncio
async def test_login_redirect_uri():
    sdk = _FakeSDK(authentication=_Group(
        login_snap_trade_user=lambda **kw: _Resp({"redirectURI": "https://app.snaptrade.com/x"})
    ))
    sc.configure(sdk)
    uri = await sc.login_redirect_uri("u", "s", custom_redirect="https://uct/return")
    assert uri.startswith("https://app.snaptrade.com/")


@pytest.mark.asyncio
async def test_list_accounts_and_activities_envelope():
    sdk = _FakeSDK(account_information=_Group(
        list_user_accounts=lambda **kw: _Resp([{"id": "a1"}, {"id": "a2"}]),
        get_account_activities=lambda **kw: _Resp({"data": [{"id": "t1"}], "pagination": {"offset": 0}}),
    ))
    sc.configure(sdk)
    accts = await sc.list_accounts("u", "s")
    assert [a["id"] for a in accts] == ["a1", "a2"]
    page = await sc.get_activities("u", "s", "a1", offset=0)
    assert page["data"] == [{"id": "t1"}]
    assert page["pagination"] == {"offset": 0}


@pytest.mark.asyncio
async def test_activities_bare_list_normalized():
    sdk = _FakeSDK(account_information=_Group(
        get_account_activities=lambda **kw: _Resp([{"id": "t1"}]),
    ))
    sc.configure(sdk)
    page = await sc.get_activities("u", "s", "a1")
    assert page == {"data": [{"id": "t1"}], "pagination": {}}


# ── error mapping ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_429_maps_rate_limited():
    def boom(**kw):
        raise _api_exc(429, body={"detail": "slow down"}, headers={"Retry-After": "2.5"})
    sc.configure(_FakeSDK(account_information=_Group(list_user_accounts=boom)))
    with pytest.raises(sc.SnapRateLimited) as ei:
        await sc.list_accounts("u", "s")
    assert ei.value.retry_after == 2.5


@pytest.mark.asyncio
async def test_401_generic_maps_auth_error():
    def boom(**kw):
        raise _api_exc(401, body={"detail": "bad partner key"})
    sc.configure(_FakeSDK(account_information=_Group(list_user_accounts=boom)))
    with pytest.raises(sc.SnapAuthError) as ei:
        await sc.list_accounts("u", "s")
    assert not isinstance(ei.value, sc.SnapUserSecretInvalid)


@pytest.mark.asyncio
async def test_401_user_secret_code_maps_secret_invalid():
    def boom(**kw):
        raise _api_exc(401, body={"code": "1076", "detail": "user secret invalid"})
    sc.configure(_FakeSDK(account_information=_Group(list_user_accounts=boom)))
    with pytest.raises(sc.SnapUserSecretInvalid):
        await sc.list_accounts("u", "s")


@pytest.mark.asyncio
async def test_retries_then_succeeds_on_transient():
    calls = {"n": 0}
    def flaky(**kw):
        calls["n"] += 1
        if calls["n"] < 3:
            raise _api_exc(503, body={"detail": "temporarily down"})
        return _Resp([{"id": "a1"}])
    sc.configure(_FakeSDK(account_information=_Group(list_user_accounts=flaky)))
    out = await sc.list_accounts("u", "s")
    assert out == [{"id": "a1"}]
    assert calls["n"] == 3  # 2 transient failures then success


@pytest.mark.asyncio
async def test_500_maps_transient():
    def boom(**kw):
        raise _api_exc(500, body={"detail": "oops"})
    sc.configure(_FakeSDK(account_information=_Group(list_user_accounts=boom)))
    with pytest.raises(sc.SnapTransient):
        await sc.list_accounts("u", "s")


@pytest.mark.asyncio
async def test_network_error_maps_transient():
    def boom(**kw):
        raise ConnectionError("dns fail")
    sc.configure(_FakeSDK(account_information=_Group(list_user_accounts=boom)))
    with pytest.raises(sc.SnapTransient):
        await sc.list_accounts("u", "s")


def test_not_configured(monkeypatch):
    monkeypatch.delenv("SNAPTRADE_CLIENT_ID", raising=False)
    monkeypatch.delenv("SNAPTRADE_CONSUMER_KEY", raising=False)
    sc.reset()  # clear any injected client
    assert sc.is_configured() is False
    with pytest.raises(sc.SnapNotConfigured):
        sc._sdk()


# ── error message carries the SnapTrade body (prod diagnosability) ───────────

def test_auth_error_message_carries_code_and_detail():
    # Prod 2026-07-14: a bare "SnapTrade API error 401: Unauthorized" was
    # undiagnosable. The mapped message must include the response body's
    # code + detail when present so sync_log errors are actionable.
    e = _api_exc(401, body={"code": "1234", "detail": "Signature invalid"},
                 reason="Unauthorized")
    err = sc._map_api_exception(e)
    assert isinstance(err, sc.SnapAuthError)
    s = str(err)
    assert "1234" in s
    assert "Signature invalid" in s


# ── SDK constructor contract (prod 2026-07-23 regression rail) ───────────────
#
# snaptrade-python-sdk 12.0.0 changed SnapTrade.__init__ to
# (configuration=None, **kwargs). Our SnapTrade(consumer_key=..., client_id=...)
# kwargs were then SILENTLY swallowed — no TypeError — so the client built with
# no credentials and every signed request went out unauthenticated (401 code
# 0000 "Authentication credentials were not provided"). All 11 member broker
# connections were marked broken overnight. requirements.txt pins <12; _sdk()
# additionally refuses to hand back a credential-less client.

class _NoCredsSdk:
    """Mimics a future SDK that ignores our constructor kwargs."""
    def __init__(self, *a, **kw):
        cfg = type("Cfg", (), {"consumer_key": None, "api_key": {}})()
        self.authentication = type("Api", (), {
            "api_client": type("AC", (), {"configuration": cfg})()
        })()


class _GoodSdk:
    def __init__(self, consumer_key=None, client_id=None, **kw):
        cfg = type("Cfg", (), {
            "consumer_key": consumer_key,
            "api_key": {"PartnerClientId": client_id},
        })()
        self.authentication = type("Api", (), {
            "api_client": type("AC", (), {"configuration": cfg})()
        })()


def test_sdk_raises_when_constructor_silently_drops_credentials(monkeypatch):
    monkeypatch.setenv("SNAPTRADE_CLIENT_ID", "cid")
    monkeypatch.setenv("SNAPTRADE_CONSUMER_KEY", "ck")
    sc.reset()
    import snaptrade_client
    monkeypatch.setattr(snaptrade_client, "SnapTrade", _NoCredsSdk)
    with pytest.raises(sc.SnapNotConfigured) as ei:
        sc._sdk()
    assert "unauthenticated" in str(ei.value).lower()


def test_sdk_accepts_a_client_that_applied_credentials(monkeypatch):
    monkeypatch.setenv("SNAPTRADE_CLIENT_ID", "cid")
    monkeypatch.setenv("SNAPTRADE_CONSUMER_KEY", "ck")
    sc.reset()
    import snaptrade_client
    monkeypatch.setattr(snaptrade_client, "SnapTrade", _GoodSdk)
    client = sc._sdk()
    cfg = sc._sdk_configuration(client)
    assert cfg.consumer_key == "ck"
    assert cfg.api_key["PartnerClientId"] == "cid"


def test_credential_guard_is_silent_when_internals_are_unrecognizable():
    # Must never take broker sync down over a cosmetic SDK internals change.
    sc._assert_credentials_applied(object())


def test_installed_sdk_actually_applies_our_credentials():
    """Guards the real installed SDK, not a fake — this is what would have
    caught the 12.0.0 bump in CI before it reached production."""
    from snaptrade_client import SnapTrade
    cfg = sc._sdk_configuration(SnapTrade(consumer_key="ck", client_id="cid"))
    assert cfg is not None, "SDK internals moved — update _sdk_configuration"
    assert cfg.consumer_key == "ck"
    assert cfg.api_key.get("PartnerClientId") == "cid"
