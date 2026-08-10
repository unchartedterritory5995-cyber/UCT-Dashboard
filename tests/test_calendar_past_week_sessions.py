"""Sessions must not DECAY when a week stops being the current week.

The coverage monitor read `calendar_hour_resolved` at 18% on 2026-08-09 and it
was telling the truth: paging back one week, every day showed `tbd` pinned at
exactly 40 while bmo+amc trailed off 26% -> 13% across the week. Next week read
100%.

The cause is that a past day is served by two different builders depending on
which week it currently belongs to:

  past day of the CURRENT week   `_backfill_past_days`  cap 150, re-buckets
  same day once the week rolls   `_build_range_week`    cap  40, add-only

Neither half of that difference was intended for a FINISHED day. This file's
own source says so:
  * `_PAST_SESSION_CAP = 150` exists because "the 40 bounds a forward SCHEDULE
    where EW's anticipation rank decides who matters; truncating a day that
    already happened just hides reporters".
  * `rebucket=False` is not an independent choice — its docstring states it is
    a CONSEQUENCE of the tight cap ("moving rows into bmo/amc can push those
    buckets past their limit and the surplus is CUT"), and that the
    current-week path re-buckets safely precisely "because its cap is 150".

So the fix is to decide both by whether the DAY is finished, not by which
builder happened to run. Per-day, never per-week: on a weekend the "current
week" already points forward, so the week containing today is itself paged.
"""
from datetime import date, timedelta

import pytest

from api.routers import calendar as cal


MONDAY = date(2026, 8, 3)
WEEK = [MONDAY + timedelta(days=i) for i in range(5)]   # Mon..Fri
MIDWEEK = date(2026, 8, 5)                              # Wed: Mon/Tue past, Thu/Fri future


def _rows_for(ds, n, hour=""):
    return [{"symbol": f"S{i:03d}", "date": ds, "hour": hour,
             "epsEstimate": 1.0, "epsActual": None,
             "revenueEstimate": None, "revenueActual": None}
            for i in range(n)]


@pytest.fixture
def _stubbed(monkeypatch):
    """Every provider + decoration stubbed; only the cap/rebucket logic is live."""
    monkeypatch.setattr(cal, "_today_et", lambda: MIDWEEK)
    monkeypatch.setattr(cal, "_load_cap_universe", lambda: set())
    monkeypatch.setattr(cal, "_fmp_range_week", lambda a, b: [])
    monkeypatch.setattr(cal, "_curate_econ_events", lambda *a, **kw: None)
    monkeypatch.setattr(cal, "_attach_names", lambda days: None)
    monkeypatch.setattr(cal, "_attach_date_moves", lambda days: None)
    monkeypatch.setattr(cal, "_is_us_symbol", lambda s: True)


def _build(monkeypatch, fh_rows, finviz_sessions=None):
    monkeypatch.setattr(cal, "_fh_get_month",
                        lambda a, b: {"earningsCalendar": fh_rows})
    monkeypatch.setattr(cal, "_fetch_finviz_past_sessions",
                        lambda target_ds, filt: dict(finviz_sessions or {}))
    return cal._build_range_week(MONDAY)


class TestPastDaysAreNotTruncatedLikeASchedule:
    def test_a_finished_day_keeps_the_loose_past_cap(self, _stubbed, monkeypatch):
        """60 reporters on a day that already happened must all survive. The
        40-cap ranks a forward schedule by anticipation; a finished day has no
        anticipation left to rank, so cutting it just hides who reported."""
        out = _build(monkeypatch, _rows_for("2026-08-03", 60))
        tbd = out["days"]["2026-08-03"]["tbd"]
        assert len(tbd) == 60, f"finished day truncated to {len(tbd)}"
        assert len(tbd) <= cal._PAST_SESSION_CAP

    def test_a_future_day_in_the_same_week_keeps_the_tight_schedule_cap(self, _stubbed, monkeypatch):
        """CONTROL, in the SAME build call as the test above — so 'the cap was
        just removed everywhere' cannot pass. Thursday is still a forward
        schedule and stays bounded at 40."""
        out = _build(monkeypatch, _rows_for("2026-08-03", 60) + _rows_for("2026-08-06", 60))
        assert len(out["days"]["2026-08-03"]["tbd"]) == 60   # past  -> loose
        assert len(out["days"]["2026-08-06"]["tbd"]) == 40   # future -> tight


class TestPastDaysResolveTheirSessions:
    def test_finviz_moves_a_finished_day_out_of_time_tbd(self, _stubbed, monkeypatch):
        """THE WIRE TEST. Finnhub returned this symbol with a blank `hour`, so
        it landed in tbd; Finviz knows it reported before the open. On a
        finished day that session must be applied — this is the 18%-vs-100%
        difference the user actually sees on the page."""
        out = _build(monkeypatch, _rows_for("2026-08-03", 1),
                     finviz_sessions={"2026-08-03": {"S000": "bmo"}})
        day = out["days"]["2026-08-03"]
        assert [e["sym"] for e in day["bmo"]] == ["S000"]
        assert day["tbd"] == []

    def test_a_future_day_is_still_add_only(self, _stubbed, monkeypatch):
        """CONTROL. A future day's bucket is the live schedule's to own, and
        its tight cap makes re-bucketing lossy — so a session for a day that
        has not happened must NOT move an existing row."""
        out = _build(monkeypatch, _rows_for("2026-08-06", 1),
                     finviz_sessions={"2026-08-06": {"S000": "bmo"}})
        day = out["days"]["2026-08-06"]
        assert [e["sym"] for e in day["tbd"]] == ["S000"]
        assert day["bmo"] == []

    def test_finviz_still_ADDS_a_symbol_on_a_future_day(self, _stubbed, monkeypatch):
        """Add-only means add-only, not skip: a name no other provider carried
        must still appear on a future day. Without this, 'future days ignore
        Finviz entirely' would pass the control above."""
        out = _build(monkeypatch, [], finviz_sessions={"2026-08-06": {"NEW": "amc"}})
        assert [e["sym"] for e in out["days"]["2026-08-06"]["amc"]] == ["NEW"]


class TestTheCurrentWeekPathIsUnchanged:
    def test_merge_defaults_to_rebucketing_everything(self):
        """`_backfill_past_days` calls the shared merge with no restriction and
        must keep re-bucketing every date it is given -- the range path's
        narrowing must not leak into it via a changed default."""
        import inspect
        sig = inspect.signature(cal._merge_finviz_sessions)
        param = sig.parameters.get("rebucket_ds")
        assert param is not None, "expected the merge to take a rebucket_ds set"
        assert param.default is None, (
            "default must mean 'every date may re-bucket' so the current-week "
            f"caller is unaffected; got {param.default!r}")
