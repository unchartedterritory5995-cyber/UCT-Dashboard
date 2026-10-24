"""The member "flat top" drawing for uct_flat_top_breakout (lab flattop_draw_v2, 2026-10-18).

v1 (every confirmed fire) failed its blind packet: lines hanging from one old wick spike. v2 draws only
when the ceiling was really tested, and passed two fresh blind packets AS DRAWN (A 2.60 [2.30, 2.83],
B 2.57 [2.30, 2.80]). What each test pins:
  * display.flat_top_drawing draws a confirmed fire that meets G1-G3 and names the condition that
    failed otherwise -- unconfirmed, few_touches (the as-of APPROACH is not a touch), single_spike,
    extended -- each beside a contrast that DOES draw, so no case passes by answering "no";
  * display.draw_geometry stamps draw_flat_top + draw_round only on such a fire whose trigger is the
    scan's last bar (the lab drew as of the fire's own session), and adds NOTHING to any other fire --
    an older trigger, a malformed offset, a failed condition, a crash -- so that row is byte-for-byte
    what the detector built;
  * registry.row_display_policy: a stamped row is `trusted`, an unstamped one keeps `experimental`
    (the tier it had before), so an admin's chart draws the unstamped row exactly as before;
  * auto_structures.member_rows serves a uct_flat_top_breakout only with the confirmed round's stamp
    beside a well-formed drawing (fail closed), end to end through the REAL detector and draw_geometry;
  * the member set before this change is served exactly as before.
Lab parity on real bars (every judged case + random sessions) is tests/test_flat_top_lab_parity.py,
which skips without the lab; this file carries synthetic series only (public repo).
"""
import pytest

from api.services import auto_structures
from api.services.pattern_engine import display
from api.services.pattern_engine.detectors import registry
from api.services.pattern_engine.detectors.uct import uct_flat_top_breakout as FT
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors import _team_setups_synth as SY


@pytest.fixture(autouse=True)
def flat_base_released(monkeypatch):
    """The flat base is WITHHELD from members since 2026-10-24 (recert A: MEMBER_FLAT_BASE_ROUND and
    MEMBER_BC_FLAT_BASE_ROUND are None). This module tests the mechanism a released flat base runs through, so it
    re-enables both literals in memory; tests/test_flat_base_withheld_from_members.py rails the withholding."""
    from api.services import auto_structures as _as
    monkeypatch.setattr(_as, "MEMBER_FLAT_BASE_ROUND", 1)
    monkeypatch.setattr(_as, "MEMBER_BC_FLAT_BASE_ROUND", "team")


#: The member bull_flag literal AS SHIPPED, read before any test patches it. Since 2026-10-24 (recert E) it is
#: None: every bull flag is withheld from members. The tests below exercise the round-9 gate MECHANISM, so they
#: run under the one-literal re-enable (MEMBER_BULL_FLAG_ROUND = 9, in memory); the shipped default is railed in
#: tests/test_bull_flag_withheld_from_members.py.
SHIPPED_MEMBER_BULL_FLAG_ROUND = auto_structures.MEMBER_BULL_FLAG_ROUND


@pytest.fixture
def round9_flag_released(monkeypatch):
    monkeypatch.setattr(auto_structures, "MEMBER_BULL_FLAG_ROUND", 9)


pytestmark = pytest.mark.usefixtures("round9_flag_released")

#: The round the blind check confirmed. Pinned as a literal.
CONFIRMED_ROUND = 2
#: Four ceiling touches across the base, none of them the as-of approach.
V2_TOUCHES = (5, 15, 25, 35)


def _i(bars):
    return len(bars) - 1


def _ceiling(bars):
    i = _i(bars)
    return max(b["h"] for b in bars[i - FT.FT_L:i])


def _pos(bars):
    f = FT.features(bars, U.series(bars), _i(bars))
    return None if f is None else f["pos"]


def _with_pos(bars, target, lo, hi):
    """Re-close the last session so the rule's pos lands at `target` ATR (bisection over the close;
    the last bar's own true range moves the ATR, so the close cannot be set in one step)."""
    H = _ceiling(bars)
    head, last = bars[:-1], bars[-1]

    def build(c):
        return head + [SY.bar(_i(bars), c - 0.05, max(c, H) + 0.05, min(c, H) - 0.4, c, last["v"])]
    for _ in range(80):
        mid = (lo + hi) / 2
        p = _pos(build(mid))
        if p < target:
            lo = mid
        else:
            hi = mid
    out = build((lo + hi) / 2)
    assert abs(_pos(out) - target) < 1e-3
    return out


def _spike_top(bars, j_base):
    """Raise base sessions `j_base` (offsets into the base) to a two-day spike above the ceiling."""
    i = _i(bars)
    k0 = i - 45
    a = U.series(bars)["atr"][i]
    out = list(bars)
    for j in j_base:
        b = out[k0 + j]
        out[k0 + j] = SY.bar(k0 + j, b["o"], _ceiling(bars) + 0.45 * a, b["l"], b["c"], b["v"])
    return out


# -- display.flat_top_drawing -------------------------------------------------------------------

def test_a_v2_fire_draws_the_top_cluster_and_one_marker_per_touch_group():
    bars = SY.flat_top(touches=V2_TOUCHES, last="breakout")
    ft, why = display.flat_top_drawing(bars, _i(bars))
    assert why is None and ft["variant"] == "breakout"
    H = _ceiling(bars)
    assert ft["price"] == H and ft["label"] == "flat top"
    k0 = _i(bars) - 45
    # the trend's last high tags the ceiling outside the 40-session window; the first touch in the
    # window is base offset 5, and the four touches are marked on their highs
    assert ft["start_t"] == bars[k0 + 5]["t"] and ft["end_t"] == bars[-1]["t"]
    assert [t["t"] for t in ft["touches"]] == [bars[k0 + j]["t"] for j in V2_TOUCHES]
    assert all(t["price"] == H for t in ft["touches"])


def test_at_line_within_half_an_atr_draws():
    bars = SY.flat_top(touches=V2_TOUCHES, last="at_line")
    ft, why = display.flat_top_drawing(bars, _i(bars))
    assert why is None and ft["variant"] == "at_line"


def test_an_at_line_fire_deeper_than_half_an_atr_is_unconfirmed():
    base = SY.flat_top(touches=V2_TOUCHES, last="at_line")
    H = _ceiling(base)
    deep = _with_pos(base, -0.75, H - 3.0, H)
    assert FT.decide(FT.features(deep, U.series(deep), _i(deep))) == "at_line"
    assert display.flat_top_drawing(deep, _i(deep)) == (None, "unconfirmed")
    shallow = _with_pos(base, -0.45, H - 3.0, H)             # contrast: the confirmed side draws
    assert display.flat_top_drawing(shallow, _i(shallow))[1] is None


def test_two_touch_groups_are_too_few():
    bars = SY.flat_top(touches=(5, 22), last="breakout")
    assert FT.decide(FT.features(bars, U.series(bars), _i(bars))) == "breakout"   # the rule fires
    assert display.flat_top_drawing(bars, _i(bars)) == (None, "few_touches")


def test_the_as_of_approach_is_not_a_touch():
    # three groups, but the last one ends two sessions before the as-of bar: it is the approach
    bars = SY.flat_top(touches=(5, 15, 43), last="breakout")
    assert FT.features(bars, U.series(bars), _i(bars))["groups"] == 3
    assert display.flat_top_drawing(bars, _i(bars)) == (None, "few_touches")
    # contrast: the same third touch three sessions earlier is a real prior touch, and it draws
    early = SY.flat_top(touches=(5, 15, 40), last="breakout")
    assert display.flat_top_drawing(early, _i(early))[1] is None


def test_a_line_set_by_one_spike_is_not_drawn():
    # a two-day spike sets the top cluster; the other touch groups sit under it, outside the band
    bars = _spike_top(SY.flat_top(touches=(5, 6, 20, 32), last="breakout"), (5, 6))
    bars = _with_pos(bars, 0.3, _ceiling(bars) - 1.0, _ceiling(bars) + 3.0)
    f = FT.features(bars, U.series(bars), _i(bars))
    assert FT.decide(f) == "breakout" and f["groups"] == 3
    assert display.flat_top_drawing(bars, _i(bars)) == (None, "single_spike")


def test_price_run_far_past_the_line_is_extended():
    base = SY.flat_top(touches=V2_TOUCHES, last="breakout")
    H = _ceiling(base)
    far = _with_pos(base, 1.8, H, H + 20.0)
    assert FT.decide(FT.features(far, U.series(far), _i(far))) == "breakout"   # still a fire (<= 2 ATR)
    assert display.flat_top_drawing(far, _i(far)) == (None, "extended")
    near = _with_pos(base, 1.2, H, H + 20.0)                  # contrast: 1.2 ATR past still draws
    assert display.flat_top_drawing(near, _i(near))[1] is None


def test_no_fire_and_bad_indices_draw_nothing():
    bars = SY.flat_top(touches=V2_TOUCHES, last="deep")
    assert display.flat_top_drawing(bars, _i(bars)) == (None, "no_fire")
    for bad in (None, -1, len(bars), True, 1.0):
        assert display.flat_top_drawing(bars, bad) == (None, "no_fire")


# -- display.draw_geometry: the stamp ---------------------------------------------------------------

def _detect(bars):
    (d,) = FT.detect_uct_flat_top_breakout(bars, build_context(bars, sym="TEST"))
    display.annotate([d], bars)
    return d


def test_draw_geometry_stamps_a_v2_fire():
    bars = SY.flat_top(touches=V2_TOUCHES, last="breakout")
    ex = _detect(bars)["geometry"]["extras"]
    assert ex["draw_round"] == CONFIRMED_ROUND == display.FLAT_TOP_DRAW_ROUND
    assert ex["draw_flat_top"] == display.flat_top_drawing(bars, _i(bars))[0]
    assert not ex.get("stale")


@pytest.mark.parametrize("touches,last", [((5, 22), "breakout"), ((5, 15, 43), "at_line")])
def test_draw_geometry_adds_nothing_to_a_non_v2_fire(touches, last):
    bars = SY.flat_top(touches=touches, last=last)
    (d,) = FT.detect_uct_flat_top_breakout(bars, build_context(bars, sym="TEST"))
    before = repr(d)
    display.draw_geometry([d], bars)
    assert repr(d) == before                                  # byte-for-byte the detector's row
    assert display.flat_top_drawing(bars, _i(bars))[0] is None


def test_an_older_trigger_is_never_drawn_even_when_the_rule_held_at_it():
    """The lab drew as of the fire's own session; the bars after it were never judged."""
    bars = SY.flat_top(touches=V2_TOUCHES, last="breakout")
    assert display.flat_top_drawing(bars, _i(bars))[1] is None      # the rule holds at the trigger
    p = bars[-1]
    bars2 = bars + [SY.bar(len(bars), p["c"], p["h"], p["l"], p["c"] - 0.05, p["v"])]
    det = {"pattern_id": "uct_flat_top_breakout", "geometry": {"extras": {"trigger_bars_ago": 1}}}
    display.draw_geometry([det], bars2)
    assert det["geometry"]["extras"] == {"trigger_bars_ago": 1}
    # control: the same row as of its own session IS drawn
    det0 = {"pattern_id": "uct_flat_top_breakout", "geometry": {"extras": {"trigger_bars_ago": 0}}}
    display.draw_geometry([det0], bars)
    assert det0["geometry"]["extras"]["draw_round"] == CONFIRMED_ROUND


@pytest.mark.parametrize("ago", [None, -1, 1, "0", 0.0, False])
def test_a_missing_or_malformed_trigger_offset_fails_closed(ago):
    bars = SY.flat_top(touches=V2_TOUCHES, last="breakout")
    det = {"pattern_id": "uct_flat_top_breakout", "geometry": {"extras": {"trigger_bars_ago": ago}}}
    display.draw_geometry([det], bars)
    assert det["geometry"]["extras"] == {"trigger_bars_ago": ago}
    nothing = {"pattern_id": "uct_flat_top_breakout", "geometry": {}}
    display.draw_geometry([nothing], bars)
    assert nothing == {"pattern_id": "uct_flat_top_breakout", "geometry": {}}


def test_a_crash_in_the_drawing_stamps_nothing(monkeypatch):
    bars = SY.flat_top(touches=V2_TOUCHES, last="breakout")

    def boom(*_a, **_k):
        raise RuntimeError("boom")
    monkeypatch.setattr(display, "flat_top_drawing", boom)
    det = {"pattern_id": "uct_flat_top_breakout", "geometry": {"extras": {"trigger_bars_ago": 0}}}
    display.draw_geometry([det], bars)
    assert det["geometry"]["extras"] == {"trigger_bars_ago": 0}


# -- the tier, per row ---------------------------------------------------------------------------

def test_row_tier_is_trusted_only_with_the_stamp():
    pid = "uct_flat_top_breakout"
    assert registry.display_policy(pid)["display_tier"] == "trusted"
    good = _detect(SY.flat_top(touches=V2_TOUCHES, last="breakout"))
    assert registry.row_display_policy(good)["display_tier"] == "trusted"
    experimental = {**registry.display_policy(pid), "display_tier": "experimental"}
    for row in ({"pattern_id": pid}, {"pattern_id": pid, "geometry": None},
                {"pattern_id": pid, "geometry": {"extras": None}},
                {"pattern_id": pid, "geometry": {"extras": {"draw_flat_top": "x"}}},
                {"pattern_id": pid, "geometry": {"extras": {"draw_round": CONFIRMED_ROUND}}}):
        assert registry.row_display_policy(row) == experimental, row
    for junk in (None, "x", 3):
        assert registry.row_display_policy(junk) == registry.display_policy(None)
    # every other id: the row policy IS the id policy, stamp or not
    for other in sorted(set(registry.list_pattern_ids()) | set(registry.DISPLAY_TEAM_SET)):
        if other == pid:
            continue
        row = {"pattern_id": other, "geometry": {"extras": {"draw_flat_top": {"price": 1.0}}}}
        assert registry.row_display_policy(row) == registry.display_policy(other), other
        assert registry.row_display_policy({"pattern_id": other}) == registry.display_policy(other)


def test_an_unstamped_flat_top_row_keeps_the_policy_it_had_before():
    """Before this change the id was outside the team set: experimental, structures layer, no entry."""
    pol = registry.row_display_policy({"pattern_id": "uct_flat_top_breakout",
                                       "geometry": {"extras": {"trigger_bars_ago": 0}}})
    assert pol == {"display_tier": "experimental", "display_layer": "structures",
                   "intraday_only": False, "draw_entry": False}


# -- the member path ---------------------------------------------------------------------------------

POLICY = registry.display_policy("uct_flat_top_breakout")


def _row(rid, extras, policy=None):
    """A store row with the id policy (the stamped row's tier), so member_rows' own stamp check is what
    is tested; `policy="row"` applies the per-row tier the route applies."""
    r = {"id": rid, "pattern_id": "uct_flat_top_breakout", "geometry": {"extras": dict(extras)}}
    return {**r, **(registry.row_display_policy(r) if policy == "row" else POLICY)}


def _good_extras():
    bars = SY.flat_top(touches=V2_TOUCHES, last="breakout")
    return _detect(bars)["geometry"]["extras"]


def test_the_flat_top_is_a_trusted_member_type():
    assert POLICY["display_tier"] == "trusted"
    assert "uct_flat_top_breakout" in registry.DISPLAY_MEMBER_SET
    assert auto_structures.MEMBER_FLAT_TOP_ROUND == CONFIRMED_ROUND


def test_a_member_gets_a_real_v2_fire_and_never_a_non_v2_or_unconfirmed_one():
    good = _good_extras()
    bad = _detect(SY.flat_top(touches=(5, 22), last="breakout"))["geometry"]["extras"]
    base = SY.flat_top(touches=V2_TOUCHES, last="at_line")
    H = _ceiling(base)
    deep = _with_pos(base, -0.75, H - 3.0, H)
    assert display.flat_top_drawing(deep, _i(deep)) == (None, "unconfirmed")
    unconf = _detect(deep)["geometry"]["extras"]
    for ex in (bad, unconf):
        assert "draw_flat_top" not in ex and "draw_round" not in ex
    rows = [_row("g", good), _row("b", bad), _row("u", unconf)]
    assert [r["id"] for r in auto_structures.member_rows(rows)] == ["g"]
    # as the route serves them (per-row tier): the same answer; the unstamped rows are experimental
    rows = [_row("g", good, "row"), _row("b", bad, "row"), _row("u", unconf, "row")]
    assert [r["display_tier"] for r in rows] == ["trusted", "experimental", "experimental"]
    assert [r["id"] for r in auto_structures.member_rows(rows)] == ["g"]


def test_the_member_gate_fails_closed_on_every_malformed_stamp():
    good = _good_extras()
    ft = good["draw_flat_top"]
    variants = [
        {**good, "stale": True},
        {**good, "stale": 1},
        {**good, "draw_round": None},
        {**good, "draw_round": CONFIRMED_ROUND - 1},
        {**good, "draw_round": CONFIRMED_ROUND + 1},
        {**good, "draw_round": str(CONFIRMED_ROUND)},
        {**good, "draw_round": float(CONFIRMED_ROUND)},
        {**good, "draw_round": True},
        {k: v for k, v in good.items() if k != "draw_round"},
        {k: v for k, v in good.items() if k != "draw_flat_top"},
        {**good, "draw_flat_top": None},
        {**good, "draw_flat_top": {**ft, "label": "Flat ceiling"}},
        {**good, "draw_flat_top": {**ft, "price": float("nan")}},
        {**good, "draw_flat_top": {**ft, "price": "x"}},
        {**good, "draw_flat_top": {**ft, "start_t": None}},
        {**good, "draw_flat_top": {**ft, "end_t": None}},
        {**good, "draw_flat_top": {**ft, "touches": ft["touches"][:2]}},
        {**good, "draw_flat_top": {**ft, "touches": ft["touches"][:2] + [{"t": 1, "price": None}]}},
        {**good, "draw_flat_top": {**ft, "touches": "x"}},
        # the bull_flag round's stamp is not this round's
        {**good, "draw_round": display.BULL_FLAG_DRAW_ROUND},
    ]
    rows = [_row(f"v{n}", v) for n, v in enumerate(variants)]
    rows += [{"id": "n1", "pattern_id": "uct_flat_top_breakout", **POLICY},
             {"id": "n2", "pattern_id": "uct_flat_top_breakout", "geometry": None, **POLICY},
             {"id": "n3", "pattern_id": "uct_flat_top_breakout", "geometry": {"extras": None}, **POLICY}]
    assert auto_structures.member_rows(rows) == []
    ctrl = _row("ok", good)
    assert auto_structures.member_rows([ctrl]) == [ctrl]      # control: the guard can pass


def test_a_flat_top_drawn_by_a_newer_round_is_not_served_until_confirmed(monkeypatch):
    monkeypatch.setattr(display, "FLAT_TOP_DRAW_ROUND", CONFIRMED_ROUND + 1)
    ex = _good_extras()
    assert ex["draw_round"] == CONFIRMED_ROUND + 1
    assert auto_structures.member_rows([_row("n", ex)]) == []


def test_the_flat_top_stamp_does_not_open_the_bull_flag_gate_or_the_reverse():
    good = _good_extras()
    as_flag = {"id": "f", "pattern_id": "bull_flag", "geometry": {"extras": dict(good)},
               **registry.display_policy("bull_flag")}
    assert auto_structures.member_rows([as_flag]) == []
    flag_stamp = _row("x", {"draw_round": display.BULL_FLAG_DRAW_ROUND,
                            "draw_flat_top": good["draw_flat_top"]})
    assert auto_structures.member_rows([flag_stamp]) == []


def test_the_previous_member_types_are_served_exactly_as_before():
    """The rows the member set served before this change pass member_rows unchanged, and the
    previous ids are all still members."""
    assert {"flat_base", "uct_pullback_ma_v5", "bc:flat-base", "bull_flag"} <= registry.DISPLAY_MEMBER_SET
    pivot = {"start_t": 20260920, "end_t": 20261015, "price": 141.8}
    rows = [
        {"id": "a", "pattern_id": "flat_base", **registry.display_policy("flat_base")},
        {"id": "b", "pattern_id": "uct_pullback_ma_v5", **registry.display_policy("uct_pullback_ma_v5")},
        {"id": "c", "pattern_id": "bull_flag", "geometry": {"extras": {"draw_round": display.BULL_FLAG_DRAW_ROUND}},
         **registry.display_policy("bull_flag")},
        {"id": "d", "pattern_id": "bc:flat-base",
         "geometry": {"extras": {"draw_box": False, "draw_pivot": pivot}},
         **registry.display_policy("bc:flat-base")},
    ]
    assert auto_structures.member_rows(rows) == rows
