"""`calendar_forward_multisource` — the tripwire under the 2026-08-16 fix.

The current week's still-future days were served from EarningsWhispers ONLY,
while every other week merged Finnhub + FMP + Finviz across all five days. BABA,
BIDU, KLAR and FUTU were absent from the week of Aug 17 for exactly that reason.

⭐ **The reason this field has to exist at all: a single-source week is
invisible.** Nothing 500s, nothing blanks, no other field here moves — the
calendar just looks like a quiet week. The only way to see it is to ask whether
the merge contributed anything, which is what this measures.

The denominator comes from the CALENDAR (`_days_for_date`), never from the
merge's own report, so an unwired merge reads 0% ("blank" — always alerts)
instead of `sample=0` "not measured". A rail its own subject can silence by
dying is not a rail.
"""
import importlib
from datetime import date, timedelta

import pytest

MON = date(2026, 8, 17)
WEEK = [MON + timedelta(days=i) for i in range(5)]
SUNDAY = date(2026, 8, 16)          # the day of the report: all five still ahead


def _mod():
    import api.services.provider_coverage_monitor as pcm
    importlib.reload(pcm)
    return pcm


@pytest.fixture
def pcm():
    return _mod()


def _pin(monkeypatch, *, served: dict, report: dict):
    """`served` = {iso: n reporters the calendar shows}. `report` = what the
    merge wrote to `_LAST_LIVE_COVERAGE['days']`."""
    from api.routers import calendar as cal
    monkeypatch.setattr(cal, "_week_dates", lambda: WEEK)
    monkeypatch.setattr(
        cal, "_days_for_date",
        lambda ds: ({"bmo": [{"sym": f"S{i}"} for i in range(served[ds])],
                     "amc": [], "tbd": []} if ds in served else None))
    monkeypatch.setattr(cal, "_LAST_LIVE_COVERAGE", {"days": report}, raising=False)


ALL_FIVE = {d.isoformat(): 12 for d in WEEK}


def test_a_merged_week_reads_one_hundred_percent(pcm, monkeypatch):
    _pin(monkeypatch, served=ALL_FIVE,
         report={d.isoformat(): {"served": 12, "schedule_only": 7} for d in WEEK})
    assert pcm._calendar_forward_multisource_rate(today=SUNDAY) == \
        {"observed": 1.0, "sample": 5}


def test_an_unwired_merge_reads_blank_not_unmeasured(pcm, monkeypatch):
    """THE case. The merge writes nothing, the calendar still serves the
    schedule's names — that must be 0%, which `_evaluate_field` always
    flags, and never `sample=0`, which it silently ignores."""
    _pin(monkeypatch, served=ALL_FIVE, report={})
    r = pcm._calendar_forward_multisource_rate(today=SUNDAY)
    assert r == {"observed": 0.0, "sample": 5}
    d = pcm._evaluate_field("calendar_forward_multisource", r["observed"], r["sample"],
                            baseline=None, provider_moved=False)
    assert d is not None and d["kind"] == "blank"


def test_a_week_the_merge_only_half_reached_breaches_the_floor(pcm, monkeypatch):
    """The floor is 1.0: every still-future day with reporters is supposed to
    have been through the merge, so a partial week is already the defect."""
    report = {d.isoformat(): {"served": 12, "schedule_only": 7} for d in WEEK[:2]}
    report.update({d.isoformat(): {"served": 7, "schedule_only": 7} for d in WEEK[2:]})
    _pin(monkeypatch, served=ALL_FIVE, report=report)
    r = pcm._calendar_forward_multisource_rate(today=SUNDAY)
    assert r == {"observed": 0.4, "sample": 5}
    d = pcm._evaluate_field("calendar_forward_multisource", r["observed"], r["sample"],
                            baseline=None, provider_moved=False)
    assert d is not None and d["kind"] == "floor_breach" and d["floor"] == 1.0


def test_days_with_no_reporters_leave_the_denominator(pcm, monkeypatch):
    """A holiday, or a dead August Friday. A quiet week must report "not
    measured", not cry wolf — the whole point of the (None, 0) contract."""
    served = {WEEK[0].isoformat(): 9, WEEK[1].isoformat(): 0,
              WEEK[2].isoformat(): 0, WEEK[3].isoformat(): 0, WEEK[4].isoformat(): 0}
    _pin(monkeypatch, served=served,
         report={WEEK[0].isoformat(): {"served": 9, "schedule_only": 4}})
    assert pcm._calendar_forward_multisource_rate(today=SUNDAY) == \
        {"observed": 1.0, "sample": 1}


def test_a_completely_quiet_week_is_not_measured_and_never_a_defect(pcm, monkeypatch):
    _pin(monkeypatch, served={d.isoformat(): 0 for d in WEEK}, report={})
    r = pcm._calendar_forward_multisource_rate(today=SUNDAY)
    assert r == {"observed": None, "sample": 0}
    assert pcm._evaluate_field("calendar_forward_multisource", r["observed"], r["sample"],
                               baseline=None, provider_moved=False) is None


def test_a_cold_calendar_cache_is_not_measured(pcm, monkeypatch):
    """`_days_for_date` returns None on a cold cache. Measuring nothing must
    say so — this module never triggers a calendar build to fill it in."""
    _pin(monkeypatch, served={}, report={})
    assert pcm._calendar_forward_multisource_rate(today=SUNDAY) == \
        {"observed": None, "sample": 0}


def test_finished_days_of_the_week_are_out_of_scope(pcm, monkeypatch):
    """Mid-week, Mon/Tue belong to `_backfill_past_days`, which this field
    makes no claim about. Only today and later are counted."""
    _pin(monkeypatch, served=ALL_FIVE,
         report={d.isoformat(): {"served": 12, "schedule_only": 7} for d in WEEK[2:]})
    # today == Wednesday
    assert pcm._calendar_forward_multisource_rate(today=WEEK[2]) == \
        {"observed": 1.0, "sample": 3}


def test_the_field_is_registered_so_run_cycle_actually_evaluates_it(pcm):
    """lesson_built_tested_green_and_unreachable: a measurer nobody calls is
    not a monitor. `_FIELD_SPECS` is what `run_cycle` iterates."""
    assert "calendar_forward_multisource" in pcm._FIELD_SPECS
    spec = pcm._FIELD_SPECS["calendar_forward_multisource"]
    assert spec["floor"] == 1.0
    # A throttled Finnhub still leaves FMP and Finviz, so a 0% here is a WIRE
    # fault — it must never be excused as "provider_throttled".
    assert spec["finnhub_touching"] is False


def test_run_cycle_flags_the_forward_week_going_single_source(pcm, tmp_path, monkeypatch):
    """End to end through the orchestrator, with only this measurer unhealthy."""
    monkeypatch.setattr(pcm, "DB_PATH", str(tmp_path / "coverage_test.db"))
    monkeypatch.setattr(pcm, "_sample_tickers", lambda n: ["AAPL", "NVDA"])
    monkeypatch.setattr(pcm, "_intel_map", lambda syms: {
        s: {"price_target": {"x": 1}, "consensus": {"buy": 1},
            "beat_history": [1, 2, 3, 4]} for s in syms})
    monkeypatch.setattr(pcm, "_meta_map",
                        lambda syms: {s: {"name": "X", "industry": "Y"} for s in syms})
    monkeypatch.setattr(pcm, "_transcript_rate",
                        lambda syms: {"observed": None, "sample": 0, "missing": []})
    monkeypatch.setattr(pcm, "_analyst_actions_rate",
                        lambda syms: {"observed": 1.0, "sample": 8, "missing": []})
    monkeypatch.setattr(pcm, "_calendar_hour_rate", lambda: {"observed": 0.7, "sample": 100})
    monkeypatch.setattr(pcm, "_enrichment_with_em_rate", lambda: {"observed": 0.6, "sample": 200})
    monkeypatch.setattr(pcm, "_implied_fiscal_rate", lambda: {"observed": None, "sample": 0})
    monkeypatch.setattr(pcm, "_day_metrics_rate", lambda field: {"observed": 0.8, "sample": 50})
    monkeypatch.setattr(pcm, "_denial_snapshot", lambda: {"finnhub": 0, "alphavantage": None})
    _pin(monkeypatch, served=ALL_FIVE, report={})   # merge contributed nothing
    # Pin the clock at the call site, NOT by relying on the real date — the
    # measurer reads `datetime.now(_ET)`, so leaving it live makes this test
    # pass only while today happens to precede the pinned week (it did, on the
    # day it was written; that is a time bomb, not a test).
    real_rate = pcm._calendar_forward_multisource_rate
    monkeypatch.setattr(pcm, "_calendar_forward_multisource_rate",
                        lambda: real_rate(today=SUNDAY))
    pcm.run_cycle()

    flagged = {d["field"]: d for d in pcm.get_state()["defects_current"]}
    assert "calendar_forward_multisource" in flagged, \
        f"forward-week field not evaluated; flagged={sorted(flagged)}"
    assert flagged["calendar_forward_multisource"]["kind"] == "blank"
    assert flagged["calendar_forward_multisource"]["provider"] == "data_missing"
