"""Finviz Elite as the past-day SESSION source.

The other two backfill legs are weakest exactly here: FMP carries no session
field at all, so every FMP-only symbol lands in `tbd` by construction, and
~10% of Finnhub's past rows have a blank `hour`. Both render "Time TBD" for a
report whose session is perfectly well known.

Fixtures are real shapes from the live export, captured 2026-08-06.
"""
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
