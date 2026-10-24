"""The member textbook gate (auto_structures.member_base_textbook_gate / base_textbook_gate_fails): a member base drawing
(bc:base, flat_base, bc:flat-base) is drawn only where its own region meets the textbook floors. Lab
recert/A_bases round r2. Synthetic bars only; every floor has a case that passes and a case that fails on it."""
import datetime

import pytest

from api.services import auto_structures as AS


def _days(n, start=datetime.date(2024, 1, 2)):
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(int(d.strftime("%Y%m%d")))
        d += datetime.timedelta(days=1)
    return out


def _bars(closes, spread=0.01):
    ts = _days(len(closes))
    return [{"t": t, "o": c, "h": c * (1 + spread), "l": c * (1 - spread), "c": c, "v": 1e6}
            for t, c in zip(ts, closes)]


def textbook_series(base_len=35, depth=0.15, advance=0.60, pre_trend=0.0015, spike_at=None, pin=False):
    """300 sessions of a slow uptrend, an advance of `advance` over 60 sessions into a left-side high, then a
    `base_len`-session base that dips `depth` and recovers to just under the high."""
    c, closes = 50.0, []
    for _ in range(300):
        c *= 1 + pre_trend
        closes.append(c)
    lo = c
    for k in range(60):
        closes.append(lo * (1 + advance) ** ((k + 1) / 60))
    top = closes[-1]
    half = base_len // 2
    body = base_len - 6
    for k in range(body):
        f = k / half if k < half else (body - k) / (body - half)
        closes.append(top * (1 - depth * f * 0.9))
    for k in range(6):          # the right side tests the ceiling for a week: the high is not one lone bar
        closes.append(top * (0.99 if k % 2 else 0.995))
    b = _bars(closes)
    if spike_at is not None:
        j = len(b) - base_len + spike_at
        b[j] = {**b[j], "h": top * 1.10}
    if pin:
        for j in range(len(b) - 60, len(b)):
            b[j] = {**b[j], "o": top, "h": top * 1.002, "l": top * 0.998, "c": top}
    return b, len(b) - base_len


def base_row(b, s, pid="bc:base", state=None):
    if pid == "bc:base":
        bd = {"pivot": max(x["c"] for x in b[s:]), "start_t": b[s]["t"], "end_t": b[-1]["t"],
              "low": min(x["l"] for x in b[s:]), "label": "pivot", "low_label": "base low"}
        if state:
            bd["state"] = state
        ex = {"draw_base": bd}
    else:
        ex = {"draw_pivot": {"start_t": b[s]["t"], "end_t": b[-1]["t"], "price": max(x["h"] for x in b[s:])}}
    return {"pattern_id": pid, "start_t": b[s]["t"], "geometry": {"shape": "base_box", "extras": ex}}


def test_a_textbook_base_passes_every_floor():
    b, s = textbook_series()
    for pid in ("bc:base", "flat_base", "bc:flat-base"):
        depth = 0.10 if pid != "bc:base" else 0.15
        b, s = textbook_series(depth=depth)
        assert AS.base_textbook_gate_fails(b, base_row(b, s, pid)) is None, pid


@pytest.mark.parametrize("kw,why", [
    ({"base_len": 20}, "length"),
    ({"depth": 0.45}, "depth"),
    ({"spike_at": 15}, "mid_base_high"),
    ({"advance": 0.10}, "advance"),
])
def test_each_floor_refuses_its_own_failure(kw, why):
    b, s = textbook_series(**kw)
    assert AS.base_textbook_gate_fails(b, base_row(b, s)) == why


def test_a_flat_row_has_the_shallow_floor():
    b, s = textbook_series(depth=0.22)
    assert AS.base_textbook_gate_fails(b, base_row(b, s, "bc:base")) is None
    assert AS.base_textbook_gate_fails(b, base_row(b, s, "bc:flat-base")) == "depth"


def test_a_shelf_under_a_higher_prior_peak_is_refused():
    b, s = textbook_series()
    j = s - 10
    b[j] = {**b[j], "h": b[s]["h"] * 1.15}
    assert AS.base_textbook_gate_fails(b, base_row(b, s)) == "under_prior_peak"


def test_a_flat_or_falling_200_day_is_refused():
    # a long decline, then an advance just over the floor: the 200-day is still falling at the right edge
    b, s = textbook_series(pre_trend=-0.003, advance=0.35)
    row = base_row(b, s, state="breakout")       # the breakout state asks round 2's floors only
    row["geometry"]["extras"]["draw_base"]["base_end_t"] = b[-1]["t"]
    assert AS.base_textbook_gate_fails(b, row) == "trend"
    rise = AS.TG_SMA_RISE
    try:
        AS.TG_SMA_RISE = -1.0   # the same bars pass once the floor is lifted: the refusal was the trend floor
        assert AS.base_textbook_gate_fails(b, row) is None
    finally:
        AS.TG_SMA_RISE = rise
    assert AS.base_textbook_gate_fails(b, base_row(b, s)) == "trend"   # and the stateless base refuses it too


def _drifting_right_side(level):
    b, s = textbook_series(base_len=60, depth=0.25)
    for j in range(len(b) - 8, len(b)):
        c = b[s]["h"] * level
        b[j] = {**b[j], "o": c, "h": c * 1.01, "l": c * 0.99, "c": c}
    return b, s


def test_a_forming_base_needs_its_right_side_within_12_percent_of_the_pivot():
    b, s = _drifting_right_side(0.78)
    assert AS.base_textbook_gate_fails(b, base_row(b, s, state="forming")) == "forming_too_far_below"


def test_a_forming_base_needs_the_close_over_its_50_day(monkeypatch):
    b, s = _drifting_right_side(0.78)
    monkeypatch.setattr(AS, "TG3_FORMING_BELOW", 1.0)   # isolate the 50-day floor
    assert AS.base_textbook_gate_fails(b, base_row(b, s, state="forming")) == "forming_under_50"


def test_the_breakout_state_keeps_the_round_two_gate_only():
    # a short-lived spike at the lip: the stateless base refuses it, a breakout base is not asked
    b, s = textbook_series()
    b[s] = {**b[s], "h": b[s]["h"] * 1.06}
    assert AS.base_textbook_gate_fails(b, base_row(b, s)) in ("spike_wick", "lone_high")
    row = base_row(b, s, state="breakout")
    row["geometry"]["extras"]["draw_base"]["base_end_t"] = b[-1]["t"]
    assert AS.base_textbook_gate_fails(b, row) in (None, "mid_base_high")


def test_a_breakout_state_reads_its_base_not_the_breakout_bars():
    b, s = textbook_series()
    row = base_row(b, s, state="breakout")
    row["geometry"]["extras"]["draw_base"]["base_end_t"] = b[-1]["t"]
    # sessions after the base: a breakout far over the left-side high does not count as a mid-base high
    top = b[s]["h"]
    more = _bars([top * 1.03] * 3)
    ts = _days(len(b) + 3)
    for k, x in enumerate(more):
        x["t"] = ts[len(b) + k]
    assert AS.base_textbook_gate_fails(b + more, row) is None


def test_member_textbook_gate_removes_only_failing_gated_rows(monkeypatch):
    good_b, s = textbook_series()
    monkeypatch.setattr(AS, "_daily_bars", lambda sym: good_b)
    monkeypatch.setattr(AS, "last_bar_forming", lambda t, now=None: False)
    good = base_row(good_b, s)
    short = base_row(good_b, len(good_b) - 15)
    other = {"pattern_id": "draw:inside-day", "start_t": good_b[-3]["t"], "geometry": {"extras": {}}}
    det, st = AS.member_base_textbook_gate("X", [short], [good, other])
    assert det == [] and st == [good, other]


def test_member_textbook_gate_fails_open(monkeypatch):
    def boom(sym):
        raise OSError("bars down")
    monkeypatch.setattr(AS, "_daily_bars", boom)
    rows = [{"pattern_id": "bc:base", "geometry": {"extras": {}}}]
    assert AS.member_base_textbook_gate("X", rows, []) == (rows, [])
    good_b, _s = textbook_series()
    monkeypatch.setattr(AS, "_daily_bars", lambda sym: good_b)
    monkeypatch.setattr(AS, "last_bar_forming", lambda t, now=None: False)
    unreadable = {"pattern_id": "bc:base", "geometry": {"extras": {"draw_base": {"start_t": 19000101}}}}
    assert AS.member_base_textbook_gate("X", [unreadable], []) == ([unreadable], [])


def test_a_pinned_price_is_refused(monkeypatch):
    b, s = textbook_series()
    from api.services import deal_status
    monkeypatch.setattr(deal_status, "price_pinned", lambda bars: {"pin": True})
    assert AS.base_textbook_gate_fails(b, base_row(b, s)) == "pinned"
