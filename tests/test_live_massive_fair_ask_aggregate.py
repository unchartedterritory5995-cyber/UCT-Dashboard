"""Rails for the fair-NBBO ask aggregate (2026-11-09).

The aggregate tiers grade a CONTRACT but gate on the PRINT's own side, and the
stored Side is ~86% blank on a busy day from Q-pool churn. Measured that day:
CRWD 280C 12/17/27 summed to $5.57M of a real $13.31M (the missing $7.75M was
blank-side BLOCKs, which `_ledger_row_is_ask` admits for sweeps but not blocks)
and fired Alpha LEAPS on a $713K print. Re-measuring the contract against
NBBO-at-fill gives $12.28M ask / $1.19M bid, 91% ask-dominant.

Everything here is DARK behind `fair_ask_aggregate_enabled` (default False).
"""
import sqlite3

import pytest

from api.live_massive_router import (
    DEFAULT_THRESHOLDS,
    _aggregate_side_decision,
    _fair_ask_ledger,
)
import api.live_massive_router as R


# ── ships dark ──────────────────────────────────────────────────────────────

def test_feature_is_dark_by_default():
    assert DEFAULT_THRESHOLDS["fair_ask_aggregate_enabled"] is False


def test_every_new_key_is_in_the_allowed_list():
    """CLAUDE.md §4: a key in DEFAULT_THRESHOLDS but NOT in the allowed-keys list
    makes every /thresholds save 400 and reject the WHOLE payload."""
    import inspect
    src = inspect.getsource(R)
    for key in ("fair_ask_aggregate_enabled", "fair_ask_min_total_premium",
                "fair_ask_max_lookups"):
        assert key in DEFAULT_THRESHOLDS, f"{key} missing from DEFAULT_THRESHOLDS"
        # appears at least twice: the default AND the allow-list entry
        assert src.count(f'"{key}"') >= 2, f"{key} not in the allowed-keys list"


def test_disabled_ledger_does_no_work_and_touches_no_connection():
    class _Boom:
        def execute(self, *a, **k):
            raise AssertionError("must not query when the feature is dark")

    assert _fair_ask_ledger(_Boom(), "source='stocks'", "11/9/2026",
                            {"fair_ask_aggregate_enabled": False}) == {}


@pytest.mark.parametrize("thr", [
    {"fair_ask_aggregate_enabled": True, "fair_ask_min_total_premium": 0},
    {"fair_ask_aggregate_enabled": True, "fair_ask_max_lookups": 0},
])
def test_zeroed_bounds_disable_it_too(thr):
    class _Boom:
        def execute(self, *a, **k):
            raise AssertionError("must not query with a zeroed bound")

    assert _fair_ask_ledger(_Boom(), "source='stocks'", "11/9/2026", thr) == {}


# ── the measured CRWD / PANW / NVDA cases ───────────────────────────────────

@pytest.mark.parametrize("name,frac,dom,cp,direction,expect", [
    # CRWD 280C: 91% ask-dominant, call, Bull -> confirmed
    ("crwd", 0.91, "ask", "C", "Bull", True),
    # PANW 410C: 67% ask -- exactly at the floor, still confirms
    ("panw", 0.67, "ask", "C", "Bull", True),
    # NVDA 165P: 58% -- genuinely mixed, must NOT confirm
    ("nvda", 0.58, "ask", "P", "Bear", False),
    # ask-dominant tape cannot confirm a Bear call
    ("mismatch", 0.95, "ask", "C", "Bear", False),
    # bid-dominant tape confirms a Bear call
    ("bid_call", 0.90, "bid", "C", "Bear", True),
    # bid-dominant PUT = puts SOLD = bullish
    ("put_write", 0.90, "bid", "P", "Bull", True),
])
def test_aggregate_side_decision_cases(name, frac, dom, cp, direction, expect):
    assert _aggregate_side_decision(frac, dom, direction, cp, 0.67) is expect


def test_session_fair_dominant_returns_ask_and_bid_dollars():
    """The tuple grew from 3 to 5; `_aggregate_side_clean` unpacks positionally,
    so the first three MUST keep their meaning or the push veto silently changes."""
    import inspect
    src = inspect.getsource(R._session_fair_dominant)
    assert 'return (max(ask, bid) / dirp, "ask" if ask >= bid else "bid", n, ask, bid)' in src


def test_push_veto_still_unpacks_the_longer_tuple():
    import inspect
    src = inspect.getsource(R._aggregate_side_clean)
    assert "res[0], res[1], res[2]" in src, "must index, not star-unpack, the 5-tuple"


# ── the side widening: blank promotes, a measured SELL never does ───────────

def _side_is_ask_after_widening(side, fair_dominant):
    """Mirrors the widening in _derive_alert_name."""
    side_is_ask = side in ("A", "AA")
    if fair_dominant and not side_is_ask and side not in ("B", "BB"):
        side_is_ask = True
    return side_is_ask


@pytest.mark.parametrize("side,fair,expect", [
    ("A", False, True), ("AA", False, True),
    ("", False, False),                 # blank stays out when not dominant
    ("", True, True),                   # blank PROMOTES on an ask-dominant contract
    ("B", True, False),                 # ⛔ a measured bid is NEVER flipped
    ("BB", True, False),                # ⛔ ditto
    ("B", False, False), ("BB", False, False),
])
def test_blank_promotes_but_a_measured_bid_never_flips(side, fair, expect):
    assert _side_is_ask_after_widening(side, fair) is expect


def test_widening_is_inert_when_the_feature_is_dark():
    """fair_ask_dominant is only ever True when the ledger ran, and the ledger
    returns {} when dark -- so every side keeps its original meaning."""
    for side in ("A", "AA", "B", "BB", ""):
        assert (_side_is_ask_after_widening(side, False)
                == (side in ("A", "AA")))


# ── corrupt-page interaction ────────────────────────────────────────────────

def test_candidate_scan_survives_a_corrupt_page():
    """The 2026-11-09 corruption must not resurrect the outage through this new
    query -- it returns {} rather than raising."""
    class _Corrupt:
        def execute(self, *a, **k):
            raise sqlite3.DatabaseError("database disk image is malformed")

    out = _fair_ask_ledger(_Corrupt(), "source='stocks'", "11/9/2026",
                           {"fair_ask_aggregate_enabled": True,
                            "fair_ask_min_total_premium": 3_000_000,
                            "fair_ask_max_lookups": 12})
    assert out == {}


def test_other_database_errors_still_propagate():
    class _Locked:
        def execute(self, *a, **k):
            raise sqlite3.OperationalError("database is locked")

    with pytest.raises(sqlite3.OperationalError):
        _fair_ask_ledger(_Locked(), "source='stocks'", "11/9/2026",
                         {"fair_ask_aggregate_enabled": True,
                          "fair_ask_min_total_premium": 3_000_000,
                          "fair_ask_max_lookups": 12})
