import io
import os
import time
from unittest import mock

import requests
from PIL import Image

from api.services import ticker_logos as tl


def _png_bytes(w, h):
    im = Image.new("RGBA", (w, h), (200, 30, 30, 255))
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def test_normalize_png_caps_at_256():
    out = tl._normalize_png(_png_bytes(400, 400))
    assert out is not None
    im = Image.open(io.BytesIO(out))
    assert max(im.size) == 256


def test_normalize_png_does_not_upscale_small_logos():
    out = tl._normalize_png(_png_bytes(64, 64))
    assert out is not None
    im = Image.open(io.BytesIO(out))
    assert max(im.size) == 64


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


# ── logo.dev primary source ───────────────────────────────────────────────────

def test_logodev_builds_ticker_url_with_token_and_404_fallback():
    captured = {}
    def fake(url):
        captured["url"] = url
        return b"\x89PNG\r\n\x1a\nlogodev"
    with mock.patch.object(tl, "_url_bytes", side_effect=fake), \
         mock.patch.object(tl, "_LOGODEV_TOKEN", "pk_test"):
        out = tl._logodev_logo_bytes("AAPL")
    assert out is not None
    assert "img.logo.dev/ticker/AAPL" in captured["url"]
    assert "token=pk_test" in captured["url"]
    assert "fallback=404" in captured["url"]


def test_logodev_is_first_source_short_circuits_chain():
    with mock.patch.object(tl, "_logodev_logo_bytes", return_value=b"\x89PNG\r\n\x1a\nx") as ld, \
         mock.patch.object(tl, "_url_bytes") as url, \
         mock.patch.object(tl, "_finnhub_logo_bytes") as fh:
        out = tl._fetch_sources("AAPL")
    assert out is not None
    ld.assert_called_once_with("AAPL")
    url.assert_not_called()
    fh.assert_not_called()


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


# ── transient vs. genuine miss (2026-08-05 cache-poison sweep) ────────────────
# A source that answers cleanly with "not found" (404, empty body) is a
# genuine verdict and keeps the full 7-day retry window. A source that never
# gets a clean answer at all (timeout/connection-error/429/5xx) is a provider
# hiccup, not a verdict, and must retry within minutes instead of a week.

class TestTransientTracking:
    def setup_method(self):
        tl._reset_transient()

    def test_url_bytes_marks_transient_on_timeout(self):
        with mock.patch("requests.get", side_effect=requests.exceptions.Timeout("boom")):
            out = tl._url_bytes("https://example.com/logo.png")
        assert out is None
        assert tl._was_transient() is True

    def test_url_bytes_marks_transient_on_connection_error(self):
        with mock.patch("requests.get",
                        side_effect=requests.exceptions.ConnectionError("dns fail")):
            out = tl._url_bytes("https://example.com/logo.png")
        assert out is None
        assert tl._was_transient() is True

    def test_url_bytes_marks_transient_on_429(self):
        class _Resp:
            ok = False
            status_code = 429
            content = b""
        with mock.patch("requests.get", return_value=_Resp()):
            out = tl._url_bytes("https://example.com/logo.png")
        assert out is None
        assert tl._was_transient() is True

    def test_url_bytes_marks_transient_on_5xx(self):
        class _Resp:
            ok = False
            status_code = 503
            content = b""
        with mock.patch("requests.get", return_value=_Resp()):
            tl._url_bytes("https://example.com/logo.png")
        assert tl._was_transient() is True

    def test_url_bytes_does_not_mark_transient_on_clean_404(self):
        """A clean 404 is a real answer, not a hiccup -- must NOT flip the
        transient flag (otherwise every genuine miss would get the short TTL
        and the miss-retry pass would just hammer providers all day)."""
        class _Resp:
            ok = False
            status_code = 404
            content = b""
        with mock.patch("requests.get", return_value=_Resp()):
            out = tl._url_bytes("https://example.com/logo.png")
        assert out is None
        assert tl._was_transient() is False

    def test_finnhub_logo_bytes_marks_transient_on_timeout(self):
        with mock.patch("api.services.finnhub_client.fh_get",
                        side_effect=requests.exceptions.Timeout("boom")):
            out = tl._finnhub_logo_bytes("AAPL")
        assert out is None
        assert tl._was_transient() is True


class TestResolveAndCacheMissClassification:
    def test_writes_transient_marker_on_provider_hiccup(self, tmp_path):
        """THE regression: before this fix, a Timeout/429/5xx during
        resolution wrote the EXACT SAME empty .miss sentinel as a genuine
        "no logo anywhere" verdict -- pinning a monogram for the full 7-day
        TTL even though the provider recovered within minutes."""
        def _fake_fetch(s):
            tl._mark_transient()
            return None
        with mock.patch.object(tl, "_CACHE_DIR", str(tmp_path)), \
             mock.patch.object(tl, "_fetch_sources", side_effect=_fake_fetch):
            out = tl.resolve_and_cache("ZZZZ")
        assert out is None
        miss_path = os.path.join(str(tmp_path), "ZZZZ.miss")
        assert os.path.exists(miss_path)
        with open(miss_path) as f:
            assert f.read().strip() == tl._MISS_TRANSIENT_MARKER

    def test_writes_plain_miss_on_genuine_absence(self, tmp_path):
        """Control direction: a clean 'nothing found anywhere, no errors'
        result still writes the original plain (7-day) sentinel."""
        with mock.patch.object(tl, "_CACHE_DIR", str(tmp_path)), \
             mock.patch.object(tl, "_fetch_sources", return_value=None):
            out = tl.resolve_and_cache("YYYY")
        assert out is None
        miss_path = os.path.join(str(tmp_path), "YYYY.miss")
        assert os.path.exists(miss_path)
        with open(miss_path) as f:
            assert f.read().strip() == ""

    def test_transient_flag_reset_between_calls(self, tmp_path):
        """A stale transient flag from a PRIOR resolve on the same thread must
        not leak into a later, cleanly-404ing call and mislabel it."""
        calls = {"n": 0}

        def _fake_fetch(s):
            calls["n"] += 1
            if calls["n"] == 1:
                tl._mark_transient()
            return None

        with mock.patch.object(tl, "_CACHE_DIR", str(tmp_path)), \
             mock.patch.object(tl, "_fetch_sources", side_effect=_fake_fetch):
            tl.resolve_and_cache("FIRST")
            tl.resolve_and_cache("SECOND")

        with open(os.path.join(str(tmp_path), "SECOND.miss")) as f:
            assert f.read().strip() == ""  # not "transient" leaked from FIRST


class TestRecentMissTtlSplit:
    def test_transient_miss_expires_after_the_short_ttl(self, tmp_path, monkeypatch):
        """THE regression: `_recent_miss` used to apply the 7-day `_MISS_TTL`
        uniformly regardless of WHY the miss happened. A transient-marked
        file aged just past the short TTL (but nowhere near 7 days) must
        already read as retryable."""
        monkeypatch.setattr(tl, "_CACHE_DIR", str(tmp_path))
        miss_path = os.path.join(str(tmp_path), "ZZZZ.miss")
        with open(miss_path, "w") as f:
            f.write(tl._MISS_TRANSIENT_MARKER)
        past = time.time() - (tl._MISS_TRANSIENT_TTL + 60)
        os.utime(miss_path, (past, past))
        assert tl._recent_miss("ZZZZ") is False

    def test_genuine_miss_stays_recent_at_the_same_age(self, tmp_path, monkeypatch):
        """Control direction: a PLAIN (genuine) miss file at the identical age
        is still well inside its 7-day window."""
        monkeypatch.setattr(tl, "_CACHE_DIR", str(tmp_path))
        miss_path = os.path.join(str(tmp_path), "YYYY.miss")
        with open(miss_path, "w"):
            pass
        past = time.time() - (tl._MISS_TRANSIENT_TTL + 60)
        os.utime(miss_path, (past, past))
        assert tl._recent_miss("YYYY") is True

    def test_genuine_miss_expires_after_seven_days(self, tmp_path, monkeypatch):
        monkeypatch.setattr(tl, "_CACHE_DIR", str(tmp_path))
        miss_path = os.path.join(str(tmp_path), "YYYY.miss")
        with open(miss_path, "w"):
            pass
        past = time.time() - (tl._MISS_TTL + 60)
        os.utime(miss_path, (past, past))
        assert tl._recent_miss("YYYY") is False


def test_run_hires_upgrade_recaches_existing(tmp_path, monkeypatch):
    monkeypatch.setattr(tl, "_CACHE_DIR", str(tmp_path))
    old = _png_bytes(80, 80)
    png_path = tl._png_path("AAPL")
    with open(png_path, "wb") as fh:
        fh.write(old)

    monkeypatch.setattr(tl, "_fetch_sources", lambda s: _png_bytes(300, 300))

    stats = tl.run_hires_upgrade(sleep_seconds=0.0)
    assert stats["total"] == 1
    assert stats["upgraded"] == 1

    from PIL import Image
    im = Image.open(png_path)
    assert max(im.size) == 256
