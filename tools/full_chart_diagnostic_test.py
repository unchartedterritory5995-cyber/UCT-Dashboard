"""Tests for the sweep's phantom-spike detector — the heuristic must flag
TRANSIENT bad prints (spike-then-revert) while NOT flagging splits / sustained
moves (which re-level and persist). The latter were ~700 false positives that
drowned the sweep signal."""
from tools.full_chart_diagnostic import _phantom_spike


def _bars(closes):
    return [{"c": c} for c in closes]


def test_forward_split_sustained_up_not_flagged():
    # 5x jump that PERSISTS (e.g. unadjusted reverse-split boundary) — not a bug.
    assert _phantom_spike(_bars([10, 10, 50, 50, 51, 49])) is None


def test_reverse_split_sustained_down_not_flagged():
    assert _phantom_spike(_bars([50, 50, 10, 10, 9.8, 10.2])) is None


def test_phantom_spike_up_then_revert_flagged():
    # Spikes to 50 then immediately returns to ~10 — a real bad print.
    assert _phantom_spike(_bars([10, 10, 50, 10, 10])) is not None


def test_phantom_spike_down_then_revert_flagged():
    assert _phantom_spike(_bars([50, 50, 10, 50, 50])) is not None


def test_normal_volatility_not_flagged():
    assert _phantom_spike(_bars([10, 10.5, 11, 10.8, 11.2, 10.9])) is None


def test_gradual_doubling_not_flagged():
    # Real sustained rally, no single >2.5x adjacent jump.
    assert _phantom_spike(_bars([10, 12, 15, 18, 22, 27])) is None
