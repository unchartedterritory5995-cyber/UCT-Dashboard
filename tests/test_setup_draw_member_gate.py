"""Setup drawings (remount, u_and_r, donchian_breakout): the dark flag and the member gate.

AUTO_STRUCTURES_G4_SETUPS_ENABLED off runs nothing and no payload carries `setup_draws`. On: an admin (the team
chart) and a member are both served all three setups -- a member's row needs its member-round literal equal to the
frozen round AND to the row's own stamp, the id in registry.DISPLAY_MEMBER_SET and the trusted tier.
donchian_breakout: owner released 2026-10-24 (literal 1), then WITHDRAWN the same day by recert B (its textbook fix
round failed; literal None, id kept in both sets). The lock tests re-arm it at round 1 and prove each lock still holds:
a literal of None, or its removal from either set, drops it; each lock is load-bearing on its own.
remount and u_and_r: WITHDRAWN from members 2026-10-24 (recertification C failed both on the strict textbook rubric;
literals None, ids kept in both sets so the team chart and a re-release by one literal still work).
"""
import ast
import json

import pytest

from api.routers import patterns as patterns_router
from api.services import auto_structures as AS
from api.services.pattern_engine import setup_draw
from api.services.pattern_engine.detectors import registry as REG

from tests.authclients import ADMIN, PAID_MEMBER
from tests.test_member_drawing_set import _get, _store
from tests.test_setup_draw_parity import EXPECTED, ROWS

FLAG = "AUTO_STRUCTURES_G4_SETUPS_ENABLED"
MEMBER_SETUPS: set = set()
#: withdrawn from members by recertification C (2026-10-24): id -> (member literal, the round the judges scored)
WITHDRAWN = {"draw:remount": ("MEMBER_REMOUNT_ROUND", 3), "draw:u_and_r": ("MEMBER_U_AND_R_ROUND", 2),
             "draw:donchian_breakout": ("MEMBER_DONCHIAN_BREAKOUT_ROUND", 1)}   # recert B, 2026-10-24
# the three round-1 (g4) setups; the round-2 ids that share SETUP_DRAW_IDS are railed in
# tests/test_setup_draw_r2_member_gate.py, round 3 in tests/test_setup_draw_r3_member_gate.py, the rectangle in
# tests/test_setup_draw_rectangle_member_gate.py
ALL_SETUPS = set(AS.SETUP_DRAW_IDS) - set(AS.SETUP_DRAW_R2_IDS) - set(AS.SETUP_DRAW_R3_IDS) - set(AS.SETUP_DRAW_RECT_IDS)


def _bars_at(i):
    """The fixture series up to as-of index i as the route's dicts; volume scaled x100 so the chart sits inside the
    judged liquidity frame (a constant volume scale changes no volume RATIO, so the drawing is the same)."""
    return [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": float(r[5]) * 100} for r in ROWS[:i + 1]]


def _first(setup):
    return min(int(k) for k, v in EXPECTED.items() if setup in v)


def _real_rows():
    """One REAL row per setup, each built by setup_draw_rows from the as-of bar where the fixture draws it."""
    out = []
    for key, pid, _name in AS._SETUP_DRAW_FUNCS:
        rows = [r for r in AS.setup_draw_rows("ZZZ", _bars_at(_first(key))) if r["pattern_id"] == pid]
        assert len(rows) == 1, key
        out.append(rows[0])
    return out


@pytest.fixture
def setups_on(monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    rows = _real_rows()
    calls = []
    monkeypatch.setattr(AS, "_shelf_bars", lambda sym: calls.append(sym) or _bars_at(_first("remount")))
    monkeypatch.setattr(AS, "setup_draw_rows", lambda sym, bars: [dict(r) for r in rows])
    AS._SETUP_CACHE.clear()
    yield calls
    AS._SETUP_CACHE.clear()


# -- the literals and the sets ------------------------------------------------------------------

def test_the_member_round_literals_are_written_in_source():
    """Literals ON PURPOSE (never a reference to setup_draw's constants, so a new drawing round cannot release
    itself): all three None -- remount and u_and_r withdrawn by recertification C, donchian by recert B."""
    tree = ast.parse(open(AS.__file__, encoding="utf-8").read())
    want = {"MEMBER_REMOUNT_ROUND": None, "MEMBER_U_AND_R_ROUND": None, "MEMBER_DONCHIAN_BREAKOUT_ROUND": None}
    for name, val in want.items():
        lits = [n for n in ast.walk(tree) if isinstance(n, ast.Assign)
                and any(getattr(t, "id", None) == name for t in n.targets)]
        assert len(lits) == 1 and isinstance(lits[0].value, ast.Constant) and lits[0].value.value == val, name
        assert val is None or type(lits[0].value.value) is int, name
    assert AS.MEMBER_REMOUNT_ROUND is None and setup_draw.REMOUNT_DRAW_ROUND == 3
    assert AS.MEMBER_U_AND_R_ROUND is None and setup_draw.U_AND_R_DRAW_ROUND == 2
    assert AS.MEMBER_DONCHIAN_BREAKOUT_ROUND is None and setup_draw.DONCHIAN_DRAW_ROUND == 1


def test_the_registry_sets():
    for pid in ALL_SETUPS:
        assert pid in REG.DISPLAY_MEMBER_SET and pid in REG.DISPLAY_TEAM_SET and pid in REG.DISPLAY_TRUSTED
        assert REG.display_policy(pid)["display_tier"] == "trusted"
    assert ALL_SETUPS == MEMBER_SETUPS | set(WITHDRAWN)        # each is released or withdrawn by its literal alone


# -- the flag ---------------------------------------------------------------------------------

def test_flag_off_runs_nothing(monkeypatch):
    monkeypatch.delenv(FLAG, raising=False)
    calls = []
    monkeypatch.setattr(AS, "_shelf_bars", lambda sym: calls.append(sym) or _bars_at(_first("remount")))
    AS._SETUP_CACHE.clear()
    assert AS.g4_setups_enabled() is False
    assert AS.setup_draws_for("ZZZ") is None and AS.setup_draws_for("ZZZ", member=True) is None
    assert calls == []
    monkeypatch.setenv(FLAG, "1")                              # control: the same stub DOES run when on
    assert AS.setup_draws_for("ZZZ") and calls
    AS._SETUP_CACHE.clear()


def _route_env(monkeypatch, flag_on):
    for k in ("AUTO_STRUCTURES_ENABLED", "AUTO_STRUCTURES_MEMBERS_ENABLED"):
        monkeypatch.setenv(k, "1")
    for k in ("AUTO_STRUCTURES_SHELF_ENABLED", "AUTO_STRUCTURES_SR_ENABLED", "AUTO_STRUCTURES_METRICS_ENABLED"):
        monkeypatch.delenv(k, raising=False)
    if flag_on:
        monkeypatch.setenv(FLAG, "1")
    else:
        monkeypatch.delenv(FLAG, raising=False)
    _store(monkeypatch, [])
    monkeypatch.setattr(AS, "structures_for", lambda sym: [])
    monkeypatch.setattr(AS, "drawn_for", lambda sym: None)
    # the real signature: the route asks deal_hold(sym, member=True) on the member path (fc6986f872)
    monkeypatch.setattr(AS, "deal_hold", lambda sym, member=False: None)


def test_flag_off_no_payload_carries_the_key(monkeypatch, setups_on):
    _route_env(monkeypatch, flag_on=False)
    for user in (ADMIN, PAID_MEMBER):
        body = _get(user).json()
        assert "setup_draws" not in body, user
    assert setups_on == []


def test_flag_on_the_team_chart_gets_all_three(monkeypatch, setups_on):
    _route_env(monkeypatch, flag_on=True)
    body = _get(ADMIN).json()
    assert {r["pattern_id"] for r in body["setup_draws"]} == ALL_SETUPS
    assert all(r["geometry"]["shape"] == "horizontal_line" for r in body["setup_draws"])


def test_flag_on_a_member_gets_only_the_released_setups(monkeypatch, setups_on):
    _route_env(monkeypatch, flag_on=True)
    body = _get(PAID_MEMBER).json()
    assert {r["pattern_id"] for r in body["setup_draws"]} == MEMBER_SETUPS
    assert "structures" not in body or not any(r["pattern_id"] in ALL_SETUPS for r in body["structures"])


def test_a_member_whose_door_is_off_gets_no_key(monkeypatch, setups_on):
    _route_env(monkeypatch, flag_on=True)
    monkeypatch.setenv("AUTO_STRUCTURES_MEMBERS_ENABLED", "0")
    assert "setup_draws" not in _get(PAID_MEMBER).json()


def test_only_daily_charts(monkeypatch, setups_on):
    _route_env(monkeypatch, flag_on=True)
    url = "/api/patterns/ZZZ?tf=W&confirmed_only=false&include_structures=true"
    for user in (ADMIN, PAID_MEMBER):
        assert "setup_draws" not in _get(user, url).json()


# -- member_rows, lock by lock --------------------------------------------------------------------

def _by_id(rows):
    return {r["pattern_id"]: r for r in rows}


def test_member_rows_serves_exactly_the_released_setups():
    rows = _real_rows()
    assert {r["pattern_id"] for r in AS.member_rows(rows)} == MEMBER_SETUPS


def test_donchian_release_lock_one_the_literal(monkeypatch):
    """Released (owner 2026-10-24): the real row is served to a member, and a literal of None -- or any round
    other than the frozen one -- drops it again while it stays in both sets."""
    monkeypatch.setattr(AS, "MEMBER_DONCHIAN_BREAKOUT_ROUND", 1)          # re-armed (withdrawn by recert B)
    d = _by_id(_real_rows())["draw:donchian_breakout"]
    assert d["display_tier"] == "trusted"
    assert AS.member_rows([d]) == [d]                                      # control: released, served
    monkeypatch.setattr(AS, "MEMBER_DONCHIAN_BREAKOUT_ROUND", None)
    assert AS.member_rows([d]) == []                                       # the withdraw lever
    monkeypatch.setattr(AS, "MEMBER_DONCHIAN_BREAKOUT_ROUND", True)
    assert AS.member_rows([d]) == []                                       # a bool is not the round
    monkeypatch.setattr(AS, "MEMBER_DONCHIAN_BREAKOUT_ROUND", 2)
    assert AS.member_rows([d]) == []                                       # a round nobody judged
    monkeypatch.setattr(AS, "MEMBER_DONCHIAN_BREAKOUT_ROUND", 1)
    assert AS.member_rows([d]) == [d]                                      # control: restored, served again


def test_donchian_release_lock_two_the_sets(monkeypatch):
    """Released, with the literal at its round: removing the id from the member set, or from the team set (which
    IS the trusted set, so the row is no longer stamped trusted), drops it."""
    monkeypatch.setattr(AS, "MEMBER_DONCHIAN_BREAKOUT_ROUND", 1)          # re-armed (withdrawn by recert B)
    d = _by_id(_real_rows())["draw:donchian_breakout"]
    assert AS.member_rows([d]) == [d]                                      # control: released, served
    monkeypatch.setattr(REG, "DISPLAY_MEMBER_SET", frozenset(REG.DISPLAY_MEMBER_SET - {d["pattern_id"]}))
    assert AS.member_rows([d]) == []                                       # out of the member set
    monkeypatch.undo()
    monkeypatch.setattr(AS, "MEMBER_DONCHIAN_BREAKOUT_ROUND", 1)
    assert AS.member_rows([d]) == [d]                                      # control: back in, served
    smaller = frozenset(REG.DISPLAY_TEAM_SET - {d["pattern_id"]})
    monkeypatch.setattr(REG, "DISPLAY_TEAM_SET", smaller)
    monkeypatch.setattr(REG, "DISPLAY_TRUSTED", smaller)
    rebuilt = _by_id(_real_rows())["draw:donchian_breakout"]               # the row as the route builds it now
    assert rebuilt["display_tier"] == "experimental"
    assert AS.member_rows([rebuilt]) == []                                 # out of the team set: not trusted
    assert AS.member_rows([{**d, "display_tier": "experimental"}]) == []   # the tier alone drops it


def test_a_withdrawn_setup_is_not_served_to_members_until_its_literal_is_set_back(monkeypatch):
    """Recertification C (2026-10-24) withdrew remount and u_and_r: with the literal None a member gets neither
    (the real rows, everything else intact); setting the literal back to the judged round serves each again, which
    proves the literal is the only thing holding it (a re-release needs a new passed blind round)."""
    rows = _by_id(_real_rows())
    for pid, (lit, rnd) in WITHDRAWN.items():
        assert getattr(AS, lit) is None, lit
        assert rows[pid]["display_tier"] == "trusted" and pid in REG.DISPLAY_MEMBER_SET
        assert AS.member_rows([rows[pid]]) == [], pid                      # withdrawn: not served
        monkeypatch.setattr(AS, lit, rnd)
        assert AS.member_rows([rows[pid]]) == [rows[pid]], pid             # control: the literal is the lever
        monkeypatch.undo()


@pytest.mark.parametrize("pid,lit", [("draw:remount", "MEMBER_REMOUNT_ROUND"), ("draw:u_and_r", "MEMBER_U_AND_R_ROUND"),
                                     ("draw:donchian_breakout", "MEMBER_DONCHIAN_BREAKOUT_ROUND")])
def test_a_released_setup_is_withdrawn_by_its_literal_or_a_wrong_round(monkeypatch, pid, lit):
    if pid in WITHDRAWN:                    # exercise every lock as if released (the withdrawn ones are re-armed here)
        monkeypatch.setattr(AS, lit, WITHDRAWN[pid][1])
    row = _by_id(_real_rows())[pid]
    assert AS.member_rows([row]) == [row]
    rnd = getattr(AS, lit)
    monkeypatch.setattr(AS, lit, None)
    assert AS.member_rows([row]) == []                                     # the withdraw lever
    monkeypatch.setattr(AS, lit, rnd + 1)
    assert AS.member_rows([row]) == []                                     # a round nobody judged
    monkeypatch.setattr(AS, lit, rnd)
    stale = json.loads(json.dumps(row))
    stale["geometry"]["extras"]["draw_round"] = rnd + 1
    assert AS.member_rows([stale]) == []                                   # the row's own stamp disagrees
    stale["geometry"]["extras"]["draw_setup"]["draw_round"] = rnd + 1
    assert AS.member_rows([stale]) == []                                   # a whole row of an unjudged round
    bad = json.loads(json.dumps(row))
    bad["geometry"]["extras"]["draw_setup"]["level"] = float("nan")
    assert AS.member_rows([bad]) == []                                     # malformed drawing
    untrusted = {**row, "display_tier": "experimental"}
    assert AS.member_rows([untrusted]) == []                               # tier
    monkeypatch.setattr(REG, "DISPLAY_MEMBER_SET", frozenset(REG.DISPLAY_MEMBER_SET - {pid}))
    assert AS.member_rows([row]) == []                                     # not in the member set


# -- the rows ---------------------------------------------------------------------------------

def test_a_row_carries_the_judged_line_exactly():
    for key, pid, _ in AS._SETUP_DRAW_FUNCS:
        i = _first(key)
        want = EXPECTED[str(i)][key]
        row = _by_id(AS.setup_draw_rows("ZZZ", _bars_at(i)))[pid]
        # volume scaled x100 changes only the absolute volumes, never the line
        assert row["geometry"]["anchors"] == want["det"]["geometry"]["anchors"]
        assert row["geometry"]["shape"] == want["det"]["geometry"]["shape"]
        assert row["geometry"]["extras"]["draw_round"] == setup_draw.DRAW_ROUNDS[key]
        assert row["levels"] == {"entry": want["level"]}


def test_outside_the_judged_frame_there_is_no_drawing():
    i = _first("remount")
    thin = [{**b, "v": 1.0} for b in _bars_at(i)]                          # dollar volume far under $20M
    assert AS.setup_draw_rows("ZZZ", thin) == []
    assert AS.setup_draw_rows("ZZZ", _bars_at(i)[-200:]) == []             # under 261 bars


def test_one_answer_per_ticker_and_completed_session(monkeypatch, setups_on):
    built = []
    monkeypatch.setattr(AS, "setup_draw_rows", lambda sym, bars: built.append(sym) or [])
    AS._SETUP_CACHE.clear()
    assert AS.setup_draws_for("ZZZ") == [] and AS.setup_draws_for("ZZZ", member=True) == []
    assert built == ["ZZZ"]
