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
    """⭐ `tier` IS A FAMILY LABEL, NOT A POSITION. It grouped the cascade when
    every head sat in tier order, and asserting that monotonicity here would lock
    the list into a shape measurement has already disproved: the double
    compressions were promoted out of tier 5 into the middle of tier 3 because
    they were being swallowed (264 satisfying, 44 rendering). Position is decided
    by information density, which mostly but not always follows the family.

    These two ARE real invariants: the guards must run before anything that
    divides by a range, and the terminal must be last or the cascade is not total.
    """
    order = [c.key for c in bc.CASCADE]
    assert order[:2] == ["no-trade", "flat-bar"]
    assert all(c.tier == 0 for c in bc.CASCADE[:2])
    assert all(c.tier != 0 for c in bc.CASCADE[2:])
    assert bc.CASCADE[-1].detect({}) is True


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


# ── the compression family ──────────────────────────────────────────────────
def test_double_compression_outranks_the_common_directional_labels():
    """🔴 MEASURED 2026-08-24: `inside-day-nr7` had **264 bars satisfying it and
    44 rendering** — 91 lost to No Demand and 50 to Green to Red. "Opened above
    and closed below" is not a more useful thing to say about a bar than "an
    inside day that is also the narrowest of seven". After the promotion: 206."""
    order = [c.key for c in bc.CASCADE]
    for k in ("inside-run-3plus", "inside-run-2", "inside-day-nr7"):
        assert order.index(k) < order.index("red-to-green"), k
        assert order.index(k) < order.index("no-demand"), k
    # ⛔ but the SINGLE-condition forms stay put — common is not notable
    assert order.index("inside-day") > order.index("no-demand")
    assert order.index("compression-bar-nr7") > order.index("no-demand")


def test_a_run_of_inside_bars_beats_a_single_inside_day():
    order = [c.key for c in bc.CASCADE]
    assert order.index("inside-run-3plus") < order.index("inside-run-2")
    assert order.index("inside-run-2") < order.index("inside-day-nr7")
    assert order.index("inside-day-nr7") < order.index("inside-day")


def test_nr4_is_not_a_label():
    """⛔ 1,304 of 3,707 bars satisfy "narrowest of the last four" — a third of
    the market. A label that common carries no information; NR7 (21%) is already
    the edge of useful. Do not re-add it."""
    assert "compression-bar-nr4" not in bc.BY_KEY
    assert not any("NR4" in c.label for c in bc.CASCADE)


def test_a_no_trade_session_never_reads_as_a_coil():
    """⚠️ A zero-range bar is trivially "inside" the one before it, so a run of
    no-trade sessions looks exactly like a tightening coil. Measured: 19 of the
    32 bars satisfying `inside-run-3plus` were no-trade rows. The Tier-0 guard is
    what keeps them out of the compression family."""
    bars = _base(60) + [_bar(50, 50, 50, 50, v=0) for _ in range(3)]
    assert bc.classify(bars)["bar_character"] == "no-trade"


# ── the streak fragment ─────────────────────────────────────────────────────
def test_a_streak_is_noted_only_when_it_is_notable():
    """⛔ A one- or two-day run is the market's ordinary state. Printing it on
    every row would be noise wearing the costume of information."""
    assert bc.streak_fragment({"run_up": 2, "run_down": 0, "higher_lows": 0}) is None
    assert bc.streak_fragment({"run_up": 4, "run_down": 0, "higher_lows": 0}) \
        == "4 straight up days"
    assert bc.streak_fragment({"run_up": 0, "run_down": 3, "higher_lows": 0}) \
        == "3 straight down days"
    assert bc.streak_fragment({"run_up": 0, "run_down": 0, "higher_lows": 5}) \
        == "5 higher lows"
    assert bc.streak_fragment({"run_up": 0, "run_down": 0, "higher_lows": 3}) is None


def test_the_streak_counts_come_from_multi_candle_not_a_private_copy():
    """⛔ `inside_bar_run`, `consecutive_up/down` and `higher_lows_run` are all
    member-facing filters owned by `multi_candle`. A second implementation here
    would drift from the values a member screens on."""
    from api.services.screener import candles
    bars = _base(50, 20.0)
    p = 20.0
    for _ in range(4):
        p += 0.3
        bars.append(_bar(p - 0.2, p + 0.1, p - 0.25, p))
    f = bc.features(bars)
    m = candles.multi_candle(bars)
    assert f["run_up"] == m["consecutive_up"]
    assert f["higher_lows"] == m["higher_lows_run"]
    assert f["inside_run"] == m["inside_bar_run"]
