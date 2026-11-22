"""Regression fixture for the aggregate fair-NBBO side gate (2026-11-05).

Locks the decision against the labeled 2026-11-05 candidate set, measured against
fair NBBO by the side-gate audit:
  - 6 genuine clean one-sided builds the old 2.5s side_confirm WRONGLY dropped
    (PFE/NVDA/U/MU680/VLO/SNDK) MUST now confirm (push).
  - the genuinely two-sided builds the gate CORRECTLY suppressed (MRVL/TSLA/APP/
    MU770) MUST stay neutralized — including the META 680C over-fire (51% ask)
    that kicked this whole investigation off.
Plus the call/put x ask/bid x direction truth table, so a future refactor can't
silently flip the side logic.
"""
from api.live_massive_router import _aggregate_side_decision

MIN = 0.67  # default aggregate_side_min

# (label, dom_frac, dom_side, direction, cp, expect_push)
LABELED_2026_11_05 = [
    # ── MISSES under the old gate — must now PUSH (clean one-sided) ──
    ("PFE 28C",   1.00, "ask", "Bull", "C", True),
    ("NVDA 210C", 0.93, "ask", "Bull", "C", True),
    ("U 55C",     0.88, "ask", "Bull", "C", True),
    ("VLO 380C",  0.96, "ask", "Bull", "C", True),
    ("MU 680C",   0.76, "ask", "Bull", "C", True),
    ("SNDK 870P", 0.69, "ask", "Bear", "P", True),   # ask-dominant PUT = Bear
    # ── Correctly suppressed (two-sided) — must stay NEUTRAL ──
    ("APP 400C",  0.64, "ask", "Bull", "C", False),
    ("MU 770C",   0.65, "ask", "Bull", "C", False),
    ("TSLA 290C", 0.53, "ask", "Bull", "C", False),
    ("MRVL 140P", 0.51, "ask", "Bear", "P", False),
    ("META 680C", 0.51, "ask", "Bull", "C", False),  # the original over-fire
]


def test_labeled_fixture_2026_11_05():
    wrong = []
    for label, dom, side, direction, cp, expect in LABELED_2026_11_05:
        got = _aggregate_side_decision(dom, side, direction, cp, MIN)
        if got != expect:
            wrong.append(f"{label}: dom={dom} {side} {direction} -> {got}, expected {expect}")
    assert not wrong, "decision drift:\n" + "\n".join(wrong)


def test_rescues_all_six_misses():
    misses = [r for r in LABELED_2026_11_05 if r[5]]
    assert len(misses) == 6
    for label, dom, side, direction, cp, _ in misses:
        assert _aggregate_side_decision(dom, side, direction, cp, MIN) is True, label


def test_suppresses_two_sided_and_meta():
    twoside = [r for r in LABELED_2026_11_05 if not r[5]]
    assert len(twoside) == 5
    for label, dom, side, direction, cp, _ in twoside:
        assert _aggregate_side_decision(dom, side, direction, cp, MIN) is False, label


def test_direction_truth_table():
    # ask-dominant = buyers: Bull for calls, Bear for puts
    assert _aggregate_side_decision(0.90, "ask", "Bull", "C", MIN) is True
    assert _aggregate_side_decision(0.90, "ask", "Bear", "C", MIN) is False   # call bought != bear
    assert _aggregate_side_decision(0.90, "ask", "Bear", "P", MIN) is True
    assert _aggregate_side_decision(0.90, "ask", "Bull", "P", MIN) is False
    # bid-dominant = sellers: Bear for calls (written), Bull for puts (written)
    assert _aggregate_side_decision(0.90, "bid", "Bear", "C", MIN) is True
    assert _aggregate_side_decision(0.90, "bid", "Bull", "C", MIN) is False
    assert _aggregate_side_decision(0.90, "bid", "Bull", "P", MIN) is True
    assert _aggregate_side_decision(0.90, "bid", "Bear", "P", MIN) is False


def test_threshold_boundary():
    # exactly at the floor confirms; just under neutralizes
    assert _aggregate_side_decision(0.67, "ask", "Bull", "C", MIN) is True
    assert _aggregate_side_decision(0.6699, "ask", "Bull", "C", MIN) is False
