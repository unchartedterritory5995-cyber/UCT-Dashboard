"""The IBD stage number: one sourced rule, two refusals, and no weights.

⭐ WHAT IS SOURCED IS A SINGLE THRESHOLD, stated twice from opposite sides and
agreeing: as an advance, *"A breakout needs to produce a gain of at least 20% in
order to be counted as one stage"*; as a separation, *"There must be a
separation of at least 20% from a buy point until the start of the next base."*
Everything else in IBD's stage rule is either prose or not computable from bars.

⛔⛔ THE CENTRAL NEGATIVE FINDING, and it decides what this module may be used
for: across every IBD source the research reached, **IBD publishes no win rate,
no average gain, no failure rate and no sample size for any base stage.** The
degradation is asserted four ways and quantified zero ways. So the stage is a
FILTER and never a weight — a probability multiplier here would be a number
nobody has measured.
"""
import sys, pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

from api.services.screener import base_count as bc

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "api/services/screener/base_count.py"


def _bars(closes, start_t=20200101):
    return [{"t": start_t + i, "o": c, "h": c * 1.005, "l": c * 0.995,
             "c": c, "v": 1000} for i, c in enumerate(closes)]


def _leg(frm, to, n):
    step = (to - frm) / max(1, n)
    return [frm + step * k for k in range(1, n + 1)]


# ─── the sourced threshold ──────────────────────────────────────────────────

def test_the_counting_unit_is_the_published_twenty_percent():
    assert bc.STAGE_ADVANCE_PCT == 0.20


def test_a_separation_under_twenty_percent_MERGES_as_base_on_base():
    """⭐ THE MERGE IS THE RULE: *"If the gain is less than 20% and the stock
    forms another base, it's a base-on-base pattern and counted as one stage."*
    Two consolidations 10% apart are ONE stage, not two."""
    closes = ([100] * 30 + _leg(100, 110, 40) + [110] * 30
              + _leg(110, 119, 40) + [119] * 30)          # +19%: under the bar
    seq = bc.stage_series(_bars(closes))
    assert seq, "no base was counted at all — the fixture is not exercising it"
    assert max(e["stage"] for e in seq) == 1, (
        f"a sub-20% separation started a new stage: {[e['stage'] for e in seq]}")


def test_a_separation_over_twenty_percent_ADVANCES_the_stage():
    """⛔ THE CONTROL. Without it the merge test above passes for a counter
    that never increments at all."""
    closes = ([100] * 30 + _leg(100, 110, 40) + [110] * 30
              + _leg(110, 150, 60) + [150] * 30)          # +36% from the pivot
    seq = bc.stage_series(_bars(closes))
    assert max(e["stage"] for e in seq) >= 2, (
        f"a clear 36% separation did not advance the stage: "
        f"{[e['stage'] for e in seq]}")


def test_the_advance_is_measured_from_the_PIVOT_not_the_base_low():
    """⛔⛔ THE NAMED TRAP. The research file: measuring from the low *"inflates
    every advance and will systematically over-count stages, pushing
    first-stage bases into third-stage grades and suppressing exactly the
    setups IBD wants bought."*

    This base runs 80 -> 100 (the pivot). A later high of 115 is +15% from the
    PIVOT and +44% from the LOW. Only the low-based reading crosses 20%, so a
    counter that advanced here is measuring from the wrong place."""
    closes = ([100] * 20 + _leg(100, 80, 40) + [80] * 20 + _leg(80, 100, 40)
              + [100] * 20 + _leg(100, 115, 40) + [115] * 30)
    bars = _bars(closes)
    seq = bc.stage_series(bars)
    assert seq
    assert max(e["stage"] for e in seq) == 1, (
        f"stage advanced on a +15%-from-pivot move: {[e['stage'] for e in seq]}"
        f" — the 20% is being measured from the base LOW")
    # ⭐ AND THE FIXTURE MUST ACTUALLY POSE THE QUESTION. If the low-based
    # reading did not cross 20% here, this test would pass for a counter that
    # measures from the low, which is how the first version of it was vacuous.
    lows = [min(e["pivot"], min(c for c in
            [b["c"] for b in bars[e["pivot_idx"]:e["breakout_idx"] + 1]] if c > 0))
            for e in seq]
    assert any((seq[k + 1]["pivot"] - lows[k]) / lows[k] >= bc.STAGE_ADVANCE_PCT
               for k in range(len(seq) - 1)) or len(seq) == 1, (
        "no pivot is >=20% above a preceding base LOW, so a low-based counter "
        "would also read stage 1 and this test proves nothing")


def test_a_consolidation_shorter_than_IBDs_floor_is_not_a_base():
    """*"One, two or three weeks do not get the job done."* — so >3 weeks.

    ⛔⛔ TESTED ON THE PREDICATE, BECAUSE THE SERIES FIXTURE COULD NOT REACH IT.
    Two earlier versions of this test were vacuous: the first only asserted
    `MIN_BASE_BARS > 15` (a constant, not a behaviour), and the second built a
    series meant to have two pivots close in time — which produced NO confirmed
    swing highs at all, so it asserted `max() == 1` over an empty list and
    passed with the floor deleted. `starts_new_base` was extracted so the rule
    could be exercised directly.
    """
    assert bc.MIN_BASE_BARS > 15
    far = 100 * (1 + bc.STAGE_ADVANCE_PCT + 0.10)      # comfortably separated

    # separated in price, far too fast in time
    assert bc.starts_new_base(100.0, 0, far, bc.MIN_BASE_BARS - 1) is False
    # ⭐ THE CONTROL: the same separation, given the time, does start one
    assert bc.starts_new_base(100.0, 0, far, bc.MIN_BASE_BARS) is True


def test_the_separation_and_the_duration_are_BOTH_required():
    """⛔ Each half must be able to refuse on its own, or one is decoration."""
    near = 100 * (1 + bc.STAGE_ADVANCE_PCT - 0.05)     # under the separation bar
    assert bc.starts_new_base(100.0, 0, near, 400) is False      # time alone
    far = 100 * (1 + bc.STAGE_ADVANCE_PCT + 0.10)
    assert bc.starts_new_base(100.0, 0, far, 1) is False         # price alone
    assert bc.starts_new_base(100.0, 0, far, 400) is True        # both


# ─── causality ──────────────────────────────────────────────────────────────

def test_the_stage_at_a_bar_never_reads_a_later_bar():
    """⛔ A stage that changes when future bars arrive is a repainting label,
    and this whole library refuses those."""
    closes = ([100] * 60 + _leg(100, 160, 90) + [160] * 60
              + _leg(160, 260, 90) + [260] * 90 + _leg(260, 400, 90))
    bars = _bars(closes)

    # (a) past the history floor: a real stage, and it must not move
    cut = 300
    assert bc.stage_at(bars, cut) is not None, "the fixture answers None — vacuous"
    assert bc.stage_at(bars, cut) == bc.stage_at(bars[:cut + 1], cut), (
        "the stage read at bar 300 changed when later bars were present")

    # (b) ⛔⛔ THE DISCRIMINATING CASE, and I deleted it once by "fixing" this
    # test. The history floor must apply to the bars BEFORE `i`, not to the
    # array's length: at a bar with too little history behind it the answer is
    # None however much data arrives later. Reading `len(bars)` here passed a
    # 260-bar guard on history that had not happened yet, and a deeper fixture
    # hides that entirely — both readings clear the floor and agree.
    early = bc.MIN_HISTORY_BARS - 40
    assert early + 1 < bc.MIN_HISTORY_BARS < len(bars), (
        "the fixture no longer straddles the floor, so this cannot discriminate")
    assert bc.stage_at(bars, early) is None, (
        "a stage was returned for a bar with less than MIN_HISTORY_BARS behind "
        "it — the floor is being applied to the array, not to the history")


def test_too_little_history_is_refused_rather_than_guessed():
    assert bc.stage_at(_bars([100] * 50)) is None


# ─── what may NOT be built on it ────────────────────────────────────────────

def test_the_filter_returns_a_boolean_and_never_a_score():
    """⛔⛔ IBD PUBLISHES NO EXPECTANCY PER STAGE. A weight would be invented."""
    assert bc.is_early_stage(1) is True
    assert bc.is_early_stage(2) is True
    assert bc.is_early_stage(3) is False


def test_an_unknown_stage_is_None_and_never_False():
    """⛔ `False` would read as "late stage" — a claim we did not make."""
    assert bc.is_early_stage(None) is None


def test_the_module_exposes_no_stage_weight_or_probability():
    """⛔ The rule is published as a preference and quantified nowhere. A
    `STAGE_WEIGHTS` table or a per-stage win rate here would be fabrication."""
    import ast
    tree = ast.parse(SRC.read_text(encoding="utf-8"))
    names = [t.id for n in ast.walk(tree) if isinstance(n, ast.Assign)
             for t in n.targets if isinstance(t, ast.Name)]
    banned = [n for n in names
              if any(w in n.lower() for w in
                     ("weight", "win_rate", "winrate", "multiplier", "odds",
                      "probability", "expectancy"))]
    assert not banned, (
        f"{banned} — IBD publishes no expectancy for any stage, so any such "
        f"number here is invented. The stage is a filter.")


# ─── the two refusals are recorded, not silently assumed ────────────────────

def test_the_fundamental_gate_is_declared_as_not_computable():
    """*"Don't count bases until quarterly earnings and sales start growing by
    at least 25%."* If that is IBD's rule, this module computes a DIFFERENT
    quantity — and must say so rather than claim to be IBD's stage."""
    doc = bc.__doc__ or ""
    assert "25%" in doc and "DIFFERENT QUANTITY" in doc.upper(), (
        "the module no longer declares that the fundamental gate makes its "
        "number something other than IBD's")


def test_the_reset_threshold_is_declared_OURS():
    """⛔ IBD publishes that a decline resets the count and NOT what decline.
    Any value here is ours, and it must be swept rather than defended."""
    doc = bc.__doc__ or ""
    assert "origin: uct" in doc, (
        "the reset threshold is no longer stamped as ours — it is a number IBD "
        "never published and it must not read as sourced")
    assert 0 < bc.RESET_DRAWDOWN_PCT < 1


def test_the_reset_actually_resets():
    """⛔ NON-VACUITY on the knob. A reset that never fires is a constant with
    a comment."""
    closes = ([100] * 30 + _leg(100, 150, 60) + [150] * 30
              + _leg(150, 60, 80) + [60] * 30 + _leg(60, 95, 60) + [95] * 30)
    seq = bc.stage_series(_bars(closes))
    assert seq
    assert seq[-1]["stage"] == 1, (
        f"a ~60% collapse did not reset the count: "
        f"{[e['stage'] for e in seq]}")


# ─── the degradation curve, measured because IBD publishes none ─────────────

def test_the_retraction_travels_with_the_numbers():
    """⛔⛔ THE STAGE EFFECT WAS PUBLISHED AND THEN RETRACTED, and this rail
    pins the retraction rather than the claim.

    A first reading on a 900-bar tail put `ema-crossback` at +18.5pp
    early-over-late and called it real; the `base_stage` column was wired for
    that structure BECAUSE of it. On full history it is -0.5pp +/- 2.0. The
    cause was MEASURED, not guessed: re-staging the SAME anchors on the short
    history gives -0.7pp +/- 2.1, so the counter was never the problem -- 65
    fired anchors became 4,409. A 900-bar tail reaches about three and a half
    years, so +18.5pp was a recent-era reading of a 74-anchor bucket.

    ⭐ THE FIRST NOTE REPORTED ITS OWN LIMITATION CORRECTLY AND STILL POINTED
    AT THE WRONG RISK. It said the short tail "biases stages LOW" and would
    UNDERSTATE a real effect. That was true. The risk was never the counter; it
    was the sample.
    """
    from api.services.screener import lift_ledger as ll
    low = (ll.load().get("limitations") or "").lower()
    assert "base-stage effect: retracted" in low, (
        "the ledger no longer carries the retraction -- if the effect was "
        "re-established on a deeper footing, say so deliberately")
    for must in ("no structure shows a resolvable stage effect",
                 "the cause is the anchor set", "-0.5pp"):
        assert must in low, (
            f"the retraction lost {must!r}: it must carry the corrected number, "
            f"WHAT caused the reversal, AND that no structure survives -- one "
            f"without the others reads as a tweak rather than a retraction")


def test_the_stage_is_NOT_wired_to_any_surface():
    """⛔ THE WIRING WENT WITH THE EVIDENCE. `base_stage` was a snapshot
    column and a screener filter, scoped to `ema-crossback` on a +18.5pp reading
    that did not survive. Both are removed; `base_count.py` and
    `tools/measure_stage_effect.py` remain so the question can be re-asked.

    ⭐ POINTS BOTH WAYS: re-wire it and this goes red, so whoever does has to
    name the measurement that justifies it."""
    from api.services.screener import snapshot_db, filters, bases
    assert "base_stage" not in snapshot_db.COLUMNS, (
        "`base_stage` is a snapshot column again -- name the measurement that "
        "justifies surfacing it, because the one that did has been retracted")
    assert "base_stage" not in filters.FILTERS
    assert "base_stage" not in bases._NULL
