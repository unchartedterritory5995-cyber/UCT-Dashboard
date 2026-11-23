"""The legacy COT store's one-time backfill (`cot_service.legacy_backfill`, the `cot_legacy_backfill` job in api/main.py).

Rails:
  * the seed reads ONE yearly file at a time, oldest first: each year is written before the next is asked for, with a
    pause between two files and none before the first;
  * a refusal (403 / 429) ends the seed at once, keeps the years already read and writes no marker; a year that fails
    otherwise is named and the rest are read, and no marker is written;
  * a complete run writes the marker `legacy_backfill_v1`; every later check answers 'done' and asks for nothing;
  * a run that did not complete is asked again on a later New York day, at most once a day;
  * an empty store is the boot seed's job, and the boot seed's own complete run ends the backfill (no second seed);
  * the check keeps to scan_period's quiet span (its own rule, read through cot_finer.quiet), at the check and before
    every file; a seed already running is left alone and the day's attempt is not spent;
  * SAFETY: re-seeding a store that holds weeks leaves every held week's figures as they were, adds only the weeks it
    lacked, leaves a week the files do not carry alone and deletes nothing;
  * the job is registered once, in the scheduler block, with its own boot mark; no route calls it.
No test reaches the CFTC: `requests.get` is replaced inside the module. Every figure and date below is INVENTED; the
market names and contract codes are the tables' own.
"""
from __future__ import annotations

import ast
import csv
import io
import json
import pathlib
import random
import sqlite3
import threading
import zipfile
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
import requests

from api.services import cot_finer as F
from api.services import cot_service as S

ET = ZoneInfo("America/New_York")
REAL_QUIET = S._quiet
ROOT = pathlib.Path(__file__).resolve().parents[1]

# An invented quiet evening (a Tuesday) and the next two days; every one of them is inside the quiet span.
DAY1 = datetime(2031, 3, 18, 22, 40, tzinfo=ET)
DAY2 = DAY1 + timedelta(days=1)
DAY3 = DAY1 + timedelta(days=2)

_COLS = ["Market and Exchange Names", "As of Date in Form YYYY-MM-DD", "CFTC Contract Market Code",
         "Open Interest (All)", "Noncommercial Positions-Long (All)", "Noncommercial Positions-Short (All)",
         "Commercial Positions-Long (All)", "Commercial Positions-Short (All)",
         "Nonreportable Positions-Long (All)", "Nonreportable Positions-Short (All)"]
_MW_NOW = "WHEAT-HRSpring - MIAX FUTURES EXCHANGE"     # the name the CFTC's files carry for Hard Red Spring wheat now
MARKETS = {"ES": (S.SYMBOL_MAP["ES"], F.CONTRACT_CODES["ES"]),
           "GC": (S.SYMBOL_MAP["GC"], F.CONTRACT_CODES["GC"]),
           "MW": (_MW_NOW, F.CONTRACT_CODES["MW"])}


def weeks(year: int) -> list[str]:
    """The first three Tuesdays of `year` (an invented miniature: three weeks a year)."""
    d = date(year, 1, 1) + timedelta(days=(1 - date(year, 1, 1).weekday()) % 7)
    return [(d + timedelta(days=7 * i)).isoformat() for i in range(3)]


def figures(sym: str, day: str) -> list[int]:
    rng = random.Random(f"{sym}|{day}")
    return [rng.randint(1000, 90000) for _ in range(7)]          # oi, then three long/short pairs


def year_text(year: int, markets=MARKETS, override: dict | None = None) -> str:
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(_COLS)
    for day in weeks(year):
        for sym, (name, code) in markets.items():
            w.writerow([name, day, code] + (override or {}).get((sym, day), figures(sym, day)))
    w.writerow(["WIDGET FUTURES - INVENTED EXCHANGE", weeks(year)[0], "999999"] + [1] * 7)   # matched by nothing
    return out.getvalue()


def year_zip(text: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("annual.txt", text)
    return buf.getvalue()


def response(url: str, status: int, content: bytes = b"") -> requests.Response:
    r = requests.Response()                 # a real Response, so raise_for_status raises the real HTTPError
    r.status_code = status
    r._content = content
    r.url = url
    return r


class FakeCftc:
    """Stands in for `requests.get` inside cot_service. `answers[year]` is a status (int) or the file text (str);
    a year not listed is served the invented file. `on_get(year)` runs before each answer. Records each year asked."""

    def __init__(self, answers: dict | None = None, on_get=None):
        self.answers = answers or {}
        self.on_get = on_get
        self.years: list[int] = []

    def __call__(self, url, timeout=None, **kw):
        year = int(url.rsplit("deacot", 1)[1].split(".")[0])
        assert url == f"{S._HIST_BASE}{year}.zip"
        self.years.append(year)
        if self.on_get:
            self.on_get(year)
        a = self.answers.get(year, year_text(year))
        if isinstance(a, int):
            return response(url, a)
        return response(url, 200, year_zip(a))


def no_cftc(*a, **k):
    raise AssertionError("asked the CFTC")


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(S, "DB_PATH", str(tmp_path / "cot.db"))
    S.init_db()
    pauses: list[float] = []
    monkeypatch.setattr(S, "_pause", pauses.append)
    monkeypatch.setattr(S, "_quiet", lambda now: True)
    monkeypatch.setattr(S.requests, "get", no_cftc)
    assert not S._SEED_LOCK.locked()
    yield pauses
    assert not S._SEED_LOCK.locked()


def rows() -> dict[tuple[str, str], tuple]:
    with sqlite3.connect(S.DB_PATH) as conn:
        return {(r[0], r[1]): tuple(r[2:]) for r in conn.execute(
            "SELECT symbol, date, large_spec_net, commercial_net, small_spec_net, open_interest FROM cot_records")}


def marker():
    return S._meta_get(S.LEGACY_BACKFILL_KEY)


def hold_something():
    S._upsert_records([{"symbol": "ES", "date": "2001-01-02", "large_spec_net": 1, "commercial_net": 2,
                        "small_spec_net": 3, "open_interest": 4}])


YEARS = S._seed_years


# ── one file at a time ───────────────────────────────────────────────────────────────────────────

def test_the_seed_reads_one_year_at_a_time_oldest_first_with_a_pause_between_two_files(db, monkeypatch):
    events: list = []
    years = YEARS()

    def on_get(year):
        events.append(("get", year))
        held = {d[:4] for (_, d) in rows()}
        assert held == {str(y) for y in years if y < year}          # every earlier year is WRITTEN before this ask

    monkeypatch.setattr(S, "_pause", lambda s: events.append(("pause", s)))
    cftc = FakeCftc(on_get=on_get)
    monkeypatch.setattr(S.requests, "get", cftc)
    out: dict = {}
    n = S.seed_from_historical(out)
    want = []
    for i, y in enumerate(years):
        want += ([("pause", S._SEED_PAUSE_S)] if i else []) + [("get", y)]
    assert events == want
    assert cftc.years == years == sorted(years) and len(years) == S._SEED_YEARS
    assert out["state"] == "complete" and out["years_read"] == years and out["years_failed"] == []
    assert n == out["records"] == len(years) * 3 * 3 == len(rows())


# ── refusals, failures and the marker ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("status", [403, 429])
def test_a_refusal_ends_the_seed_at_once_keeps_what_was_read_and_writes_no_marker(db, monkeypatch, status):
    years = YEARS()
    cftc = FakeCftc({years[3]: status})
    monkeypatch.setattr(S.requests, "get", cftc)
    hold_something()
    out = S.legacy_backfill(DAY1)
    assert cftc.years == years[:4]                                   # nothing asked after the refusal
    assert out["state"] == "stopped" and out["reason"] == f"http_{status}" and out["years_read"] == years[:3]
    assert {d[:4] for (_, d) in rows()} - {"2001"} == {str(y) for y in years[:3]}
    assert marker() is None


def test_a_year_that_fails_is_named_the_rest_are_read_and_it_is_asked_again_on_a_later_day(db, monkeypatch):
    years = YEARS()
    hold_something()
    cftc = FakeCftc({years[5]: 404})
    monkeypatch.setattr(S.requests, "get", cftc)
    out = S.legacy_backfill(DAY1)
    assert out["state"] == "partial" and out["years_failed"] == [f"{years[5]}: http_404"]
    assert cftc.years == years and out["years_read"] == [y for y in years if y != years[5]]
    assert marker() is None
    assert S.legacy_backfill(DAY1 + timedelta(minutes=70)) == {"state": "tried_today"}   # at most once a day
    assert cftc.years == years

    cftc2 = FakeCftc()
    monkeypatch.setattr(S.requests, "get", cftc2)
    out2 = S.legacy_backfill(DAY2)
    assert out2["state"] == "complete" and cftc2.years == years
    assert json.loads(marker()) == {"years": years, "records": len(years) * 9}


def test_a_complete_backfill_writes_the_marker_and_never_asks_again(db, monkeypatch):
    hold_something()
    cftc = FakeCftc()
    monkeypatch.setattr(S.requests, "get", cftc)
    assert S.legacy_backfill(DAY1)["state"] == "complete"
    assert marker() is not None
    monkeypatch.setattr(S.requests, "get", no_cftc)
    assert S.legacy_backfill(DAY2) == {"state": "done"}
    assert S.legacy_backfill(DAY3) == {"state": "done"}


def test_a_failure_outside_the_seed_is_failed_with_no_marker(db, monkeypatch):
    hold_something()

    def broken(records):
        raise sqlite3.OperationalError("disk I/O error")

    monkeypatch.setattr(S.requests, "get", FakeCftc())
    monkeypatch.setattr(S, "_upsert_records", broken)
    assert S.legacy_backfill(DAY1) == {"state": "failed", "reason": "OperationalError"}
    assert marker() is None and not S._SEED_LOCK.locked()


# ── who runs it, and when ────────────────────────────────────────────────────────────────────────

def test_an_empty_store_is_left_to_the_boot_seed_and_its_complete_seed_ends_the_backfill(db, monkeypatch):
    assert S.is_empty()
    assert S.legacy_backfill(DAY1) == {"state": "empty"}
    assert S._meta_get(S._BACKFILL_TRIED_KEY) is None
    cftc = FakeCftc()
    monkeypatch.setattr(S.requests, "get", cftc)
    S.seed_from_historical()                                         # the boot seed of an empty store (main.py)
    assert marker() is not None
    monkeypatch.setattr(S.requests, "get", no_cftc)
    assert S.legacy_backfill(DAY1) == {"state": "done"}


def test_the_check_keeps_to_scan_periods_quiet_span(db, monkeypatch):
    from api.services import scan_period
    for at in ("2031-03-18T06:59", "2031-03-18T07:00", "2031-03-18T12:00", "2031-03-18T20:14", "2031-03-18T20:15",
               "2031-03-21T12:00", "2031-03-22T12:00"):
        when = datetime.fromisoformat(at).replace(tzinfo=ET)
        assert REAL_QUIET(when) == scan_period._reuse_quiet_now(when), at
    for day in range(7):                                             # the job's slot is quiet on every day
        h, m = S.BACKFILL_RUN_AT_ET
        assert REAL_QUIET(datetime(2031, 3, 16 + day, h, m, tzinfo=ET))
    hold_something()
    monkeypatch.setattr(S, "_quiet", REAL_QUIET)
    assert S.legacy_backfill(datetime(2031, 3, 18, 12, 0, tzinfo=ET)) == {"state": "not_quiet"}
    assert S._meta_get(S._BACKFILL_TRIED_KEY) is None


def test_the_quiet_span_ending_mid_seed_stops_it_with_no_marker(db, monkeypatch):
    years = YEARS()
    answers = iter([True, True, True, False])                        # the check, then before the 2nd, 3rd, 4th file
    monkeypatch.setattr(S, "_quiet", lambda now: next(answers))
    cftc = FakeCftc()
    monkeypatch.setattr(S.requests, "get", cftc)
    hold_something()
    out = S.legacy_backfill(DAY1)
    assert out["state"] == "stopped" and out["reason"] == "busy" and cftc.years == years[:3]
    assert marker() is None


def test_a_seed_already_running_is_left_alone_and_the_day_is_not_spent(db, monkeypatch):
    hold_something()
    with S._SEED_LOCK:
        assert S.legacy_backfill(DAY1) == {"state": "running"}
        out: dict = {}
        assert S.seed_from_historical(out) == 0 and out["state"] == "running"
    assert S._meta_get(S._BACKFILL_TRIED_KEY) is None

    class LostRace:                                                  # free at the check, taken by the time it starts
        def locked(self):
            return False

        def acquire(self, blocking=True):
            return False

    S._meta_set(S._BACKFILL_TRIED_KEY, "2031-03-17")
    monkeypatch.setattr(S, "_SEED_LOCK", LostRace())
    assert S.legacy_backfill(DAY1)["state"] == "running"
    assert S._meta_get(S._BACKFILL_TRIED_KEY) == "2031-03-17"        # restored: today's attempt is not spent
    monkeypatch.setattr(S, "_SEED_LOCK", threading.Lock())


# ── SAFETY: what a re-seed changes in a store that already holds weeks ──────────────────────────

def test_reseeding_a_store_that_holds_weeks_changes_no_held_week_and_adds_only_the_missing_ones(db, monkeypatch):
    years = YEARS()
    current = years[-1]
    # The store as it stands: every year of ES and GC, MW's current year only (the Friday refresh's re-read), and
    # one week of ES from before the seed's years that no file carries.
    for y in years:
        recs, _ = S._parse_cftc_stream(io.StringIO(year_text(y)))
        S._upsert_records([r for r in recs if r["symbol"] != "MW" or y == current])
    S._upsert_records([{"symbol": "ES", "date": f"{years[0] - 5}-06-03", "large_spec_net": -7,
                        "commercial_net": 11, "small_spec_net": -4, "open_interest": 4321}])
    before = rows()
    assert {s for s, _ in before} == {"ES", "GC", "MW"}

    monkeypatch.setattr(S.requests, "get", FakeCftc())
    assert S.legacy_backfill(DAY1)["state"] == "complete"
    after = rows()

    assert {k: after[k] for k in before} == before                   # every held week exactly as it was
    added = set(after) - set(before)
    assert added == {("MW", d) for y in years[:-1] for d in weeks(y)}   # only MW's missing weeks, nothing else
    assert len(after) == len(before) + 3 * (len(years) - 1)          # nothing deleted
    mw = S.get_cot_data("MW", 520)                                   # what the COT tab and the UCT Agent read
    assert [r["date"] for r in mw] == [d for y in years for d in weeks(y)]


def test_a_week_the_cftc_file_carries_differently_is_taken_from_the_file(db, monkeypatch):
    years = YEARS()
    day = weeks(years[2])[1]
    S._upsert_records(S._parse_cftc_stream(io.StringIO(year_text(years[2])))[0])
    revised = {("GC", day): [5000, 900, 100, 2000, 2500, 300, 200]}
    monkeypatch.setattr(S.requests, "get", FakeCftc({years[2]: year_text(years[2], override=revised)}))
    assert S.legacy_backfill(DAY1)["state"] == "complete"
    assert rows()[("GC", day)] == (800, -500, 100, 5000)             # the upsert's last write wins, as on a Friday


# ── the job ──────────────────────────────────────────────────────────────────────────────────────

def test_the_job_is_registered_once_in_the_scheduler_block_and_no_route_calls_it():
    src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
    assert src.count('id="cot_legacy_backfill"') == 1
    assert src.count('_boot_mark("COT-legacy-backfill")') == 1
    life = next(n for n in ast.parse(src).body if isinstance(n, ast.AsyncFunctionDef) and n.name == "lifespan")
    seg = ast.get_source_segment(src, life)
    i = seg.index('_boot_mark("COT-legacy-backfill")')
    block = seg[i:seg.index('id="cot_legacy_backfill"', i)]
    assert "_cot_service.legacy_backfill()" in block and "_cot_service.BACKFILL_RUN_AT_ET" in block
    assert seg.index('_boot_mark("jobs-start")') < i                 # inside the scheduler-lock block
    for path in (ROOT / "api" / "routers").rglob("*.py"):
        assert "legacy_backfill" not in path.read_text(encoding="utf-8"), path
