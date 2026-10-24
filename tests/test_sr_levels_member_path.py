"""Textbook support / resistance (drawing round r2): the PRODUCTION path and its gates.

1. Parity through the serving adapter: on every fixture chart in the judged frame, auto_structures.sr_compute (the
   {t,o,h,l,c,v} dicts the route reads) gives the frozen lab's answer, trimmed to the member payload.
2. Gates: AUTO_STRUCTURES_SR_ENABLED off runs nothing and the route payload is byte-identical; a member gets the
   layer only while MEMBER_SR_ROUND is a literal equal to the frozen round (fail closed). The literal is None since
   2026-10-24 (WITHDRAWN: the strict recertification failed r2 and both fix rounds), so every member-door test below
   runs with the round patched back in (`_round_released`) and proves the door still works for the day a new passed
   round re-releases it; the source literal itself is railed to None; a pending
   acquisition gets nothing; daily charts only; the judged frame only; only bars up to the last COMPLETED session;
   patterns win against the prices the response's own drawings put on the chart; one answer per (ticker, last
   completed session, served prices); any failure draws nothing; /api/auth/me carries the one client signal.
"""
import ast
import json

import pytest

from api.services import auto_structures as AS
from api.services import barspack, deal_status
from api.services.pattern_engine import sr_levels as S
from tests.authclients import ADMIN, PAID_MEMBER
from tests.test_member_drawing_set import URL, _flags, _get, _structures, calls  # noqa: F401  (fixture)
from tests.test_sr_levels_parity import cases


def _dicts(bars):
    return [{"t": int(b[0]), "o": float(b[1]), "h": float(b[2]), "l": float(b[3]), "c": float(b[4]),
             "v": float(b[5] or 0)} for b in bars]


def _drawing_case():
    return next(c for c in cases() if c["expect"]["zones"] and len(c["bars"]) >= AS.SR_MIN_BARS
                and AS.sr_in_frame(_dicts(c["bars"])) and not c["pattern_pivots"])


@pytest.fixture(autouse=True)
def _round_released(monkeypatch):
    """The member door as it behaves with a released round: the literal patched to the frozen round. The withdrawn
    state itself is railed by test_the_member_round_literal_is_withdrawn_in_source."""
    monkeypatch.setattr(AS, "MEMBER_SR_ROUND", S.SR_ROUND)


@pytest.fixture
def sr_on(monkeypatch):
    monkeypatch.setenv("AUTO_STRUCTURES_SR_ENABLED", "1")
    AS._SR_CACHE.clear()
    yield
    AS._SR_CACHE.clear()


@pytest.fixture
def bars_of(monkeypatch):
    """The completed-session window the layer reads: the fixture's drawing chart, recorded per call."""
    c = _drawing_case()
    seen = []
    monkeypatch.setattr(AS, "_shelf_bars", lambda sym: seen.append(sym) or _dicts(c["bars"]))
    return c, seen


# ---------------------------------------------------------------- 1. parity through the adapter
def test_the_serving_adapter_reproduces_the_lab_on_every_case_in_frame():
    n = 0
    for c in cases():
        bars = _dicts(c["bars"])
        if not AS.sr_in_frame(bars):
            continue
        got = AS.sr_compute(bars, c["pattern_pivots"])
        want = AS._sr_payload({**c["expect"], "round": S.SR_ROUND})
        assert json.dumps(got, sort_keys=True) == json.dumps(want, sort_keys=True), c["id"]
        n += 1
    assert n >= 240     # the judged frame holds nearly every fixture chart (the pinned controls included)


def test_the_member_payload_carries_exactly_the_judged_fields():
    c = _drawing_case()
    p = AS.sr_compute(_dicts(c["bars"]), ())
    assert set(p) == {"round", "asof_t", "atr", "zones", "trendlines"} and p["round"] == "r2"
    assert set(p["zones"][0]) == {"role", "bot", "top", "label", "touches", "first_t", "last_t", "broken_retested"}
    assert p["zones"][0]["label"].startswith(("Support ", "Resistance "))
    assert p["asof_t"] == int(c["bars"][-1][0])


# ---------------------------------------------------------------- 2. gates
def test_the_member_round_literal_is_withdrawn_in_source(monkeypatch, sr_on, bars_of):
    """WITHDRAWN 2026-10-24: the literal in source is None (never a reference to sr_levels.SR_ROUND, so a drawing
    round cannot release itself), and with it a member gets no layer while the team keeps it under the flag."""
    src = open(AS.__file__, encoding="utf-8").read()
    lits = [n for n in ast.walk(ast.parse(src)) if isinstance(n, ast.Assign)
            and any(getattr(t, "id", None) == "MEMBER_SR_ROUND" for t in n.targets)]
    assert len(lits) == 1 and isinstance(lits[0].value, ast.Constant) and lits[0].value.value is None
    assert S.SR_ROUND == "r2"
    monkeypatch.setattr(AS, "MEMBER_SR_ROUND", lits[0].value.value)     # the source value, not the patched one
    monkeypatch.setattr(AS, "shelf_member_facts", lambda sym, b: ([], []))
    assert AS.levels_sr_available(member=True) is False
    assert AS.levels_sr_for("ZZZ", member=True, served=[]) is None
    assert AS.levels_sr_available(member=False) is True and AS.levels_sr_for("ZZZ") is not None


def test_flag_off_runs_nothing(monkeypatch, bars_of):
    _c, seen = bars_of
    computed = []
    monkeypatch.setattr(AS, "sr_compute", lambda b, p: computed.append(1) or {"x": 1})
    monkeypatch.setattr(AS, "shelf_member_facts", lambda sym, b: computed.append(2) or ([], []))
    for off in (None, "0", "false", ""):
        if off is None:
            monkeypatch.delenv("AUTO_STRUCTURES_SR_ENABLED", raising=False)
        else:
            monkeypatch.setenv("AUTO_STRUCTURES_SR_ENABLED", off)
        AS._SR_CACHE.clear()
        assert AS.sr_enabled() is False
        assert AS.levels_sr_for("ZZZ") is None
        assert AS.levels_sr_for("ZZZ", member=True, served=[]) is None
        assert AS.levels_sr_available(member=True) is False and AS.levels_sr_available(member=False) is False
    assert seen == [] and computed == []
    monkeypatch.setenv("AUTO_STRUCTURES_SR_ENABLED", "1")       # control: the same stubs DO run when on
    AS._SR_CACHE.clear()
    assert AS.levels_sr_for("ZZZ", member=True, served=[]) == {"x": 1} and seen and computed


@pytest.mark.parametrize("rnd", [None, True, 2, "r1", "r3", "R2", " r2"])
def test_a_member_gets_nothing_unless_the_literal_is_the_frozen_round(monkeypatch, sr_on, bars_of, rnd):
    monkeypatch.setattr(AS, "MEMBER_SR_ROUND", rnd)
    assert AS._member_sr_ok() is False
    assert AS.levels_sr_available(member=True) is False
    assert AS.levels_sr_for("ZZZ", member=True, served=[]) is None
    # the team path keeps the layer under the flag alone
    monkeypatch.setattr(AS, "shelf_member_facts", lambda sym, b: ([], []))
    assert AS.levels_sr_for("ZZZ") is not None
    assert AS.levels_sr_available(member=False) is True


def test_the_frozen_round_moving_withholds_the_member_layer(monkeypatch, sr_on, bars_of):
    """A new drawing round in sr_levels without a hand-edited literal: members stop getting it (fail closed)."""
    assert AS.levels_sr_for("ZZZ", member=True, served=[]) is not None
    AS._SR_CACHE.clear()
    monkeypatch.setattr(S, "SR_ROUND", "r3")
    assert AS.levels_sr_for("ZZZ", member=True, served=[]) is None


def test_outside_the_judged_frame_nothing_is_drawn_and_the_block_says_why(monkeypatch, sr_on):
    c = _drawing_case()
    base = _dicts(c["bars"])
    computed = []
    real = AS.sr_compute
    monkeypatch.setattr(AS, "sr_compute", lambda b, p: computed.append(1) or real(b, p))
    for bars in (base[-(AS.SR_MIN_BARS - 1):],
                 base[:-1] + [{**base[-1], "c": 4.99}],
                 base[:-1] + [{**base[-1], "v": (AS.SR_MIN_DOLLAR_VOLUME / base[-1]["c"]) * 0.99}]):
        AS._SR_CACHE.clear()
        monkeypatch.setattr(AS, "_shelf_bars", lambda sym, b=bars: b)
        p = AS.levels_sr_for("ZZZ", member=True, served=[])
        assert p == {"round": "r2", "asof_t": bars[-1]["t"], "atr": None, "zones": [], "trendlines": [],
                     "withheld": "out_of_frame"}
    assert computed == []                                          # nothing was drawn out of frame
    AS._SR_CACHE.clear()
    monkeypatch.setattr(AS, "_shelf_bars", lambda sym: base)      # control
    p = AS.levels_sr_for("ZZZ", member=True, served=[])
    assert p["zones"] and "withheld" not in p


def test_a_history_too_short_to_draw_says_so(monkeypatch, sr_on):
    c = _drawing_case()
    monkeypatch.setattr(AS, "_shelf_bars", lambda sym: _dicts(c["bars"]))
    monkeypatch.setattr(S, "draw", lambda rows, i=None, pp=(): None)
    p = AS.levels_sr_for("ZZZ", member=True, served=[])
    assert p["withheld"] == "short_history" and p["zones"] == [] and p["trendlines"] == []


def test_no_bars_means_no_key(monkeypatch, sr_on):
    monkeypatch.setattr(AS, "_shelf_bars", lambda sym: None)
    assert AS.levels_sr_for("ZZZ", member=True, served=[]) is None
    monkeypatch.setattr(AS, "_shelf_bars", lambda sym: [])
    assert AS.levels_sr_for("ZZZ") is None


def test_only_bars_up_to_the_last_completed_session_are_read(monkeypatch, sr_on):
    """A forming bar after the last completed session never reaches the drawing; an unknown clock draws nothing."""
    from api.services import bars_sqlite
    c = _drawing_case()
    rows = [tuple(b) for b in c["bars"]]
    done = rows[-1][0]
    fake_next = (done + 1, rows[-1][4], rows[-1][4] * 1.3, rows[-1][4] * 0.7, rows[-1][4] * 1.25, 1e9)
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda sym, tf, n: rows + [fake_next])
    monkeypatch.setattr(barspack, "_last_complete_session_ymd", lambda now=None: done)
    p = AS.levels_sr_for("ZZZ", member=True, served=[])
    assert p is not None and p["asof_t"] == done
    assert json.dumps(p, sort_keys=True) == json.dumps(AS.sr_compute(_dicts(c["bars"]), ()), sort_keys=True)
    AS._SR_CACHE.clear()
    monkeypatch.setattr(barspack, "_last_complete_session_ymd", lambda now=None: None)
    assert AS.levels_sr_for("ZZZ", member=True, served=[]) is None


def test_one_answer_per_ticker_session_and_served_prices(monkeypatch, sr_on, bars_of):
    n = []
    real = AS.sr_compute
    monkeypatch.setattr(AS, "sr_compute", lambda b, p: n.append(tuple(p)) or real(b, p))
    a = AS.levels_sr_for("ZZZ", member=True, served=[])
    b = AS.levels_sr_for("ZZZ", member=True, served=[])
    assert a == b and len(n) == 1
    row = _shelf_row(123.45)
    AS.levels_sr_for("ZZZ", member=True, served=[row])           # new served prices -> recomputed
    assert n[-1] == (123.45,) and len(n) == 2
    c, _seen = bars_of
    later = _dicts(c["bars"])[1:] + [{**_dicts(c["bars"])[-1], "t": int(c["bars"][-1][0]) + 1}]
    monkeypatch.setattr(AS, "_shelf_bars", lambda sym: later)    # a new completed session -> recomputed
    AS.levels_sr_for("ZZZ", member=True, served=[row])
    assert len(n) == 3


def test_any_failure_draws_nothing(monkeypatch, sr_on, bars_of):
    def boom(*a, **k):
        raise RuntimeError("drawing exploded")
    monkeypatch.setattr(S, "draw", boom)
    assert AS.levels_sr_for("ZZZ", member=True, served=[]) is None
    monkeypatch.setattr(AS, "shelf_member_facts", boom)
    assert AS.levels_sr_for("ZZZ") is None


# ---------------------------------------------------------------- patterns win
def _shelf_row(price):
    return {"id": "s", "pattern_id": AS.SHELF_PIVOT_ID,
            "geometry": {"extras": {"draw_shelf": {"price": price, "start_t": 1, "end_t": 2}}}}


def _level_row(pid, entry, **extras):
    return {"id": pid, "pattern_id": pid, "levels": {"entry": entry}, "start_t": 1, "end_t": 2,
            "geometry": {"extras": dict(extras)}}


def test_served_prices_are_what_the_chart_draws():
    rows = [_level_row("flat_base", 50.0), _level_row("bull_flag", 60.0, stale=True),   # stale: sent, never drawn
            _shelf_row(70.0), {"pattern_id": "bc:base", "geometry": {"extras": {}}}]    # unreadable: suppresses nothing
    assert AS.sr_served_prices(rows) == [50.0, 70.0]


def test_a_served_drawing_suppresses_the_zone_it_holds(monkeypatch, sr_on, bars_of):
    """Patterns win, end to end through the member door: a served row at a drawn zone's centre withholds it."""
    plain = AS.levels_sr_for("ZZZ", member=True, served=[])
    z = plain["zones"][0]
    mid = round((z["bot"] + z["top"]) / 2, 4)
    won = AS.levels_sr_for("ZZZ", member=True, served=[_level_row("flat_base", mid)])
    assert all(not (q["bot"] <= mid <= q["top"]) for q in won["zones"])
    assert json.dumps(won, sort_keys=True) == json.dumps(AS.sr_compute(_dicts(bars_of[0]["bars"]), [mid]), sort_keys=True)


def test_the_team_path_suppresses_against_the_member_path_drawings(monkeypatch, sr_on, bars_of):
    plain = AS.levels_sr_for("ZZZ", member=True, served=[])
    z = plain["zones"][0]
    mid = round((z["bot"] + z["top"]) / 2, 4)
    monkeypatch.setattr(AS, "shelf_member_facts", lambda sym, b: ([("flat_base", [mid], (1, 2))], []))
    team = AS.levels_sr_for("ZZZ")
    assert all(not (q["bot"] <= mid <= q["top"]) for q in team["zones"])


# ---------------------------------------------------------------- the route
def _payload(user, url=URL):
    return _get(user, url)


def test_route_flag_off_is_byte_identical_and_computes_nothing(monkeypatch, calls, bars_of):
    """With AUTO_STRUCTURES_SR_ENABLED off the member and team payloads are the bytes they were before the layer."""
    _flags(monkeypatch, True, True)
    monkeypatch.delenv("AUTO_STRUCTURES_SR_ENABLED", raising=False)
    monkeypatch.setattr(AS, "shelf_member_facts", lambda sym, b: ([], []))
    for user in (PAID_MEMBER, ADMIN):
        want = _payload(user).content
        monkeypatch.setenv("AUTO_STRUCTURES_SR_ENABLED", "0")
        assert _payload(user).content == want
        assert b"levels_sr" not in want
        monkeypatch.delenv("AUTO_STRUCTURES_SR_ENABLED", raising=False)
    assert bars_of[1] == []      # no bar was read for the layer


@pytest.mark.parametrize("user", [PAID_MEMBER, ADMIN])
def test_route_flag_on_adds_only_the_levels_sr_key(monkeypatch, calls, bars_of, user):
    _flags(monkeypatch, True, True)
    monkeypatch.setattr(AS, "shelf_member_facts", lambda sym, b: ([], []))
    monkeypatch.delenv("AUTO_STRUCTURES_SR_ENABLED", raising=False)
    off = json.loads(_payload(user).content)
    monkeypatch.setenv("AUTO_STRUCTURES_SR_ENABLED", "1")
    AS._SR_CACHE.clear()
    on = json.loads(_payload(user).content)
    sr = on.pop("levels_sr")
    assert on == off
    assert sr["round"] == "r2" and sr["zones"]


def test_route_member_passes_its_own_drawings_as_the_pattern_prices(monkeypatch, calls, bars_of, sr_on):
    """The member door suppresses against the rows THIS response serves (detections + structures)."""
    _flags(monkeypatch, True, True)
    got = []
    real = AS.levels_sr_for
    monkeypatch.setattr(AS, "levels_sr_for", lambda sym, **k: got.append(k) or real(sym, **k))
    body = json.loads(_payload(PAID_MEMBER).content)
    assert len(got) == 1 and got[0]["member"] is True
    served_ids = [r["id"] for r in got[0]["served"]]
    assert served_ids == [r["id"] for r in body["detections"]] + [r["id"] for r in body.get("structures", [])]
    assert AS.sr_served_prices(got[0]["served"])       # the box pivot line is among the prices


@pytest.mark.parametrize("tf", ["W", "M", "60", "5"])
def test_route_daily_charts_only(monkeypatch, calls, bars_of, sr_on, tf):
    _flags(monkeypatch, True, True)
    monkeypatch.setattr(AS, "shelf_member_facts", lambda sym, b: ([], []))
    for user in (PAID_MEMBER, ADMIN):
        assert "levels_sr" not in json.loads(_payload(user, URL.replace("tf=D", "tf=" + tf)).content)
    assert bars_of[1] == []


@pytest.mark.parametrize("user", [PAID_MEMBER, ADMIN])
def test_route_pending_acquisition_gets_nothing(monkeypatch, calls, bars_of, sr_on, user):
    _flags(monkeypatch, True, True)
    monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
    st = {"sym": "ZZZ", "pending": True, "possible": False, "source": ["pc_exclude_mirror"], "since": None,
          "price": None, "confidence": 1.0}
    monkeypatch.setattr(deal_status, "deal_status", lambda sym, bars=None: dict(st))
    body = json.loads(_payload(user).content)
    assert "levels_sr" not in body and body["deal_status"]["pending"] is True
    assert bars_of[1] == []


def test_route_member_round_withheld_gets_no_key(monkeypatch, calls, bars_of, sr_on):
    _flags(monkeypatch, True, True)
    monkeypatch.setattr(AS, "MEMBER_SR_ROUND", None)
    assert "levels_sr" not in json.loads(_payload(PAID_MEMBER).content)


def test_route_members_flag_off_gets_no_key(monkeypatch, calls, bars_of, sr_on):
    _flags(monkeypatch, True, False)
    assert b"levels_sr" not in _payload(PAID_MEMBER).content


# ---------------------------------------------------------------- the one client signal
def test_the_auth_signal_follows_the_gates(monkeypatch):
    from api.routers.auth import _auto_structures_flag as flag
    _flags(monkeypatch, True, True)
    monkeypatch.delenv("AUTO_STRUCTURES_SR_ENABLED", raising=False)
    assert flag(False, True) == {"auto_structures_members_enabled": True}     # off: byte-identical to before
    assert flag(True) == {"auto_structures_enabled": True}
    monkeypatch.setenv("AUTO_STRUCTURES_SR_ENABLED", "1")
    assert flag(False, True) == {"auto_structures_members_enabled": True, "levels_sr_enabled": True}
    assert flag(True) == {"auto_structures_enabled": True, "levels_sr_enabled": True}
    assert flag(False, False) == {}                                            # unpaid: nothing
    monkeypatch.setattr(AS, "MEMBER_SR_ROUND", None)
    assert flag(False, True) == {"auto_structures_members_enabled": True}     # member round withheld
    assert flag(True) == {"auto_structures_enabled": True, "levels_sr_enabled": True}
    _flags(monkeypatch, False, True)
    assert flag(True) == {} and flag(False, True) == {}
