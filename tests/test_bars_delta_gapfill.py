"""Root-fix regression test (2026-07-14): the intraday delta must GAP-FILL.

Massive's aggregates are complete, but our stored copy accumulated interior
holes (first-fetched mid-session, or dropped) that the old `>= heal_floor`
trailing-window filter could never restore once they aged past the heal window
(verified live: QQQ 30m 07-08 14:30 present at Massive, absent from SQLite).

`_delta_intraday` now diffs the re-fetched window against what's stored and
restores any missing bar, IN ADDITION to re-aggregating the trailing window,
WITHOUT re-writing already-present older bars (surgical → no write
amplification, no worsened lock contention).
"""
import time
from unittest.mock import patch

from api.services import bars_fetch


class _FakeClient:
    _api_key = "test"


def _ms(ts_sec):
    return ts_sec * 1000


def test_delta_intraday_restores_interior_hole_but_not_stored_bars():
    now = int(time.time())
    last_ts = now - 3600                      # last stored bar ~1h ago
    heal_floor = last_ts - bars_fetch._DELTA_HEAL_WINDOW_SECONDS  # ~9h ago

    old_present = now - 5 * 86400             # 5d ago, well below heal_floor, STORED
    hole        = now - 5 * 86400 + 1800      # 5d ago + 30m, below heal_floor, MISSING
    recent      = now - 1800                  # 30m ago, >= heal_floor

    # Massive returns the COMPLETE set (it always has the data).
    massive_raw = [
        {"t": _ms(old_present), "o": 10, "h": 11, "l": 9, "c": 10.5, "v": 100},
        {"t": _ms(hole),        "o": 10, "h": 11, "l": 9, "c": 10.6, "v": 100},
        {"t": _ms(recent),      "o": 10, "h": 11, "l": 9, "c": 10.7, "v": 100},
    ]
    # SQLite has old_present + recent, but NOT the hole. get_bars_since →
    # (ts, o, h, l, c, v) rows.
    stored_rows = [
        (old_present, 10, 11, 9, 10.5, 100),
        (recent,      10, 11, 9, 10.7, 100),
    ]

    with patch.object(bars_fetch, "_get_client", return_value=_FakeClient()), \
         patch.object(bars_fetch, "_paginate_massive_aggs", return_value=massive_raw), \
         patch.object(bars_fetch._sqlite, "get_bars_since", return_value=stored_rows):
        out = bars_fetch._delta_intraday("QQQ", "30", last_ts)

    ts_out = {b["t"] for b in out}
    assert hole in ts_out,   "interior hole must be gap-filled from Massive"
    assert recent in ts_out, "trailing-window bar must still be re-emitted"
    # Surgical: an already-stored bar below the heal floor is NOT re-written.
    assert old_present not in ts_out, "already-stored old bar must not be re-emitted"


def test_delta_intraday_clean_data_only_reemits_trailing_window():
    """No holes → behaves exactly like before (only the trailing heal window),
    so a normal poll writes nothing extra (no amplification)."""
    now = int(time.time())
    last_ts = now - 3600
    heal_floor = last_ts - bars_fetch._DELTA_HEAL_WINDOW_SECONDS

    old_present = now - 5 * 86400
    recent      = now - 1800

    massive_raw = [
        {"t": _ms(old_present), "o": 10, "h": 11, "l": 9, "c": 10.5, "v": 100},
        {"t": _ms(recent),      "o": 10, "h": 11, "l": 9, "c": 10.7, "v": 100},
    ]
    stored_rows = [
        (old_present, 10, 11, 9, 10.5, 100),
        (recent,      10, 11, 9, 10.7, 100),
    ]
    with patch.object(bars_fetch, "_get_client", return_value=_FakeClient()), \
         patch.object(bars_fetch, "_paginate_massive_aggs", return_value=massive_raw), \
         patch.object(bars_fetch._sqlite, "get_bars_since", return_value=stored_rows):
        out = bars_fetch._delta_intraday("QQQ", "30", last_ts)

    ts_out = {b["t"] for b in out}
    assert ts_out == {recent}, "clean data must only re-emit the trailing window"


def test_delta_intraday_killswitch_disables_gapfill():
    """BARS_DELTA_GAPFILL_DAYS=0 → exact pre-fix trailing-only behaviour (a hole
    is NOT restored), so the change is instantly revertible without a deploy."""
    now = int(time.time())
    last_ts = now - 3600

    old_present = now - 5 * 86400
    hole        = now - 5 * 86400 + 1800
    recent      = now - 1800

    massive_raw = [
        {"t": _ms(old_present), "o": 10, "h": 11, "l": 9, "c": 10.5, "v": 100},
        {"t": _ms(hole),        "o": 10, "h": 11, "l": 9, "c": 10.6, "v": 100},
        {"t": _ms(recent),      "o": 10, "h": 11, "l": 9, "c": 10.7, "v": 100},
    ]
    with patch.object(bars_fetch, "_DELTA_GAPFILL_DAYS", 0), \
         patch.object(bars_fetch, "_get_client", return_value=_FakeClient()), \
         patch.object(bars_fetch, "_paginate_massive_aggs", return_value=massive_raw), \
         patch.object(bars_fetch._sqlite, "get_bars_since") as gbs:
        out = bars_fetch._delta_intraday("QQQ", "30", last_ts)

    ts_out = {b["t"] for b in out}
    assert ts_out == {recent}, "kill-switch must restore trailing-only behaviour"
    assert hole not in ts_out, "kill-switch must NOT gap-fill"
    gbs.assert_not_called()  # gap-fill disabled → no stored-ts read at all
