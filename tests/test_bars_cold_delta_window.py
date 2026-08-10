"""A cold (ticker, tf) must not ask the vendor for everything since 1969.

🔴 MEASURED IN PRODUCTION 2026-08-10: 139 rejected requests in one log window.
`_delta_intraday` computed `gap_days` from `last_ts` before checking whether
`last_ts` was 0, so a (ticker, tf) with nothing stored produced ~20,600 days and a
`from_date` of **1969-12-30**. Massive answers a flat 400, the caller retries, and
it becomes a hot loop — burning vendor quota and flooding the log an operator reads
during an incident. That flooding is not cosmetic: it is what made the same
morning's real outage hard to see.

⛔ The `last_ts` guard already existed one line below for `gapfill_on`, so the cold
case was known. It just was never applied to the window that gets FETCHED.
"""
import datetime as _dt
import importlib
import re

import pytest

bf = importlib.import_module("api.services.bars_fetch")


_RANGE_RE = re.compile(r"/range/\d+/\w+/(\d{4}-\d{2}-\d{2})/(\d{4}-\d{2}-\d{2})")


def _from_dates(calls):
    """The `from_date` the code actually put in the vendor URL.

    ⭐ ASSERTED ON THE REAL URL, not on a stubbed argument list. The 400 came from
    the URL Massive received; a test that inspects a hand-shaped call object could
    pass while the URL stayed wrong.
    """
    out = []
    for url in calls:
        m = _RANGE_RE.search(url)
        assert m, f"could not find a date range in {url}"
        out.append(m.group(1))
    return out


@pytest.fixture
def recorded(monkeypatch):
    """Capture the vendor URL _delta_intraday builds, without calling out."""
    calls = []

    class _Client:
        _api_key = "test-key"

    monkeypatch.setattr(bf, "_get_client", lambda: _Client())
    monkeypatch.setattr(bf, "_paginate_massive_aggs",
                        lambda client, url: calls.append(url) or [])
    return calls


def test_a_cold_ticker_does_not_reach_back_to_1969(recorded):
    """🔴 THE REGRESSION. `last_ts=0` is 'nothing stored', not 'fetch all history'."""
    bf._delta_intraday("LRCX", "5", 0)
    assert recorded, "no vendor call was recorded"
    for d in _from_dates(recorded):
        assert not d.startswith("19"), f"asked the vendor for history from {d}"
        year = int(d[:4])
        assert year >= _dt.datetime.utcnow().year - 1, f"from_date {d} is unbounded"


def test_a_cold_window_is_small_enough_that_the_vendor_accepts_it(recorded):
    """⚠️ The 400 was the symptom; an unbounded RANGE was the cause. Pin the
    bound, not the error message — a vendor may start answering 200 with a
    truncated body and the defect would silently survive."""
    bf._delta_intraday("LRCX", "5", 0)
    d = _from_dates(recorded)[0]
    start = _dt.datetime.strptime(d, "%Y-%m-%d")
    span_days = (_dt.datetime.utcnow() - start).days
    assert 0 <= span_days <= 31, f"cold intraday window is {span_days} days"


def test_a_WARM_ticker_still_gets_its_full_heal_window(recorded):
    """⛔ THE CONTROL. Clamping every request to the cold window would silently
    stop long gaps from healing — a fix that trades a loud failure for a quiet one."""
    eight_days_ago = int(_dt.datetime.utcnow().timestamp()) - 8 * 86400
    bf._delta_intraday("LRCX", "5", eight_days_ago)
    d = _from_dates(recorded)[0]
    start = _dt.datetime.strptime(d, "%Y-%m-%d")
    span_days = (_dt.datetime.utcnow() - start).days
    assert span_days >= 8, (
        f"a ticker 8 days stale only asked for {span_days} days — gaps won't heal")


def test_the_cold_bound_is_derived_from_a_named_constant():
    """⛔ A magic number here is how the next person 'tunes' it back to unbounded."""
    import inspect
    src = inspect.getsource(bf._delta_intraday)
    assert "_COLD_INTRADAY_DAYS" in src
    assert re.search(r"if not last_ts:", src), "the cold case is not branched on"
