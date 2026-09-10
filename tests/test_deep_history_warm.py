"""Deep-history warm — smoke + guard tests.

The heavy work (provider fetches) isn't unit-tested; these lock the SAFETY
behavior: it never runs on the web pod, never runs unflagged, and its ticker
list is resilient (always at least the priority megacaps, even with no DB/files).
"""
import os
from unittest.mock import patch

from api.services import deep_history_warm as dhw


def test_ticker_list_always_includes_priority_and_is_resilient():
    tickers = dhw._build_ticker_list()
    assert "SPY" in tickers and "NVDA" in tickers and "SMCI" in tickers
    # No dupes, all upper-case, priority names come first.
    assert len(tickers) == len(set(tickers))
    assert all(t == t.upper() for t in tickers)
    assert tickers[0] == "SPY"


def test_deep_targets_match_frontend_full_history():
    # Daily target = ~50yr, kept in lockstep with fullBarsFor('D') in barsBackfill.js.
    assert dhw._DEEP_TARGET["D"] == 12500
    # Every tf the warmer sweeps must have a vendor floor to test depth against —
    # a missing one silently answers "not deep" forever (a re-fetch every sweep).
    assert set(dhw._DEEP_TARGET) == set(dhw._VENDOR_FLOOR_YMD)
    # sessions is still attempted once (its cache hit is fast if nothing deeper).


def test_no_op_when_flag_disabled(capsys):
    with patch.dict(os.environ, {"DEEP_HISTORY_WARM_ENABLED": "0", "WORKER_ENABLED": "1"}):
        dhw.deep_warm_history_once()
    assert "Skipped" in capsys.readouterr().out


def test_no_op_on_web_pod_even_when_flag_enabled(capsys):
    # The OOM lesson: NEVER on web. Flag on but WORKER_ENABLED unset → refuse.
    with patch.dict(os.environ, {"DEEP_HISTORY_WARM_ENABLED": "1"}, clear=False):
        os.environ.pop("WORKER_ENABLED", None)
        dhw.deep_warm_history_once()
    assert "worker-only" in capsys.readouterr().out.lower()


# ── The 2026-09-09 truncation class ───────────────────────────────────────────
# `_already_deep` replaced a raw bar-COUNT skip test. The count went stale as the
# market aged: Massive's daily archive starts 2003-09-10, so a pre-2003 listing with
# complete vendor coverage and NO deep graft held ~5,200 rows in mid-2023 and ~5,785
# by 2026-09 — over the old floor either way, so it answered "already deep" forever.
# Measured that day: SPY/MSFT/AAPL/NVDA and 26 other large caps served history
# starting exactly 2003-09-10, while every grafted symbol started before the floor.

_FLOOR = dhw._VENDOR_FLOOR_YMD["D"]  # 20030910


def test_massive_floor_depth_is_not_deep_however_many_rows_it_has():
    """The exact production shape: 5,785 daily rows, first bar ON the vendor floor.
    The old test passed this (5785 >= 5200); it must now FAIL."""
    with patch.object(dhw._sqlite, "get_first_ts", return_value=_FLOOR), \
         patch.object(dhw._sqlite, "get_count", return_value=5785):
        assert dhw._already_deep("MSFT", "D") is False
    # And it must stay false at ANY count — the failure mode was a threshold that
    # time walked past, so no count may ever overrule a floor-pinned first bar.
    for n in (5785, 12500, 99999):
        with patch.object(dhw._sqlite, "get_first_ts", return_value=_FLOOR),              patch.object(dhw._sqlite, "get_count", return_value=n):
            assert dhw._already_deep("MSFT", "D") is False


def test_a_pre_floor_bar_proves_the_graft_landed():
    # CME: n=5975, first=2002-12-06 — the shallowest GRAFTED symbol measured.
    with patch.object(dhw._sqlite, "get_first_ts", return_value=20021206), \
         patch.object(dhw._sqlite, "get_count", return_value=5975):
        assert dhw._already_deep("CME", "D") is True


def test_post_floor_listing_is_done_once_it_holds_the_full_target():
    # A genuine post-2003 IPO has nothing before the floor and never will, so the
    # date test alone would re-fetch it every sweep. The TARGET closes that out.
    with patch.object(dhw._sqlite, "get_first_ts", return_value=20120518), \
         patch.object(dhw._sqlite, "get_count", return_value=3596):
        assert dhw._already_deep("META", "D") is False      # attempt it once
    with patch.object(dhw._sqlite, "get_first_ts", return_value=20120518), \
         patch.object(dhw._sqlite, "get_count", return_value=dhw._DEEP_TARGET["D"]):
        assert dhw._already_deep("META", "D") is True


def test_weekly_massive_floor_was_over_the_old_weekly_count_too():
    # ~1,200 weeks from the floor to 2026 vs the old W skip floor of 1,100 — the
    # daily bug had an exact weekly twin.
    with patch.object(dhw._sqlite, "get_first_ts", return_value=_FLOOR), \
         patch.object(dhw._sqlite, "get_count", return_value=1200):
        assert dhw._already_deep("MSFT", "W") is False


def test_nothing_stored_or_a_broken_store_is_never_deep():
    with patch.object(dhw._sqlite, "get_first_ts", return_value=None):
        assert dhw._already_deep("NEWCO", "D") is False
    with patch.object(dhw._sqlite, "get_first_ts", side_effect=RuntimeError("db locked")):
        assert dhw._already_deep("MSFT", "D") is False


def test_done_marker_was_reminted_so_the_corrected_sweep_actually_runs():
    # v1 sits on the worker volume; without a new name the fixed skip test above
    # would never be reached.
    assert dhw._marker_path().endswith(".deep_history_warm_done_v2")


def test_weekly_and_monthly_floors_are_the_PERIOD_keys_not_the_daily_date():
    """The subtle half: the W bar covering 2003-09-10 is keyed to its Monday
    (2003-09-08) and the M bar to 2003-09-01 — both EARLIER than the daily floor.
    Measured against the daily constant they would read as "starts before the floor
    ⇒ grafted" and be skipped exactly as the daily bug skipped MSFT."""
    assert dhw._VENDOR_FLOOR_YMD["W"] < dhw._VENDOR_FLOOR_YMD["D"]
    assert dhw._VENDOR_FLOOR_YMD["M"] < dhw._VENDOR_FLOOR_YMD["W"]
    for tf, first in (("W", 20030908), ("M", 20030901)):
        with patch.object(dhw._sqlite, "get_first_ts", return_value=first),              patch.object(dhw._sqlite, "get_count", return_value=99999):
            assert dhw._already_deep("MSFT", tf) is False
        with patch.object(dhw._sqlite, "get_first_ts", return_value=first - 100),              patch.object(dhw._sqlite, "get_count", return_value=10):
            assert dhw._already_deep("MSFT", tf) is True
