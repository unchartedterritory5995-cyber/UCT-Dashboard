"""A bar with no range has no shape — the refusal, and its controls.

Written against the 2026-08-23 accuracy wave's finding: `screener.identities`
fired three separate identities on the same 81 snapshot rows, and the cause was
`single_candle`'s `rng = max(h - l, 1e-9)` completing a `0/0` division instead of
refusing it. See `candles.single_candle`'s docstring for the measurement.

⭐ EVERY REFUSAL TEST HERE IS PAIRED WITH A CONTROL that keeps its classification,
because a guard that over-refuses is the same defect pointed the other way and a
one-sided test cannot see it.
"""
from api.services.screener import candles


def _bar(o, h, l, c, v=1_000_000):
    return {"o": o, "h": h, "l": l, "c": c, "v": v}


def _context(n=20):
    """Ordinary prior bars, so `_atr` is non-zero and wide/narrow are decidable."""
    return [_bar(10, 10.2, 9.8, 10.0) for _ in range(n)]


# ── the zero-range bar ────────────────────────────────────────────────────────

def test_a_bar_that_never_moved_is_not_a_doji():
    """The headline: 78 rows on the 2026-08-24 build published `doji` for this."""
    bars = _context() + [_bar(27.26, 27.26, 27.26, 27.26, v=1073)]  # GBLI, 8/21
    out = candles.single_candle(bars)
    assert out["candle_type"] == "none", "a bar with no range has no shape"
    assert out["body_pct"] is None
    assert out["upper_wick_pct"] is None
    assert out["lower_wick_pct"] is None


def test_a_bar_that_never_moved_does_not_claim_it_closed_at_its_low():
    """`close_position = 0.0` read as "closed at the bottom of the range" — a
    bearish statement about a session that had no range at all."""
    bars = _context() + [_bar(9.96, 9.96, 9.96, 9.96, v=0)]  # SORN, 8/21
    assert candles.single_candle(bars)["close_position"] is None


def test_the_zero_range_bar_keeps_the_measurement_that_is_still_true():
    """⛔ The refusal is scoped to the `0/0` fractions. `narrow_bar` compares a
    MEASURED range against ATR; 0 really is narrower than half an ATR."""
    bars = _context() + [_bar(10.0, 10.0, 10.0, 10.0)]
    out = candles.single_candle(bars)
    assert out["narrow_bar"] is True
    assert out["wide_bar"] is False


def test_the_control_a_real_doji_still_classifies():
    """The guard must not reach a bar that has a range."""
    bars = _context() + [_bar(10.0, 10.5, 9.5, 10.01)]
    out = candles.single_candle(bars)
    # The guard's contract is that a bar WITH a range still classifies — not
    # that it lands on one particular spelling. This bar has ~50% wicks both
    # ways, which is the long-legged sub-type.
    assert out["candle_type"] in ("doji", "long-legged-doji",
                                  "dragonfly-doji", "gravestone-doji")
    assert out["body_pct"] is not None


# ── the self-contradicting bar ────────────────────────────────────────────────

def test_a_close_outside_its_own_high_refuses_every_field():
    """EWCZ/MCW publish `marubozu` — maximum conviction — off `body_pct` ~5.8e9.
    ⚠️ 0 of 3,712 tickers are in this shape today; this is the guard."""
    bars = _context() + [_bar(10.0, 10.0, 10.0, 15.82)]
    out = candles.single_candle(bars)
    assert out["candle_type"] == "none"
    assert out["body_pct"] is None
    assert out["wide_bar"] is False, "a bar that contradicts itself cannot be sized"
    assert out["narrow_bar"] is False


def test_an_open_below_its_own_low_refuses():
    bars = _context() + [_bar(8.0, 10.5, 9.5, 10.0)]
    assert candles.single_candle(bars)["candle_type"] == "none"


def test_the_control_a_close_exactly_on_the_low_is_ordinary():
    """`min(o, c) < l` must be STRICT — closing exactly at the low is the most
    ordinary bar there is, and an inclusive comparison would refuse it."""
    bars = _context() + [_bar(10.4, 10.5, 9.5, 9.5)]
    out = candles.single_candle(bars)
    assert out["candle_type"] != "none"
    assert out["close_position"] == 0.0, "a real close at the low, honestly 0.0"


# ── the identity the audit would have run ─────────────────────────────────────

def test_the_parts_close_to_one_whenever_they_are_published():
    """The identity that caught this, asserted directly: whenever the three
    fractions exist they describe the whole bar."""
    for bar in (_bar(10.0, 10.5, 9.5, 10.4), _bar(10.0, 10.5, 9.5, 9.6),
                _bar(10.0, 10.1, 9.0, 9.95), _bar(10.0, 10.5, 9.5, 10.01),
                _bar(9.5, 10.5, 9.5, 10.5), _bar(10.0, 10.0, 9.0, 9.0)):
        out = candles.single_candle(_context() + [bar])
        parts = (out["body_pct"], out["upper_wick_pct"], out["lower_wick_pct"])
        assert None not in parts, f"unexpectedly refused a real bar: {bar}"
        assert abs(sum(parts) - 1.0) <= 0.0002, f"{bar} -> {parts}"
        assert 0.0 <= out["close_position"] <= 1.0


def test_no_field_is_shared_between_two_refusals():
    """`_NO_SHAPE` is module-level; each return must be its own dict or one
    caller's mutation reaches the next."""
    a = candles.single_candle([])
    a["candle_type"] = "MUTATED"
    assert candles.single_candle([])["candle_type"] == "none"
