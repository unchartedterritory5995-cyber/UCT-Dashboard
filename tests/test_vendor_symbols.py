"""A vendor ticker with a lowercase marker never lands on a common stock's key (2026-11-18).

Production: Balchem's daily chart (BCPC) drew Brunswick's preferred C (`BCpC`, ~$20) for 11-16 and
11-17, and Tutor Perini's (TPC) drew AT&T's preferred C (`TpC`): every whole-market feed keyed its
rows with `.upper()`. api/services/vendor_symbols.py has the measurement."""
import pytest

from api.services import bars_live_ingest as ing
from api.services import bars_live_store as bls
from api.services import massive
from api.services.cache import cache
from api.services.vendor_symbols import app_symbol, marked

T0 = 1_791_990_000  # a 5m boundary (unix seconds)


def test_a_marked_ticker_has_no_app_key_and_a_common_one_keeps_its_own():
    assert app_symbol("BCpC") is None and app_symbol("TpC") is None
    assert app_symbol("ABRpD") is None and app_symbol("XYZWr") is None    # a preferred, a right
    assert app_symbol("BCPC") == "BCPC" and app_symbol("TPC") == "TPC"
    assert app_symbol("BRK.B") == "BRK-B"
    assert app_symbol("") is None and app_symbol(None) is None
    assert marked("BCpC") and not marked("BCPC") and not marked("BRK.B")


@pytest.fixture()
def _stream(monkeypatch):
    monkeypatch.setenv("BARS_UNIVERSE_STREAM_ENABLED", "1")
    ing._reset_for_tests()
    yield
    ing._reset_for_tests()


def _am(sym, minute_s, c, v=100):
    ing.on_am(sym, {"t": minute_s * 1000, "o": c, "h": c, "l": c, "c": c, "v": v})


@pytest.mark.parametrize("order", ["common_first", "preferred_first"])
def test_the_minute_stream_never_writes_a_preferred_into_the_common_stock(_stream, order):
    ing.mark_connected(now_ms=(T0 - 10) * 1000)
    feed = [("BCPC", 171.5), ("BCpC", 20.55)]
    for sym, c in (feed if order == "common_first" else feed[::-1]):
        _am(sym, T0, c)
    rows = ing.take_payload()["rows"]
    assert rows == [["BCPC", T0, 171.5, 171.5, 171.5, 171.5, 100]]


@pytest.mark.parametrize("order", ["common_first", "preferred_first"])
def test_the_daily_snapshot_keeps_the_common_stocks_day_bar(order):
    snap = [{"ticker": "TPC", "day": {"o": 98.0, "h": 99.5, "l": 97.0, "c": 98.79, "v": 400_000}},
            {"ticker": "TpC", "day": {"o": 15.1, "h": 15.3, "l": 15.0, "c": 15.19, "v": 30_000}}]
    rows = bls.daily_rows_from_snapshot(snap if order == "common_first" else snap[::-1], 20261117)
    assert rows == [("TPC", 20261117, 98.0, 99.5, 97.0, 98.79, 400_000)]


class _Client:
    _api_key = "k"

    def __init__(self, payload):
        self._payload = payload

    def _get(self, url):
        return self._payload

    def _typed_get(self, path):          # the frame reader's typed fetch
        return self._payload


@pytest.mark.parametrize("reader", ["closes", "ohlcv", "frame"])
def test_grouped_daily_keeps_the_common_stocks_close(reader, monkeypatch, tmp_path):
    # The preferred listed AFTER the common stock, as the vendor sorts them: upper-cased it won.
    payload = {"resultsCount": 2, "results": [
        {"T": "BCPC", "o": 173.35, "h": 174.15, "l": 170.9, "c": 171.48, "v": 168_300},
        {"T": "BCpC", "o": 20.55, "h": 21.025, "l": 20.55, "c": 20.55, "v": 21_242},
    ]}
    monkeypatch.setattr(massive, "_get_client", lambda: _Client(payload))
    monkeypatch.setattr(massive, "_GROUPED_DIR", str(tmp_path / "c"))
    monkeypatch.setattr(massive, "_GROUPED_OHLCV_DIR", str(tmp_path / "o"))
    with cache._lock:
        cache._store.clear()
    try:
        if reader == "closes":
            got = massive.get_grouped_daily_closes("2026-11-16")
            assert got == {"BCPC": 171.48}
        elif reader == "ohlcv":
            got = massive.get_grouped_daily_ohlcv("2026-11-16")
            assert set(got) == {"BCPC"} and got["BCPC"]["c"] == 171.48
        else:
            got = massive.get_grouped_daily_frame("2026-11-16", store=False)["rows"]
            assert set(got) == {"BCPC"} and got["BCPC"]["c"] == 171.48
    finally:
        with cache._lock:
            cache._store.clear()
