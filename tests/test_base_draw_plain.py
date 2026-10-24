"""The PLAIN base (round 6, lab base_rebuild): the stateless member bc:base rebuilt from the textbook.

Rails, all on synthetic bars (public repo):
  * PORT PARITY -- the lab rule (tests/fixtures/base_rebuild/rule_lab.py, the pre-registered file byte for byte up to
    line endings: sha256 of its LF form is pinned) and base_draw.plain_geometry agree on EVERY session of seeded series
    built to hit and to miss each step; the sweep must reach both answers and most of the rule's steps;
  * GEOMETRY -- a textbook base draws with its line on the left-side high; each textbook failure the old drawing
    shipped (a later spike above the left side, an older higher peak, a short or V base, a falling 200-day, a
    parabolic run, price far under the line, a lone spike wick) draws nothing;
  * LABEL -- on a plain row the buy point is the base's highest high + $0.10, the stage is the drawing's, and a
    volume line prints only on a breakout session;
  * RELEASE -- members get the stateless base only as the plain base of MEMBER_BASE_STATELESS_ROUND (6); a rollback
    of the literal to MEMBER_BASE_ROUND serves the old drawing; None withholds both;
  * STATES UNCHANGED -- every base STATE row base_draw_row builds is byte-identical under the released literal and
    under None (the states are asked before the plain base and never read it).
"""
from __future__ import annotations

import datetime
import hashlib
import importlib.util
import json
import math
import os
import random

import pytest

from api.services import auto_structures as AS
from api.services import textbook_numbers as TN
from api.services.pattern_engine import base_draw as BD

_HERE = os.path.dirname(os.path.abspath(__file__))
_LAB_PATH = os.path.join(_HERE, "fixtures", "base_rebuild", "rule_lab.py")
#: sha256 of the pre-registered lab rule with LF line endings (PREREG.hashes records its CRLF bytes, c1f41b5d...)
_LAB_SHA_LF = "e89db8150b5cd6e2026c5c9f19da94ce37934c9cb19c1032996f93bf6861e83b"
_spec = importlib.util.spec_from_file_location("base_rebuild_rule_lab", _LAB_PATH)
LAB = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(LAB)


# ------------------------------------------------------------------ synthetic series
def _bars(closes, seed, noise, spikes=None):
    rnd = random.Random(seed)
    d, prev, out = datetime.date(2000, 1, 3), closes[0], []
    for k, c in enumerate(closes):
        while d.weekday() >= 5:
            d += datetime.timedelta(days=1)
        o = prev
        h = max(o, c) * (1 + abs(rnd.gauss(0, noise / 2)))
        lo = min(o, c) * (1 - abs(rnd.gauss(0, noise / 2)))
        if spikes and k in spikes:
            h = max(o, c) * spikes[k]
        out.append({"t": int(d.strftime("%Y%m%d")), "o": round(o, 4), "h": round(h, 4), "l": round(lo, 4),
                    "c": round(c, 4), "v": 1e6})
        prev = c
        d += datetime.timedelta(days=1)
    return out


def textbook(seed=0, base_len=45, depth=0.18, adv=0.45, end_below=0.02, noise=0.006, drift=0.0012, run_len=60,
             pre=None, spikes=None, tail=None):
    """A slow stage-2 rise, an advance of `adv` over `run_len` sessions into a left-side high, a rounded base of
    `depth` over `base_len` sessions ending `end_below` under the high. `pre` replaces the rise's closes; `tail`
    appends closes after the base."""
    rnd = random.Random(seed)
    p, closes = 40.0, []
    for _ in range(320):
        p *= 1 + drift + rnd.gauss(0, noise)
        closes.append(p)
    if pre is not None:
        closes = list(pre)
        p = closes[-1]
    for k in range(run_len):
        closes.append(p * (1 + adv) ** ((k + 1) / run_len) * (1 + rnd.gauss(0, noise / 2)))
    top = max(closes[-5:])
    for k in range(base_len):
        x = k / max(1, base_len - 1)
        level = top * (1 - depth * math.sin(math.pi * x) * 0.9) * (1 - end_below * x)
        closes.append(min(level * (1 + rnd.gauss(0, noise / 2)), top * 0.995))
    closes += list(tail or [])
    return _bars(closes, seed + 1000, noise, spikes)


def walk(seed, n=520, noise=0.018):
    rnd = random.Random(seed)
    p, closes = 30.0, []
    for _ in range(n):
        p *= 1 + rnd.gauss(0.0006, noise)
        closes.append(p)
    return _bars(closes, seed + 2000, noise)


def _i(b):
    return len(b) - 1


# ------------------------------------------------------------------ parity
def test_the_lab_rule_fixture_is_the_pre_registered_file():
    raw = open(_LAB_PATH, "rb").read().replace(b"\r\n", b"\n")
    assert hashlib.sha256(raw).hexdigest() == _LAB_SHA_LF


def _sweep_series():
    out = []
    for s in range(24):
        out.append(textbook(seed=s, base_len=26 + (s * 7) % 50, depth=0.06 + (s % 9) * 0.035,
                            adv=0.2 + (s % 5) * 0.15, end_below=(s % 4) * 0.025))
    for s in range(8):
        out.append(walk(s))
    return out


def test_the_port_matches_the_lab_rule_on_every_session_of_the_sweep():
    """Every session from the first readable one to the last, every series: the same dict or both None. The sweep
    must answer both ways and reach at least eight distinct lab steps (a parity over one branch proves little)."""
    hits = misses = 0
    steps = set()
    for b in _sweep_series():
        for i in range(BD.TREND_N + BD.PLAIN_SMA_RISE_BARS + 40, len(b)):
            why = {}
            want = LAB.plain_base(b, i, why)
            got = BD.plain_geometry(b, i)
            assert got == want, (b[i]["t"], why)
            if want is None:
                misses += 1
                steps.add(why.get("fail"))
            else:
                hits += 1
    assert hits >= 40 and misses >= 1000
    assert len(steps) >= 8, steps


def test_the_port_constants_are_the_lab_constants():
    pairs = {"MAX_LEN": "PLAIN_MAX_LEN", "RIM_TOL_ATR": "PLAIN_RIM_TOL_ATR", "PEAK_LOOK": "PLAIN_PEAK_LOOK",
             "FRAG_LOOK": "PLAIN_FRAG_LOOK", "FRAG_GAP": "PLAIN_FRAG_GAP", "FRAG_PCT": "PLAIN_FRAG_PCT",
             "FRAG_DIP": "PLAIN_FRAG_DIP", "MIN_DEPTH": "PLAIN_MIN_DEPTH", "FLAT_MAX_DEPTH": "PLAIN_FLAT_MAX_DEPTH",
             "MAX_DEPTH": "PLAIN_MAX_DEPTH", "MIN_RANGE_ATR": "PLAIN_MIN_RANGE_ATR",
             "MIN_SESS_FLAT": "PLAIN_MIN_SESS_FLAT", "MIN_SESS_CUP": "PLAIN_MIN_SESS_CUP", "V_DEPTH": "PLAIN_V_DEPTH",
             "V_RIGHT_SHARE": "PLAIN_V_RIGHT_SHARE", "V_LEFT_MIN": "PLAIN_V_LEFT_MIN", "ADV_MIN": "PLAIN_ADV_MIN",
             "ADV_EX_GAP": "PLAIN_ADV_EX_GAP", "RUN_BARS": "PLAIN_RUN_BARS", "RUN_MAX": "PLAIN_RUN_MAX",
             "SMA_RISE_BARS": "PLAIN_SMA_RISE_BARS", "SMA_RISE": "PLAIN_SMA_RISE",
             "SMA_FALL_SHARE": "PLAIN_SMA_FALL_SHARE", "UNDER200_SHARE": "PLAIN_UNDER200_SHARE",
             "BELOW_BP": "PLAIN_BELOW_BP", "ABOVE_BP": "PLAIN_ABOVE_BP", "WICK_MAX_ATR": "PLAIN_WICK_MAX_ATR",
             "WICK_NEAR": "PLAIN_WICK_NEAR", "STG_MIN_BARS": "PLAIN_STG_MIN_BARS",
             "STG_MIN_DEPTH": "PLAIN_STG_MIN_DEPTH", "STG_GAIN": "PLAIN_STG_GAIN", "FRAME_MIN": "PLAIN_FRAME_MIN",
             "FRAME_PAD": "PLAIN_FRAME_PAD", "FRAME_MAX": "PLAIN_FRAME_MAX", "TICK": "PLAIN_TICK",
             "ROUND": "PLAIN_ROUND", "SMA_N": "TREND_N"}
    for lab, port in pairs.items():
        assert getattr(LAB, lab) == getattr(BD, port), lab


# ------------------------------------------------------------------ geometry
def test_a_textbook_base_draws_on_its_left_side_high():
    b = textbook()
    d = BD.plain_geometry(b, _i(b))
    assert d is not None and d["plain_round"] == BD.PLAIN_ROUND and d["label"] == "pivot"
    lip = [x["t"] for x in b].index(d["start_t"])
    assert d["pivot"] == max(x["h"] for x in b[lip:-1])
    assert b[lip]["h"] >= d["pivot"] - BD.PLAIN_RIM_TOL_ATR * d["atr"]
    assert d["low"] == min(x["l"] for x in b[lip:-1])


def _bump(b, k, mult):
    b = json.loads(json.dumps(b))
    b[k]["h"] = round(max(b[k]["o"], b[k]["c"]) * mult, 4)
    return b


def test_a_later_high_above_the_left_side_is_never_the_line():
    """A right-side bar poking 3% over the left-side high: the old drawing put the line there. The plain base
    either draws nothing or starts at that bar, and never draws its line over a region whose left side is lower."""
    b = textbook()
    d0 = BD.plain_geometry(b, _i(b))
    lip = [x["t"] for x in b].index(d0["start_t"])
    k = lip + (_i(b) - lip) * 3 // 4
    b2 = _bump(b, k, max(x["h"] for x in b[lip:-1]) / max(b[k]["o"], b[k]["c"]) * 1.03)
    d = BD.plain_geometry(b2, _i(b2))
    assert d is None or d["start_t"] >= b2[k]["t"]


def test_a_shelf_under_an_older_higher_peak_draws_nothing():
    b = textbook()
    d0 = BD.plain_geometry(b, _i(b))
    lip = [x["t"] for x in b].index(d0["start_t"])
    k = lip - 120
    b2 = _bump(b, k, d0["pivot"] * 1.25 / max(b[k]["o"], b[k]["c"]))
    assert BD.plain_geometry(b2, _i(b2)) is None


@pytest.mark.parametrize("kw", [
    {"base_len": 18, "depth": 0.10},                 # under 5 weeks
    {"base_len": 28, "depth": 0.25},                 # a deep base under 7 weeks
    {"base_len": 60, "depth": 0.45},                 # deeper than the table allows
    {"base_len": 60, "depth": 0.02},                 # a shallow pause, not a base
    {"adv": 0.05},                                   # no prior advance
    {"adv": 1.6, "run_len": 30},                     # straight after a parabolic run
    {"end_below": 0.12},                             # price far under the line
    {"drift": -0.0025},                              # a falling 200-day
])
def test_each_textbook_failure_draws_nothing(kw):
    b = textbook(**kw)
    assert BD.plain_geometry(b, _i(b)) is None, kw


def test_a_v_shaped_base_draws_nothing():
    rnd = random.Random(3)
    b = textbook()
    d0 = BD.plain_geometry(b, _i(b))
    lip = [x["t"] for x in b].index(d0["start_t"])
    n = _i(b) - lip
    top = d0["pivot"]
    closes = [x["c"] for x in b[:lip + 1]]
    for k in range(n):          # straight down for 85% of the base, straight back up
        x = k / (n - 1)
        f = 0.28 * (x / 0.85) if x <= 0.85 else 0.28 * (1 - (x - 0.85) / 0.15)
        closes.append(top * (1 - f) * 0.99 * (1 + rnd.gauss(0, 0.002)))
    b2 = _bars(closes, 77, 0.004)
    assert BD.plain_geometry(b2, _i(b2)) is None


def test_a_lone_spike_wick_as_the_ceiling_draws_nothing():
    b = textbook()
    d0 = BD.plain_geometry(b, _i(b))
    lip = [x["t"] for x in b].index(d0["start_t"])
    b2 = _bump(b, lip, (d0["pivot"] + 3.0 * d0["atr"]) / max(b[lip]["o"], b[lip]["c"]))
    assert BD.plain_geometry(b2, _i(b2)) is None


def test_plain_drawing_applies_the_existing_guards(monkeypatch):
    b = textbook()
    assert BD.plain_drawing(b, _i(b)) == BD.plain_geometry(b, _i(b))
    monkeypatch.setattr(BD, "_pinned", lambda bars: True)
    assert BD.plain_drawing(b, _i(b)) is None
    monkeypatch.setattr(BD, "_pinned", lambda bars: False)
    monkeypatch.setattr(BD, "floor_refuses", lambda bars, i, d: True)
    assert BD.plain_drawing(b, _i(b)) is None


def test_reads_no_later_bar():
    b = textbook(tail=[1.0] * 5)
    i = len(b) - 6
    assert BD.plain_geometry(b, i) == BD.plain_geometry(b[:i + 1], i)


# ------------------------------------------------------------------ label
def _plain_row(b):
    d = BD.plain_drawing(b, _i(b))
    assert d is not None
    row = AS._base_row("SYN", d, BD.BASE_DRAW_ROUND)
    from api.services import base_metrics
    return base_metrics.with_metrics([row], b)[0]


def test_the_buy_point_is_the_base_high_plus_ten_cents_and_the_stage_is_the_drawings():
    b = textbook()
    row = _plain_row(b)
    m = TN.compute(row, b, asof_complete=lambda t: True)
    d = row["geometry"]["extras"]["draw_base"]
    assert m["buy_point"] == round(d["pivot"] + 0.10, 2)
    assert m["line"] == round(d["pivot"], 2)
    assert m["stage"] == d["stage"]


def test_a_plain_row_prints_volume_only_on_a_breakout_session():
    b = textbook()
    b[-1]["v"] = 9e6                       # a notable-volume session BELOW the buy point
    row = _plain_row(b)
    m = TN.compute(row, b, asof_complete=lambda t: True)
    assert "volume" not in m
    # control: the same row without its plain stamp prints the notable-volume line
    nb = dict(row["geometry"]["extras"]["draw_base"])
    nb.pop("plain_round")
    row2 = {**row, "geometry": {**row["geometry"], "extras": {**row["geometry"]["extras"], "draw_base": nb}}}
    m2 = TN.compute(row2, b, asof_complete=lambda t: True)
    assert m2 is None or m2.get("volume", {}).get("breakout") is False


# ------------------------------------------------------------------ release
def _member_row(bd):
    return {"pattern_id": "bc:base", "sym": "ZZZ", "display_tier": "trusted", "start_t": 20250102,
            "end_t": 20250210, "geometry": {"shape": "base_draw", "anchors": [],
                                            "extras": {"draw_base": bd, "draw_round": AS.MEMBER_BASE_ROUND}}}


_BD = {"pivot": 12.0, "low": 10.0, "start_t": 20250102, "end_t": 20250210, "label": "pivot", "low_label": "base low"}


def test_the_released_literal_is_the_plain_round():
    assert AS.MEMBER_BASE_STATELESS_ROUND == BD.PLAIN_ROUND == 6


def test_members_get_the_plain_base_and_never_the_old_stateless_drawing():
    plain, old = dict(_BD, plain_round=6, stage=1), dict(_BD)
    assert [r["pattern_id"] for r in AS.member_rows([_member_row(plain)])] == ["bc:base"]
    assert AS.member_rows([_member_row(old)]) == []
    assert AS.member_rows([_member_row(dict(_BD, plain_round=7))]) == []


def test_a_rollback_to_the_base_round_serves_the_old_drawing_and_none_withholds_both(monkeypatch):
    monkeypatch.setattr(AS, "MEMBER_BASE_STATELESS_ROUND", AS.MEMBER_BASE_ROUND)
    assert [r["pattern_id"] for r in AS.member_rows([_member_row(dict(_BD))])] == ["bc:base"]
    assert AS.member_rows([_member_row(dict(_BD, plain_round=6))]) == []
    monkeypatch.setattr(AS, "MEMBER_BASE_STATELESS_ROUND", None)
    assert AS.member_rows([_member_row(dict(_BD))]) == []
    assert AS.member_rows([_member_row(dict(_BD, plain_round=6))]) == []


def test_base_draw_row_serves_the_plain_drawing_only_under_the_plain_literal(monkeypatch):
    monkeypatch.setattr(AS, "last_bar_forming", lambda t, now=None: False)
    b = textbook()
    row = AS.base_draw_row("SYN", b)
    assert row["geometry"]["extras"]["draw_base"] == BD.plain_drawing(b, _i(b))
    monkeypatch.setattr(AS, "MEMBER_BASE_STATELESS_ROUND", None)
    old = AS.base_draw_row("SYN", b)
    assert old is None or "plain_round" not in old["geometry"]["extras"]["draw_base"]


# ------------------------------------------------------------------ the states are unchanged
def test_every_base_state_row_is_byte_identical_under_the_release(monkeypatch):
    """Every session of the sweep: where base_draw_row builds a STATE row with the literal withheld (None), it builds
    the same bytes with the plain base released, and the release never adds a state row anywhere."""
    monkeypatch.setattr(AS, "last_bar_forming", lambda t, now=None: False)
    states = 0
    for b in _sweep_series()[:12]:
        for i in range(BD.TREND_N + 60, len(b), 3):
            w = b[:i + 1]
            monkeypatch.setattr(AS, "MEMBER_BASE_STATELESS_ROUND", None)
            before = AS.base_draw_row("SYN", w)
            monkeypatch.setattr(AS, "MEMBER_BASE_STATELESS_ROUND", BD.PLAIN_ROUND)
            after = AS.base_draw_row("SYN", w)
            b_state = before is not None and "state" in before["geometry"]["extras"]["draw_base"]
            a_state = after is not None and "state" in after["geometry"]["extras"]["draw_base"]
            assert b_state == a_state
            if b_state:
                states += 1
                assert json.dumps(before, sort_keys=True) == json.dumps(after, sort_keys=True)
    assert states >= 5


def test_the_textbook_gate_never_refuses_a_stateless_row(monkeypatch):
    """The plain base was judged as served WITHOUT member_base_textbook_gate (its geometry is its floors); the gate
    refuses a forming STATE row on the same bars. Control: the state row is refused, so the gate did run."""
    monkeypatch.setattr(AS, "_daily_bars", lambda sym: [{"t": 20250210, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}])
    monkeypatch.setattr(AS, "last_bar_forming", lambda t, now=None: False)
    monkeypatch.setattr(AS, "base_textbook_gate_fails", lambda b, r: "always")
    row = _member_row(dict(_BD, plain_round=6, stage=1))
    st = _member_row(dict(_BD, state="forming", state_round=AS.MEMBER_BASE_FORMING_ROUND))
    _det, boxes = AS.member_base_textbook_gate("ZZZ", [], [row, st])
    assert boxes == [row]


def _flat_then_drop(hi_len, seed=1):
    """A long flat stretch at 50, then a drop to 32: the 200-day still holds the 50s when a later base forms."""
    r = random.Random(seed)
    return ([50 * (1 + r.gauss(0, 0.004)) for _ in range(hi_len)]
            + [32 * (1 + r.gauss(0, 0.004)) for _ in range(320 - hi_len)])


def _gapped(g):
    """Flat at 40, then the whole base lifted by one opening gap of `g`: an advance that is one gap."""
    r = random.Random(2)
    b = textbook(pre=[40 * (1 + r.gauss(0, 0.003)) for _ in range(320)], adv=0.02, run_len=10, base_len=40, depth=0.10)
    for x in b[321:]:
        for f in "ohlc":
            x[f] = round(x[f] * g, 4)
    return b


@pytest.mark.parametrize("step,make", [
    ("deep", lambda: textbook(base_len=90, depth=0.40, adv=0.9, run_len=90)),
    ("deep", lambda: textbook(base_len=80, depth=0.36, adv=0.7, run_len=80, end_below=0.0)),
    ("trend", lambda: textbook(pre=_flat_then_drop(235), adv=0.62, run_len=60, base_len=46, depth=0.10)),
    ("trend_falling", lambda: textbook(pre=_flat_then_drop(215), adv=0.62, run_len=60, base_len=46, depth=0.10)),
    ("gap_advance", lambda: _gapped(1.3)),
])
def test_each_step_alone_decides_its_case(step, make):
    """Charts where exactly one step fails (the lab rule names it as the deciding step): the port draws nothing."""
    b = make()
    why = {}
    assert LAB.plain_base(b, _i(b), why) is None and why.get("fail") == step, why
    assert BD.plain_geometry(b, _i(b)) is None


def test_the_printed_stage_is_the_drawings_stage():
    b = textbook()
    row = _plain_row(b)
    row["geometry"]["extras"]["draw_base"]["stage"] = 3
    assert TN.compute(row, b, asof_complete=lambda t: True)["stage"] == 3


def test_a_rollback_literal_draws_the_old_stateless_drawing_not_the_plain_one(monkeypatch):
    monkeypatch.setattr(AS, "last_bar_forming", lambda t, now=None: False)
    b = textbook()
    monkeypatch.setattr(AS, "MEMBER_BASE_STATELESS_ROUND", AS.MEMBER_BASE_ROUND)
    row = AS.base_draw_row("SYN", b)
    d5 = BD.base_drawing(b, _i(b))
    assert row is None if d5 is None else row["geometry"]["extras"]["draw_base"] == d5
    assert row is None or "plain_round" not in row["geometry"]["extras"]["draw_base"]
