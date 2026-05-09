from api.services import candle_reconcile as cr


def test_agreement_within_tolerance():
    ws = {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702.5, "v": 1500000}
    rest = {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702.7, "v": 1490000}
    decision = cr.reconcile(ws, rest)
    assert decision["verdict"] == "accept"


def test_close_disagreement_triggers_correction():
    ws = {"t": 1715080800, "c": 702.5, "v": 1500000}
    rest = {"t": 1715080800, "c": 850.0, "v": 1500000}
    decision = cr.reconcile(ws, rest)
    assert decision["verdict"] == "correction"
    assert decision["correction"] == rest


def test_volume_disagreement_triggers_correction():
    ws = {"t": 1715080800, "c": 702.5, "v": 100000}
    rest = {"t": 1715080800, "c": 702.5, "v": 1500000}  # 15x diff
    decision = cr.reconcile(ws, rest)
    assert decision["verdict"] == "correction"


def test_missing_rest_skips_reconcile():
    ws = {"t": 1715080800, "c": 702.5, "v": 1500000}
    decision = cr.reconcile(ws, None)
    assert decision["verdict"] == "skipped"


def test_close_diff_exact_tolerance_accepts():
    """Exactly at the close tolerance — accept (boundary)."""
    ws = {"t": 1715080800, "c": 1000.0, "v": 1000000}
    rest = {"t": 1715080800, "c": 1000.5, "v": 1000000}  # 0.05% diff = exactly tolerance
    decision = cr.reconcile(ws, rest)
    assert decision["verdict"] == "accept"


def test_zero_close_safe():
    """Zero in either field doesn't crash."""
    ws = {"t": 1715080800, "c": 0, "v": 0}
    rest = {"t": 1715080800, "c": 0, "v": 0}
    decision = cr.reconcile(ws, rest)
    # Both zero → effectively no diff → accept
    assert decision["verdict"] in ("accept", "correction")  # either is acceptable
