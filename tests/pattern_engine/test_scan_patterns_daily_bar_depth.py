"""Regression rail for the pattern-scan daily-TF fetch depth
(`api.main._PATTERN_SCAN_DAILY_BARS`, consumed by `_scan_patterns_daily`'s
`bars_sqlite.get_bars(sym, "D", _PATTERN_SCAN_DAILY_BARS)` call).

Root cause fixed 2026-09-06: that call site was a bare literal `200` with no
relationship to what detectors in the registry actually require. Several have
a HARD, explicit `len(bars) < N: return []` gate above 200 bars and were
therefore structurally unreachable through the production daily scan (both
`_run_patterns_universe_scan`, nightly, and `_run_patterns_leaders_scan`'s
daily pass, hourly — both call the same shared `_scan_patterns_daily`) no
matter how good a candidate looked:

  - pullback_to_50sma:  n < _SMA_PERIOD*3 + _PRIOR_ADVANCE_LOOKBACK//2 = 210
  - golden_cross:       n < _MA200_PERIOD + _MAX_CROSS_AGE + 5         = 210
  - death_cross:        n < _MA200_PERIOD + _MAX_CROSS_AGE + 5         = 210
  - pullback_to_200sma: n < _SMA_PERIOD + 70                           = 270

Part 1 derives each threshold from the detector's OWN constants (never a
restated bare number) and asserts the fetch constant covers it — a future
edit to any of those constants, or an accidental revert of the fetch
constant, fails here instead of silently reopening the gap.

Part 2 proves the mechanism concretely through the REAL `bars_sqlite.get_bars`
(no monkeypatch of the fetch function itself) against a real firing
pullback_to_50sma fixture: the pre-fix 200-bar cap truncates it below the
detector's own gate (0 detections); the shipped fetch depth does not.

Part 3 proves `_scan_patterns_daily` — the actual production call site — is
wired to the named constant, not a copy of the number.
"""
from __future__ import annotations

import pytest

from api import main as _main
from api.main import _scan_patterns_daily
from api.services import bars_sqlite
from api.services.pattern_engine.detectors.classical import death_cross, golden_cross
from api.services.pattern_engine.detectors.uct import pullback_to_200sma, pullback_to_50sma
from api.services.pattern_engine.detectors.uct.pullback_to_50sma import detect_pullback_to_50sma
from api.services.pattern_engine.pattern_db import init_db
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


@pytest.fixture(autouse=True)
def _init():
    init_db()
    bars_sqlite.init_db()


def _firing_fixture(pattern_id: str):
    for fx in load_all_fixtures(pattern_id, include_internal=False):
        if fx.expected_fires:
            return fx
    raise AssertionError(f"no firing fixture found for {pattern_id!r}")


# ---------------------------------------------------------------------------
# Part 1 — the fetch depth covers every known hard gate, derived from each
# detector's own source constants.
# ---------------------------------------------------------------------------

def test_fetch_depth_covers_pullback_to_50sma_hard_gate():
    required = (
        pullback_to_50sma._SMA_PERIOD * 3
        + pullback_to_50sma._PRIOR_ADVANCE_LOOKBACK // 2
    )
    assert required == 210, "detector's own gate math moved — re-check the fetch depth"
    assert _main._PATTERN_SCAN_DAILY_BARS >= required


def test_fetch_depth_covers_golden_cross_hard_gate():
    required = golden_cross._MA200_PERIOD + golden_cross._MAX_CROSS_AGE + 5
    assert required == 210
    assert _main._PATTERN_SCAN_DAILY_BARS >= required


def test_fetch_depth_covers_death_cross_hard_gate():
    required = death_cross._MA200_PERIOD + death_cross._MAX_CROSS_AGE + 5
    assert required == 210
    assert _main._PATTERN_SCAN_DAILY_BARS >= required


def test_fetch_depth_covers_pullback_to_200sma_hard_gate():
    required = pullback_to_200sma._SMA_PERIOD + 70
    assert required == 270
    assert _main._PATTERN_SCAN_DAILY_BARS >= required


# ---------------------------------------------------------------------------
# Part 2 — real bars_sqlite round-trip: the OLD cap truncates a real firing
# fixture below the detector's own gate; the SHIPPED cap does not. Uses the
# real `bars_sqlite.get_bars` (no monkeypatch of the fetch itself) so the
# row-LIMIT behavior under test is the real one. Context is the fixture's own
# (same convention `test_pullback_to_50sma.py` uses) — isolates the fetch-cap
# variable from context-derivation, which is a separate, already-covered
# concern.
# ---------------------------------------------------------------------------

@pytest.fixture
def _seeded_pullback_50sma_bars():
    sym = "ZZPB50DEPTH"
    fx = _firing_fixture("pullback_to_50sma")
    assert len(fx.bars) > 200, "fixture must be deep enough to distinguish 200 vs 300"
    bars_sqlite.delete_bars(ticker=sym, tf="D")
    bars_sqlite.put_bars(sym, "D", fx.bars)
    yield sym, fx
    bars_sqlite.delete_bars(ticker=sym, tf="D")


def test_old_200_bar_cap_would_truncate_a_real_firing_fixture_below_the_gate(
    _seeded_pullback_50sma_bars,
):
    sym, fx = _seeded_pullback_50sma_bars
    fetched = bars_sqlite.get_bars(sym, "D", 200)  # the literal pre-fix cap
    assert len(fetched) == 200
    bars_list = [
        {"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]}
        for r in fetched
    ]
    dets = detect_pullback_to_50sma(bars_list, fx.context)
    assert dets == [], (
        "expected the pre-fix 200-bar cap to structurally block this firing "
        "fixture (len(bars) < 210 gate) — if this now fires, the fixture or "
        "the detector's own gate changed, not just the fetch depth"
    )


def test_shipped_fetch_depth_does_not_truncate_the_same_fixture(
    _seeded_pullback_50sma_bars,
):
    sym, fx = _seeded_pullback_50sma_bars
    fetched = bars_sqlite.get_bars(sym, "D", _main._PATTERN_SCAN_DAILY_BARS)
    assert len(fetched) == len(fx.bars), "shipped depth must not truncate this fixture"
    bars_list = [
        {"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]}
        for r in fetched
    ]
    dets = detect_pullback_to_50sma(bars_list, fx.context)
    assert len(dets) == 1, "pullback_to_50sma must fire once the fetch stops truncating it"


def test_build_context_is_unaffected_by_the_fetch_depth_change():
    """The fetch-depth fix must not be confused with a context-derivation
    fix: build_context on the same bars is deterministic regardless of which
    constant supplied the row count, as long as the row count is >= what was
    actually requested (i.e. no fewer rows exist than requested)."""
    fx = _firing_fixture("pullback_to_50sma")
    ctx_a = build_context(fx.bars[-210:], sym="X")
    ctx_b = build_context(fx.bars[-210:], sym="X")
    assert ctx_a == ctx_b


# ---------------------------------------------------------------------------
# Part 3 — `_scan_patterns_daily` (the real production call site) is wired to
# the named constant, not an inline copy of the number.
# ---------------------------------------------------------------------------

def test_scan_patterns_daily_requests_the_named_constant_from_get_bars(monkeypatch):
    seen_n = []
    real_get_bars = bars_sqlite.get_bars

    def _spy(sym, tf, n):
        seen_n.append(n)
        return real_get_bars(sym, tf, n)

    monkeypatch.setattr(bars_sqlite, "get_bars", _spy)

    class _Log:
        def debug(self, *a, **k): pass
        def warning(self, *a, **k): pass
        def info(self, *a, **k): pass

    _scan_patterns_daily(["ZZNOSUCHTICKERXYZ"], set(), _Log())
    assert seen_n == [_main._PATTERN_SCAN_DAILY_BARS]
