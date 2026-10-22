"""Shelf pivot (dark): the PRODUCTION path and its gates.

1. Parity: on every fixture chart (tests/fixtures/shelf_pivot_parity.json.gz) the production path -- the member
   path's served drawings and detector lines computed by auto_structures.shelf_member_facts from the bars alone,
   then the ported layer -- gives the frozen layer's answer (same gate, line, span start, display start, score).
2. Gates: AUTO_STRUCTURES_SHELF_ENABLED off runs nothing; a member gets nothing while MEMBER_SHELF_PIVOT_ROUND is
   the literal None (and member_rows also requires the member set); any served drawing hides the line; any
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


def test_the_production_path_reproduces_the_lab_on_every_case(member_path_env):
    bad = []
    for c in cases():
        _ASOF[0] = int(c["bars"][-1][0])
        served, lines = AS.shelf_member_facts(c["ticker"], _dicts(c["bars"]))
        want_served = [(p, ls, tuple(sp) if sp else None) for p, ls, sp in c["served"]]
        if [(p, ls, tuple(sp) if sp else None) for p, ls, sp in served] != want_served:
            bad.append((c["id"], "served"))
        # the detectors stamp their own clock, so two lines of one chart can swap places between runs: the SET
        # of lines is the contract (ties never moved an answer on the 1,550 charts measured)
        if sorted(map(tuple, lines)) != sorted(map(tuple, c["lines"])):
            bad.append((c["id"], "lines"))
        r = S.evaluate(c["bars"], served, lines)
        e = c["expect"]
        got = None if r["pick"] is None else {k: r["pick"][k] for k in ("P", "left", "disp_left")}
        if r["gate"] != e["gate"] or got != e["pick"]:
            bad.append((c["id"], "answer", e, got))
    assert bad == []


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


def test_the_member_round_literal_is_None_in_source():
    src = open(AS.__file__, encoding="utf-8").read()
    lits = [n for n in ast.walk(ast.parse(src)) if isinstance(n, ast.Assign)
            and any(getattr(t, "id", None) == "MEMBER_SHELF_PIVOT_ROUND" for t in n.targets)]
    assert len(lits) == 1 and isinstance(lits[0].value, ast.Constant) and lits[0].value.value is None
    assert S.SHELF_PIVOT_ROUND == "r4"
    assert AS.SHELF_PIVOT_ID == S.SHELF_PIVOT_ID == "draw:shelf-pivot"
    assert AS.SHELF_PIVOT_ID not in REG.DISPLAY_MEMBER_SET


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
    assert row["display_tier"] == "experimental" and row["levels"] == {}


def test_members_get_nothing_while_the_round_literal_is_None(monkeypatch, shelf_on):
    c, bars = _drawing_bars()
    monkeypatch.setattr(AS, "_shelf_bars", lambda sym: bars)
    monkeypatch.setattr(AS, "shelf_member_facts", lambda sym, b: (c["served"], c["lines"]))
    assert AS.MEMBER_SHELF_PIVOT_ROUND is None
    assert AS.shelf_pivot_row("SYN", member=True) is None
    assert AS.member_rows([_a_row()]) == []


def test_member_rows_needs_the_round_AND_the_member_set(monkeypatch):
    row = {**_a_row(), "display_tier": "trusted"}
    monkeypatch.setattr(REG, "DISPLAY_MEMBER_SET", frozenset(REG.DISPLAY_MEMBER_SET | {AS.SHELF_PIVOT_ID}))
    assert AS.member_rows([row]) == []                      # literal None
    monkeypatch.setattr(AS, "MEMBER_SHELF_PIVOT_ROUND", "r3")
    assert AS.member_rows([row]) == []                      # another round
    stale = {**row, "geometry": {**row["geometry"], "extras": {**row["geometry"]["extras"], "draw_round": "r3"}}}
    assert AS.member_rows([stale]) == []                    # literal and row agree, but not the frozen round
    monkeypatch.setattr(AS, "MEMBER_SHELF_PIVOT_ROUND", "r4")
    assert AS.member_rows([row]) == [row]                   # released: round + member set + trusted
    monkeypatch.setattr(REG, "DISPLAY_MEMBER_SET", frozenset(REG.DISPLAY_MEMBER_SET - {AS.SHELF_PIVOT_ID}))
    assert AS.member_rows([row]) == []                      # not in the member set


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
