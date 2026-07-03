"""Request-path yfinance daily tail-fill is hard-capped.

A Massive-lagging thin ticker (recent SPAC / illiquid small-cap) used to block a
cold chart open up to 20s on the synchronous _fill_daily_tail_with_yf call. The
request path now passes a tight timeout (_REQUEST_YF_DAILY_TIMEOUT, default 3.5s)
so a slow Yahoo call yields Massive-only bars for first paint (the tail heals on
a later poll); the nightly deep warm / index paths keep the 20s default.
"""
from unittest.mock import patch

from api.services import bars_fetch


def _old_massive(n=5):
    # Bars old enough that massive_max < expected latest session → yf tail-fill fires.
    return [{"t": f"2000-01-0{i+1}", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10} for i in range(n)]


def test_request_tail_fill_uses_short_timeout():
    captured = {}

    def _fake_yf(ticker, timeout=20.0):
        captured["timeout"] = timeout
        return []  # simulate a slow/empty Yahoo response

    with patch.object(bars_fetch, "_fetch_daily_yf", side_effect=_fake_yf):
        out = bars_fetch._fill_daily_tail_with_yf("THINCO", _old_massive())

    assert captured["timeout"] == bars_fetch._REQUEST_YF_DAILY_TIMEOUT
    assert captured["timeout"] <= 5.0, "request-path cap must be tight, not the 20s warm default"


def test_timed_out_yf_falls_back_to_massive_only():
    massive = _old_massive()
    with patch.object(bars_fetch, "_fetch_daily_yf", return_value=[]):  # timeout → []
        out = bars_fetch._fill_daily_tail_with_yf("THINCO", massive)
    # Serve the Massive bars we have rather than blocking; do not lose data.
    assert out == massive


def test_nightly_deep_warm_keeps_the_20s_default():
    # _fetch_daily(deep=True) calls _fetch_daily_yf DIRECTLY (not via the tail-fill),
    # so it must retain the generous default deadline for full-history pulls.
    captured = {}

    def _fake_yf(ticker, timeout=20.0):
        captured["timeout"] = timeout
        return []

    with patch.object(bars_fetch, "_fetch_daily_yf", side_effect=_fake_yf), \
         patch("api.services.massive.get_agg_bars", return_value=[]):
        bars_fetch._fetch_daily("MSFT", 20000, deep=True)

    assert captured["timeout"] == 20.0


def test_default_timeout_signature_is_20s():
    import inspect
    sig = inspect.signature(bars_fetch._fetch_daily_yf)
    assert sig.parameters["timeout"].default == 20.0
