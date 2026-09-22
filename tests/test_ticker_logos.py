import io
import json
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
         mock.patch.object(tl, "_fetch_sources", return_value=(png_bytes, "logodev")), \
         mock.patch.object(tl, "_normalize_png", return_value=png_bytes):
        out = tl.resolve_and_cache("NVDA")
    assert out is not None
    assert os.path.exists(os.path.join(str(tmp_path), "NVDA.png"))


def test_resolve_and_cache_writes_miss_sentinel_when_all_fail(tmp_path):
    with mock.patch.object(tl, "_CACHE_DIR", str(tmp_path)), \
         mock.patch.object(tl, "_fetch_sources", return_value=(None, ())):
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


# ── FMP `stable/profile` migration (2026-08-05, plan Task 8) ──────────────────
# _finnhub_logo_bytes now tries FMP `stable/profile` FIRST (own bounded
# timeout, never routed through Finnhub's shared token bucket), falling
# through to the existing Finnhub profile2 call unchanged. FMP's real,
# probed schema has NO logo/image field, so today this is a real (not
# skipped) attempt that always falls through -- these tests cover both that
# fall-through path and the defensive "if FMP ever adds the field" path.

def test_fmp_profile_row_parses_list_of_one_shape():
    with mock.patch("api.services.earnings_estimates._fmp_get",
                    return_value=[{"companyName": "Apple Inc.", "sector": "Technology"}]):
        row = tl._fmp_profile_row("AAPL")
    assert row == {"companyName": "Apple Inc.", "sector": "Technology"}


def test_fmp_profile_row_parses_bare_dict_shape():
    with mock.patch("api.services.earnings_estimates._fmp_get",
                    return_value={"companyName": "Apple Inc."}):
        row = tl._fmp_profile_row("AAPL")
    assert row == {"companyName": "Apple Inc."}


def test_fmp_profile_row_none_on_empty_response():
    with mock.patch("api.services.earnings_estimates._fmp_get", return_value=None):
        assert tl._fmp_profile_row("ZZZZ") is None
    with mock.patch("api.services.earnings_estimates._fmp_get", return_value=[]):
        assert tl._fmp_profile_row("ZZZZ") is None


def test_finnhub_logo_bytes_falls_through_to_finnhub_when_fmp_has_no_logo_field():
    """THE real-world shape (probed 2026-08-05): FMP's stable/profile row
    exists but has no image/logo field at all -- must fall through cleanly to
    the actual Finnhub leg, which supplies the real logo bytes."""
    finnhub_png = b"\x89PNG\r\n\x1a\nfinnhub-logo"

    def _fake_get(url, **kw):
        class _R:
            ok = True
            content = finnhub_png
            status_code = 200
        return _R()

    with mock.patch("api.services.earnings_estimates._fmp_get",
                    return_value=[{"companyName": "Apple Inc.", "sector": "Technology"}]), \
         mock.patch("api.services.finnhub_client.fh_get",
                    return_value={"logo": "https://static.finnhub.io/aapl.png"}), \
         mock.patch("requests.get", side_effect=_fake_get) as req_get:
        out = tl._finnhub_logo_bytes("AAPL")
    assert out == finnhub_png
    # Only the Finnhub CDN URL was ever fetched -- FMP had nothing to offer.
    req_get.assert_called_once()
    assert req_get.call_args[0][0] == "https://static.finnhub.io/aapl.png"


def test_finnhub_logo_bytes_uses_fmp_image_when_present_and_skips_finnhub():
    """Defensive path: if FMP's schema ever adds an `image` field, it's used
    as the PRIMARY source and Finnhub is never called at all."""
    fmp_png = b"\x89PNG\r\n\x1a\nfmp-logo"

    def _fake_get(url, **kw):
        class _R:
            ok = True
            content = fmp_png
            status_code = 200
        return _R()

    with mock.patch("api.services.earnings_estimates._fmp_get",
                    return_value=[{"companyName": "Apple Inc.",
                                   "image": "https://images.financialmodelingprep.com/aapl.png"}]), \
         mock.patch("api.services.finnhub_client.fh_get") as fh, \
         mock.patch("requests.get", side_effect=_fake_get):
        out = tl._finnhub_logo_bytes("AAPL")
    assert out == fmp_png
    fh.assert_not_called()  # Finnhub never reached -- FMP already supplied the logo


def test_finnhub_logo_bytes_fmp_image_url_rejected_by_ssrf_guard_falls_to_finnhub():
    """A non-https / private-host `image` URL from FMP must be rejected by the
    same SSRF guard as every other source, and fall through to Finnhub."""
    finnhub_png = b"\x89PNG\r\n\x1a\nfinnhub-logo"

    def _fake_get(url, **kw):
        class _R:
            ok = True
            content = finnhub_png
            status_code = 200
        return _R()

    with mock.patch("api.services.earnings_estimates._fmp_get",
                    return_value=[{"image": "http://169.254.169.254/aapl.png"}]), \
         mock.patch("api.services.finnhub_client.fh_get",
                    return_value={"logo": "https://static.finnhub.io/aapl.png"}), \
         mock.patch("requests.get", side_effect=_fake_get) as req_get:
        out = tl._finnhub_logo_bytes("AAPL")
    assert out == finnhub_png
    req_get.assert_called_once()
    assert req_get.call_args[0][0] == "https://static.finnhub.io/aapl.png"


def test_finnhub_logo_bytes_fmp_5xx_marks_transient_then_finnhub_still_tried():
    """A provider hiccup fetching the FMP-sourced image (5xx) marks transient
    and the code still proceeds to try Finnhub afterwards."""
    tl._reset_transient()
    finnhub_png = b"\x89PNG\r\n\x1a\nfinnhub-logo"

    def _fake_get(url, **kw):
        if "fmp-cdn" in url:
            class _Bad:
                ok = False
                content = b""
                status_code = 503
            return _Bad()
        class _Good:
            ok = True
            content = finnhub_png
            status_code = 200
        return _Good()

    with mock.patch("api.services.earnings_estimates._fmp_get",
                    return_value=[{"image": "https://fmp-cdn.example.com/aapl.png"}]), \
         mock.patch("api.services.finnhub_client.fh_get",
                    return_value={"logo": "https://static.finnhub.io/aapl.png"}), \
         mock.patch("requests.get", side_effect=_fake_get):
        out = tl._finnhub_logo_bytes("AAPL")
    assert out == finnhub_png
    assert tl._was_transient() is True


def test_finnhub_logo_bytes_no_fmp_api_key_short_circuits_to_finnhub(tmp_path):
    """When FMP_API_KEY is unset, `_fmp_get` returns None WITHOUT a network
    call (verified by `earnings_estimates._fmp_get` itself) -- `_finnhub_logo_bytes`
    must degrade straight to the Finnhub leg."""
    import os
    finnhub_png = b"\x89PNG\r\n\x1a\nfinnhub-logo"

    def _fake_get(url, **kw):
        class _R:
            ok = True
            content = finnhub_png
            status_code = 200
        return _R()

    env = dict(os.environ)
    env.pop("FMP_API_KEY", None)
    with mock.patch.dict(os.environ, env, clear=True), \
         mock.patch("api.services.finnhub_client.fh_get",
                    return_value={"logo": "https://static.finnhub.io/aapl.png"}), \
         mock.patch("requests.get", side_effect=_fake_get) as req_get:
        out = tl._finnhub_logo_bytes("AAPL")
    assert out == finnhub_png
    # requests.get was called exactly once -- for the Finnhub CDN URL, never FMP.
    req_get.assert_called_once()
    assert req_get.call_args[0][0] == "https://static.finnhub.io/aapl.png"


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
                           return_value=(png_bytes, "clearbit")) as fetch_ext, \
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
         mock.patch.object(tl, "_fetch_sources_with_clearbit", return_value=(None, ())), \
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
    assert result == (png_bytes, tl._CLEARBIT_SOURCE_NAME)


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
        TTL even though the provider recovered within minutes.

        D4 CP5: the .miss sentinel's content is now JSON (`test_recent_miss_*`
        below covers the parse side); this asserts the WRITE side -- a
        transient attempt writes `transient: true` and an EMPTY failed list,
        so a retry after the short TTL still re-tries everything."""
        def _fake_fetch(s, skip=frozenset()):
            tl._mark_transient()
            return None, ()
        with mock.patch.object(tl, "_CACHE_DIR", str(tmp_path)), \
             mock.patch.object(tl, "_fetch_sources", side_effect=_fake_fetch):
            out = tl.resolve_and_cache("ZZZZ")
        assert out is None
        miss_path = os.path.join(str(tmp_path), "ZZZZ.miss")
        assert os.path.exists(miss_path)
        with open(miss_path) as f:
            data = json.loads(f.read())
        assert data["transient"] is True
        assert data["failed"] == []

    def test_writes_plain_miss_on_genuine_absence(self, tmp_path):
        """Control direction: a clean 'nothing found anywhere, no errors'
        result writes `transient: false` and the full provider list -- every
        base-chain source was genuinely walked, unskipped."""
        with mock.patch.object(tl, "_CACHE_DIR", str(tmp_path)), \
             mock.patch.object(tl, "_fetch_sources", return_value=(None, ())):
            out = tl.resolve_and_cache("YYYY")
        assert out is None
        miss_path = os.path.join(str(tmp_path), "YYYY.miss")
        assert os.path.exists(miss_path)
        with open(miss_path) as f:
            data = json.loads(f.read())
        assert data["transient"] is False
        assert set(data["failed"]) == set(tl._SOURCE_NAMES)

    def test_transient_flag_reset_between_calls(self, tmp_path):
        """A stale transient flag from a PRIOR resolve on the same thread must
        not leak into a later, cleanly-404ing call and mislabel it."""
        calls = {"n": 0}

        def _fake_fetch(s, skip=frozenset()):
            calls["n"] += 1
            if calls["n"] == 1:
                tl._mark_transient()
            return None, ()

        with mock.patch.object(tl, "_CACHE_DIR", str(tmp_path)), \
             mock.patch.object(tl, "_fetch_sources", side_effect=_fake_fetch):
            tl.resolve_and_cache("FIRST")
            tl.resolve_and_cache("SECOND")

        with open(os.path.join(str(tmp_path), "SECOND.miss")) as f:
            data = json.loads(f.read())
        assert data["transient"] is False  # not leaked from FIRST


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

    monkeypatch.setattr(tl, "_fetch_sources", lambda s: (_png_bytes(300, 300), "override"))

    stats = tl.run_hires_upgrade(sleep_seconds=0.0)
    assert stats["total"] == 1
    assert stats["upgraded"] == 1

    from PIL import Image
    im = Image.open(png_path)
    assert max(im.size) == 256


def test_run_hires_upgrade_writes_source_sidecar(tmp_path, monkeypatch):
    """D4 CP5 (§4 item 6, third call site): `_upgrade_one` unpacks the new
    (bytes, name) shape and writes `.source` the same as the other two
    resolution paths — a resolved hit is a resolved hit regardless of which
    pass produced it."""
    monkeypatch.setattr(tl, "_CACHE_DIR", str(tmp_path))
    with open(tl._png_path("AAPL"), "wb") as fh:
        fh.write(_png_bytes(80, 80))
    monkeypatch.setattr(tl, "_fetch_sources", lambda s: (_png_bytes(300, 300), "logodev"))

    tl.run_hires_upgrade(sleep_seconds=0.0)

    with open(tl._source_path("AAPL")) as f:
        assert f.read().strip() == "logodev"


# ═════════════════════════════════════════════════════════════════════════════
# D4 CP5 (GATE-D4-CP5-TICKER-LOGOS, signed 2026-09-21, fingerprint ce60908e5) —
# ticker_logos.py's miss-retry stops re-walking providers that already
# answered cleanly. §8 acceptance plan.
# ═════════════════════════════════════════════════════════════════════════════

def _write_legacy_miss(tmp_path, sym, content):
    with open(os.path.join(str(tmp_path), f"{sym}.miss"), "w") as f:
        f.write(content)


def test_recent_miss_reads_legacy_bare_marker_format(tmp_path, monkeypatch):
    """§7 row 1 / §8: a .miss file in TODAY's format (bare 'transient' marker,
    or empty) keeps behaving exactly as it does today — no backfill, no
    migration script."""
    monkeypatch.setattr(tl, "_CACHE_DIR", str(tmp_path))

    _write_legacy_miss(tmp_path, "TRANS", tl._MISS_TRANSIENT_MARKER)
    past = time.time() - (tl._MISS_TRANSIENT_TTL + 60)
    os.utime(os.path.join(str(tmp_path), "TRANS.miss"), (past, past))
    assert tl._recent_miss("TRANS") is False, "a legacy transient marker must still get the short TTL"

    _write_legacy_miss(tmp_path, "PLAIN", "")
    os.utime(os.path.join(str(tmp_path), "PLAIN.miss"), (past, past))
    assert tl._recent_miss("PLAIN") is True, "a legacy empty (genuine) miss must still get the 7-day TTL"


def test_recent_miss_parses_new_json_format(tmp_path, monkeypatch):
    """§8: a .miss file in the NEW JSON shape round-trips through _recent_miss
    (TTL selection) and _read_miss (the failed set)."""
    monkeypatch.setattr(tl, "_CACHE_DIR", str(tmp_path))
    tl._write_miss("JSON1", transient=False, failed=["logodev", "parqet"])

    transient, failed = tl._read_miss("JSON1")
    assert transient is False
    assert set(failed) == {"logodev", "parqet"}
    assert tl._recent_miss("JSON1") is True, "a fresh non-transient miss is well inside the 7-day TTL"

    tl._write_miss("JSON2", transient=True, failed=[])
    past = time.time() - (tl._MISS_TRANSIENT_TTL + 60)
    os.utime(os.path.join(str(tmp_path), "JSON2.miss"), (past, past))
    assert tl._recent_miss("JSON2") is False, "a JSON transient miss must still get the short TTL"


def test_clean_miss_records_every_walked_provider(tmp_path, monkeypatch):
    """§8: a resolve_and_cache attempt where every source returns falsy (no
    transient flag) writes `failed` equal to the full _SOURCE_NAMES tuple."""
    monkeypatch.setattr(tl, "_CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(tl, "_fetch_sources", lambda s: (None, tl._SOURCE_NAMES))

    tl.resolve_and_cache("CLEANM")

    transient, failed = tl._read_miss("CLEANM")
    assert transient is False
    assert set(failed) == set(tl._SOURCE_NAMES)


def test_transient_miss_records_empty_failed(tmp_path, monkeypatch):
    """§8: an attempt where _mark_transient() fires writes failed=[], so a
    subsequent retry does not skip anything."""
    monkeypatch.setattr(tl, "_CACHE_DIR", str(tmp_path))

    def _fake_fetch(s, skip=frozenset()):
        tl._mark_transient()
        return None, ()

    monkeypatch.setattr(tl, "_fetch_sources", _fake_fetch)
    tl.resolve_and_cache("TRANM")

    transient, failed = tl._read_miss("TRANM")
    assert transient is True
    assert failed == ()


def test_retry_skips_known_clean_failures_but_still_tries_clearbit(tmp_path, monkeypatch):
    """§8: the differential proof that the skip set actually reduces egress —
    _retry_one given a .miss with every base-chain provider already
    clean-failed calls ONLY Clearbit, never the other five."""
    monkeypatch.setattr(tl, "_CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(tl, "_MISS_RETRY_LOCK", tl._MISS_RETRY_LOCK)
    tl._write_miss("RETRY1", transient=False, failed=list(tl._SOURCE_NAMES))

    calls = []

    def fake_base(name):
        def _fn(*a, **k):
            calls.append(name)
            return None
        return _fn

    clearbit_bytes = b"\x89PNG\r\n\x1a\nclearbit-win"
    with mock.patch.object(tl, "_override_logo_bytes", side_effect=fake_base("override")), \
         mock.patch.object(tl, "_logodev_logo_bytes", side_effect=fake_base("logodev")), \
         mock.patch.object(tl, "_url_bytes", side_effect=fake_base("url")), \
         mock.patch.object(tl, "_finnhub_logo_bytes", side_effect=fake_base("finnhub")), \
         mock.patch.object(tl, "_clearbit_logo_bytes", return_value=clearbit_bytes) as clearbit, \
         mock.patch.object(tl, "_normalize_png", return_value=clearbit_bytes), \
         mock.patch("time.sleep"):
        stats = tl.run_miss_retry()

    assert calls == [], (
        f"a base-chain source was called despite being in the skip set: {calls}")
    clearbit.assert_called_once()
    assert stats["resolved"] == 1


def test_hit_writes_source_sidecar_naming_the_winner(tmp_path, monkeypatch):
    """§8: a resolved logo writes {SYM}.source naming whichever source
    produced the bytes, including the alt:/name_domain tags for the fallback
    paths (§4 item 6)."""
    monkeypatch.setattr(tl, "_CACHE_DIR", str(tmp_path))
    png_bytes = b"\x89PNG\r\n\x1a\nwinner"

    # Primary chain hit: the .source file names the winning provider directly.
    monkeypatch.setattr(tl, "_fetch_sources", lambda s: (png_bytes, "parqet"))
    monkeypatch.setattr(tl, "_normalize_png", lambda raw: png_bytes)
    tl.resolve_and_cache("PRIMARY")
    with open(tl._source_path("PRIMARY")) as f:
        assert f.read().strip() == "parqet"

    # alt-symbol hit: tagged "alt:<name>".
    def _fake_fetch(s):
        return (None, ()) if s == "NOALT" else (png_bytes, "finnhub")
    monkeypatch.setattr(tl, "_fetch_sources", _fake_fetch)
    tl.resolve_and_cache("NOALT", alt="ALTSYM")
    with open(tl._source_path("NOALT")) as f:
        assert f.read().strip() == "alt:finnhub"

    # name-based hit: tagged "name_domain".
    monkeypatch.setattr(tl, "_fetch_sources", lambda s: (None, ()))
    monkeypatch.setattr(tl, "_name_logo_bytes", lambda name: png_bytes)
    tl.resolve_and_cache("NONAME", name="Some Company")
    with open(tl._source_path("NONAME")) as f:
        assert f.read().strip() == "name_domain"


def test_existing_three_call_sites_unpack_tuple_return(tmp_path, monkeypatch):
    """§7 row 3 / §8: resolve_and_cache, _retry_one, and _upgrade_one all
    correctly consume the new (bytes, name) / (None, tried) shape — none of
    the three passes a raw tuple into _normalize_png or crashes unpacking."""
    monkeypatch.setattr(tl, "_CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(tl, "_MISS_RETRY_LOCK", tl._MISS_RETRY_LOCK)
    monkeypatch.setattr(tl, "_HIRES_LOCK", tl._HIRES_LOCK)
    png_bytes = b"\x89PNG\r\n\x1a\ndata"

    # resolve_and_cache
    monkeypatch.setattr(tl, "_fetch_sources", lambda s: (png_bytes, "override"))
    monkeypatch.setattr(tl, "_normalize_png", lambda raw: png_bytes)
    assert tl.resolve_and_cache("SITE1") is not None

    # _retry_one (via run_miss_retry)
    open(os.path.join(str(tmp_path), "SITE2.miss"), "w").close()
    with mock.patch.object(tl, "_fetch_sources_with_clearbit", return_value=(png_bytes, "clearbit")), \
         mock.patch("time.sleep"):
        stats = tl.run_miss_retry()
    assert stats["resolved"] == 1

    # _upgrade_one (via run_hires_upgrade)
    stats2 = tl.run_hires_upgrade(sleep_seconds=0.0)
    assert stats2["total"] == 2   # SITE1 + SITE2, both now .png
    assert stats2["unchanged"] == 0


def test_router_and_prewarm_unaffected(tmp_path, monkeypatch):
    """§8 / §5: GET /api/ticker-logo/{sym} and ticker_logos_prewarm.coverage()
    behave identically before/after — neither reads .miss/.source content,
    only get_logo_path's boolean."""
    monkeypatch.setattr(tl, "_CACHE_DIR", str(tmp_path))
    with open(tl._png_path("HASLOGO"), "wb") as fh:
        fh.write(_png_bytes(64, 64))
    tl._write_miss("MISSED", transient=False, failed=list(tl._SOURCE_NAMES))
    tl._write_source("HASLOGO", "logodev")

    from api.services import ticker_logos_prewarm as pw
    monkeypatch.setattr(pw, "_load_universe", lambda: ["HASLOGO", "MISSED"])
    cov = pw.coverage()
    assert cov["cached"] == 1
    assert cov["universe"] == 2
    assert cov["misses"] == 1, "coverage() must count the .miss file regardless of its new JSON content"

    from fastapi.testclient import TestClient
    from api.main import app
    client = TestClient(app)
    r = client.get("/api/ticker-logo/HASLOGO")
    assert r.status_code == 200
