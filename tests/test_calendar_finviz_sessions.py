"""Finviz Elite as the past-day SESSION source.

The other two backfill legs are weakest exactly here: FMP carries no session
field at all, so every FMP-only symbol lands in `tbd` by construction, and
~10% of Finnhub's past rows have a blank `hour`. Both render "Time TBD" for a
report whose session is perfectly well known.

Fixtures are real shapes from the live export, captured 2026-08-06.
"""
import time

import pytest

from api.routers import calendar as cal


class _Resp:
    def __init__(self, text, ok=True, status_code=200):
        self.text, self.ok, self.status_code = text, ok, status_code


# Two date formats in ONE live response, and a row with no time at all.
CSV = (
    "No.,Ticker,Earnings Date\n"
    "1,AAA,8/5/2026 4:30:00 PM\n"      # unpadded, AMC sentinel
    "2,BBB,08/05/2026 8:30:00 AM\n"    # ZERO-PADDED — dropped by a naive match
    "3,CCC,8/5/2026\n"                 # no time -> unknowable session
    "4,DDD,8/4/2026 4:30:00 PM\n"
    "5,EEE,8/9/2026 8:30:00 AM\n"      # outside the requested days
)


@pytest.fixture
def fv(monkeypatch):
    monkeypatch.setenv("FINVIZ_API_KEY", "tok")
    monkeypatch.setattr("requests.get", lambda *a, **k: _Resp(CSV))
    return cal


class TestFetch:
    def test_parses_both_date_formats(self, fv):
        out = fv._fetch_finviz_past_sessions({"2026-08-04", "2026-08-05"})
        assert out["2026-08-05"]["AAA"] == "amc"
        assert out["2026-08-05"]["BBB"] == "bmo", "zero-padded date was dropped"
        assert out["2026-08-04"]["DDD"] == "amc"

    def test_a_row_with_no_time_yields_no_session(self, fv):
        """Better a member sees Time TBD than a guessed session."""
        assert "CCC" not in fv._fetch_finviz_past_sessions({"2026-08-05"})["2026-08-05"]

    def test_days_outside_the_request_are_ignored(self, fv):
        out = fv._fetch_finviz_past_sessions({"2026-08-05"})
        assert set(out) == {"2026-08-05"}
        assert all("EEE" not in v for v in out.values())

    def test_no_token_means_no_call_at_all(self, monkeypatch):
        monkeypatch.delenv("FINVIZ_API_KEY", raising=False)
        monkeypatch.delenv("FINVIZ_TOKEN", raising=False)
        def boom(*a, **k):
            raise AssertionError("must not hit the network without a token")
        monkeypatch.setattr("requests.get", boom)
        assert cal._fetch_finviz_past_sessions({"2026-08-05"}) == {}

    def test_a_provider_failure_is_silent(self, monkeypatch):
        monkeypatch.setenv("FINVIZ_API_KEY", "tok")
        monkeypatch.setattr("requests.get", lambda *a, **k: _Resp("", ok=False, status_code=403))
        assert cal._fetch_finviz_past_sessions({"2026-08-05"}) == {}
        def boom(*a, **k):
            raise RuntimeError("network down")
        monkeypatch.setattr("requests.get", boom)
        assert cal._fetch_finviz_past_sessions({"2026-08-05"}) == {}

    def test_session_is_a_threshold_not_an_equality(self, monkeypatch):
        """Finviz encodes the session as a SENTINEL clock time (8:30/4:30).
        Matching those exact strings would silently mislabel every row the day
        the sentinel changes; a threshold degrades to tbd instead."""
        monkeypatch.setenv("FINVIZ_API_KEY", "tok")
        monkeypatch.setattr("requests.get", lambda *a, **k: _Resp(
            "No.,Ticker,Earnings Date\n"
            "1,PRE,8/5/2026 7:00:00 AM\n"      # still pre-open
            "2,POST,8/5/2026 6:45:00 PM\n"     # still post-close
            "3,MID,8/5/2026 12:00:00 PM\n"     # intraday — not a session
        ))
        out = cal._fetch_finviz_past_sessions({"2026-08-05"})["2026-08-05"]
        assert out["PRE"] == "bmo"
        assert out["POST"] == "amc"
        assert "MID" not in out


class TestMergeLeg:
    """The leg must FILL a missing session, never override a known one."""

    def _day(self):
        return {"bmo": [], "amc": [], "tbd": []}

    def test_moves_a_tbd_entry_into_its_real_session(self, fv, monkeypatch):
        entry = {"sym": "AAA", "eps_est": 1.0, "ew": 0}
        days = {"2026-08-05": {"bmo": [], "amc": [], "tbd": [entry]}}
        from datetime import date
        monkeypatch.setattr(cal, "_fh_get_month", lambda a, b: {"earningsCalendar": []})
        monkeypatch.setattr(cal, "_fmp_range_week", lambda a, b: [])
        cal._backfill_past_days(days, [date(2026, 8, 5), date(2026, 8, 6)],
                                date(2026, 8, 6), None)
        assert days["2026-08-05"]["tbd"] == []
        assert [e["sym"] for e in days["2026-08-05"]["amc"]] == ["AAA"]
        # The entry OBJECT moved — its estimates came along, not a fresh stub.
        assert days["2026-08-05"]["amc"][0]["eps_est"] == 1.0

    def test_finnhub_session_is_not_overridden(self, fv, monkeypatch):
        """AAA is AMC per Finviz; Finnhub already placed it BMO. Finnhub wins —
        this leg is redundancy for a GAP, not a second opinion."""
        entry = {"sym": "AAA", "ew": 0}
        days = {"2026-08-05": {"bmo": [entry], "amc": [], "tbd": []}}
        from datetime import date
        monkeypatch.setattr(cal, "_fh_get_month", lambda a, b: {"earningsCalendar": []})
        monkeypatch.setattr(cal, "_fmp_range_week", lambda a, b: [])
        cal._backfill_past_days(days, [date(2026, 8, 5), date(2026, 8, 6)],
                                date(2026, 8, 6), None)
        # AAA STAYS where Finnhub put it. (BBB also lands in bmo — it is a
        # legitimate ADD from the same leg, and asserting the exact bucket
        # contents here conflated "did not override" with "added nothing".)
        assert "AAA" in [e["sym"] for e in days["2026-08-05"]["bmo"]]
        assert "AAA" not in [e["sym"] for e in days["2026-08-05"]["amc"]]
        # And exactly once overall — no duplicate row for the same report.
        all_syms = [e["sym"] for e in cal._day_entries(days["2026-08-05"])]
        assert all_syms.count("AAA") == 1
        # The REST of the leg still ran. Without the `existing in tbd` guard,
        # re-bucketing a symbol that is NOT in tbd raises ValueError out of
        # list.remove, and the function's outer except swallows it — aborting
        # every remaining symbol. Asserting only "AAA did not move" passes
        # under that bug, because the abort happens before anything moves.
        assert "BBB" in all_syms, "the leg aborted after the first symbol"

    def test_adds_a_symbol_neither_other_leg_had(self, fv, monkeypatch):
        days = {"2026-08-05": self._day()}
        from datetime import date
        monkeypatch.setattr(cal, "_fh_get_month", lambda a, b: {"earningsCalendar": []})
        monkeypatch.setattr(cal, "_fmp_range_week", lambda a, b: [])
        added = cal._backfill_past_days(days, [date(2026, 8, 5), date(2026, 8, 6)],
                                        date(2026, 8, 6), None)
        assert added >= 2
        syms = {e["sym"] for e in cal._day_entries(days["2026-08-05"])}
        assert {"AAA", "BBB"} <= syms


class TestFinvizNameMap:
    """Company names came only from ticker_meta, whose miss path is a 2-worker
    pool capped at 24 in flight. On a finished day carrying 400+ reporters most
    symbols miss, so cards rendered nameless for many requests running. Finviz
    returns the whole market's Ticker/Company/Sector in ONE export (11,556
    tickers, measured 0.89s).

    That call is NEVER made inline: `_fetch_finviz_universe` carries a 90s
    timeout and this runs on the request path of a single-process uvicorn with
    one shared threadpool — the unbounded-external-call shape behind the
    2026-07-01 524 outage. Cold returns {} and warms in the background.
    """

    UNIVERSE = [
        {"Ticker": "AAA", "Company": "Alpha Corp", "Sector": "Technology"},
        {"Ticker": "BBB", "Company": "Beta Inc", "Sector": "Healthcare"},
        {"Ticker": "CCC", "Company": "", "Sector": ""},          # blank both
    ]

    @pytest.fixture(autouse=True)
    def _clear(self):
        from api.services.cache import cache
        cache.invalidate("finviz_name_map")
        cal._FV_NAME_INFLIGHT = False
        yield
        cache.invalidate("finviz_name_map")
        cal._FV_NAME_INFLIGHT = False

    def _seed(self, monkeypatch, universe=None):
        """Put a resolved map in the cache without touching the network."""
        from api.services.cache import cache
        monkeypatch.setattr("api.services.industry_map._fetch_finviz_universe",
                            lambda: self.UNIVERSE if universe is None else universe)
        built = cal._build_finviz_name_map()
        if built:
            cache.set("finviz_name_map", built, ttl=60)
        return built

    def test_builds_a_map_and_skips_blank_rows(self, monkeypatch):
        m = self._seed(monkeypatch)
        assert m["AAA"] == {"name": "Alpha Corp", "sector": "Technology"}
        assert "CCC" not in m, "a row with neither name nor sector is not an answer"

    def test_the_cold_call_never_blocks_and_returns_empty(self, monkeypatch):
        """The load-bearing property: a calendar build must not wait on Finviz."""
        started = []
        monkeypatch.setattr(cal, "_warm_finviz_name_map", lambda: started.append(1))
        assert cal._finviz_name_map() == {}
        assert started == [1], "the cold path did not kick a background warm"

    def test_the_warm_thread_populates_the_cache(self, monkeypatch):
        monkeypatch.setattr("api.services.industry_map._fetch_finviz_universe",
                            lambda: self.UNIVERSE)
        cal._warm_finviz_name_map()
        for _ in range(100):
            if cal._finviz_name_map():
                break
            time.sleep(0.02)
        assert cal._finviz_name_map()["AAA"]["name"] == "Alpha Corp"

    def test_an_empty_result_is_never_cached(self, monkeypatch):
        """THE realistic failure: `_fetch_finviz_universe` swallows its own
        errors and returns [] — it does not raise. Caching that for 24h would
        blank every card for a day, far worse than the miss it avoids."""
        from api.services.cache import cache
        monkeypatch.setattr("api.services.industry_map._fetch_finviz_universe", lambda: [])
        cal._warm_finviz_name_map()
        time.sleep(0.15)
        assert cache.get("finviz_name_map") is None, "an empty result was cached"

    def test_a_raised_failure_also_yields_nothing(self, monkeypatch):
        from api.services.cache import cache
        def boom():
            raise RuntimeError("finviz down")
        monkeypatch.setattr("api.services.industry_map._fetch_finviz_universe", boom)
        assert cal._build_finviz_name_map() == {}
        cal._warm_finviz_name_map()
        time.sleep(0.15)
        assert cache.get("finviz_name_map") is None

    def test_only_one_warm_runs_at_a_time(self, monkeypatch):
        """Without the in-flight flag every build in the ~1s cold window starts
        its OWN whole-market fetch — a self-inflicted herd on the very surface
        this keeps off the request path."""
        calls = []
        def slow():
            calls.append(1)
            time.sleep(0.3)
            return self.UNIVERSE
        monkeypatch.setattr("api.services.industry_map._fetch_finviz_universe", slow)
        for _ in range(5):
            cal._warm_finviz_name_map()
        time.sleep(0.5)
        assert len(calls) == 1, f"{len(calls)} concurrent whole-market fetches"

    def test_fills_a_name_ticker_meta_does_not_have(self, monkeypatch):
        self._seed(monkeypatch)
        monkeypatch.setattr("api.services.ticker_meta._mem", {})
        monkeypatch.setattr("api.services.ticker_meta._disk_get", lambda s: None)
        days = {"2026-08-05": {"bmo": [{"sym": "AAA"}], "amc": [], "tbd": []}}
        cal._attach_names(days)
        e = days["2026-08-05"]["bmo"][0]
        assert e["name"] == "Alpha Corp"
        assert e["sector"] == "Technology"

    def test_ticker_meta_still_wins(self, monkeypatch):
        """Finviz FILLS a gap; it does not override the richer source."""
        self._seed(monkeypatch)
        monkeypatch.setattr("api.services.ticker_meta._mem",
                            {"tmeta_AAA": {"name": "Alpha Corporation Inc.", "sector": "Tech"}})
        monkeypatch.setattr("api.services.ticker_meta._disk_get", lambda s: None)
        days = {"2026-08-05": {"bmo": [{"sym": "AAA"}], "amc": [], "tbd": []}}
        cal._attach_names(days)
        assert days["2026-08-05"]["bmo"][0]["name"] == "Alpha Corporation Inc."

    def test_a_name_already_on_the_entry_is_not_overwritten(self, monkeypatch):
        """An entry can arrive already carrying a name from the wire/EW data.
        ticker_meta may still miss it, which drops through to the Finviz block —
        and Finviz's short-form name must not clobber the one already there."""
        self._seed(monkeypatch)
        monkeypatch.setattr("api.services.ticker_meta._mem", {})
        monkeypatch.setattr("api.services.ticker_meta._disk_get", lambda s: None)
        days = {"2026-08-05": {"bmo": [{"sym": "AAA", "name": "Alpha Corp (wire)"}],
                               "amc": [], "tbd": []}}
        cal._attach_names(days)
        assert days["2026-08-05"]["bmo"][0]["name"] == "Alpha Corp (wire)"
        assert days["2026-08-05"]["bmo"][0]["sector"] == "Technology"

    def test_an_unknown_symbol_still_reaches_the_async_queue(self, monkeypatch):
        """Finviz must not swallow the existing fallback for names it lacks."""
        self._seed(monkeypatch)
        monkeypatch.setattr("api.services.ticker_meta._mem", {})
        monkeypatch.setattr("api.services.ticker_meta._disk_get", lambda s: None)
        queued = []
        monkeypatch.setattr(cal._NAME_POOL, "submit",
                            lambda fn, *a, **k: queued.append(a[0] if a else None))
        days = {"2026-08-05": {"bmo": [{"sym": "ZZZ"}], "amc": [], "tbd": []}}
        cal._attach_names(days)
        assert days["2026-08-05"]["bmo"][0].get("name") is None
        assert "ZZZ" in cal._NAME_INFLIGHT or queued, "the async fallback was bypassed"


class TestPastWeekLeg:
    """`_backfill_past_days` gave the CURRENT week a third source; past weeks
    had the identical Finnhub-outage exposure. A past week is pure history, so
    an empty one is simply WRONG rather than merely early.
    """

    def test_filter_picks_this_week_prev_week_or_nothing(self):
        from datetime import date
        today = date(2026, 8, 6)          # Thursday
        this_mon, prev_mon = date(2026, 8, 3), date(2026, 7, 27)
        assert cal._finviz_week_filter(this_mon, today) == "earningsdate_thisweek"
        assert cal._finviz_week_filter(prev_mon, today) == "earningsdate_prevweek"
        # Finviz exposes NO arbitrary range. Older weeks must return None so the
        # caller skips — an unrecognised filter token is DROPPED silently by
        # Finviz, which would quietly serve the WRONG week rather than error.
        assert cal._finviz_week_filter(date(2026, 7, 20), today) is None
        assert cal._finviz_week_filter(date(2026, 8, 10), today) is None   # future

    def test_a_far_past_week_makes_no_finviz_call(self, monkeypatch):
        def boom(*a, **k):
            raise AssertionError("must not request a week Finviz cannot serve")
        monkeypatch.setattr("requests.get", boom)
        monkeypatch.setenv("FINVIZ_API_KEY", "tok")
        from datetime import date
        assert cal._finviz_week_filter(date(2025, 1, 6), date(2026, 8, 6)) is None

    def test_shared_merge_adds_and_rebuckets(self, fv):
        days = {"2026-08-05": {"bmo": [], "amc": [],
                               "tbd": [{"sym": "AAA", "eps_est": 2.0}]}}
        added, moved = cal._merge_finviz_sessions(
            days, {"2026-08-05"}, "earningsdate_thisweek", lambda s: True, {})
        assert moved == 1 and added >= 1
        assert [e["sym"] for e in days["2026-08-05"]["amc"]] == ["AAA"]
        assert days["2026-08-05"]["amc"][0]["eps_est"] == 2.0   # the object moved
        assert days["2026-08-05"]["tbd"] == []

    def test_shared_merge_never_duplicates_a_known_symbol(self, fv):
        days = {"2026-08-05": {"bmo": [{"sym": "AAA"}], "amc": [], "tbd": []}}
        cal._merge_finviz_sessions(days, {"2026-08-05"}, "earningsdate_thisweek",
                                   lambda s: True, {})
        syms = [e["sym"] for e in cal._day_entries(days["2026-08-05"])]
        assert syms.count("AAA") == 1
        assert "AAA" in [e["sym"] for e in days["2026-08-05"]["bmo"]]

    def test_shared_merge_honours_the_universe_filter(self, fv):
        days = {"2026-08-05": {"bmo": [], "amc": [], "tbd": []}}
        added, _ = cal._merge_finviz_sessions(
            days, {"2026-08-05"}, "earningsdate_thisweek", lambda s: s == "AAA", {})
        assert added == 1
        assert [e["sym"] for e in cal._day_entries(days["2026-08-05"])] == ["AAA"]

    def test_shared_merge_never_raises(self, monkeypatch):
        monkeypatch.setenv("FINVIZ_API_KEY", "tok")
        def boom(*a, **k):
            raise RuntimeError("finviz down")
        monkeypatch.setattr("requests.get", boom)
        days = {"2026-08-05": {"bmo": [], "amc": [], "tbd": []}}
        assert cal._merge_finviz_sessions(days, {"2026-08-05"},
                                          "earningsdate_thisweek", lambda s: True, {}) == (0, 0)

    def test_rebucket_false_adds_without_moving(self, fv):
        """The range week's cap is a tight [:40] applied AFTER this merge, so
        moving rows into bmo/amc pushes them past it and the surplus is CUT —
        measured, 66 reporters lost to gain 8 sessions."""
        days = {"2026-08-05": {"bmo": [], "amc": [],
                               "tbd": [{"sym": "AAA", "eps_est": 2.0}]}}
        added, moved = cal._merge_finviz_sessions(
            days, {"2026-08-05"}, "earningsdate_thisweek", lambda s: True, {},
            rebucket=False)
        assert moved == 0
        assert [e["sym"] for e in days["2026-08-05"]["tbd"]] == ["AAA"]
        assert added >= 1                      # BBB still gets added
        assert "BBB" in [e["sym"] for e in cal._day_entries(days["2026-08-05"])]

    def test_rebucket_default_is_on(self, fv):
        days = {"2026-08-05": {"bmo": [], "amc": [], "tbd": [{"sym": "AAA"}]}}
        _, moved = cal._merge_finviz_sessions(
            days, {"2026-08-05"}, "earningsdate_thisweek", lambda s: True, {})
        assert moved == 1, "the current-week path must still re-bucket"


class TestRefreshCacheTtl:
    """`POST /api/calendar/refresh` was the ONE calendar_weekly write bypassing
    set_by_completeness. An admin hitting refresh during a provider outage
    rebuilt a degraded week and PINNED it for the full 10-minute TTL — the one
    moment someone is actively trying to fix the calendar is the worst moment
    to make a bad answer stick.
    """

    def test_a_degraded_refresh_gets_the_short_ttl(self, monkeypatch):
        seen = {}
        monkeypatch.setattr(cal, "_weekly_payload_is_good", lambda r: False)
        monkeypatch.setattr(cal, "set_by_completeness",
                            lambda k, v, **kw: seen.update(kw))
        remembered = []
        monkeypatch.setattr(cal._WEEKLY_STALE, "remember",
                            lambda *a: remembered.append(a))
        self._run_refresh(monkeypatch)
        assert seen["complete"] is False
        assert seen["ttl_partial"] == cal._CACHE_FAIL_TTL == 60
        assert not remembered, "a degraded week must not become the stale fallback"

    def test_a_good_refresh_gets_the_full_ttl_and_the_stale_slot(self, monkeypatch):
        seen = {}
        monkeypatch.setattr(cal, "_weekly_payload_is_good", lambda r: True)
        monkeypatch.setattr(cal, "set_by_completeness",
                            lambda k, v, **kw: seen.update(kw))
        remembered = []
        monkeypatch.setattr(cal._WEEKLY_STALE, "remember",
                            lambda *a: remembered.append(a))
        self._run_refresh(monkeypatch)
        assert seen["complete"] is True
        assert seen["ttl_ok"] == cal._CACHE_TTL
        assert remembered, "a good refresh must seed the stale fallback"

    def _run_refresh(self, monkeypatch):
        """Drive refresh_calendar with every provider stubbed out."""
        monkeypatch.setattr(cal, "_build_live", lambda *a, **k: {})
        monkeypatch.setattr(cal, "_patch_today_actuals", lambda *a, **k: None)
        monkeypatch.setattr(cal, "_merge_sticky_actuals", lambda *a, **k: None)
        monkeypatch.setattr(cal, "_curate_econ_events", lambda *a, **k: None)
        monkeypatch.setattr(cal, "_attach_names", lambda *a, **k: None)
        monkeypatch.setattr(cal, "_attach_date_moves", lambda *a, **k: None)
        cal.refresh_calendar(user={"role": "admin"})
