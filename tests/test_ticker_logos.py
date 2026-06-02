import os
from unittest import mock
from api.services import ticker_logos as tl


def test_get_logo_path_returns_none_when_absent(tmp_path):
    with mock.patch.object(tl, "_CACHE_DIR", str(tmp_path)):
        assert tl.get_logo_path("NVDA") is None


def test_get_logo_path_returns_file_when_present(tmp_path):
    with mock.patch.object(tl, "_CACHE_DIR", str(tmp_path)):
        p = os.path.join(str(tmp_path), "NVDA.png")
        with open(p, "wb") as fh:
            fh.write(b"\x89PNG\r\n")
        assert tl.get_logo_path("NVDA") == p


def test_resolve_and_cache_writes_png_from_first_working_source(tmp_path):
    png_bytes = b"\x89PNG\r\n\x1a\nrest"
    with mock.patch.object(tl, "_CACHE_DIR", str(tmp_path)), \
         mock.patch.object(tl, "_fetch_sources", return_value=png_bytes), \
         mock.patch.object(tl, "_normalize_png", return_value=png_bytes):
        out = tl.resolve_and_cache("NVDA")
    assert out is not None
    assert os.path.exists(os.path.join(str(tmp_path), "NVDA.png"))


def test_resolve_and_cache_writes_miss_sentinel_when_all_fail(tmp_path):
    with mock.patch.object(tl, "_CACHE_DIR", str(tmp_path)), \
         mock.patch.object(tl, "_fetch_sources", return_value=None):
        out = tl.resolve_and_cache("ZZZZ")
    assert out is None
    assert os.path.exists(os.path.join(str(tmp_path), "ZZZZ.miss"))


def test_resolve_skips_recent_miss(tmp_path):
    with mock.patch.object(tl, "_CACHE_DIR", str(tmp_path)):
        open(os.path.join(str(tmp_path), "ZZZZ.miss"), "w").close()
        with mock.patch.object(tl, "_fetch_sources") as fetch:
            out = tl.resolve_and_cache("ZZZZ")
        fetch.assert_not_called()
        assert out is None


# ── E3: miss-retry + Clearbit tests ───────────────────────────────────────────

def test_run_miss_retry_only_touches_miss_tickers(tmp_path):
    """run_miss_retry skips tickers without a .miss file and skips tickers
    that already have a .png."""
    png_bytes = b"\x89PNG\r\n\x1a\ndata"

    # AAPL.miss → should be retried
    open(os.path.join(str(tmp_path), "AAPL.miss"), "w").close()
    # MSFT.png already exists → should NOT be in miss list
    with open(os.path.join(str(tmp_path), "MSFT.png"), "wb") as fh:
        fh.write(png_bytes)
    # GOOG: no .miss, no .png → not in miss list either

    with mock.patch.object(tl, "_CACHE_DIR", str(tmp_path)), \
         mock.patch.object(tl, "_MISS_RETRY_LOCK", tl._MISS_RETRY_LOCK), \
         mock.patch.object(tl, "_fetch_sources_with_clearbit",
                           return_value=png_bytes) as fetch_ext, \
         mock.patch.object(tl, "_normalize_png", return_value=png_bytes), \
         mock.patch("time.sleep"):  # speed up test
        stats = tl.run_miss_retry()

    # AAPL should have been attempted; MSFT and GOOG should not
    assert stats["total"] == 1
    assert stats["resolved"] == 1
    assert stats["still_miss"] == 0
    # Clearbit chain was called exactly once (for AAPL)
    assert fetch_ext.call_count == 1
    # .miss was removed and .png was written
    assert not os.path.exists(os.path.join(str(tmp_path), "AAPL.miss"))
    assert os.path.exists(os.path.join(str(tmp_path), "AAPL.png"))


def test_run_miss_retry_still_miss_when_all_sources_fail(tmp_path):
    """run_miss_retry leaves .miss in place when extended chain returns nothing."""
    open(os.path.join(str(tmp_path), "FAKE.miss"), "w").close()

    with mock.patch.object(tl, "_CACHE_DIR", str(tmp_path)), \
         mock.patch.object(tl, "_fetch_sources_with_clearbit", return_value=None), \
         mock.patch("time.sleep"):
        stats = tl.run_miss_retry()

    assert stats["total"] == 1
    assert stats["resolved"] == 0
    assert stats["still_miss"] == 1
    # .miss still present
    assert os.path.exists(os.path.join(str(tmp_path), "FAKE.miss"))


def test_clearbit_source_attempted_via_domain(tmp_path):
    """_clearbit_logo_bytes is called by _fetch_sources_with_clearbit."""
    # Verify the extended chain calls _clearbit_logo_bytes after other sources fail
    png_bytes = b"\x89PNG\r\n\x1a\nclearbit"

    with mock.patch.object(tl, "_url_bytes", return_value=None), \
         mock.patch.object(tl, "_finnhub_logo_bytes", return_value=None), \
         mock.patch.object(tl, "_clearbit_logo_bytes", return_value=png_bytes) as clearbit:
        result = tl._fetch_sources_with_clearbit("AAPL")

    clearbit.assert_called_once_with("AAPL")
    assert result == png_bytes


def test_clearbit_skips_when_no_website(tmp_path):
    """_clearbit_logo_bytes returns None when yfinance has no website field."""
    with mock.patch("yfinance.Ticker") as mock_yf:
        mock_yf.return_value.info = {"symbol": "AAPL"}  # no "website" key
        result = tl._clearbit_logo_bytes("AAPL")
    assert result is None


def test_run_miss_retry_no_miss_files(tmp_path):
    """run_miss_retry with an empty cache dir → stats all zeros, no error."""
    with mock.patch.object(tl, "_CACHE_DIR", str(tmp_path)):
        stats = tl.run_miss_retry()
    assert stats == {"total": 0, "resolved": 0, "still_miss": 0}


def test_prewarm_router_misses_param():
    """POST /api/logos/prewarm?misses=1 calls run_miss_retry_now instead of run_now."""
    from fastapi.testclient import TestClient
    from api.main import app
    import api.services.ticker_logos_prewarm as pw
    client = TestClient(app)

    with mock.patch.object(pw, "run_miss_retry_now",
                           return_value={"started": True}) as miss_fn, \
         mock.patch.object(pw, "run_now") as full_fn:
        r = client.post("/api/logos/prewarm?misses=1")

    assert r.status_code == 200
    assert r.json()["mode"] == "miss_retry"
    miss_fn.assert_called_once()
    full_fn.assert_not_called()
