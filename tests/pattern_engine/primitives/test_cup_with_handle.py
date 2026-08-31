"""The cup with handle: the shapes it must refuse, and the numbers nobody published."""
import math

from api.services.pattern_engine.primitives import cup, shape
from api.services.screener import base_catalog as bc
from api.services.screener import bases


def _bar(i, c, hi=None, lo=None, v=1_000_000):
    return {"t": 20240000 + i, "o": c, "c": c, "v": v,
            "h": hi if hi is not None else c * 1.004,
            "l": lo if lo is not None else c * 0.996}


def _closes(cl, start=0):
    return [_bar(start + i, c) for i, c in enumerate(cl)]


def _cosine_cup(n, depth, rim=100.0):
    return [rim * (1 - depth * 0.5 * (1 - math.cos(2 * math.pi * i / (n - 1))))
            for i in range(n)]


def _linear_v(n, depth, rim=100.0):
    h = n // 2
    down = [rim - (rim * depth) * i / h for i in range(h)]
    up = [rim * (1 - depth) + (rim * depth) * i / (n - h - 1)
          for i in range(n - h)]
    return down + up


def _series(cup_closes, handle_n=10, handle_drop=0.05, lead=40,
            prior_gain=0.45, ease=True):
    """A prior ADVANCE, the cup, then a handle drifting down along its lows.

    ⚠️ The lead is a real 45% advance and volume EASES into the handle, because
    both are published rules. The first version of this fixture had a 7% lead
    and flat volume -- it passed only because the detector did not yet ask, and
    it would have gone on passing while the detector measured a pattern O'Neil
    never described.
    """
    rim = cup_closes[0]
    base = rim / (1.0 + prior_gain)
    step = (rim - base) / max(1, lead - 1)
    bars = [_bar(i, base + i * step, v=1_000_000) for i in range(lead)]
    bars += [_bar(len(bars) + i, c, v=1_000_000)
             for i, c in enumerate(cup_closes)]
    top = bars[-1]["c"]
    hv = 400_000 if ease else 1_000_000
    for i in range(handle_n):
        bars.append(_bar(len(bars), top * (1 - handle_drop * (i + 1) / handle_n),
                         v=hv))
    return bars


def _ctx(bars):
    return bases._context(bars, bars)


def _det(bars):
    return bc.by_key("cup-with-handle").detect(_ctx(bars))


# ── the shape ──────────────────────────────────────────────────────────────

def test_a_proper_cup_with_a_downward_handle_is_ACCEPTED():
    st = cup.cup_with_handle_state(_series(_cosine_cup(60, 0.20)))
    assert st is not None
    assert cup.CUP_MIN_DEPTH <= st["depth"] <= cup.CUP_MAX_DEPTH
    assert st["roundness"] >= cup.MIN_ROUNDNESS


def test_a_V_is_REFUSED_because_the_V_is_the_named_failure():
    assert cup.cup_with_handle_state(_series(_linear_v(60, 0.20))) is None


def test_roundness_separates_a_V_from_a_cup_and_is_depth_invariant():
    """⭐ The threshold is derived from THIS table, not chosen by eye.

    An earlier value of 0.30 was picked by taste and refused every realistic
    cup -- a 45%-deep cosine scored 0.275 and was rejected as insufficiently
    round. Measuring the canonical shapes is what caught it.
    """
    scores = {}
    for name, fn in (("v", _linear_v), ("cosine", _cosine_cup)):
        for d in (0.12, 0.20, 0.33, 0.45):
            r = shape.roundness(_closes(fn(60, d)), 0, 59)
            scores[(name, d)] = r
    vs = [v for (n, _), v in scores.items() if n == "v"]
    cs = [v for (n, _), v in scores.items() if n == "cosine"]
    assert max(vs) < cup.MIN_ROUNDNESS < min(cs), (
        "the threshold must sit between the V and the softest real cup; "
        "got V=%r cosine=%r threshold=%r" % (vs, cs, cup.MIN_ROUNDNESS))
    assert len(set(round(v, 6) for v in cs)) == 1, (
        "roundness is a SHAPE measure and must not move with depth")


def test_a_cup_shallower_than_twelve_percent_is_refused():
    assert cup.cup_with_handle_state(_series(_cosine_cup(60, 0.05))) is None


# ── the handle ─────────────────────────────────────────────────────────────

def test_a_handle_drifting_UP_is_refused():
    """O'Neil names the upward drift as a defect, not a variant."""
    up = _series(_cosine_cup(60, 0.20), handle_drop=-0.05)
    assert cup.cup_with_handle_state(up) is None


def test_the_handle_drift_is_read_off_the_LOWS_not_the_closes():
    """⭐ A handle can close flat while its lows step down -- which is exactly
    the shakeout the rule describes, so reading closes would refuse the
    textbook case.
    """
    flat_closes_falling_lows = [
        _bar(i, 100.0, hi=100.4, lo=100.0 - 0.3 * i) for i in range(10)]
    closes = [b["c"] for b in flat_closes_falling_lows]
    assert max(closes) == min(closes), "fixture: closes are flat"
    assert cup._drifts_down(flat_closes_falling_lows) is True


# ── the bear allowance is CONDITIONAL, never the default ───────────────────

def test_a_deep_cup_is_refused_by_default_and_allowed_only_on_request():
    """The 50% allowance is conditional on a bear market the detector is never
    told about. Applying it silently would measure a different published rule.
    """
    deep = _series(_cosine_cup(60, 0.45))
    assert cup.cup_with_handle_state(deep) is None
    assert cup.cup_with_handle_state(
        deep, max_depth=cup.CUP_BEAR_MAX_DEPTH) is not None


def test_the_structure_detector_never_applies_the_bear_allowance():
    deep = _series(_cosine_cup(60, 0.45))
    assert _det(deep) is False


# ── provenance ─────────────────────────────────────────────────────────────

def test_the_missing_handle_minimum_refuses_rather_than_borrowing_bulkowski():
    """A different authority's number is not a substitute for a missing one."""
    c = bc.by_key("cup-with-handle")
    hl = [x for x in c.criteria if "Handle length" in x.condition]
    assert hl and hl[0].value is None and hl[0].missing
    assert "Bulkowski" in hl[0].missing


def test_bulkowskis_measured_numbers_are_recorded_and_NOT_used():
    """They are measured on his definition, with no benchmark and no stated
    date range, on hand-selected 'perfect' patterns. Recorded, refused.
    """
    c = bc.by_key("cup-with-handle")
    b = [x for x in c.criteria if "Bulkowski" in x.condition]
    assert b and b[0].value is None and b[0].missing
    assert "benchmark" in b[0].missing


def test_the_unpublished_rim_tolerance_is_a_refusal_with_our_cutoff_beside_it():
    c = bc.by_key("cup-with-handle")
    refused = [x for x in c.criteria if "Rim tolerance" in x.condition]
    assert refused and refused[0].value is None and refused[0].missing
    ours = [x for x in c.criteria if x.origin == "uct"
            and x.value == cup.MIN_RIM_EQUALITY]
    assert ours, "our cutoff must be recorded separately, as ours"


def test_every_uct_number_in_the_cup_is_attributed_to_us():
    c = bc.by_key("cup-with-handle")
    ours = {x.value for x in c.criteria if x.origin == "uct"}
    assert cup.MIN_ROUNDNESS in ours
    assert cup.MIN_RIM_EQUALITY in ours
    for x in c.criteria:
        if x.origin == "uct":
            assert x.source_id is None


# ── the two rules that decide WHICH pattern is being measured ──────────────

def test_a_cup_with_NO_PRIOR_ADVANCE_is_refused():
    """⛔⛔ THE RULE THAT CHANGES WHAT THE DETECTOR *IS*.

    A cup is a rest in an advance. The identical geometry with no advance
    before it is a stock that fell and recovered -- mean reversion, a
    different animal. Omitting this does not make the rule looser, it makes it
    a DIFFERENT rule, and reporting that rule's number under O'Neil's name
    would be a misattribution.
    """
    no_lead = _series(_cosine_cup(60, 0.20), prior_gain=0.05)
    assert cup.cup_with_handle_state(no_lead) is None
    with_lead = _series(_cosine_cup(60, 0.20), prior_gain=0.45)
    assert cup.cup_with_handle_state(with_lead) is not None


def test_a_handle_whose_volume_does_NOT_ease_is_refused():
    """"Turnover fell sharply as it shaped a handle." A direction, not a
    ratio -- so the test is the direction and nothing more.
    """
    flat_vol = _series(_cosine_cup(60, 0.20), ease=False)
    assert cup.cup_with_handle_state(flat_vol) is None


def test_the_volume_rule_tests_a_direction_and_invents_no_ratio():
    """The house publishes no percentage, so neither do we."""
    bars = _series(_cosine_cup(60, 0.20))
    st = cup.cup_with_handle_state(bars)
    assert st is not None
    cup_v = [b["v"] for b in bars[st["cup_start"]:st["cup_end"]]]
    handle_v = [b["v"] for b in bars[st["cup_end"]:]]
    ratio = (sum(handle_v) / len(handle_v)) / (sum(cup_v) / len(cup_v))
    assert ratio < 1.0
    # A barely-easing handle must still pass: any threshold would be ours.
    barely = _series(_cosine_cup(60, 0.20))
    for b in barely[-10:]:
        b["v"] = 999_999
    assert cup.cup_with_handle_state(barely) is not None
