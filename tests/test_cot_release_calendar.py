"""COT staleness follows CFTC's holiday-aware release calendar (owner live test 2026-11-13: the COT tab showed the
11-03 report as latest and flagged it STALE, but CFTC's schedule moves the 11-10 report to Monday 11-16 — Veterans Day,
Wednesday 11-11).

ORACLE: CFTC's own published 2026 release schedule (tests/fixtures/cftc_cot_release_schedule_2026.json, verbatim from
cftc.gov), every one of its 52 weeks and every day of the year at noon and after the 4:30 PM threshold. The code derives
every date by rule (cot_service._report_due_by → market_indicators.cot_release.rule_release_date + the econ federal
calendar); no release date is hard-coded in it. Also pinned: the refresh paths stop re-downloading on a holiday week, and
the fail direction (a calendar that cannot decide falls back to the every-Friday rule, which can only flag MORE stale).
"""
from __future__ import annotations

import json
import pathlib
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from api.services import cot_service as svc
from api.services.market_indicators import cot_release

ET = ZoneInfo("America/New_York")
FIXTURE = json.loads((pathlib.Path(__file__).parent / "fixtures" / "cftc_cot_release_schedule_2026.json").read_text(encoding="utf-8"))


def _releases():
    out = []
    for mm, days in FIXTURE["releases"].items():
        for dd in days:
            out.append((date(FIXTURE["year"], int(mm), int(dd.rstrip("*"))), dd.endswith("*")))
    return sorted(out)


RELEASES = _releases()


def _asof(rel: date) -> date:
    """CFTC: 'The release usually includes data from the previous Tuesday' — the Tuesday on or before the release."""
    return rel - timedelta(days=(rel.weekday() - 1) % 7)


def _at(d: date, hh: int, mm: int = 0) -> datetime:
    return datetime(d.year, d.month, d.day, hh, mm, tzinfo=ET)


def test_the_fixture_is_cftcs_whole_2026_schedule():
    assert len(RELEASES) == 52
    delayed = [r for r, star in RELEASES if star]
    assert [d.isoformat() for d in delayed] == ["2026-01-05", "2026-06-22", "2026-07-06", "2026-11-16", "2026-11-30", "2026-12-28"]
    assert all(r.weekday() == 0 for r in delayed)                       # every delayed release is a Monday
    assert all(r.weekday() == 4 for r, star in RELEASES if not star)    # every other release is a Friday


@pytest.mark.parametrize("rel,star", RELEASES, ids=[r.isoformat() for r, _ in RELEASES])
def test_every_2026_week_the_rule_gives_cftcs_release_date(rel, star):
    assert cot_release.rule_release_date(_asof(rel)) == rel


def test_every_day_of_2026_expects_exactly_the_report_cftc_had_published():
    first = RELEASES[0][0]
    d = first
    while d.year == 2026:
        for hh, mm in ((12, 0), (16, 29), (16, 30), (18, 0)):
            now = _at(d, hh, mm)
            published = [r for r, _ in RELEASES if r < d or (r == d and (hh, mm) >= (16, 30))]
            if not published:
                continue
            want = _asof(max(published))
            assert svc.expected_latest_report_date(now) == want, now.isoformat()
        d += timedelta(days=1)


def test_the_owner_case_veterans_day_week_is_not_stale_until_monday_1116():
    # Fri 11-13 after the threshold: CFTC has NOT published the 11-10 report (it comes Monday 11-16)
    assert svc.expected_latest_report_date(_at(date(2026, 11, 13), 18)) == date(2026, 11, 3)
    assert svc.expected_latest_report_date(_at(date(2026, 11, 15), 12)) == date(2026, 11, 3)
    assert svc.expected_latest_report_date(_at(date(2026, 11, 16), 16, 29)) == date(2026, 11, 3)
    assert svc.expected_latest_report_date(_at(date(2026, 11, 16), 16, 30)) == date(2026, 11, 10)
    # Thanksgiving: the 11-24 report comes Monday 11-30
    assert svc.expected_latest_report_date(_at(date(2026, 11, 27), 18)) == date(2026, 11, 17)
    assert svc.expected_latest_report_date(_at(date(2026, 11, 30), 17)) == date(2026, 11, 24)


def test_a_tuesday_holiday_moves_the_as_of_date_not_the_release():
    # 2025: Veterans Day on Tuesday 11-11 — CFTC's report was as of Monday 11-10, scheduled Friday 11-14
    # (market_indicators/cot_release_schedule.json); a store holding 11-10 is current that Friday evening
    assert svc.expected_latest_report_date(_at(date(2025, 11, 14), 17)) == date(2025, 11, 10)


def test_ordinary_weeks_are_unchanged_from_the_every_friday_rule():
    d = date(2026, 1, 1)
    differs = []
    while d.year == 2026:
        for hh in (12, 18):
            now = _at(d, hh)
            if svc.expected_latest_report_date(now) != svc._friday_rule_report_date(now):
                differs.append(now.date())
        d += timedelta(days=1)
    holiday_weeks = {r for r, star in RELEASES if star}
    # only the days between a holiday week's Friday and its delayed Monday release (inclusive) differ
    for x in differs:
        assert any(r - timedelta(days=3) <= x <= r for r in holiday_weeks), x
    assert differs                                                     # non-vacuous: the holiday weeks DO differ


def test_the_new_rule_is_never_later_than_the_old_one():
    # the change can only remove a false "stale"; it never expects a report the old rule would not have
    d = date(2025, 1, 1)
    while d < date(2027, 1, 1):
        for hh in (12, 18):
            now = _at(d, hh)
            assert svc.expected_latest_report_date(now) <= svc._friday_rule_report_date(now), now
        d += timedelta(days=1)


def test_fail_direction_a_calendar_that_cannot_decide_flags_stale_as_before(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("calendar unavailable")
    monkeypatch.setattr(cot_release, "rule_release_date", boom)
    now = _at(date(2026, 11, 13), 18)
    assert svc.expected_latest_report_date(now) == svc._friday_rule_report_date(now) == date(2026, 11, 10)


# ── the refresh paths stop re-downloading on a holiday week ──────────────────────────────────────────
class _Clock(datetime):
    NOW = None

    @classmethod
    def now(cls, tz=None):
        return cls.NOW.astimezone(tz) if tz else cls.NOW


@pytest.fixture()
def refresh(monkeypatch):
    calls = []
    monkeypatch.setattr(svc, "datetime", _Clock)
    monkeypatch.setattr(svc, "refresh_from_current", lambda: calls.append("download") or 1)
    monkeypatch.setattr(svc, "_LAST_AUTO_REFRESH_AT", None)

    class _T:
        def __init__(self, target=None, **kw):
            self.target = target

        def start(self):
            calls.append("self-heal")
    monkeypatch.setattr(svc.threading, "Thread", _T)
    return calls


def _store(monkeypatch, latest: str):
    monkeypatch.setattr(svc, "_latest_record_date", lambda: latest)


@pytest.mark.parametrize("hh,mm", [(16, 15), (16, 45)])
def test_the_friday_retries_skip_on_a_holiday_week(refresh, monkeypatch, hh, mm):
    _Clock.NOW = _at(date(2026, 11, 13), hh, mm)
    _store(monkeypatch, "2026-11-03")          # the newest report CFTC has published (11-10 is due Monday)
    assert svc.refresh_if_stale() == 0 and refresh == []


@pytest.mark.parametrize("hh,mm", [(16, 15), (16, 45)])
def test_the_friday_retries_still_download_a_missing_normal_week(refresh, monkeypatch, hh, mm):
    _Clock.NOW = _at(date(2026, 11, 6), hh, mm)
    _store(monkeypatch, "2026-10-27")          # the 11-03 report was due today and is missing
    assert svc.refresh_if_stale() == 1 and refresh == ["download"]
    refresh.clear()
    _store(monkeypatch, "2026-11-03")
    assert svc.refresh_if_stale() == 0 and refresh == []


def test_the_self_heal_does_not_fire_on_a_holiday_week_and_fires_after_the_monday_release(refresh, monkeypatch):
    _store(monkeypatch, "2026-11-03")
    for day, hh in ((date(2026, 11, 13), 18), (date(2026, 11, 14), 12), (date(2026, 11, 16), 12)):
        _Clock.NOW = _at(day, hh)
        svc._maybe_auto_refresh_if_stale()
    assert refresh == []
    _Clock.NOW = _at(date(2026, 11, 16), 17)
    svc._maybe_auto_refresh_if_stale()
    assert refresh == ["self-heal"]


def test_the_retry_falls_back_to_downloading_when_the_calendar_cannot_decide(refresh, monkeypatch):
    monkeypatch.setattr(svc, "_report_due_by", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
    _Clock.NOW = _at(date(2026, 11, 13), 16, 15)
    _store(monkeypatch, "2026-11-03")
    assert svc.refresh_if_stale() == 1 and refresh == ["download"]


# ── AUDIT T2 evidence: the 18:00 ET daily catch-up, OLD ("8+ days old") vs NEW (holiday-aware) firing days ─────────
def _old_catchup(latest: str, now: datetime) -> bool:
    """The api/main.py `_cot_daily_catchup` rule before this change, verbatim in effect: download when the newest stored
    report is 8 or more calendar days old."""
    return (now.date() - date.fromisoformat(latest)).days >= 8


def _published_asof(now: datetime) -> str:
    """What a download at `now` actually gets: CFTC's newest report by its PUBLISHED schedule (3:30 PM ET release)."""
    out = [r for r, _ in RELEASES if r < now.date() or (r == now.date() and (now.hour, now.minute) >= (15, 30))]
    return _asof(max(out)).isoformat()


def _simulate(rule, start_latest: str, first_day: date, monkeypatch) -> list[tuple[str, str, bool, str]]:
    """Fri → the following Thu at 18:00 ET over a simulated store: each download stores what CFTC had published."""
    state = {"latest": start_latest, "downloads": 0}
    monkeypatch.setattr(svc, "_latest_record_date", lambda: state["latest"])

    def download():
        state["downloads"] += 1
        state["latest"] = _published_asof(state["now"])
        return 1
    monkeypatch.setattr(svc, "refresh_from_current", download)
    rows = []
    for i in range(7):
        now = _at(first_day + timedelta(days=i), 18)
        state["now"] = now
        before = state["latest"]
        fired = svc.daily_catchup(now) if rule == "new" else (_old_catchup(before, now) and bool(download()))
        rows.append((now.strftime("%a %m-%d"), before, fired, state["latest"]))
    return rows


CATCHUP_CASES = {
    # (a) HOLIDAY week: Veterans Day Wed 11-11 moves the 11-10 report to Mon 11-16
    "holiday": ("2026-11-03", date(2026, 11, 13), {
        "old": ["Fri 11-13", "Sat 11-14", "Sun 11-15", "Mon 11-16", "Wed 11-18", "Thu 11-19"],
        "new": ["Mon 11-16"]}),
    # (b) NORMAL week: the 10-27 report released Fri 10-30
    "normal": ("2026-10-20", date(2026, 10, 30), {
        "old": ["Fri 10-30", "Wed 11-04", "Thu 11-05"],
        "new": ["Fri 10-30"]}),
}


@pytest.mark.parametrize("case", list(CATCHUP_CASES))
def test_the_daily_catchup_fires_only_when_cftc_has_published_something_new(case, monkeypatch, capsys):
    start, first, want = CATCHUP_CASES[case]
    table = {rule: _simulate(rule, start, first, monkeypatch) for rule in ("old", "new")}
    with capsys.disabled():
        print(f"\n[{case} week] 18:00 ET catch-up — day | store before | OLD downloads | NEW downloads")
        for o, n in zip(table["old"], table["new"]):
            print(f"  {o[0]} | {n[1]:>10} | {'DOWNLOAD' if o[2] else '-':>8} | {'DOWNLOAD' if n[2] else '-':>8}")
    for rule in ("old", "new"):
        assert [d for d, _b, fired, _a in table[rule] if fired] == want[rule], rule
    # the NEW rule ends the week holding the newest report CFTC published, exactly like the old one did
    assert table["new"][-1][3] == table["old"][-1][3]


def test_a_delayed_monday_release_is_fetched_that_monday_after_1630_by_the_catchup_and_the_self_heal(refresh, monkeypatch):
    # the store holds 11-03; CFTC publishes the 11-10 report on Monday 11-16 (Veterans Day week)
    _store(monkeypatch, "2026-11-03")
    assert svc.daily_catchup(_at(date(2026, 11, 16), 16, 29)) is False and refresh == []     # not yet due
    assert svc.daily_catchup(_at(date(2026, 11, 16), 18)) is True and refresh == ["download"]  # the 18:00 catch-up fetches it
    refresh.clear()
    _Clock.NOW = _at(date(2026, 11, 16), 16, 31)                                            # any COT-tab visit after 16:30
    svc._maybe_auto_refresh_if_stale()
    assert refresh == ["self-heal"]


def test_the_catchup_does_nothing_on_an_empty_store(refresh, monkeypatch):
    monkeypatch.setattr(svc, "_latest_record_date", lambda: None)
    assert svc.daily_catchup(_at(date(2026, 11, 16), 18)) is False and refresh == []
