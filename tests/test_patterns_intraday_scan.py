"""Tests for the intraday pattern scan pass inside _run_patterns_leaders_scan
(the hourly leaders job; the pass lived in _run_patterns_universe_scan until
2026-08-26, when the universe scan went daily and leaders kept the hourly slot).

Coverage:
  Test 1 — RTH gate: RTH=False → 0 intraday store_detection calls; RTH=True → path executes.
  Test 2 — ORB session slice: multi-session intraday series → slice picks CURRENT session;
            ORB fires on a textbook setup within that session.
  Test 3 — Lance fires on full 5000-bar-like series with 21+ sessions of history.
  Test 4 — Daily-bar context is built from daily bars and same ctx passed to both detectors.
  Test 5 — Robustness: get_bars raising for one ticker → loop continues to next ticker.
"""
from __future__ import annotations

import time
import types
import unittest
from unittest.mock import MagicMock, patch, call

# ---------------------------------------------------------------------------
# Helpers: minimal bar factories
# ---------------------------------------------------------------------------

def _bar(t: int, o: float, h: float, l: float, c: float, v: float) -> dict:
    return {"t": t, "o": o, "h": h, "l": l, "c": c, "v": v}


def _make_intraday_bars(n_sessions: int = 22, bars_per_session: int = 78,
                        session_offset: int = 0) -> list:
    """Fabricate a multi-session 5-min bar series.

    Each session is 78 bars × 300s (= 6.5 hours), separated by a 16-hour
    overnight gap (57600s) to guarantee the 4-hour session-gap detector fires.
    """
    bars = []
    base_t = 1_700_000_000 + session_offset * 86400
    for s in range(n_sessions):
        session_start = base_t + s * (bars_per_session * 300 + 57600)
        for b in range(bars_per_session):
            t = session_start + b * 300
            price = 100.0 + s * 0.1 + b * 0.01
            bars.append(_bar(t, price, price + 0.5, price - 0.5, price + 0.2, 1000))
    return bars


def _make_lance_bars() -> list:
    """21 sessions; current session has a textbook Opening Drive at bars 0-2."""
    # 20 prior sessions with normal volume (vol=1000), then 1 current session
    # where the first 3 bars have vol=5000 (5× trailing avg → fires the 2× gate).
    bars = []
    base_t = 1_700_000_000
    BAR_SPAN = 300        # 5 min
    SESSION_GAP = 57600   # 16 hours

    prev_close = 100.0
    for s in range(20):
        session_start = base_t + s * (78 * BAR_SPAN + SESSION_GAP)
        for b in range(78):
            t = session_start + b * BAR_SPAN
            bars.append(_bar(t, prev_close, prev_close + 0.5, prev_close - 0.3, prev_close + 0.2, 1000))
        prev_close = bars[-1]["c"]

    # Current session: gap-up 2%, first bar DCR=0.9, bar2/bar3 continue up, vol=5000
    cs_start = base_t + 20 * (78 * BAR_SPAN + SESSION_GAP)
    gap_open = prev_close * 1.02     # +2% gap
    b0 = _bar(cs_start,
              gap_open,
              gap_open + 1.0,
              gap_open - 0.1,
              gap_open + 0.9,          # DCR ≈ (0.9 - (-0.1)) / 1.1 = 0.909
              5000)
    b1_c = b0["c"] + 0.5
    b1 = _bar(cs_start + BAR_SPAN, b0["c"], b1_c + 0.3, b0["c"] - 0.05, b1_c, 5000)
    b2_c = b1_c + 0.5
    b2 = _bar(cs_start + 2 * BAR_SPAN, b1_c, b2_c + 0.3, b1_c - 0.05, b2_c, 5000)
    # DCR bar3 = (b2_c - (b1_c-0.05)) / (b2_c+0.3 - (b1_c-0.05))
    # b1_c ~ 101.4+, b2_c ~ 101.9+; ratio is well above 0.6
    # pad with normal bars so session has 78 total
    current_session_bars = [b0, b1, b2]
    for b in range(3, 78):
        t = cs_start + b * BAR_SPAN
        p = b2_c + b * 0.01
        current_session_bars.append(_bar(t, p, p + 0.5, p - 0.3, p + 0.2, 1000))
    bars.extend(current_session_bars)
    return bars


def _make_orb_session_bars(breakout: bool = True) -> list:
    """9 bars for a single session with an opening range + breakout/breakdown bar at index 6.

    Exactly 9 bars so the breakout bar (index 6) is within _MAX_BREAKOUT_AGE (3) of
    last_idx (8): breakout_age = 8 - 6 = 2, which satisfies the detector's
    age <= _MAX_BREAKOUT_AGE - 1 = 2 gate.
    """
    # Bars 0-5: opening range [low=99, high=101] → width ~2% → in Crabel's zone
    # Bar 6: breakout close above 101 on vol=2× OR avg
    or_low, or_high = 99.0, 101.0
    or_avg_vol = 1000.0
    bars = []
    base_t = 1_700_000_000
    for i in range(6):
        bars.append(_bar(base_t + i * 300, 100.0, or_high, or_low, 100.2 + i * 0.01, int(or_avg_vol)))
    if breakout:
        # Bar 6: close above or_high, vol = 2× avg
        bars.append(_bar(base_t + 6 * 300, 101.5, 102.0, 101.0, 101.8, int(or_avg_vol * 2)))
    else:
        # Bar 6: close below or_high (no breakout)
        bars.append(_bar(base_t + 6 * 300, 100.0, 100.5, 99.5, 100.1, int(or_avg_vol * 2)))
    # Pad to exactly 9 bars (indices 7-8) — breakout_age = 8-6 = 2 ≤ MAX_BREAKOUT_AGE-1=2
    for i in range(7, 9):
        bars.append(_bar(base_t + i * 300, 101.5, 102.0, 101.0, 101.6, 1000))
    return bars


def _make_multi_session_intraday(n_prior: int = 3, current_breakout: bool = True) -> list:
    """n_prior sessions of noise followed by a current session with an ORB breakout."""
    bars = []
    base_t = 1_700_000_000
    BAR_SPAN = 300
    SESSION_GAP = 57600
    for s in range(n_prior):
        session_start = base_t + s * (78 * BAR_SPAN + SESSION_GAP)
        for b in range(78):
            t = session_start + b * BAR_SPAN
            p = 100.0 + b * 0.01
            bars.append(_bar(t, p, p + 0.5, p - 0.3, p + 0.2, 1000))
    # Current session starts after a 16-hr gap
    cs_start = base_t + n_prior * (78 * BAR_SPAN + SESSION_GAP)
    session_bars = _make_orb_session_bars(breakout=current_breakout)
    # Re-stamp timestamps to current session offset
    for i, b in enumerate(session_bars):
        bars.append(_bar(cs_start + i * 300, b["o"], b["h"], b["l"], b["c"], b["v"]))
    return bars


# ---------------------------------------------------------------------------
# Shared patch target constants
# ---------------------------------------------------------------------------

MAIN_MOD = "api.main"


# ---------------------------------------------------------------------------
# Test 1 — RTH gate
# ---------------------------------------------------------------------------

class TestRthGate(unittest.TestCase):
    """RTH=False → intraday store_detection never called; RTH=True → path executes."""

    def _make_mock_bars_sqlite(self):
        mock = MagicMock()
        # daily bars — sufficient for context build
        mock.get_bars.side_effect = lambda sym, tf, n: (
            [(1_700_000_000 + i * 86400, 100.0, 101.0, 99.0, 100.5, 10000) for i in range(50)]
            if tf == "D" else
            # intraday bars — return at least 9 bars
            [(1_700_000_000 + i * 300, 100.0, 101.0, 99.0, 100.5, 10000) for i in range(20)]
        )
        return mock

    def _run_with_rth(self, rth: bool, leader_tickers=None):
        if leader_tickers is None:
            leader_tickers = ["AAPL"]
        store_calls = []

        mock_bs = self._make_mock_bars_sqlite()
        mock_memory = MagicMock()
        mock_memory.store_detection.side_effect = lambda d: store_calls.append(d)
        mock_detect_all = MagicMock(return_value=[])
        mock_build_context = MagicMock(return_value={"trend_stage": 2, "ma_alignment": "stacked_bullish"})

        # Patch out cap_universe loading and leader_universe loading so function
        # runs to the intraday block without reading disk.
        import json
        leader_json = json.dumps({"tickers": leader_tickers})

        with patch(f"{MAIN_MOD}._is_rth_now", return_value=rth), \
             patch(f"{MAIN_MOD}.open", side_effect=[
                 unittest.mock.mock_open(read_data=leader_json)(),
             ], create=True), \
             patch("os.path.exists", return_value=True), \
             patch(f"api.services.bars_sqlite.get_bars", mock_bs.get_bars), \
             patch("api.services.pattern_engine.memory.store_detection",
                   mock_memory.store_detection), \
             patch("api.services.pattern_engine.detect_all", mock_detect_all), \
             patch(
                 "api.services.pattern_engine.primitives.context.build_context",
                 mock_build_context,
             ):
            from api.main import _run_patterns_leaders_scan
            _run_patterns_leaders_scan()

        return store_calls, mock_detect_all

    def test_rth_false_no_intraday_calls(self):
        """When RTH=False the intraday detect_all is never called for intraday IDs."""
        _, mock_detect_all = self._run_with_rth(rth=False)
        # detect_all may be called for the daily pass, but NOT with intraday pattern IDs
        intraday_calls = [
            c for c in mock_detect_all.call_args_list
            if c.args and isinstance(c.args[0], list)
            and c.kwargs.get("pattern_ids") and
            any(p in ["lance_opening_drive", "opening_range_breakout", "opening_range_breakdown"]
                for p in (c.kwargs.get("pattern_ids") or []))
        ]
        self.assertEqual(intraday_calls, [],
                         "Intraday detect_all should not be called when RTH=False")

    def test_rth_true_intraday_path_executes(self):
        """When RTH=True the intraday detect_all IS called (at least once) for lance."""
        _, mock_detect_all = self._run_with_rth(rth=True, leader_tickers=["AAPL"])
        intraday_calls = [
            c for c in mock_detect_all.call_args_list
            if c.kwargs.get("pattern_ids") and
            "lance_opening_drive" in (c.kwargs.get("pattern_ids") or [])
        ]
        self.assertGreater(len(intraday_calls), 0,
                           "detect_all with lance_opening_drive should be called when RTH=True")


# ---------------------------------------------------------------------------
# Test 2 — ORB session slice correctness
# ---------------------------------------------------------------------------

class TestOrbSessionSlice(unittest.TestCase):
    """Confirm session-start detection picks the CURRENT (most recent) session."""

    def test_slice_picks_current_session(self):
        """Given 3 prior sessions + current session, slice picks current session's bars."""
        from api.main import _is_rth_now  # noqa (just for import chain)
        # Build 3 prior sessions + current session (total = 3*78 + 10 bars)
        bars = _make_multi_session_intraday(n_prior=3, current_breakout=True)
        # Simulate the session-start detection from the intraday pass
        SESSION_GAP = 14400  # the 4-hr gate constant used in main.py
        session_start_idx = 0
        for i in range(len(bars) - 1, 0, -1):
            if bars[i]["t"] - bars[i - 1]["t"] > SESSION_GAP:
                session_start_idx = i
                break
        today_session = bars[session_start_idx:]
        # The current session has 9 bars (_make_orb_session_bars returns 9)
        self.assertEqual(len(today_session), 9,
                         f"Expected 9 bars in current session, got {len(today_session)}")

    def test_orb_fires_on_textbook_current_session(self):
        """ORB fires when called with the correctly-sliced current-session bars."""
        from api.services.pattern_engine import detect_all
        from api.routers import patterns as _patterns  # noqa: trigger registration
        session_bars = _make_orb_session_bars(breakout=True)
        ctx = {"trend_stage": 2, "ma_alignment": "stacked_bullish", "rs_trend": "up"}
        dets = detect_all(session_bars, ctx, pattern_ids=["opening_range_breakout"])
        self.assertGreater(len(dets), 0,
                           "ORB should fire on a textbook current-session slice")
        self.assertEqual(dets[0]["pattern_id"], "opening_range_breakout")

    def test_orbd_fires_on_textbook_breakdown_session(self):
        """ORBD fires when the breakout bar closes below OR low.

        Exactly 9 bars so the breakdown bar (index 6) is within the detector's
        _MAX_BREAKOUT_AGE window: last_idx=8, breakout_age=8-6=2 ≤ 2.
        """
        from api.services.pattern_engine import detect_all
        from api.routers import patterns as _patterns  # noqa: trigger registration

        # Build a session where bar 6 breaks DOWN below or_low on volume
        or_low, or_high = 99.0, 101.0
        or_avg_vol = 1000.0
        bars = []
        base_t = 1_700_000_000
        for i in range(6):
            bars.append(_bar(base_t + i * 300, 100.0, or_high, or_low, 100.2, int(or_avg_vol)))
        # Bar 6: close below or_low, vol=2× avg → breakdown
        bars.append(_bar(base_t + 6 * 300, 98.5, 99.2, 98.0, 98.5, int(or_avg_vol * 2)))
        # Pad to exactly 9 bars — breakout_age = 8-6 = 2 ≤ MAX_BREAKOUT_AGE-1=2
        for i in range(7, 9):
            bars.append(_bar(base_t + i * 300, 98.3, 99.0, 98.0, 98.4, 1000))

        ctx = {"trend_stage": 4, "ma_alignment": "stacked_bearish", "rs_trend": "down"}
        dets = detect_all(bars, ctx, pattern_ids=["opening_range_breakdown"])
        self.assertGreater(len(dets), 0,
                           "ORBD should fire on a textbook breakdown session")
        self.assertEqual(dets[0]["pattern_id"], "opening_range_breakdown")


# ---------------------------------------------------------------------------
# Test 3 — Lance fires with sufficient history
# ---------------------------------------------------------------------------

class TestLanceFiresWithHistory(unittest.TestCase):
    """Lance fires when the full intraday series has 21+ sessions with a valid drive."""

    def test_lance_fires_with_21_sessions(self):
        """21-session series with textbook drive in current session → detection fires."""
        from api.services.pattern_engine import detect_all
        from api.routers import patterns as _patterns  # noqa: trigger registration
        bars = _make_lance_bars()
        ctx = {"trend_stage": 2, "ma_alignment": "stacked_bullish", "rs_trend": "up"}
        dets = detect_all(bars, ctx, pattern_ids=["lance_opening_drive"])
        self.assertGreater(len(dets), 0,
                           "lance_opening_drive should fire on a 21-session series with valid drive")
        self.assertEqual(dets[0]["pattern_id"], "lance_opening_drive")

    def test_lance_whitelist_only(self):
        """pattern_ids=["lance_opening_drive"] whitelist does NOT run ORB/ORBD."""
        from api.services.pattern_engine import detect_all
        from api.routers import patterns as _patterns  # noqa
        bars = _make_multi_session_intraday(n_prior=3, current_breakout=True)
        ctx = {}
        dets = detect_all(bars, ctx, pattern_ids=["lance_opening_drive"])
        non_lance = [d for d in dets if d.get("pattern_id") != "lance_opening_drive"]
        self.assertEqual(non_lance, [],
                         "Only lance_opening_drive should be in results when whitelisted")


# ---------------------------------------------------------------------------
# Test 4 — Daily-bar context used for both intraday calls
# ---------------------------------------------------------------------------

class TestDailyContextHonored(unittest.TestCase):
    """build_context is called from daily bars; same ctx object passed to both detector calls."""

    def test_ctx_built_from_daily_and_passed_to_intraday(self):
        """The ctx passed to lance and ORB/ORBD is the ctx built from daily bars."""
        import json

        captured_ctx_calls = []  # (pattern_ids, ctx) for intraday detect_all calls

        sentinel_ctx = {"_sentinel": "daily_ctx", "trend_stage": 2}

        mock_bs = MagicMock()
        daily_bars_tuple = tuple((1_700_000_000 + i * 86400, 100.0, 101.0, 99.0, 100.5, 10000) for i in range(50))
        intra_bars_tuple = tuple((1_700_000_000 + i * 300, 100.0, 101.0, 99.0, 100.5, 1000) for i in range(100))
        mock_bs.get_bars.side_effect = lambda sym, tf, n: (
            list(daily_bars_tuple) if tf == "D" else list(intra_bars_tuple)
        )

        mock_build_ctx = MagicMock(return_value=sentinel_ctx)

        def _detect_all_capture(bars, ctx, pattern_ids=None):
            if pattern_ids:
                captured_ctx_calls.append((list(pattern_ids), ctx))
            return []

        leader_json = json.dumps({"tickers": ["AAPL"]})

        with patch(f"{MAIN_MOD}._is_rth_now", return_value=True), \
             patch(f"{MAIN_MOD}.open", side_effect=[
                 unittest.mock.mock_open(read_data=leader_json)(),
             ], create=True), \
             patch("os.path.exists", return_value=True), \
             patch("api.services.bars_sqlite.get_bars", mock_bs.get_bars), \
             patch("api.services.pattern_engine.memory.store_detection", MagicMock()), \
             patch("api.services.pattern_engine.detect_all", side_effect=_detect_all_capture), \
             patch(
                 "api.services.pattern_engine.primitives.context.build_context",
                 mock_build_ctx,
             ):
            from api.main import _run_patterns_leaders_scan
            _run_patterns_leaders_scan()

        # Filter to intraday calls only
        intraday_calls = [
            (pids, ctx) for pids, ctx in captured_ctx_calls
            if any(p in ["lance_opening_drive", "opening_range_breakout", "opening_range_breakdown"]
                   for p in pids)
        ]
        self.assertGreater(len(intraday_calls), 0,
                           "Expected at least one intraday detect_all call")
        for pids, ctx in intraday_calls:
            self.assertIs(ctx, sentinel_ctx,
                          f"ctx for {pids} should be the sentinel ctx from build_context")
        # build_context should have been called at least once for AAPL with daily bars
        self.assertTrue(mock_build_ctx.called,
                        "build_context should have been called")


# ---------------------------------------------------------------------------
# Test 5 — Robustness: get_bars raising for one ticker doesn't abort loop
# ---------------------------------------------------------------------------

class TestRobustness(unittest.TestCase):
    """get_bars raising on one ticker → loop continues, other tickers still scanned."""

    def test_exception_in_get_bars_continues_loop(self):
        """If get_bars raises for AAPL, MSFT still gets scanned."""
        import json

        scanned_syms = []

        def _fake_get_bars(sym, tf, n):
            if sym == "AAPL":
                raise RuntimeError("simulated get_bars failure")
            return [(1_700_000_000 + i * (86400 if tf == "D" else 300), 100.0, 101.0, 99.0, 100.5, 1000)
                    for i in range(50 if tf == "D" else 20)]

        def _detect_all_capture(bars, ctx, pattern_ids=None):
            # Record which symbols were scanned via daily detect_all (no pattern_ids = daily pass)
            return []

        mock_build_ctx = MagicMock(return_value={"trend_stage": 2})
        mock_detect_all = MagicMock(return_value=[])

        cap_json = json.dumps(["OTHER"])
        leader_json = json.dumps({"tickers": ["AAPL", "MSFT"]})

        with patch(f"{MAIN_MOD}._is_rth_now", return_value=True), \
             patch(f"{MAIN_MOD}.open", side_effect=[
                 unittest.mock.mock_open(read_data=leader_json)(),
                 unittest.mock.mock_open(read_data=cap_json)(),
             ], create=True), \
             patch("os.path.exists", return_value=True), \
             patch("api.services.bars_sqlite.get_bars", side_effect=_fake_get_bars), \
             patch("api.services.pattern_engine.memory.store_detection", MagicMock()), \
             patch("api.services.pattern_engine.detect_all", mock_detect_all), \
             patch(
                 "api.services.pattern_engine.primitives.context.build_context",
                 mock_build_ctx,
             ):
            # Should not raise despite AAPL failure
            from api.main import _run_patterns_universe_scan
            try:
                _run_patterns_universe_scan()
                completed = True
            except Exception:
                completed = False

        self.assertTrue(completed,
                        "_run_patterns_universe_scan must complete even if one ticker fails")
        # build_context should have been called for MSFT (daily pass at least)
        self.assertTrue(mock_build_ctx.called,
                        "build_context should have been called for non-failing tickers")


if __name__ == "__main__":
    unittest.main()
