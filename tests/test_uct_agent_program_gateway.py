"""UCT Agent program — the MD-1 gateway framework (Sprint 0): dark by default, envelope validation,
per-turn budgets (logical reads, scans AND provider requests), and the route stays admin-dark."""
from __future__ import annotations

import pytest

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.delenv(gw.DATA_ENV, raising=False)
    monkeypatch.delenv(gw.SCAN_ENV, raising=False)
    gw._reset_for_test(None)
    yield
    gw._reset_for_test(None)


def _kind(name="quote", freshness="live", category="market", provider_calls=1, out_freshness=None, bad=False, boom=False):
    def fn(params, ctx):
        if boom:
            raise RuntimeError("upstream exploded with secret=abc")
        if bad:
            return {"kind": name}
        return env.make_envelope(name, params, status="ok", freshness=out_freshness or freshness,
                                 as_of="2026-11-01T15:59:00Z", source="fixture", data={"v": 1}, provider_calls=provider_calls)
    return gw.Kind(name=name, fn=fn, freshness=freshness, category=category)


def _with(*kinds):
    r = gw.Registry()
    for k in kinds:
        r.register(k)
    gw._reset_for_test(r)


def _read(kind="quote", turn="t1", **params):
    return gw.read(kind, params or {"symbol": "SPY"}, user_id=1, turn_id=turn)


def test_dark_by_default_every_registered_kind_is_refused_and_never_runs(monkeypatch):
    """However many kinds the owners register (the REAL registrars), none is reachable while UCT_AGENT_DATA
    is off — the refusal comes before the registry, so no adapter runs and nothing reaches a provider."""
    gw._reset_for_test(None)
    assert gw.data_enabled() is False and gw.scan_enabled() is False
    real = gw.registry()
    ran = []
    for name in real.names():
        k = real.get(name)
        monkeypatch.setattr(real, "_kinds", {**real._kinds, name: gw.Kind(
            name=k.name, fn=lambda p, c, n=name: ran.append(n), freshness=k.freshness, category=k.category,
            owner=k.owner, max_symbols=k.max_symbols)})
    for name in real.names() + ["quote", "screen.run", "not-a-kind"]:
        out = gw.read(name, {"symbol": "SPY"}, user_id=1, turn_id="t1")
        assert out["status"] == "refused" and "UCT_AGENT_DATA" in out["notes"][0], name
        assert env.validate_envelope(out) == [] and out["data"] is None and out["provider_calls"] == 0, name
    assert ran == []                             # no adapter ran


def test_scan_kinds_stay_refused_with_only_the_data_flag(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    gw._reset_for_test(None)
    real = gw.registry()
    for name in [n for n in real.names() if real.get(n).category == "scan"]:
        out = gw.read(name, {}, user_id=1, turn_id="t-scan")
        assert out["status"] == "refused" and "UCT_AGENT_SCAN" in out["notes"][0], name


def test_enabled_read_returns_a_valid_envelope(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    _with(_kind())
    out = _read()
    assert env.validate_envelope(out) == [] and out["status"] == "ok" and out["as_of"] == "2026-11-01T15:59:00Z"


def test_unknown_kind_bad_purpose_and_missing_turn_are_refused(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    _with(_kind())
    assert _read("nope")["status"] == "refused"
    assert gw.read("quote", {}, user_id=1, turn_id="t", purpose="trade")["status"] == "refused"
    assert gw.read("quote", {}, user_id=1, turn_id="")["status"] == "refused"


def test_scan_kinds_need_their_own_flag(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    _with(_kind("screen.run", freshness="periodic", category="scan"))
    assert "UCT_AGENT_SCAN" in _read("screen.run")["notes"][0]
    monkeypatch.setenv(gw.SCAN_ENV, "1")
    assert _read("screen.run")["status"] == "ok"


def test_budget_counts_logical_reads(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    _with(_kind(provider_calls=0))
    outs = [_read() for _ in range(gw.MAX_READS_PER_TURN + 1)]
    assert [o["status"] for o in outs[:-1]] == ["ok"] * gw.MAX_READS_PER_TURN
    assert outs[-1]["status"] == "refused" and "data reads" in outs[-1]["notes"][0]
    assert _read(turn="t2")["status"] == "ok"   # a new turn has its own budget


def test_budget_counts_provider_requests(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    _with(_kind(provider_calls=gw.MAX_PROVIDER_CALLS_PER_TURN))
    assert _read()["status"] == "ok"
    out = _read()
    assert out["status"] == "refused" and "provider requests" in out["notes"][0]


def test_one_scan_per_turn(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.SCAN_ENV, "1")
    _with(_kind("screen.run", freshness="periodic", category="scan", provider_calls=0))
    assert _read("screen.run")["status"] == "ok"
    assert _read("screen.run")["status"] == "refused"


def test_validate_runs_before_admission_and_spends_nothing(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.SCAN_ENV, "1")
    ran = []

    def fn(params, ctx):
        ran.append(params)
        return env.refused("screen.run", params, "the screener refused it")     # an attempted execution

    def validate(params):
        return None if params.get("spec") == "good" else "that is not a valid screen"

    def boom(params):
        raise RuntimeError("validator bug")

    _with(gw.Kind(name="screen.run", fn=fn, freshness="periodic", category="scan", validate=validate),
          gw.Kind(name="screen.count", fn=fn, freshness="periodic", category="scan", validate=boom))
    bad = [gw.read("screen.run", {"spec": "bad"}, user_id=1, turn_id="t") for _ in range(3)]
    assert all(o["status"] == "refused" and o["notes"] == ["that is not a valid screen"] for o in bad)
    assert ran == []                                         # refused before the adapter, nothing spent
    assert gw.read("screen.count", {"spec": "good"}, user_id=1, turn_id="t")["notes"] == ["the request could not be checked"]
    # the turn still has its one scan: an admitted, attempted execution spends it even though it is refused
    first = gw.read("screen.run", {"spec": "good"}, user_id=1, turn_id="t")
    assert ran == [{"spec": "good"}] and first["notes"] == ["the screener refused it"]
    again = gw.read("screen.run", {"spec": "good"}, user_id=1, turn_id="t")
    assert again["status"] == "refused" and "already ran" in again["notes"][0] and len(ran) == 1


def test_model_isolated_kinds_answer_the_member_only(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    ran = []

    def fn(params, ctx):
        ran.append(ctx["purpose"])
        return env.make_envelope("breadth.current", params, status="ok", freshness="periodic",
                                 as_of="2026-11-01T15:59:00Z", source="uct-breadth-v2", data={"v": 1})

    _with(gw.Kind(name="breadth.current", fn=fn, freshness="periodic", model_isolated=True))
    for purpose in ("research", "scan"):
        out = gw.read("breadth.current", {}, user_id=1, turn_id="t", purpose=purpose)
        assert out["status"] == "refused" and "never used for research" in out["notes"][0]
    assert ran == []                                   # refused before admission: nothing ran, nothing spent
    assert gw.read("breadth.current", {}, user_id=1, turn_id="t", purpose="answer")["status"] == "ok"
    assert ran == ["answer"]


def test_symbol_cap(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    _with(_kind("quotes"))
    out = gw.read("quotes", {"symbols": ["X"] * (gw.MAX_SYMBOLS_PER_READ + 1)}, user_id=1, turn_id="t")
    assert out["status"] == "refused"


def test_contract_breaking_or_failing_adapters_are_unavailable_never_passed_through(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    _with(_kind("a", bad=True), _kind("b", boom=True), _kind("c", freshness="periodic", out_freshness="live"),
          _kind("d", freshness="live", out_freshness="historical"))
    for k in ("a", "b", "c"):
        out = _read(k)
        assert out["status"] == "unavailable" and env.validate_envelope(out) == [], k
        assert "secret" not in str(out)
    assert _read("d")["status"] == "ok"          # LESS fresh than declared (market closed) is honest


def test_envelope_rules():
    ok = env.make_envelope("q", {}, status="ok", freshness="live", as_of=None, source="s")
    assert "as_of is null without a note saying why" in env.validate_envelope(ok)
    delayed = env.make_envelope("q", {}, status="ok", freshness="delayed", as_of="2026-11-01T15:00:00Z", source="s")
    assert "delayed data must give delay_s" in env.validate_envelope(delayed)
    assert env.validate_envelope(env.refused("q", {}, "why")) == []
    bad_time = env.make_envelope("q", {}, status="ok", freshness="live", as_of="2026-11-01 15:00", source="s")
    assert "as_of is not ISO-8601 UTC" in env.validate_envelope(bad_time)


def test_registry_rejects_duplicates_and_bad_declarations():
    r = gw.Registry()
    r.register(_kind())
    with pytest.raises(ValueError):
        r.register(_kind())
    with pytest.raises(ValueError):
        r.register(_kind("x", freshness="unavailable"))
    with pytest.raises(ValueError):
        r.register(_kind("y", category="trades"))


def test_route_is_admin_dark_and_config_reports_flags():
    from api.routers import uct_agent as ua
    route = next(r for r in ua.router.routes if getattr(r, "path", "") == "/api/agent/data")
    deps = [d.call for d in route.dependant.dependencies]
    assert ua.require_admin_dark in deps
    import inspect
    src = inspect.getsource(ua.agent_config)
    assert '"data": gateway.data_enabled()' in src and '"scan": gateway.scan_enabled()' in src
