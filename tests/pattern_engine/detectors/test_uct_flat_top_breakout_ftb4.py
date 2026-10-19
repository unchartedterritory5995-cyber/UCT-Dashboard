"""uct_flat_top_breakout_ftb4 (detector recall v4, gated flat-top recall variant). INTERNAL.

Synthetic fixtures only. What each test pins:
  * the base branch fires exactly where uct_flat_top_breakout fires (a superset),
    with the same variant and the base window L = 40;
  * the new branch fires on a session the base rule refuses, at L 25 or 60, and
    each of its gates (maturity, nesting, rising 200 SMA, the added lengths)
    silences it beside a contrast that fires;
  * without 220 bars only the base branch can fire;
  * detection shape and the branch marker; registration (internal, out of the
    member catalog, not in the team drawing set) and the declared history.
The lab parity (lab vs app, no lookahead) lives in test_uct_flat_top_breakout_ftb4_parity.py.
"""
import pytest

from api.services.pattern_engine.detectors import registry
from api.services.pattern_engine.detectors.uct import uct_flat_top_breakout as FT
from api.services.pattern_engine.detectors.uct import uct_flat_top_breakout_ftb4 as FT4
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors import _team_setups_synth as SY

_PID = "uct_flat_top_breakout_ftb4"


def _last(bars):
    return FT4.evaluate(bars, U.series(bars), len(bars) - 1)


def _new_branch_case():
    """The first session of a fixed set of seeded walks where ONLY the new branch
    fires, cut so that session is the newest bar."""
    for seed in range(40):
        bars = SY.random_walk(seed=seed)
        S = U.series(bars)
        for i in range(240, len(bars)):
            c = FT4.evaluate(bars, S, i)
            if c is not None and c["new"]:
                return bars[:i + 1]
    raise AssertionError("no new-branch session in the fixed corpus")


def test_the_base_branch_is_the_shipped_flat_top_rule():
    for db in [SY.flat_top(), SY.flat_top(last="breakout")] + [SY.random_walk(seed=s) for s in range(6)]:
        S = U.series(db)
        for i in range(len(db)):
            base = FT.evaluate(db, S, i)
            c = FT4.evaluate(db, S, i)
            if base is not None:
                assert c is not None and not c["new"] and c["variant"] == base["variant"], i
                assert c["L"] == FT.FT_L and c["ceiling"] == base["ceiling"], i
            elif c is not None:
                assert c["new"] and c["L"] in FT4.NEW_LENS, i


def test_the_new_branch_fires_where_the_base_rule_refuses():
    bars = _new_branch_case()
    S = U.series(bars)
    i = len(bars) - 1
    assert FT.evaluate(bars, S, i) is None
    c = _last(bars)
    f = c["facts"]
    assert c["L"] in FT4.NEW_LENS and c["variant"] in ("breakout", "at_line")
    assert f["groups"] >= FT4.NEW_GROUPS and f["age"] >= FT4.NEW_AGE
    assert max(b["h"] for b in bars[i - FT4.NEST_LB:i]) <= c["ceiling"] + FT4.NEST_ATR * S["atr"][i]
    assert S["s200"][i] > S["s200"][i - FT4.S200_LAG]


@pytest.mark.parametrize("name,value", [("NEW_AGE", 1000), ("NEST_ATR", -1000.0),
                                        ("S200_LAG", 10_000), ("NEW_LENS", ()),
                                        ("NEW_GROUPS", 1000)])
def test_each_new_branch_gate_can_silence_it(monkeypatch, name, value):
    bars = _new_branch_case()
    assert _last(bars) is not None
    monkeypatch.setattr(FT4, name, value)
    assert _last(bars) is None


def test_without_220_bars_only_the_base_branch_can_fire():
    bars = _new_branch_case()
    short = bars[-219:]
    c = _last(short)
    assert c is None or not c["new"], "the new branch needs the 200 SMA 20 sessions back"
    for d in FT4.detect_uct_flat_top_breakout_ftb4(short, {}):
        assert d["geometry"]["extras"]["ftb4_branch"] == "base"
    base = SY.flat_top()             # 256 bars, the base rule fires on the newest
    (d,) = FT4.detect_uct_flat_top_breakout_ftb4(base, {})
    assert d["geometry"]["extras"]["ftb4_branch"] == "base"
    assert d["geometry"]["extras"]["base_window"] == FT.FT_L


def test_detection_shape_and_branch_marker():
    bars = _new_branch_case()
    (d,) = FT4.detect_uct_flat_top_breakout_ftb4(bars, build_context(bars, sym="TEST"))
    ex = d["geometry"]["extras"]
    c = _last(bars)
    assert d["pattern_id"] == _PID and d["direction"] == "bullish"
    assert ex["ftb4_branch"] == "new" and ex["base_window"] == c["L"]
    assert ex["lab_rule"] == "recall_v4.ftb4"
    assert d["levels"]["pivot"] == round(c["ceiling"], 2)
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
    assert registry.min_bars_for(_PID) == FT4.MIN_BARS == 199 + FT4.S200_LAG + 1 + U.MAX_TRIGGER_AGE - 1 == 222
    assert registry.min_bars_for("uct_flat_top_breakout") == FT.MIN_BARS == 202
    bars = list(range(300))
    assert registry.bars_for(_PID, bars, 200) == bars[-FT4.MIN_BARS:]
