"""The named base-shape drawings (api/services/pattern_engine/shape_draw.py, lab base_shapes) and the
experimental IPO base state (base_catalog.ipo_base_state). Synthetic bars only (public repo).

What is railed here:
  * each drawing fires on a clean synthetic example of its shape, with the pivot where the shape puts it
    (the W's middle peak + the IBD dime, the staircase's third high + the dime, the saucer's lip, the IPO
    base's post-listing high) -- and a CONTROL per shape that the same series, broken the way round 2
    exists to catch, is withheld for that reason (a rail that only ever sees fires proves nothing);
  * no lookahead: the drawing at bar i is identical with 30 wild future bars appended;
  * the IPO base is experimental: outside RELATIONS / ALL_STRUCTURES / meta() / provenance(), refused when
    the window does not start on the series' first stored bar, when the listing is too old, too deep, or
    the base too short;
  * the member gate fails closed: every MEMBER_<SHAPE>_ROUND literal is None, so a perfectly well-formed
    row is dropped even with its id forced into the member set; with a literal set (monkeypatched), only
    the matching round and a well-formed stamp pass;
  * structures_for is unchanged while AUTO_STRUCTURES_SHAPES_ENABLED is off, and only APPENDS the shape
    rows when it is on;
  * the backend's SHAPE_DRAW_IDS equal PatternOverlay's (one list, mirrored, pinned).
"""
import datetime
import json
import os
import re

import pytest

from api.services import auto_structures as AS
from api.services.pattern_engine import shape_draw as SD
from api.services.screener import base_catalog as bc


def series(points, start=datetime.date(2024, 1, 2), vol=2_000_000):
    """Piecewise-linear closes through (bar_index, price) points with a fixed alternating wiggle."""
    out, d = [], start
    for (i0, p0), (i1, p1) in zip(points, points[1:]):
        for k in range(i0, i1):
            c = p0 + (p1 - p0) * (k - i0) / (i1 - i0)
            w = c * 0.004 * (1 if k % 2 else -1)
            c = c + w
            o = c - w * 0.5
            out.append({"t": int(d.strftime("%Y%m%d")), "o": round(o, 4), "h": round(max(o, c) * 1.006, 4),
                        "l": round(min(o, c) * 0.994, 4), "c": round(c, 4), "v": vol})
            d += datetime.timedelta(days=1)
    return out


W_PTS = [(0, 50), (150, 50), (230, 80), (245, 82), (262, 70), (275, 79), (290, 68), (302, 77.5), (303, 77.5)]
ASC_PTS = [(0, 60), (150, 100), (160, 86), (175, 108), (185, 93), (200, 115), (212, 100), (222, 112), (223, 112)]
SAU_PTS = [(0, 50), (150, 80), (230, 68), (260, 68.5), (330, 78), (331, 78)]
IPO_PTS = [(0, 20), (40, 30), (60, 23), (80, 28), (81, 28)]
#: The W behind a long flat history (>= STRUCTURE_BARS bars): too old to be a listing, so no IPO base row.
W_LONG = [(0, 50)] + [(i + 350, p) for i, p in W_PTS[1:]]


def draw(fn, b, **kw):
    why = []
    return fn(b, len(b) - 1, _why=why, **kw), why


def ipo(b):
    return draw(SD.ipo_base_drawing, b, first_t=b[0]["t"])


# ------------------------------------------------------------------------------------------- fires
def test_double_bottom_draws_the_w_with_its_pivot_on_the_middle_peak():
    d, why = draw(SD.double_bottom_drawing, series(W_PTS))
    assert d is not None, why
    kinds = [m["kind"] for m in d["marks"]]
    assert kinds == ["lip", "low1", "middle_peak", "low2"]
    mp = d["marks"][2]
    assert d["pivot"] == pytest.approx(mp["price"] + bc.DBL_PIVOT_PAD)
    assert d["pivot_from_t"] == mp["t"]
    assert d["low"] == pytest.approx(min(d["marks"][1]["price"], d["marks"][3]["price"]))
    assert d["top"] == pytest.approx(d["marks"][0]["price"])
    assert d["start_t"] == d["marks"][0]["t"] and d["draw_round"] == SD.DOUBLE_BOTTOM_DRAW_ROUND == 2
    assert (d["label"], d["low_label"]) == ("pivot", "base low") and d["path"] is True


def test_ascending_base_draws_the_staircase_with_its_pivot_on_the_third_high():
    d, why = draw(SD.ascending_base_drawing, series(ASC_PTS))
    assert d is not None, why
    assert [m["kind"] for m in d["marks"]] == ["high1", "low1", "high2", "low2", "high3", "low3"]
    h3 = d["marks"][4]
    assert d["pivot"] == pytest.approx(h3["price"] + bc.ASC_PIVOT_PAD)
    assert d["pivot_from_t"] == h3["t"] and d["start_t"] == d["marks"][0]["t"]


def test_saucer_draws_its_pivot_on_the_lip():
    d, why = draw(SD.saucer_drawing, series(SAU_PTS))
    assert d is not None, why
    lip = d["marks"][0]
    assert lip["kind"] == "lip" and d["pivot"] == pytest.approx(lip["price"]) == pytest.approx(d["lip"])
    assert d["start_t"] == lip["t"] and d["path"] is False


def test_ipo_base_draws_its_pivot_on_the_post_listing_high():
    b = series(IPO_PTS)
    d, why = ipo(b)
    assert d is not None, why
    assert d["pivot"] == pytest.approx(max(x["h"] for x in b))
    assert d["listing_t"] == b[0]["t"] and d["draw_round"] == SD.IPO_BASE_DRAW_ROUND


# ------------------------------------------------------------------------------------------- controls
def test_control_a_w_whose_right_side_never_turned_up_is_withheld():
    b = series(W_PTS[:-2] + [(291, 68.2)])           # cut at the second low
    d, why = draw(SD.double_bottom_drawing, b)
    assert d is None and why and why[0] in ("no_right_side", "right_side_low", "no_state")


def test_control_a_w_whose_lows_are_a_few_bars_apart_is_withheld():
    pts = [(0, 50), (150, 50), (230, 80), (245, 82), (262, 70), (265, 76), (268, 69), (280, 77.5), (281, 77.5)]
    d, why = draw(SD.double_bottom_drawing, series(pts))
    assert d is None


def test_control_a_saucer_that_already_cleared_its_lip_is_withheld():
    pts = [(0, 50), (150, 80), (200, 70), (230, 85), (260, 68.5), (330, 78), (331, 78)]
    d, why = draw(SD.saucer_drawing, series(pts))
    assert d is None


def test_control_an_ascending_base_that_already_ran_and_came_back_is_withheld():
    pts = ASC_PTS[:-2] + [(222, 125), (232, 110), (233, 110)]
    d, why = draw(SD.ascending_base_drawing, series(pts))
    assert d is None


def test_control_an_ipo_base_deeper_than_the_ceiling_is_withheld():
    b = series([(0, 20), (40, 30), (60, 18), (80, 28), (81, 28)])
    assert ipo(b)[0] is None


# ------------------------------------------------------------------------------------------- no lookahead
def _wild(b, n=30):
    out, last = list(b), b[-1]
    d = datetime.datetime.strptime(str(last["t"]), "%Y%m%d").date()
    for j in range(n):
        d += datetime.timedelta(days=1)
        c = last["c"] * (1.6 if j % 2 else 0.5)
        out.append({"t": int(d.strftime("%Y%m%d")), "o": c, "h": c * 1.3, "l": c * 0.6, "c": c, "v": 9e9})
    return out


@pytest.mark.parametrize("fn,pts,kw", [
    (SD.double_bottom_drawing, W_PTS, {}),
    (SD.ascending_base_drawing, ASC_PTS, {}),
    (SD.saucer_drawing, SAU_PTS, {}),
    (SD.ipo_base_drawing, IPO_PTS, {"first_t": "FIRST"}),
])
def test_no_lookahead(fn, pts, kw):
    b = series(pts)
    kw = {k: (b[0]["t"] if v == "FIRST" else v) for k, v in kw.items()}
    fired = 0
    for i in range(len(b) - 12, len(b)):
        a1 = fn(b[:i + 1], i, **kw)
        a2 = fn(_wild(b[:i + 1]), i, **kw)
        assert json.dumps(a1, sort_keys=True) == json.dumps(a2, sort_keys=True)
        fired += a1 is not None
    assert fired > 0            # non-vacuity: the comparison saw real drawings


# ------------------------------------------------------------------------------------------- IPO state
class _Ctx:
    def __init__(self, bars):
        self.bars = bars
        self.bars_full = bars


def test_ipo_base_is_experimental_and_outside_every_member_facing_list():
    assert bc.IPO_BASE not in bc.ALL_STRUCTURES and bc.IPO_BASE not in bc.RELATIONS
    assert bc.by_key("ipo-base") is None
    assert bc.experimental_by_key("ipo-base") is bc.IPO_BASE
    assert "ipo-base" not in bc.meta() and "ipo-base" not in bc.provenance()


def test_ipo_state_pivot_is_the_top_and_first_t_must_match_the_window():
    b = series(IPO_PTS)
    st = bc.ipo_base_state(_Ctx(b), first_t=b[0]["t"])
    assert st is not None and st["pivot"] == st["top"] == max(x["h"] for x in b)
    assert bc._detect_ipo_base(_Ctx(b)) is True
    assert bc.ipo_base_state(_Ctx(b[5:]), first_t=b[0]["t"]) is None        # window does not reach listing


def test_ipo_state_refuses_an_old_listing_and_a_short_base():
    old = series([(0, 25), (400, 25)] + [(400 + i, p) for i, p in [(40, 30), (60, 23), (80, 28), (81, 28)]])
    assert bc.ipo_base_state(_Ctx(old)) is None
    short = series([(0, 20), (40, 30), (50, 26), (51, 26)])                 # 10 bars under the high
    assert bc.ipo_base_state(_Ctx(short)) is None


# ------------------------------------------------------------------------------------------- rows + gate
@pytest.fixture
def complete(monkeypatch):
    monkeypatch.setattr(AS, "last_bar_forming", lambda t, now=None: False)


def test_shape_draw_rows_builds_one_row_per_firing_shape(complete):
    rows = AS.shape_draw_rows("syn", series(W_LONG))
    assert [r["pattern_id"] for r in rows] == ["draw:double-bottom"]
    r = rows[0]
    d = r["geometry"]["extras"]["draw_shape"]
    assert r["sym"] == "SYN" and r["levels"]["entry"] == d["pivot"]
    assert r["geometry"]["extras"]["draw_round"] == d["draw_round"] == 2
    assert r["display_tier"] == "experimental"           # not in the team set: admin "show all" only


def test_a_short_history_is_a_listing_and_also_draws_an_ipo_base(complete):
    # the plain W is 303 bars: the first stored bar IS the listing, its high came 245 bars in, so it is
    # both a W and a first base -- both rows are drawn (admin-only; the member literals are None)
    assert [r["pattern_id"] for r in AS.shape_draw_rows("syn", series(W_PTS))] == [
        "draw:double-bottom", "draw:ipo-base"]


def test_ipo_row_only_when_the_bars_reach_the_first_stored_bar(complete):
    b = series(IPO_PTS)
    assert [r["pattern_id"] for r in AS.shape_draw_rows("syn", b)] == ["draw:ipo-base"]
    long = series([(0, 25), (650, 25)])
    assert len(long) >= AS.STRUCTURE_BARS
    assert all(r["pattern_id"] != "draw:ipo-base" for r in AS.shape_draw_rows("syn", long))


def test_a_failing_shape_costs_that_shape_only(complete, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("x")
    monkeypatch.setattr(SD, "saucer_drawing", boom)
    assert [r["pattern_id"] for r in AS.shape_draw_rows("syn", series(W_LONG))] == ["draw:double-bottom"]


def _row(pid="draw:double-bottom", rnd=2, **over):
    d, _ = draw(SD.double_bottom_drawing, series(W_PTS))
    d = {**d, **over}
    return {"pattern_id": pid, "display_tier": "trusted",
            "geometry": {"extras": {"draw_shape": d, "draw_round": rnd}}}


def test_every_member_literal_is_none_so_nothing_reaches_a_member():
    assert (AS.MEMBER_SAUCER_ROUND, AS.MEMBER_ASCENDING_BASE_ROUND, AS.MEMBER_DOUBLE_BOTTOM_ROUND,
            AS.MEMBER_IPO_BASE_ROUND) == (None, None, None, None)
    assert AS._confirmed_shape(_row()) is False


def test_member_rows_drops_a_well_formed_shape_row_even_inside_the_member_set(monkeypatch):
    from api.services.pattern_engine.detectors import registry
    monkeypatch.setattr(registry, "DISPLAY_MEMBER_SET", registry.DISPLAY_MEMBER_SET | {"draw:double-bottom"})
    assert AS.member_rows([_row()]) == []
    monkeypatch.setattr(AS, "MEMBER_DOUBLE_BOTTOM_ROUND", 2)                 # control: the literal releases it
    assert len(AS.member_rows([_row()])) == 1


@pytest.mark.parametrize("bad", [
    {"rnd": 1},                                   # another round
    {"pid": "draw:saucer"},                       # a stamp of another shape
    {"label": "level"},                           # not the judged label
    {"low": 999.0},                               # low above the pivot
    {"marks": []},                                # no points
    {"start_t": 99999999},                        # start after end
])
def test_with_the_literal_set_only_a_well_formed_matching_stamp_passes(monkeypatch, bad):
    monkeypatch.setattr(AS, "MEMBER_DOUBLE_BOTTOM_ROUND", 2)
    monkeypatch.setattr(AS, "MEMBER_SAUCER_ROUND", 2)
    assert AS._confirmed_shape(_row()) is True
    kw = dict(bad)
    pid, rnd = kw.pop("pid", "draw:double-bottom"), kw.pop("rnd", 2)
    assert AS._confirmed_shape(_row(pid=pid, rnd=rnd, **kw)) is False


def test_a_stale_shape_row_never_passes(monkeypatch):
    monkeypatch.setattr(AS, "MEMBER_DOUBLE_BOTTOM_ROUND", 2)
    r = _row()
    r["geometry"]["extras"]["stale"] = True
    assert AS._confirmed_shape(r) is False


# ------------------------------------------------------------------------------------------- structures_for
def _structures(monkeypatch, bars, flag):
    monkeypatch.setattr(AS, "_daily_bars", lambda sym: [dict(x) for x in bars])
    monkeypatch.setattr(AS, "last_bar_forming", lambda t, now=None: False)
    monkeypatch.setattr(AS, "last_bar_complete", lambda t, now=None: True)
    if flag:
        monkeypatch.setenv("AUTO_STRUCTURES_SHAPES_ENABLED", "1")
    else:
        monkeypatch.delenv("AUTO_STRUCTURES_SHAPES_ENABLED", raising=False)
    AS._CACHE.clear()
    try:
        return AS.structures_for("SYN")
    finally:
        AS._CACHE.clear()


def test_structures_for_is_unchanged_with_the_flag_off_and_only_appends_when_on(monkeypatch):
    b = series(W_LONG)
    assert len(b) >= AS.STRUCTURE_BARS
    off = _structures(monkeypatch, b, False)
    on = _structures(monkeypatch, b, True)
    assert all(r["pattern_id"] not in AS.SHAPE_DRAW_IDS for r in off)
    assert on[:len(off)] == off
    assert [r["pattern_id"] for r in on[len(off):]] == ["draw:double-bottom"]


def test_the_shape_ids_mirror_the_overlay():
    p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "app", "src", "components", "chart", "PatternOverlay.jsx")
    src = open(p, encoding="utf-8").read()
    m = re.search(r"export const SHAPE_DRAW_IDS = \[([^\]]*)\]", src)
    assert m, "PatternOverlay.SHAPE_DRAW_IDS not found"
    assert tuple(re.findall(r"'([^']+)'", m.group(1))) == AS.SHAPE_DRAW_IDS
