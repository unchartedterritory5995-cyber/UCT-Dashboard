"""The CHARACTER cascade's contracts: totality, priority order, and the
refusal to name anything the session did not settle.

⭐ THE CENTRAL CLAIM is that the cascade is TOTAL — a strict priority list whose
last predicate is identically true, so no bar can reach the end unnamed. That is
asserted three ways here: structurally (the terminal accepts an empty feature
dict), by property test over random bars, and by the guarantee that every key the
classifier can emit is registered.
"""
import random

import pytest

from api.services.screener import bar_character as bc, technicals


def _bar(o, h, l, c, v=1_000_000):
    return {"o": o, "h": h, "l": l, "c": c, "v": v}


def _base(n=60, price=50.0):
    return [_bar(price, price + 0.5, price - 0.5, price) for _ in range(n)]


# ── totality ────────────────────────────────────────────────────────────────
def test_the_cascade_ends_in_an_unconditional_predicate():
    """⛔ THIS IS WHAT MAKES IT TOTAL. Without a terminal that accepts anything,
    a bar can fall off the end of the list with no name — the exact defect the
    CANDLE column shipped with for months (43.6% of the market)."""
    assert bc.CASCADE[-1].detect({}) is True
    assert bc.CASCADE[-1].key == "unchanged"


def test_every_bar_gets_a_character():
    rng = random.Random(20260824)
    for _ in range(3000):
        price = rng.uniform(1, 500)
        bars = _base(60, price)
        lo = price * rng.uniform(0.85, 0.999)
        hi = price * rng.uniform(1.001, 1.15)
        bars.append(_bar(rng.uniform(lo, hi), hi, lo, rng.uniform(lo, hi),
                         v=rng.choice([0, 1, 10_000, 5_000_000])))
        out = bc.classify(bars)
        assert out["bar_character"] in bc.BY_KEY, out
        assert out["bar_character_label"]


def test_a_single_bar_with_no_history_still_gets_a_name():
    """No prior close means no direction — the terminal has to catch it."""
    out = bc.classify([_bar(10, 11, 9, 10)])
    assert out["bar_character"] == "unchanged"


def test_no_bars_at_all_is_an_absence_not_a_label():
    assert bc.classify([]) == {"bar_character": None, "bar_character_label": None}


# ── registry integrity ──────────────────────────────────────────────────────
def test_every_character_is_complete_and_unique():
    keys = [c.key for c in bc.CASCADE]
    assert len(keys) == len(set(keys))
    for c in bc.CASCADE:
        assert c.label and c.desc and callable(c.detect), c.key
        assert c.tier in (0, 1, 2, 3, 4, 5), c.key


def test_filter_options_are_derived_from_the_cascade():
    opts = bc.enum_options()
    assert opts[0] == {"label": "Any"}
    assert {o["value"] for o in opts if "value" in o} == set(bc.BY_KEY)


def test_no_forward_looking_gap_type_is_ever_named():
    """⛔ Breakaway / runaway / exhaustion gaps are defined ENTIRELY by what
    happens after them (Bulkowski: a breakaway closes within a week 1% of the
    time, an exhaustion gap 60%). Naming one on the gap day is fabrication."""
    banned = ("breakaway", "runaway", "exhaustion", "measuring", "continuation")
    for c in bc.CASCADE:
        blob = f"{c.key} {c.label}".lower()
        for word in banned:
            assert word not in blob, (c.key, word)


# ── the guards must be first ────────────────────────────────────────────────
def test_a_no_trade_session_is_named_before_anything_else():
    out = bc.classify(_base() + [_bar(50, 52, 48, 51, v=0)])
    assert out["bar_character"] == "no-trade"
    # ⛔ and it carries NO close/volume story — there was no session to describe
    assert out["bar_character_label"] == "No Trade"


def test_a_flat_bar_is_named_before_anything_that_divides_by_range():
    out = bc.classify(_base() + [_bar(50, 50, 50, 50)])
    assert out["bar_character"] == "flat-bar"
    assert out["bar_character_label"] == "Flat Bar"


# ── an unknown measurement is never evidence ────────────────────────────────
@pytest.mark.parametrize("cmp,arg", [(bc._ge, 1.8), (bc._le, 0.7),
                                     (bc._lt, 0.8)])
def test_a_missing_measurement_fails_every_comparison(cmp, arg):
    """⛔ `None >= 1.8` RAISES and `0 >= 1.8` LIES. An absent rvol must fail the
    test in BOTH directions — "we don't know" is not evidence of quiet volume
    any more than it is evidence of heavy volume."""
    assert cmp(None, arg) is False


def test_between_rejects_a_missing_value():
    assert bc._bt(None, 1.0, 2.0) is False
    assert bc._bt(1.5, 1.0, 2.0) is True


def test_volume_fragment_is_omitted_rather_than_called_average():
    assert bc.volume_fragment({"rvol": None}) is None
    assert bc.volume_fragment({"rvol": 1.0}) is None          # genuinely average
    assert bc.volume_fragment({"rvol": 4.5}) == "on Climactic Volume"
    assert bc.volume_fragment({"rvol": 0.2}) == "on Dried-Up Volume"


def test_close_fragment_covers_the_whole_range():
    seen = {bc.close_fragment({"clv": v / 100}) for v in range(0, 101)}
    assert None not in seen
    assert len(seen) == 7          # the ladder is MECE and total over [0, 1]
    assert bc.close_fragment({"clv": None}) is None


# ── priority-order regressions found on the real market ─────────────────────
def test_the_volume_confirmed_label_outranks_the_general_one():
    """🔴 MEASURED 2026-08-24: **11 bars satisfied `upthrust` and 0 rendered**,
    5 of them absorbed by `failed-breakout` sitting one line above it in the
    SAME tier. Both describe a poke above the 20-day high that did not hold, but
    Upthrust carries three extra pieces of evidence. A more specific predicate
    placed after the general one it overlaps can never fire."""
    order = [c.key for c in bc.CASCADE]
    assert order.index("upthrust") < order.index("failed-breakout")
    assert order.index("spring-shakeout") < order.index("undercut-and-reclaim")


def test_the_guards_precede_every_tier_that_divides():
    order = [c.key for c in bc.CASCADE]
    assert order[:2] == ["no-trade", "flat-bar"]
    assert all(c.tier >= bc.CASCADE[i - 1].tier
               for i, c in enumerate(bc.CASCADE) if i)     # tiers never go back


# ── one authority for relative volume ───────────────────────────────────────
def test_character_reads_the_same_rvol_the_column_filters_on():
    """⛔ A second RVOL implementation here would be the `atr_pct`/`adr_pct`
    defect in a new place: two differently-computed values wearing one name."""
    bars = _base(40) + [_bar(50, 51, 49, 50.5, v=5_000_000)]
    f = bc.features(bars)
    assert f["rvol"] == technicals.volume_ratio(bars)


def test_the_rvol_denominator_excludes_today():
    """Averaging today in drags the mean toward the spike it is meant to
    measure — a genuine 10x day would read about 5.6x."""
    bars = [_bar(10, 11, 9, 10, v=100) for _ in range(30)]
    bars.append(_bar(10, 11, 9, 10, v=1000))
    assert technicals.volume_ratio(bars) == 10.0


def test_relative_volume_refuses_rather_than_reporting_zero():
    assert technicals.volume_ratio([]) is None
    assert technicals.volume_ratio([_bar(10, 11, 9, 10, v=None)]) is None


# ── the label renders head, then close, then volume ─────────────────────────
def test_the_label_reads_as_a_sentence():
    bars = _base(60, 10.0) + [_bar(10.6, 11.0, 10.55, 10.98, v=3_000_000)]
    out = bc.classify(bars)
    assert out["bar_character"] == "gap-up-and-go"
    assert out["bar_character_label"] == \
        "Gap Up & Go, closed on the high, on Huge Volume"
