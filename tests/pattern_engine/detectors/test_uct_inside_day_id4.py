"""uct_inside_day_id4 (detector recall v4, gated inside-day recall variant). INTERNAL.

Synthetic fixtures only. What each test pins:
  * the base branch fires exactly where uct_inside_day fires (a superset);
  * the new branch fires on a session the base rule refuses, and each of its
    gates (50 SMA rising, close above the 200 SMA, range cap) silences it beside
    a contrast that fires;
  * without 200 bars only the base branch can fire;
  * detection shape and the branch marker; registration (internal, out of the
    member catalog, not in the team drawing set) and the declared history.
The lab parity (lab vs app, no lookahead) lives in test_uct_inside_day_id4_parity.py.
"""
import pytest

from api.services.pattern_engine.detectors import registry
from api.services.pattern_engine.detectors.uct import uct_inside_day as ID
from api.services.pattern_engine.detectors.uct import uct_inside_day_id4 as ID4
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors import _team_setups_synth as SY

_PID = "uct_inside_day_id4"


def _last(bars):
    return ID4.evaluate(bars, U.series(bars), len(bars) - 1)


def _new_branch_case():
    """The first session of a fixed set of seeded walks where ONLY the new branch
    fires, cut so that session is the newest bar."""
    for seed in range(40):
        bars = SY.random_walk(seed=seed)
        S = U.series(bars)
        for i in range(220, len(bars)):
            c = ID4.evaluate(bars, S, i)
            if c is not None and c["new"]:
                return bars[:i + 1]
    raise AssertionError("no new-branch session in the fixed corpus")


def test_the_base_branch_is_the_shipped_inside_day_rule():
    for db in [SY.inside_day(), SY.outside_last(), SY.inside_downtrend()] + \
              [SY.random_walk(seed=s) for s in range(6)]:
        S = U.series(db)
        for i in range(len(db)):
            base = ID.evaluate(db, S, i)
            c = ID4.evaluate(db, S, i)
            if base is not None:
                assert c is not None and not c["new"] and c["variant"] == base["variant"], i
            elif c is not None:
                assert c["new"], i


def test_the_new_branch_fires_where_the_base_rule_refuses():
    bars = _new_branch_case()
    assert ID.evaluate(bars, U.series(bars), len(bars) - 1) is None
    c = _last(bars)
    f = c["facts"]
    S = U.series(bars)
    i = len(bars) - 1
    assert f["i0"] and f["c>e21_up"] and f["rng0"] <= ID4.NEW_TIGHT_ATR
    assert S["s50"][i] > S["s50"][i - ID4.S50_LAG] and bars[i]["c"] > S["s200"][i]


@pytest.mark.parametrize("name,value", [("S50_LAG", 1000), ("NEW_TIGHT_ATR", 0.0)])
def test_each_new_branch_gate_can_silence_it(monkeypatch, name, value):
    bars = _new_branch_case()
    assert _last(bars) is not None
    monkeypatch.setattr(ID4, name, value)
    assert _last(bars) is None


def test_the_200_sma_gate_is_live():
    bars = _new_branch_case()
    S = U.series(bars)
    i = len(bars) - 1
    assert bars[i]["c"] > S["s200"][i] and ID4._uptrend(bars, S, i)
    S2 = dict(S)
    S2["s200"] = list(S["s200"])
    S2["s200"][i] = bars[i]["c"] + 1.0          # the close now sits under the 200 SMA
    assert not ID4._uptrend(bars, S2, i)


def test_without_200_bars_only_the_base_branch_can_fire():
    bars = _new_branch_case()
    short = bars[-199:]
    c = _last(short)
    assert c is None or not c["new"], "the new branch needs the 200 SMA"
    for d in ID4.detect_uct_inside_day_id4(short, {}):
        assert d["geometry"]["extras"]["id4_branch"] == "base"
    base = SY.inside_day()           # 120 bars: no 200 SMA, the base branch still fires
    (d,) = ID4.detect_uct_inside_day_id4(base, {})
    assert d["geometry"]["extras"]["id4_branch"] == "base"


def test_detection_shape_and_branch_marker():
    bars = _new_branch_case()
    (d,) = ID4.detect_uct_inside_day_id4(bars, build_context(bars, sym="TEST"))
    ex = d["geometry"]["extras"]
    assert d["pattern_id"] == _PID and d["direction"] == "bullish"
    assert ex["id4_branch"] == "new" and ex["trigger_bars_ago"] == 0
    assert ex["lab_rule"] == "recall_v4.id4"
    assert d["levels"]["entry"] == round(bars[-1]["h"], 2)
    assert d["levels"]["stop"] == round(bars[-1]["l"], 2)
    for k in ("headline", "what_it_is", "why_it_matters", "what_to_watch_for", "failure_signal"):
        assert d["narrative"][k]
    assert d["confidence"] >= U.CONFIDENCE_FLOOR


def test_registered_internal_and_kept_out_of_the_member_catalog():
    import api.routers.patterns as patterns_router
    assert _PID in set(registry.list_pattern_ids())
    assert registry.is_internal(_PID) and _PID in registry.INTERNAL_PATTERN_IDS
    assert _PID not in registry.list_public_pattern_ids()
    assert _PID not in patterns_router._PATTERN_METADATA
    assert _PID not in registry.DISPLAY_TEAM_SET and _PID not in registry.DISPLAY_HIDDEN
    assert registry.display_policy(_PID)["display_tier"] == "experimental"


def test_scan_depth_declaration_and_the_base_detector_is_untouched():
    import api.routers.patterns  # noqa: F401
    assert registry.min_bars_for(_PID) == ID4.MIN_BARS == 200 + U.MAX_TRIGGER_AGE - 1
    assert registry.min_bars_for("uct_inside_day") is None
    bars = list(range(300))
    assert registry.bars_for(_PID, bars, 200) == bars[-ID4.MIN_BARS:]
