"""Per-kind isolation gate (owner decision 2026-11-12, D9): every Phase 2 data feature is armed ON ITS OWN.

Before: one global switch, UCT_AGENT_ISOLATED=1, armed EVERY model-isolated kind that UCT_AGENT_DATA_KINDS listed,
so arming one isolated feature (say RS leadership) silently armed every other listed one (catalysts, ratings,
breadth.current). After: a model-isolated kind is served only when ALL hold —

    UCT_AGENT_DATA=1  AND  kind in UCT_AGENT_DATA_KINDS  AND  UCT_AGENT_ISOLATED=1 (master)  AND
    kind in UCT_AGENT_ISOLATED_KINDS

— so the global switch can turn every isolated kind OFF at once but never arms one by itself, and the default
(unset/empty list) arms none. The purpose rule (isolated kinds are answer-only) is unchanged. Non-isolated kinds
(COT, history, quotes, ...) were already per kind through UCT_AGENT_DATA_KINDS (gateway.enabled_kinds/kind_enabled);
that is pinned here too, one kind at a time.

Every kind's source and validator are spies, so nothing here reads data, calls a provider or a model.
"""
from __future__ import annotations

import inspect

import pytest

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw

#: Synthetic stand-ins named after the pending Phase 2 isolated kinds (#1236 rs.leadership, #1256 catalysts.board),
#: so the "A never arms B" property is pinned for them before they land, with no dependency on those PRs.
PHASE2_ISOLATED = ("rs.leadership", "catalysts.board")


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for k in (gw.DATA_ENV, gw.SCAN_ENV, gw.ISOLATED_ENV, gw.ISOLATED_KINDS_ENV, gw.KINDS_ENV, "UCT_AGENT_KNOWLEDGE"):
        monkeypatch.delenv(k, raising=False)
    gw._reset_for_test(None)
    yield
    gw._reset_for_test(None)


def _spied():
    """The real registry's kinds (plus the synthetic Phase 2 isolated ones), each source/validator a spy."""
    gw._reset_for_test(None)
    real = gw.registry()
    ran: list = []

    def fn_for(name, freshness):
        def _f(params, ctx):
            ran.append(name)
            return env.make_envelope(name, params, status="ok", freshness=freshness, as_of="2026-10-30T20:00:00Z",
                                     source="spy", data={"v": 1})
        return _f

    r = gw.Registry()
    for name in real.names():
        k = real.get(name)
        r.register(gw.Kind(name=name, fn=fn_for(name, k.freshness), freshness=k.freshness, category=k.category,
                           owner=k.owner, max_symbols=k.max_symbols, model_isolated=k.model_isolated))
    for name in PHASE2_ISOLATED:
        if r.get(name) is None:
            r.register(gw.Kind(name=name, fn=fn_for(name, "periodic"), freshness="periodic", model_isolated=True))
    gw._reset_for_test(r)
    return r, ran


def _isolated(r):
    return [n for n in r.names() if r.get(n).model_isolated]


def _read(name, purpose="answer", turn=None):
    return gw.read(name, {}, user_id=1, turn_id=turn or f"t-{name}-{purpose}", purpose=purpose)


def _arm(monkeypatch, *, kinds, isolated_kinds=None, master="1"):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.SCAN_ENV, "1")
    monkeypatch.setenv("UCT_AGENT_KNOWLEDGE", "1")
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(kinds))
    if master is not None:
        monkeypatch.setenv(gw.ISOLATED_ENV, master)
    if isolated_kinds is not None:
        monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, isolated_kinds)


def test_non_vacuous_there_are_several_isolated_kinds():
    r, _ = _spied()
    iso = set(_isolated(r))
    assert {"breadth.current", "ratings", *PHASE2_ISOLATED} <= iso


# ── default off / the global switch alone arms nothing ───────────────────────────────────────────────────
@pytest.mark.parametrize("raw", [None, "", " ", " , ,", "*", "all", "1", "true", "ALL"])
def test_the_global_switch_alone_arms_NO_isolated_kind(monkeypatch, raw):
    """UCT_AGENT_ISOLATED=1 with every kind listed in UCT_AGENT_DATA_KINDS: still nothing isolated is served
    unless named one by one. No wildcard; a truthy word is not a kind name."""
    r, ran = _spied()
    _arm(monkeypatch, kinds=r.names(), isolated_kinds=raw)
    assert gw.isolated_kinds() == frozenset() or not (gw.isolated_kinds() & set(_isolated(r)))
    for name in _isolated(r):
        out = _read(name)
        assert out["status"] == "refused" and "not available to UCT Agent yet" in out["notes"][0], name
        assert not gw.isolated_enabled(name), name
    assert ran == [] and not gw._turns


def test_default_everything_unset_serves_no_isolated_kind(monkeypatch):
    r, ran = _spied()
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(r.names()))
    for name in _isolated(r):
        assert _read(name)["status"] == "refused", name
    assert ran == []


# ── each isolated kind is armed only by its own entry ────────────────────────────────────────────────────
def test_each_isolated_kind_is_armed_ONLY_by_its_own_entry(monkeypatch):
    r, ran = _spied()
    iso = _isolated(r)
    for a in iso:
        ran.clear()
        gw._reset_for_test(r)
        _arm(monkeypatch, kinds=r.names(), isolated_kinds=a)
        assert gw.isolated_kinds() == frozenset({a})
        out = _read(a, turn=f"a-{a}")
        assert out["status"] != "refused" and ran == [a], (a, out["notes"])
        for b in iso:
            if b == a:
                continue
            out = _read(b, turn=f"b-{a}-{b}")
            assert out["status"] == "refused" and "not available to UCT Agent yet" in out["notes"][0], (a, b)
            assert not gw.isolated_enabled(b), (a, b)
        assert ran == [a], f"listing {a} armed {ran}"


def test_two_entries_arm_exactly_those_two(monkeypatch):
    r, ran = _spied()
    _arm(monkeypatch, kinds=r.names(), isolated_kinds=" rs.leadership , ratings ")
    for name in _isolated(r):
        out = _read(name)
        assert (out["status"] != "refused") is (name in ("rs.leadership", "ratings")), (name, out["notes"])
    assert sorted(ran) == ["ratings", "rs.leadership"]


# ── every other gate still has to agree (the list narrows, never widens) ─────────────────────────────────
def test_listed_but_master_switch_off_is_refused(monkeypatch):
    r, ran = _spied()
    for master in (None, "", "0", "true"):
        monkeypatch.delenv(gw.ISOLATED_ENV, raising=False)
        _arm(monkeypatch, kinds=r.names(), isolated_kinds=",".join(_isolated(r)), master=master)
        for name in _isolated(r):
            assert _read(name, turn=f"m-{master}-{name}")["status"] == "refused", (master, name)
    assert ran == []


def test_listed_isolated_but_not_in_DATA_KINDS_is_refused(monkeypatch):
    r, ran = _spied()
    _arm(monkeypatch, kinds=["quote"], isolated_kinds=",".join(_isolated(r)))
    for name in _isolated(r):
        out = _read(name)
        assert out["status"] == "refused" and gw.KINDS_ENV in out["notes"][0], name
    assert ran == []


def test_the_isolated_list_means_nothing_while_the_gateway_is_off(monkeypatch):
    r, ran = _spied()
    _arm(monkeypatch, kinds=r.names(), isolated_kinds=",".join(_isolated(r)))
    monkeypatch.delenv(gw.DATA_ENV)
    assert gw.isolated_kinds() == frozenset()
    for name in _isolated(r):
        assert _read(name)["status"] == "refused"
    assert ran == []


def test_the_isolated_list_never_arms_a_non_isolated_kind(monkeypatch):
    r, ran = _spied()
    _arm(monkeypatch, kinds=["quote"], isolated_kinds="bars.daily,history.eventStudy,quote")
    assert _read("bars.daily")["status"] == "refused"
    assert "history.eventStudy" not in r.names() or _read("history.eventStudy")["status"] == "refused"
    assert ran == []


# ── purpose rule unchanged ───────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("purpose", [p for p in env.PURPOSES if p != "answer"])
def test_an_ARMED_isolated_kind_is_still_answer_only(monkeypatch, purpose):
    r, ran = _spied()
    _arm(monkeypatch, kinds=r.names(), isolated_kinds=",".join(_isolated(r)))
    for name in _isolated(r):
        out = _read(name, purpose=purpose)
        assert out["status"] == "refused" and "never used for research" in out["notes"][0], (name, purpose)
    assert ran == [] and not gw._turns


# ── non-isolated kinds (COT, history, ...) are already per kind via UCT_AGENT_DATA_KINDS ────────────────
def test_each_non_isolated_kind_is_armed_ONLY_by_its_own_DATA_KINDS_entry(monkeypatch):
    """gateway.enabled_kinds()/kind_enabled(): a kind not in UCT_AGENT_DATA_KINDS is refused before anything runs.
    Every isolation switch is fully ON here, so the only gate exercised is the kind's own list entry."""
    r, ran = _spied()
    plain = [n for n in r.names() if not r.get(n).model_isolated]
    assert len(plain) >= 2
    for a in plain:
        ran.clear()
        gw._reset_for_test(r)
        _arm(monkeypatch, kinds=[a], isolated_kinds=",".join(r.names()))
        out = _read(a, turn=f"p-{a}")
        assert ran == [a], (a, out["notes"])
        for b in plain:
            if b != a:
                out = _read(b, turn=f"q-{a}-{b}")
                assert out["status"] == "refused" and gw.KINDS_ENV in out["notes"][0], (a, b)
        assert ran == [a], f"listing {a} armed {ran}"


# ── the old global question cannot be asked any more ─────────────────────────────────────────────────────
def test_isolated_enabled_takes_the_kind_name():
    assert list(inspect.signature(gw.isolated_enabled).parameters) == ["name"]
    assert "isolated_enabled(kind)" in inspect.getsource(gw.read)


# ── the four Phase 2 features as they stand on master (COT #1185, history #1189 merged; RS #1236, catalysts #1256
#    pending, pinned here through their synthetic stand-ins) ─────────────────────────────────────────────────────
NON_ISOLATED_PHASE2 = ("cot.positioning", "history.eventStudy")


def test_COT_and_history_are_registered_non_isolated():
    gw._reset_for_test(None)
    r = gw.registry()
    for name in NON_ISOLATED_PHASE2:
        assert r.get(name) is not None, f"{name} is not registered"
        assert r.get(name).model_isolated is False, f"{name} became model-isolated: its activation steps change"


@pytest.mark.parametrize("name", NON_ISOLATED_PHASE2)
def test_COT_and_history_need_ONLY_their_DATA_KINDS_entry(monkeypatch, name):
    """No isolation setting at all (master unset, list unset): the kind's own UCT_AGENT_DATA_KINDS entry arms it,
    and arms nothing else; the isolation list can neither arm nor disarm it."""
    r, ran = _spied()
    _arm(monkeypatch, kinds=[name], master=None)
    assert _read(name, turn="only")["status"] != "refused" and ran == [name]
    for other in r.names():
        if other != name:
            assert _read(other, turn=f"o-{other}")["status"] == "refused", other
    assert ran == [name]
    # listing it in UCT_AGENT_ISOLATED_KINDS (and the master switch on) changes nothing for a non-isolated kind
    monkeypatch.setenv(gw.ISOLATED_ENV, "1")
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, ",".join(NON_ISOLATED_PHASE2))
    assert _read(name, turn="again")["status"] != "refused"
    monkeypatch.setenv(gw.KINDS_ENV, "quote")
    assert _read(name, turn="unlisted")["status"] == "refused"


@pytest.mark.parametrize("name", PHASE2_ISOLATED)
def test_RS_and_catalysts_need_BOTH_lists_and_the_master_switch(monkeypatch, name):
    r, ran = _spied()
    _arm(monkeypatch, kinds=[name], isolated_kinds=name)            # all three: served
    assert _read(name, turn="all")["status"] != "refused" and ran == [name]
    for env_name, value in ((gw.KINDS_ENV, "quote"), (gw.ISOLATED_KINDS_ENV, ""), (gw.ISOLATED_ENV, "0")):
        ran.clear()
        _arm(monkeypatch, kinds=[name], isolated_kinds=name)
        monkeypatch.setenv(env_name, value)                           # drop exactly one of the three
        assert _read(name, turn=f"drop-{env_name}")["status"] == "refused" and ran == [], env_name


# ── AUDIT #1271 (non-blocking ask): a kind name is matched EXACTLY — a wrong-case entry arms nothing ─────────
# (the surviving mutant was a case-folded match in isolated_kinds / enabled_kinds: "RS.Leadership" arming rs.leadership)
def _wrong_cases(name):
    return sorted({name.upper(), name.title(), name[0].upper() + name[1:]} - {name})


def test_a_WRONG_CASE_isolated_kinds_entry_arms_nothing(monkeypatch):
    r, ran = _spied()
    for name in _isolated(r):
        for wrong in _wrong_cases(name):
            ran.clear()
            gw._reset_for_test(r)
            _arm(monkeypatch, kinds=r.names(), isolated_kinds=wrong)
            assert not gw.isolated_enabled(name), (name, wrong)
            out = _read(name, turn=f"case-iso-{name}-{wrong}")
            assert out["status"] == "refused" and ran == [], (name, wrong)


def test_a_WRONG_CASE_data_kinds_entry_arms_nothing(monkeypatch):
    r, ran = _spied()
    for name in r.names():
        iso = r.get(name).model_isolated
        for wrong in _wrong_cases(name):
            ran.clear()
            gw._reset_for_test(r)
            _arm(monkeypatch, kinds=[wrong], isolated_kinds=name if iso else None)
            assert not gw.kind_enabled(name), (name, wrong)
            out = _read(name, turn=f"case-data-{name}-{wrong}")
            assert out["status"] == "refused" and ran == [], (name, wrong)
