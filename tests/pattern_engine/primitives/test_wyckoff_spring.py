"""The Wyckoff Spring: the one event in a corpus that publishes no thresholds."""
from api.services.screener import base_catalog as bc
from api.services.screener import bases


def _bar(i, c, hi=None, lo=None, v=1_000_000):
    return {"t": 20240000 + i, "o": c, "c": c, "v": v,
            "h": hi if hi is not None else c * 1.01,
            "l": lo if lo is not None else c * 0.99}


def _range(n=75, mid=100.0, half=0.06, drift=0.0):
    """A horizontal trading range oscillating around `mid`."""
    out = []
    for i in range(n):
        centre = mid * (1 + drift * (i / max(1, n - 1)))
        c = centre * (1 + (half if i % 2 else -half) * 0.8)
        out.append(_bar(i, c))
    return out


def _spring(pen=0.03, tail_close=1.0, n=75, drift=0.0):
    """A range, then a dip below its floor that closes back inside."""
    bars = _range(n=n, drift=drift)
    support = min(b["l"] for b in bars)
    # the spring bar: low pierces support, close recovers above it
    bars.append(_bar(len(bars), support * 1.02,
                     lo=support * (1 - pen), hi=support * 1.03))
    for _ in range(4):
        bars.append(_bar(len(bars), support * 1.04 * tail_close))
    return bars


def _ctx(bars):
    return bases._context(bars, bars)


def _st(bars):
    return bc.wyckoff_spring_state(bars)


# ── the one computable criterion ───────────────────────────────────────────

def test_a_dip_below_support_that_closes_back_inside_is_a_SPRING():
    st = _st(_spring(pen=0.03))
    assert st is not None
    assert st["spring_low"] < st["support"] < st["close"]
    assert st["penetration"] > 0


def test_a_dip_that_does_NOT_reclaim_support_is_not_a_spring():
    """The reclaim is the event. Without it this is just a breakdown."""
    bars = _range(n=75)
    support = min(b["l"] for b in bars)
    for _ in range(5):                       # break down and stay down
        bars.append(_bar(len(bars), support * 0.90))
    assert _st(bars) is None


def test_a_spring_that_has_since_broken_down_is_no_longer_a_spring():
    """A failed spring is a different event with the opposite meaning, so the
    label must not survive price leaving the range.
    """
    bars = _spring(pen=0.03)
    support = _st(bars)["support"]
    for _ in range(4):
        bars.append(_bar(len(bars), support * 0.88))
    assert _st(bars) is None


def test_a_range_with_no_penetration_at_all_is_not_a_spring():
    assert _st(_range(n=70)) is None


# ── the gate that makes "support" mean something ───────────────────────────

def test_a_DOWNTREND_is_not_a_trading_range():
    """⛔⛔ THE LOAD-BEARING GATE, AND IT IS OURS.

    The published criterion is comparative -- price goes below support and
    closes back above it -- and on a downtrend that is true on almost every
    bar, because "support" keeps moving down with price. The horizontality
    bound is what makes the word mean anything. It is the same failure the
    square box had, in a different costume.
    """
    assert _st(_spring(pen=0.03, drift=-0.35)) is None


def test_the_horizontality_bound_is_shared_with_the_square_box():
    """One definition of 'not trending' in the file, not two."""
    assert bc.SPRING_MAX_BOXINESS == bc.BOX_MAX_BOXINESS


# ── provenance: a corpus that publishes a grammar, not thresholds ──────────

def test_the_reason_only_ONE_wyckoff_event_is_built_is_recorded():
    """⛔ 184 refusals, no criterion at high confidence carrying a published
    constant, and Wyckoff himself rejecting mechanical rules. A four-schematic
    state machine would be our invention wearing his name.
    """
    w = bc.by_key("wyckoff-spring")
    why = [c for c in w.criteria if c.value == "grammar-not-thresholds"]
    assert why, "the decision not to build the schematic must be recorded"
    assert "Nothing in the stock market is definitive" in (why[0].quote or "")


def test_only_the_spring_is_registered_not_a_schematic_of_events():
    keys = {s.key for s in bc.RELATIONS}
    assert "wyckoff-spring" in keys
    for absent in ("wyckoff-accumulation", "wyckoff-distribution",
                   "wyckoff-sos", "wyckoff-upthrust"):
        assert absent not in keys, (
            "%s was registered; the corpus does not support building it"
            % absent)


def test_the_unpublished_penetration_depth_is_a_refusal():
    """The corpus's one numeric penetration figure is an illustrative example
    on a $50 stock, not a threshold -- so any penetration counts.
    """
    w = bc.by_key("wyckoff-spring")
    pen = [c for c in w.criteria if "Depth of the penetration" in c.condition]
    assert pen and pen[0].value is None and pen[0].missing
    assert "$50 stock" in pen[0].missing


def test_late_in_the_range_is_a_refusal_with_our_bound_beside_it():
    w = bc.by_key("wyckoff-spring")
    late = [c for c in w.criteria if "late within a TR" in (c.quote or "")]
    assert late and late[0].value is None and late[0].missing
    ours = [c for c in w.criteria if c.origin == "uct"]
    assert any(c.value == (bc.SPRING_TR_BARS, bc.SPRING_RECENT_BARS)
               for c in ours)
