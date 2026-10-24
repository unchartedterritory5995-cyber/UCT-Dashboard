"""Shelf pivot (members released at round r4, 2026-10-23): the PRODUCTION path and its gates.

1. Parity: on every fixture chart (tests/fixtures/shelf_pivot_parity.json.gz) the production path -- the member
   path's served drawings and detector lines computed by auto_structures.shelf_member_facts from the bars alone,
   then the ported layer -- gives the frozen layer's answer (same gate, line, span start, display start, score).
2. Gates: AUTO_STRUCTURES_SHELF_ENABLED off runs nothing; a member gets the line only while MEMBER_SHELF_PIVOT_ROUND
   is the literal "r4" equal to the frozen round (and member_rows also requires the member + trusted sets); any served drawing hides the line; any
   failure draws nothing; the judged frame only (completed daily sessions, >= 261 bars, close > $5, as-of dollar
   volume >= $20M); one answer per (ticker, last completed session).
"""
import ast
import os

import pytest

from api.services import auto_structures as AS
from api.services import barspack
from api.services.pattern_engine import shelf_pivot as S
from api.services.pattern_engine.detectors import registry as REG

from tests.test_shelf_pivot_parity import cases

_ASOF = [None]


@pytest.fixture
def member_path_env(monkeypatch):
    # the member path as the judged charts were replayed: every structures flag on, the session clock at the bar
    for k in ("AUTO_STRUCTURES_ENABLED", "AUTO_STRUCTURES_MEMBERS_ENABLED", "AUTO_STRUCTURES_SHAPES_ENABLED",
              "AUTO_STRUCTURES_METRICS_ENABLED"):
        monkeypatch.setenv(k, "1")
    monkeypatch.setattr(barspack, "_last_complete_session_ymd", lambda now=None: _ASOF[0])


def _dicts(bars):
    return [{"t": int(b[0]), "o": float(b[1]), "h": float(b[2]), "l": float(b[3]), "c": float(b[4]),
             "v": float(b[5] or 0)} for b in bars]


#: Fixture charts whose recorded "served" set holds a row the member's chart never draws (stale, not the
#: "flagging" tier). The fixture was recorded when "served" meant SENT; it now means DRAWN, so on exactly these
#: charts that row leaves `served` and its lines turn withheld. The fixture itself is unchanged, and the layer's
#: answer (gate, line, span start, display start) is unchanged on every one of them.
SENT_NOT_DRAWN = {
    "held/draw/001": "uct_pullback_ma_v5", "held/draw/002": "uct_pullback_ma_v5",
    "held/draw/062": "uct_pullback_ma_v5", "held/none/014": "uct_pullback_ma_v5",
    "held/none/028": "uct_pullback_ma_v5", "held/none/036": "flat_base", "held/none/053": "flat_base",
    "held/none/061": "flat_base", "held/none/063": "flat_base", "held/none/105": "uct_pullback_ma_v5",
    "held/none/151": "uct_pullback_ma_v5", "held/none/171": "flat_base", "held/none/173": "uct_pullback_ma_v5",
    "held/none/213": "uct_pullback_ma_v5", "held/none/217": "uct_pullback_ma_v5", "held/none/229": "flat_base",
    "held/none/242": "uct_pullback_ma_v5", "held/none/252": "flat_base", "held/none/269": "flat_base",
    "held/none/274": "flat_base",
}


#: Fixture charts whose recorded "served" set holds a "flagging"-tier bull_flag. Flagging tier withheld from
#: members 2026-10-24 (blind textbook score 1.28; auto_structures.MEMBER_FLAGGING_ROUND = None): member_rows no
#: longer serves it, so on exactly these charts it leaves `served` and its line turns withheld. Measured on every
#: fixture chart: these are the only ones that moved, and the layer's answer (gate, line, span start, display
#: start) is unchanged on all of them.
FLAGGING_WITHHELD = {
    "held/none/059", "held/none/134", "held/none/149", "held/none/160",
    "held/none/215", "held/none/235", "held/none/253", "held/none/256",
}


#: Fixture charts where the member base drawing round 4 (auto_structures.MEMBER_BASE_ROUND == 4 since 2026-10-23)
#: draws a base that round 2 -- the member round when the fixture was recorded -- did not: a member's chart now
#: holds that bc:base drawing, so it is SERVED with its line (not withheld), and (any served drawing hides the
#: shelf line) the layer draws nothing there. Measured on all 427 charts: this is the only one that moved.
ROUND4_DRAWN = {
    "held/draw/042": ("bc:base", [245.97], (20260303, 20260622)),
}


def _drawn_view(c, round4=True, flagging_withheld=True):
    """The fixture's (served, lines) with the SENT_NOT_DRAWN row taken out of served and its lines withheld,
    (`round4`) the ROUND4_DRAWN base added to served with its line, not withheld (round 2 drew no base there), and
    (`flagging_withheld`) the FLAGGING_WITHHELD chart's bull_flag taken out of served and its line withheld."""
    served = [(p, ls, tuple(sp) if sp else None) for p, ls, sp in c["served"]]
    lines = [tuple(x) for x in c["lines"]]
    if flagging_withheld and c["id"] in FLAGGING_WITHHELD:
        gone = [x for x in served if x[0] == "bull_flag"]
        assert len(gone) == 1, c["id"]
        prices = set(gone[0][1])
        served = [x for x in served if x is not gone[0]]
        lines = [(p, v, True) if p == "bull_flag" and v in prices else (p, v, w) for p, v, w in lines]
    add = ROUND4_DRAWN.get(c["id"]) if round4 else None
    if add is not None:
        assert not any(x[0] == add[0] for x in served), c["id"]
        assert not any(x[0] == add[0] for x in lines), c["id"]
        served = served + [add]
        lines = lines + [(add[0], v, False) for v in add[1]]
    pid = SENT_NOT_DRAWN.get(c["id"])
    if pid is None:
        return served, lines
    gone = [x for x in served if x[0] == pid]
    assert len(gone) == 1, c["id"]
    prices = set(gone[0][1])
    return ([x for x in served if x is not gone[0]],
            [(p, v, True) if p == pid and v in prices else (p, v, w) for p, v, w in lines])


def _reproduce(round4, flagging_withheld=True):
    bad = []
    for c in cases():
        _ASOF[0] = int(c["bars"][-1][0])
        served, lines = AS.shelf_member_facts(c["ticker"], _dicts(c["bars"]))
        want_served, want_lines = _drawn_view(c, round4, flagging_withheld)
        if [(p, ls, tuple(sp) if sp else None) for p, ls, sp in served] != want_served:
            bad.append((c["id"], "served"))
        # the detectors stamp their own clock, so two lines of one chart can swap places between runs: the SET
        # of lines is the contract (ties never moved an answer on the 1,550 charts measured)
        if sorted(map(tuple, lines)) != sorted(want_lines):
            bad.append((c["id"], "lines"))
        r = S.evaluate(c["bars"], served, lines)
        e = c["expect"]
        got = None if r["pick"] is None else {k: r["pick"][k] for k in ("P", "left", "disp_left")}
        if round4 and c["id"] in ROUND4_DRAWN:
            # the recorded answer drew a shelf line; with the round-4 base served, the layer draws nothing
            if not (e["pick"] is not None and got is None and r["gate"] != "PASS"):
                bad.append((c["id"], "round4", e, r["gate"], got))
        elif r["gate"] != e["gate"] or got != e["pick"]:
            bad.append((c["id"], "answer", e, got))
    return bad


def test_the_production_path_reproduces_the_lab_on_every_case(member_path_env):
    assert _reproduce(round4=True) == []


def test_a_rollback_to_base_round_two_reproduces_the_recorded_member_view(member_path_env, monkeypatch):
    """With the bc:base member literal moved back to 2 (in memory), every bc:base row is a round-4 row carrying
    round 2's drawing, and the member's chart holds round 2's line only: the recorded view, exactly."""
    monkeypatch.setattr(AS, "MEMBER_BASE_ROUND", 2)
    assert _reproduce(round4=False) == []


def test_re_enabling_the_flagging_tier_reproduces_the_recorded_flagging_view(member_path_env, monkeypatch):
    """Control for FLAGGING_WITHHELD: with the member flagging literal set back to 9 (in memory, the one-literal
    re-enable), the flagging flags are served again on exactly those charts -- and the withheld view no longer
    matches there."""
    monkeypatch.setattr(AS, "MEMBER_FLAGGING_ROUND", 9)
    assert _reproduce(round4=True, flagging_withheld=False) == []
    moved = {b[0] for b in _reproduce(round4=True, flagging_withheld=True)}
    assert moved == FLAGGING_WITHHELD


# ---------------------------------------------------------------- gates
@pytest.fixture
def shelf_on(monkeypatch):
    monkeypatch.setenv("AUTO_STRUCTURES_SHELF_ENABLED", "1")
    AS._SHELF_CACHE.clear()
    yield
    AS._SHELF_CACHE.clear()


def _a_row():
    c = next(c for c in cases() if c["expect"]["pick"] is not None)
    r = S.evaluate(c["bars"], c["served"], c["lines"])
    return AS.shelf_row("SYN", r["pick"], r["score"], r["atr"])


def _drawing_bars():
    c = next(c for c in cases() if c["expect"]["pick"] is not None and not c["served"])
    return c, _dicts(c["bars"])


def test_the_member_round_literal_is_the_frozen_round_r4_in_source():
    """Released 2026-10-23: the literal is the STRING "r4" written in source (never a reference to
    shelf_pivot.SHELF_PIVOT_ROUND, so a new drawing round cannot release itself), and the id sits in the member
    set and the trusted set member_rows requires."""
    src = open(AS.__file__, encoding="utf-8").read()
    lits = [n for n in ast.walk(ast.parse(src)) if isinstance(n, ast.Assign)
            and any(getattr(t, "id", None) == "MEMBER_SHELF_PIVOT_ROUND" for t in n.targets)]
    assert len(lits) == 1 and isinstance(lits[0].value, ast.Constant) and lits[0].value.value == "r4"
    assert S.SHELF_PIVOT_ROUND == "r4" == AS.MEMBER_SHELF_PIVOT_ROUND
    assert AS.SHELF_PIVOT_ID == S.SHELF_PIVOT_ID == "draw:shelf-pivot"
    assert AS.SHELF_PIVOT_ID in REG.DISPLAY_MEMBER_SET
    assert AS.SHELF_PIVOT_ID in REG.DISPLAY_TEAM_SET and AS.SHELF_PIVOT_ID in REG.DISPLAY_TRUSTED
    assert REG.display_policy(AS.SHELF_PIVOT_ID)["display_tier"] == "trusted"


def test_flag_off_runs_nothing(monkeypatch):
    monkeypatch.delenv("AUTO_STRUCTURES_SHELF_ENABLED", raising=False)

    calls = []
    # shelf_pivot_row swallows every exception, so a raising stub could not tell "never ran" from "ran and
    # failed": record calls instead, and let a call return a real row
    c, bars = _drawing_bars()
    monkeypatch.setattr(AS, "_shelf_bars", lambda sym: calls.append(sym) or bars)
    monkeypatch.setattr(AS, "shelf_compute", lambda sym, b: calls.append(sym) or {"id": "x"})
    AS._SHELF_CACHE.clear()
    assert AS.shelf_enabled() is False
    assert AS.shelf_pivot_row("AAPL") is None
    assert AS.shelf_pivot_row("AAPL", member=True) is None
    assert calls == []
    monkeypatch.setenv("AUTO_STRUCTURES_SHELF_ENABLED", "1")    # control: the same stubs DO run when on
    assert AS.shelf_pivot_row("AAPL") == {"id": "x"} and calls
    AS._SHELF_CACHE.clear()


def test_flag_off_leaves_structures_for_byte_identical(monkeypatch):
    c, bars = _drawing_bars()
    _ASOF[0] = int(bars[-1]["t"])
    monkeypatch.setattr(barspack, "_last_complete_session_ymd", lambda now=None: _ASOF[0])
    monkeypatch.setattr(AS, "_daily_bars", lambda sym: bars)
    AS._CACHE.clear()
    monkeypatch.delenv("AUTO_STRUCTURES_SHELF_ENABLED", raising=False)
    off = AS.structures_for("SYN")
    AS._CACHE.clear()
    monkeypatch.setenv("AUTO_STRUCTURES_SHELF_ENABLED", "1")
    on = AS.structures_for("SYN")
    AS._CACHE.clear()
    assert repr(off) == repr(on)
    assert not any(r.get("pattern_id") == AS.SHELF_PIVOT_ID for r in on)


def test_admins_get_the_line_when_the_flag_is_on(monkeypatch, shelf_on):
    c, bars = _drawing_bars()
    monkeypatch.setattr(AS, "_shelf_bars", lambda sym: bars)
    monkeypatch.setattr(AS, "shelf_member_facts", lambda sym, b: (c["served"], c["lines"]))
    row = AS.shelf_pivot_row("SYN")
    assert row is not None and row["pattern_id"] == "draw:shelf-pivot"
    d = row["geometry"]["extras"]["draw_shelf"]
    assert d["price"] == round(c["expect"]["pick"]["P"], 4)
    assert d["start_t"] == bars[c["expect"]["pick"]["disp_left"]]["t"] and d["end_t"] == bars[-1]["t"]
    assert d["label"] == "Shelf pivot" and d["tooltip"].startswith("Price has stalled at this level several times since ")
    assert d["tooltip"].endswith("is trading near it now. A level to watch, not a signal.")
    assert d["cleared"] == (bars[-1]["c"] > c["expect"]["pick"]["P"])
    assert row["display_tier"] == "trusted" and row["levels"] == {}


def test_members_get_the_line_at_the_released_round(monkeypatch, shelf_on):
    c, bars = _drawing_bars()
    monkeypatch.setattr(AS, "_shelf_bars", lambda sym: bars)
    monkeypatch.setattr(AS, "shelf_member_facts", lambda sym, b: (c["served"], c["lines"]))
    assert AS.MEMBER_SHELF_PIVOT_ROUND == "r4"
    row = AS.shelf_pivot_row("SYN", member=True)
    assert row is not None and row["pattern_id"] == AS.SHELF_PIVOT_ID
    assert AS.member_rows([row]) == [row]
    AS._SHELF_CACHE.clear()


def test_members_get_nothing_while_the_round_literal_is_None(monkeypatch, shelf_on):
    """The withdraw lever: setting the literal back to None takes the line from every member (fail closed)."""
    c, bars = _drawing_bars()
    monkeypatch.setattr(AS, "_shelf_bars", lambda sym: bars)
    monkeypatch.setattr(AS, "shelf_member_facts", lambda sym, b: (c["served"], c["lines"]))
    monkeypatch.setattr(AS, "MEMBER_SHELF_PIVOT_ROUND", None)
    assert AS.shelf_pivot_row("SYN", member=True) is None
    assert AS.member_rows([_a_row()]) == []
    AS._SHELF_CACHE.clear()


def test_member_rows_needs_the_round_AND_the_member_set(monkeypatch):
    row = {**_a_row(), "display_tier": "trusted"}
    monkeypatch.setattr(AS, "MEMBER_SHELF_PIVOT_ROUND", None)
    assert AS.member_rows([row]) == []                      # literal None
    monkeypatch.setattr(AS, "MEMBER_SHELF_PIVOT_ROUND", "r3")
    assert AS.member_rows([row]) == []                      # another round
    stale = {**row, "geometry": {**row["geometry"], "extras": {**row["geometry"]["extras"], "draw_round": "r3"}}}
    assert AS.member_rows([stale]) == []                    # literal and row agree, but not the frozen round
    monkeypatch.setattr(AS, "MEMBER_SHELF_PIVOT_ROUND", "r4")
    assert AS.member_rows([row]) == [row]                   # released: round + member set + trusted
    monkeypatch.setattr(REG, "DISPLAY_MEMBER_SET", frozenset(REG.DISPLAY_MEMBER_SET - {AS.SHELF_PIVOT_ID}))
    assert AS.member_rows([row]) == []                      # not in the member set
    monkeypatch.setattr(REG, "DISPLAY_MEMBER_SET", frozenset(REG.DISPLAY_MEMBER_SET | {AS.SHELF_PIVOT_ID}))
    assert AS.member_rows([{**row, "display_tier": "experimental"}]) == []    # not trusted


def test_any_served_drawing_hides_the_line(monkeypatch, shelf_on):
    c, bars = _drawing_bars()
    monkeypatch.setattr(AS, "_shelf_bars", lambda sym: bars)
    monkeypatch.setattr(AS, "shelf_member_facts", lambda sym, b: (c["served"], c["lines"]))
    assert AS.shelf_pivot_row("SYN") is not None
    AS._SHELF_CACHE.clear()
    assert AS.shelf_pivot_row("SYN", chart_served=[{"pattern_id": "bull_flag"}]) is None
    # the member path itself serving something hides it too
    monkeypatch.setattr(AS, "shelf_member_facts", lambda sym, b: ([("bull_flag", [1.0], None)], c["lines"]))
    assert AS.shelf_compute("SYN", bars) is None


# ---------------------------------------------------------------- "served" means DRAWN (C3)
def _stale_pullback(price=None):
    # sent to the member, never drawn: PatternOverlay.selectDrawable skips a stale row
    ex = {"stale": True, "stale_reason": "no_reclaim"}
    if price is not None:
        ex["pivot"] = price
    return {"pattern_id": "uct_pullback_ma_v5", "display_tier": "trusted", "geometry": {"extras": ex}}


def _flagging_bull_flag():
    # stale on a relaxed verdict and stamped as the "flagging" tier: the client DOES draw it
    reason = sorted(AS._display.FLAGGING_REASONS)[0]
    return {"pattern_id": "bull_flag", "display_tier": "trusted", "geometry": {"extras": {
        "stale": True, "stale_reason": reason,
        "flagging": {"tier": AS.MEMBER_FLAGGING_TIER, "draw_round": AS.FLAGGING_TIER_ROUND}}}}


def _live_pullback():
    return {"pattern_id": "uct_pullback_ma_v5", "display_tier": "trusted", "geometry": {"extras": {}}}


def test_the_rows_are_what_the_client_draws():
    assert not AS._drawn_incumbent(_stale_pullback())
    assert AS._flagging_flag(_flagging_bull_flag()) and AS._drawn_incumbent(_flagging_bull_flag())
    assert AS._drawn_incumbent(_live_pullback())


def test_a_stale_row_the_chart_never_draws_does_not_hide_the_line(monkeypatch, shelf_on):
    c, bars = _drawing_bars()
    monkeypatch.setattr(AS, "_shelf_bars", lambda sym: bars)
    monkeypatch.setattr(AS, "shelf_member_facts", lambda sym, b: (c["served"], c["lines"]))
    assert AS.shelf_pivot_row("SYN", member=False, chart_served=[_stale_pullback()]) is not None


def test_a_flagging_tier_flag_hides_the_line(monkeypatch, shelf_on):
    c, bars = _drawing_bars()
    monkeypatch.setattr(AS, "_shelf_bars", lambda sym: bars)
    monkeypatch.setattr(AS, "shelf_member_facts", lambda sym, b: (c["served"], c["lines"]))
    assert AS.shelf_pivot_row("SYN", chart_served=[_flagging_bull_flag()]) is None
    AS._SHELF_CACHE.clear()
    assert AS.shelf_pivot_row("SYN", chart_served=[_stale_pullback(), _flagging_bull_flag()]) is None


def test_a_live_row_hides_the_line(monkeypatch, shelf_on):
    c, bars = _drawing_bars()
    monkeypatch.setattr(AS, "_shelf_bars", lambda sym: bars)
    monkeypatch.setattr(AS, "shelf_member_facts", lambda sym, b: (c["served"], c["lines"]))
    assert AS.shelf_pivot_row("SYN", chart_served=[_live_pullback()]) is None
    AS._SHELF_CACHE.clear()
    assert AS.shelf_pivot_row("SYN", chart_served=[_stale_pullback(), _live_pullback()]) is None


def test_a_malformed_served_row_draws_nothing(monkeypatch, shelf_on):
    c, bars = _drawing_bars()
    monkeypatch.setattr(AS, "_shelf_bars", lambda sym: bars)
    monkeypatch.setattr(AS, "shelf_member_facts", lambda sym, b: (c["served"], c["lines"]))
    assert AS.shelf_pivot_row("SYN", chart_served=["not a row"]) is None


def _with_extra_detection(monkeypatch, row_for):
    from api.services import pattern_engine as PE
    real = PE.detect_all

    def detect_all(bars, ctx, **kw):
        out = list(real(bars, ctx, **kw))
        r = row_for(float(bars[-1]["c"]))
        out.append({**r, "confidence": 90.0, "status": "active", "start_t": int(bars[-40]["t"]),
                    "end_t": int(bars[-1]["t"])})
        return out
    monkeypatch.setattr(PE, "detect_all", detect_all)


def _strip_tier(r):
    return {k: v for k, v in r.items() if k != "display_tier"}


def test_the_member_path_does_not_count_a_stale_detection_as_served(monkeypatch, member_path_env):
    c, bars = _drawing_bars()
    _ASOF[0] = int(bars[-1]["t"])
    ticker = c["ticker"]
    # a stale pullback far above the chart: sent, never drawn
    _with_extra_detection(monkeypatch, lambda close: _strip_tier(_stale_pullback(close * 3.0)))
    served, lines = AS.shelf_member_facts(ticker, bars)
    assert not any(p == "uct_pullback_ma_v5" for p, _ls, _sp in served)
    stale_lines = [x for x in lines if x[0] == "uct_pullback_ma_v5" and x[1] == float(bars[-1]["c"]) * 3.0]
    assert stale_lines and all(w for _p, _v, w in stale_lines)       # counted as withheld
    assert AS.shelf_compute(ticker, bars) is not None


def test_the_member_path_withholds_a_flagging_flag_unless_re_enabled(monkeypatch, member_path_env):
    c, bars = _drawing_bars()
    _ASOF[0] = int(bars[-1]["t"])
    ticker = c["ticker"]

    def flag(close):
        r = _strip_tier(_flagging_bull_flag())
        r["geometry"]["extras"]["pivot"] = close * 3.0
        return r
    _with_extra_detection(monkeypatch, flag)
    # flagging tier withheld from members 2026-10-24 (blind textbook score 1.28): not served, its line withheld
    served, lines = AS.shelf_member_facts(ticker, bars)
    assert not any(p == "bull_flag" for p, _ls, _sp in served)
    assert any(p == "bull_flag" and w for p, _v, w in lines)
    monkeypatch.setattr(AS, "MEMBER_FLAGGING_ROUND", 9)            # control: the one-literal re-enable
    AS._SHELF_CACHE.clear()
    served, _lines = AS.shelf_member_facts(ticker, bars)
    assert any(p == "bull_flag" for p, _ls, _sp in served)
    assert AS.shelf_compute(ticker, bars) is None


def test_the_member_path_counts_a_live_detection_as_served(monkeypatch, member_path_env):
    c, bars = _drawing_bars()
    _ASOF[0] = int(bars[-1]["t"])
    ticker = c["ticker"]
    _with_extra_detection(monkeypatch, lambda close: {**_strip_tier(_live_pullback()),
                                                      "geometry": {"extras": {"pivot": close * 3.0}}})
    served, _lines = AS.shelf_member_facts(ticker, bars)
    assert any(p == "uct_pullback_ma_v5" for p, _ls, _sp in served)
    assert AS.shelf_compute(ticker, bars) is None


def test_the_member_path_does_not_count_a_stale_structure_as_served(monkeypatch, member_path_env):
    # no member rule admits a stale structure today (stale boxes are dropped, the drawing rounds require
    # not-stale); the guard is what keeps "served" meaning DRAWN if one ever does
    c, bars = _drawing_bars()
    _ASOF[0] = int(bars[-1]["t"])
    ticker = c["ticker"]
    real = AS._structure_rows
    hi = float(bars[-1]["c"]) * 3.0

    def structure_rows(sym, b):
        stale = {"id": "stale-fb", "pattern_id": "flat_base", "display_tier": "trusted",
                 "start_t": int(b[-40]["t"]), "end_t": int(b[-1]["t"]),
                 "geometry": {"extras": {"stale": True, "stale_reason": "broke_down", "pivot": hi}}}
        return list(real(sym, b)) + [stale]
    monkeypatch.setattr(AS, "_structure_rows", structure_rows)
    served, lines = AS.shelf_member_facts(ticker, bars)
    assert not any(p == "flat_base" and hi in ls for p, ls, _sp in served)
    mine = [x for x in lines if x[0] == "flat_base" and x[1] == hi]
    assert mine and all(w for _p, _v, w in mine)
    assert AS.shelf_compute(ticker, bars) is not None


def test_any_failure_draws_nothing(monkeypatch, shelf_on):
    c, bars = _drawing_bars()
    monkeypatch.setattr(AS, "_shelf_bars", lambda sym: bars)

    def boom(sym, b):
        raise KeyError("a member detector is not loaded")
    monkeypatch.setattr(AS, "shelf_member_facts", boom)
    assert AS.shelf_pivot_row("SYN") is None
    monkeypatch.setattr(AS, "shelf_member_facts", lambda sym, b: (c["served"], c["lines"]))
    monkeypatch.setattr(S, "_RANKER_PATH", os.path.join(os.path.dirname(__file__), "no_such_ranker.json"))
    monkeypatch.setattr(S, "_RANKER", [None])
    AS._SHELF_CACHE.clear()
    assert AS.shelf_pivot_row("SYN") is None


def test_only_the_judged_frame(monkeypatch):
    c, bars = _drawing_bars()
    assert AS.shelf_in_frame(bars)
    assert not AS.shelf_in_frame(bars[-260:])
    last = dict(bars[-1])
    assert not AS.shelf_in_frame(bars[:-1] + [{**last, "c": 5.0}])
    assert not AS.shelf_in_frame(bars[:-1] + [{**last, "v": (20e6 - 1) / last["c"]}])
    assert AS.shelf_in_frame(bars[:-1] + [{**last, "v": 20e6 / last["c"] + 1}])


def test_a_forming_session_is_never_drawn_on(monkeypatch):
    from api.services import bars_sqlite
    rows = [(20260101 + k, 10.0, 11.0, 9.0, 10.0, 1e7) for k in range(5)]
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda sym, tf, n: rows)
    monkeypatch.setattr(barspack, "_last_complete_session_ymd", lambda now=None: 20260103)
    got = AS._shelf_bars("SYN")
    assert [b["t"] for b in got] == [20260101, 20260102, 20260103]
    monkeypatch.setattr(barspack, "_last_complete_session_ymd", lambda now=None: None)
    assert AS._shelf_bars("SYN") is None


def test_one_answer_per_ticker_and_completed_session(monkeypatch, shelf_on):
    c, bars = _drawing_bars()
    calls = []
    cur = [bars]
    monkeypatch.setattr(AS, "_shelf_bars", lambda sym: cur[0])
    monkeypatch.setattr(AS, "shelf_compute", lambda sym, b: calls.append(b[-1]["t"]) or {"id": "x"})
    AS.shelf_pivot_row("SYN")
    AS.shelf_pivot_row("SYN")
    assert len(calls) == 1
    cur[0] = bars[:-1]
    AS.shelf_pivot_row("SYN")
    assert len(calls) == 2


def test_the_route_asks_only_on_daily_charts_and_passes_what_the_chart_serves():
    src = open(os.path.join(os.path.dirname(AS.__file__), "..", "routers", "patterns.py"), encoding="utf-8").read()
    assert src.count("auto_structures.shelf_pivot_row(") == 2
    assert 'shelf_pivot_row(sym, member=True, chart_served=list(rows) + list(boxes))' in src
    assert src.count('if (tf or "D").upper() == "D":\n') + src.count('if (tf or "D").upper() == "D":\r\n') >= 2
