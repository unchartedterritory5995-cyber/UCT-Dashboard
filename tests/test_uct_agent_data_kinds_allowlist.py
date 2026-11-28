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
    for name in (gw.DATA_ENV, gw.SCAN_ENV, gw.ISOLATED_ENV, gw.ISOLATED_KINDS_ENV, gw.KINDS_ENV):
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


# PRODUCTION'S EXACT VALUES (web), armed 2026-11-24 by the integrator under the owner's delegation of 2026-11-24 ("you
# decide it all and get it all done"), generated from the code (kinds.py's isolated set minus the exclusions), never by
# hand. UCT_AGENT_ISOLATED=1, every armed isolated kind named on its own in UCT_AGENT_ISOLATED_KINDS (D9) and served for
# purpose "answer" only (ADR-005 unchanged). The Railway commands: docs/agent/program/RESUME.md. The browser half:
# app/src/agent/agentProdKinds.test.js (the same list). Each excluded kind's reason: docs/feature_flags.json
# knobs.UCT_AGENT_ISOLATED_KINDS.
PROD_ISOLATED_KINDS = ("breadth.current,ratings,rs.leadership,analyst.actions,highsLows.session,levels.darkpool,"
                       "highsLows.yearly,themes.rotation,confluence.board,earnings.expectedMove,levels.gamma,flow.topPicks,"
                       "flow.record,earnings.reactions,earnings.season,group.drill,short.interest,short.list,"
                       "seasonality.stock,seasonality.board,options.tideHistory,options.oiChange,rates.treasury,"
                       "market.regime,stock.setups,stock.eventsTimeline,uct20.list,options.ivHistory,dilution.watch,"
                       "stock.corporateActions,calendar.ipos,calendar.dividends,rates.auctions,rates.realYields,stock.stats,"
                       "stock.volumeFootprint,stock.factorExposure,stock.setupHistory,company.publicRecords,ownership.funds,"
                       "groups.rank,groups.crowding,earnings.seasonBySector,estimates.revisionBreadth,options.ivRankLeaders,"
                       "ipo.lockups,cot.byTrader,estimates.history,analyst.ratings,company.segments,stock.failsToDeliver,"
                       "company.deals,insider.market,market.history,econ.latest,market.liquidity,market.oil,market.analogs")
PROD_KINDS_BEFORE_ISOLATED = ("instrument.resolve,quote,quotes,bars.daily,fundamentals,earnings,news.company,themes,screen.run,"
                              "screen.count,screen.saved,cot.positioning,history.eventStudy")
PROD_KINDS = PROD_KINDS_BEFORE_ISOLATED + "," + PROD_ISOLATED_KINDS
PROD_EXCLUDED = (
    "earnings.callSearch",
    "earnings.callThemes",
    "fed.watch",
    "catalysts.board",
    "sectors.performance",
    "index.quote",
    "commodity.quote",
    "crypto.quote",
    "research.company",
    "knowledge.search",
    "setup.playbook",
    "setup.record",
    "leaders.longRun",
)


def _production(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.KINDS_ENV, PROD_KINDS)
    monkeypatch.setenv(gw.ISOLATED_ENV, "1")
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, PROD_ISOLATED_KINDS)


def test_production_kind_list_serves_the_armed_kinds_and_keeps_the_excluded_dark(monkeypatch, ran):
    _production(monkeypatch)
    names = set(_all())
    armed, armed_iso = PROD_KINDS.split(","), PROD_ISOLATED_KINDS.split(",")
    assert len(armed) == len(set(armed)) == 71 and len(armed_iso) == 58
    assert set(armed) <= names and set(PROD_EXCLUDED) <= names     # no typo: every name is a registered kind
    assert not set(PROD_EXCLUDED) & set(armed)
    assert gw.enabled_kinds() == frozenset(armed)
    isolated = {n for n in names if gw.registry().get(n).model_isolated}
    assert gw.isolated_kinds() == frozenset(armed_iso)
    assert set(armed_iso) <= isolated                               # the isolation list names isolated kinds only
    assert isolated & set(armed) == set(armed_iso)                  # D9: every served isolated kind has its own entry
    for name in PROD_EXCLUDED:
        for purpose in ("answer", "scan", "research"):
            assert _read(name, purpose)["status"] == "refused", (name, purpose)
    assert not set(PROD_EXCLUDED) & set(ran)
    for name in armed_iso:                                          # served to the member, for an answer only
        assert _read(name, "answer")["status"] == "ok", name
        for purpose in ("scan", "research"):
            out = _read(name, purpose)
            assert out["status"] == "refused" and "never used for research" in out["notes"][0], (name, purpose)
    for name in ("cot.positioning", "history.eventStudy", "bars.daily"):
        assert _read(name)["status"] == "ok", name


def test_production_isolated_kinds_are_refused_while_the_isolation_master_switch_is_off(monkeypatch, ran):
    """The order of the two Railway commands matters only for the member's view; the server fails closed either way:
    with UCT_AGENT_DATA_KINDS set but UCT_AGENT_ISOLATED unset, no isolated kind is served."""
    _production(monkeypatch)
    monkeypatch.delenv(gw.ISOLATED_ENV)
    for name in PROD_ISOLATED_KINDS.split(","):
        assert _read(name)["status"] == "refused", name
    assert not set(PROD_ISOLATED_KINDS.split(",")) & set(ran)
    assert _read("cot.positioning")["status"] == "ok"


def test_a_bars_args_shape_from_before_from_still_matches_after_the_server_fill():
    """stock.dailyBars gained a nullable `from`: the model's old 4-key shape is filled to from=null, never refused."""
    from api.services.uct_agent import turn as t
    schema = {"type": "object", "properties": {"symbol": {"type": "string"},
              "measure": {"type": "string", "enum": ["lastClose", "change", "range52w", "session", "range", "offHigh", "pullbacks"]},
              "sessions": {"type": ["integer", "null"]}, "date": {"type": ["string", "null"]}, "from": {"type": ["string", "null"]}},
              "required": ["symbol", "measure", "sessions", "date", "from"], "additionalProperties": False}
    old = {"symbol": "NVDA", "measure": "change", "sessions": 5, "date": None}
    assert not t.args_match(schema, old)
    filled = t._fill_absent_nullables(schema, t._wrap_lone_argument(schema, old))
    assert filled == {**old, "from": None} and t.args_match(schema, filled)
