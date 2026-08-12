"""Tests for extended-hours price fields (A4) in massive.py snapshot functions."""
from unittest import mock

# ── Shared test data ───────────────────────────────────────────────────────────

_SNAP_PAYLOAD = {
    "status": "OK",
    "ticker": {
        "ticker": "AAPL",
        "todaysChangePerc": 1.5,
        "todaysChange": 2.8,
        "day":      {"c": 185.0, "vw": 184.5, "o": 183.0, "v": 50_000_000},
        "prevDay":  {"c": 182.2, "v": 45_000_000},
        "lastTrade": {"p": 186.5},  # extended-hours print
    },
}

_BATCH_PAYLOAD = {
    "status": "OK",
    "tickers": [
        {
            "ticker": "AAPL",
            "todaysChangePerc": 1.5,
            "day":      {"c": 185.0, "o": 183.0, "v": 50_000_000},
            "prevDay":  {"c": 182.2, "v": 45_000_000},
            "lastTrade": {"p": 186.5},
        },
        {
            "ticker": "NVDA",
            "todaysChangePerc": -0.8,
            "day":      {"c": 820.0, "o": 825.0, "v": 12_000_000},
            "prevDay":  {"c": 827.0, "v": 11_500_000},
            "lastTrade": {"p": 0},   # no ext trade
        },
    ],
}


def _make_client():
    """Create a _MassiveRestClient with a fake API key."""
    import os, importlib
    with mock.patch.dict("os.environ", {"MASSIVE_API_KEY": "fake-key"}):
        from api.services import massive as _m
        # reset singleton
        _m._client = None
        client = _m._MassiveRestClient()
    return client


# ── get_single_ticker_snapshot ─────────────────────────────────────────────────

def test_single_snapshot_ext_price_pre_market():
    client = _make_client()
    with mock.patch.object(client, "_get", return_value=_SNAP_PAYLOAD), \
         mock.patch("api.services.massive._detect_session", return_value="pre_market"):
        snap = client.get_single_ticker_snapshot("AAPL")
    assert snap["ext_price"] == 186.5
    assert snap["ext_session"] == "pre_market"
    # Existing fields must still be present
    assert snap["close"] == 185.0
    assert "change_pct" in snap


def test_single_snapshot_ext_price_post_market():
    client = _make_client()
    with mock.patch.object(client, "_get", return_value=_SNAP_PAYLOAD), \
         mock.patch("api.services.massive._detect_session", return_value="post_market"):
        snap = client.get_single_ticker_snapshot("AAPL")
    assert snap["ext_price"] == 186.5
    assert snap["ext_session"] == "post_market"


def test_single_snapshot_no_ext_during_regular_session():
    client = _make_client()
    with mock.patch.object(client, "_get", return_value=_SNAP_PAYLOAD), \
         mock.patch("api.services.massive._detect_session", return_value="regular"):
        snap = client.get_single_ticker_snapshot("AAPL")
    # During regular session, ext_price and ext_session should both be None
    assert snap["ext_price"] is None
    assert snap["ext_session"] is None


def test_single_snapshot_no_ext_when_last_trade_zero():
    client = _make_client()
    payload = {
        "status": "OK",
        "ticker": {
            "ticker": "NVDA",
            "todaysChangePerc": 0.0,
            "day": {"c": 820.0, "vw": 819.0},
            "prevDay": {"c": 817.0},
            "lastTrade": {"p": 0},  # zero → no ext price
        },
    }
    with mock.patch.object(client, "_get", return_value=payload), \
         mock.patch("api.services.massive._detect_session", return_value="pre_market"):
        snap = client.get_single_ticker_snapshot("NVDA")
    assert snap["ext_price"] is None
    assert snap["ext_session"] is None


# ── get_batch_rich_snapshots ───────────────────────────────────────────────────

def test_batch_rich_snapshots_ext_price_populated():
    client = _make_client()
    with mock.patch.object(client, "_get", return_value=_BATCH_PAYLOAD), \
         mock.patch("api.services.massive._detect_session", return_value="post_market"):
        result = client.get_batch_rich_snapshots(["AAPL", "NVDA"])

    # AAPL has a non-zero lastTrade.p → ext_price set
    assert result["AAPL"]["ext_price"] == 186.5
    assert result["AAPL"]["ext_session"] == "post_market"

    # NVDA has lastTrade.p == 0 → ext_price is None
    assert result["NVDA"]["ext_price"] is None
    assert result["NVDA"]["ext_session"] is None


def test_ext_price_prefers_minute_close_when_last_trade_is_stale():
    """SPY-class bug: lastTrade sits pinned to the 4pm regular close in post-market,
    while min.c carries the real after-hours price. Use min.c there."""
    from api.services.massive import _ext_price_for
    # Stale lastTrade == regular close; min.c is the live post-market print.
    assert _ext_price_for("post_market", {"p": 770.56}, {"c": 770.98}, {"c": 770.56}) == (770.98, "post_market")
    # Fresh lastTrade (differs from the close) is used directly.
    assert _ext_price_for("post_market", {"p": 580.20}, {"c": 580.15}, {"c": 579.00}) == (580.20, "post_market")
    # Genuinely flat after-hours → honest regular close (0% move), not dropped.
    assert _ext_price_for("post_market", {"p": 100.0}, {"c": 100.0}, {"c": 100.0}) == (100.0, "post_market")
    # Missing lastTrade → fall back to the minute close.
    assert _ext_price_for("pre_market", {}, {"c": 50.5}, {"c": 50.0}) == (50.5, "pre_market")
    # Regular session → no extended fields.
    assert _ext_price_for("regular", {"p": 770.56}, {"c": 770.98}, {"c": 770.56}) == (None, None)
    # Nothing usable → None.
    assert _ext_price_for("post_market", {}, {}, {}) == (None, None)


def test_batch_rich_snapshots_stale_last_trade_uses_min_close():
    client = _make_client()
    payload = {
        "status": "OK",
        "tickers": [{
            "ticker": "SPY",
            "todaysChangePerc": -0.32,
            "day":      {"c": 770.56, "o": 774.5, "v": 3e7},
            "prevDay":  {"c": 773.03, "v": 4e7},
            "lastTrade": {"p": 770.56},   # STALE — pinned to the 4pm close
            "min":      {"c": 770.98},    # real post-market price
        }],
    }
    with mock.patch.object(client, "_get", return_value=payload), \
         mock.patch("api.services.massive._detect_session", return_value="post_market"):
        result = client.get_batch_rich_snapshots(["SPY"])
    assert result["SPY"]["ext_price"] == 770.98
    assert result["SPY"]["ext_session"] == "post_market"


def test_batch_rich_snapshots_no_ext_during_regular():
    client = _make_client()
    with mock.patch.object(client, "_get", return_value=_BATCH_PAYLOAD), \
         mock.patch("api.services.massive._detect_session", return_value="regular"):
        result = client.get_batch_rich_snapshots(["AAPL", "NVDA"])

    assert result["AAPL"]["ext_price"] is None
    assert result["AAPL"]["ext_session"] is None


def test_batch_rich_snapshots_existing_fields_intact():
    """Ensure legacy close/vol/change_pct/day_open/prev_close fields are unaffected."""
    client = _make_client()
    with mock.patch.object(client, "_get", return_value=_BATCH_PAYLOAD), \
         mock.patch("api.services.massive._detect_session", return_value="pre_market"):
        result = client.get_batch_rich_snapshots(["AAPL"])

    snap = result["AAPL"]
    assert snap["price"] == 185.0
    assert snap["change_pct"] == 1.5
    assert snap["day_open"] == 183.0
    assert snap["prev_close"] == 182.2


# ── get_batch_snapshots — spurious-zero handling ────────────────────────────────
# Massive returns todaysChangePerc == 0 pre-market / at the open / on weekends /
# on stale batch entries even when a real move exists. Surfacing that literal 0
# made the Theme Tracker flash every holding to 0.00% until the tape caught up.

def test_batch_snapshots_recomputes_spurious_zero_and_omits_no_data():
    client = _make_client()
    payload = {
        "status": "OK",
        "tickers": [
            # todaysChangePerc == 0 but closes show a real move → recompute from closes
            {"ticker": "ORKA", "todaysChangePerc": 0,
             "day": {"c": 92.7, "v": 0}, "prevDay": {"c": 83.04}},
            # real non-zero todaysChangePerc, but the REGULAR move (day.c vs prev.c)
            # still wins — todaysChangePerc is last-trade-based (incl. after-hours).
            {"ticker": "AAPL", "todaysChangePerc": 1.5,
             "day": {"c": 185.0, "v": 5e7}, "prevDay": {"c": 182.2}},
            # genuinely flat WITH real day data → keep the honest 0.00
            {"ticker": "FLAT", "todaysChangePerc": 0,
             "day": {"c": 100.0, "v": 1e6}, "prevDay": {"c": 100.0}},
            # no usable data (no day close, zero change) → omit so callers keep last
            {"ticker": "DEAD", "todaysChangePerc": 0,
             "day": {"c": 0, "v": 0}, "prevDay": {"c": 0}},
        ],
    }
    with mock.patch.object(client, "_get", return_value=payload):
        result = client.get_batch_snapshots(["ORKA", "AAPL", "FLAT", "DEAD"])

    assert result["ORKA"] == round((92.7 - 83.04) / 83.04 * 100, 4)   # ~11.6329
    assert result["AAPL"] == round((185.0 - 182.2) / 182.2 * 100, 4)  # ~1.5368, not 1.5
    assert result["FLAT"] == 0.0
    assert "DEAD" not in result
