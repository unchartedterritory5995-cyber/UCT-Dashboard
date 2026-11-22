"""RATES, the Terminal's Treasury yields screen (`api/services/treasury_yields.py` and the route
in `api/routers/treasury_yields.py`).

What is held here:
  * the requests are the ones the Treasury's own page documents (one calendar year, or one
    month), sent to the Treasury's host with no key, no redirect followed and a size limit;
  * the feed is read defensively: a maturity whose element is absent, empty or marked null is
    None, never 0; a day without its date or without any yield is dropped and counted; a web
    page, a document type declaration or broken XML is never read as figures;
  * the first build asks for each calendar year of the five-year window ONCE, one after
    another with a pause, and never more than `MAX_REQUESTS`; a year read before a later one
    failed is not asked for again; a refresh asks for the current month only and merges it;
  * a change is in basis points against the nearest earlier trading day's figure, and is None
    when that day has no figure or the data has a hole;
  * each spread says whether it is inverted and for how many trading days in a row, and says
    "at least" when the run reaches the edge of what was read;
  * a refusal (a 4xx or a redirect) is `unavailable`, a 429 / a timeout / a 5xx is `failed`,
    each remembered so the Treasury is not asked again by every member who opens the panel;
  * every build writes ONE `[rates-data]` line naming the source, the status code, the requests
    made and the rows parsed, and a distinct one for an empty answer and for a shape mismatch;
  * nothing is built on the request: one background build, a short wait, then `computing`; the
    held answer is given at once while a refresh runs, and it is kept on disk;
  * the route is paid.

No test here reaches the Treasury: the one reader (`_http_get`) is replaced, or the HTTP library is.
The feed fixtures are hand-made in the shape of one sample month read on 2026-11-18.
"""
from __future__ import annotations

import functools
import logging
import threading
import time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import treasury_yields as route
from api.services import treasury_yields as ty

NY = ZoneInfo("America/New_York")
FIELDS = {key: field for key, field, _label, _months in ty.MATURITIES}
BASE = {"1m": 4.35, "3m": 4.50, "6m": 4.20, "1y": 4.00, "2y": 3.70, "3y": 3.72, "5y": 3.80, "7y": 3.95,
        "10y": 4.10, "20y": 4.60, "30y": 4.70}
NEWEST = date(2026, 11, 17)          # a Tuesday
TURNED = date(2026, 8, 20)           # the first day the 10-year is above the 2-year again
NOW = datetime(2026, 11, 18, 12, 0, tzinfo=NY)       # the Wednesday after: nothing is behind
XML_TYPE = "application/xml; charset=utf-8"
HEAD = ('<?xml version="1.0" encoding="utf-8" standalone="yes" ?>\n'
        '<feed xml:base="https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml" '
        'xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices" '
        'xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata" xmlns="http://www.w3.org/2005/Atom">\n'
        '<title type="text">DailyTreasuryYieldCurveRateData</title>\n<id></id>\n<updated>2026-11-18T01:02:21Z</updated>\n')



@pytest.fixture(autouse=True)
def _log_only_inside_the_blocks():
    """Records are captured only inside a `caplog.at_level` block, whatever ran before this file.
    A test that imports the whole app first configures logging at INFO, and a build's log line
    written BEFORE a block would then sit in `caplog.records` ahead of the line the test reads
    (found 2026-11-18: two tests passed alone and failed after the member API list test). The
    logger's own level is pinned here, so the order the files run in cannot matter."""
    lg = logging.getLogger("api.services.treasury_yields")
    old = lg.level
    lg.setLevel(logging.WARNING)
    yield
    lg.setLevel(old)

def day_row(day: date, **over) -> dict:
    """One day's yields by key. `key=None` leaves that maturity's element out, as the Treasury does."""
    ys = dict(BASE)
    if day < TURNED:
        ys["2y"] = 4.40              # inverted: the 2-year above the 10-year
    ys.update(over)
    return {"date": day.isoformat(), **ys}


def entry_xml(row: dict, n: int = 1) -> str:
    """One <entry> as the feed sends it, with the elements this module does not read as well."""
    props = [f'<d:Id m:type="Edm.Int32">{n}</d:Id>']
    if row.get("date") is not None:
        props.append(f'<d:NEW_DATE m:type="Edm.DateTime">{row["date"]}T00:00:00</d:NEW_DATE>')
    for key, field in FIELDS.items():
        if row.get(key) is not None:
            props.append(f'<d:{field} m:type="Edm.Double">{row[key]}</d:{field}>')
    for extra in ("BC_1_5MONTH", "BC_2MONTH", "BC_4MONTH", "BC_30YEARDISPLAY"):
        props.append(f'<d:{extra} m:type="Edm.Double">9.99</d:{extra}>')
    props.extend(row.get("_raw") or [])
    return ('<entry>\n<id>https://home.treasury.gov/x(%d)</id>\n<title type="text"></title>\n<updated>2026-11-18T01:02:21Z</updated>\n'
            '<author><name /></author>\n<content type="application/xml">\n<m:properties>\n%s\n</m:properties>\n</content>\n</entry>\n'
            % (n, "\n".join(props)))


def feed_xml(rows: list[dict]) -> bytes:
    return (HEAD + "".join(entry_xml(r, i + 1) for i, r in enumerate(rows)) + "</feed>\n").encode("utf-8")


def weekdays(first: date, last: date):
    d = first
    while d <= last:
        if d.weekday() < 5:
            yield d
        d += timedelta(days=1)


@functools.lru_cache(maxsize=None)
def fixed_rows() -> tuple:
    """Five years and a little more, ending Tuesday 2026-11-17, with the days a change is measured
    against set by hand."""
    special = {
        NEWEST: {"10y": 4.12, "1m": None},                 # no 1-month figure on the newest day
        date(2026, 11, 10): {"10y": 4.05, "20y": None},     # a week earlier; no 20-year figure that day
        date(2026, 10, 16): {"10y": 4.30},                  # a month earlier is a Saturday: the Friday before
        date(2025, 11, 17): {"10y": 3.62},                  # a year earlier
    }
    return tuple(day_row(d, **special.get(d, {})) for d in weekdays(date(2021, 11, 1), NEWEST))


def parsed(rows) -> list[dict]:
    out, _entries, _dropped = ty.parse_feed(feed_xml(list(rows)))
    return out


class Site:
    """Stands where the one reader (`_http_get`) stands. Applies the period the service asks for, so
    a request with the wrong filter gets the wrong days, and records every call."""

    def __init__(self):
        self.rows: list = []
        self.calls: list[dict] = []
        self.fail: dict = {}                    # period value (or "*") -> an exception to raise, or (status, type, body)
        self.gate: threading.Event | None = None
        self.threads: list[str] = []

    def get(self, params):
        self.calls.append(dict(params))
        self.threads.append(threading.current_thread().name)
        if self.gate is not None:
            self.gate.wait(10)
        value = params.get(ty.YEAR_PARAM) or params.get(ty.MONTH_PARAM)
        hit = self.fail.get(value, self.fail.get("*"))
        if isinstance(hit, BaseException):
            raise hit
        if hit is not None:
            return hit
        prefix = ty.period_of("year" if ty.YEAR_PARAM in params else "month", value)
        return 200, XML_TYPE, feed_xml([r for r in self.rows if r["date"].startswith(prefix)])

    def asked(self):
        return [c.get(ty.YEAR_PARAM) or c.get(ty.MONTH_PARAM) for c in self.calls]


def drain(timeout=10.0):
    """Wait for the background build this module started."""
    end = time.time() + timeout
    while time.time() < end:
        with ty._lock:
            busy = ty._state["inflight"] is not None
        if not busy:
            return
        time.sleep(0.01)
    raise AssertionError("a background build did not finish")


def until(cond, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return
        time.sleep(0.01)
    raise AssertionError("the condition did not come true")


@pytest.fixture
def site(monkeypatch, tmp_path):
    s = Site()
    s.rows = list(fixed_rows())
    s.pauses = []
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(ty, "_http_get", s.get)
    monkeypatch.setattr(ty, "_pause", s.pauses.append)
    monkeypatch.setattr(ty, "now_et", lambda: NOW)
    ty.reset_for_tests()
    yield s
    if s.gate is not None:
        s.gate.set()
    drain()
    ty.reset_for_tests()


def lines(caplog):
    return [r.getMessage() for r in caplog.records if r.getMessage().startswith("[rates-data]")]


def levels(caplog):
    return [r.levelno for r in caplog.records if r.getMessage().startswith("[rates-data]")]


def unblock():
    with ty._lock:
        ty._state["block"] = None


# ── reading the feed ─────────────────────────────────────────────────────────────────────────

def test_a_day_keeps_what_was_sent_and_a_missing_maturity_is_none_never_zero():
    none = {key: None for key in FIELDS}
    body = feed_xml([
        {"date": "2026-11-17", "10y": 4.12, "2y": 3.7, "3m": 0},                       # a real zero stays zero
        {"date": "2026-11-16", "10y": 4.1, "_raw": [
            '<d:BC_2YEAR m:type="Edm.Double" m:null="true" />',                        # marked null
            '<d:BC_5YEAR m:type="Edm.Double"></d:BC_5YEAR>',                           # empty
            '<d:BC_7YEAR m:type="Edm.Double">N/A</d:BC_7YEAR>',                        # not a number
            '<d:BC_30YEAR m:type="Edm.Double">NaN</d:BC_30YEAR>']},
        {"date": "2026-11-13"},                                                        # a date and no yield at all
        {"date": "2026-02-30", "10y": 4.0},                                            # not a date
        {"10y": 4.0},                                                                  # no date
        {"date": "2026-11-17", "10y": 9.99},                                           # the same day twice: the first is kept
    ])
    rows, entries, dropped = ty.parse_feed(body, XML_TYPE)
    assert rows == [
        {"date": "2026-11-16", "y": {**none, "10y": 4.1}},
        {"date": "2026-11-17", "y": {**none, "3m": 0.0, "2y": 3.7, "10y": 4.12}},
    ]
    assert (entries, dropped) == (6, 3)
    # the elements this module does not read (the 1.5-, 2- and 4-month, the 30-year display copy) change nothing
    assert set(rows[0]["y"]) == set(FIELDS)


def test_an_entry_with_nothing_in_it_is_the_feeds_way_of_saying_none():
    empty = (HEAD + '<entry><content type="application/xml" /></entry>\n</feed>').encode()
    assert ty.parse_feed(empty, XML_TYPE) == ([], 0, 0)
    assert ty.parse_feed((HEAD + "</feed>").encode(), XML_TYPE) == ([], 0, 0)
    # another namespace address for the same element names still reads (only the names are relied on)
    moved = feed_xml([{"date": "2026-11-17", "10y": 4.12}]).replace(b"2007/08/dataservices", b"2030/01/dataservices")
    assert ty.parse_feed(moved)[0][0]["y"]["10y"] == 4.12


@pytest.mark.parametrize("body, ctype, why", [
    (b"<!DOCTYPE html><html><body>Access Denied</body></html>", "text/html", "a web page where the feed was expected"),
    (b"\n  <html><head><title>Interest Rates</title></head></html>", XML_TYPE, "a web page where the feed was expected"),
    (b"Access Denied. Reference 18.2f3a", "text/html", "a web page where the feed was expected"),
    (b"Access Denied. Reference 18.2f3a", "text/plain", "XML that is not well formed"),
    (b"", XML_TYPE, "an empty answer"),
    (b"<feed><entry></feed>", XML_TYPE, "XML that is not well formed"),
    (b"<rss><channel /></rss>", XML_TYPE, "a document whose root is <rss>, not the feed"),
    (b'<?xml version="1.0"?><!DOCTYPE feed [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]><feed>&b;</feed>', XML_TYPE,
     "a document type declaration, which the feed never carries; not parsed"),
])
def test_a_web_page_a_declared_entity_or_broken_xml_is_never_read_as_figures(body, ctype, why):
    with pytest.raises(ty.FeedShape) as err:
        ty.parse_feed(body, ctype)
    assert err.value.why == why


def test_the_feed_served_under_a_web_pages_content_type_is_still_the_feed():
    rows, entries, dropped = ty.parse_feed(feed_xml([{"date": "2026-11-17", "10y": 4.12}]), "text/html; charset=utf-8")
    assert (rows[0]["y"]["10y"], entries, dropped) == (4.12, 1, 0)


def test_an_answer_past_the_size_limit_is_not_parsed(monkeypatch):
    monkeypatch.setattr(ty, "MAX_BYTES", 2_000_000)
    with pytest.raises(ty.FeedShape) as err:
        ty.parse_feed(b"x" * 2_000_001, XML_TYPE)
    assert err.value.why == "an answer larger than 2 MB"


def test_the_eleven_maturities_are_the_treasurys_own_elements_shortest_first():
    assert [m[1] for m in ty.MATURITIES] == [
        "BC_1MONTH", "BC_3MONTH", "BC_6MONTH", "BC_1YEAR", "BC_2YEAR", "BC_3YEAR", "BC_5YEAR", "BC_7YEAR",
        "BC_10YEAR", "BC_20YEAR", "BC_30YEAR"]
    assert [m[3] for m in ty.MATURITIES] == sorted(m[3] for m in ty.MATURITIES)
    assert ty.SOURCE == "US Treasury daily par yield curve"


def test_a_month_back_is_the_same_day_or_the_months_last_day():
    assert ty.months_back(date(2026, 11, 17), 1) == date(2026, 10, 17)
    assert ty.months_back(date(2026, 3, 31), 1) == date(2026, 2, 28)
    assert ty.months_back(date(2024, 2, 29), 12) == date(2023, 2, 28)
    assert ty.months_back(date(2026, 1, 15), 3) == date(2025, 10, 15)
    assert ty.window_start(date(2026, 11, 18)) == date(2021, 11, 8)


# ── the answer ───────────────────────────────────────────────────────────────────────────────

def test_each_maturity_carries_its_yield_and_its_changes_in_basis_points():
    rows = parsed(fixed_rows())
    out = ty.assemble(rows, read_at="2026-11-18T12:00:00+00:00")
    assert out["as_of"] == "2026-11-17" and out["basis"] == "end_of_day" and out["source"] == "US Treasury daily par yield curve"
    assert out["units"] == {"yield": "percent", "change": "basis points", "spread": "percentage points"}
    assert out["ref_dates"] == {"d1": "2026-11-16", "w1": "2026-11-10", "m1": "2026-10-16", "m3": "2026-08-17", "y1": "2025-11-17"}
    assert [m["key"] for m in out["maturities"]] == ["1m", "3m", "6m", "1y", "2y", "3y", "5y", "7y", "10y", "20y", "30y"]
    by = {m["key"]: m for m in out["maturities"]}
    assert by["10y"] == {
        "key": "10y", "label": "10-year", "months": 120, "yield": 4.12,
        "was": {"d1": 4.10, "w1": 4.05, "m1": 4.30, "m3": 4.10, "y1": 3.62},
        "change_bp": {"d1": 2.0, "w1": 7.0, "m1": -18.0, "m3": 2.0, "y1": 50.0},
    }
    assert by["2y"]["change_bp"] == {"d1": 0.0, "w1": 0.0, "m1": 0.0, "m3": -70.0, "y1": -70.0}
    # no figure on the newest day: no yield and no change, never a 0
    assert by["1m"]["yield"] is None and set(by["1m"]["change_bp"].values()) == {None}
    assert by["1m"]["was"]["d1"] == 4.35
    # no figure on the reference day: that one change is None, the others stand
    assert by["20y"]["was"]["w1"] is None and by["20y"]["change_bp"] == {"d1": 0.0, "w1": None, "m1": 0.0, "m3": 0.0, "y1": 0.0}
    assert "vendor_rows" not in out and out["rows"] == len(rows)


def test_each_spread_says_its_state_and_how_many_trading_days_it_has_held():
    rows = parsed(fixed_rows())
    out = ty.assemble(rows)
    s2, s3 = out["spreads"]
    assert s2 == {
        "key": "10y2y", "long": "10y", "short": "2y", "label": "10-year minus 2-year",
        "value": 0.42, "state": "positive", "inverted": False,
        "days_in_state": 64, "since": "2026-08-20", "days_at_least": False,
        "was": {"d1": 0.40, "w1": 0.35, "m1": 0.60, "m3": -0.30, "y1": -0.78},
        "change_bp": {"d1": 2.0, "w1": 7.0, "m1": -18.0, "m3": 72.0, "y1": 120.0},
    }
    # the 3-month has been above the 10-year for everything that was read: "at least" that long
    assert (s3["key"], s3["label"]) == ("10y3m", "10-year minus 3-month")
    assert s3["value"] == -0.38 and s3["state"] == "inverted" and s3["inverted"] is True
    assert s3["days_in_state"] == len(rows) and s3["since"] == "2021-11-01" and s3["days_at_least"] is True


def test_the_history_is_five_years_of_daily_points_for_three_yields_and_both_spreads():
    hist = ty.assemble(parsed(fixed_rows()))["history"]
    assert (hist["from"], hist["to"], hist["years"]) == ("2021-11-17", "2026-11-17", 5)
    assert hist["points"] == 1305 == len(hist["dates"])
    assert set(hist) == {"from", "to", "points", "years", "dates", "y2y", "y10y", "y30y", "s10y2y", "s10y3m"}
    for col in ("y2y", "y10y", "y30y", "s10y2y", "s10y3m"):
        assert len(hist[col]) == 1305
    assert (hist["y10y"][-1], hist["y2y"][-1], hist["y30y"][-1]) == (4.12, 3.70, 4.70)
    assert (hist["s10y2y"][0], hist["s10y2y"][-1], hist["s10y3m"][-1]) == (-0.30, 0.42, -0.38)
    i = hist["dates"].index("2026-08-19")
    assert hist["s10y2y"][i:i + 2] == [-0.30, 0.40]                      # the day it turned positive


def test_a_hole_in_the_data_gives_no_change_rather_than_one_against_another_day():
    rows = parsed([day_row(d) for d in weekdays(date(2026, 9, 1), NEWEST) if not date(2026, 10, 5) <= d <= date(2026, 10, 23)])
    refs = ty.reference_rows(rows)
    assert refs["d1"]["date"] == "2026-11-16" and refs["w1"]["date"] == "2026-11-10"
    assert refs["m1"] is None                    # a month back falls in a three-week hole
    assert refs["m3"] is None and refs["y1"] is None      # before anything that was read
    out = ty.assemble(rows)
    assert out["ref_dates"]["m1"] is None and out["maturities"][8]["change_bp"]["m1"] is None
    assert out["maturities"][8]["change_bp"]["d1"] == 0.0
    assert ty.reference_rows(rows[:1]) == {h: None for h in ty.HORIZONS}
    # the first day back after a long weekend still has a previous day (Friday to Tuesday is 4 days)
    rows2 = parsed([day_row(date(2026, 11, 13)), day_row(NEWEST)])
    assert ty.reference_rows(rows2)["d1"]["date"] == "2026-11-13"


def test_a_run_stops_at_a_day_with_no_figure_and_says_at_least():
    assert ty.run_of([-0.1, 0.2, 0.3, 0.1]) == (3, 1, False)
    assert ty.run_of([0.2, 0.3]) == (2, 0, True)                      # reaches the first day read
    assert ty.run_of([-0.1, None, 0.3, 0.1]) == (2, 2, True)          # the day before has no figure
    assert ty.run_of([0.1, -0.2, -0.01]) == (2, 1, False)
    assert ty.run_of([0.1, 0.0]) == (1, 1, False)                     # exactly equal is its own state
    assert ty.run_of([0.1, None]) == (None, None, False) and ty.run_of([]) == (None, None, False)
    assert [ty.spread_state(v) for v in (0.01, -0.01, 0.0, None)] == ["positive", "inverted", "flat", None]


def test_a_spread_with_a_missing_leg_is_none_never_the_other_leg():
    rows = parsed([day_row(date(2026, 11, 16)), day_row(NEWEST, **{"2y": None})])
    s2, s3 = ty.assemble(rows)["spreads"]
    assert s2["value"] is None and s2["state"] is None and s2["inverted"] is None
    assert s2["days_in_state"] is None and s2["since"] is None and set(s2["change_bp"].values()) == {None}
    assert s3["value"] == -0.4 and s3["days_in_state"] == 2


# ── when it is refreshed, and what is asked ──────────────────────────────────────────────────

def test_a_refresh_is_due_after_the_weekday_evening_and_while_the_newest_figure_is_behind():
    at = lambda y, m, d, hh, mm=0: datetime(y, m, d, hh, mm, tzinfo=NY)  # noqa: E731
    ts = lambda *a: at(*a).timestamp()  # noqa: E731
    assert ty.last_daily_slot(at(2026, 11, 18, 12)) == at(2026, 11, 17, 18, 15)       # Wednesday noon: Tuesday evening
    assert ty.last_daily_slot(at(2026, 11, 18, 18, 15)) == at(2026, 11, 18, 18, 15)
    assert ty.last_daily_slot(at(2026, 11, 22, 23)) == at(2026, 11, 20, 18, 15)       # Sunday: Friday evening
    assert ty.last_daily_slot(at(2026, 11, 23, 9)) == at(2026, 11, 20, 18, 15)        # Monday morning: Friday evening
    assert ty.last_weekday_before(date(2026, 11, 23)) == date(2026, 11, 20)
    # looked at this morning, newest figure is yesterday's: nothing to do until this evening
    assert ty.refresh_due("2026-11-17", ts(2026, 11, 18, 9), at(2026, 11, 18, 12)) is False
    assert ty.refresh_due("2026-11-17", ts(2026, 11, 18, 9), at(2026, 11, 18, 18, 14)) is False
    assert ty.refresh_due("2026-11-17", ts(2026, 11, 18, 9), at(2026, 11, 18, 18, 15)) is True
    # last looked before yesterday evening: due
    assert ty.refresh_due("2026-11-17", ts(2026, 11, 17, 12), at(2026, 11, 18, 12)) is True
    # the newest figure is a day behind: look every three hours
    assert ty.refresh_due("2026-11-16", ts(2026, 11, 18, 9), at(2026, 11, 18, 11, 59)) is False
    assert ty.refresh_due("2026-11-16", ts(2026, 11, 18, 9), at(2026, 11, 18, 12)) is True
    assert ty.refresh_due(None, ts(2026, 11, 18, 9), at(2026, 11, 18, 12)) is True
    # a weekend with Friday's figure held and a look since Friday evening: nothing asked
    assert ty.refresh_due("2026-11-20", ts(2026, 11, 20, 19), at(2026, 11, 22, 15)) is False


def test_the_plan_is_each_year_of_the_window_once_and_then_only_the_months_since_the_newest_day():
    today = date(2026, 11, 18)
    years = [("year", str(y)) for y in range(2021, 2027)]
    assert ty.plan(today, []) == years
    held = [d.isoformat() for d in weekdays(date(2021, 11, 8), NEWEST)]
    assert ty.plan(today, held) == [("month", "202611")]
    assert ty.plan(date(2026, 12, 1), held) == [("month", "202611"), ("month", "202612")]       # the month the newest day is in, then this one
    assert ty.plan(date(2027, 1, 4), held) == [("month", "202611"), ("month", "202612"), ("month", "202701")]
    assert ty.plan(date(2027, 3, 1), held) == [("year", "2026"), ("year", "2027")]              # too far behind for months
    # what is held does not reach back to the start of the window: the whole window again
    assert ty.plan(today, held[200:]) == years
    # a window that touches seven calendar years is seven requests, and never more
    assert ty.plan(date(2026, 1, 5), []) == [("year", str(y)) for y in range(2020, 2027)]
    assert len(ty.plan(date(2026, 1, 5), [])) == ty.MAX_REQUESTS == 7
    assert ty.period_of("year", "2026") == "2026-" and ty.period_of("month", "202611") == "2026-11-"


# ── the documented request ───────────────────────────────────────────────────────────────────

def test_the_reader_sends_the_documented_request_to_the_treasury_with_no_redirect_and_a_size_limit(monkeypatch):
    import requests
    sent = {}

    class Raw:
        def read(self, n, decode_content=False):
            sent["read"] = (n, decode_content)
            return b"<feed />"

    class Resp:
        status_code = 200
        headers = {"Content-Type": "application/xml"}
        raw = Raw()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            sent["closed"] = True

    def get(url, **kw):
        sent.update(url=url, **kw)
        return Resp()

    monkeypatch.setattr(requests, "get", get)
    out = ty._http_get({"data": "daily_treasury_yield_curve", "field_tdr_date_value": "2026"})
    assert out == (200, "application/xml", b"<feed />")
    assert sent["url"] == "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml"
    assert sent["params"] == {"data": "daily_treasury_yield_curve", "field_tdr_date_value": "2026"}
    assert sent["allow_redirects"] is False and sent["stream"] is True and sent["timeout"] == (10, 60)
    assert sent["headers"]["User-Agent"] == ty.USER_AGENT and "@" not in ty.USER_AGENT
    assert sent["read"] == (ty.MAX_BYTES + 1, True) and sent["closed"] is True
    assert set(sent) == {"url", "params", "timeout", "allow_redirects", "stream", "headers", "read", "closed"}    # no key, no cookie, no auth


def test_the_first_build_asks_for_each_year_once_in_order_with_a_pause_and_writes_one_line(site, caplog):
    with caplog.at_level(logging.INFO, logger="api.services.treasury_yields"):
        out = ty.get_yields(wait_s=10)
        drain()
    assert site.calls == [{"data": "daily_treasury_yield_curve", "field_tdr_date_value": str(y)} for y in range(2021, 2027)]
    assert site.pauses == [ty.PAUSE_S] * 5                               # between requests, never before the first
    assert set(site.threads) == {"rates-data-build"}
    assert out["status"] == "ok" and out["as_of"] == "2026-11-17" and out["check"] is None and out["source"] == ty.SOURCE
    assert out["rows"] == 1312 and out["history"]["points"] == 1305 and out["history"]["from"] == "2021-11-17"
    assert "v" not in out and out["read_at"]
    assert out["spreads"][0]["value"] == 0.42 and out["spreads"][0]["days_in_state"] == 64
    said = lines(caplog)
    assert len(said) == 1 and levels(caplog) == [logging.INFO]
    assert "[rates-data] treasury status=200 rows=1312 requests=6 new=1312 latest=2026-11-17 first=2021-11-08;" in said[0]
    assert "home.treasury.gov" not in caplog.text and "no newer figure" not in said[0]


def test_a_refresh_asks_for_the_current_month_only_and_merges_it_into_what_is_held(site, caplog):
    site.rows = [r for r in fixed_rows() if r["date"] < "2026-11-17"]
    first = ty.get_yields(wait_s=10)
    drain()
    assert first["as_of"] == "2026-11-16" and first["rows"] == 1311
    assert ty.get_yields(wait_s=0)["as_of"] == "2026-11-16" and len(site.calls) == 6      # just looked: not asked again yet
    site.rows = list(fixed_rows())                                       # the next day's figure is published
    site.gate = threading.Event()
    with ty._lock:
        ty._state["checked"] = 0.0
    with caplog.at_level(logging.INFO, logger="api.services.treasury_yields"):
        started = time.time()
        during = ty.get_yields()                                         # no wait is passed: a held answer never waits
        assert time.time() - started < 1.0 and during == first
        until(lambda: len(site.calls) == 7)                              # the refresh is running, on its own thread
        assert ty.get_yields() == first and len(site.calls) == 7         # one refresh for three requests
        site.gate.set()
        drain()
    assert site.calls[6] == {"data": "daily_treasury_yield_curve", "field_tdr_date_value_month": "202611"}
    new = ty.get_yields(wait_s=0)
    assert new["as_of"] == "2026-11-17" and new["rows"] == 1312 and new["history"]["from"] == "2021-11-17"
    assert new["maturities"][8]["change_bp"]["y1"] == 50.0               # the year-old day came from the first build
    assert "treasury status=200 rows=1312 requests=1 new=1 latest=2026-11-17 first=2021-11-08;" in lines(caplog)[0]
    # a refresh that finds nothing newer says so, and still asks once
    with ty._lock:
        ty._state["checked"] = 0.0
    caplog.clear()
    with caplog.at_level(logging.INFO, logger="api.services.treasury_yields"):
        ty.get_yields()
        drain()
    assert "requests=1 new=0 latest=2026-11-17 first=2021-11-08 (no newer figure than the one held)" in lines(caplog)[0]
    assert len(site.calls) == 8


def test_the_month_before_is_asked_too_when_the_newest_day_held_is_in_it_and_an_empty_new_month_is_not_a_failure(site, monkeypatch, caplog):
    ty.get_yields(wait_s=10)
    drain()
    monkeypatch.setattr(ty, "now_et", lambda: datetime(2026, 12, 1, 9, 0, tzinfo=NY))
    site.rows = list(fixed_rows()) + [day_row(d) for d in weekdays(date(2026, 11, 18), date(2026, 11, 30))]
    site.fail["202612"] = (200, XML_TYPE, b"")                           # December has no figure yet
    with ty._lock:
        ty._state["checked"] = 0.0
    with caplog.at_level(logging.INFO, logger="api.services.treasury_yields"):
        ty.get_yields()
        drain()
    assert site.asked()[6:] == ["202611", "202612"]
    out = ty.get_yields(wait_s=0)
    assert out["as_of"] == "2026-11-30" and out["check"] is None
    assert "requests=2 new=9 latest=2026-11-30" in lines(caplog)[0]


# ── refusals and failures ────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("status", [403, 404, 302, 401])
def test_a_refusal_is_unavailable_with_its_status_and_is_not_asked_again(site, caplog, status):
    site.fail["*"] = (status, "text/html", b"<html>Access Denied</html>")
    with caplog.at_level(logging.INFO, logger="api.services.treasury_yields"):
        first = ty.get_yields(wait_s=10)
        drain()
        second = ty.get_yields(wait_s=10)
        drain()
    assert first == {"status": "unavailable", "reason": "refused", "http_status": status, "source": ty.SOURCE} == second
    assert len(site.calls) == 1                                          # one request, then nothing: the other years were not tried
    assert ty.held_answer() == (None, "not_held")
    said = lines(caplog)
    assert len(said) == 1 and levels(caplog) == [logging.WARNING]
    assert (f"[rates-data] treasury status={status} unavailable (the Treasury's website refused the request for 2021; "
            "not asked again for 6h); request 1 of this build, 0 of 6 periods read;") in said[0]
    # the refusal lapses: the Treasury is asked once more
    with ty._lock:
        ty._state["block"] = (time.time() - 1, ty._state["block"][1])
    site.fail.clear()
    assert ty.get_yields(wait_s=10)["status"] == "ok" and len(site.calls) == 7


def test_too_many_requests_is_failed_and_remembered_for_fifteen_minutes(site, caplog):
    site.fail["*"] = (429, "text/html", b"slow down")
    with caplog.at_level(logging.INFO, logger="api.services.treasury_yields"):
        out = ty.get_yields(wait_s=10)
        drain()
        again = ty.get_yields(wait_s=10)
    assert out == {"status": "failed", "reason": "rate_limited", "http_status": 429, "source": ty.SOURCE} == again
    assert len(site.calls) == 1
    assert "treasury status=429 failed (the Treasury's website said too many requests, for 2021; not asked again for 15 min)" in lines(caplog)[0]
    with ty._lock:
        assert ty.RATE_LIMITED_HOLD_S - 5 <= ty._state["block"][0] - time.time() <= ty.RATE_LIMITED_HOLD_S + 1


def test_a_timeout_a_dropped_connection_and_a_server_error_are_failed_and_only_the_error_class_is_logged(site, caplog):
    import requests

    class ReadTimeout(requests.exceptions.Timeout):
        pass

    site.fail["*"] = ReadTimeout("HTTPSConnectionPool(host=secret-text): Read timed out.")
    with caplog.at_level(logging.INFO, logger="api.services.treasury_yields"):
        out = ty.get_yields(wait_s=10)
        drain()
        assert out == {"status": "failed", "reason": "timeout", "http_status": None, "source": ty.SOURCE}
        assert "treasury status=none failed (the Treasury's website did not answer in time, for 2021)" in lines(caplog)[0]
        # a failure is held for a minute, not for hours
        with ty._lock:
            assert ty._state["block"][0] - time.time() <= ty.FAILED_S + 1
        unblock()
        site.fail["*"] = requests.exceptions.ConnectionError("secret-text refused")
        assert ty.get_yields(wait_s=10) == {"status": "failed", "reason": "source", "http_status": None, "source": ty.SOURCE}
        drain()
        assert "treasury status=none failed (ConnectionError, for 2021)" in lines(caplog)[1]
        unblock()
        site.fail["*"] = (503, "text/html", b"secret-text")
        assert ty.get_yields(wait_s=10) == {"status": "failed", "reason": "source", "http_status": 503, "source": ty.SOURCE}
        drain()
        assert "treasury status=503 failed (the Treasury's website answered 503, for 2021)" in lines(caplog)[2]
        unblock()
        site.fail["*"] = ValueError("boom secret-text")
        assert ty.get_yields(wait_s=10)["reason"] == "source"
        drain()
    assert "secret-text" not in caplog.text and levels(caplog) == [logging.WARNING] * 4
    unblock()
    site.fail.clear()
    assert ty.get_yields(wait_s=10)["status"] == "ok"


def test_a_web_page_where_the_feed_was_expected_is_a_shape_mismatch_never_figures(site, caplog):
    site.fail["*"] = (200, "text/html; charset=utf-8", b"<!DOCTYPE html><html><body><table><tr><td>4.12</td></tr></table></body></html>")
    with caplog.at_level(logging.INFO, logger="api.services.treasury_yields"):
        out = ty.get_yields(wait_s=10)
        drain()
    assert out == {"status": "unavailable", "reason": "shape", "http_status": 200, "source": ty.SOURCE}
    assert "treasury status=200 rows=0 shape mismatch (a web page where the feed was expected, for 2021)" in lines(caplog)[0]
    assert levels(caplog) == [logging.WARNING] and ty.held_answer() == (None, "not_held")
    calls = len(site.calls)
    assert ty.get_yields(wait_s=10) == out and len(site.calls) == calls == 1            # held a while: not asked per request


def test_an_ignored_filter_an_empty_past_year_and_unreadable_days_are_each_said_differently(site, caplog):
    def run():
        ty.reset_for_tests()
        caplog.clear()
        with caplog.at_level(logging.INFO, logger="api.services.treasury_yields"):
            out = ty.get_yields(wait_s=10)
            drain()
        return out, lines(caplog)[0]

    # the site ignores the year asked for and answers with the first days of its whole history
    site.fail["*"] = (200, XML_TYPE, feed_xml([day_row(date(1990, 1, 2)), day_row(date(1990, 1, 3))]))
    out, said = run()
    assert out["reason"] == "shape" and "rows=0 shape mismatch (2 entries for 2021, none dated in the period asked for)" in said
    # days in another shape (no NEW_DATE, no BC_ elements)
    site.fail["*"] = (200, XML_TYPE, feed_xml([{"_raw": ['<d:DATE m:type="Edm.DateTime">2021-11-08T00:00:00</d:DATE>', '<d:TEN m:type="Edm.Double">4.1</d:TEN>']}]))
    out, said = run()
    assert out["reason"] == "shape" and "rows=0 shape mismatch (1 entries for 2021, none with a date and a yield)" in said
    # a past year with no day in it is not "no figures": it is an answer this module will not build on
    site.fail["*"] = (200, XML_TYPE, feed_xml([]))
    out, said = run()
    assert out["reason"] == "shape" and "rows=0 no rows (the feed answered with no day for 2021, a period that has passed)" in said
    # every day lacks the 10-year: not this dataset
    site.fail.clear()
    site.rows = [day_row(d, **{"10y": None}) for d in weekdays(date(2021, 11, 1), NEWEST)]
    out, said = run()
    assert out == {"status": "unavailable", "reason": "shape", "http_status": 200, "source": ty.SOURCE}
    assert "treasury status=200 rows=1312 shape mismatch (no row carries BC_10YEAR)" in said
    assert all(lv == logging.WARNING for lv in levels(caplog))


def test_a_day_dated_past_today_is_not_a_figure(site):
    site.rows = list(fixed_rows()) + [day_row(date(2026, 11, 30))]
    out = ty.get_yields(wait_s=10)
    assert out["status"] == "ok" and out["as_of"] == "2026-11-17" and out["rows"] == 1312


# ── how much is asked ────────────────────────────────────────────────────────────────────────

def test_a_year_read_before_a_later_one_failed_is_not_asked_for_again(site, caplog):
    site.fail["2023"] = (503, "text/html", b"")
    with caplog.at_level(logging.INFO, logger="api.services.treasury_yields"):
        out = ty.get_yields(wait_s=10)
        drain()
    assert out["status"] == "failed" and site.asked() == ["2021", "2022", "2023"]
    assert "failed (the Treasury's website answered 503, for 2023); request 3 of this build, 2 of 6 periods read;" in lines(caplog)[0]
    unblock()
    site.fail.clear()
    assert ty.get_yields(wait_s=10)["status"] == "ok"
    drain()
    assert site.asked() == ["2021", "2022", "2023", "2023", "2024", "2025", "2026"]       # 2021 and 2022 once each
    assert ty.get_yields(wait_s=0)["rows"] == 1312                                        # and their days are in the answer
    with ty._lock:
        assert ty._state["partial"] is None


def test_years_read_before_a_failure_are_only_kept_for_a_while(site):
    site.fail["2022"] = (503, "text/html", b"")
    assert ty.get_yields(wait_s=10)["status"] == "failed"
    drain()
    with ty._lock:
        kept = ty._state["partial"]
        assert kept[1] == tuple(("year", str(y)) for y in range(2021, 2027)) and set(kept[2]) == {("year", "2021")}
        assert 0 < kept[0] - time.time() <= ty.PARTIAL_KEEP_S
        ty._state["partial"] = (time.time() - 1, kept[1], kept[2])                        # the keep has run out
        ty._state["block"] = None
    site.fail.clear()
    assert ty.get_yields(wait_s=10)["status"] == "ok"
    assert site.asked() == ["2021", "2022"] + [str(y) for y in range(2021, 2027)]


def test_one_build_never_makes_more_than_the_most_requests_whatever_the_plan_says(site, monkeypatch, caplog):
    monkeypatch.setattr(ty, "plan", lambda today, held: [("month", f"{y}{m:02d}") for y in (2025, 2026) for m in range(1, 12)])
    with caplog.at_level(logging.INFO, logger="api.services.treasury_yields"):
        out = ty.get_yields(wait_s=10)
        drain()
    assert out == {"status": "failed", "reason": "error", "http_status": None, "source": ty.SOURCE}
    assert len(site.calls) == ty.MAX_REQUESTS == 7 and len(set(site.asked())) == 7        # stopped; no year twice
    assert "treasury status=none failed (more than 7 requests in one build; stopped)" in lines(caplog)[0]


# ── one build, off the request ───────────────────────────────────────────────────────────────

def test_a_request_never_builds_it_says_computing_then_the_held_answer(site):
    site.gate = threading.Event()
    started = time.time()
    assert ty.get_yields(wait_s=0.05) == {"status": "computing"}
    assert time.time() - started < 2.0
    assert ty.get_yields(wait_s=0.05) == {"status": "computing"}        # the same build, not a second one
    assert ty.held_answer() == (None, "not_held")
    site.gate.set()
    drain()
    held = ty.get_yields(wait_s=0)
    assert held["status"] == "ok" and held["as_of"] == "2026-11-17"
    assert len(site.calls) == 6 and set(site.threads) == {"rates-data-build"}            # never on the caller's thread
    assert ty.get_yields()["status"] == "ok" and ty.held_answer()[1] == "held"
    assert len(site.calls) == 6                                          # held and current: the Treasury is not asked


def test_the_answer_and_its_days_are_kept_on_disk_so_a_restart_does_not_start_cold(site):
    first = ty.get_yields(wait_s=10)
    drain()
    ty.reset_for_tests()                                                 # a restart: nothing in memory
    site.gate = threading.Event()                                        # and a Treasury that would not answer in time
    again = ty.get_yields(wait_s=0)
    assert again["status"] == "ok" and again == first
    assert len(site.calls) == 6                                          # read from disk and current: nothing asked
    assert ty.held_answer()[0]["as_of"] == first["as_of"]
    # and the next refresh after a restart is still one month, not five years again
    site.gate = None
    with ty._lock:
        ty._state["checked"] = 0.0
    ty.get_yields()
    drain()
    assert site.asked()[6:] == ["202611"] and ty.get_yields(wait_s=0)["rows"] == 1312


def test_a_disk_copy_of_another_shape_is_not_served(site, tmp_path):
    import json
    import os
    os.makedirs(tmp_path / "treasury_yields")
    (tmp_path / "treasury_yields" / f"yields_v{ty.DISK_VERSION}.json").write_text(
        json.dumps({"held": {"v": ty.DISK_VERSION - 1, "as_of": "2026-11-17"}, "rows": {}, "checked": 1}))
    site.gate = threading.Event()
    assert ty.get_yields(wait_s=0.05) == {"status": "computing"}


def test_a_refusal_after_an_answer_is_held_keeps_the_answer_and_says_the_look_was_refused(site):
    held = ty.get_yields(wait_s=10)
    drain()
    site.fail["*"] = (403, "text/html", b"<html>Access Denied</html>")
    with ty._lock:
        ty._state["checked"] = 0.0
    ty.get_yields()
    drain()
    out = ty.get_yields()
    assert out["status"] == "ok" and out["maturities"] == held["maturities"] and out["as_of"] == held["as_of"]
    assert out["check"]["state"] == "unavailable" and out["check"]["reason"] == "refused"
    assert out["check"]["http_status"] == 403 and out["check"]["at"]
    calls = len(site.calls)
    ty.get_yields()
    drain()
    assert len(site.calls) == calls == 7                                 # not looked at again on every request
    # when the hold lapses and the Treasury answers, the note goes
    site.fail.clear()
    with ty._lock:
        ty._state["retry_at"] = 0.0
    ty.get_yields()
    drain()
    assert ty.get_yields()["check"] is None and len(site.calls) == 8


# ── the route ────────────────────────────────────────────────────────────────────────────────

FREE_USER = {"id": "ty-free", "email": "free@example.test", "role": "member", "plan": "free"}
PAID_USER = {"id": "ty-paid", "email": "paid@example.test", "role": "member", "plan": "pro"}
URL = "/api/research/treasury-yields"


def _client(user):
    app = FastAPI()
    app.include_router(route.router)
    if user is not None:
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app, raise_server_exceptions=False)


def test_the_route_is_paid_and_a_refused_caller_never_reaches_the_service(monkeypatch):
    from api.services import treasury_real_yields as real
    asked = []
    monkeypatch.setattr(ty, "get_yields", lambda: asked.append("yields") or {"status": "ok", "as_of": "2026-11-17"})
    # the real yield block is its own service (tests/test_treasury_real_yields.py): stood in for here, so no test reaches the Treasury
    monkeypatch.setattr(real, "get_real", lambda **kw: asked.append("real") or {"status": "computing"})
    paths = {r.path: r for r in route.router.routes}
    assert set(paths) == {URL}
    assert paths[URL].methods == {"GET"}
    assert route.require_paid in {d.call for d in paths[URL].dependant.dependencies}
    assert _client(None).get(URL).status_code == 401
    assert _client(FREE_USER).get(URL).status_code == 402
    assert asked == []
    assert _client(PAID_USER).get(URL).json() == {"status": "ok", "as_of": "2026-11-17", "real": {"status": "computing"}}
    assert asked == ["yields", "real"]


def test_a_refused_source_is_a_200_answer_not_an_error_status(monkeypatch):
    from api.services import treasury_real_yields as real
    monkeypatch.setattr(ty, "get_yields", lambda: {"status": "unavailable", "reason": "refused", "http_status": 403})
    monkeypatch.setattr(real, "get_real", lambda **kw: pytest.fail("the real yield block is asked for only beside an ok nominal answer"))
    resp = _client(PAID_USER).get(URL)
    assert resp.status_code == 200 and resp.json() == {"status": "unavailable", "reason": "refused", "http_status": 403}


def test_the_route_is_mounted_on_the_app():
    import re
    from pathlib import Path
    src = (Path(__file__).resolve().parents[1] / "api" / "main.py").read_text(encoding="utf-8")
    assert re.search(r"^from api\.routers import treasury_yields as treasury_yields_router\b", src, re.M)
    assert re.search(r"^app\.include_router\(treasury_yields_router\.router\)", src, re.M)


def test_the_service_asks_the_treasury_and_nobody_else():
    """One outside host, in one function. No vendor client, no key, and nothing of the owner-held
    economic data feature."""
    import ast
    import inspect
    import re
    source = inspect.getsource(ty)
    tree = ast.parse(source)
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported |= {a.name for a in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module)
    assert not {m.split(".")[0] for m in imported} & {"httpx", "urllib", "aiohttp", "yfinance", "api"}
    assert "requests" in imported and source.count("import requests") == 1
    assert "import requests" in inspect.getsource(ty._http_get)          # the HTTP library is named in the one reader only
    code = "\n".join(ast.unparse(n) for n in tree.body if not (isinstance(n, ast.Expr) and isinstance(getattr(n, "value", None), ast.Constant)))
    assert set(re.findall(r"https?://[\w.\-]+", code)) == {"https://home.treasury.gov"}
    for word in ("massive", "polygon", "stlouisfed", "apiKey", "API_KEY", "ECON_ENABLED", "environ.get('MASSIVE"):
        assert word not in code, word
    assert "os.environ.get('DATA_DIR'" in code and code.count("os.environ") == 1      # the data directory is the only setting read
    assert ty.USER_AGENT.startswith("UCT-Intelligence ")
