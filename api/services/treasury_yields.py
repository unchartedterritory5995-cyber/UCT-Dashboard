"""RATES, the Terminal's Treasury yields screen: the daily Treasury yield at each maturity, the
change at each, and the two curve spreads a stock trader watches, read from the US Treasury's own
published Daily Treasury Par Yield Curve Rates.

One source, the Treasury's documented XML feed (no key, no account, no vendor):

  GET https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml
      ?data=daily_treasury_yield_curve&field_tdr_date_value=YYYY          one calendar year
      ?data=daily_treasury_yield_curve&field_tdr_date_value_month=YYYYMM  one month
  (the Treasury's page "Treasury Daily Interest Rate XML Feed" documents both forms; a third,
  `field_tdr_date_value=all&page=N`, pages the whole history 300 rows at a time and is not used.)

  The answer is an Atom feed. Each <entry> holds one day in <content><m:properties>:
      d:NEW_DATE           the day, `2026-11-02T00:00:00`
      d:BC_1MONTH  d:BC_3MONTH  d:BC_6MONTH  d:BC_1YEAR  d:BC_2YEAR  d:BC_3YEAR  d:BC_5YEAR
      d:BC_7YEAR  d:BC_10YEAR  d:BC_20YEAR  d:BC_30YEAR      the par yield, in PERCENT (4.91)
      d:BC_1_5MONTH  d:BC_2MONTH  d:BC_4MONTH  d:BC_30YEARDISPLAY  d:Id        not read
  The Treasury adds and removes maturities over the years (the 4-month in 2022, the 1.5-month
  in 2025) and its developer notice says an element that is absent has no figure for that day,
  so a maturity with no element, or an empty one, is None here, never 0.

The shape is as the Treasury's documentation page and one sample month gave it on 2026-11-18.
THIS SERVER HAS NEVER ASKED THE TREASURY: a government website may answer a server's request
differently from a browser's (a refusal, or a web page where the feed was expected). So:

  * a refusal (a 4xx or a redirect) is a first-class answer, `unavailable`, in plain words on the
    panel. It is REMEMBERED in this module (`REFUSED_HOLD_S`), so a refused source is not asked
    again by every member who opens the panel;
  * a 429, a timeout or a 5xx is `failed` with its reason, also remembered (15 minutes for a 429);
  * a web page where the feed was expected, XML that cannot be read, or rows without the fields
    this module needs is `unavailable` with reason `shape`;
  * every build writes ONE log line, prefix `[rates-data]`, naming the source (`treasury`), the
    status code, the requests made and the rows parsed; an answer that cannot be read says
    `shape mismatch` (or `no rows`) on that line;
  * the XML is parsed with the standard library, and only when it carries no document type
    declaration (so no entity is ever expanded); a row without its date, or with no yield at all,
    is dropped and counted.

NOTHING IS BUILT ON A MEMBER'S REQUEST (the house pattern, `api/services/scan_period.py`): a
request returns what this module holds at once; with nothing held it starts ONE background
build, waits a few seconds for it and otherwise answers `computing`, and the panel asks again.
The answer and the rows it was built from are held in this module AND on disk under the data
directory, so a restart does not start cold.

HOW MUCH IS ASKED. The first build reads five years: one request per calendar year, oldest
first, one after another with `PAUSE_S` between them (six or seven requests, once). A year that
was read before a later one failed is kept for `PARTIAL_KEEP_S`, so the next try asks only for
what is missing. After that a refresh asks for the current MONTH only (and the month before it
when the newest day held is in that month) and merges it into what is held: one small request.

WHEN IT IS REFRESHED. A request starts one background refresh when
  * the last look was before the most recent weekday `DAILY_AT_ET` (18:15 New York time: the
    Treasury works the curve out from quotations taken at about 3:30 PM and posts it that
    evening); or
  * the newest figure held is older than the last weekday before today and the last look was more
    than `RECHECK_S` ago.
The request that starts a refresh is still answered at once from what is held.

A CHANGE is the yield on the newest day minus the yield on the reference day, in basis points
(one hundredth of a percentage point). The reference day is the newest day with a row on or
before the calendar target (the day before; 7 days, 1 month, 3 months and 1 year earlier). A
reference day more than `MAX_REF_GAP_DAYS` from its target, or one with no figure for the
maturity, gives None: a change is never worked out against a different day than the one named.

WHY NOT THE STOCK-DATA VENDOR. The site's stock-data vendor also serves Treasury yields (its
`/fed/v1` economy routes). They are NOT used: the vendor does not say where it takes them from,
its wording matches a third-party database the owner has ruled out as a source for this site
(licensing register, row T-95 and the FRED section), and the Treasury publishes the same
figures itself. Do not wire those routes in without asking.

Reused by the Terminal panel (app/src/pages/terminal/panels/ratesModel.js); `held_answer` is
read-only for a caller that must not cause work.
"""
from __future__ import annotations

import bisect
import calendar
import json
import logging
import math
import os
import re
import tempfile
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Optional
from xml.etree import ElementTree as ET

_log = logging.getLogger(__name__)

SOURCE = "US Treasury daily par yield curve"
SOURCE_URL = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml"
FEED = "daily_treasury_yield_curve"
YEAR_PARAM = "field_tdr_date_value"
MONTH_PARAM = "field_tdr_date_value_month"
DATE_FIELD = "NEW_DATE"
LOG_NAME = "treasury"
#: the house form for an official source (api/services/econ/http.py): who is asking, no address
USER_AGENT = "UCT-Intelligence treasury-yields (contact: see docs)"

#: the maturities read, shortest first: (key, the Treasury's element, plain name, months)
MATURITIES: tuple[tuple[str, str, str, int], ...] = (
    ("1m", "BC_1MONTH", "1-month", 1),
    ("3m", "BC_3MONTH", "3-month", 3),
    ("6m", "BC_6MONTH", "6-month", 6),
    ("1y", "BC_1YEAR", "1-year", 12),
    ("2y", "BC_2YEAR", "2-year", 24),
    ("3y", "BC_3YEAR", "3-year", 36),
    ("5y", "BC_5YEAR", "5-year", 60),
    ("7y", "BC_7YEAR", "7-year", 84),
    ("10y", "BC_10YEAR", "10-year", 120),
    ("20y", "BC_20YEAR", "20-year", 240),
    ("30y", "BC_30YEAR", "30-year", 360),
)
#: the spreads, widest-watched first: (key, the longer maturity, the shorter one)
SPREADS: tuple[tuple[str, str, str], ...] = (("10y2y", "10y", "2y"), ("10y3m", "10y", "3m"))
#: the maturities and spreads whose daily history the answer carries (the answer's `history` columns)
HISTORY_YIELDS = ("2y", "10y", "30y")
#: the change horizons, shortest first
HORIZONS = ("d1", "w1", "m1", "m3", "y1")
#: an answer in which no row carries one of these is not this dataset
REQUIRED_KEYS = ("2y", "10y")

# ── defaults (each one is the builder's, not an owner ruling) ────────────────────────────────
HISTORY_YEARS = 5             # years of daily history read and carried
WINDOW_PAD_DAYS = 10          # extra days kept before the window, so its first day has a row
COVER_SLACK_DAYS = 14         # held rows that start within this of the window's start cover it
MAX_REQUESTS = HISTORY_YEARS + 2   # the most requests one build may make (a five-year window touches at most seven calendar years)
MAX_REFRESH_MONTHS = 3        # a refresh further behind than this many months asks by year instead
PAUSE_S = 1.0                 # between two requests of one build
HTTP_TIMEOUT = (10, 60)       # connect, read (seconds)
MAX_BYTES = 5_000_000         # a year is about 300 kB; anything past this is not the feed
MAX_REF_GAP_DAYS = 7          # a reference day further than this from its target is not used
DAILY_AT_ET = (18, 15)        # the weekday refresh, New York time
RECHECK_S = 3 * 3600.0        # how often a request may look again while the newest figure is behind
REFUSED_HOLD_S = 6 * 3600.0   # a refusal (a 4xx or a redirect) is not asked again for this long
RATE_LIMITED_HOLD_S = 900.0   # a 429
SHAPE_HOLD_S = 900.0          # the source answered, but not with rows this module can read
FAILED_S = 60.0               # a failed build is said briefly, then tried again
PARTIAL_KEEP_S = 1800.0       # periods read before a build failed are kept this long for the next try
WAIT_S = 3.0                  # the longest a request waits on the build it started
DISK_VERSION = 2

_ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_FIELD = {key: field for key, field, _label, _months in MATURITIES}

_lock = threading.Lock()
_state: dict[str, Any] = {
    "held": None,          # the built answer (see `assemble`), or None
    "rows": {},            # {day: {key: percent or None}}: what the answer was built from
    "loaded": False,       # the disk copy has been looked for
    "checked": 0.0,        # when the Treasury was last asked
    "check": None,         # what the last look said when it did not go well, for the answer
    "block": None,         # (until, answer) with nothing held: unavailable / failed
    "retry_at": 0.0,       # with an answer held: no new look before this (a refusal or a failure is remembered)
    "partial": None,       # (kept until, the plan, {period: rows}) from a build that failed part way
    "inflight": None,      # the Event of the running build
}


class _Stop(Exception):
    """A read that did not give usable rows. `state`: 'unavailable' | 'failed'. `hold` is how long
    the answer stands before the Treasury is asked again."""

    def __init__(self, state: str, http_status: Optional[int] = None, reason: Optional[str] = None,
                 note: str = "", hold: float = FAILED_S):
        super().__init__(reason or state)
        self.state = state
        self.http_status = http_status
        self.reason = reason
        self.note = note
        self.hold = hold


class FeedShape(Exception):
    """The body is not the feed, or cannot be read as it. `why` is plain words for the log."""

    def __init__(self, why: str):
        super().__init__(why)
        self.why = why


# ── the readers (each one small, so a test can stand in for it) ──────────────────────────────

def _http_get(params: dict) -> tuple[int, str, bytes]:
    """ONE GET of the Treasury's feed: (status, content type, body). No redirect is followed and no
    more than `MAX_BYTES` (and one more) is read. Raises whatever the HTTP library raises."""
    import requests
    with requests.get(SOURCE_URL, params=params, timeout=HTTP_TIMEOUT, allow_redirects=False, stream=True,
                      headers={"User-Agent": USER_AGENT, "Accept": "application/xml, application/atom+xml"}) as resp:
        body = resp.raw.read(MAX_BYTES + 1, decode_content=True) or b""
        return resp.status_code, str(resp.headers.get("Content-Type") or ""), body


def _pause(seconds: float) -> None:
    time.sleep(seconds)


def now_et() -> datetime:
    """The time in New York (the Treasury's day)."""
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo("America/New_York"))


def _data_dir() -> Optional[str]:
    base = os.environ.get("DATA_DIR", "/data")
    return base if os.path.isdir(base) else None


def _disk_path() -> Optional[str]:
    base = _data_dir()
    return os.path.join(base, "treasury_yields", f"yields_v{DISK_VERSION}.json") if base else None


# ── pure helpers ─────────────────────────────────────────────────────────────────────────────

def _num(v: Any) -> Optional[float]:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    f = float(v)
    return f if math.isfinite(f) else None


def _figure(text: Any) -> Optional[float]:
    """An element's text as a yield in percent, or None (empty, not a number, not finite)."""
    s = text.strip() if isinstance(text, str) else ""
    if not s:
        return None
    try:
        f = float(s)
    except ValueError:
        return None
    return f if math.isfinite(f) else None


def _iso(v: Any) -> Optional[str]:
    s = v.strip()[:10] if isinstance(v, str) else ""
    if not _ISO_DAY.match(s):
        return None
    try:
        date.fromisoformat(s)
    except ValueError:
        return None
    return s


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _local(tag: Any) -> str:
    """An element's name without its namespace."""
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def months_back(day: date, months: int) -> date:
    """The same day of the month `months` earlier; the month's last day when it has no such day."""
    idx = day.year * 12 + (day.month - 1) - months
    year, month = divmod(idx, 12)
    return date(year, month + 1, min(day.day, calendar.monthrange(year, month + 1)[1]))


def window_start(today: date) -> date:
    """The first day kept: `HISTORY_YEARS` before today, and a little more."""
    return months_back(today, 12 * HISTORY_YEARS) - timedelta(days=WINDOW_PAD_DAYS)


def looks_like_html(content_type: str, body: bytes) -> bool:
    """A web page, by what the body starts with; the content type only decides a body that starts
    as neither a page nor XML (a feed served under a page's content type is still the feed)."""
    head = body[:400].lstrip(b"\xef\xbb\xbf \t\r\n").lower()
    if head.startswith((b"<!doctype html", b"<html")):
        return True
    if head.startswith((b"<?xml", b"<feed")):
        return False
    return "html" in (content_type or "").lower()


def parse_feed(body: bytes, content_type: str = "") -> tuple[list[dict], int, int]:
    """(rows, entries, dropped) from one answer of the Treasury's feed: one row per day, oldest
    first, each `{"date": iso, "y": {key: percent or None}}`. `entries` counts the days the feed
    carried (an <entry> with no properties is the feed's way of saying "none", and is not counted).
    A row needs its date and at least one yield; a maturity whose element is absent, empty, marked
    null or not a number is None. A day sent twice keeps its first row. Raises `FeedShape` when the
    body is not the feed."""
    if len(body) > MAX_BYTES:
        raise FeedShape(f"an answer larger than {MAX_BYTES // 1_000_000} MB")
    if looks_like_html(content_type, body):
        raise FeedShape("a web page where the feed was expected")
    if not body.strip():
        raise FeedShape("an empty answer")
    upper = body.upper()
    if b"<!DOCTYPE" in upper or b"<!ENTITY" in upper:
        raise FeedShape("a document type declaration, which the feed never carries; not parsed")
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        raise FeedShape("XML that is not well formed") from None
    if _local(root.tag) != "feed":
        raise FeedShape(f"a document whose root is <{_local(root.tag)[:40]}>, not the feed")
    by_day: dict[str, dict] = {}
    entries = dropped = 0
    for entry in root:
        if _local(entry.tag) != "entry":
            continue
        props = next((el for el in entry.iter() if _local(el.tag) == "properties"), None)
        if props is None or len(props) == 0:
            continue
        entries += 1
        found = {_local(el.tag): el for el in props}
        day = _iso(found[DATE_FIELD].text) if DATE_FIELD in found else None
        if not day:
            dropped += 1
            continue
        ys: dict[str, Optional[float]] = {}
        for key, field, _label, _months in MATURITIES:
            el = found.get(field)
            null = el is not None and any(_local(k) == "null" and str(v).lower() == "true" for k, v in el.attrib.items())
            ys[key] = None if el is None or null else _figure(el.text)
        if all(v is None for v in ys.values()):
            dropped += 1
            continue
        by_day.setdefault(day, {"date": day, "y": ys})
    return [by_day[d] for d in sorted(by_day)], entries, dropped


def period_of(kind: str, value: str) -> str:
    """The prefix every day of a period starts with: ('year', '2026') -> '2026-', ('month', '202611') -> '2026-11-'."""
    return f"{value}-" if kind == "year" else f"{value[:4]}-{value[4:]}-"


def plan(today: date, held_days: list[str]) -> list[tuple[str, str]]:
    """Pure: the requests one build makes, in order, as (kind, value): the calendar years of the
    window when nothing held covers it, else the months from the newest day held to this one."""
    start = window_start(today)
    days = sorted(held_days)
    if days and days[0] <= (start + timedelta(days=COVER_SLACK_DAYS)).isoformat() and days[-1] <= today.isoformat():
        newest = date.fromisoformat(days[-1])
        months = [divmod(i, 12) for i in range(newest.year * 12 + newest.month - 1, today.year * 12 + today.month)]
        if len(months) <= MAX_REFRESH_MONTHS:
            return [("month", f"{y}{m + 1:02d}") for y, m in months]
        return [("year", str(y)) for y in range(newest.year, today.year + 1)][-MAX_REQUESTS:]
    return [("year", str(y)) for y in range(start.year, today.year + 1)][-MAX_REQUESTS:]


def _bp(now: Optional[float], was: Optional[float]) -> Optional[float]:
    """The change in basis points, or None when either figure is missing."""
    if now is None or was is None:
        return None
    return round((now - was) * 100.0, 1)


def _spread(row: dict, long_key: str, short_key: str) -> Optional[float]:
    """The longer yield minus the shorter one, in percentage points, or None."""
    a, b = row["y"].get(long_key), row["y"].get(short_key)
    return round(a - b, 2) if a is not None and b is not None else None


def spread_state(value: Optional[float]) -> Optional[str]:
    """'positive' (the longer maturity yields more) | 'inverted' | 'flat' (exactly equal) | None."""
    if value is None:
        return None
    return "positive" if value > 0 else "inverted" if value < 0 else "flat"


def reference_rows(rows: list[dict]) -> dict[str, Optional[dict]]:
    """{horizon: the reference day's row, or None} for the newest row of `rows` (oldest first)."""
    out: dict[str, Optional[dict]] = {h: None for h in HORIZONS}
    if not rows:
        return out
    days = [r["date"] for r in rows]
    newest = date.fromisoformat(days[-1])
    targets = {
        "d1": newest - timedelta(days=1), "w1": newest - timedelta(days=7),
        "m1": months_back(newest, 1), "m3": months_back(newest, 3), "y1": months_back(newest, 12),
    }
    for horizon, target in targets.items():
        i = bisect.bisect_right(days, target.isoformat()) - 1
        if i < 0 or i >= len(rows) - 1:
            continue
        if (target - date.fromisoformat(days[i])).days > MAX_REF_GAP_DAYS:
            continue                                  # a hole in the data: no change is better than a wrong one
        out[horizon] = rows[i]
    return out


def run_of(values: list[Optional[float]]) -> tuple[Optional[int], Optional[int], bool]:
    """(days, first index, at_least) for the run the LAST value's state has been in: how many rows in a
    row, ending at the last one, share its state. `at_least` is True when the run reaches the first
    row or stops at a day with no figure, so it may be longer than counted."""
    state = spread_state(values[-1]) if values else None
    if state is None:
        return None, None, False
    i = len(values) - 1
    while i > 0 and spread_state(values[i - 1]) == state:
        i -= 1
    return len(values) - i, i, (i == 0 or values[i - 1] is None)


def assemble(rows: list[dict], *, read_at: Optional[str] = None) -> dict:
    """Pure: the held answer from parsed rows (oldest first, at least one)."""
    newest = rows[-1]
    refs = reference_rows(rows)
    was_row = lambda h, key: refs[h]["y"].get(key) if refs[h] else None  # noqa: E731

    maturities = []
    for key, _field, label, months in MATURITIES:
        now = newest["y"].get(key)
        was = {h: was_row(h, key) for h in HORIZONS}
        maturities.append({
            "key": key, "label": label, "months": months, "yield": now,
            "was": was, "change_bp": {h: _bp(now, was[h]) for h in HORIZONS},
        })

    labels = {key: label for key, _field, label, _months in MATURITIES}
    spreads = []
    series_by_key: dict[str, list[Optional[float]]] = {}
    for key, long_key, short_key in SPREADS:
        series = [_spread(r, long_key, short_key) for r in rows]
        series_by_key[key] = series
        value = series[-1]
        was = {h: (_spread(refs[h], long_key, short_key) if refs[h] else None) for h in HORIZONS}
        days, first, at_least = run_of(series)
        spreads.append({
            "key": key, "long": long_key, "short": short_key,
            "label": f"{labels[long_key]} minus {labels[short_key]}",
            "value": value, "state": spread_state(value), "inverted": (value < 0) if value is not None else None,
            "days_in_state": days, "since": rows[first]["date"] if first is not None else None,
            "days_at_least": at_least,
            "was": was, "change_bp": {h: _bp(value, was[h]) for h in HORIZONS},
        })

    cut = months_back(date.fromisoformat(newest["date"]), 12 * HISTORY_YEARS).isoformat()
    first = bisect.bisect_left([r["date"] for r in rows], cut)
    kept = rows[first:]
    history: dict[str, Any] = {
        "from": kept[0]["date"], "to": kept[-1]["date"], "points": len(kept), "years": HISTORY_YEARS,
        "dates": [r["date"] for r in kept],
    }
    for key in HISTORY_YIELDS:
        history[f"y{key}"] = [r["y"].get(key) for r in kept]
    for key, _long, _short in SPREADS:
        history[f"s{key}"] = series_by_key[key][first:]

    return {
        "v": DISK_VERSION,
        "as_of": newest["date"],
        "ref_dates": {h: (refs[h]["date"] if refs[h] else None) for h in HORIZONS},
        "maturities": maturities,
        "spreads": spreads,
        "history": history,
        "rows": len(rows),
        "read_at": read_at or _now_iso(),
        "basis": "end_of_day",
        "units": {"yield": "percent", "change": "basis points", "spread": "percentage points"},
        "source": SOURCE,
    }


def _answer(held: dict, check: Optional[dict]) -> dict:
    return {"status": "ok", **{k: v for k, v in held.items() if k != "v"}, "check": check}


# ── the read ─────────────────────────────────────────────────────────────────────────────────

def _say(status: Any, text: str) -> str:
    return f"{LOG_NAME} status={status if status is not None else 'none'} {text}"


def fetch_period(kind: str, value: str, *, may_be_empty: bool = False) -> tuple[list[dict], int]:
    """(rows, dropped) for one documented period, `('year', '2026')` or `('month', '202611')`: ONE
    request. Raises `_Stop` for a refusal, a failed read, or an answer that is not the feed. A
    period with no day in it is an answer only when `may_be_empty` (the period today falls in,
    before its first figure is out); for a past period it is a shape mismatch."""
    params = {"data": FEED, (YEAR_PARAM if kind == "year" else MONTH_PARAM): value}
    try:
        status, ctype, body = _http_get(params)
    except Exception as exc:  # noqa: BLE001 -- only the error's class is ever logged, never its text
        name = type(exc).__name__
        if "timeout" in name.lower():
            raise _Stop("failed", None, "timeout", note=f"failed (the Treasury's website did not answer in time, for {value})") from None
        raise _Stop("failed", None, "source", note=f"failed ({name}, for {value})") from None
    if status == 429:
        raise _Stop("failed", 429, "rate_limited", hold=RATE_LIMITED_HOLD_S,
                    note=f"failed (the Treasury's website said too many requests, for {value}; "
                         f"not asked again for {int(RATE_LIMITED_HOLD_S // 60)} min)")
    if status == 408 or status >= 500:
        raise _Stop("failed", status, "source", note=f"failed (the Treasury's website answered {status}, for {value})")
    if status != 200:
        # a 403 or 404, any other 4xx, and a redirect (never followed: a moved feed is not the feed)
        raise _Stop("unavailable", status, "refused", hold=REFUSED_HOLD_S,
                    note=f"unavailable (the Treasury's website refused the request for {value}; "
                         f"not asked again for {int(REFUSED_HOLD_S // 3600)}h)")
    try:
        rows, entries, dropped = ([], 0, 0) if may_be_empty and not body.strip() else parse_feed(body, ctype)
    except FeedShape as shape:
        raise _Stop("unavailable", 200, "shape", hold=SHAPE_HOLD_S,
                    note=f"rows=0 shape mismatch ({shape.why}, for {value})") from None
    prefix = period_of(kind, value)
    inside = [r for r in rows if r["date"].startswith(prefix)]
    if entries and not inside:
        # an ignored filter answers with other days (the first 300 of the whole history): never used
        why = "none with a date and a yield" if not rows else "none dated in the period asked for"
        raise _Stop("unavailable", 200, "shape", hold=SHAPE_HOLD_S,
                    note=f"rows=0 shape mismatch ({entries} entries for {value}, {why})")
    if not inside and not may_be_empty:
        raise _Stop("unavailable", 200, "shape", hold=SHAPE_HOLD_S,
                    note=f"rows=0 no rows (the feed answered with no day for {value}, a period that has passed)")
    return inside, dropped + (len(rows) - len(inside))


def build(today: Optional[date] = None, held_rows: Optional[dict] = None,
          partial: Optional[dict] = None) -> tuple[dict, dict, str]:
    """(the new held answer, the rows it was built from, the log line's text). The requests are
    `plan`'s, one after another on the calling (background) thread, `PAUSE_S` apart. `partial` is
    `{(kind, value): rows}`: periods already read are not asked for again, and each period read
    here is put into it BEFORE the next is asked for, so a caller keeps them when a later one
    fails. Raises `_Stop` for a refusal, a failed read or a shape mismatch."""
    today = today or now_et().date()
    held_rows = held_rows or {}
    got = partial if partial is not None else {}
    start = window_start(today).isoformat()
    last = (today + timedelta(days=1)).isoformat()         # a date past today is not a figure
    periods = plan(today, list(held_rows))
    asked = dropped = 0
    for period in periods:
        if period in got:
            continue
        if asked >= MAX_REQUESTS:
            raise _Stop("failed", None, "error", note=f"failed (more than {MAX_REQUESTS} requests in one build; stopped)")
        if asked:
            _pause(PAUSE_S)
        asked += 1
        try:
            # only the period today falls in may still be empty
            rows, lost = fetch_period(*period, may_be_empty=today.isoformat().startswith(period_of(*period)))
        except _Stop as stop:
            stop.note = f"{stop.note}; request {asked} of this build, {len(got)} of {len(periods)} periods read"
            raise
        got[period] = rows
        dropped += lost
    merged = dict(held_rows)
    for period in periods:
        for r in got.get(period) or []:
            merged[r["date"]] = r["y"]
    merged = {d: ys for d, ys in merged.items() if start <= d <= last}
    new_days = sum(1 for d in merged if d not in held_rows)
    if not merged:
        raise _Stop("unavailable", 200, "shape", hold=SHAPE_HOLD_S,
                    note=f"rows=0 no rows (the feed answered {asked} requests with no day in the window)")
    rows = [{"date": d, "y": merged[d]} for d in sorted(merged)]
    missing = [_FIELD[key] for key in REQUIRED_KEYS if all(r["y"].get(key) is None for r in rows)]
    if missing:
        raise _Stop("unavailable", 200, "shape", hold=SHAPE_HOLD_S,
                    note=f"rows={len(rows)} shape mismatch (no row carries {' or '.join(missing)})")
    held = assemble(rows)
    newest_before = max(held_rows) if held_rows else None
    same = " (no newer figure than the one held)" if newest_before and held["as_of"] <= newest_before else ""
    tail = f" dropped={dropped}" if dropped else ""
    return held, merged, _say(200, f"rows={len(rows)} requests={asked} new={new_days} latest={held['as_of']} "
                                   f"first={rows[0]['date']}{tail}{same}")


# ── one build, held here and on disk ─────────────────────────────────────────────────────────

def _save_disk(held: dict, rows: dict, checked: float) -> None:
    path = _disk_path()
    if not path:
        return
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".yields_", suffix=".tmp", dir=os.path.dirname(path))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump({"held": held, "rows": rows, "checked": checked}, fh)
            os.replace(tmp, path)
        except Exception:
            try:
                os.remove(tmp)
            except OSError:
                pass
            raise
    except Exception as exc:  # noqa: BLE001 -- the answer is still held in memory
        _log.warning("[rates-data] the answer could not be written to disk (%s)", type(exc).__name__)


def _load_disk() -> tuple[Optional[dict], dict, float]:
    path = _disk_path()
    if not path:
        return None, {}, 0.0
    try:
        with open(path, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        return None, {}, 0.0
    held = doc.get("held") if isinstance(doc, dict) else None
    raw = doc.get("rows") if isinstance(doc, dict) else None
    if (not isinstance(held, dict) or held.get("v") != DISK_VERSION or not _iso(held.get("as_of"))
            or not isinstance(held.get("maturities"), list) or not held["maturities"]
            or not isinstance(held.get("spreads"), list) or not isinstance(held.get("history"), dict)
            or not isinstance(raw, dict) or held["as_of"] not in raw):
        return None, {}, 0.0
    rows = {d: {key: _num(ys.get(key)) for key in _FIELD} for d, ys in raw.items() if _iso(d) == d and isinstance(ys, dict)}
    checked = _num(doc.get("checked")) or 0.0
    return held, rows, min(checked, time.time())


def _held() -> Optional[dict]:
    """The answer this module holds, looking for the disk copy once per process."""
    with _lock:
        if _state["held"] is not None or _state["loaded"]:
            return _state["held"]
    held, rows, checked = _load_disk()
    with _lock:
        if not _state["loaded"]:
            _state["loaded"] = True
            if _state["held"] is None and held is not None:
                _state["held"], _state["rows"], _state["checked"] = held, rows, checked
        return _state["held"]


def last_daily_slot(now: datetime) -> datetime:
    """The most recent weekday `DAILY_AT_ET` at or before `now` (New York time)."""
    slot = now.replace(hour=DAILY_AT_ET[0], minute=DAILY_AT_ET[1], second=0, microsecond=0)
    if slot > now:
        slot -= timedelta(days=1)
    while slot.weekday() >= 5:
        slot -= timedelta(days=1)
    return slot


def last_weekday_before(day: date) -> date:
    d = day - timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def refresh_due(as_of: Optional[str], checked: float, now: Optional[datetime] = None) -> bool:
    """Pure: whether a request may start a refresh of an answer whose newest figure is `as_of`
    and which was last looked for at `checked` (epoch seconds). See the module docstring."""
    now = now or now_et()
    if checked < last_daily_slot(now).timestamp():
        return True
    behind = not as_of or as_of < last_weekday_before(now.date()).isoformat()
    return behind and now.timestamp() - checked >= RECHECK_S


def _build_bg(done: threading.Event) -> None:
    started = time.time()
    said, level = _say(None, "failed"), logging.WARNING
    got: dict = {}
    periods: tuple = ()
    try:
        today = now_et().date()
        with _lock:
            held_rows = dict(_state["rows"]) if _state["held"] is not None else {}
            kept = _state["partial"]
        periods = tuple(plan(today, list(held_rows)))
        if kept is not None and kept[0] > started and kept[1] == periods:
            got = dict(kept[2])                      # what an earlier try of the SAME plan already read
        new, rows, said = build(today, held_rows, got)
        now = time.time()
        with _lock:
            _state["held"], _state["rows"], _state["partial"] = new, rows, None
            _state["checked"], _state["check"], _state["block"], _state["retry_at"] = now, None, None, 0.0
        _save_disk(new, rows, now)
        level = logging.INFO
    except _Stop as stop:
        said = _say(stop.http_status, stop.note)
        _remember_stop(stop.state, stop.reason, stop.http_status, stop.hold)
        if got:
            with _lock:
                _state["partial"] = (time.time() + PARTIAL_KEEP_S, periods, got)
    except Exception as exc:  # noqa: BLE001 -- a failed build is said, never left as "computing" for ever
        said = _say(None, f"failed ({type(exc).__name__})")
        _remember_stop("failed", "error", None, FAILED_S)
    finally:
        _log.log(level, "[rates-data] %s; %.2fs", said, time.time() - started)
        with _lock:
            _state["inflight"] = None
        done.set()


def _remember_stop(state: str, reason: Optional[str], http_status: Optional[int], hold: float) -> None:
    now = time.time()
    answer = {"status": state, "reason": reason, "http_status": http_status, "source": SOURCE}
    with _lock:
        _state["block"] = (now + hold, answer)
        _state["check"] = {"state": state, "reason": reason, "http_status": http_status, "at": _now_iso()}
        _state["retry_at"] = now + hold          # with an answer held, look again after the same hold


def _start_job() -> threading.Event:
    with _lock:
        done = _state["inflight"]
        if done is None:
            done = _state["inflight"] = threading.Event()
            threading.Thread(target=_build_bg, args=(done,), daemon=True, name="rates-data-build").start()
        return done


def _block() -> Optional[dict]:
    with _lock:
        hit = _state["block"]
        if hit is None:
            return None
        if hit[0] <= time.time():
            _state["block"] = None
            return None
        return dict(hit[1])


def held_answer() -> tuple[Optional[dict], str]:
    """READ ONLY: the answer this module already holds, as `(answer, how)`. It never starts a build.
    how: 'held' | 'not_held'."""
    held = _held()
    if held is None:
        return None, "not_held"
    with _lock:
        check = _state["check"]
    return _answer(held, check), "held"


def get_yields(*, wait_s: Optional[float] = None) -> dict:
    """Treasury yields by maturity with their changes, the two curve spreads and five years of
    daily history. NEVER builds on the caller's thread: the held answer (looked for on disk once),
    else a short wait on the one background build, else `{"status": "computing"}`.

    status: 'ok' | 'computing' | 'unavailable' (the Treasury's website refused the request, or
            its answer could not be read as the feed; `reason` says which: 'refused' | 'shape') |
            'failed' (`reason`: 'rate_limited' | 'timeout' | 'source' | 'error')
    ok:     as_of (the date of the newest figure), ref_dates {d1, w1, m1, m3, y1}, maturities
            [{key, label, months, yield (percent), was {horizon: percent}, change_bp {horizon:
            basis points}}], spreads [{key, label, long, short, value (percentage points), state,
            inverted, days_in_state (trading days), since, days_at_least, was, change_bp}],
            history {from, to, points, years, dates, y2y, y10y, y30y, s10y2y, s10y3m}, rows,
            read_at (when the site read it), basis 'end_of_day', units, source, check (None, or
            what the last look for a newer figure said when it did not go well)
    """
    held = _held()
    if held is not None:
        with _lock:
            checked, check, retry_at = _state["checked"], _state["check"], _state["retry_at"]
        if time.time() >= retry_at and refresh_due(held.get("as_of"), checked):
            _start_job()                             # never waited for: the held answer is given now
        return _answer(held, check)
    block = _block()
    if block is not None:
        return block
    done = _start_job()
    done.wait(WAIT_S if wait_s is None else wait_s)
    with _lock:
        held, check = _state["held"], _state["check"]
    if held is not None:
        return _answer(held, check)
    block = _block()
    return block if block is not None else {"status": "computing"}


def reset_for_tests() -> None:
    """Tests only: forget everything this module holds."""
    with _lock:
        _state.update({"held": None, "rows": {}, "loaded": False, "checked": 0.0, "check": None, "block": None,
                       "retry_at": 0.0, "partial": None, "inflight": None})
