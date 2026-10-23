"""Textbook (IBD-style) numbers beside the base drawing (api/services/textbook_numbers.py), and their gates.

Rails, each on hand-built bars whose answer follows from the textbook definition:
  * the buy point is the base's pivot HIGH (a wick, not a body) + $0.10, never the as-of bar's high; the cup
    pivots on its handle high; the buy zone runs to +5%; depth is read from the base high;
  * the stage count walks every base type (flat, cup, double bottom), opens a stage only on a 20% gain from
    the prior buy point with the new base above it, resets on an undercut or a decline, and is omitted
    whenever the chain is not anchored;
  * the volume readout: breakout volume at or above the buy point (light under 40%), below it only when
    notable, never on a forming bar;
  * no lookahead; AUTO_STRUCTURES_TEXTBOOK_NUMBERS_ENABLED off leaves every payload byte-identical and runs
    nothing; a member never sees the textbook numbers until MEMBER_TEXTBOOK_ROUND is released.
Synthetic bars only (public repo).
"""
from __future__ import annotations

import copy
import datetime
import json

import pytest

import api.routers.patterns as patterns_router  # noqa: F401 -- registers every detector
from api.services import auto_structures, base_metrics, textbook_numbers as tn
from tests.authclients import ADMIN, PAID_MEMBER
from tests.test_base_draw_member_drawing import _synth
from tests.test_base_metrics import _serve, _today
from tests.test_member_drawing_set import _flags, _get


@pytest.fixture(autouse=True)
def _complete_sessions(monkeypatch):
    monkeypatch.setattr(auto_structures, "last_bar_forming", lambda t, now=None: False)


# -- fixtures ---------------------------------------------------------------------------------------

def _dates(n, start=datetime.date(2023, 1, 2)):
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(int(d.strftime("%Y%m%d")))
        d += datetime.timedelta(days=1)
    return out


def _hand(rows, vol=1e6):
    """Bars from (o, h, l, c) tuples, one session each."""
    ts = _dates(len(rows))
    return [{"t": t, "o": o, "h": h, "l": l, "c": c, "v": vol} for t, (o, h, l, c) in zip(ts, rows)]


def _path(start, legs, vol=1e6):
    """Bars along a close path: start, then each (n, target) leg interpolated linearly over n sessions;
    h = c x 1.01, l = c x 0.99, o = the previous close. Returns (bars, [index of each leg's last bar])."""
    closes, ends, c = [float(start)], [], float(start)
    for n, target in legs:
        for k in range(1, n + 1):
            closes.append(c + (target - c) * k / n)
        c = float(target)
        ends.append(len(closes) - 1)
    ts = _dates(len(closes))
    bars, prev = [], closes[0]
    for t, cl in zip(ts, closes):
        bars.append({"t": t, "o": prev, "h": round(cl * 1.01, 6), "l": round(cl * 0.99, 6), "c": cl, "v": vol})
        prev = cl
    return bars, ends


def _base_row(b, start_i, pivot, low, asof_i=None, metrics=True):
    asof_i = len(b) - 1 if asof_i is None else asof_i
    d = {"pivot": pivot, "start_t": b[start_i]["t"], "end_t": b[asof_i]["t"], "low": low,
         "low_t": b[start_i]["t"], "bars": asof_i - start_i, "label": "pivot", "low_label": "base low"}
    row = {"id": "bc:base:SYN", "pattern_id": "bc:base", "sym": "SYN", "start_t": d["start_t"],
           "end_t": d["end_t"], "geometry": {"shape": "base_draw", "extras": {"draw_base": d, "draw_round": 2}}}
    if metrics:
        row = base_metrics.with_metrics([row], b)[0]
    return row


# A flat 9-bar base: bodies top out at 50.00, ONE wick reaches 51.20; the as-of bar (last) spikes to 60.
FLAT = [(49.0, 49.6, 48.6, 49.5), (49.5, 50.3, 49.2, 50.0), (50.0, 51.2, 49.4, 49.6),   # the wick: 51.20
        (49.6, 49.9, 47.0, 47.5), (47.5, 48.0, 46.0, 46.4), (46.4, 47.9, 46.1, 47.8),
        (47.8, 49.4, 47.6, 49.2), (49.2, 50.1, 48.9, 49.9), (49.9, 50.2, 49.3, 49.8),
        (49.8, 60.0, 49.7, 52.0)]                                                         # as-of: high 60


# -- the buy point ----------------------------------------------------------------------------------

def test_the_buy_point_is_the_highest_HIGH_plus_ten_cents_not_the_body_or_the_as_of_bar():
    b = _hand(FLAT)
    m = tn.compute(_base_row(b, 0, pivot=50.0, low=46.0), b)
    assert m["buy_point"] == 51.30                           # 51.20 + 0.10 (the body top is 50.00)
    assert m["base_high"] == 51.2
    assert m["buy_zone_top"] == round(51.30 * 1.05, 2) == 53.87    # 53.865
    assert m["pct_from_buy_point"] == round((52.0 - 51.30) / 51.30 * 100, 1) == 1.4
    assert m["depth_pct"] == round((51.2 - 46.0) / 51.2 * 100, 1) == 10.2   # from the base HIGH
    assert m["extended"] is False


def test_extended_past_the_buy_zone():
    rows = [r for r in FLAT[:-1]] + [(55.0, 56.0, 54.0, 55.0)]
    m = tn.compute(_base_row(_hand(rows), 0, pivot=50.0, low=46.0), _hand(rows))
    assert m["pct_from_buy_point"] == round((55.0 - 51.30) / 51.30 * 100, 1) == 7.2
    assert m["extended"] is True


def test_a_cup_pivots_on_its_handle_high_and_on_its_rim_without_one():
    b = _hand(FLAT)
    row = {"id": "cup", "pattern_id": "bc:cup-with-handle", "end_t": b[-1]["t"], "geometry": {"extras": {
        "draw_pivot": {"start_t": b[6]["t"], "end_t": b[-1]["t"], "price": 50.0},
        "draw_rim_ref": {"start_t": b[0]["t"], "end_t": b[-1]["t"], "price": 50.0},
        "draw_handle": {"start_t": b[6]["t"], "end_t": b[8]["t"], "top": 50.2, "floor": 48.9}}}}
    assert tn.compute(row, b)["buy_point"] == 50.30           # the handle's high 50.20 + 0.10
    del row["geometry"]["extras"]["draw_handle"]
    assert tn.compute(row, b)["buy_point"] == 51.30           # no handle: the rim's (left-side) high


def test_a_flat_base_pivots_on_the_highest_high_of_its_drawn_span():
    b = _hand(FLAT)
    row = {"id": "fb", "pattern_id": "bc:flat-base", "end_t": b[-1]["t"], "geometry": {"extras": {
        "top": 51.2, "floor": 46.0, "draw_pivot": {"start_t": b[3]["t"], "end_t": b[-1]["t"], "price": 50.0}}}}
    assert tn.compute(row, b)["buy_point"] == 50.30           # bars 3..8: highest high 50.20


def test_nonsense_in_nothing_out():
    b = _hand(FLAT)
    row = _base_row(b, 0, pivot=50.0, low=46.0)
    assert tn.buy_point(0) is None and tn.buy_point(None) is None and tn.buy_point(10) == 10.1
    assert tn.compute(row, b[:-1]) is None                    # the as-of bar is not in the series
    assert tn.compute({**row, "pattern_id": "bull_flag"}, b) is None
    assert tn.compute(None, b) is None and tn.compute(row, None) is None
    bad = copy.deepcopy(row)
    del bad["geometry"]["extras"]["draw_base"]
    assert tn.compute(bad, b) is None


# -- the stage count --------------------------------------------------------------------------------

def _chain_series(d_low=166.0):
    """An advance through three bases of THREE different shapes, then the current base:
        A flat base (100 -> 90 -> 100), stage 1 (the series is the full history from the listing);
        B cup / U (130 -> 106 -> 130) after a +30% advance, above A's buy point: stage 2;
        C double bottom / W (165 -> 140 -> 155 -> 138 -> 165) after +27%, above B's buy point: stage 3;
        D the current base (180 -> d_low -> 178) after only +9%: a base-on-base, still stage 3.
    Returns (bars, index of D's left-side high)."""
    legs = [(40, 100),                                        # the advance from the listing
            (15, 90), (15, 100),                              # A: flat
            (20, 130),
            (10, 112), (10, 106), (10, 112), (10, 130),       # B: rounded U
            (20, 165),
            (12, 140), (10, 155), (12, 138), (12, 165),       # C: W, the second low undercutting the first
            (12, 180),
            (12, d_low), (12, 178)]                           # D: the current base, then the as-of bar
    b, ends = _path(50, legs)
    b.append({**b[-1], "t": _dates(len(b) + 1)[-1], "o": 178.0, "h": 179.0, "l": 177.0, "c": 178.5})
    return b, ends[13]


def test_every_base_type_counts_in_the_walk():
    b, d_i = _chain_series()
    events, _, _ = tn._chain(b, d_i)
    bases = [e for e in events if e["kind"] == "base"]
    assert len(bases) == 3 and not [e for e in events if e["kind"] == "reset"]
    assert [round(e["lh"], 2) for e in bases] == [101.0, 131.3, 166.65]   # flat, cup, double bottom


def test_the_stage_counts_across_base_types_and_holds_on_a_base_on_base():
    b, d_i = _chain_series()
    assert tn.stage_count(b, d_i, full_history=True) == 3


def test_a_twenty_percent_advance_opens_the_next_stage():
    # D's left-side high pushed to 210 (+26% over C's buy point 166.75): stage 4
    b, d_i = _chain_series()
    legs_b, _ = _path(50, [(40, 100), (15, 90), (15, 100), (20, 130), (10, 112), (10, 106), (10, 112),
                           (10, 130), (20, 165), (12, 140), (10, 155), (12, 138), (12, 165), (12, 210),
                           (12, 196), (12, 208)])
    legs_b.append({**legs_b[-1], "t": _dates(len(legs_b) + 1)[-1], "o": 208.0, "h": 209.0, "l": 207.0,
                   "c": 208.5})
    assert tn.stage_count(legs_b, d_i, full_history=True) == 4


def test_an_undercut_of_the_prior_base_low_resets_to_stage_one():
    b, d_i = _chain_series(d_low=125.0)          # D falls under C's low (136.6): the count resets
    assert tn.stage_count(b, d_i, full_history=True) == 1


def test_an_unanchored_chain_prints_no_stage():
    b, d_i = _chain_series()
    assert tn.stage_count(b, d_i, full_history=False) is None   # the history may start mid-advance
    # ... but an undercut inside the window anchors it, unknown history or not
    b, d_i = _chain_series(d_low=125.0)
    assert tn.stage_count(b, d_i, full_history=False) == 1


def test_a_decline_resets_the_count_and_the_first_base_after_it_is_stage_one():
    # 100 -> 200, a 60% decline to 80 (a reset), a rally, base E (110 -> 98 -> 110), +27% to 140, base F
    b, ends = _path(100, [(40, 200), (40, 80), (20, 110), (15, 98), (15, 110), (15, 140), (12, 126), (12, 138)])
    b.append({**b[-1], "t": _dates(len(b) + 1)[-1], "o": 138.0, "h": 139.0, "l": 137.0, "c": 138.5})
    f_i = ends[5]
    events, _, _ = tn._chain(b, f_i)
    assert [e["kind"] for e in events] == ["reset", "base"]
    assert tn.stage_count(b, f_i, full_history=False) == 2     # E = 1 after the decline, F = 2


def test_a_drawn_base_under_a_higher_left_side_high_is_counted_as_that_whole_correction():
    # the drawn base starts on D's right side, under D's left-side high: still D, still stage 3
    b, d_i = _chain_series()
    assert tn.stage_count(b, d_i + 14, full_history=True) == 3
    # ... and that whole correction's low is what is checked for the undercut: D fell to 123.75, under C's
    # low, while the drawn right side (from 151.50) never did -- it is stage 1, not stage 3
    b, d_i = _chain_series(d_low=125.0)
    assert min(x["l"] for x in b[d_i + 18:-1]) > 136.62
    assert tn.stage_count(b, d_i + 18, full_history=True) == 1
    # ... and the new left-side high is the whole correction's: D peaks at 210 (+26% over C's buy point
    # 166.75) and the drawn right side tops out at 199.98, under the 20% line (200.10): stage 4, not 3
    legs_b, _ = _path(50, [(40, 100), (15, 90), (15, 100), (20, 130), (10, 112), (10, 106), (10, 112),
                           (10, 130), (20, 165), (12, 140), (10, 155), (12, 138), (12, 165), (12, 210),
                           (12, 185), (12, 198)])
    legs_b.append({**legs_b[-1], "t": _dates(len(legs_b) + 1)[-1], "o": 198.0, "h": 198.5, "l": 197.0,
                   "c": 198.2})
    assert max(x["h"] for x in legs_b[d_i + 18:-1]) < 166.75 * 1.2 < 210 * 1.01
    assert tn.stage_count(legs_b, d_i + 18, full_history=True) == 4


def test_a_twenty_percent_advance_does_not_open_a_stage_when_the_new_base_falls_back_under_the_buy_point():
    # D's left-side high is +26% over C's buy point, but D corrects to 160 (under C's buy point 166.75, above
    # C's low 136.62): it did not form ABOVE the prior buy point, so it is a base-on-base -- stage 3
    b, d_i = _chain_series()
    legs_b, _ = _path(50, [(40, 100), (15, 90), (15, 100), (20, 130), (10, 112), (10, 106), (10, 112),
                           (10, 130), (20, 165), (12, 140), (10, 155), (12, 138), (12, 165), (12, 210),
                           (12, 160), (12, 208)])
    legs_b.append({**legs_b[-1], "t": _dates(len(legs_b) + 1)[-1], "o": 208.0, "h": 209.0, "l": 207.0,
                   "c": 208.5})
    assert tn.stage_count(legs_b, d_i, full_history=True) == 3


# -- volume -----------------------------------------------------------------------------------------

def _vol_series(last_close, last_vol, n=60):
    rows = [(10.0, 10.2, 9.8, 10.0)] * (n - 1) + [(10.0, max(10.2, last_close), 9.9, last_close)]
    b = _hand(rows)
    b[-1]["v"] = last_vol
    return b


@pytest.mark.parametrize("close,vol,want", [
    (10.5, 1.62e6, {"vol_pct": 62, "breakout": True, "light": False}),   # a breakout on +62%
    (10.5, 1.40e6, {"vol_pct": 40, "breakout": True, "light": False}),   # the IBD minimum exactly
    (10.5, 1.22e6, {"vol_pct": 22, "breakout": True, "light": True}),    # a breakout on light volume
    (10.3, 1.0e6, {"vol_pct": 0, "breakout": True, "light": True}),      # AT the buy point counts
    (9.9, 1.50e6, {"vol_pct": 50, "breakout": False, "light": False}),   # below it, notable
    (9.9, 0.55e6, {"vol_pct": -45, "breakout": False, "light": False}),  # below it, a dry-up
    (9.9, 1.20e6, None),                                                 # below it, ordinary: nothing
])
def test_the_volume_readout(close, vol, want):
    assert tn.volume_readout(_vol_series(close, vol), 10.30, True) == want


def test_never_volume_on_a_forming_or_unconfirmed_bar_or_without_a_full_average():
    b = _vol_series(10.5, 1.62e6)
    assert tn.volume_readout(b, 10.30, False) is None
    assert tn.volume_readout(b[-50:], 10.30, True) is None          # 49 prior sessions: no 50-day average
    row = _base_row(b, 40, pivot=10.0, low=9.8)
    assert "volume" in tn.compute(row, b, asof_complete=lambda t: True)
    assert "volume" not in tn.compute(row, b, asof_complete=lambda t: False)
    assert "volume" not in tn.compute(row, b)                        # no clock: not complete

    def boom(t):
        raise RuntimeError("clock")
    assert "volume" not in tn.compute(row, b, asof_complete=boom)


# -- no lookahead -----------------------------------------------------------------------------------

def test_appending_future_bars_changes_no_number():
    b, d_i = _chain_series()
    row = _base_row(b, d_i, pivot=180.0, low=164.0)
    fut, _ = _path(400, [(30, 90)])
    ts = _dates(len(b) + len(fut))[len(b):]
    longer = b + [{**x, "t": t, "v": 9e9} for x, t in zip(fut, ts)]
    got = tn.compute(row, b, asof_complete=lambda t: True, full_history=True)
    assert got is not None and got.get("stage") == 3
    assert tn.compute(row, longer, asof_complete=lambda t: True, full_history=True) == got


def test_with_textbook_only_on_rows_with_metrics_and_never_mutates():
    b = _hand(FLAT)
    row = _base_row(b, 0, pivot=50.0, low=46.0)
    plain = _base_row(b, 0, pivot=50.0, low=46.0, metrics=False)
    other = {"id": "x", "pattern_id": "draw:inside-day", "geometry": {"extras": {}}}
    before = copy.deepcopy([row, plain, other])
    out = tn.with_textbook([row, plain, other], b)
    assert [row, plain, other] == before
    assert out[1] is plain and out[2] is other
    ex = out[0]["geometry"]["extras"]
    assert ex["metrics_textbook_round"] == tn.TEXTBOOK_ROUND and ex["metrics_textbook"]["buy_point"] == 51.30
    assert list(ex)[:-2] == list(row["geometry"]["extras"])          # appended after the metrics keys


# -- the gates --------------------------------------------------------------------------------------

def _plain_payload(monkeypatch, user):
    """The payload with the textbook step replaced by the identity: what the route served before it."""
    with monkeypatch.context() as m:
        m.setattr(auto_structures, "_with_textbook", lambda rows, bars: rows)
        return _get(user).content


@pytest.mark.parametrize("user", [ADMIN, PAID_MEMBER], ids=["admin", "member"])
@pytest.mark.parametrize("flag", [None, "0", "false"])
def test_flag_off_the_payload_is_byte_identical_and_nothing_runs(monkeypatch, user, flag):
    b = _synth()
    _flags(monkeypatch, True, True)
    monkeypatch.setenv("AUTO_STRUCTURES_METRICS_ENABLED", "1")
    _serve(monkeypatch, [auto_structures.base_draw_row("SYN", b)], b)
    if flag is None:
        monkeypatch.delenv("AUTO_STRUCTURES_TEXTBOOK_NUMBERS_ENABLED", raising=False)
    else:
        monkeypatch.setenv("AUTO_STRUCTURES_TEXTBOOK_NUMBERS_ENABLED", flag)
    want = _plain_payload(monkeypatch, user)
    calls = []
    monkeypatch.setattr(tn, "compute", lambda *a, **k: calls.append(1))   # counted, never raised
    got = _get(user).content
    assert got == want and b"metrics_textbook" not in got and b'"metrics"' in got
    assert calls == []


@pytest.mark.parametrize("user", [ADMIN, PAID_MEMBER], ids=["admin", "member"])
def test_textbook_on_but_metrics_off_computes_nothing(monkeypatch, user):
    b = _synth()
    _flags(monkeypatch, True, True)
    monkeypatch.delenv("AUTO_STRUCTURES_METRICS_ENABLED", raising=False)
    monkeypatch.setenv("AUTO_STRUCTURES_TEXTBOOK_NUMBERS_ENABLED", "1")
    _serve(monkeypatch, [auto_structures.base_draw_row("SYN", b)], b)
    got = _get(user).content
    assert got == _today(monkeypatch, user) and b"metrics" not in got


def test_flag_on_an_admin_sees_the_textbook_numbers(monkeypatch):
    b = _synth()
    _flags(monkeypatch, True, True)
    monkeypatch.setenv("AUTO_STRUCTURES_METRICS_ENABLED", "1")
    monkeypatch.setenv("AUTO_STRUCTURES_TEXTBOOK_NUMBERS_ENABLED", "1")
    _serve(monkeypatch, [auto_structures.base_draw_row("SYN", b)], b)
    ex = _get(ADMIN).json()["structures"][0]["geometry"]["extras"]
    row = base_metrics.with_metrics([auto_structures.base_draw_row("SYN", b)], b)[0]
    assert ex["metrics_textbook"] == json.loads(json.dumps(tn.compute(
        row, b, asof_complete=auto_structures.last_bar_complete, full_history=True)))
    assert ex["metrics_textbook_round"] == tn.TEXTBOOK_ROUND
    assert ex["metrics"] == base_metrics.compute(row, b)                # the confirmed metrics stay beside


def test_the_member_textbook_round_is_not_released():
    """None until the new label passes its own blind check; then set by hand to TEXTBOOK_ROUND."""
    assert auto_structures.MEMBER_TEXTBOOK_ROUND is None
    assert tn.TEXTBOOK_ROUND == 1


@pytest.mark.parametrize("member_round,shown", [
    (None, False), (1, True), (2, False), ("1", False), (True, False), (1.0, False)])
def test_a_member_sees_the_textbook_numbers_only_on_the_released_round(monkeypatch, member_round, shown):
    b = _synth()
    _flags(monkeypatch, True, True)
    _serve(monkeypatch, [auto_structures.base_draw_row("SYN", b)], b)
    monkeypatch.setenv("AUTO_STRUCTURES_METRICS_ENABLED", "1")
    monkeypatch.setenv("AUTO_STRUCTURES_TEXTBOOK_NUMBERS_ENABLED", "1")
    monkeypatch.setattr(auto_structures, "MEMBER_TEXTBOOK_ROUND", member_round)
    got = _get(PAID_MEMBER)
    ex = got.json()["structures"][0]["geometry"]["extras"]
    assert "metrics" in ex                                              # the confirmed metrics either way
    assert ("metrics_textbook" in ex) is shown and ("metrics_textbook_round" in ex) is shown
    if not shown:   # an unreleased round serves the member exactly the metrics-only payload
        assert got.content == _plain_payload(monkeypatch, PAID_MEMBER)


def test_the_member_strip_returns_a_row_without_textbook_keys_untouched():
    row = {"pattern_id": "bc:base", "geometry": {"extras": {"metrics": {}, "metrics_round": 1}}}
    assert auto_structures._member_textbook(row) is row
