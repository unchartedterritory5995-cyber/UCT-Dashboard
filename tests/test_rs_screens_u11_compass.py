"""RS screens unit U11: the five screens as two Compass tools, voice AND chat.

`rs_screen` (a screen's list) and `rs_screen_check` (one stock against the five) are
registered in both Compass registries and both delegate to ONE implementation,
`api/services/rs_screens_service.py`: voice in `voice_tool_impls.py`, chat in
`coach_chat_tools.py` through the voice registry.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
either surface showing a tool while RS_COMPASS_TOOLS_ENABLED is off, while the two
tools' own RS_SCREEN_TOOLS_ENABLED is off, or while the RS screens are off (or on for
admins only); the two surfaces exposing different names, texts or schemas; a tool
text that does not say the lists are watchlists and not advice, or does not ask for the
"Ratings as of" date; a tool text that names a screen in words that are not the
screen's own; a call that does not reach the service, loses its arguments or its user;
a user the screens are not on for being answered with a list.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from api.services import rs_screens_service as svc
from api.services.screener import rs_screens
from tests import rs_screens_e2e_universe as market
from tests import test_rs_screens_u6_e2e as e2e

ROOT = Path(__file__).resolve().parent.parent
NAMES = ("rs_screen", "rs_screen_check")
RS_GATE = "RS_COMPASS_TOOLS_ENABLED"
OWN_GATE = "RS_SCREEN_TOOLS_ENABLED"
SCREENS_GATE = "RS_SCREENS_ENABLED"
USER = {"id": "u1", "role": "member", "plan": "pro"}


def _registries():
    from api.services import voice_agents, voice_tool_impls  # noqa: F401  (registers)
    from api.services import voice_tools as vt
    from api.services.journal_two import coach_chat_tools as cct
    return vt, cct, voice_agents


def _gates(monkeypatch, *, rs, screens, own=True):
    for name, on in ((RS_GATE, rs), (OWN_GATE, own), (SCREENS_GATE, screens)):
        if on:
            monkeypatch.setenv(name, "1")
        else:
            monkeypatch.delenv(name, raising=False)


@pytest.fixture
def both_on(monkeypatch):
    _gates(monkeypatch, rs=True, screens=True)


def _voice_names(vt) -> set:
    return {t["name"] for t in vt.get_schema_for_context("compass")}


# ───────────────────────── three gates, both surfaces ─────────────────────────

@pytest.mark.parametrize("rs,screens,own", [
    (False, False, True), (True, False, True), (False, True, True), (True, True, True),
    (True, True, False), (False, True, False), (True, False, False),
])
def test_both_surfaces_expose_both_tools_only_when_every_gate_is_on(monkeypatch, rs, screens, own):
    _gates(monkeypatch, rs=rs, screens=screens, own=own)
    vt, cct, _ = _registries()
    shown = rs and screens and own
    voice = _voice_names(vt)
    for name in NAMES:
        assert (name in voice) is shown, (name, rs, screens, own)
        assert (name in cct.TOOLS) is shown and (cct.TOOLS.get(name) is not None) is shown
        assert (name in {s["name"] for s in cct.TOOLS.values()}) is shown
        assert (name in dict(cct.TOOLS)) is shown
        if not shown:
            with pytest.raises(KeyError):
                vt.dispatch(name, {"ticker": "NVDA"} if name == "rs_screen_check" else {"screen": "leaders"},
                            user=USER)
            with pytest.raises(KeyError):
                cct.TOOLS[name]
    # controls: neither the screens' gate nor the two tools' own switch moves the RS
    # reading tools, and no gate moves an ungated tool
    assert ("get_rs_reading" in voice) is rs and ("explain_rs" in cct.TOOLS) is rs
    assert "find_patterns_on_ticker" in voice and "find_patterns_on_ticker" in cct.TOOLS


@pytest.mark.parametrize("value", ["0", "", "true", "yes", "on", "2"])
def test_only_the_literal_one_arms_the_rs_compass_gate(monkeypatch, value):
    _gates(monkeypatch, rs=True, screens=True)
    vt, cct, _ = _registries()
    assert set(NAMES) <= _voice_names(vt), "control: on with 1"
    monkeypatch.setenv(RS_GATE, value)
    assert not set(NAMES) & _voice_names(vt) and not [n for n in NAMES if n in cct.TOOLS]


@pytest.mark.parametrize("value", ["0", "", "true", "yes", "on", "2", "admin"])
def test_only_the_literal_one_arms_the_two_tools_own_switch(monkeypatch, value):
    """RS_COMPASS_TOOLS_ENABLED was already armed in production when the screens merged, so
    the two screens tools have a switch of their own: releasing the screens does not
    release these answers. The RS reading tools do not read it."""
    _gates(monkeypatch, rs=True, screens=True)
    vt, cct, _ = _registries()
    assert set(NAMES) <= _voice_names(vt), "control: on with 1"
    monkeypatch.setenv(OWN_GATE, value)
    assert not set(NAMES) & _voice_names(vt) and not [n for n in NAMES if n in cct.TOOLS]
    assert "get_rs_reading" in _voice_names(vt) and "explain_rs" in cct.TOOLS
    monkeypatch.delenv(OWN_GATE)
    assert not set(NAMES) & _voice_names(vt) and not [n for n in NAMES if n in cct.TOOLS], "unset is off"


def test_the_owner_preview_shows_the_tools_to_no_one(monkeypatch):
    """Under RS_SCREENS_ENABLED=admin the screens are shown to admins only. A registry
    gate has no user and answers as a member, so the two tools are absent from both
    surfaces for everyone, the owner included, whatever the other two switches say."""
    _gates(monkeypatch, rs=True, screens=True)
    vt, cct, _ = _registries()
    assert set(NAMES) <= _voice_names(vt), "control: on for everyone"
    monkeypatch.setenv(SCREENS_GATE, "admin")
    assert not set(NAMES) & _voice_names(vt) and not [n for n in NAMES if n in cct.TOOLS]
    for name, args in (("rs_screen", {"screen": "leaders"}), ("rs_screen_check", {"ticker": "NVDA"})):
        with pytest.raises(KeyError):
            vt.dispatch(name, args, user={"id": "a1", "role": "admin", "plan": "pro"})


def test_the_registry_gate_is_the_service_s_own_answer(both_on, monkeypatch):
    """One gate for the screens: the service's. Unit U10 turns it per user by changing
    one line there, and both registries follow with no edit here."""
    vt, cct, _ = _registries()
    asked = []
    monkeypatch.setattr(svc, "_screens_on", lambda user: asked.append(user) or False)
    assert not set(NAMES) & _voice_names(vt) and not [n for n in NAMES if n in cct.TOOLS]
    assert asked and set(map(repr, asked)) == {"None"}, "a registry gate has no user: it asks as a member"
    monkeypatch.setattr(svc, "_screens_on", lambda user: True)
    assert set(NAMES) <= _voice_names(vt) and all(n in cct.TOOLS for n in NAMES)

    def broken(user):
        raise RuntimeError("the gate could not be read")

    monkeypatch.setattr(svc, "_screens_on", broken)
    assert svc.available(None) is False, "an unreadable gate is off"
    assert not set(NAMES) & _voice_names(vt) and not [n for n in NAMES if n in cct.TOOLS]


def test_voice_and_chat_expose_the_same_names_texts_and_schemas(both_on):
    vt, cct, voice_agents = _registries()
    voice = {t["name"]: t for t in vt.get_schema_for_context("compass") if t["name"] in NAMES}
    chat = {n: cct.TOOLS[n] for n in NAMES}
    assert set(voice) == set(chat) == set(NAMES)
    for name in NAMES:
        assert name in voice_agents._compass_tool_union() and name in voice_agents._COMPASS_CORE_TOOLS
        assert name in voice_agents._compass_active_tools()
        assert voice[name]["description"] == chat[name]["description"]
        assert voice[name]["parameters"]["properties"] == chat[name]["input_schema"]["properties"]
        assert "_voice_delegate" in chat[name]["executor"].__qualname__
        assert chat[name]["requires_confirm"] is False
        assert vt._REGISTRY[name]["wants_user"] is True
    assert voice["rs_screen"]["description"] == svc.screen_description()
    assert voice["rs_screen_check"]["description"] == svc.check_description()
    assert chat["rs_screen"]["input_schema"]["required"] == ["screen"]
    assert chat["rs_screen_check"]["input_schema"]["required"] == ["ticker"]
    props = chat["rs_screen"]["input_schema"]["properties"]
    assert set(props) == {"screen", "limit", "options"} and props["screen"]["enum"] == list(svc.SCREENS)
    assert set(chat["rs_screen_check"]["input_schema"]["properties"]) == {"ticker"}
    assert json.loads(json.dumps(voice)) == voice, "a schema a model provider can be sent"


# ───────────────────────── what the tools say about themselves ─────────────────────────

def test_the_texts_say_watchlist_not_advice_and_ask_for_the_ratings_date():
    for text in (svc.screen_description(), svc.check_description()):
        assert "watchlists to study, not advice" in text
        assert "never" in text and "recommendation or a trade signal" in text
        assert "'Ratings as of' date" in text and "`note`" in text
        assert "—" not in text, "no em dash in member-facing copy"
    assert "NOT RSI" in svc.screen_description()
    assert "One ticker per call" in svc.check_description()


def test_every_screen_is_named_in_its_own_words():
    """The name, the one-line description and the search words are read off the screen's
    definition (`screener.rs_screens`), so a screen renamed there is renamed here."""
    text, check = svc.screen_description(), svc.check_description()
    defs = {s["id"]: s for s in rs_screens.screens()}
    assert len(defs) == len(svc.SCREENS) == 5
    for screen in svc.SCREENS:
        d = defs[svc.starter_id(screen)]
        assert f"'{screen}' is {d['name']}" in text and d["description"] in text, screen
        assert d["name"] in check, screen
        for alias in d.get("aliases") or []:
            assert alias.lower() in text.lower(), alias
    assert "RSNHBP" in text
    # the example choices are options the screens really offer
    labels = {o["label"] for d in defs.values() for c in d["controls"] for o in c["options"]}
    examples = text.split("(for example ")[1].split(")")[0]
    quoted = examples.split("'")[1::2]
    assert len(quoted) == 5 and set(quoted) <= labels, quoted


def test_a_renamed_screen_is_renamed_in_the_text(monkeypatch):
    real = rs_screens.leaders
    monkeypatch.setattr(rs_screens, "leaders", lambda: {**real(), "name": "Strongest stocks",
                                                        "description": "A new one-line description"})
    assert "'leaders' is Strongest stocks: A new one-line description" in svc.screen_description()
    assert "Strongest stocks" in svc.check_description() and "UCT RS Leaders" not in svc.check_description()


def test_the_texts_are_built_with_the_screens_off(monkeypatch):
    """Both registries build the text at import, on a pod where every flag is off."""
    _gates(monkeypatch, rs=False, screens=False)
    assert "UCT RS Leaders" in svc.screen_description() and "UCT RS Leaders" in svc.check_description()


# ───────────────────────── a call reaches the service ─────────────────────────

def test_each_surface_hands_its_arguments_and_its_user_to_the_service(both_on, monkeypatch):
    vt, cct, _ = _registries()
    calls = []
    monkeypatch.setattr(svc, "list_screen", lambda screen, **kw: calls.append(("list", screen, kw)) or {"ok": True})
    monkeypatch.setattr(svc, "check_ticker", lambda ticker, **kw: calls.append(("check", ticker, kw)) or {"ok": True})
    vt.dispatch("rs_screen", {"screen": "new_highs", "limit": 5, "options": "today, 90"}, user=USER)
    vt.dispatch("rs_screen", {"screen": "leaders"}, user=USER)
    vt.dispatch("rs_screen_check", {"ticker": "nvda"}, user=USER)
    cct.TOOLS["rs_screen"]["executor"](user_id="u7", account_id=None,
                                       args={"screen": "before_price", "options": "this month"})
    cct.TOOLS["rs_screen_check"]["executor"](user_id="u7", account_id=3, args={"ticker": "AAPL"})
    assert calls == [
        ("list", "new_highs", {"user": USER, "limit": 5, "option_ids": "today, 90"}),
        ("list", "leaders", {"user": USER, "limit": 15, "option_ids": None}),
        ("check", "nvda", {"user": USER}),
        ("list", "before_price", {"user": {"id": "u7"}, "limit": 15, "option_ids": "this month"}),
        ("check", "AAPL", {"user": {"id": "u7"}}),
    ]
    assert svc.DEFAULT_LIMIT == 15


def test_a_user_the_screens_are_not_on_for_is_told_not_available(both_on, monkeypatch):
    """After unit U10 the screens can be on for some users only. The registry gate asks
    as a member; the call asks for the caller, and answers "not available"."""
    vt, cct, _ = _registries()
    monkeypatch.setattr(svc, "_screens_on", lambda user: not user)
    off = {"ok": False, "reason": "not available"}
    assert vt.dispatch("rs_screen", {"screen": "leaders"}, user=USER) == off
    assert vt.dispatch("rs_screen_check", {"ticker": "NVDA"}, user=USER) == off
    assert cct.TOOLS["rs_screen"]["executor"](user_id="u1", account_id=None, args={"screen": "leaders"}) == off


# ───────────────────────── a round trip over the built application ─────────────────────────

@pytest.fixture(scope="module")
def app(tmp_path_factory):
    """The application with the screens on, built once: the e2e suite's own build."""
    mp = pytest.MonkeyPatch()
    try:
        built = e2e._build(mp, tmp_path_factory.mktemp("rs_u11_compass"), screens_on=True)
        e2e._client(mp)
        mp.setenv(RS_GATE, "1")
        mp.setenv(OWN_GATE, "1")
        from api.services import theme_db
        mp.setattr(theme_db, "get_themes_for_ticker", lambda sym: [])
        yield built
    finally:
        mp.undo()
        e2e._forget_caches()


def test_a_voice_round_trip_is_the_service_s_answer(app):
    vt, _cct, _ = _registries()
    out = vt.dispatch("rs_screen", {"screen": "leaders", "limit": 3}, user=USER)
    assert out == svc.list_screen("leaders", user=USER, limit=3)
    assert out["ok"] and [r["ticker"] for r in out["rows"]] == ["RISE5", "RISE4", "RUN1"]
    assert out["note"].startswith("Ratings as of ") and out["asof"] == market.SESSION
    assert "watchlists to study, not advice" in out["note"]
    check = vt.dispatch("rs_screen_check", {"ticker": "deal"}, user=USER)
    assert check == svc.check_ticker("DEAL", user=USER)
    assert check["on"] == [] and check["screens"][0]["misses"]["key"] == "rs_rank"
    assert check["note"].startswith("Ratings as of ")
    json.dumps(out), json.dumps(check)


def test_a_chat_round_trip_is_the_service_s_answer(app):
    _vt, cct, _ = _registries()
    run = cct.TOOLS["rs_screen"]["executor"]
    out = run(user_id="u1", account_id=None, args={"screen": "new_highs", "options": "today", "limit": 4})
    assert out == svc.list_screen("new_highs", user={"id": "u1"}, limit=4, option_ids="today")
    assert out["ok"] and out["chosen"]["when"] == "today" and 1 <= len(out["rows"]) <= 4
    assert out["note"].startswith("Ratings as of ")
    refused = run(user_id="u1", account_id=None, args={"screen": "new_highs", "options": "tomorrow"})
    assert refused["ok"] is False and [c["control"] for c in refused["controls"]] == ["when", "min", "down"]
    check = cct.TOOLS["rs_screen_check"]["executor"](user_id="u1", account_id=None, args={"ticker": "RISE5"})
    assert check == svc.check_ticker("RISE5", user={"id": "u1"})
    assert check["on"][0] == "UCT RS Leaders" and check["screens"][0]["place"] == 1


# ───────────────────────── the ledger ─────────────────────────

def test_the_ledger_says_what_the_three_gates_show():
    flags = json.loads((ROOT / "docs" / "feature_flags.json").read_text(encoding="utf-8"))["flags"]
    note = flags[RS_GATE]["note"]
    for word in (*NAMES, SCREENS_GATE, OWN_GATE, "rs_screens_service", "tests/test_rs_screens_u11_compass.py"):
        assert word in note, word
    # RS_COMPASS_TOOLS_ENABLED was read live as 1 on web (2026-11-14); the two screens tools
    # are held back by their own switch, which is the one that waits for the report card
    assert flags[RS_GATE]["status"] == "armed" and "2026-11-14" in note
    own = flags[OWN_GATE]
    # Pin moved 2026-11-15: this said the own switch is dark, waiting for the report card. The
    # owner armed it that day WITHOUT the run ("compass should be able to access everything
    # always"), and the row has to say both: armed, and that the report card was not run.
    assert own["status"] == "armed" and own["where"] == ["web"]
    assert own["note"].startswith("ARMED on web on the owner's word, WITHOUT the report-card run")
    assert "The report card has NOT been run with them on" in own["note"]
    for word in (*NAMES, RS_GATE, SCREENS_GATE, "_rs_screen_tools_gate", "report card",
                 "R1-12-rs-leaders-today", "tests/test_rs_screens_u11_compass.py"):
        assert word.lower() in own["note"].lower(), word
    screens = flags[SCREENS_GATE]["note"]
    assert RS_GATE in screens and OWN_GATE in screens
    assert "under admin the owner has them" not in screens
    assert "absent for everyone under admin" in screens
