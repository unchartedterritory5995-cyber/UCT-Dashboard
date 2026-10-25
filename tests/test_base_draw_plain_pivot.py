"""Round 7 of the plain base (base_draw.PLAIN_PIVOT_ROUND): the spike-aware buy line and the no-dime buy point.

The SAME plain base as round 6 (same charts, same region, low and stage); only its line moves. When the base's high
is a one-session spike -- isolated more than PIVOT_SPIKE_ATR ATR over the rest of the base and the bars just before
it, or a reversal candle gated by PIVOT_REV_GATE_ATR -- and a contained right-side ceiling exists after it, the line
is that ceiling's median touch. The buy point is the line itself, no +$0.10.

Rails, all on synthetic bars (public repo):
  * PORT PARITY -- the research prototype (tests/fixtures/base_rebuild/pivot_lab.py, sha256 of its LF form pinned)
    and base_draw.plain_pivot agree EXACTLY on seeded series, both on arbitrary windows and end to end through
    plain_drawing on spiked textbook bases; the sweep must reach every branch (moved, spike without a ceiling, an
    uncontained ceiling, a reversal-only spike, no spike);
  * GUARDS -- hand-built bases with an exact ATR(14) of 2.0 pin each guard on both sides of its threshold: the
    spike threshold, the reversal gate, the run-into-the-high refinement (R1), containment (R2), cluster tolerance;
  * LABEL -- a round-7 row's buy point is its line with no +$0.10, its depth still read from the base high; the drawn
    top line keeps the "Buy point X" label;
  * ROUND SWITCH -- MEMBER_BASE_STATELESS_ROUND 6 draws and serves round 6 exactly as before; 7 draws and serves
    round 7 only; any other literal draws neither plain round.
"""
from __future__ import annotations

import datetime
import hashlib
import importlib.util
import json
import os

import pytest

from api.services import auto_structures as AS
from api.services import base_metrics
from api.services import textbook_numbers as TN
from api.services.pattern_engine import base_draw as BD
from tests.test_base_draw_plain import _member_row, textbook, walk

_HERE = os.path.dirname(os.path.abspath(__file__))
_LAB_PATH = os.path.join(_HERE, "fixtures", "base_rebuild", "pivot_lab.py")
#: sha256 of the reference prototype with LF line endings
_LAB_SHA_LF = "aed38a24446f3028b0a5b2704a49d26d92e69cc035e01a676386a041e180d165"
_spec = importlib.util.spec_from_file_location("base_rebuild_pivot_lab", _LAB_PATH)
LAB = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(LAB)


def _lab_pivot(b, lip, i, H=None, L=None):
    return LAB.v7_default(LAB.analyze(b, lip, i, H=H, L=L))


def _prod(b, lip, i):
    H = max(float(x["h"]) for x in b[lip:i])
    L = min(float(x["l"]) for x in b[lip:i])
    return BD.plain_pivot(b, lip, i, H, L, BD._atr(b, i))


# ------------------------------------------------------------------ hand-built bases (ATR(14) at the as-of bar = 2.0)
LIP = 6
#: the base's left side down to its low (low 93 at the 95 bar)
DOWN = [100, 99, 98, 97, 96, 95, 95.5, 96.5, 97.5]
#: the last 15 bars: every step <= 1 so each true range is exactly its 2.0 high-low range; one touch at 100.8
TAIL = [99.0, 99.8, 100.5, 100.8, 100.0, 99.2, 98.6, 98.2, 98.6, 99.2, 99.6, 99.4, 99.0, 98.8, 99.2]
#: the same, every high under the base's midpoint (no touch at all)
LOWTAIL = [98.0, 98.6, 99.0, 98.6, 98.2, 97.8, 97.4, 97.8, 98.2, 98.6, 99.0, 98.6, 98.2, 97.8, 98.2]


def _peak(p):
    return [p - 1.5, p - 0.7, p, p - 0.7, p - 1.5]


def _build(highs, hbar=(106.0, 98.0, 99.0), pre=None, closes=None):
    """Bars from highs (low = high - 2, close = high - 1, open = the prior close held inside the bar). Bars 0-5 are the
    run-up (high 95, or `pre`), bar 6 the base's high (h, l, c) = `hbar`, then `highs`. `closes` overrides by index."""
    pre = list(pre) if pre is not None else [95.0] * LIP
    rows = [(h, h - 2.0, h - 1.0) for h in pre] + [hbar] + [(h, h - 2.0, h - 1.0) for h in highs]
    out, prev, d = [], None, datetime.date(2001, 1, 2)
    for k, (h, lo, c) in enumerate(rows):
        if closes and k in closes:
            c = closes[k]
        o = c if prev is None else min(max(prev, lo), h)
        out.append({"t": int(d.strftime("%Y%m%d")) + 0, "o": float(o), "h": float(h), "l": float(lo), "c": float(c),
                    "v": 1e6})
        prev = c
        d += datetime.timedelta(days=1)
    return out


def _default_highs(a=101.0, b=101.3, tail=TAIL):
    return DOWN + _peak(a) + [97.5] + _peak(b) + [97.5] + list(tail)


def _check(bars):
    """plain_pivot on a hand-built base, asserted equal to the prototype's answer on the same input."""
    i = len(bars) - 1
    got = _prod(bars, LIP, i)
    want = _lab_pivot(bars, LIP, i)
    assert got["pivot"] == want["pivot"] and got["spike"] == bool(want["spike"])
    return got


def test_the_hand_built_atr_is_exactly_two():
    b = _build(_default_highs())
    assert BD._atr(b, len(b) - 1) == pytest.approx(2.0, abs=1e-9)
    b = _build(_default_highs(tail=LOWTAIL))
    assert BD._atr(b, len(b) - 1) == pytest.approx(2.0, abs=1e-9)


def test_a_spike_high_moves_the_line_to_the_median_ceiling_touch():
    r = _check(_build(_default_highs()))
    assert r["spike"] is True
    assert r["pivot"] == 101.0                      # touches 101.0 / 101.3 / 100.8 -> median 101.0
    assert r["ceiling"]["contained"] is True and len(r["ceiling"]["touches"]) == 3


# --- the spike threshold (PIVOT_SPIKE_ATR = 1.0): isolation alone, no reversal (the H bar closes near its high)
def test_isolation_just_over_one_atr_is_a_spike():
    r = _check(_build(_default_highs(), hbar=(103.5, 98.0, 103.0)))     # (103.5 - 101.3) / 2 = 1.1 ATR
    assert r["spike"] is True and r["pivot"] == 101.0


def test_isolation_just_under_one_atr_is_not_a_spike():
    r = _check(_build(_default_highs(), hbar=(103.1, 98.0, 102.6)))     # 0.9 ATR, no reversal
    assert r["spike"] is False and r["pivot"] == 103.1


def test_a_big_isolated_high_that_closes_strong_is_still_a_spike():
    r = _check(_build(_default_highs(), hbar=(106.0, 98.0, 105.0)))     # 2.35 ATR, closes in its upper half
    assert r["spike"] is True and r["pivot"] == 101.0


# --- the reversal gate (PIVOT_REV_GATE_ATR = 0.5): a reversal candle counts only when H clears the rest by 0.5 ATR
def test_a_reversal_candle_above_the_gate_is_a_spike():
    r = _check(_build(_default_highs(), hbar=(103.1, 98.0, 98.5)))      # 0.9 ATR isolation + reversal
    assert r["spike"] is True and r["pivot"] == 101.0


def test_a_reversal_candle_on_a_retested_top_is_not_a_spike():
    r = _check(_build(_default_highs(), hbar=(102.1, 98.0, 98.5)))      # 0.4 ATR isolation + reversal
    assert r["spike"] is False and r["pivot"] == 102.1


# --- R1: the run into the high counts toward isolation
def test_a_high_reached_by_a_run_of_similar_highs_is_not_a_spike():
    pre = [95.0, 95.0, 105.5, 105.5, 105.5, 95.0]    # the 5 bars before the lip (the bar beside it is excluded)
    r = _check(_build(_default_highs(), pre=pre))    # base-only isolation 2.35 ATR, with the run-up 0.25 ATR
    assert r["spike"] is False and r["pivot"] == 106.0


# --- R2: containment
def test_a_ceiling_price_already_closed_through_is_not_the_line():
    highs = DOWN + _peak(101.0) + [97.5] + _peak(102.0) + [97.5] + _peak(101.3) + [97.5] + TAIL
    k = LIP + 1 + len(DOWN) + 5 + 1 + 2              # the 102.0 peak, closing at 101.9
    r = _check(_build(highs, closes={k: 101.9}))
    assert r["spike"] is True
    assert r["ceiling"]["line"] == pytest.approx(101.15) and r["ceiling"]["contained"] is False
    assert r["pivot"] == 106.0


# --- cluster tolerance (PIVOT_CLUSTER_ATR = 0.75)
def test_touches_within_the_tolerance_cluster():
    r = _check(_build(_default_highs(a=100.1, b=101.3, tail=LOWTAIL)))   # 1.2 apart = 0.6 ATR
    assert r["spike"] is True and r["pivot"] == pytest.approx(100.7)


def test_touches_beyond_the_tolerance_do_not_cluster():
    r = _check(_build(_default_highs(a=99.6, b=101.3, tail=LOWTAIL)))    # 1.7 apart = 0.85 ATR
    assert r["spike"] is True and r["ceiling"] is None and r["pivot"] == 106.0


def test_reads_no_bar_after_the_as_of_bar():
    b = _build(_default_highs())
    i = len(b) - 1
    b2 = _build(_default_highs() + [104.0, 105.0, 105.9])   # later bars that would be touches and a new close high
    assert b2[:i + 1] == b
    assert _prod(b, LIP, i)["pivot"] == _prod(b2, LIP, i)["pivot"] == 101.0


# ------------------------------------------------------------------ parity sweep
def test_the_prototype_fixture_is_the_pinned_file():
    raw = open(_LAB_PATH, "rb").read().replace(b"\r\n", b"\n")
    assert hashlib.sha256(raw).hexdigest() == _LAB_SHA_LF


def test_the_port_constants_are_the_prototype_defaults():
    p = LAB.DEFAULT
    assert (p["spike_atr"], p["rev_gate"], p["cluster_atr"], p["cand"], p["pre"], p["contain"]) == (
        BD.PIVOT_SPIKE_ATR, BD.PIVOT_REV_GATE_ATR, BD.PIVOT_CLUSTER_ATR, "median", True, True)
    assert (LAB.REV_ATR, LAB.SWING_K, LAB.MIN_APART, LAB.PRE_BARS, LAB.CONTAIN_ATR) == (
        BD.PIVOT_REV_ATR, BD.PIVOT_SWING_K, BD.PIVOT_MIN_APART, BD.PIVOT_PRE_BARS, BD.PIVOT_CONTAIN_ATR)


def _spiked(seed, depth, x, lift=None):
    """A textbook base whose left-side bar becomes a gap-up-and-reverse candle x ATR over the old high (its body top
    0.9 ATR under the new high, so round 6's lone-wick floor still passes). `lift`: the as-of close is moved to
    `lift` x round 6's buy point (inside round 6's window), so round 7 can read it in or past its own zone."""
    b = textbook(seed=seed, base_len=60 + (seed % 5) * 8, depth=depth, end_below=0.0, noise=0.012)
    i = len(b) - 1
    d0 = BD.plain_geometry(b, i)
    if d0 is None:
        return b
    lip = [y["t"] for y in b].index(d0["start_t"])
    a, H = d0["atr"], d0["pivot"]
    bar = b[lip]
    nh = H + x * a
    bar["h"] = round(nh, 4)
    bar["o"] = round(nh - 0.9 * a, 4)
    bar["c"] = round(bar["l"] + 0.1 * (nh - bar["l"]), 4)
    if lift is not None:
        last = b[i]
        last["c"] = round(round(nh + 0.10, 2) * lift, 4)
        last["h"] = max(last["h"], last["c"])
    return b


def test_the_port_matches_the_prototype_on_arbitrary_windows():
    """Every (lip, i) window on a stride over seeded series: identical line and spike flag. The sweep must reach every
    branch, or it proves little."""
    seen = {"moved": 0, "spike_no_ceiling": 0, "uncontained": 0, "reversal_only": 0, "no_spike": 0}
    n = 0
    series = [_spiked(s, 0.14, 1.6) for s in range(12)] + [walk(s) for s in range(4)]
    for b in series:
        for i in range(260, len(b), 7):
            for span in (25, 40, 70, 120):
                lip = i - span
                got = _prod(b, lip, i)
                res = LAB.analyze(b, lip, i)
                want = LAB.v7_default(res)
                assert got["pivot"] == want["pivot"] and got["spike"] == bool(want["spike"]), (b[i]["t"], span)
                n += 1
                sp = res["spike"]
                c = want["cluster"]
                if not want["spike"]:
                    seen["no_spike"] += 1
                elif want["pivot"] != res["H"]:
                    seen["moved"] += 1
                elif c is None:
                    seen["spike_no_ceiling"] += 1
                else:
                    seen["uncontained"] += 1
                if want["spike"] and sp["iso_pre_atr"] <= BD.PIVOT_SPIKE_ATR:
                    seen["reversal_only"] += 1
    assert n >= 1500
    assert all(v >= 5 for v in seen.values()), seen


#: the spiked-base sweep: seeds x depth x spike size x as-of close (as is, or lifted to 1.045 x round 6's buy point)
_SWEEP = [(s, depth, x, lift) for s in range(40) for depth in (0.10, 0.18) for x in (1.2, 2.2, 4.0)
          for lift in (None, 1.045)]


def _expect_zone(b, line):
    """An independent statement of the round-7 buy zone: the close against round(line, 2), no +$0.10."""
    bp = round(line, 2)
    c = [x["c"] for x in b]
    ci = c[-1]
    if ci < bp * 0.95:
        return None
    if ci < bp:
        return {"zone": "below"}
    over = ci / bp - 1.0
    if over > 0.10:
        return None
    m = len(b) - 1
    while c[m - 1] >= bp:
        m -= 1
    return {"zone": "buy_zone" if over <= 0.05 else "extended", "breakout_t": b[m]["t"]}


def _round6_zone(b, line):
    """Round 6's own reading of the same close: against line + $0.10 (it draws only within 5% of it)."""
    bp = round(line + 0.10, 2)
    return "below" if b[-1]["c"] < bp else "buy_zone"


def test_round_7_end_to_end_matches_the_prototype_on_spiked_bases():
    """plain_drawing(round 7) is round 6's drawing with the prototype's line, plain_round 7, ceiling_high = the round-6
    line, the buy zone measured against the round-7 buy point, and top_label when the line moved -- or nothing, when
    the close sits outside round 7's zone. The sweep must move lines, change zones and drop at least one chart."""
    moved = drawn = changed = dropped = 0
    for s, depth, x, lift in _SWEEP:
        b = _spiked(s, depth, x, lift)
        i = len(b) - 1
        r6 = BD.plain_drawing(b, i)
        r7 = BD.plain_drawing(b, i, plain_round=BD.PLAIN_PIVOT_ROUND)
        if r6 is None:
            assert r7 is None
            continue
        drawn += 1
        lip = [y["t"] for y in b].index(r6["start_t"])
        want = _lab_pivot(b, lip, i, H=r6["pivot"], L=r6["low"])["pivot"]
        z = _expect_zone(b, want)
        if z is None:
            assert r7 is None
            dropped += 1
            continue
        exp = dict(r6, pivot=want, ceiling_high=r6["pivot"], plain_round=BD.PLAIN_PIVOT_ROUND, **z)
        if want < r6["pivot"]:
            exp["top_label"] = "base top"
        assert r7 == exp
        moved += r7["pivot"] != r6["pivot"]
        changed += z["zone"] != _round6_zone(b, r6["pivot"])
    assert drawn >= 200 and moved >= 100 and changed >= 50 and dropped >= 20, (drawn, moved, changed, dropped)


# ------------------------------------------------------------------ the round-7 buy zone
def _zone_bars(last_closes, line=101.0):
    """A hand-built base whose closes before the as-of tail sit under `line`, then `last_closes`."""
    b = _build(_default_highs())
    for k, cl in enumerate(last_closes):
        j = len(b) - len(last_closes) + k
        b[j].update(c=cl, h=max(b[j]["h"], cl), l=min(b[j]["l"], cl))
    return b


@pytest.mark.parametrize("closes,zone,run", [
    ([100.5], "below", None),
    ([101.5, 100.0, 102.0, 103.0], "buy_zone", 1),    # the current run of closes over 101.00 starts one bar back
    ([106.5], "extended", 0),                         # 5.4% over
    ([96.5], "below", None),                          # 4.5% under: still drawn
])
def test_the_buy_zone_is_read_against_the_round_7_buy_point(closes, zone, run):
    b = _zone_bars(closes)
    i = len(b) - 1
    z = BD.plain_pivot_zone(b, LIP, i, 101.0)
    assert z["zone"] == zone
    if run is None:
        assert "breakout_t" not in z
    else:
        assert z["breakout_t"] == b[i - run]["t"]


@pytest.mark.parametrize("close", [95.5, 111.5])   # 5.4% under / 10.4% over the round-7 buy point
def test_round_7_draws_nothing_outside_its_zone(close):
    b = _zone_bars([close])
    assert BD.plain_pivot_zone(b, LIP, len(b) - 1, 101.0) is None


def test_the_zone_is_measured_without_the_dime():
    # 101.05: over the round-7 buy point 101.00, still under round 6's 101.10
    b = _zone_bars([101.05])
    assert BD.plain_pivot_zone(b, LIP, len(b) - 1, 101.0)["zone"] == "buy_zone"
    assert BD.plain_pivot_zone(b, LIP, len(b) - 1, 101.004)["zone"] == "buy_zone"     # rounded to cents first


def _row_with_zone(zone):
    for s, depth, x, lift in _SWEEP:
        b = _spiked(s, depth, x, lift)
        d = BD.plain_drawing(b, len(b) - 1, plain_round=BD.PLAIN_PIVOT_ROUND)
        if d is not None and d["zone"] == zone and d["pivot"] < d["ceiling_high"]:
            return b, base_metrics.with_metrics([AS._base_row("SYN", d, BD.BASE_DRAW_ROUND)], b)[0]
    raise AssertionError("no %s row in the sweep" % zone)


def test_a_round_7_row_in_its_buy_zone_reads_its_breakout_session():
    b, row = _row_with_zone("buy_zone")
    d = row["geometry"]["extras"]["draw_base"]
    m = TN.compute(row, b, asof_complete=lambda t: True)
    assert m["extended"] is False and 0.0 <= m["pct_from_buy_point"] <= 5.0
    bo = [x["t"] for x in b].index(d["breakout_t"])
    assert b[bo]["c"] >= m["buy_point"] and (bo == 0 or b[bo - 1]["c"] < m["buy_point"])


def test_a_round_7_row_past_its_buy_zone_is_extended():
    b, row = _row_with_zone("extended")
    m = TN.compute(row, b, asof_complete=lambda t: True)
    assert m["extended"] is True and m["pct_from_buy_point"] > 5.0


# ------------------------------------------------------------------ the faint base top
def test_a_moved_round_7_line_carries_the_base_top_and_an_unmoved_one_does_not():
    b = _moved_base()
    d = BD.plain_drawing(b, len(b) - 1, plain_round=BD.PLAIN_PIVOT_ROUND)
    assert d["top_label"] == "base top" and d["ceiling_high"] > d["pivot"]
    b0 = textbook()
    d0 = BD.plain_drawing(b0, len(b0) - 1, plain_round=BD.PLAIN_PIVOT_ROUND)
    assert d0 is not None and d0["ceiling_high"] == d0["pivot"] and "top_label" not in d0
    assert "top_label" not in BD.plain_drawing(b, len(b) - 1)                     # round 6: never


def test_the_base_top_is_a_drawn_price_but_never_a_breakout_line():
    b = _moved_base()
    row = _row(b, BD.PLAIN_PIVOT_ROUND)
    row["display_tier"] = "trusted"
    d = row["geometry"]["extras"]["draw_base"]
    prices = AS.sr_served_prices([row])
    assert round(d["ceiling_high"], 4) in prices
    assert all(p != d["ceiling_high"] for p, _s, _e in AS._breakout_lines(row))


# ------------------------------------------------------------------ label: no dime
def _row(b, rnd):
    d = BD.plain_drawing(b, len(b) - 1, plain_round=rnd)
    assert d is not None
    return base_metrics.with_metrics([AS._base_row("SYN", d, BD.BASE_DRAW_ROUND)], b)[0]


def _moved_base():
    for s in range(40):
        b = _spiked(s, 0.14, 1.6)
        d = BD.plain_drawing(b, len(b) - 1, plain_round=BD.PLAIN_PIVOT_ROUND)
        if d is not None and d["pivot"] < d["ceiling_high"]:
            return b
    raise AssertionError("no moved base in the sweep")


def test_a_round_7_buy_point_is_its_line_with_no_dime():
    b = _moved_base()
    row = _row(b, BD.PLAIN_PIVOT_ROUND)
    d = row["geometry"]["extras"]["draw_base"]
    m = TN.compute(row, b, asof_complete=lambda t: True)
    assert m["buy_point"] == round(d["pivot"], 2)
    assert m["line"] == m["buy_point"]
    # the depth is still read from the base's own high, not the lowered line
    assert m["base_high"] == round(d["ceiling_high"], 4)
    assert m["depth_pct"] == base_metrics.depth_pct(d["ceiling_high"], d["low"])
    assert row["geometry"]["extras"]["metrics"]["depth_pct"] == base_metrics.depth_pct(d["ceiling_high"], d["low"])


def test_round_6_keeps_its_dime():
    b = _moved_base()
    row = _row(b, BD.PLAIN_ROUND)
    d = row["geometry"]["extras"]["draw_base"]
    m = TN.compute(row, b, asof_complete=lambda t: True)
    assert m["buy_point"] == round(d["pivot"] + 0.10, 2)
    assert m["line"] == round(m["buy_point"] - 0.10, 2)


def test_the_drawn_top_line_of_a_round_7_row_is_its_buy_point():
    b = _moved_base()
    row = _row(b, BD.PLAIN_PIVOT_ROUND)
    m = TN.compute(row, b, asof_complete=lambda t: True)
    assert AS._drawn_base_top(row["geometry"]["extras"]["draw_base"], m) == m["line"] == m["buy_point"]


# ------------------------------------------------------------------ the round switch
def test_the_literal_stays_on_round_6_until_flipped():
    assert AS.MEMBER_BASE_STATELESS_ROUND == BD.PLAIN_ROUND == 6
    assert BD.PLAIN_PIVOT_ROUND == 7 and BD.PLAIN_ROUNDS == (6, 7)


@pytest.mark.parametrize("rnd", [None, 6])
def test_plain_drawing_round_6_is_unchanged(rnd):
    b = _spiked(39, 0.14, 1.6)
    d = BD.plain_drawing(b, len(b) - 1, plain_round=rnd)
    assert d == BD.plain_geometry(b, len(b) - 1)
    assert d["plain_round"] == 6 and "ceiling_high" not in d


@pytest.mark.parametrize("rnd", [5, 8, True, "7", 7.0])
def test_plain_drawing_draws_nothing_for_any_other_round(rnd):
    b = textbook()
    assert BD.plain_drawing(b, len(b) - 1, plain_round=rnd) is None


def test_base_draw_row_draws_round_6_under_6_and_round_7_under_7(monkeypatch):
    monkeypatch.setattr(AS, "last_bar_forming", lambda t, now=None: False)
    b = _moved_base()
    i = len(b) - 1
    row6 = AS.base_draw_row("SYN", b)
    assert row6["geometry"]["extras"]["draw_base"] == BD.plain_drawing(b, i)
    monkeypatch.setattr(AS, "MEMBER_BASE_STATELESS_ROUND", BD.PLAIN_PIVOT_ROUND)
    row7 = AS.base_draw_row("SYN", b)
    d7 = row7["geometry"]["extras"]["draw_base"]
    assert d7 == BD.plain_drawing(b, i, plain_round=BD.PLAIN_PIVOT_ROUND) and d7["plain_round"] == 7
    assert d7["pivot"] < row6["geometry"]["extras"]["draw_base"]["pivot"]
    assert row7["levels"]["entry"] == d7["pivot"]


_BD = {"pivot": 12.0, "low": 10.0, "start_t": 20250102, "end_t": 20250210, "label": "pivot", "low_label": "base low"}


def test_members_get_only_the_released_plain_round(monkeypatch):
    r6, r7, old = dict(_BD, plain_round=6, stage=1), dict(_BD, plain_round=7, stage=1, ceiling_high=12.5), dict(_BD)
    assert [r["pattern_id"] for r in AS.member_rows([_member_row(r6)])] == ["bc:base"]
    assert AS.member_rows([_member_row(r7)]) == []
    monkeypatch.setattr(AS, "MEMBER_BASE_STATELESS_ROUND", BD.PLAIN_PIVOT_ROUND)
    assert [r["pattern_id"] for r in AS.member_rows([_member_row(r7)])] == ["bc:base"]
    assert AS.member_rows([_member_row(r6)]) == []
    assert AS.member_rows([_member_row(old)]) == []          # never the old stateless drawing under a plain round


def test_every_base_state_row_is_unchanged_under_round_7(monkeypatch):
    """Where base_draw_row builds a STATE row under round 6 it builds the same bytes under round 7."""
    monkeypatch.setattr(AS, "last_bar_forming", lambda t, now=None: False)
    states = 0
    for s in range(10):
        b0 = textbook(seed=s, base_len=26 + (s * 7) % 50, depth=0.06 + (s % 9) * 0.035)
        for i in range(BD.TREND_N + 60, len(b0), 3):
            w = b0[:i + 1]
            monkeypatch.setattr(AS, "MEMBER_BASE_STATELESS_ROUND", BD.PLAIN_ROUND)
            before = AS.base_draw_row("SYN", w)
            monkeypatch.setattr(AS, "MEMBER_BASE_STATELESS_ROUND", BD.PLAIN_PIVOT_ROUND)
            after = AS.base_draw_row("SYN", w)
            b_state = before is not None and "state" in before["geometry"]["extras"]["draw_base"]
            a_state = after is not None and "state" in after["geometry"]["extras"]["draw_base"]
            assert b_state == a_state
            if b_state:
                states += 1
                assert json.dumps(before, sort_keys=True) == json.dumps(after, sort_keys=True)
            elif before is not None:
                assert (after is not None) and after["start_t"] == before["start_t"]
    assert states >= 3
