from unittest import mock
from api.services import ticker_logos_prewarm as pw


def test_run_pass_skips_warm_and_resolves_cold():
    with mock.patch.object(pw, "_load_universe", return_value=["AAA", "BBB"]), \
         mock.patch("api.services.ticker_logos.get_logo_path", side_effect=["/x/AAA.png", None]), \
         mock.patch("api.services.ticker_logos.resolve_and_cache") as res, \
         mock.patch.object(pw.time, "sleep"):
        pw._run_pass()
    res.assert_called_once_with("BBB")


def test_start_async_respects_disable_env(monkeypatch):
    monkeypatch.setenv("TICKER_LOGOS_PREWARM_DISABLED", "1")
    with mock.patch.object(pw.threading, "Thread") as t:
        pw.start_async()
    t.assert_not_called()
