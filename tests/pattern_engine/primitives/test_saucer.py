"""The Saucer: IBD against itself on depth, and a base the house says you
cannot see on a daily chart."""
import math

from api.services.screener import base_catalog as bc
from api.services.screener import bases
from api.services.pattern_engine.primitives import cup


def _bar(i, c, v=1_000_000):
    return {"t": 20240000 + i, "o": c, "c": c, "v": v,
            "h": c * 1.004, "l": c * 0.996}


def _saucer(depth=0.16, n=140, top=100.0, lead=30):
    """A long, shallow, rounded decline and recovery."""
    bars = [_bar(i, top * 0.9 + top * 0.1 * (i + 1) / lead) for i in range(lead)]
    for i in range(n):
        frac = i / (n - 1)
        c = top * (1 - depth * 0.5 * (1 - math.cos(2 * math.pi * frac)))
        bars.append(_bar(len(bars), c))
    return bars


def _st(bars):
    return bc.saucer_state(bases._context(bars, bars))


# ── shape ──────────────────────────────────────────────────────────────────

def test_a_long_shallow_rounded_base_is_a_SAUCER():
    st = _st(_saucer(depth=0.16, n=140))
    assert st is not None
    assert bc.SAUCER_MIN_DEPTH <= st["depth"] <= bc.SAUCER_MAX_DEPTH
    assert st["bars"] >= bc.SAUCER_MIN_BARS


def test_a_DEEP_SHORT_base_is_a_cup_not_a_saucer():
    """⛔ THE DISCRIMINATOR, AND IT IS OURS BECAUSE IT HAS TO BE. The corpus is
    explicit: "IBD publishes no cutoff, so the saucer/cup boundary is a
    tunable, not a rule." A saucer is shallow AND long; depth and duration
    alone would admit every cup.
    """
    assert _st(_saucer(depth=0.28, n=45)) is None


def test_a_base_deeper_than_the_wider_published_ceiling_is_refused():
    assert _st(_saucer(depth=0.42, n=200)) is None


def test_a_base_shorter_than_seven_weeks_is_refused():
    assert _st(_saucer(depth=0.12, n=20)) is None


# ── the house contradicting itself ─────────────────────────────────────────

def test_both_published_depths_are_recorded_and_the_WIDER_is_applied():
    """One column says "about 12% to 20%", another "up to 30%". A detector
    cannot satisfy both, and averaging them would invent a third number
    neither column published. The wider is applied so the gate refuses only
    what BOTH would refuse.
    """
    sc = bc.by_key("saucer")
    assert bc.SAUCER_MAX_DEPTH == 0.30
    wider = [c for c in sc.criteria if "AGAINST ITSELF" in c.condition]
    assert wider and wider[0].value == bc.SAUCER_MAX_DEPTH
    tighter = [c for c in sc.criteria if c.value == "12-20%"]
    assert tighter and "12% to 20%" in (tighter[0].quote or "")


def test_a_base_inside_the_tighter_band_is_accepted_by_the_wider_one():
    """The control on that choice: applying the wider ceiling must not exclude
    anything the tighter one would have allowed.
    """
    assert _st(_saucer(depth=0.16, n=140)) is not None


# ── what the house tells us we cannot do ───────────────────────────────────

def test_the_daily_bar_limitation_is_recorded_on_the_structure():
    """⚠️ "saucer bases can be so long that they're only visible on a weekly or
    monthly chart." That bounds what any measurement of this can mean -- a
    daily-bar detector MISSES saucers rather than merely mis-scoring them.
    """
    sc = bc.by_key("saucer")
    lim = [c for c in sc.criteria if c.value == "weekly-or-monthly"]
    assert lim and "weekly or monthly chart" in (lim[0].quote or "")


def test_the_cups_handle_rules_are_NOT_imported():
    """No saucer-specific handle geometry is published, and whether the cup's
    rules transfer is not stated. Importing them would be borrowing numbers
    across patterns.
    """
    sc = bc.by_key("saucer")
    h = [c for c in sc.criteria if "handle geometry" in c.condition]
    assert h and h[0].value is None and h[0].missing
    assert "NOT imported" in h[0].missing


def test_symmetry_is_reported_and_never_gated():
    """It is published as praise of one example, not as a rule."""
    sc = bc.by_key("saucer")
    sym = [c for c in sc.criteria if c.value == "reported-not-gated"]
    assert sym
    st = _st(_saucer())
    assert st is not None and st["symmetry"] is not None


def test_the_softened_volume_rule_yields_no_threshold():
    sc = bc.by_key("saucer")
    v = [c for c in sc.criteria if "Breakout volume" in c.condition]
    assert v and v[0].value is None and v[0].missing
    assert "SOFTENS" in v[0].missing


def test_the_equivalence_claim_is_refused_as_evidence():
    """"capable of producing strong gains similar to..." with no sample, no
    period and no comparison statistic.
    """
    sc = bc.by_key("saucer")
    e = [c for c in sc.criteria if "similar to" in (c.quote or "")]
    assert e and e[0].value is None and e[0].missing
