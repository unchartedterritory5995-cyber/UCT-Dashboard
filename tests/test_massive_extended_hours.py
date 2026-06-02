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
