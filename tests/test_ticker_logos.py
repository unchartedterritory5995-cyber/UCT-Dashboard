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
