"""Go Signal — built from a one-line essence, so the reading IS the design.

⭐ OUR WHOLE DEFINITION IS: "A catalyst gap digests into the 9 EMA — then one
wide candle engulfs the pullback and closes above the catalyst high." Four
structural facts and zero numbers. That makes the READING of each phrase the
load-bearing decision, and these cases pin the readings rather than the numbers.

⛔ THE READING THAT WAS WRONG, KEPT AS A CASE. "Engulfs the pullback" was first
read as "opens beneath the pullback's lowest low". ZERO of 650 tickers satisfied
it — the detector was dead and looked merely rare. Our text does not say "opens
below"; it says the candle engulfs the pullback, which a close above the
pullback's high expresses without inventing a stricter rule.
"""
import sys, pathlib, datetime
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

from api.services.screener import base_catalog as bc

_DAY0 = datetime.date(2023, 1, 2)


def _b(o, h, l, c, i):
    d = _DAY0 + datetime.timedelta(days=i)
    return {"t": int(d.strftime("%Y%m%d")), "o": o, "h": h, "l": l, "c": c,
            "v": 1_000_000}


def _series(*, gap=True, digest=True, trigger_wide=True, trigger_green=True,
            close_above_catalyst=True, close_above_pullback=True):
    """A Go Signal built from its parts, each independently disableable.

    ⛔ A fixture that can only be all-or-nothing cannot show WHICH criterion a
    change broke — every negative case below turns off exactly one thing.
    """
    bars, i = [], 0
    # a quiet run-up so the 9 EMA is well defined and sits near 100
    for _ in range(70):
        bars.append(_b(100, 100.6, 99.4, 100, i)); i += 1

    # the catalyst gap: prior close 100 -> open 108, high 112
    open_ = 108.0 if gap else 100.4
    high = 112.0 if gap else 100.9
    catalyst_close = high - 1.0
    bars.append(_b(open_, high, open_ - 0.5, catalyst_close, i)); i += 1
    catalyst_high = high

    # ⛔ THE DIGEST PATH IS RELATIVE TO THE CATALYST CLOSE, NOT ABSOLUTE. Written
    # with absolute prices, the `gap=False` variant still leapt from ~100 to
    # ~109 one bar later and manufactured the very gap it was meant to remove —
    # so the case passed for the wrong reason. And `digest=False` used five
    # bars, which let the 9 EMA climb until it was touched anyway (low 109.9 vs
    # EMA*1.02 = 110.09). Three tight bars keep the EMA clear.
    if digest:
        path = [c * catalyst_close for c in (0.980, 0.960, 0.945, 0.932, 0.925)]
    else:
        path = [c * catalyst_close for c in (0.998, 1.001, 0.999)]
    for c in path:
        bars.append(_b(c + 0.4, c + 0.8, c - 0.8, c, i)); i += 1
    pullback_high = max(b["h"] for b in bars[-len(path):])

    # the trigger
    lo = bars[-1]["c"] - 0.3
    if close_above_catalyst and close_above_pullback:
        close = max(catalyst_high, pullback_high) + 2.0
    elif close_above_pullback:
        close = pullback_high + 0.5          # but under the catalyst high
    else:
        close = bars[-1]["c"] + 0.2          # recovers nothing
    if trigger_wide:
        open_t = lo if trigger_green else close + 1.0
        high_t, low_t = close + 0.4, lo - 6.0
    else:
        # ⛔ THE NON-WIDE CASE HAS TO GAP UP, and that is not fixture
        # convenience — it is the only way to close above the catalyst high on
        # a NARROW bar. A first draft merely raised the low, which left the
        # range wide anyway because the close sat ~12 points above the
        # pullback, so the case could never fail and proved nothing. Our
        # essence says ONE WIDE CANDLE; a small gap-up that arrives at the same
        # price is a different event and must be refused.
        open_t = close - (0.1 if trigger_green else -1.0)
        high_t, low_t = close + 0.1, close - 0.2
    bars.append(_b(open_t, high_t, low_t, close, i))
    return bars


# ─── the control, first ─────────────────────────────────────────────────────

def test_the_fixture_actually_fires():
    """⛔ NON-VACUITY. Every case below asserts `is None`. If the baseline never
    fired they would all pass while proving nothing — which is exactly how the
    first version of this detector looked 'merely rare' instead of dead."""
    assert bc.go_signal_state(_series()) is not None


# ─── each phrase of our essence, one case each ──────────────────────────────

def test_no_catalyst_gap_means_no_go_signal():
    assert bc.go_signal_state(_series(gap=False)) is None


def test_a_gap_that_never_digests_into_the_9_ema_is_refused():
    """"...digests into the 9 EMA". A gap that just holds up near its high is a
    different (and un-entered) thing."""
    assert bc.go_signal_state(_series(digest=False)) is None


def test_the_trigger_must_close_above_the_CATALYST_high():
    """The essence's final clause. Recovering the pullback but stalling under
    the gap day's high is not the signal."""
    assert bc.go_signal_state(_series(close_above_catalyst=False)) is None


def test_the_trigger_must_RECOVER_the_pullback():
    """⭐ THE READING THAT WAS WRONG. 'Engulfs the pullback' = closes above the
    pullback's high. A candle that recovers nothing is refused; the baseline,
    which opens INSIDE the pullback rather than beneath its lowest low, fires.
    Under the first reading the baseline would be refused too — which is how
    that reading was caught."""
    assert bc.go_signal_state(_series(close_above_pullback=False)) is None
    base = _series()
    assert bc.go_signal_state(base) is not None
    lows = [b["l"] for b in base[-6:-1]]
    assert base[-1]["o"] > min(lows), (
        "the baseline trigger opens INSIDE the pullback — if this ever stops "
        "being true the case no longer discriminates the two readings")


def test_the_trigger_must_be_one_WIDE_candle():
    assert bc.go_signal_state(_series(trigger_wide=False)) is None


def test_the_trigger_must_close_green():
    assert bc.go_signal_state(_series(trigger_green=False)) is None


def test_a_series_too_short_to_judge_is_refused_not_crashed():
    assert bc.go_signal_state([]) is None
    assert bc.go_signal_state(_series()[:40]) is None


def test_the_state_reports_what_it_measured():
    st = bc.go_signal_state(_series())
    assert st["gap_pct"] >= bc.GS_GAP
    assert st["trigger_range_x"] >= bc.GS_WIDE
    assert 0 < st["bars_since_gap"] <= bc.GS_DIGEST_BARS
    assert st["catalyst_high"] > 0


# ─── provenance ─────────────────────────────────────────────────────────────

def test_it_reads_as_OURS_and_claims_no_authority():
    st = bc._BY_KEY["go-signal"]
    assert bc.structure_origin(st) == "uct"
    assert not any(c.source_id for c in st.criteria)
    assert not any(c.quote for c in st.criteria)


def test_the_intraday_gap_is_declared_rather_than_approximated():
    """Our own catalog files this under the INTRADAY family. A completed daily
    bar can say the trigger happened but not when in the session — and that is
    stated, not papered over with a daily proxy."""
    st = bc._BY_KEY["go-signal"]
    text = " ".join(c.missing for c in st.criteria if c.missing).lower()
    assert "intraday" in text
    assert "one-line essence" in text, (
        "the refusal must say the thresholds have no basis even in our own "
        "text — that is the difference between this and EMA Crossback")


def test_every_criterion_is_in_exactly_one_provenance_state():
    st = bc._BY_KEY["go-signal"]
    for c in st.criteria:
        states = [c.origin == "uct",
                  c.value is None and bool(c.missing),
                  bool(c.source_id) and c.value is not None]
        assert sum(states) == 1, f"{c.condition!r} is in {sum(states)} states"
