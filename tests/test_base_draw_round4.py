"""Base drawing ROUND 4 ("textbook consolidation", lab base_draw_v4) against the lab rule itself.

Round 4 returns round 2's drawing wherever round 2 draws one. Only where round 2 draws nothing, a second pass
over round 2's own candidates admits one whose ONLY round-2 failures are a single touch of the pivot region
and/or a lip reached from above, when it also meets the textbook floors (base_draw.TB_*). The lab rule passed
two pre-registered blind packets (A 2.86, B 2.96) and a regression packet (25 of 25 identical).

tests/fixtures/base_draw_r4_parity.json.gz was generated from the LAB's own code (its frozen config, imported
from a checkout of the repo commit the lab ran against) -- never from this module. Each case carries the daily
bars ending at its as-of session (the 600 the structures route hands the drawing, or the full history where
the slice would change the answer) and the lab's answer: its drawing (None = drew nothing), round 2's drawing,
and the base metrics of that drawing. The cases:

  * every one of the 50 blind-judged packet cases (A and B, all drawn by round 4 only) and the 25 regression
    cases (round 2 draws);
  * from the lab's own 3,000-day DEV and 3,000-day held-out coverage samples: every day round 4 adds a drawing,
    seeded subsets where round 2 draws, where a waived candidate reached a textbook floor and was stopped
    there (the near misses, which are what make a moved threshold visible) and where nothing is drawn;
  * 30 sessions with only 200..218 sessions of history, where the rising-average gate cannot be read and
    decides the answer (a search over the lab's samples with that gate disabled in a copy of the lab rule);
  * 20 drawn days with ONE high in the 30 sessions before the lip raised to the lip's high + 0.75 ATR (body
    unchanged): the left-clear HIGH check alone decides no sampled day -- the body check and round 2's own
    gates cover it on 14,000 searched days -- so these make that check visible. The answer is the
    unmodified lab's.

The rail must be able to fail: each control moves ONE threshold and asserts the reproduction breaks.
"""
from __future__ import annotations

import datetime
import gzip
import json
import os

import pytest

from api.services import auto_structures, base_metrics
from api.services.pattern_engine import base_draw as BD

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "base_draw_r4_parity.json.gz")
_DATA = {}


def data():
    if not _DATA:
        with gzip.open(FIXTURE, "rb") as fh:
            _DATA.update(json.loads(fh.read().decode("utf-8")))
    return _DATA


def cases():
    return data()["cases"]


def _bars(c):
    return [{"t": int(r[0]), "o": float(r[1]), "h": float(r[2]), "l": float(r[3]), "c": float(r[4]),
             "v": float(r[5])} for r in c["bars"]]


def _row(d):
    """The row shape the lab computed its metrics on."""
    return {"id": "bc:base:X:%s:%s" % (d["start_t"], d["end_t"]), "pattern_id": "bc:base", "tf": "D",
            "start_t": d["start_t"], "end_t": d["end_t"],
            "geometry": {"shape": "base_draw", "extras": {"draw_base": d, "draw_round": 4}}}


def _answer(c, bars=None, i=None):
    b = bars if bars is not None else _bars(c)
    k = len(_bars(c)) - 1 if i is None else i
    d = BD.base_drawing(b, k, draw_round=4)
    m = base_metrics.compute(_row(d), b[:k + 1]) if d else None
    return d, m


def _mismatches(only=None):
    bad = []
    for c in cases():
        if only is not None and not only(c):
            continue
        d, m = _answer(c)
        e = c["expect"]
        if d != e["draw"] or m != e["metrics"]:
            bad.append((c["id"], e["draw"], d))
    return bad


def _no_round2(c):
    return c["expect"]["round2"] is None


# --------------------------------------------------------------------------- the fixture
def test_the_fixture_is_what_it_says():
    d = data()
    src = d["source"]
    assert src["frozen_cfg"] == {"MIN_LEN_TB": 25, "MAX_DEPTH_TB": 0.35, "MIN_ADV_TB": 0.30, "ADV_WIN": 126,
                                 "REAL_LOW_BARS": 20, "SMA_RISE_BARS": 20, "LEFT_CLEAR_BARS": 30,
                                 "DEAL_VETO": True, "HH_TOL_ATR": 0.5, "LEFT_BODY_CLEAR": True}
    cs = cases()
    ids = [c["id"] for c in cs]
    assert len(set(ids)) == len(ids)
    judged = [c for c in cs if c["id"].startswith("judged/")]
    regress = [c for c in cs if c["id"].startswith("regress/")]
    assert len(judged) == 50 and len(regress) == 25
    assert sum(c["kind"] == "short_history" for c in cs) == 30
    assert sum(c["kind"] == "left_clear_spike" for c in cs) == 20
    # every judged case is drawn by round 4 only; every regression case is drawn by round 2
    assert all(c["expect"]["draw"] is not None and c["expect"]["round2"] is None for c in judged)
    assert all(c["expect"]["round2"] is not None and c["expect"]["draw"] == c["expect"]["round2"] for c in regress)
    # the two halves of the lab's coverage sample, and every class in each
    for half in ("dev", "held"):
        kinds = {c["kind"] for c in cs if c["id"].startswith(half + "/")}
        assert kinds == {"new_only", "same", "near_miss", "neither"}, (half, kinds)
        assert sum(c["kind"] == "new_only" for c in cs if c["id"].startswith(half + "/")) == \
            src["class_counts"][half]["new_only"]
    # non-vacuity: drawings round 2 does not make, AND near misses each textbook floor stopped
    assert sum(c["expect"]["draw"] is not None and c["expect"]["round2"] is None for c in cs) >= 80
    stopped = {g for c in cs for g in c["expect"]["near_miss"]}
    assert {"tb_len", "tb_depth", "tb_higher_high_inside", "tb_left_not_clear", "tb_left_body_above",
            "tb_not_real_low", "tb_advance", "tb_200_not_rising", "tb_short_history"} <= stopped, stopped
    assert all(len(c["bars"]) >= 261 for c in cs if c["kind"] != "short_history")
    assert all(200 <= len(c["bars"]) <= 218 for c in cs if c["kind"] == "short_history")


def test_the_constants_are_the_labs_frozen_config():
    cfg = data()["source"]["frozen_cfg"]
    assert BD.TB_MIN_LEN == cfg["MIN_LEN_TB"] and BD.TB_MAX_DEPTH == cfg["MAX_DEPTH_TB"]
    assert BD.TB_MIN_ADV == cfg["MIN_ADV_TB"] and BD.TB_ADV_WIN == cfg["ADV_WIN"]
    assert BD.TB_REAL_LOW_BARS == cfg["REAL_LOW_BARS"] and BD.TB_SMA_RISE_BARS == cfg["SMA_RISE_BARS"]
    assert BD.TB_HH_TOL_ATR == cfg["HH_TOL_ATR"] and BD.TB_LEFT_CLEAR_BARS == cfg["LEFT_CLEAR_BARS"]
    assert BD.TB_LEFT_BODY_CLEAR is cfg["LEFT_BODY_CLEAR"] is True


# --------------------------------------------------------------------------- parity
def test_production_reproduces_the_lab_on_every_case():
    """Same answer on every case: drawn or not, and where drawn the same pivot, span (lip .. as-of), low, length,
    ATR and labels (the whole drawing dict), and the same metrics on it."""
    assert _mismatches() == []


def test_the_judged_cases_reproduce_the_keys_recorded_facts():
    for c in cases():
        if not c["id"].startswith("judged/"):
            continue
        d, m = _answer(c)
        assert d is not None and BD.base_drawing(_bars(c), len(c["bars"]) - 1, draw_round=2) is None, c["id"]
        assert d == c["expect"]["draw"] and m == c["expect"]["metrics"], c["id"]


def test_round_four_is_round_two_wherever_round_two_draws():
    seen = 0
    for c in cases():
        b = _bars(c)
        i = len(b) - 1
        d2 = BD.base_drawing(b, i, draw_round=2)
        assert d2 == c["expect"]["round2"], c["id"]
        if d2 is not None:
            seen += 1
            assert BD.base_drawing(b, i, draw_round=4) == d2, c["id"]
    assert seen >= 100


# --------------------------------------------------------------------------- the rail can fail
@pytest.mark.parametrize("name,value", [
    ("TB_MIN_LEN", 35), ("TB_MAX_DEPTH", 0.25), ("TB_MIN_ADV", 0.50), ("TB_ADV_WIN", 63),
    ("TB_REAL_LOW_BARS", 60), ("TB_SMA_RISE_BARS", 60), ("TB_HH_TOL_ATR", 0.0), ("TB_LEFT_CLEAR_BARS", 0),
    ("TB_LEFT_BODY_CLEAR", False),
])
def test_control_moving_one_threshold_breaks_the_reproduction(monkeypatch, name, value):
    monkeypatch.setattr(BD, name, value)
    assert _mismatches(only=_no_round2), f"moving {name} to {value} changed nothing the rail can see"


def test_control_the_deal_veto_is_seen(monkeypatch):
    """Without the veto (price_pinned never fires) the drawings are unchanged on these cases, so the veto is
    proven separately: forcing it makes every new drawing disappear."""
    from api.services import deal_status
    monkeypatch.setattr(deal_status, "price_pinned", lambda bars, deal_price=None: {"gap_date": "x"})
    for c in cases():
        if c["expect"]["draw"] is not None and c["expect"]["round2"] is None:
            assert _answer(c)[0] is None, c["id"]
        elif c["expect"]["round2"] is not None:
            assert _answer(c)[0] == c["expect"]["round2"], c["id"]   # round 2's drawing is never vetoed


# --------------------------------------------------------------------------- no lookahead
def _wild(bars, n=30):
    t = datetime.datetime.strptime(str(bars[-1]["t"]), "%Y%m%d").date()
    out = list(bars)
    while len(out) < len(bars) + n:
        t += datetime.timedelta(days=1)
        if t.weekday() < 5:
            c = bars[-1]["c"] * (1.5 if (len(out) - len(bars)) % 2 else 0.6)
            out.append({"t": int(t.strftime("%Y%m%d")), "o": c, "h": c * 1.05, "l": c * 0.95, "c": c, "v": 1e7})
    return out


def test_no_lookahead_drawing_and_metrics():
    """The drawing and its metrics at the as-of session are the same with 30 wild future sessions appended."""
    drawn = 0
    for c in cases():
        b = _bars(c)
        i = len(b) - 1
        a0 = _answer(c, b, i)
        a1 = _answer(c, _wild(b), i)
        assert a0 == a1, c["id"]
        drawn += a0[0] is not None and c["expect"]["round2"] is None
    assert drawn >= 80


def test_control_a_drawer_that_peeks_one_bar_is_caught():
    """The lookahead check can see a leak: the drawing taken one session later differs on some cases."""
    caught = 0
    for c in cases():
        b = _bars(c)
        i = len(b) - 1
        ext = _wild(b)
        caught += BD.base_drawing(ext, i + 1, draw_round=4) != BD.base_drawing(b, i, draw_round=4)
    assert caught > 0


# --------------------------------------------------------------------------- the member row on real bars
def test_the_member_row_is_built_from_the_drawing_exactly():
    """A member is served `_base_row` of exactly the drawing compared above, with the same metrics."""
    for c in cases():
        e = c["expect"]
        if e["draw"] is None:
            continue
        row = auto_structures._base_row("SYN", e["draw"], BD.BASE_DRAW_ROUND)
        assert base_metrics.compute(row, _bars(c)) == e["metrics"], c["id"]
