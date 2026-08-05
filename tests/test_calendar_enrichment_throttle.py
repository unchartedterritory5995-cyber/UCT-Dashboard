"""Calendar enrichment must not lock in THROTTLED (partial) beat_history
coverage for hours (Task 13, 2026-08-04 — the Finnhub pacing fix).

A heavy earnings day's Finnhub fan-out (`get_earnings_intel`, 3 calls/symbol)
can exceed the proactive token bucket's per-minute budget
(`earnings_estimates._fh_take_token`). When that happens mid-build,
`_build_enrichment_for_date` must detect it (via `fh_budget_denied_total()`
snapshotted before/after the fan-out) and cache the day on the SHORT
`_ENRICH_TTL` (5 min) instead of the normal `_ENRICH_TTL_PAST` (12h) /
`_ENRICH_TTL_FUTURE_WEEK` (4h) — otherwise a symbol that was merely
rate-limited (not lacking data) would show "No reported quarters yet" for
hours instead of minutes.
"""
from datetime import timedelta
from unittest import mock

from api.routers import calendar as cal_mod


def _past_weekday_iso() -> str:
    """A genuine past weekday within the ±14-day compute window, regardless
    of what day the suite happens to run on (mirrors the existing pattern in
    test_calendar_enrichment.py::test_enrichment_skips_implied_move_for_past_dates)."""
    past = cal_mod._today_et() - timedelta(days=3)
    while past.weekday() >= 5:
        past -= timedelta(days=1)
    return past.isoformat()


def _day(syms):
    return {"bmo": [{"sym": s} for s in syms], "amc": [], "tbd": []}


def _run_build(ds: str, denied_sequence: list[int]):
    """Run `_build_enrichment_for_date` with every provider mocked out except
    `fh_budget_denied_total`, scripted via `denied_sequence` (consumed in
    call order: [before_fanout, after_fanout]). Returns the list of
    (key, value, ttl) tuples passed to cache.set."""
    denied_iter = iter(denied_sequence)

    with mock.patch("api.routers.calendar.cache") as mock_cache, \
         mock.patch.object(cal_mod, "_days_for_date", return_value=_day(["AAA", "BBB", "CCC"])), \
         mock.patch("api.services.earnings_estimates.get_earnings_intel",
                    return_value={"beat_history": []}), \
         mock.patch("api.services.earnings_estimates.fh_budget_denied_total",
                    side_effect=lambda: next(denied_iter)), \
         mock.patch("api.services.engine._fetch_quarterly_history", return_value=[]), \
         mock.patch("api.services.earnings_enrichment.get_historical_earnings_moves",
                    return_value=None):
        mock_cache.get.return_value = None
        cal_mod._build_enrichment_for_date(ds)
        # Normalize: cache.set(key, value, ttl=...) — extract (key, ttl) pairs.
        out = []
        for c in mock_cache.set.call_args_list:
            key = c.args[0]
            ttl = c.kwargs.get("ttl", c.args[2] if len(c.args) > 2 else None)
            out.append((key, ttl))
    return out


def test_throttled_build_uses_the_short_ttl_on_a_past_date():
    ds = _past_weekday_iso()
    set_calls = _run_build(ds, denied_sequence=[3, 9])  # denials rose during the fan-out
    matches = [ttl for key, ttl in set_calls if key == f"calendar_enrichment_{ds}"]
    assert len(matches) == 1
    ttl = matches[0]
    assert ttl == cal_mod._ENRICH_TTL
    assert ttl < cal_mod._ENRICH_TTL_PAST
    assert cal_mod._ENRICH_STATS[ds]["throttled"] is True


def test_a_clean_build_keeps_the_normal_long_ttl_on_a_past_date():
    ds = _past_weekday_iso()
    set_calls = _run_build(ds, denied_sequence=[7, 7])  # no denials during the fan-out
    matches = [ttl for key, ttl in set_calls if key == f"calendar_enrichment_{ds}"]
    assert len(matches) == 1
    ttl = matches[0]
    assert ttl == cal_mod._ENRICH_TTL_PAST
    assert cal_mod._ENRICH_STATS[ds]["throttled"] is False
