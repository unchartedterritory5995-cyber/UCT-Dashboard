"""UCT_AGENT_DATA_KINDS — the gateway's per-kind activation allowlist (owner: agent-lead).

Activation is meant to be narrow ("quote" first), so the allowlist FAILS CLOSED: with the gateway on and the
list unset, empty, a wildcard or a misspelling, no kind is admitted and no adapter runs. It only narrows: an
isolated kind still needs UCT_AGENT_ISOLATED and a scan kind UCT_AGENT_SCAN, even when listed."""
from __future__ import annotations

import pytest

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for name in (gw.DATA_ENV, gw.SCAN_ENV, gw.ISOLATED_ENV, gw.KINDS_ENV):
        monkeypatch.delenv(name, raising=False)
    gw._reset_for_test(None)
    yield
    gw._reset_for_test(None)


@pytest.fixture()
def ran(monkeypatch):
    """Swap every kind's adapter for a spy over a fresh registry built from the REAL registrars."""
    calls = []
    gw._reset_for_test(None)
    real = gw.registry()
    fake = gw.Registry()
    for name in real.names():
        k = real.get(name)

        def fn(params, ctx, _n=name):
            calls.append(_n)
            return env.make_envelope(_n, params, status="ok", freshness="historical",
                                     as_of="2026-11-01T20:00:00Z", source="fixture", data={"v": 1})
        fake.register(gw.Kind(name=name, fn=fn, freshness=k.freshness, category=k.category,
                              owner=k.owner, model_isolated=k.model_isolated))
    gw._reset_for_test(fake)
    return calls


def _read(kind, purpose="answer"):
    params = {"symbol": "NVDA"} if kind in ("quote", "bars.daily", "fundamentals", "earnings", "news.company") else {}
    return gw.read(kind, params, user_id=1, turn_id=f"t-{kind}-{purpose}", purpose=purpose)


def _all():
    return gw.registry().names()


@pytest.mark.parametrize("kinds", [None, "", " , ", "*", "all", "Quote", "quote ;bars.daily", "nope"])
def test_fails_closed_unless_a_kind_is_named_exactly(monkeypatch, ran, kinds):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    if kinds is not None:
        monkeypatch.setenv(gw.KINDS_ENV, kinds)
    for name in _all():
        out = _read(name)
        assert out["status"] == "refused" and env.validate_envelope(out) == [], name
    assert ran == []                                  # no adapter ran
    assert "quote" not in gw.enabled_kinds()


def test_quote_only_admits_quote_and_nothing_else(monkeypatch, ran):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.KINDS_ENV, "quote")
    assert _read("quote")["status"] == "ok"
    for name in [n for n in _all() if n != "quote"]:
        out = _read(name)
        assert out["status"] == "refused", name
    assert ran == ["quote"]
    assert gw.enabled_kinds() == frozenset({"quote"})


def test_the_refusal_names_the_switch_and_nothing_else(monkeypatch, ran):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.KINDS_ENV, "quote")
    out = _read("bars.daily")
    assert out["notes"] == ["bars.daily is not switched on for UCT Agent (UCT_AGENT_DATA_KINDS)"]
    assert out["data"] is None and out["provider_calls"] == 0


def test_listing_never_widens_isolation(monkeypatch, ran):
    """breadth.current / ratings stay refused for every purpose while UCT_AGENT_ISOLATED is off, even listed."""
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(_all()))
    isolated = [n for n in _all() if gw.registry().get(n).model_isolated]
    assert set(isolated) >= {"breadth.current", "ratings"}
    for name in isolated:
        for purpose in env.PURPOSES:
            assert _read(name, purpose)["status"] == "refused", (name, purpose)
    assert not set(isolated) & set(ran)


def test_listing_never_widens_scans(monkeypatch, ran):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(_all()))
    scans = [n for n in _all() if gw.registry().get(n).category == "scan"]
    for name in scans:
        out = _read(name)
        assert out["status"] == "refused" and "UCT_AGENT_SCAN" in out["notes"][0], name
    assert not set(scans) & set(ran)


def test_the_list_means_nothing_while_the_gateway_is_off(monkeypatch, ran):
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(_all()))
    assert gw.enabled_kinds() == frozenset()
    for name in _all():
        out = _read(name)
        assert out["status"] == "refused" and "UCT_AGENT_DATA" in out["notes"][0], name
    assert ran == []


def test_config_reports_the_active_kinds(monkeypatch):
    from api.routers import uct_agent as router
    assert router.agent_config(user={"id": 1})["data_kinds"] == []
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.KINDS_ENV, "quote, quotes")
    cfg = router.agent_config(user={"id": 1})
    assert cfg["data"] is True and cfg["data_kinds"] == ["quote", "quotes"] and cfg["scan"] is False
