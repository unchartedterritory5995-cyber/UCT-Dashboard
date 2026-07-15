"""On-demand deep gap-fill (2026-07-14): a chart view of ANY depth fills interior
holes in the viewed range that the ~2-week delta gap-fill can't reach.

Covers the synchronous core (`_deepfill_once`: fetch → diff → insert only
missing) and the throttle/guard wrapper (`_maybe_kick_deepfill`).
"""
import time
from unittest.mock import patch, MagicMock

from api.services import bars_fetch


def test_depth_tier_buckets():
    assert bars_fetch._depth_tier(200) == 400
    assert bars_fetch._depth_tier(400) == 400
    assert bars_fetch._depth_tier(401) == 1200
    assert bars_fetch._depth_tier(5000) == 5000
    assert bars_fetch._depth_tier(9000) == 99999


def test_deepfill_once_inserts_only_missing():
    now = int(time.time())
    a, hole, c = now - 3600, now - 1800, now  # 3 bars; middle one is the hole
    fetched = [
        {"t": a,    "o": 1, "h": 1, "l": 1, "c": 1, "v": 1},
        {"t": hole, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1},
        {"t": c,    "o": 1, "h": 1, "l": 1, "c": 1, "v": 1},
    ]
    stored = [(a, 1, 1, 1, 1, 1), (c, 1, 1, 1, 1, 1)]  # hole absent

    put = MagicMock()
    with patch.object(bars_fetch, "_fetch_intraday", return_value=fetched), \
         patch.object(bars_fetch, "_is_intraday_stale", return_value=False), \
         patch.object(bars_fetch._sqlite, "get_bars_since", return_value=stored), \
         patch.object(bars_fetch._sqlite, "put_bars", put), \
         patch.object(bars_fetch.cache, "delete_prefix") as delp:
        n = bars_fetch._deepfill_once("qqq", "30", 200)

    assert n == 1
    # put_bars called with ONLY the missing bar (surgical)
    inserted = put.call_args.args[2]
    assert [b["t"] for b in inserted] == [hole]
    delp.assert_called_once_with("bars_QQQ_30_")


def test_deepfill_once_noop_when_complete():
    now = int(time.time())
    a, c = now - 1800, now
    fetched = [{"t": a, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1},
               {"t": c, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}]
    stored = [(a, 1, 1, 1, 1, 1), (c, 1, 1, 1, 1, 1)]
    put = MagicMock()
    with patch.object(bars_fetch, "_fetch_intraday", return_value=fetched), \
         patch.object(bars_fetch, "_is_intraday_stale", return_value=False), \
         patch.object(bars_fetch._sqlite, "get_bars_since", return_value=stored), \
         patch.object(bars_fetch._sqlite, "put_bars", put), \
         patch.object(bars_fetch.cache, "delete_prefix"):
        n = bars_fetch._deepfill_once("QQQ", "30", 200)
    assert n == 0
    put.assert_not_called()  # nothing missing → no write (no lock pressure)


def test_deepfill_once_skips_stale():
    with patch.object(bars_fetch, "_fetch_intraday", return_value=[{"t": 1, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}]), \
         patch.object(bars_fetch, "_is_intraday_stale", return_value=True), \
         patch.object(bars_fetch._sqlite, "put_bars") as put:
        n = bars_fetch._deepfill_once("QQQ", "30", 200)
    assert n == 0
    put.assert_not_called()


def test_maybe_kick_noop_for_non_intraday():
    with patch.object(bars_fetch.cache, "get") as cg:
        bars_fetch._maybe_kick_deepfill("QQQ", "D", 200)
    cg.assert_not_called()  # bailed on the tf check before touching the cache


def test_maybe_kick_throttled_when_marker_present():
    with patch.object(bars_fetch.cache, "get", return_value=1), \
         patch.object(bars_fetch._deepfill_sem, "acquire") as acq:
        bars_fetch._maybe_kick_deepfill("QQQ", "30", 200)
    acq.assert_not_called()  # marker present → throttled, never acquires a slot


def test_maybe_kick_disabled_killswitch():
    with patch.object(bars_fetch, "_DEEPFILL_ENABLED", False), \
         patch.object(bars_fetch.cache, "get") as cg:
        bars_fetch._maybe_kick_deepfill("QQQ", "30", 200)
    cg.assert_not_called()
